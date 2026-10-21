use crate::{
    error::{ApiError, Result},
    files::Files,
    preview::FrameSnapshot,
    source::file_identity,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    ops::ControlFlow,
    os::fd::AsRawFd,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use vv_audio::mixer::{PROJECT_SAMPLE_RATE, sample_to_timeline_frame, timeline_frame_to_sample};
use vv_session::audio_render::{LevelCache, render_offline};

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceQuery {
    pub project_epoch: String,
    pub frame: i64,
}

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WindowParams {
    pub start_sample: u64,
    pub seconds: u8,
    pub tempo: u8,
    #[serde(default)]
    pub source_version: Option<String>,
    #[serde(default)]
    pub end_sample: Option<u64>,
}
pub struct Window {
    pub bytes: Vec<u8>,
    pub start: u64,
    pub end: u64,
    pub tempo: u8,
    pub last: bool,
    pub source_version: String,
}

pub const FRAMES: usize = PROJECT_SAMPLE_RATE as usize * 80 / 1000;
pub struct CancelOnDrop(pub Arc<AtomicBool>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
pub struct Task {
    snapshot: FrameSnapshot,
    files: Vec<(File, String)>,
    inputs: crate::program::Inputs,
}
pub fn pin(mut snapshot: FrameSnapshot, files: &Files) -> Result<Task> {
    let inputs = crate::program::inputs(&snapshot)?;
    let mut pinned = Vec::new();
    for (path, expected) in &inputs {
        let file = files.media_file(path)?;
        let identity = file_identity(&file)?;
        if identity != *expected {
            return Err(changed());
        }
        let fd_path = format!("/proc/self/fd/{}", file.as_raw_fd());
        for (_, media) in snapshot.project.media_pool.iter_mut() {
            if media.compound.is_none() && media.path == *path {
                media.path = fd_path.clone().into();
            }
        }
        pinned.push((file, identity));
    }
    if !crate::program::unchanged(&inputs) {
        return Err(changed());
    }
    Ok(Task {
        snapshot,
        files: pinned,
        inputs,
    })
}
fn changed() -> ApiError {
    ApiError::conflict("SOURCE_CHANGED", "Audio sources changed; seek again")
}
impl Task {
    pub fn source(spec: crate::source::SourceSpec, frame: i64) -> Result<Self> {
        use vv_core::{
            Clip, ClipId, ClipSource, Id, MediaItem, Project, Rational, Timeline, Track, TrackKind,
        };
        if !spec.meta.has_audio || !(0..spec.meta.duration_frames).contains(&frame) {
            return Err(ApiError::invalid(
                "Choose a frame inside a source with audio",
            ));
        }
        let identity = file_identity(&spec.file)?;
        let mut project = Project::default();
        let fps = spec.meta.fps;
        let end = spec.meta.duration_frames;
        let media = project.media_pool.insert(MediaItem {
            path: format!("/proc/self/fd/{}", spec.file.as_raw_fd()).into(),
            meta: spec.meta,
            content_hash: 0,
            compound: None,
            folder: None,
        });
        let mut track = Track::new(TrackKind::Audio);
        track.insert_sorted(Clip::from_source_range(
            ClipId(1),
            ClipSource::Media(media),
            0,
            end,
            0,
            Rational::one(),
        ));
        let timeline = project.timelines.insert(Timeline {
            name: "Source audition".into(),
            fps,
            resolution: (640, 360),
            tracks: vec![track],
            markers: vec![],
            master: Default::default(),
        });
        Ok(Self {
            snapshot: FrameSnapshot {
                project,
                timeline,
                size: (640, 360),
                query: crate::preview::FrameQuery {
                    timeline_id: timeline.raw().to_string(),
                    project_epoch: spec.epoch,
                    if_generation: "0".into(),
                    revision: identity.clone(),
                    frame,
                    width: 640,
                },
            },
            files: vec![(spec.file, identity)],
            inputs: vec![],
        })
    }
    pub fn run(&self, cancel: Arc<AtomicBool>) -> Result<Vec<u8>> {
        let timeline = &self.snapshot.project.timelines[self.snapshot.timeline];
        let start = timeline_frame_to_sample(
            self.snapshot.query.frame,
            timeline.fps.as_f64(),
            PROJECT_SAMPLE_RATE,
        );
        Ok(wav(&self.render(start, FRAMES, cancel)?))
    }
    pub fn window(&self, params: WindowParams, cancel: Arc<AtomicBool>) -> Result<Window> {
        let source_version = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    &self.inputs,
                    self.files
                        .iter()
                        .map(|(_, identity)| identity)
                        .collect::<Vec<_>>()
                ))
                .map_err(|_| ApiError::io())?
            )
        );
        if params
            .source_version
            .as_ref()
            .is_some_and(|expected| expected != &source_version)
        {
            return Err(changed());
        }
        let timeline = &self.snapshot.project.timelines[self.snapshot.timeline];
        let total = timeline_frame_to_sample(
            timeline.total_frames(),
            timeline.fps.as_f64(),
            PROJECT_SAMPLE_RATE,
        );
        if ![2, 4, 8].contains(&params.tempo)
            || ![2, 4, 8].contains(&params.seconds)
            || params.start_sample >= total
            || sample_to_timeline_frame(
                params.start_sample,
                timeline.fps.as_f64(),
                PROJECT_SAMPLE_RATE,
            ) != self.snapshot.query.frame
        {
            return Err(ApiError::invalid(
                "Choose a matching audio position, 2/4/8 second window and 2x/4x/8x tempo",
            ));
        }
        let limit = params.end_sample.unwrap_or(total);
        if limit > total || limit <= params.start_sample {
            return Err(ApiError::invalid(
                "Audio playback end is outside the snapshot range",
            ));
        }
        let end = params
            .start_sample
            .saturating_add(u64::from(params.seconds) * u64::from(PROJECT_SAMPLE_RATE))
            .min(limit);
        let frames = (end - params.start_sample) as usize;
        if frames < usize::from(params.tempo) {
            return Err(ApiError::conflict(
                "AUDIO_END",
                "Audio playback reached its end",
            ));
        }
        let mut samples = self.render(params.start_sample, frames, cancel.clone())?;
        // Keep the desktop stretch window at a clipped playback end.
        samples.resize(
            usize::from(params.seconds) * PROJECT_SAMPLE_RATE as usize * 2,
            0.0,
        );
        let mut stretched =
            vv_audio::stretch_samples(&samples, PROJECT_SAMPLE_RATE, 2, f64::from(params.tempo))
                .map_err(|_| {
                    ApiError::invalid("Native pitch-preserving playback stretch failed")
                })?;
        if cancel.load(Ordering::Relaxed) {
            return Err(ApiError::conflict(
                "AUDIO_CANCELED",
                "Audio window was canceled",
            ));
        }
        self.check_inputs()?;
        if stretched.iter().any(|value| !value.is_finite()) {
            return Err(ApiError::invalid(
                "Native stretch returned non-finite audio",
            ));
        }
        stretched.resize(frames / usize::from(params.tempo) * 2, 0.0);
        Ok(Window {
            bytes: wav(&stretched),
            start: params.start_sample,
            end,
            tempo: params.tempo,
            last: end == limit,
            source_version,
        })
    }
    fn check_inputs(&self) -> Result<()> {
        if self
            .files
            .iter()
            .all(|(file, before)| file_identity(file).is_ok_and(|now| now == *before))
            && crate::program::unchanged(&self.inputs)
        {
            Ok(())
        } else {
            Err(changed())
        }
    }
    fn render(&self, start: u64, frames: usize, cancel: Arc<AtomicBool>) -> Result<Vec<f32>> {
        self.check_inputs()?;
        let timeline = &self.snapshot.project.timelines[self.snapshot.timeline];
        let mut levels = LevelCache::on_disk();
        levels.threads = 1;
        levels.cancel = Some(cancel.clone());
        let mut samples = Vec::with_capacity(frames * 2);
        render_offline(
            &self.snapshot.project,
            timeline,
            start..start + frames as u64,
            &mut levels,
            |chunk| {
                if cancel.load(Ordering::Relaxed) {
                    return ControlFlow::Break(());
                }
                samples.extend_from_slice(chunk);
                ControlFlow::Continue(())
            },
        )
        .map_err(|_| ApiError::invalid("Native audio audition failed or was canceled"))?;
        if cancel.load(Ordering::Relaxed) {
            return Err(ApiError::conflict(
                "AUDIO_CANCELED",
                "Audio audition was canceled",
            ));
        }
        self.check_inputs()?;
        if samples.len() != frames * 2 || samples.iter().any(|v| !v.is_finite()) {
            return Err(ApiError::invalid(
                "Native audio returned an invalid fragment",
            ));
        }
        Ok(samples)
    }
}
fn wav(samples: &[f32]) -> Vec<u8> {
    let length = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + length as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + length).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&PROJECT_SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(PROJECT_SAMPLE_RATE * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&length.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    out
}

#[cfg(test)]
#[path = "tests/audition.rs"]
mod tests;
