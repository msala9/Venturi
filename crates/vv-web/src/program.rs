use crate::{
    error::{ApiError, Result},
    preview::{FrameQuery, FrameSnapshot, Preview},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use vv_session::export::{ExportProgress, ExportSettings};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgramQuery {
    pub project_epoch: String,
    pub if_generation: String,
    pub timeline_id: String,
    pub revision: String,
    pub start_frame: i64,
    pub end_frame: i64,
    #[serde(default = "width")]
    pub width: u32,
}
fn width() -> u32 {
    960
}
impl ProgramQuery {
    pub fn contains(&self, other: &Self) -> bool {
        self.frame().same_composition(&other.frame())
            && self.start_frame <= other.start_frame
            && other.start_frame < self.end_frame
            && other.end_frame <= self.end_frame
    }
    pub fn frame(&self) -> FrameQuery {
        FrameQuery {
            project_epoch: self.project_epoch.clone(),
            if_generation: self.if_generation.clone(),
            timeline_id: self.timeline_id.clone(),
            revision: self.revision.clone(),
            frame: self.start_frame,
            width: self.width,
        }
    }
    pub fn key(&self) -> String {
        format!(
            "program:{}:{}:{}:{}:{}:{}:{}:v1",
            self.project_epoch,
            self.if_generation,
            self.timeline_id,
            self.revision,
            self.start_frame,
            self.end_frame,
            self.width
        )
    }
}
pub struct ProgramTask {
    pub snapshot: FrameSnapshot,
    pub query: ProgramQuery,
    pub preview: Preview,
    pub export: Option<ExportOptions>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExportOptions {
    pub quality: u8,
    pub preset: String,
    pub audio: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    pub range: ProgramQuery,
    pub settings: ExportOptions,
}
impl ExportOptions {
    pub fn validate(&self) -> Result<()> {
        if self.quality > 51
            || !vv_media::VideoCodec::X264
                .presets()
                .contains(&self.preset.as_str())
        {
            return Err(ApiError::invalid(
                "Choose x264 CRF 0–51 and a supported speed preset",
            ));
        }
        Ok(())
    }
}
pub type Inputs = Vec<(PathBuf, String)>;
struct MonitorDone<'a>(&'a AtomicBool);
impl Drop for MonitorDone<'_> {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
fn retry_software_render(
    cancel: &AtomicBool,
    mut operation: impl FnMut() -> Result<()>,
) -> Result<()> {
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(ApiError::invalid("Program preparation was canceled"));
        }
        match operation() {
            Err(error)
                if error.1 == "RENDER_BUSY" && started.elapsed() < Duration::from_secs(2) =>
            {
                std::thread::sleep(Duration::from_millis(50))
            }
            result => return result,
        }
    }
}
fn identity(path: &Path) -> Result<String> {
    let m = std::fs::symlink_metadata(path)
        .map_err(|_| ApiError::invalid("Program media is offline"))?;
    if !m.is_file() || m.file_type().is_symlink() {
        return Err(ApiError::invalid(
            "Program media links and special files are refused",
        ));
    }
    Ok(format!(
        "{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec()
    ))
}
pub fn inputs(snapshot: &FrameSnapshot) -> Result<Inputs> {
    let mut pending = vec![snapshot.timeline];
    let mut visited = std::collections::HashSet::new();
    let mut paths = std::collections::BTreeSet::new();
    while let Some(id) = pending.pop() {
        if !visited.insert(id) {
            continue;
        }
        let timeline = snapshot
            .project
            .timelines
            .get(id)
            .ok_or_else(|| ApiError::invalid("A compound timeline is missing"))?;
        for clip in timeline.tracks.iter().flat_map(|t| &t.clips) {
            if let vv_core::ClipSource::Media(id) = &clip.source {
                let media = snapshot
                    .project
                    .media_pool
                    .get(*id)
                    .ok_or_else(|| ApiError::invalid("Timeline media is missing"))?;
                if let Some(child) = media.compound {
                    pending.push(child);
                } else {
                    paths.insert(media.path.clone());
                }
            }
        }
    }
    paths
        .into_iter()
        .map(|path| Ok((path.clone(), identity(&path)?)))
        .collect()
}
pub fn unchanged(inputs: &Inputs) -> bool {
    inputs
        .iter()
        .all(|(path, before)| identity(path).is_ok_and(|now| now == *before))
}
impl ProgramTask {
    pub fn key(&self) -> String {
        match &self.export {
            Some(options) => format!(
                "export:{}:{}",
                self.query.key(),
                serde_json::to_string(options).unwrap()
            ),
            None => self.query.key(),
        }
    }
    pub fn validate(&self) -> Result<()> {
        if let Some(options) = &self.export {
            options.validate()?;
        }
        let tl = &self.snapshot.project.timelines[self.snapshot.timeline];
        let count = self
            .query
            .end_frame
            .checked_sub(self.query.start_frame)
            .ok_or_else(|| ApiError::invalid("Invalid Program range"))?;
        if count <= 0 || self.query.start_frame < 0 || self.query.end_frame > tl.total_frames() {
            return Err(ApiError::invalid(
                "Choose a nonempty range inside the timeline",
            ));
        }
        if self.export.is_none() && count as f64 / tl.fps.as_f64() > 300.0 {
            return Err(ApiError::invalid(
                "Program preview ranges are limited to five minutes",
            ));
        }
        Ok(())
    }
    fn settings(&self, directory: &Path) -> ExportSettings {
        let tl = &self.snapshot.project.timelines[self.snapshot.timeline];
        let mut settings = ExportSettings::new(directory.join("program.mp4"));
        settings.scale_percent = ((u64::from(self.snapshot.size.0) * 100
            / u64::from(tl.resolution.0))
        .clamp(1, 100)) as u32;
        settings.video.preset = "veryfast".into();
        settings.video.quality = 18;
        if let Some(options) = &self.export {
            settings.video.quality = options.quality;
            settings.video.preset = options.preset.clone();
            if !options.audio {
                settings.audio = None;
            }
        }
        settings
    }
    pub fn descriptor(&self, directory: &Path) -> Value {
        let tl = &self.snapshot.project.timelines[self.snapshot.timeline];
        let settings = self.settings(directory);
        let size = settings.output_size(tl.resolution);
        json!({"start_frame":self.query.start_frame,"end_frame":self.query.end_frame,"width":size.0,"height":size.1,"fps":tl.fps,"revision":self.query.revision,"project_epoch":self.query.project_epoch,"generation":self.query.if_generation,"export_settings":self.export,"audio_present":settings.audio_for_timeline(tl).is_some()})
    }
    pub fn generate(
        &self,
        directory: &Path,
        cancel: &Arc<AtomicBool>,
        progress: &Mutex<ExportProgress>,
        inputs: &Inputs,
        durable: bool,
    ) -> Result<()> {
        let done = AtomicBool::new(false);
        let budget = AtomicBool::new(false);
        let storage_pressure = AtomicBool::new(false);
        let mut settings = self.settings(directory);
        if durable {
            settings.output_path = directory.join("rendering.mp4");
        }
        let result = std::thread::scope(|scope| {
            scope.spawn(|| {
                let start = Instant::now();
                while !done.load(Ordering::Relaxed) {
                    if !durable && !crate::source::disk_headroom(directory) {
                        storage_pressure.store(true, Ordering::Relaxed);
                        cancel.store(true, Ordering::Relaxed);
                        break;
                    }
                    if start.elapsed() > Duration::from_secs(600)
                        || std::fs::metadata(&settings.output_path)
                            .is_ok_and(|m| m.len() > 512 * 1024 * 1024)
                    {
                        budget.store(true, Ordering::Relaxed);
                        cancel.store(true, Ordering::Relaxed);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            });
            let _done = MonitorDone(&done);
            retry_software_render(cancel, || {
                self.preview.export_program(
                    &self.snapshot,
                    self.query.end_frame,
                    &settings,
                    progress,
                    cancel,
                )
            })
        });
        if storage_pressure.load(Ordering::Relaxed) {
            return Err(ApiError(
                axum::http::StatusCode::INSUFFICIENT_STORAGE,
                "PREVIEW_STORAGE_PRESSURE",
                "Program preparation stopped to preserve at least 1 GiB of scratch disk space",
            ));
        }
        if budget.load(Ordering::Relaxed) {
            return Err(ApiError(
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "EXPORT_BUDGET_EXCEEDED",
                "Program preparation exceeded its ten-minute or 512 MiB budget",
            ));
        }
        result?;
        if cancel.load(Ordering::Relaxed) {
            return Err(ApiError::invalid("Program preparation was canceled"));
        }
        if !unchanged(inputs) {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Media changed during Program generation",
            ));
        }
        Ok(())
    }
}
pub fn progress_value(progress: &ExportProgress) -> Value {
    json!({"current_frame":progress.current_frame,"total_frames":progress.total_frames,"elapsed_ms":progress.elapsed.as_secs_f64()*1000.0,"startup_ms":progress.startup.map(|d|d.as_secs_f64()*1000.0),"fps":progress.fps(),"decode_fps":progress.decode.fps(),"compose_fps":progress.compose.fps(),"encode_fps":progress.encode.fps(),"compositor":progress.compositor,"encoder":progress.encoder.map(|e|format!("{e:?}"))})
}

#[cfg(test)]
#[path = "tests/program.rs"]
mod tests;
