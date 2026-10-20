use crate::error::{ApiError, Result};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    path::Path,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
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
struct Job {
    snapshot: FrameSnapshot,
    reply: oneshot::Sender<Result<Vec<u8>>>,
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
    fn next(&self) -> Job {
        let mut pending = self.pending.lock().unwrap();
        loop {
            if let Some(job) = pending.take() {
                return job;
            }
            pending = self.wake.wait(pending).unwrap();
        }
    }
}
#[derive(Clone)]
pub struct Preview {
    queue: Option<Arc<Queue>>,
    diagnostic: Value,
    rendered: Arc<AtomicBool>,
}
impl Preview {
    pub fn disabled() -> Self {
        Self {
            queue: None,
            diagnostic: json!({"available":false,"reason":"Start with --gpu-device to enable a verified AMD Vulkan adapter"}),
            rendered: Arc::new(AtomicBool::new(false)),
        }
    }
    pub fn start(device: u32, lock_path: &Path) -> Self {
        let queue = Arc::new(Queue::default());
        let worker = queue.clone();
        let path = lock_path.to_owned();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let rendered = Arc::new(AtomicBool::new(false));
        let rendered_worker = rendered.clone();
        std::thread::spawn(move || {
            let initialized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _lock = gpu_lock(&path)?;
                create_compositor(device)
            }))
            .unwrap_or_else(|_| Err(unavailable()));
            let (mut compositor, diagnostic) = match initialized {
                Ok(value) => value,
                Err(error) => {
                    let _ = tx.send(Err(error));
                    return;
                }
            };
            if tx.send(Ok(diagnostic)).is_err() {
                return;
            }
            let mut cache: VecDeque<(String, Vec<u8>)> = VecDeque::new();
            let mut bytes = 0;
            loop {
                let job = worker.next();
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
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _lock = gpu_lock(&path)?;
                    compositor.set_precision(snapshot.project.precision);
                    let rgba = vv_session::export::render_frame_rgba(
                        &snapshot.project,
                        snapshot.timeline,
                        snapshot.query.frame,
                        snapshot.size,
                        &compositor,
                    )
                    .map_err(|_| {
                        ApiError(
                            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                            "FRAME_FAILED",
                            "Native frame rendering failed; check offline media",
                        )
                    })?;
                    encode_png(&rgba, snapshot.size)
                }))
                .unwrap_or_else(|_| Err(unavailable()));
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
            },
            _ => Self {
                queue: None,
                diagnostic: json!({"available":false,"reason":"AMD Vulkan device initialization failed or hardware lock is busy"}),
                rendered,
            },
        }
    }
    pub fn available(&self) -> bool {
        self.queue.is_some()
    }
    pub fn diagnostic(&self) -> Value {
        let mut value = self.diagnostic.clone();
        value["frame_rendered"] = json!(self.rendered.load(Ordering::Relaxed));
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
        "The selected AMD Vulkan compositor is unavailable",
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
fn create_compositor(device: u32) -> Result<(Compositor, Value)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::VULKAN,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::VULKAN))
        .into_iter()
        .find(|adapter| {
            let info = adapter.get_info();
            info.vendor == 0x1002
                && info.device == device
                && info.device_type != wgpu::DeviceType::Cpu
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
        json!({"available":true,"name":info.name,"vendor_id":format!("0x{:04x}",info.vendor),"device_id":format!("0x{:04x}",info.device),"backend":"Vulkan","driver":info.driver,"driver_info":info.driver_info,"software":false}),
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
