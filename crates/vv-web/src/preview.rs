use crate::error::{ApiError, Result};
use serde::{Deserialize, Serialize};
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

#[derive(Clone, Deserialize, Serialize)]
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
    pub originals: Option<Arc<crate::frame_sources::FrameSources>>,
    pub video: Arc<crate::proxy_video::Selection>,
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
struct NativeDevices(Vec<vv_media::HwDevice>);
impl Drop for NativeDevices {
    fn drop(&mut self) {
        vv_media::hw::release_cached_devices(&self.0);
    }
}
struct ResidentCompositor<'a> {
    // Fields drop in this order, before either reservation is released.
    compositor: Compositor,
    _global: File,
    _local: std::sync::MutexGuard<'a, ()>,
}
impl Drop for ResidentCompositor<'_> {
    fn drop(&mut self) {
        let _ = self
            .compositor
            .device()
            .poll(wgpu::PollType::wait_indefinitely());
    }
}
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
    mode: FrameMode,
    reply: oneshot::Sender<Result<Vec<u8>>>,
}
#[derive(Clone, Debug)]
enum FrameMode {
    Program,
    Draft(String),
    Scopes(vv_core::ClipId, [vv_render::ScopeKind; 2]),
    Balance(vv_core::ClipId),
}
impl FrameMode {
    fn priority(&self) -> u8 {
        match self {
            Self::Program => 2,
            Self::Balance(_) | Self::Draft(_) => 1,
            Self::Scopes(..) => 0,
        }
    }
    fn cache_key(&self, snapshot: &FrameSnapshot) -> String {
        let mode = match self {
            Self::Draft(tag) => format!("Draft({tag})"),
            _ => format!("{self:?}"),
        };
        format!(
            "{}:{}:{}:{}:{}:{}x{}:{}:{}",
            snapshot.query.project_epoch,
            snapshot.query.if_generation,
            snapshot.query.timeline_id,
            snapshot.query.revision,
            snapshot.query.frame,
            snapshot.size.0,
            snapshot.size.1,
            mode,
            snapshot.video.tag,
        )
    }
    fn is_program(&self) -> bool {
        matches!(self, Self::Program)
    }
}
impl FrameQuery {
    pub fn same_composition(&self, other: &Self) -> bool {
        self.project_epoch == other.project_epoch
            && self.if_generation == other.if_generation
            && self.timeline_id == other.timeline_id
            && self.revision == other.revision
            && self.width == other.width
    }
}
struct CachedFrame {
    key: String,
    query: FrameQuery,
    inputs: crate::program::Inputs,
    originals: Option<crate::frame_sources::Manifest>,
    program: bool,
    render_tag: String,
    data: Vec<u8>,
}
#[derive(Default)]
struct FrameCache {
    entries: VecDeque<CachedFrame>,
    bytes: usize,
}
impl FrameCache {
    fn valid_originals(&self, entry: &CachedFrame, snapshot: &FrameSnapshot) -> bool {
        match (&snapshot.originals, &entry.originals) {
            (Some(sources), Some(manifest)) => sources.validate_manifest(manifest).is_ok(),
            (None, None) => {
                crate::program::inputs(snapshot).is_ok_and(|inputs| entry.inputs == inputs)
            }
            _ => false,
        }
    }
    fn lookup(&self, snapshot: &FrameSnapshot, key: &str) -> Result<Option<Vec<u8>>> {
        snapshot.video.validate()?;
        Ok(self
            .entries
            .iter()
            .find(|entry| entry.key == key && self.valid_originals(entry, snapshot))
            .map(|entry| entry.data.clone()))
    }
    fn validated_frames(&self, snapshot: &FrameSnapshot) -> Vec<i64> {
        if snapshot.video.validate().is_err() {
            return vec![];
        }
        let mut frames: Vec<_> = self
            .entries
            .iter()
            .filter(|entry| {
                entry.program
                    && entry.render_tag == snapshot.video.tag
                    && entry.query.same_composition(&snapshot.query)
                    && self.valid_originals(entry, snapshot)
            })
            .map(|entry| entry.query.frame)
            .collect();
        frames.sort_unstable();
        frames.dedup();
        frames
    }
    fn insert(&mut self, entry: CachedFrame) {
        if entry.data.len() > 16 * 1024 * 1024 {
            return;
        }
        while self.bytes + entry.data.len() > 16 * 1024 * 1024 || self.entries.len() >= 8 {
            if let Some(old) = self.entries.pop_front() {
                self.bytes -= old.data.len();
            }
        }
        self.bytes += entry.data.len();
        self.entries.push_back(entry);
    }
    #[cfg(test)]
    fn frames(
        &self,
        query: &FrameQuery,
        inputs: &crate::program::Inputs,
        render_tag: &str,
    ) -> Vec<i64> {
        let mut frames: Vec<_> = self
            .entries
            .iter()
            .filter(|entry| {
                entry.program
                    && entry.render_tag == render_tag
                    && entry.query.same_composition(query)
                    && entry.inputs == *inputs
            })
            .map(|entry| entry.query.frame)
            .collect();
        frames.sort_unstable();
        frames.dedup();
        frames
    }
}
#[derive(Clone, Copy)]
enum AdapterChoice {
    Amd(u32),
    Software,
}
#[derive(Default)]
struct Queue {
    pending: Mutex<QueueState>,
    wake: Condvar,
}
#[derive(Default)]
struct QueueState {
    job: Option<Job>,
    yields: usize,
    released: bool,
}
struct ContextYield(Arc<Queue>);
impl Drop for ContextYield {
    fn drop(&mut self) {
        let mut state = self.0.pending.lock().unwrap();
        state.yields -= 1;
        self.0.wake.notify_all();
    }
}
impl Queue {
    fn replace(&self, job: Job) {
        let mut pending = self.pending.lock().unwrap();
        // Analysis must not displace a pending Program seek.
        if pending
            .job
            .as_ref()
            .is_some_and(|p| p.mode.priority() > job.mode.priority())
        {
            return;
        }
        pending.job = Some(job);
        self.wake.notify_one();
    }
    fn next(&self, idle: std::time::Duration) -> Option<Job> {
        let mut pending = self.pending.lock().unwrap();
        loop {
            if pending.yields > 0 {
                if !pending.released {
                    return None;
                }
                pending = self.wake.wait(pending).unwrap();
                continue;
            }
            if let Some(job) = pending.job.take() {
                return Some(job);
            }
            let (next, timeout) = self.wake.wait_timeout(pending, idle).unwrap();
            pending = next;
            if timeout.timed_out() && pending.job.is_none() {
                return None;
            }
        }
    }
    fn acknowledge_release(&self) {
        let mut state = self.pending.lock().unwrap();
        state.released = true;
        self.wake.notify_all();
    }
    fn yield_context(self: &Arc<Self>) -> Result<ContextYield> {
        let mut state = self.pending.lock().unwrap();
        if state.yields == 0 {
            state.released = false;
        }
        state.yields += 1;
        self.wake.notify_all();
        let (mut state, timeout) = self
            .wake
            .wait_timeout_while(state, std::time::Duration::from_secs(2), |s| !s.released)
            .unwrap();
        if timeout.timed_out() && !state.released {
            state.yields -= 1;
            self.wake.notify_all();
            return Err(ApiError::conflict(
                "RENDER_BUSY",
                "The active frame has not released its context yet",
            ));
        }
        Ok(ContextYield(self.clone()))
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
    cache: Arc<Mutex<FrameCache>>,
    proxies: Arc<Mutex<Option<crate::proxy::Manager>>>,
}
impl Preview {
    pub fn disabled() -> Self {
        Self {
            queue: None,
            diagnostic: json!({"available":false,"reason":"Select --gpu-device or use the launcher with --software-preview"}),
            rendered: Arc::new(AtomicBool::new(false)),
            config: None,
            gpu_gate: Arc::new(Mutex::new(())),
            resident: Arc::new(AtomicBool::new(false)),
            active_programs: Arc::new(AtomicUsize::new(0)),
            cache: Arc::new(Mutex::new(FrameCache::default())),
            proxies: Arc::new(Mutex::new(None)),
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
        let cache = Arc::new(Mutex::new(FrameCache::default()));
        let worker_cache = cache.clone();
        let proxies = Arc::new(Mutex::new(None::<crate::proxy::Manager>));
        let worker_proxies = proxies.clone();
        std::thread::spawn(move || {
            let initialized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let local = worker_gate.lock().unwrap();
                let global = render_lock(&path, device)?;
                let (compositor, diagnostic) = create_compositor(device)?;
                Ok((
                    ResidentCompositor {
                        compositor,
                        _global: global,
                        _local: local,
                    },
                    diagnostic,
                ))
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
            loop {
                let Some(job) = worker.next(std::time::Duration::from_secs(2)) else {
                    compositor = None;
                    worker_resident.store(false, Ordering::Relaxed);
                    worker.acknowledge_release();
                    continue;
                };
                if job.reply.is_closed() {
                    continue;
                }
                let snapshot = job.snapshot;
                let proxy_manager = worker_proxies.lock().unwrap().clone();
                let _proxy_pause = match proxy_manager
                    .as_ref()
                    .map(crate::proxy::Manager::suspend)
                    .transpose()
                {
                    Ok(guard) => guard,
                    Err(error) => {
                        let _ = job.reply.send(Err(error));
                        continue;
                    }
                };
                let key = job.mode.cache_key(&snapshot);
                match worker_cache.lock().unwrap().lookup(&snapshot, &key) {
                    Ok(Some(data)) => {
                        let _ = job.reply.send(Ok(data));
                        continue;
                    }
                    Err(error) => {
                        let _ = job.reply.send(Err(error));
                        continue;
                    }
                    Ok(None) => {}
                }
                let poll_failed = AtomicBool::new(false);
                let mut result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if compositor.is_none() {
                        let local = worker_gate.lock().unwrap_or_else(|p| p.into_inner());
                        let global = render_lock(&path, device)?;
                        compositor = Some(ResidentCompositor {
                            compositor: create_compositor(device)?.0,
                            _global: global,
                            _local: local,
                        });
                        worker_resident.store(true, Ordering::Relaxed);
                    }
                    let compositor = &mut compositor.as_mut().unwrap().compositor;
                    compositor.set_precision(snapshot.project.precision);
                    let data = match job.mode {
                        FrameMode::Program | FrameMode::Draft(_) => encode_png(
                            &vv_session::export::render_frame_rgba_with_resolver(
                                &snapshot.project,
                                snapshot.timeline,
                                snapshot.query.frame,
                                snapshot.size,
                                compositor,
                                &snapshot.video.sources,
                                snapshot
                                    .originals
                                    .as_ref()
                                    .map(|sources| sources.resolver(&snapshot.video.sources)),
                            )
                            .map_err(|_| {
                                ApiError(
                                    axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                                    "FRAME_FAILED",
                                    "Native frame rendering failed; check offline media",
                                )
                            })?,
                            snapshot.size,
                        ),
                        FrameMode::Scopes(clip, kinds) => {
                            let (rgba, size) = render_scopes(&snapshot, clip, kinds, compositor)?;
                            encode_png(&rgba, size)
                        }
                        FrameMode::Balance(clip) => balance_values(&snapshot, clip, compositor),
                    };
                    if compositor
                        .device()
                        .poll(wgpu::PollType::wait_indefinitely())
                        .is_err()
                    {
                        poll_failed.store(true, Ordering::Relaxed);
                    }
                    data
                }))
                .unwrap_or_else(|_| Err(unavailable()));
                if result.is_ok()
                    && let Err(error) = snapshot.video.validate().and_then(|()| {
                        snapshot
                            .originals
                            .as_ref()
                            .map_or(Ok(()), |sources| sources.validate())
                    })
                {
                    result = Err(error);
                }
                if poll_failed.load(Ordering::Relaxed) {
                    result = Err(unavailable());
                }
                if result.is_err() {
                    compositor = None;
                    worker_resident.store(false, Ordering::Relaxed);
                }
                if let Ok(data) = &result {
                    rendered_worker.store(true, Ordering::Relaxed);
                    let inputs = if snapshot.originals.is_some() {
                        Some(vec![])
                    } else {
                        crate::program::inputs(&snapshot)
                            .ok()
                            .filter(crate::program::unchanged)
                    };
                    let originals = snapshot
                        .originals
                        .as_ref()
                        .map(|sources| sources.manifest())
                        .transpose();
                    if let (Some(inputs), Ok(originals)) = (inputs, originals) {
                        worker_cache.lock().unwrap().insert(CachedFrame {
                            key,
                            query: snapshot.query,
                            inputs,
                            originals,
                            program: job.mode.is_program(),
                            render_tag: snapshot.video.tag.clone(),
                            data: data.clone(),
                        });
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
                cache,
                proxies,
            },
            _ => Self {
                queue: None,
                diagnostic: json!({"available":false,"reason":"Selected Vulkan compositor initialization failed or render lock is busy"}),
                rendered,
                config: None,
                gpu_gate,
                resident,
                active_programs: Arc::new(AtomicUsize::new(0)),
                cache,
                proxies,
            },
        }
    }
    pub fn attach_proxies(&self, manager: crate::proxy::Manager) {
        *self.proxies.lock().unwrap() = Some(manager);
    }
    pub fn available(&self) -> bool {
        self.queue.is_some()
    }
    pub fn hardware_enabled(&self) -> bool {
        matches!(self.config.as_ref(), Some((AdapterChoice::Amd(_), _))) && self.available()
    }
    #[cfg(test)]
    pub(crate) fn codec_test_host() -> Self {
        let mut preview = Self::disabled();
        preview.config = Some((
            AdapterChoice::Amd(0x7551),
            PathBuf::from("unused-codec-test-lock"),
        ));
        preview.queue = Some(Arc::new(Queue::default()));
        preview.diagnostic = json!({"available":true,"name":"test adapter","software":false});
        preview
    }
    pub fn decoder_device(&self) -> Option<vv_media::HwDevice> {
        self.hardware_enabled().then(|| {
            vv_media::HwDevice::Vulkan(self.diagnostic["name"].as_str().map(str::to_owned))
        })
    }
    pub fn with_codec_probe<T>(
        &self,
        hardware: bool,
        operation: impl FnOnce(Option<&File>) -> Result<T>,
    ) -> Result<T> {
        if !hardware {
            return operation(None);
        }
        if !self.hardware_enabled() {
            return Err(ApiError::invalid(
                "Hardware codecs require an available hardware preview host",
            ));
        }
        let _yield = self
            .queue
            .as_ref()
            .ok_or_else(unavailable)?
            .yield_context()?;
        let _local = self
            .gpu_gate
            .try_lock()
            .map_err(|_| ApiError::conflict("GPU_BUSY", "A local GPU job is active"))?;
        let (_, path) = self.config.as_ref().ok_or_else(unavailable)?;
        let global = gpu_lock(path)?;
        operation(Some(&global))
    }
    pub fn cached_frames(&self, snapshot: &FrameSnapshot) -> Vec<i64> {
        self.cache.lock().unwrap().validated_frames(snapshot)
    }
    pub fn export_program(
        &self,
        snapshot: &FrameSnapshot,
        end: i64,
        settings: &vv_session::export::ExportSettings,
        progress: &Mutex<vv_session::export::ExportProgress>,
        cancel: &Arc<AtomicBool>,
        observer: Option<&mut vv_session::audio_render::AudioObserver<'_>>,
    ) -> Result<()> {
        use vv_session::export::ExportError;
        let (device, path) = self.config.as_ref().ok_or_else(unavailable)?;
        if !self.hardware_enabled()
            && (settings.video.codec != vv_media::VideoCodec::X264
                || !settings.hw_decode.is_empty())
        {
            return Err(ApiError::invalid(
                "Hardware codecs are disabled on this preview host",
            ));
        }
        let _yield = self
            .queue
            .as_ref()
            .ok_or_else(unavailable)?
            .yield_context()?;
        let program_lock = render_lock(path, *device)?;
        // Native providers have joined before this guard releases cached contexts.
        let _devices = NativeDevices(settings.hw_decode.clone());
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
        let create = || {
            let _local = self.gpu_gate.lock().unwrap_or_else(|p| p.into_inner());
            let _global = program_lock
                .try_clone()
                .map_err(|_| failed(unavailable()))?;
            let (mut compositor, _) = create_compositor(*device).map_err(failed)?;
            compositor.set_precision(snapshot.project.precision);
            complete(&compositor)?;
            Ok(compositor)
        };
        let acquire = |compositor: &Compositor| {
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
        };
        let result = if snapshot.originals.is_some() || !snapshot.video.sources.is_empty() {
            vv_session::export::export_timeline_preview_with_gpu_with_resolver(
                &snapshot.project,
                snapshot.timeline,
                settings,
                snapshot.query.frame..end,
                progress,
                cancel,
                create,
                acquire,
                2,
                observer,
                &snapshot.video.sources,
                snapshot
                    .originals
                    .as_ref()
                    .map(|sources| sources.resolver(&snapshot.video.sources)),
            )
        } else {
            match observer {
                Some(observer) => vv_session::export::export_timeline_with_gpu_observed(
                    &snapshot.project,
                    snapshot.timeline,
                    settings,
                    snapshot.query.frame..end,
                    progress,
                    cancel,
                    create,
                    acquire,
                    2,
                    observer,
                ),
                None => vv_session::export::export_timeline_with_gpu_cancellable(
                    &snapshot.project,
                    snapshot.timeline,
                    settings,
                    snapshot.query.frame..end,
                    progress,
                    cancel,
                    create,
                    acquire,
                    2,
                ),
            }
        };
        if result.is_ok() {
            snapshot.video.validate()?;
            if let Some(sources) = &snapshot.originals {
                sources.validate()?;
            }
        }
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
        self.render(snapshot, FrameMode::Program).await
    }
    pub async fn draft(&self, snapshot: FrameSnapshot, tag: String) -> Result<Vec<u8>> {
        if tag.len() != 64
            || !tag
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ApiError::invalid("Invalid title preview tag"));
        }
        self.render(snapshot, FrameMode::Draft(tag)).await
    }
    pub async fn scopes(
        &self,
        snapshot: FrameSnapshot,
        clip: &str,
        kinds: [vv_render::ScopeKind; 2],
    ) -> Result<Vec<u8>> {
        let clip = vv_core::ClipId(
            clip.parse()
                .map_err(|_| ApiError::invalid("Invalid scope clip"))?,
        );
        let tl = &snapshot.project.timelines[snapshot.timeline];
        if !tl
            .tracks
            .iter()
            .filter(|t| t.kind == vv_core::TrackKind::Video)
            .flat_map(|t| &t.clips)
            .any(|c| c.id == clip && c.contains(snapshot.query.frame))
        {
            return Err(ApiError::invalid(
                "Select a video clip containing the scope frame",
            ));
        }
        self.render(snapshot, FrameMode::Scopes(clip, kinds)).await
    }
    pub async fn balance(&self, snapshot: FrameSnapshot, clip: &str) -> Result<Value> {
        let clip = vv_core::ClipId(
            clip.parse()
                .map_err(|_| ApiError::invalid("Invalid balance clip"))?,
        );
        balance_grade(&snapshot, clip)?;
        let bytes = self.render(snapshot, FrameMode::Balance(clip)).await?;
        serde_json::from_slice(&bytes).map_err(|_| ApiError::io())
    }
    async fn render(&self, snapshot: FrameSnapshot, mode: FrameMode) -> Result<Vec<u8>> {
        let queue = self.queue.as_ref().ok_or_else(unavailable)?;
        let (tx, rx) = oneshot::channel();
        queue.replace(Job {
            snapshot,
            mode,
            reply: tx,
        });
        rx.await.map_err(|_| {
            ApiError::conflict("SEEK_SUPERSEDED", "A newer seek replaced this request")
        })?
    }
}
fn balance_grade(snapshot: &FrameSnapshot, clip: vv_core::ClipId) -> Result<vv_core::GradeValue> {
    let clip = snapshot.project.timelines[snapshot.timeline]
        .tracks
        .iter()
        .filter(|t| t.kind == vv_core::TrackKind::Video)
        .flat_map(|t| &t.clips)
        .find(|c| c.id == clip && c.contains(snapshot.query.frame))
        .ok_or_else(|| ApiError::invalid("Select a video clip containing the balance frame"))?;
    let grade = clip
        .effects
        .filters
        .iter()
        .find(|f| f.kind == vv_core::FilterKind::ColorCorrection)
        .ok_or_else(|| ApiError::invalid("Add ColorCorrection on the selected clip first"))?;
    Ok(grade
        .grade
        .value_at(clip.source_frame_at(snapshot.query.frame)))
}
fn balance_values(
    snapshot: &FrameSnapshot,
    clip: vv_core::ClipId,
    compositor: &Compositor,
) -> Result<Vec<u8>> {
    let grade = balance_grade(snapshot, clip)?;
    let pixels = vv_session::export::render_balance_frame_rgba_with_resolver(
        &snapshot.project,
        snapshot.timeline,
        clip,
        snapshot.query.frame,
        snapshot.size,
        compositor,
        snapshot
            .originals
            .as_ref()
            .map(|sources| sources.resolver(&Default::default())),
    )
    .map_err(|_| {
        ApiError::invalid("Native isolated balance rendering failed; check offline media")
    })?;
    let pixels = pixels.as_chunks::<4>().0;
    let balanced = vv_core::auto_balance(
        &grade,
        pixels
            .iter()
            .step_by((pixels.len() / 250_000).max(1))
            .map(|p| [p[0], p[1], p[2]].map(|c| c as f32 / 255.0)),
    );
    let values = vv_core::GradeParam::ALL
        .into_iter()
        .filter(|p| grade.get(*p) != balanced.get(*p))
        .map(|param| crate::visual::GradeValue {
            param,
            value: balanced.get(param),
        })
        .collect();
    let operation = crate::commands::Operation::ApplyGradeAtFrame {
        clip_id: clip.0.to_string(),
        frame: snapshot.query.frame,
        values,
    };
    serde_json::to_vec(
        &json!({"query":snapshot.query,"clip":clip.0.to_string(),"operation":operation}),
    )
    .map_err(|_| ApiError::io())
}
fn render_scopes(
    snapshot: &FrameSnapshot,
    clip: vv_core::ClipId,
    kinds: [vv_render::ScopeKind; 2],
    compositor: &Compositor,
) -> Result<(Vec<u8>, (u32, u32))> {
    let source = vv_session::export::render_scope_source_with_resolver(
        &snapshot.project,
        snapshot.timeline,
        clip,
        snapshot.query.frame,
        snapshot.size,
        compositor,
        snapshot
            .originals
            .as_ref()
            .map(|sources| sources.resolver(&Default::default())),
    )
    .map_err(|_| {
        ApiError::invalid("Native isolated scope rendering failed; check offline media")
    })?;
    let scopes = vv_render::Scopes::new(compositor.device().clone(), compositor.queue().clone());
    let mut rgba = vec![0; 1024 * 256 * 4];
    for (slot, kind) in kinds.into_iter().enumerate() {
        let texture = scopes.render(&source, kind, slot, (512, 256));
        let pixels = compositor.read_rgba_texture(&texture, 512, 256);
        for (row, data) in pixels.as_chunks::<{ 512 * 4 }>().0.iter().enumerate() {
            let start = row * 1024 * 4 + slot * 512 * 4;
            rgba[start..start + data.len()].copy_from_slice(data);
        }
    }
    Ok((rgba, (1024, 256)))
}
fn unavailable() -> ApiError {
    ApiError(
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "GPU_UNAVAILABLE",
        "The selected native Vulkan compositor is unavailable",
    )
}
pub(crate) fn gpu_lock(path: &Path) -> Result<File> {
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
