use crate::{
    error::{ApiError, Result},
    source::SourceSpec,
};
use rustix::fs::{AtFlags, FlockOperation, Mode, OFlags, RenameFlags, openat, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashSet, VecDeque},
    fs::File,
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{DirBuilderExt, MetadataExt},
    },
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use vv_media::proxy::ProxyQuality;

pub struct Input {
    pub spec: SourceSpec,
    pub original_path: PathBuf,
}

const SETTINGS: &str = ".venturi-proxy-settings.json";
const LOCK: &str = ".venturi-proxy-settings.lock";
const MAX_JOBS: usize = 32;
const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_CACHE: u64 = 2 * 1024 * 1024 * 1024;
const DISK_RESERVE: u64 = 16 * 1024 * 1024 * 1024;
const HOST_RESERVE: u64 = 8 * 1024 * 1024 * 1024;
const ACTIVE_BUDGET: Duration = Duration::from_secs(600);
const SUSPEND_TIMEOUT: Duration = Duration::from_secs(2);

fn changed() -> ApiError {
    ApiError::conflict(
        "SOURCE_CHANGED",
        "The original media or native proxy changed; prepare it again",
    )
}
fn busy() -> ApiError {
    ApiError::conflict(
        "PROXY_BUSY",
        "Native proxy work has not paused yet; retry when it is idle",
    )
}
fn cache_full() -> ApiError {
    ApiError::conflict(
        "PROXY_CACHE_FULL",
        "Native proxy cache is full or still leased by a viewer",
    )
}
fn settings_changed() -> ApiError {
    ApiError::conflict(
        "PROXY_SETTINGS_CHANGED",
        "Native proxy settings changed; refresh before saving",
    )
}
fn open_regular(dir: &File, name: &str) -> Result<File> {
    let file = File::from(
        openat(
            dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| changed())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(changed());
    }
    Ok(file)
}
fn inode(file: &File) -> Result<(u64, u64)> {
    let m = file.metadata().map_err(|_| ApiError::io())?;
    Ok((m.dev(), m.ino()))
}
fn identity(file: &File) -> Result<String> {
    crate::asset_store::stable_identity(file)
}
fn fd_path(file: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    version: u32,
    enabled: bool,
    quality: String,
    paused: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            quality: "medium".into(),
            paused: false,
        }
    }
}
impl Settings {
    fn quality(&self) -> Result<ProxyQuality> {
        if self.version != 1 {
            return Err(ApiError::invalid(
                "Unsupported native proxy settings version",
            ));
        }
        ProxyQuality::from_id(&self.quality)
            .ok_or_else(|| ApiError::invalid("Choose low, medium or high native proxy quality"))
    }
    fn value(&self) -> Value {
        json!({"enabled":self.enabled,"quality":self.quality,"paused":self.paused})
    }
}
struct Root {
    path: PathBuf,
    directory: File,
}
impl Root {
    fn check(&self) -> Result<()> {
        let live = File::from(
            rustix::fs::open(
                &self.path,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| changed())?,
        );
        crate::asset_store::same_directory(&self.directory, &live).map_err(|_| changed())
    }
    fn lock(&self, exclusive: bool) -> Result<File> {
        self.check()?;
        let file = File::from(
            openat(
                &self.directory,
                LOCK,
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(settings_changed());
        }
        rustix::fs::flock(
            &file,
            if exclusive {
                FlockOperation::NonBlockingLockExclusive
            } else {
                FlockOperation::NonBlockingLockShared
            },
        )
        .map_err(|_| busy())?;
        if inode(&file)? != inode(&open_regular(&self.directory, LOCK)?)? {
            return Err(settings_changed());
        }
        Ok(file)
    }
    fn read(&self) -> Result<(Settings, Option<String>)> {
        self.check()?;
        let file = match openat(
            &self.directory,
            SETTINGS,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(file) => File::from(file),
            Err(rustix::io::Errno::NOENT) => return Ok((Settings::default(), None)),
            Err(_) => return Err(settings_changed()),
        };
        let metadata = file.metadata().map_err(|_| ApiError::io())?;
        if !metadata.is_file() || metadata.len() > 4096 {
            return Err(ApiError::invalid(
                "Native proxy settings must be a regular JSON file of at most 4 KiB",
            ));
        }
        let before = identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() > 4096 {
            return Err(settings_changed());
        }
        let settings: Settings = serde_json::from_slice(&bytes).map_err(|_| {
            ApiError::invalid("Native proxy settings are invalid; the file was preserved")
        })?;
        settings.quality()?;
        if identity(&file)? != before
            || identity(&open_regular(&self.directory, SETTINGS)?)? != before
        {
            return Err(settings_changed());
        }
        Ok((settings, Some(before)))
    }
    fn save(&self, settings: &Settings, expected: &Option<String>) -> Result<Option<String>> {
        if &self.read()?.1 != expected {
            return Err(settings_changed());
        }
        let name = format!(".venturi-proxy-settings-{}.tmp", crate::asset_jobs::nonce());
        let mut file = File::from(
            openat(
                &self.directory,
                name.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        let owned = inode(&file)?;
        let result = (|| {
            file.write_all(&serde_json::to_vec(settings).map_err(|_| ApiError::io())?)
                .map_err(|_| ApiError::io())?;
            file.sync_all().map_err(|_| ApiError::io())?;
            drop(file);
            if &self.read()?.1 != expected
                || inode(&open_regular(&self.directory, &name)?)? != owned
            {
                return Err(settings_changed());
            }
            if expected.is_none() {
                rustix::fs::renameat_with(
                    &self.directory,
                    name.as_str(),
                    &self.directory,
                    SETTINGS,
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| settings_changed())?;
            } else {
                rustix::fs::renameat(&self.directory, name.as_str(), &self.directory, SETTINGS)
                    .map_err(|_| ApiError::io())?;
            }
            self.directory.sync_all().map_err(|_| ApiError::io())?;
            self.read().map(|(_, identity)| identity)
        })();
        remove_owned(&self.directory, &name, owned);
        result
    }
}
fn remove_owned(directory: &File, name: &str, owned: (u64, u64)) {
    if open_regular(directory, name)
        .and_then(|file| inode(&file))
        .ok()
        == Some(owned)
    {
        let _ = unlinkat(directory, name, AtFlags::empty());
    }
}
struct Cache {
    path: PathBuf,
    directory: File,
}
impl Cache {
    fn check(&self) -> Result<()> {
        let live = File::from(
            rustix::fs::open(
                &self.path,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| changed())?,
        );
        crate::asset_store::same_directory(&self.directory, &live).map_err(|_| changed())
    }
}
impl Drop for Cache {
    fn drop(&mut self) {
        if self.check().is_ok() {
            let _ = std::fs::remove_dir(&self.path);
        }
    }
}
struct Artifact {
    cache: Arc<Cache>,
    name: String,
    file: File,
    original: File,
    original_path: PathBuf,
    source_version: String,
    artifact_version: String,
    bytes: u64,
}
impl Artifact {
    fn validate(&self, root: &Root) -> Result<()> {
        self.cache.check()?;
        if identity(&self.original)? != self.source_version
            || identity(&self.file)? != self.artifact_version
            || identity(&open_regular(&self.cache.directory, &self.name)?)? != self.artifact_version
        {
            return Err(changed());
        }
        let current =
            crate::files::open_root_media(&root.path, &root.directory, &self.original_path)
                .map_err(|_| changed())?;
        if identity(&current)? != self.source_version {
            return Err(changed());
        }
        Ok(())
    }
}
impl Drop for Artifact {
    fn drop(&mut self) {
        if self.cache.check().is_ok()
            && let Ok(owned) = inode(&self.file)
        {
            remove_owned(&self.cache.directory, &self.name, owned);
        }
    }
}
pub struct Lease {
    artifact: Arc<Artifact>,
    root: Arc<Root>,
}
impl Lease {
    pub fn path(&self) -> PathBuf {
        fd_path(&self.artifact.file)
    }
    pub fn source_version(&self) -> &str {
        &self.artifact.source_version
    }
    pub fn validate(&self) -> Result<()> {
        self.artifact.validate(&self.root)
    }
}
struct Job {
    id: String,
    epoch: String,
    media_id: String,
    key: String,
    version: String,
    quality: ProxyQuality,
    total: u64,
    progress: u64,
    state: &'static str,
    error: Option<&'static str>,
    spec: Option<Input>,
    cancel: Arc<AtomicBool>,
    artifact: Option<Arc<Artifact>>,
}
impl Job {
    fn value(&self) -> Value {
        json!({"id":self.id,"media_id":self.media_id,"state":self.state,"progress":self.progress.min(self.total),"total":self.total,"error":self.error,"quality":self.quality.id(),"source_version":self.version})
    }
}
struct State {
    settings: Settings,
    settings_identity: Option<String>,
    jobs: VecDeque<Job>,
    artifacts: Vec<Weak<Artifact>>,
    suspended: usize,
    active: Option<String>,
    parked: bool,
    shutdown: bool,
}
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}
struct Owner {
    root: Arc<Root>,
    cache: Arc<Cache>,
    shared: Arc<Shared>,
}
impl Drop for Owner {
    fn drop(&mut self) {
        if let Ok(mut state) = self.shared.state.lock() {
            state.shutdown = true;
            for job in &state.jobs {
                job.cancel.store(true, Ordering::Release);
            }
            self.shared.wake.notify_all();
        }
    }
}
#[derive(Clone)]
pub struct Manager(Arc<Owner>);
pub struct Suspension {
    shared: Arc<Shared>,
}
impl Drop for Suspension {
    fn drop(&mut self) {
        if let Ok(mut state) = self.shared.state.lock() {
            state.suspended = state.suspended.saturating_sub(1);
            self.shared.wake.notify_all();
        }
    }
}

impl Manager {
    pub fn start(root: &Path) -> Result<Self> {
        let path = root.canonicalize().map_err(|_| ApiError::io())?;
        let directory = File::from(
            rustix::fs::open(
                &path,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        let root = Arc::new(Root { path, directory });
        let _guard = root.lock(false)?;
        let (settings, settings_identity) = root.read()?;
        let path = std::env::temp_dir().join(format!(
            "venturi-web-proxies-{}-{}",
            std::process::id(),
            crate::asset_jobs::nonce()
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(|_| ApiError::io())?;
        let cache = Arc::new(Cache {
            directory: File::open(&path).map_err(|_| ApiError::io())?,
            path,
        });
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                settings,
                settings_identity,
                jobs: VecDeque::new(),
                artifacts: Vec::new(),
                suspended: 0,
                active: None,
                parked: false,
                shutdown: false,
            }),
            wake: Condvar::new(),
        });
        let owner = Arc::new(Owner {
            root,
            cache,
            shared,
        });
        let worker = owner.shared.clone();
        let root = owner.root.clone();
        let cache = owner.cache.clone();
        std::thread::Builder::new()
            .name("native-proxies".into())
            .spawn(move || worker_loop(&root, &cache, &worker))
            .map_err(|_| ApiError::io())?;
        Ok(Self(owner))
    }
    pub fn settings(&self) -> Result<Value> {
        let _guard = self.0.root.lock(false)?;
        let (settings, tag) = self.0.root.read()?;
        let mut state = self.0.shared.state.lock().map_err(|_| ApiError::io())?;
        update_settings(&mut state, settings, tag);
        self.0.shared.wake.notify_all();
        Ok(state.settings.value())
    }
    pub fn configure(&self, enabled: bool, quality: &str, paused: bool) -> Result<Value> {
        let next = Settings {
            version: 1,
            enabled,
            quality: quality.into(),
            paused,
        };
        next.quality()?;
        let _guard = self.0.root.lock(true)?;
        let mut state = self.0.shared.state.lock().map_err(|_| ApiError::io())?;
        let current = self.0.root.read()?;
        if current.1 != state.settings_identity {
            return Err(settings_changed());
        }
        if current.0 == next {
            return Ok(next.value());
        }
        let tag = self.0.root.save(&next, &state.settings_identity)?;
        update_settings(&mut state, next, tag);
        self.0.shared.wake.notify_all();
        Ok(state.settings.value())
    }
    pub fn enqueue(&self, input: Input) -> Result<Value> {
        let Input {
            spec,
            original_path,
        } = input;
        validate_spec(&spec)?;
        let version = identity(&spec.file)?;
        check_original(&self.0.root, &spec, &version, &original_path)?;
        let mut state = self.0.shared.state.lock().map_err(|_| ApiError::io())?;
        if !state.settings.enabled {
            return Err(ApiError::conflict(
                "PROXY_DISABLED",
                "Enable native proxies before preparing them",
            ));
        }
        let quality = state.settings.quality()?;
        let key = key(&spec, &version, quality)?;
        if let Some(job) = state.jobs.iter().find(|job| {
            job.epoch == spec.epoch
                && job.media_id == spec.media_id
                && job.key == key
                && matches!(job.state, "queued" | "generating" | "ready")
        }) {
            return Ok(job.value());
        }
        if state.jobs.len() >= MAX_JOBS {
            let index = state
                .jobs
                .iter()
                .position(|job| matches!(job.state, "failed" | "canceled" | "ready"));
            if let Some(index) = index {
                state.jobs.remove(index);
            } else {
                return Err(ApiError::conflict(
                    "PROXY_QUEUE_FULL",
                    "The native proxy queue already contains 32 jobs",
                ));
            }
        }
        let artifact = state
            .artifacts
            .iter()
            .filter_map(Weak::upgrade)
            .find(|artifact| {
                artifact.source_version == version
                    && state.jobs.iter().any(|job| {
                        job.key == key
                            && job
                                .artifact
                                .as_ref()
                                .is_some_and(|other| Arc::ptr_eq(artifact, other))
                    })
            });
        let artifact = artifact.filter(|artifact| artifact.validate(&self.0.root).is_ok());
        let ready = artifact.is_some();
        let job = Job {
            id: format!("proxy-{}", crate::asset_jobs::nonce()),
            epoch: spec.epoch.clone(),
            media_id: spec.media_id.clone(),
            key,
            version,
            quality,
            total: spec.meta.duration_frames as u64,
            progress: if ready {
                spec.meta.duration_frames as u64
            } else {
                0
            },
            state: if ready { "ready" } else { "queued" },
            error: None,
            spec: (!ready).then_some(Input {
                spec,
                original_path,
            }),
            cancel: Arc::new(AtomicBool::new(false)),
            artifact,
        };
        let value = job.value();
        state.jobs.push_back(job);
        self.0.shared.wake.notify_all();
        Ok(value)
    }
    pub fn status(&self, epoch: &str) -> Result<Value> {
        let state = self.0.shared.state.lock().map_err(|_| ApiError::io())?;
        let mut seen = HashSet::new();
        let jobs = state
            .jobs
            .iter()
            .rev()
            .filter(|job| {
                job.epoch == epoch
                    && job.quality.id() == state.settings.quality
                    && seen.insert(job.media_id.as_str())
            })
            .map(Job::value)
            .collect::<Vec<_>>();
        Ok(
            json!({"project_epoch":epoch,"settings":state.settings.value(),"suspended":state.suspended>0,"jobs":jobs,"capacity":{"max_jobs":MAX_JOBS,"max_bytes":MAX_CACHE,"max_job_bytes":MAX_FILE,"charged_bytes":charge(&state),"used_jobs":state.jobs.len()}}),
        )
    }
    pub fn resolve(&self, spec: &SourceSpec, original_path: &Path) -> Result<Option<Lease>> {
        validate_spec(spec)?;
        let version = identity(&spec.file)?;
        check_original(&self.0.root, spec, &version, original_path)?;
        let state = self.0.shared.state.lock().map_err(|_| ApiError::io())?;
        if !state.settings.enabled {
            return Ok(None);
        }
        let key = key(spec, &version, state.settings.quality()?)?;
        let artifact = state
            .jobs
            .iter()
            .find(|job| job.key == key && job.state == "ready")
            .and_then(|job| job.artifact.clone());
        drop(state);
        if let Some(artifact) = artifact {
            artifact.validate(&self.0.root)?;
            Ok(Some(Lease {
                artifact,
                root: self.0.root.clone(),
            }))
        } else {
            Ok(None)
        }
    }
    pub fn suspend(&self) -> Result<Suspension> {
        let shared = self.0.shared.clone();
        let mut state = shared.state.lock().map_err(|_| ApiError::io())?;
        state.suspended += 1;
        shared.wake.notify_all();
        let until = Instant::now() + SUSPEND_TIMEOUT;
        while state.active.is_some() && !state.parked {
            let remaining = until.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                state.suspended -= 1;
                shared.wake.notify_all();
                return Err(busy());
            }
            let (next, _) = shared
                .wake
                .wait_timeout(state, remaining)
                .map_err(|_| ApiError::io())?;
            state = next;
        }
        drop(state);
        Ok(Suspension { shared })
    }
}
fn update_settings(state: &mut State, settings: Settings, tag: Option<String>) {
    for job in &mut state.jobs {
        if (!settings.enabled || job.quality.id() != settings.quality)
            && matches!(job.state, "queued" | "generating")
        {
            job.cancel.store(true, Ordering::Release);
            if job.state == "queued" {
                job.state = "canceled";
                job.error = Some("PROXY_CANCELED");
                job.spec = None;
            }
        }
    }
    state.settings = settings;
    state.settings_identity = tag;
}
fn validate_spec(spec: &SourceSpec) -> Result<()> {
    let meta = &spec.meta;
    if spec.epoch.is_empty()
        || spec.epoch.len() > 256
        || spec.media_id.is_empty()
        || spec.media_id.len() > 20
        || !spec.media_id.bytes().all(|b| b.is_ascii_digit())
        || !spec.file.metadata().map_err(|_| ApiError::io())?.is_file()
        || !meta.has_video
        || meta.is_image()
        || meta.width == 0
        || meta.height == 0
        || meta.width > 8192
        || meta.height > 8192
        || meta.duration_frames <= 0
        || meta.duration_frames > crate::commands::MAX_FRAME
        || meta.fps.num <= 0
        || meta.fps.den <= 0
    {
        return Err(ApiError::invalid(
            "Native proxies require a regular moving video with valid bounded dimensions, duration and source identity",
        ));
    }
    Ok(())
}
fn key(spec: &SourceSpec, version: &str, quality: ProxyQuality) -> Result<String> {
    let metadata = serde_json::to_string(&spec.meta).map_err(|_| ApiError::io())?;
    if metadata.len() > 64 * 1024 {
        return Err(ApiError::invalid(
            "Native proxy source metadata exceeds 64 KiB",
        ));
    }
    Ok(format!("{version}:{}:{metadata}", quality.id()))
}
fn check_original(
    root: &Root,
    spec: &SourceSpec,
    version: &str,
    original_path: &Path,
) -> Result<PathBuf> {
    root.check()?;
    if identity(&spec.file)? != version {
        return Err(changed());
    }
    let current = crate::files::open_root_media(&root.path, &root.directory, original_path)
        .map_err(|_| changed())?;
    if identity(&current)? != version {
        return Err(changed());
    }
    Ok(original_path.to_owned())
}
fn charge(state: &State) -> u64 {
    let mut seen = HashSet::new();
    let bytes = state
        .artifacts
        .iter()
        .filter_map(Weak::upgrade)
        .filter(|artifact| seen.insert(Arc::as_ptr(artifact) as usize))
        .fold(0u64, |sum, artifact| sum.saturating_add(artifact.bytes));
    bytes.saturating_add(if state.active.is_some() { MAX_FILE } else { 0 })
}
fn make_space(state: &mut State) -> Result<()> {
    state
        .artifacts
        .retain(|artifact| artifact.strong_count() > 0);
    while charge(state).saturating_add(MAX_FILE) > MAX_CACHE {
        let candidate = state
            .artifacts
            .iter()
            .filter_map(Weak::upgrade)
            .find(|artifact| {
                let records = state
                    .jobs
                    .iter()
                    .filter(|job| {
                        job.artifact
                            .as_ref()
                            .is_some_and(|other| Arc::ptr_eq(other, artifact))
                    })
                    .count();
                Arc::strong_count(artifact) == records + 1
            })
            .ok_or_else(cache_full)?;
        for job in &mut state.jobs {
            if job
                .artifact
                .as_ref()
                .is_some_and(|other| Arc::ptr_eq(other, &candidate))
            {
                job.artifact = None;
                job.state = "canceled";
                job.error = Some("PROXY_CACHE_EVICTED");
            }
        }
        drop(candidate);
        state
            .artifacts
            .retain(|artifact| artifact.strong_count() > 0);
    }
    Ok(())
}
struct Work {
    id: String,
    spec: Input,
    version: String,
    quality: ProxyQuality,
    cancel: Arc<AtomicBool>,
}
fn wait_callback(shared: &Shared, cancel: &AtomicBool) -> Result<()> {
    let mut state = shared.state.lock().map_err(|_| ApiError::io())?;
    while !state.shutdown
        && !cancel.load(Ordering::Acquire)
        && (state.settings.paused || state.suspended > 0)
    {
        state.parked = true;
        shared.wake.notify_all();
        state = shared.wake.wait(state).map_err(|_| ApiError::io())?;
    }
    state.parked = false;
    if state.shutdown || cancel.load(Ordering::Acquire) {
        return Err(ApiError::conflict(
            "PROXY_CANCELED",
            "Native proxy preparation was canceled",
        ));
    }
    Ok(())
}
fn worker_loop(root: &Arc<Root>, cache: &Arc<Cache>, shared: &Arc<Shared>) {
    loop {
        let next = (|| -> Result<Option<Work>> {
            let mut state = shared.state.lock().map_err(|_| ApiError::io())?;
            loop {
                if state.shutdown {
                    return Ok(None);
                }
                if !state.settings.enabled || state.settings.paused || state.suspended > 0 {
                    state.parked = true;
                    shared.wake.notify_all();
                    state = shared.wake.wait(state).map_err(|_| ApiError::io())?;
                    continue;
                }
                let index = state.jobs.iter().position(|job| job.state == "queued");
                if let Some(index) = index {
                    if let Err(error) = make_space(&mut state) {
                        state.jobs[index].state = "failed";
                        state.jobs[index].error = Some(error.1);
                        state.jobs[index].spec = None;
                        continue;
                    }
                    let job = &mut state.jobs[index];
                    job.state = "generating";
                    let next = Work {
                        id: job.id.clone(),
                        spec: job.spec.take().ok_or_else(ApiError::missing)?,
                        version: job.version.clone(),
                        quality: job.quality,
                        cancel: job.cancel.clone(),
                    };
                    state.active = Some(next.id.clone());
                    state.parked = false;
                    return Ok(Some(next));
                }
                state.parked = true;
                shared.wake.notify_all();
                state = shared.wake.wait(state).map_err(|_| ApiError::io())?;
            }
        })();
        let Ok(Some(work)) = next else {
            return;
        };
        let result = generate(root, cache, shared, &work);
        let Work { id, cancel, .. } = work;
        if let Ok(mut state) = shared.state.lock() {
            state.active = None;
            state.parked = false;
            if let Ok(artifact) = &result {
                state.artifacts.push(Arc::downgrade(artifact));
            }
            if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
                match result {
                    Ok(artifact) if !cancel.load(Ordering::Acquire) => {
                        job.state = "ready";
                        job.progress = job.total;
                        job.artifact = Some(artifact);
                    }
                    Ok(_) => {
                        job.state = "canceled";
                        job.error = Some("PROXY_CANCELED");
                    }
                    Err(error) => {
                        job.state = if cancel.load(Ordering::Acquire) {
                            "canceled"
                        } else {
                            "failed"
                        };
                        job.error = Some(error.1);
                    }
                }
            }
            shared.wake.notify_all();
        } else {
            return;
        }
    }
}
fn resources(cache: &Cache, meta: &vv_core::MediaMeta, quality: ProxyQuality) -> Result<()> {
    cache.check()?;
    let stat = rustix::fs::fstatvfs(&cache.directory).map_err(|_| ApiError::io())?;
    if stat.f_bavail.saturating_mul(stat.f_frsize) < DISK_RESERVE.saturating_add(MAX_FILE) {
        return Err(ApiError::conflict(
            "PROXY_DISK_PRESSURE",
            "Native proxies require 16 GiB free plus their bounded artifact reservation",
        ));
    }
    let mut text = String::new();
    File::open("/proc/meminfo")
        .map_err(|_| ApiError::io())?
        .take(64 * 1024)
        .read_to_string(&mut text)
        .map_err(|_| ApiError::io())?;
    let available = text
        .lines()
        .find_map(|line| {
            line.strip_prefix("MemAvailable:")
                .and_then(|line| line.split_whitespace().next())
                .and_then(|value| value.parse::<u64>().ok())
        })
        .and_then(|value| value.checked_mul(1024))
        .ok_or_else(ApiError::io)?;
    if available < HOST_RESERVE {
        return Err(ApiError::conflict(
            "PROXY_MEMORY_PRESSURE",
            "Native proxy preparation requires 8 GiB available host memory",
        ));
    }
    let pixels = u64::from(meta.width) * u64::from(meta.height);
    let scaled = u64::from(meta.width.min(quality.max_width())) * u64::from(meta.height);
    crate::program::admit_memory(
        256 * 1024 * 1024 + pixels.saturating_mul(96) + scaled.saturating_mul(16),
        128 * 1024 * 1024,
        ApiError::conflict(
            "PROXY_MEMORY_PRESSURE",
            "Insufficient process or host memory for native proxy decoding",
        ),
    )
}
fn generate(
    root: &Arc<Root>,
    cache: &Arc<Cache>,
    shared: &Arc<Shared>,
    work: &Work,
) -> Result<Arc<Artifact>> {
    let Work {
        id,
        spec,
        version,
        quality,
        cancel,
    } = work;
    let input = spec;
    let spec = &input.spec;
    let quality = *quality;
    let original_path = check_original(root, spec, version, &input.original_path)?;
    resources(cache, &spec.meta, quality)?;
    let actual =
        crate::asset_probe::probe_root_media(&spec.file, false, cancel, Duration::from_secs(20))?;
    if actual.width != spec.meta.width
        || actual.height != spec.meta.height
        || actual.fps != spec.meta.fps
        || actual.duration_frames != spec.meta.duration_frames
        || actual.is_image()
        || !actual.has_video
    {
        return Err(changed());
    }
    check_original(root, spec, version, &input.original_path)?;
    let name = format!("{id}.mp4");
    let output = fd_path(&cache.directory).join(&name);
    let temporary = output.with_extension(format!("tmp-{}.mp4", std::process::id()));
    let mut owned_temporary = None;
    let mut callback_error = None;
    let mut elapsed = Duration::ZERO;
    let mut last = Instant::now();
    let mut last_resources = Instant::now();
    let result = vv_media::proxy::generate_proxy_at(
        &fd_path(&spec.file),
        &output,
        quality,
        &[],
        2,
        |frames| {
            let callback_start = Instant::now();
            let mut paused_for = Duration::ZERO;
            let attempt = (|| -> Result<()> {
                elapsed = elapsed.saturating_add(last.elapsed());
                if elapsed > ACTIVE_BUDGET {
                    return Err(ApiError::conflict(
                        "PROXY_TIMEOUT",
                        "Native proxy active generation exceeded its 600-second budget",
                    ));
                }
                if cancel.load(Ordering::Acquire) {
                    return Err(ApiError::conflict(
                        "PROXY_CANCELED",
                        "Native proxy preparation was canceled",
                    ));
                }
                cache.check()?;
                let temp = open_regular(
                    &cache.directory,
                    temporary
                        .file_name()
                        .and_then(|name| name.to_str())
                        .ok_or_else(ApiError::io)?,
                )?;
                let current = inode(&temp)?;
                if owned_temporary.is_some_and(|owned| owned != current) {
                    return Err(changed());
                }
                owned_temporary = Some(current);
                if temp.metadata().map_err(|_| ApiError::io())?.len() > MAX_FILE {
                    return Err(ApiError::conflict(
                        "PROXY_TOO_LARGE",
                        "Native proxy exceeds its 512 MiB artifact budget",
                    ));
                }
                let mut state = shared.state.lock().map_err(|_| ApiError::io())?;
                if let Some(job) = state.jobs.iter_mut().find(|job| job.id == work.id) {
                    job.progress = frames;
                }
                drop(state);
                let before_pause = Instant::now();
                wait_callback(shared, cancel)?;
                paused_for = before_pause.elapsed();
                check_original(root, spec, version, &input.original_path)?;
                if last_resources.elapsed() >= Duration::from_secs(1) {
                    resources(cache, &spec.meta, quality)?;
                    last_resources = Instant::now();
                }
                elapsed =
                    elapsed.saturating_add(callback_start.elapsed().saturating_sub(paused_for));
                last = Instant::now();
                Ok(())
            })();
            if let Err(error) = attempt {
                callback_error = Some(error);
                false
            } else {
                true
            }
        },
    );
    let result = (|| {
        if let Some(error) = callback_error {
            return Err(error);
        }
        result.map_err(|_| {
            ApiError::conflict("PROXY_FAILED", "Native software proxy generation failed")
        })?;
        check_original(root, spec, version, &input.original_path)?;
        cache.check()?;
        if cancel.load(Ordering::Acquire) {
            return Err(ApiError::conflict(
                "PROXY_CANCELED",
                "Native proxy preparation was canceled",
            ));
        }
        let file = open_regular(&cache.directory, &name)?;
        let bytes = file.metadata().map_err(|_| ApiError::io())?.len();
        if bytes == 0 || bytes > MAX_FILE {
            return Err(cache_full());
        }
        if owned_temporary != Some(inode(&file)?) {
            return Err(changed());
        }
        let artifact_version = identity(&file)?;
        let encoded =
            crate::asset_probe::probe_root_media(&file, false, cancel, Duration::from_secs(20))?;
        if !encoded.has_video
            || encoded.has_audio
            || encoded.fps != spec.meta.fps
            || encoded.duration_frames != spec.meta.duration_frames
            || encoded.width == 0
            || encoded.width > quality.max_width()
            || encoded.height == 0
            || encoded.height > 8192
            || identity(&file)? != artifact_version
        {
            return Err(ApiError::conflict(
                "PROXY_FRAME_MAPPING",
                "Native proxy output does not preserve the original full-range frame clock",
            ));
        }
        check_original(root, spec, version, &input.original_path)?;
        let artifact = Arc::new(Artifact {
            cache: cache.clone(),
            name: name.clone(),
            file,
            original: spec.file.try_clone().map_err(|_| ApiError::io())?,
            original_path,
            source_version: version.clone(),
            artifact_version,
            bytes,
        });
        artifact.validate(root)?;
        Ok(artifact)
    })();
    if result.is_err()
        && let Some(owned) = owned_temporary
        && cache.check().is_ok()
    {
        remove_owned(&cache.directory, &name, owned);
        if let Some(name) = temporary.file_name().and_then(|name| name.to_str()) {
            remove_owned(&cache.directory, name, owned);
        }
    }
    result
}

#[cfg(test)]
#[path = "tests/proxy.rs"]
mod tests;
