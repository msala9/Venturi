use crate::{
    error::{ApiError, Result},
    preview::encode_png,
    program::{self, Inputs, ProgramQuery, ProgramTask},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    fs::File,
    io::Write,
    os::unix::{
        fs::{DirBuilderExt, FileExt, MetadataExt},
        io::AsRawFd,
    },
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use vv_media::proxy::ProxyQuality;

const MAX_JOB_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceQuery {
    pub project_epoch: String,
}
pub struct SourceSpec {
    pub file: File,
    pub epoch: String,
    pub media_id: String,
    pub meta: vv_core::MediaMeta,
}
impl SourceSpec {
    fn identity(&self) -> Result<String> {
        file_identity(&self.file)
    }
}
pub(crate) fn file_identity(file: &File) -> Result<String> {
    let m = file.metadata().map_err(|_| ApiError::io())?;
    Ok(format!(
        "{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec()
    ))
}
struct Job {
    id: String,
    key: String,
    state: &'static str,
    progress: u64,
    error: Option<&'static str>,
    directory: PathBuf,
    cancel: Arc<AtomicBool>,
    bytes: u64,
    export: Option<Arc<Mutex<vv_session::export::ExportProgress>>>,
    descriptor: Option<Value>,
    inputs: Inputs,
    source_asset: Option<&'static str>,
    export_epoch: Option<String>,
}
impl Job {
    fn value(&self) -> Value {
        let progress = self
            .export
            .as_ref()
            .map(|p| program::progress_value(&p.lock().unwrap()));
        json!({"id":self.id,"state":self.state,"frames":self.progress,"error":self.error,"program":self.descriptor,"progress":progress,"source_asset":self.source_asset})
    }
}
#[derive(Clone)]
pub struct MediaJobs {
    root: Arc<PathBuf>,
    jobs: Arc<Mutex<VecDeque<Job>>>,
    send: mpsc::SyncSender<(String, Work)>,
}
enum Work {
    Source(Box<SourceSpec>, ProxyQuality),
    Program(Box<ProgramTask>),
}
impl MediaJobs {
    pub fn software_lock_path(&self) -> PathBuf {
        self.root.join("software.lock")
    }
    pub fn start() -> std::io::Result<Self> {
        let root = std::env::temp_dir().join(format!(
            "venturi-web-media-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::DirBuilder::new().mode(0o700).create(&root)?;
        let worker_root = root.clone();
        let jobs = Arc::new(Mutex::new(VecDeque::<Job>::new()));
        let owned = jobs.clone();
        let (send, receive) = mpsc::sync_channel::<(String, Work)>(1);
        std::thread::spawn(move || {
            while let Ok((id, work)) = receive.recv() {
                let (directory, cancel, progress, inputs) = {
                    let mut jobs = owned.lock().unwrap();
                    let Some(job) = jobs.iter_mut().find(|j| j.id == id) else {
                        continue;
                    };
                    job.state = "running";
                    (
                        job.directory.clone(),
                        job.cancel.clone(),
                        job.export.clone(),
                        job.inputs.clone(),
                    )
                };
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match work {
                        Work::Source(spec, quality) => {
                            generate(&spec, &directory, quality, &cancel, |frames| {
                                if let Some(job) =
                                    owned.lock().unwrap().iter_mut().find(|j| j.id == id)
                                {
                                    job.progress = frames;
                                }
                            })
                        }
                        Work::Program(task) => {
                            task.generate(&directory, &cancel, progress.as_ref().unwrap(), &inputs)
                        }
                    }))
                    .unwrap_or_else(|_| Err(ApiError::invalid("Native source generation failed")));
                let mut jobs = owned.lock().unwrap();
                if let Some(job) = jobs.iter_mut().find(|j| j.id == id) {
                    match result {
                        Ok(()) => {
                            job.state = "ready";
                            job.bytes = directory_bytes(&directory);
                        }
                        Err(error) => {
                            job.state = if cancel.load(Ordering::Relaxed) {
                                "canceled"
                            } else {
                                "failed"
                            };
                            job.error = Some(error.1);
                            let _ = std::fs::remove_dir_all(&directory);
                        }
                    }
                }
                trim(&mut jobs);
            }
            let _ = std::fs::remove_dir_all(worker_root);
        });
        Ok(Self {
            root: Arc::new(root),
            jobs,
            send,
        })
    }
    pub fn prepare(&self, spec: SourceSpec, quality: &str) -> Result<Value> {
        let quality = ProxyQuality::from_id(quality)
            .ok_or_else(|| ApiError::invalid("Choose low, medium or high proxy quality"))?;
        let seconds = spec.meta.duration_frames as f64 / spec.meta.fps.as_f64();
        if (!spec.meta.is_image() && (!seconds.is_finite() || seconds <= 0.0 || seconds > 600.0))
            || spec.meta.width == 0 && spec.meta.has_video
            || spec.meta.height == 0 && spec.meta.has_video
            || spec.meta.width > 8192
            || spec.meta.height > 8192
        {
            return Err(ApiError::invalid(
                "Source preview currently supports regular media up to ten minutes and 8192 pixels per dimension",
            ));
        }
        let source_asset = if spec.meta.is_image() {
            image_asset(&spec.file)?
        } else {
            "source.mp4"
        };
        let key = format!(
            "{}:{}:{}:v1:{}",
            spec.epoch,
            spec.media_id,
            spec.identity()?,
            quality.id()
        );
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs
            .iter()
            .find(|j| j.key == key && !matches!(j.state, "failed" | "canceled"))
        {
            return Ok(job.value());
        }
        trim(&mut jobs);
        if jobs.len() >= 32 {
            return Err(ApiError::conflict(
                "SOURCE_BUSY",
                "The source cache is full; cancel a pending job",
            ));
        }
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let directory = self.root.join(&id);
        std::fs::create_dir(&directory).map_err(|_| ApiError::io())?;
        jobs.push_back(Job {
            id: id.clone(),
            key,
            state: "queued",
            progress: 0,
            error: None,
            directory: directory.clone(),
            cancel: Arc::new(AtomicBool::new(false)),
            bytes: 0,
            export: None,
            descriptor: None,
            inputs: vec![],
            source_asset: Some(source_asset),
            export_epoch: None,
        });
        if self
            .send
            .try_send((id.clone(), Work::Source(Box::new(spec), quality)))
            .is_err()
        {
            jobs.pop_back();
            let _ = std::fs::remove_dir(&directory);
            return Err(ApiError::conflict(
                "SOURCE_BUSY",
                "One source job is running and one is pending",
            ));
        }
        Ok(jobs.back().unwrap().value())
    }
    pub fn prepare_program(&self, task: ProgramTask) -> Result<Value> {
        task.validate()?;
        let key = task.key();
        let inputs = program::inputs(&task.snapshot)?;
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter().find(|j| {
            j.key == key && j.inputs == inputs && !matches!(j.state, "failed" | "canceled")
        }) {
            return Ok(job.value());
        }
        trim(&mut jobs);
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let directory = self.root.join(&id);
        std::fs::create_dir(&directory).map_err(|_| ApiError::io())?;
        let descriptor = task.descriptor(&directory);
        let progress = vv_session::export::ExportProgress {
            total_frames: task.query.end_frame - task.query.start_frame,
            ..Default::default()
        };
        jobs.push_back(Job {
            id: id.clone(),
            key,
            state: "queued",
            progress: 0,
            error: None,
            directory: directory.clone(),
            cancel: Arc::new(AtomicBool::new(false)),
            bytes: 0,
            export: Some(Arc::new(Mutex::new(progress))),
            descriptor: Some(descriptor),
            inputs,
            source_asset: None,
            export_epoch: task
                .export
                .as_ref()
                .map(|_| task.query.project_epoch.clone()),
        });
        if self
            .send
            .try_send((id, Work::Program(Box::new(task))))
            .is_err()
        {
            jobs.pop_back();
            let _ = std::fs::remove_dir(directory);
            return Err(ApiError::conflict(
                "MEDIA_BUSY",
                "One media job is running and one is pending",
            ));
        }
        Ok(jobs.back().unwrap().value())
    }
    pub fn program_status(&self, id: &str, query: &ProgramQuery, cancel: bool) -> Result<Value> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && j.key == query.key())
            .ok_or_else(ApiError::missing)?;
        if !cancel && !program::unchanged(&job.inputs) {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Media changed since Program preparation",
            ));
        }
        if cancel && matches!(job.state, "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
        }
        Ok(job.value())
    }
    pub fn export_status(&self, id: &str, epoch: &str, cancel: bool) -> Result<Value> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && j.export_epoch.as_deref() == Some(epoch))
            .ok_or_else(ApiError::missing)?;
        if cancel && matches!(job.state, "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
        }
        Ok(job.value())
    }
    pub fn export_asset(&self, id: &str, epoch: &str) -> Result<File> {
        let jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter()
            .find(|j| j.id == id && j.export_epoch.as_deref() == Some(epoch))
            .ok_or_else(ApiError::missing)?;
        if job.state != "ready" {
            return Err(ApiError::conflict(
                "EXPORT_NOT_READY",
                "Wait for export completion",
            ));
        }
        File::open(job.directory.join("program.mp4")).map_err(|_| ApiError::missing())
    }
    pub fn program_asset(&self, id: &str, query: &ProgramQuery) -> Result<File> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && j.key == query.key())
            .ok_or_else(ApiError::missing)?;
        if job.state != "ready" {
            return Err(ApiError::conflict(
                "PROGRAM_NOT_READY",
                "Wait for composed preview preparation",
            ));
        }
        if !program::unchanged(&job.inputs) {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Media changed since Program preparation",
            ));
        }
        File::open(job.directory.join("program.mp4")).map_err(|_| ApiError::missing())
    }
    fn authorized<'a>(
        jobs: &'a mut VecDeque<Job>,
        id: &str,
        spec: &SourceSpec,
    ) -> Result<&'a mut Job> {
        let prefix = format!("{}:{}:{}:v1:", spec.epoch, spec.media_id, spec.identity()?);
        jobs.iter_mut()
            .find(|j| j.id == id && j.key.starts_with(&prefix))
            .ok_or_else(ApiError::missing)
    }
    pub fn status(&self, id: &str, spec: &SourceSpec, cancel: bool) -> Result<Value> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = Self::authorized(&mut jobs, id, spec)?;
        if cancel && matches!(job.state, "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
        }
        Ok(job.value())
    }
    pub fn asset(&self, id: &str, spec: &SourceSpec, name: &str) -> Result<File> {
        if ![
            "source.mp4",
            "source.png",
            "source.jpg",
            "source.webp",
            "thumb.png",
            "waveform.json",
        ]
        .contains(&name)
        {
            return Err(ApiError::missing());
        }
        let mut jobs = self.jobs.lock().unwrap();
        let job = Self::authorized(&mut jobs, id, spec)?;
        if job.state != "ready" {
            return Err(ApiError::conflict(
                "SOURCE_NOT_READY",
                "Wait for the source job to finish",
            ));
        }
        File::open(job.directory.join(name)).map_err(|_| ApiError::missing())
    }
}
fn trim(jobs: &mut VecDeque<Job>) {
    while jobs.len() >= 24 || jobs.iter().map(|j| j.bytes).sum::<u64>() > MAX_CACHE_BYTES {
        let Some(i) = jobs
            .iter()
            .position(|j| !matches!(j.state, "queued" | "running"))
        else {
            break;
        };
        if let Some(job) = jobs.remove(i) {
            let _ = std::fs::remove_dir_all(job.directory);
        }
    }
}
fn directory_bytes(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
fn generate(
    spec: &SourceSpec,
    directory: &Path,
    quality: ProxyQuality,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<()> {
    if spec.meta.is_image() {
        return generate_image(spec, directory, cancel);
    }
    let identity = spec.identity()?;
    let path = PathBuf::from(format!("/proc/self/fd/{}", spec.file.as_raw_fd()));
    let started = Instant::now();
    let actual = vv_media::probe_media(&path)
        .map_err(|_| ApiError::invalid("Source is offline or unreadable"))?;
    let seconds = actual.duration_frames as f64 / actual.fps.as_f64();
    if !seconds.is_finite()
        || seconds <= 0.0
        || seconds > 600.0
        || actual.width > 8192
        || actual.height > 8192
        || actual.duration_frames != spec.meta.duration_frames
        || actual.fps != spec.meta.fps
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Reimport changed media before preparing a source preview",
        ));
    }
    vv_media::browser_proxy::generate(&path, directory, quality, |frames| {
        if frames > 0 {
            progress(frames);
        }
        !cancel.load(Ordering::Relaxed)
            && started.elapsed() < Duration::from_secs(600)
            && directory_bytes(directory) < MAX_JOB_BYTES
    })
    .map_err(|_| {
        ApiError::invalid("Source generation failed, canceled or exceeded its resource budget")
    })?;
    if spec.meta.has_video {
        let thumb = vv_media::thumbnail::generate_thumbnail_bounded(
            &path,
            spec.meta.duration_frames as f64 / spec.meta.fps.as_f64(),
            256,
        )
        .map_err(|_| ApiError::invalid("Thumbnail generation failed"))?;
        std::fs::write(
            directory.join("thumb.png"),
            encode_png(&thumb.rgba, (thumb.width, thumb.height))?,
        )
        .map_err(|_| ApiError::io())?;
    }
    if spec.meta.has_audio {
        let seconds = spec.meta.duration_frames as f64 / spec.meta.fps.as_f64();
        let waveforms = vv_media::waveform::analyze_waveforms(
            &path,
            &[0],
            vv_media::recommended_num_peaks(seconds),
            || !cancel.load(Ordering::Relaxed) && started.elapsed() < Duration::from_secs(600),
        )
        .map_err(|_| ApiError::invalid("Waveform generation failed"))?;
        if let Some(waveform) = &waveforms[0] {
            std::fs::write(
                directory.join("waveform.json"),
                json!({"duration_seconds":waveform.audio_duration_secs,"peaks":waveform.peaks})
                    .to_string(),
            )
            .map_err(|_| ApiError::io())?;
        }
    }
    for name in ["video.mp4", "audio.m4a"] {
        let _ = std::fs::remove_file(directory.join(name));
    }
    if cancel.load(Ordering::Relaxed)
        || spec.identity()? != identity
        || directory_bytes(directory) > MAX_JOB_BYTES
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Source changed or job was canceled",
        ));
    }
    Ok(())
}

