use crate::{
    error::{ApiError, Result},
    preview::{FrameQuery, FrameSnapshot, Preview},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::File,
    io::Read,
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
    #[serde(default)]
    pub audio_origin_frame: Option<i64>,
    #[serde(default = "width")]
    pub width: u32,
}
fn width() -> u32 {
    960
}
impl ProgramQuery {
    pub fn contains(&self, other: &Self) -> bool {
        self.frame().same_composition(&other.frame())
            && self.audio_origin_frame == other.audio_origin_frame
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
        let key = format!(
            "program:{}:{}:{}:{}:{}:{}:{}:v1",
            self.project_epoch,
            self.if_generation,
            self.timeline_id,
            self.revision,
            self.start_frame,
            self.end_frame,
            self.width
        );
        match self.audio_origin_frame {
            Some(origin) => format!("{key}:audio-origin:{origin}"),
            None => key,
        }
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
    #[serde(default, skip_serializing_if = "crate::codecs::Encoder::is_default")]
    pub encoder: crate::codecs::Encoder,
    #[serde(default, skip_serializing_if = "crate::codecs::Decoder::is_default")]
    pub decoder: crate::codecs::Decoder,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_percent: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_codec: Option<AudioEncoder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_bitrate_kbps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_fast_coder: Option<bool>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AudioEncoder {
    Aac,
    FdkAac,
}
impl AudioEncoder {
    pub fn native(self) -> vv_media::AudioCodec {
        match self {
            Self::Aac => vv_media::AudioCodec::Aac,
            Self::FdkAac => vv_media::AudioCodec::FdkAac,
        }
    }
}
const AUDIO_BITRATES: [u32; 6] = [96, 128, 160, 192, 256, 320];
pub fn audio_catalog() -> Value {
    let codecs = [(AudioEncoder::Aac,"aac","AAC â€“ FFmpeg"),(AudioEncoder::FdkAac,"fdk_aac","AAC â€“ FDK")].map(|(codec,id,label)| {
        // Native availability only looks up the registered encoder, without opening it.
        json!({"id":id,"label":label,"status":if codec.native().is_available(){"available"}else{"unavailable"}})
    });
    json!({"codecs":codecs,"bitrates":AUDIO_BITRATES,"coders":[{"id":"twoloop","label":"Twoloop","fast_coder":false},{"id":"fast","label":"Fast","fast_coder":true}]})
}
pub fn export_scales(resolution: (u32, u32)) -> Value {
    Value::Array(
        ExportSettings::SCALE_CHOICES
            .into_iter()
            .map(|percent| {
                let mut settings = ExportSettings::new(PathBuf::new());
                settings.scale_percent = percent;
                let (width, height) = settings.output_size(resolution);
                json!({"percent":percent,"width":width,"height":height})
            })
            .collect(),
    )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    pub range: ProgramQuery,
    pub settings: ExportOptions,
}
impl ExportOptions {
    pub fn validate(&self) -> Result<()> {
        let codec = self.encoder.native();
        if !vv_media::VideoCodec::choices().contains(&codec)
            || !codec.quality_range().contains(&self.quality)
            || if codec.presets().is_empty() {
                !self.preset.is_empty()
            } else {
                !codec.presets().contains(&self.preset.as_str())
            }
        {
            return Err(ApiError::invalid(
                "Choose native encoder quality and a supported speed preset",
            ));
        }
        if self
            .scale_percent
            .is_some_and(|scale| !ExportSettings::SCALE_CHOICES.contains(&scale))
        {
            return Err(ApiError::invalid(
                "Choose a native export scale of 100, 75, 50 or 25 percent",
            ));
        }
        if self
            .audio_bitrate_kbps
            .is_some_and(|bitrate| !AUDIO_BITRATES.contains(&bitrate))
        {
            return Err(ApiError::invalid(
                "Choose a native audio bitrate of 96, 128, 160, 192, 256 or 320 kbps",
            ));
        }
        if self.audio
            && self
                .audio_codec
                .is_some_and(|codec| !codec.native().is_available())
        {
            return Err(ApiError::invalid(
                "The selected native audio encoder is unavailable in this FFmpeg build",
            ));
        }
        Ok(())
    }
}
fn validate_export_size(native: (u32, u32), output: (u32, u32)) -> Result<()> {
    if [native.0, native.1, output.0, output.1]
        .into_iter()
        .any(|dimension| dimension == 0 || dimension > 8192)
    {
        return Err(ApiError::invalid(
            "Native export dimensions must be between 1 and 8192 pixels",
        ));
    }
    Ok(())
}
fn export_working_bytes(native: (u32, u32), output: (u32, u32)) -> u64 {
    // The native pipeline queues eight decoded layers and eight composed frames.
    // Allow another queue's worth for in-flight decode/composition, plus encoder/audio.
    let pixels = |size: (u32, u32)| u64::from(size.0) * u64::from(size.1);
    pixels(native)
        .saturating_mul(64)
        .saturating_add(pixels(output).saturating_mul(16))
        .saturating_add(256 * 1024 * 1024)
}
fn memory_pressure() -> ApiError {
    ApiError::conflict(
        "EXPORT_MEMORY_PRESSURE",
        "Not enough host or process memory headroom for this native export scale; choose a smaller scale or retry later",
    )
}
fn read_small(path: &Path, limit: u64) -> Option<String> {
    let mut text = String::new();
    File::open(path)
        .ok()?
        .take(limit + 1)
        .read_to_string(&mut text)
        .ok()?;
    (text.len() as u64 <= limit).then_some(text)
}
fn available_host_memory(meminfo: &str) -> Option<u64> {
    meminfo.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        if fields.next() != Some("MemAvailable:") {
            return None;
        }
        let kib = fields.next()?.parse::<u64>().ok()?;
        if fields.next() != Some("kB") || fields.next().is_some() {
            return None;
        }
        kib.checked_mul(1024)
    })
}
fn clean_inactive_file(stat: &str) -> u64 {
    let counter = |name: &str| -> Option<u64> {
        let mut values = stat.lines().filter_map(|line| {
            let mut fields = line.split_whitespace();
            (fields.next()? == name).then_some(fields)
        });
        let mut fields = values.next()?;
        let value = fields.next()?.parse().ok()?;
        (fields.next().is_none() && values.next().is_none()).then_some(value)
    };
    let clean = || -> Option<u64> {
        let inactive = counter("inactive_file")?.min(counter("file")?);
        let protected = [
            "file_dirty",
            "file_writeback",
            "file_mapped",
            "shmem",
            "unevictable",
        ]
        .into_iter()
        .try_fold(0u64, |total, key| total.checked_add(counter(key)?))?;
        Some(inactive.saturating_sub(protected))
    };
    clean().unwrap_or(0)
}
fn cgroup_headroom(root: &Path, membership: &str) -> Option<u64> {
    let relative = membership
        .lines()
        .find_map(|line| line.strip_prefix("0::"))?;
    let relative = Path::new(relative);
    if !relative.is_absolute()
        || relative.components().any(|part| {
            !matches!(
                part,
                std::path::Component::RootDir | std::path::Component::Normal(_)
            )
        })
    {
        return None;
    }
    let mut path = root.join(relative.strip_prefix("/").ok()?);
    let mut available = u64::MAX;
    for _ in 0..64 {
        let max_path = path.join("memory.max");
        let max = match read_small(&max_path, 128) {
            Some(max) => max,
            // The cgroup v2 root need not expose controller files. Host memory
            // admission still applies; missing delegated controller files fail closed.
            None if path == root
                && std::fs::metadata(&max_path)
                    .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
            {
                return Some(available);
            }
            None => return None,
        };
        if max.trim() != "max" {
            let max = max.trim().parse::<u64>().ok()?;
            let current = read_small(&path.join("memory.current"), 128)?
                .trim()
                .parse::<u64>()
                .ok()?;
            // Unmapped clean inactive file pages are reclaimable within the same cap.
            let reclaimable = read_small(&path.join("memory.stat"), 64 * 1024)
                .map_or(0, |stat| clean_inactive_file(&stat))
                .min(current);
            available = available.min(max.saturating_sub(current.saturating_sub(reclaimable)));
        }
        if path == root {
            return Some(available);
        }
        if !path.pop() || !path.starts_with(root) {
            return None;
        }
    }
    None
}
fn memory_fits(required: u64, host: u64, process: u64, reserve: u64) -> bool {
    required
        .checked_add(4 * 1024 * 1024 * 1024)
        .zip(required.checked_add(reserve))
        .is_some_and(|(host_required, process_required)| {
            host >= host_required && process >= process_required
        })
}
fn admit_export_memory(required: u64) -> Result<()> {
    admit_memory(required, 256 * 1024 * 1024, memory_pressure())
}
pub(crate) fn admit_memory(required: u64, reserve: u64, error: ApiError) -> Result<()> {
    let host = read_small(Path::new("/proc/meminfo"), 64 * 1024)
        .as_deref()
        .and_then(available_host_memory);
    let process = read_small(Path::new("/proc/self/cgroup"), 16 * 1024)
        .as_deref()
        .and_then(|membership| cgroup_headroom(Path::new("/sys/fs/cgroup"), membership));
    if host
        .zip(process)
        .is_some_and(|(host, process)| memory_fits(required, host, process, reserve))
    {
        Ok(())
    } else {
        Err(error)
    }
}
fn timeline_decode_pixels(
    project: &vv_core::Project,
    id: vv_core::TimelineId,
    known: &mut std::collections::HashMap<vv_core::TimelineId, u64>,
    visiting: &mut std::collections::HashSet<vv_core::TimelineId>,
) -> u64 {
    if let Some(pixels) = known.get(&id) {
        return *pixels;
    }
    if visiting.len() >= vv_core::MAX_COMPOUND_DEPTH as usize || !visiting.insert(id) {
        return u64::MAX;
    }
    let Some(timeline) = project.timelines.get(id) else {
        return u64::MAX;
    };
    let native = u64::from(timeline.resolution.0) * u64::from(timeline.resolution.1);
    let mut pixels = 0u64;
    for (_, track) in timeline.visible_video_tracks() {
        let mut largest = [0u64; 2];
        for clip in track
            .clips
            .iter()
            .filter(|clip| !clip.disabled || !track.crossings.is_empty())
        {
            let decoded = match clip.source {
                vv_core::ClipSource::Media(media) => {
                    project.media_pool.get(media).map_or(0, |item| {
                        if let Some(child) = item.compound {
                            let child_pixels = project.timelines.get(child).map_or(0, |nested| {
                                u64::from(nested.resolution.0) * u64::from(nested.resolution.1)
                            });
                            timeline_decode_pixels(project, child, known, visiting)
                                .saturating_add(child_pixels)
                        } else if item.meta.has_video {
                            u64::from(item.meta.width) * u64::from(item.meta.height)
                        } else {
                            0
                        }
                    })
                }
                _ => native,
            };
            if decoded > largest[0] {
                largest = [decoded, largest[0]];
            } else {
                largest[1] = largest[1].max(decoded);
            }
        }
        // A crossing may decode both neighbours outside their nominal spans.
        let active = if track.crossings.is_empty() {
            largest[0]
        } else {
            largest[0].saturating_add(largest[1])
        };
        pixels = pixels.saturating_add(active);
    }
    visiting.remove(&id);
    known.insert(id, pixels);
    pixels
}
fn program_working_bytes(snapshot: &FrameSnapshot, output: (u32, u32)) -> u64 {
    let timeline = &snapshot.project.timelines[snapshot.timeline];
    let native = u64::from(timeline.resolution.0) * u64::from(timeline.resolution.1);
    let decoded = timeline_decode_pixels(
        &snapshot.project,
        snapshot.timeline,
        &mut Default::default(),
        &mut Default::default(),
    );
    decoded
        .saturating_mul(64)
        .saturating_add(native.saturating_mul(16))
        .saturating_add((u64::from(output.0) * u64::from(output.1)).saturating_mul(16))
        .saturating_add(stretched_working_bytes(
            &snapshot.project,
            snapshot.timeline,
            &mut Default::default(),
            &mut Default::default(),
        ))
        .saturating_add(128 * 1024 * 1024)
}
fn stretched_working_bytes(
    project: &vv_core::Project,
    id: vv_core::TimelineId,
    known: &mut std::collections::HashMap<vv_core::TimelineId, u64>,
    visiting: &mut std::collections::HashSet<vv_core::TimelineId>,
) -> u64 {
    if let Some(bytes) = known.get(&id) {
        return *bytes;
    }
    if visiting.len() >= vv_core::MAX_COMPOUND_DEPTH as usize || !visiting.insert(id) {
        return u64::MAX;
    }
    let Some(timeline) = project.timelines.get(id) else {
        return u64::MAX;
    };
    if timeline.fps.num <= 0 || timeline.fps.den <= 0 {
        return u64::MAX;
    }
    let mut bytes = 0u64;
    for (_, track) in timeline.audible_tracks() {
        for clip in track
            .clips
            .iter()
            .filter(|clip| !clip.disabled && clip.freeze.is_none())
        {
            let vv_core::ClipSource::Media(media) = clip.source else {
                continue;
            };
            let Some(item) = project.media_pool.get(media) else {
                continue;
            };
            if let Some(child) = item.compound {
                bytes =
                    bytes.saturating_add(stretched_working_bytes(project, child, known, visiting));
            }
            if clip.pitch_correction && !clip.speed().is_one() {
                let speed = clip.speed();
                if speed.num <= 0 || speed.den <= 0 || clip.timeline_len <= 0 {
                    return u64::MAX;
                }
                let numerator =
                    i128::from(clip.timeline_len) * i128::from(timeline.fps.den) * 48_000;
                let denominator = i128::from(timeline.fps.num);
                let output = (numerator + denominator - 1) / denominator + 2;
                let input = (output * i128::from(speed.num) + i128::from(speed.den) - 1)
                    / i128::from(speed.den);
                // Native pitch correction retains the whole result, with filter buffers.
                let charge = u64::try_from((input + output) * 16).unwrap_or(u64::MAX);
                bytes = bytes.saturating_add(charge);
            }
        }
    }
    visiting.remove(&id);
    known.insert(id, bytes);
    bytes
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
            if (!options.encoder.is_default() || !options.decoder.is_default())
                && !self.preview.hardware_enabled()
            {
                return Err(ApiError::invalid(
                    "Hardware codecs are disabled on this preview host",
                ));
            }
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
        if self
            .query
            .audio_origin_frame
            .is_some_and(|origin| origin < 0 || origin > self.query.start_frame)
        {
            return Err(ApiError::invalid(
                "Program audio origin must precede or equal its window start",
            ));
        }
        if self.export.is_some() && self.query.audio_origin_frame.is_some() {
            return Err(ApiError::invalid(
                "Audio continuation origins apply only to Program preview",
            ));
        }
        if self.export.is_none() && count as f64 / tl.fps.as_f64() > 300.0 {
            return Err(ApiError::invalid(
                "Program preview ranges are limited to five minutes",
            ));
        }
        Ok(())
    }
    pub fn admit_memory(&self) -> Result<()> {
        if self
            .export
            .as_ref()
            .is_some_and(|options| options.scale_percent.is_some())
        {
            let resolution = self.snapshot.project.timelines[self.snapshot.timeline].resolution;
            validate_export_size(resolution, resolution)?;
            let output = self.settings(Path::new("")).output_size(resolution);
            validate_export_size(resolution, output)?;
            admit_export_memory(export_working_bytes(resolution, output))?;
        }
        let output = self
            .settings(Path::new(""))
            .output_size(self.snapshot.project.timelines[self.snapshot.timeline].resolution);
        admit_memory(
            program_working_bytes(&self.snapshot, output),
            64 * 1024 * 1024,
            ApiError::conflict(
                "PROGRAM_MEMORY_PRESSURE",
                "Not enough host or process memory headroom for the native composition; choose fewer layers or retry later",
            ),
        )?;
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
        if self.export.is_none() {
            settings.audio_render_origin = self.query.audio_origin_frame;
        }
        if let Some(options) = &self.export {
            if let Some(scale) = options.scale_percent {
                settings.scale_percent = scale;
            }
            settings.video.codec = options.encoder.native();
            settings.hw_decode = options.decoder.devices(&self.preview);
            settings.video.quality = options.quality;
            settings.video.preset = options.preset.clone();
            if let Some(audio) = &mut settings.audio {
                if let Some(codec) = options.audio_codec {
                    audio.codec = codec.native();
                }
                if let Some(bitrate) = options.audio_bitrate_kbps {
                    audio.bitrate_kbps = bitrate;
                }
                if let Some(fast) = options.audio_fast_coder {
                    audio.fast_coder = fast;
                }
            }
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
        let mut descriptor = json!({"start_frame":self.query.start_frame,"end_frame":self.query.end_frame,"width":size.0,"height":size.1,"fps":tl.fps,"revision":self.query.revision,"project_epoch":self.query.project_epoch,"generation":self.query.if_generation,"export_settings":self.export,"audio_present":settings.audio_for_timeline(tl).is_some()});
        if let Some(origin) = self.query.audio_origin_frame {
            descriptor["audio_origin_frame"] = json!(origin);
        }
        descriptor
    }
    pub fn generate(
        &self,
        directory: &Path,
        cancel: &Arc<AtomicBool>,
        progress: &Mutex<ExportProgress>,
        inputs: &Inputs,
        durable: bool,
    ) -> Result<()> {
        if !unchanged(inputs) {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Media changed before Program generation",
            ));
        }
        // A queued job must still fit when the sole media worker starts it.
        self.admit_memory()?;
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
    progress_value_for(progress, crate::codecs::Decoder::Software)
}
pub fn progress_value_for(progress: &ExportProgress, requested: crate::codecs::Decoder) -> Value {
    let decoders: Vec<_> = progress.decoders.iter().map(|device| match device {
        None => json!({"id":"software","label":"Software (CPU)"}),
        Some(vv_media::HwDevice::Cuda) => json!({"id":"nvdec","label":"NVIDIA NVDEC"}),
        Some(vv_media::HwDevice::Vulkan(name)) => json!({"id":"vulkan","label":format!("Vulkan ({})",name.as_deref().unwrap_or("default device"))}),
        Some(vv_media::HwDevice::VideoToolbox) => json!({"id":"videotoolbox","label":"Apple VideoToolbox"}),
    }).collect();
    json!({"current_frame":progress.current_frame,"total_frames":progress.total_frames,"elapsed_ms":progress.elapsed.as_secs_f64()*1000.0,"startup_ms":progress.startup.map(|d|d.as_secs_f64()*1000.0),"fps":progress.fps(),"decode_fps":progress.decode.fps(),"compose_fps":progress.compose.fps(),"encode_fps":progress.encode.fps(),"compositor":progress.compositor,"encoder":progress.encoder.map(|e|format!("{e:?}")),"decoders":decoders,"decoder_fallback":!requested.is_default() && progress.decoders.iter().any(Option::is_none)})
}

#[cfg(test)]
#[path = "tests/program.rs"]
mod tests;
