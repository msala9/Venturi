use crate::error::{ApiError, Result};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::oneshot;
use vv_core::{Project, TimelineId};
use vv_render::{Compositor, wgpu};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameQuery {
    pub timeline_id: String,
    pub project_epoch: String,
    pub if_generation: String,
    pub revision: String,
    pub frame: i64,
    #[serde(default = "default_width")]
    pub width: u32,
}
fn default_width() -> u32 {
    960
}
pub struct FrameSnapshot {
    pub project: Project,
    pub timeline: TimelineId,
    pub query: FrameQuery,
    pub size: (u32, u32),
}
struct GpuPermit<'a> {
    // Unlock globally before waking another local GPU worker.
    _global: File,
    _local: std::sync::MutexGuard<'a, ()>,
    device: Arc<wgpu::Device>,
    poll_failed: &'a AtomicBool,
}
struct ProgramLease<'a>(&'a AtomicUsize);
impl Drop for ProgramLease<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
impl Drop for GpuPermit<'_> {
    fn drop(&mut self) {
        if self
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .is_err()
        {
            self.poll_failed.store(true, Ordering::Relaxed);
        }
    }
}
struct Job {
    snapshot: FrameSnapshot,
    reply: oneshot::Sender<Result<Vec<u8>>>,
}
#[derive(Clone, Copy)]
enum AdapterChoice {
    Amd(u32),
    Software,
}
#[derive(Default)]
struct Queue {
    pending: Mutex<Option<Job>>,
    wake: Condvar,
}
impl Queue {
    fn replace(&self, job: Job) {
        *self.pending.lock().unwrap() = Some(job);
        self.wake.notify_one();
    }
    fn next(&self, idle: std::time::Duration) -> Option<Job> {
        let mut pending = self.pending.lock().unwrap();
        loop {
            if let Some(job) = pending.take() {
                return Some(job);
            }
            let (next, timeout) = self.wake.wait_timeout(pending, idle).unwrap();
            pending = next;
            if timeout.timed_out() && pending.is_none() {
                return None;
            }
        }
    }
}
#[derive(Clone)]
pub struct Preview {
    queue: Option<Arc<Queue>>,
    diagnostic: Value,
    rendered: Arc<AtomicBool>,
    config: Option<(AdapterChoice, PathBuf)>,
    gpu_gate: Arc<Mutex<()>>,
    resident: Arc<AtomicBool>,
    active_programs: Arc<AtomicUsize>,
}
impl Preview {
    pub fn disabled() -> Self {
        Self {
            queue: None,
            diagnostic: json!({"available":false,"reason":"Start with --gpu-device to enable a verified AMD Vulkan adapter"}),
            rendered: Arc::new(AtomicBool::new(false)),
            config: None,
            gpu_gate: Arc::new(Mutex::new(())),
            resident: Arc::new(AtomicBool::new(false)),
            active_programs: Arc::new(AtomicUsize::new(0)),
        }
    }
    pub fn start(device: u32, lock_path: &Path) -> Self {
        Self::start_adapter(AdapterChoice::Amd(device), lock_path)
    }
    pub fn start_software(lock_path: &Path) -> Self {
        Self::start_adapter(AdapterChoice::Software, lock_path)
    }
    fn start_adapter(device: AdapterChoice, lock_path: &Path) -> Self {
        let queue = Arc::new(Queue::default());
        let worker = queue.clone();
        let path = lock_path.to_owned();
        let config = Some((device, path.clone()));
        let gpu_gate = Arc::new(Mutex::new(()));
        let worker_gate = gpu_gate.clone();
        let resident = Arc::new(AtomicBool::new(false));
        let worker_resident = resident.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let rendered = Arc::new(AtomicBool::new(false));
        let rendered_worker = rendered.clone();
        std::thread::spawn(move || {
            let initialized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _local = worker_gate.lock().unwrap();
                let _lock = render_lock(&path, device)?;
                create_compositor(device)
            }))
            .unwrap_or_else(|_| Err(unavailable()));
            let (compositor, diagnostic) = match initialized {
                Ok(value) => value,
                Err(error) => {
                    let _ = tx.send(Err(error));
                    return;
                }
            };
            if tx.send(Ok(diagnostic)).is_err() {
                return;
            }
            let mut compositor = Some(compositor);
            worker_resident.store(true, Ordering::Relaxed);
            let mut cache: VecDeque<(String, Vec<u8>)> = VecDeque::new();
            let mut bytes = 0;
            loop {
                let Some(job) = worker.next(std::time::Duration::from_secs(2)) else {
                    compositor = None;
                    worker_resident.store(false, Ordering::Relaxed);
                    continue;
                };
                if job.reply.is_closed() {
                    continue;
                }
                let snapshot = job.snapshot;
                let key = format!(
                    "{}:{}:{}:{}:{}:{}x{}",
                    snapshot.query.project_epoch,
                    snapshot.query.if_generation,
                    snapshot.query.timeline_id,
                    snapshot.query.revision,
                    snapshot.query.frame,
                    snapshot.size.0,
                    snapshot.size.1
                );
                if let Some((_, data)) = cache.iter().find(|(candidate, _)| candidate == &key) {
                    let _ = job.reply.send(Ok(data.clone()));
                    continue;
                }
                let poll_failed = AtomicBool::new(false);
                let mut result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let local = worker_gate.lock().unwrap_or_else(|p| p.into_inner());
                    let global = render_lock(&path, device)?;
                    if compositor.is_none() {
                        compositor = Some(create_compositor(device)?.0);
                        worker_resident.store(true, Ordering::Relaxed);
                    }
                    let compositor = compositor.as_mut().unwrap();
                    let permit = GpuPermit {
                        _global: global,
                        _local: local,
                        device: compositor.device().clone(),
                        poll_failed: &poll_failed,
                    };
                    compositor.set_precision(snapshot.project.precision);
                    let rgba = vv_session::export::render_frame_rgba(
                        &snapshot.project,
                        snapshot.timeline,
                        snapshot.query.frame,
                        snapshot.size,
                        compositor,
                    )
                    .map_err(|_| {
                        ApiError(
                            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                            "FRAME_FAILED",
                            "Native frame rendering failed; check offline media",
                        )
                    })?;
                    drop(permit);
                    encode_png(&rgba, snapshot.size)
                }))
                .unwrap_or_else(|_| Err(unavailable()));
                if poll_failed.load(Ordering::Relaxed) {
                    result = Err(unavailable());
                }
                if result.is_err() {
                    compositor = None;
                    worker_resident.store(false, Ordering::Relaxed);
                }
                if let Ok(data) = &result {
                    rendered_worker.store(true, Ordering::Relaxed);
                    while bytes + data.len() > 16 * 1024 * 1024 || cache.len() >= 8 {
                        if let Some((_, old)) = cache.pop_front() {
                            bytes -= old.len();
                        } else {
                            break;
                        }
                    }
                    if data.len() <= 16 * 1024 * 1024 {
                        bytes += data.len();
                        cache.push_back((key, data.clone()));
                    }
                }
                let _ = job.reply.send(result);
            }
        });
        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(Ok(diagnostic)) => Self {
                queue: Some(queue),
                diagnostic,
                rendered,
                config,
                gpu_gate,
                resident,
                active_programs: Arc::new(AtomicUsize::new(0)),
            },
            _ => Self {
                queue: None,
                diagnostic: json!({"available":false,"reason":"Selected Vulkan compositor initialization failed or render lock is busy"}),
                rendered,
                config: None,
                gpu_gate,
                resident,
                active_programs: Arc::new(AtomicUsize::new(0)),
            },
        }
    }
    pub fn available(&self) -> bool {
        self.queue.is_some()
    }
    pub fn export_program(
        &self,
        snapshot: &FrameSnapshot,
        end: i64,
        settings: &vv_session::export::ExportSettings,
        progress: &Mutex<vv_session::export::ExportProgress>,
        cancel: &AtomicBool,
    ) -> Result<()> {
        use vv_session::export::ExportError;
        let (device, path) = self.config.as_ref().ok_or_else(unavailable)?;
        let program_lock = render_lock(path, *device)?;
        self.active_programs.fetch_add(1, Ordering::Relaxed);
        let _active = ProgramLease(&self.active_programs);
        let poll_failed = AtomicBool::new(false);
        let failed = |error: ApiError| ExportError::Failed(error.2.into());
        let complete = |compositor: &Compositor| {
            compositor
                .device()
                .poll(wgpu::PollType::wait_indefinitely())
                .map(|_| ())
                .map_err(|error| ExportError::Failed(error.to_string()))
        };
        let result = vv_session::export::export_timeline_with_gpu(
            &snapshot.project,
            snapshot.timeline,
            settings,
            snapshot.query.frame..end,
            progress,
            cancel,
            || {
                let _local = self.gpu_gate.lock().unwrap_or_else(|p| p.into_inner());
                let _global = program_lock
                    .try_clone()
                    .map_err(|_| failed(unavailable()))?;
                let (mut compositor, _) = create_compositor(*device).map_err(failed)?;
                compositor.set_precision(snapshot.project.precision);
                complete(&compositor)?;
                Ok(compositor)
            },
            |compositor| {
                let local = self.gpu_gate.lock().unwrap_or_else(|p| p.into_inner());
                let global = program_lock
                    .try_clone()
                    .map_err(|_| failed(unavailable()))?;
                Ok(GpuPermit {
                    _global: global,
                    _local: local,
                    device: compositor.device().clone(),
                    poll_failed: &poll_failed,
                })
            },
            2,
        );
        if poll_failed.load(Ordering::Relaxed) {
            return Err(unavailable());
        }
        if result.is_ok() {
            self.rendered.store(true, Ordering::Relaxed);
        }
        result.map_err(|_| ApiError::invalid("Native composition failed or was canceled"))
    }
    pub fn diagnostic(&self) -> Value {
        let mut value = self.diagnostic.clone();
        value["frame_rendered"] = json!(self.rendered.load(Ordering::Relaxed));
        value["exact_context_resident"] = json!(self.resident.load(Ordering::Relaxed));
        value["active_programs"] = json!(self.active_programs.load(Ordering::Relaxed));
        value["resident"] = json!(
            self.resident.load(Ordering::Relaxed)
                || self.active_programs.load(Ordering::Relaxed) > 0
        );
        value
    }
    pub async fn frame(&self, snapshot: FrameSnapshot) -> Result<Vec<u8>> {
        let queue = self.queue.as_ref().ok_or_else(unavailable)?;
        let (tx, rx) = oneshot::channel();
        queue.replace(Job {
            snapshot,
            reply: tx,
        });
        rx.await.map_err(|_| {
            ApiError::conflict("SEEK_SUPERSEDED", "A newer seek replaced this request")
        })?
    }
}
fn unavailable() -> ApiError {
    ApiError(
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "GPU_UNAVAILABLE",
        "The selected native Vulkan compositor is unavailable",
    )
}
fn gpu_lock(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|_| unavailable())?;
    rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive).map_err(
        |_| {
            ApiError(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "GPU_BUSY",
                "Another workload holds the GPU lock",
            )
        },
    )?;
    Ok(file)
}
fn render_lock(path: &Path, choice: AdapterChoice) -> Result<File> {
    gpu_lock(path).map_err(|error| match choice {
        AdapterChoice::Software if error.1 == "GPU_BUSY" => ApiError(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "RENDER_BUSY",
            "The software compositor is preparing another native job",
        ),
        _ => error,
    })
}
pub fn software_environment() -> std::result::Result<(), String> {
    let driver = std::env::var_os("VK_DRIVER_FILES").ok_or(
        "Use scripts/venturi-web.sh --software-preview to select the CPU-only Vulkan driver",
    )?;
    let driver = Path::new(&driver);
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(driver).map_err(|_| "Mesa lavapipe manifest is unavailable")?,
    )
    .map_err(|_| "Invalid lavapipe driver manifest")?;
    let threads = std::env::var("LP_NUM_THREADS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let status = std::fs::read_to_string("/proc/self/status")
        .map_err(|_| "Cannot verify unprivileged software rendering")?;
    software_settings(driver, &manifest, threads, &status)
}
fn software_settings(
    driver: &Path,
    manifest: &Value,
    threads: u32,
    status: &str,
) -> std::result::Result<(), String> {
    let unprivileged = status
        .lines()
        .find(|l| l.starts_with("Uid:"))
        .and_then(|line| {
            let ids = line
                .split_whitespace()
                .skip(1)
                .map(str::parse::<u32>)
                .collect::<std::result::Result<Vec<_>, _>>()
                .ok()?;
            Some(ids.len() == 4 && ids[0] != 0 && ids.iter().all(|id| *id == ids[0]))
        })
        .unwrap_or(false)
        && status
            .lines()
            .find(|l| l.starts_with("Gid:"))
            .is_some_and(|line| {
                let ids = line.split_whitespace().skip(1).collect::<Vec<_>>();
                ids.len() == 4 && ids.iter().all(|id| *id == ids[0])
            })
        && status.lines().any(|line| {
            line.strip_prefix("CapEff:")
                .is_some_and(|value| value.trim() == "0000000000000000")
        });
    if driver.parent() != Some(Path::new("/usr/share/vulkan/icd.d"))
        || !driver
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("lvp_icd"))
        || manifest["ICD"]["library_path"] != "libvulkan_lvp.so"
        || !(1..=2).contains(&threads)
        || !unprivileged
    {
        return Err("Software preview requires an unprivileged process, only the installed lavapipe ICD and LP_NUM_THREADS=1 or 2".into());
    }
    Ok(())
}
fn create_compositor(choice: AdapterChoice) -> Result<(Compositor, Value)> {
    if matches!(choice, AdapterChoice::Software) {
        software_environment().map_err(|_| unavailable())?;
    }
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::VULKAN,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::VULKAN))
        .into_iter()
        .find(|adapter| {
            let info = adapter.get_info();
            match choice {
                AdapterChoice::Amd(device) => {
                    info.vendor == 0x1002
                        && info.device == device
                        && info.device_type != wgpu::DeviceType::Cpu
                }
                AdapterChoice::Software => {
                    info.vendor == 0x10005
                        && info.device_type == wgpu::DeviceType::Cpu
                        && (info.name.contains("llvmpipe") || info.name.contains("lavapipe"))
                }
            }
        })
        .ok_or_else(unavailable)?;
    let info = adapter.get_info();
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Venturi Web headless Vulkan"),
        required_limits: vv_render::device_limits(&adapter),
        ..Default::default()
    }))
    .map_err(|_| unavailable())?;
    let compositor = Compositor::new(
        &adapter,
        Arc::new(device),
        Arc::new(queue),
        Default::default(),
    );
    Ok((
        compositor,
        json!({"available":true,"name":info.name,"vendor_id":format!("0x{:04x}",info.vendor),"device_id":format!("0x{:04x}",info.device),"backend":"Vulkan","driver":info.driver,"driver_info":info.driver_info,"software":matches!(choice,AdapterChoice::Software)}),
    ))
}
pub fn frame_size(full: (u32, u32), width: u32) -> Result<(u32, u32)> {
    if !(1..=1920).contains(&width) || full.0 == 0 || full.1 == 0 {
        return Err(ApiError::invalid("Invalid preview resolution"));
    }
    let width = width.min(full.0);
    let height = (u64::from(full.1) * u64::from(width) / u64::from(full.0)).max(1);
    if height > 2160 || u64::from(width) * height > 4_194_304 {
        return Err(ApiError::invalid("Preview exceeds the pixel budget"));
    }
    Ok((width, height as u32))
}
pub(crate) fn encode_png(rgba: &[u8], size: (u32, u32)) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    let mut encoder = png::Encoder::new(&mut data, size.0, size.1);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(rgba))
        .map_err(|_| ApiError::io())?;
    Ok(data)
}

#[cfg(test)]
#[path = "tests/preview.rs"]
mod tests;