fn image_asset(file: &File) -> Result<&'static str> {
    let mut signature = [0; 12];
    let read = file
        .read_at(&mut signature, 0)
        .map_err(|_| ApiError::io())?;
    if read >= 8 && signature[..8] == *b"\x89PNG\r\n\x1a\n" {
        Ok("source.png")
    } else if read >= 3 && signature[..3] == [0xff, 0xd8, 0xff] {
        Ok("source.jpg")
    } else if read == 12 && &signature[..4] == b"RIFF" && &signature[8..12] == b"WEBP" {
        Ok("source.webp")
    } else {
        Err(ApiError::invalid(
            "Source still preview currently supports PNG, JPEG and WebP",
        ))
    }
}
fn generate_image(spec: &SourceSpec, directory: &Path, cancel: &AtomicBool) -> Result<()> {
    let before = spec.identity()?;
    if spec.file.metadata().map_err(|_| ApiError::io())?.len() > MAX_JOB_BYTES {
        return Err(ApiError::invalid("Image exceeds the 512 MiB source budget"));
    }
    let path = directory.join(image_asset(&spec.file)?);
    let mut output = File::create(&path).map_err(|_| ApiError::io())?;
    let mut offset = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) || offset > MAX_JOB_BYTES {
            return Err(ApiError::invalid(
                "Image preparation canceled or exceeded its budget",
            ));
        }
        let read = spec
            .file
            .read_at(&mut buffer, offset)
            .map_err(|_| ApiError::io())?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|_| ApiError::io())?;
        offset += read as u64;
    }
    drop(output);
    let actual =
        vv_media::probe_image(&path).map_err(|_| ApiError::invalid("Image is unreadable"))?;
    if actual.width != spec.meta.width || actual.height != spec.meta.height {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Reimport changed image dimensions",
        ));
    }
    let thumb = vv_media::thumbnail::generate_thumbnail_bounded(&path, 0.0, 256)
        .map_err(|_| ApiError::invalid("Image thumbnail generation failed"))?;
    std::fs::write(
        directory.join("thumb.png"),
        encode_png(&thumb.rgba, (thumb.width, thumb.height))?,
    )
    .map_err(|_| ApiError::io())?;
    if spec.identity()? != before
        || cancel.load(Ordering::Relaxed)
        || directory_bytes(directory) > MAX_JOB_BYTES
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Image changed or preparation canceled",
        ));
    }
    Ok(())
}

fn byte_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let (left, right) = value.strip_prefix("bytes=")?.split_once('-')?;
    if !left
        .bytes()
        .chain(right.bytes())
        .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    if size == 0 || value.contains(',') {
        return None;
    }
    if left.is_empty() {
        let suffix = right.parse::<u64>().ok()?;
        return (suffix > 0).then_some((size.saturating_sub(suffix), size - 1));
    }
    let start = left.parse::<u64>().ok()?;
    let end = if right.is_empty() {
        size - 1
    } else {
        right.parse::<u64>().ok()?.min(size - 1)
    };
    (start <= end && start < size).then_some((start, end))
}

pub async fn stream_file(
    file: File,
    mime: &'static str,
    key: &str,
    headers: &axum::http::HeaderMap,
) -> Result<axum::response::Response> {
    use axum::{
        body::Body,
        http::{StatusCode, header},
        response::IntoResponse,
    };
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let size = file.metadata().map_err(|_| ApiError::io())?.len();
    let etag = format!("\"{key}-{mime}-{size}\"");
    let range = headers.get(header::RANGE).filter(|_| {
        headers
            .get(header::IF_RANGE)
            .is_none_or(|v| v.to_str().ok() == Some(&etag))
    });
    let bounds = match range {
        Some(value) => match value
            .to_str()
            .ok()
            .and_then(|value| byte_range(value, size))
        {
            Some(bounds) => Some(bounds),
            None => {
                let mut response = ApiError(
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    "INVALID_RANGE",
                    "Only one satisfiable byte range is supported",
                )
                .into_response();
                response.headers_mut().insert(
                    header::CONTENT_RANGE,
                    format!("bytes */{size}").parse().unwrap(),
                );
                return Ok(response);
            }
        },
        None => None,
    };
    let (start, length) = bounds.map(|(a, b)| (a, b - a + 1)).unwrap_or((0, size));
    let mut file = tokio::fs::File::from_std(file);
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|_| ApiError::io())?;
    let mut response =
        Body::from_stream(tokio_util::io::ReaderStream::new(file.take(length))).into_response();
    *response.status_mut() = if bounds.is_some() {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let out = response.headers_mut();
    out.insert(header::CONTENT_TYPE, mime.parse().unwrap());
    out.insert(header::CONTENT_LENGTH, length.into());
    out.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    out.insert(header::ETAG, etag.parse().unwrap());
    if let Some((a, b)) = bounds {
        out.insert(
            header::CONTENT_RANGE,
            format!("bytes {a}-{b}/{size}").parse().unwrap(),
        );
    }
    Ok(response)
}

#[cfg(test)]
#[path = "tests/source.rs"]
mod tests;
