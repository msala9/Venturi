use crate::{
    error::{ApiError, Result},
    export_store::{self, Record as ExportRecord, Store as ExportStore, Stored as StoredExport},
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
const MIN_FREE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_CACHE_JOBS: usize = 32;
const CACHE_TTL: Duration = Duration::from_secs(45);
const MAX_CACHE_FILES: usize = 16;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceQuery {
    pub project_epoch: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeSourceQuery {
    pub project_epoch: String,
    pub if_generation: String,
    pub revision: String,
    #[serde(default)]
    pub source_version: Option<String>,
}
pub struct NativeSourceSnapshot {
    pub spec: SourceSpec,
    pub item: Value,
}
pub(crate) fn native_asset_snapshot(
    store: &crate::asset_store::Store,
    id: &str,
    query: &NativeSourceQuery,
    require_version: bool,
) -> Result<NativeSourceSnapshot> {
    if query
        .if_generation
        .parse::<u64>()
        .ok()
        .is_none_or(|generation| generation.to_string() != query.if_generation)
    {
        return Err(ApiError::invalid(
            "Choose a captured native Source generation",
        ));
    }
    let asset = store.load(id, &query.revision)?;
    let payload = crate::asset_payload::decode(&asset)?;
    let media = payload.media_items().next().ok_or_else(ApiError::missing)?;
    if media.compound.is_some() || (!media.meta.has_video && !media.meta.has_audio) {
        return Err(ApiError::invalid(
            "Preview the first ordinary file in a native asset; compound assets must be imported into the Program viewer",
        ));
    }
    store.validate_root()?;
    let (directory, name, _) = crate::asset_jobs::store_location(store, &media.path)?;
    let file = crate::asset_store::regular(&directory, &name)?;
    let version = source_version(&file)?;
    if require_version && query.source_version.is_none()
        || query
            .source_version
            .as_ref()
            .is_some_and(|expected| expected != &version)
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Library source changed; open its preview again",
        ));
    }
    // Recheck both catalog and path after opening the raw source.
    store.load(id, &query.revision)?;
    store.validate_root()?;
    let (live_directory, live_name, _) = crate::asset_jobs::store_location(store, &media.path)?;
    if source_version(&crate::asset_store::regular(&live_directory, &live_name)?)? != version {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Library source changed; open its preview again",
        ));
    }
    let media_id = format!(
        "native-asset:{id}:{}:{}",
        query.revision, query.if_generation
    );
    let meta = media.meta.clone();
    let item = json!({"id":media_id,"name":asset.name,"folder":null,"content_hash":media.content_hash.to_string(),"duration_frames":meta.duration_frames,"fps":meta.fps,"width":meta.width,"height":meta.height,"sample_rate":meta.sample_rate,"channels":meta.channels,"is_image":meta.is_image(),"has_video":meta.has_video,"has_audio":meta.has_audio,"audio_stream_count":meta.audio_stream_count(),"compound_timeline_id":null,"offline":false,"native_asset":{"id":id,"revision":query.revision,"if_generation":query.if_generation,"source_version":version}});
    Ok(NativeSourceSnapshot {
        spec: SourceSpec {
            file,
            epoch: query.project_epoch.clone(),
            media_id,
            meta,
        },
        item,
    })
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceWindow {
    pub start_frame: i64,
    pub end_frame: i64,
}
impl SourceWindow {
    fn validate(&self, meta: &vv_core::MediaMeta) -> Result<()> {
        if meta.is_image()
            || meta.fps.num <= 0
            || meta.fps.den <= 0
            || meta.duration_frames <= 0
            || (!meta.has_video && !meta.has_audio)
            || (meta.has_video && (meta.width == 0 || meta.height == 0))
            || (meta.has_audio
                && (meta.sample_rate == 0 || meta.channels == 0 || meta.audio_streams == 0))
            || meta.width > 8192
            || meta.height > 8192
            || self.start_frame < 0
            || self.end_frame <= self.start_frame
            || self.end_frame > meta.duration_frames
            || i128::from(self.end_frame - self.start_frame) * i128::from(meta.fps.den)
                > 60 * i128::from(meta.fps.num)
        {
            return Err(ApiError::invalid(
                "Source window must be nonempty, within regular media, at most 60 seconds and 8192 pixels per dimension",
            ));
        }
        Ok(())
    }
    fn descriptor(&self, spec: &SourceSpec, identity: &str, audio_stream_index: u32) -> Value {
        json!({"start_frame":self.start_frame,"end_frame":self.end_frame,"total_frames":spec.meta.duration_frames,"fps":spec.meta.fps,"source_version":identity,"audio_stream_index":audio_stream_index})
    }
}
pub struct SourceSpec {
    pub file: File,
    pub epoch: String,
    pub media_id: String,
    pub meta: vv_core::MediaMeta,
}
impl SourceSpec {
    fn identity(&self) -> Result<String> {
        source_version(&self.file)
    }
}
pub(crate) struct PlacementVerification {
    spec: SourceSpec,
    version: String,
}
impl PlacementVerification {
    pub(crate) fn check(&self, file: &File, epoch: &str, media: &str) -> Result<()> {
        if self.spec.epoch != epoch
            || self.spec.media_id != media
            || self.spec.identity()? != self.version
            || source_version(file)? != self.version
        {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Source changed after it was loaded in the viewer",
            ));
        }
        Ok(())
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
pub(crate) fn source_version(file: &File) -> Result<String> {
    crate::asset_store::stable_identity(file)
}
struct Job {
    id: String,
    key: String,
    state: &'static str,
    progress: u64,
    error: Option<String>,
    directory: PathBuf,
    cancel: Arc<AtomicBool>,
    bytes: u64,
    touched: Instant,
    export: Option<Arc<Mutex<vv_session::export::ExportProgress>>>,
    descriptor: Option<Value>,
    source_window: Option<Value>,
    source_assets: Option<Value>,
    source_version: Option<String>,
    inputs: Inputs,
    originals: Option<Arc<crate::frame_sources::FrameSources>>,
    original_manifest: Option<crate::frame_sources::Manifest>,
    source_asset: Option<&'static str>,
    render_tag: String,
    export_epoch: Option<String>,
    program_query: Option<ProgramQuery>,
    durable: Option<StoredExport>,
    explicit_cancel: bool,
    durability_error: bool,
}
impl Job {
    fn validate_program_sources(&self) -> Result<()> {
        if !program::unchanged(&self.inputs) {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Media changed since Program preparation",
            ));
        }
        if let Some(originals) = &self.originals {
            if let Some(manifest) = &self.original_manifest {
                originals.validate_manifest(manifest)?;
            } else if self.state == "ready" {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Prepared Program source witnesses are unavailable",
                ));
            } else {
                originals.validate()?;
            }
        }
        Ok(())
    }
    fn charge(&self) -> u64 {
        if self.durable.is_some() {
            0
        } else if matches!(self.state, "queued" | "running") {
            MAX_JOB_BYTES
        } else {
            self.bytes
        }
    }
    fn touch(&mut self) {
        if self.durable.is_none() && self.state == "ready" {
            self.touched = Instant::now();
        }
    }
    fn progress_value(&self) -> Option<Value> {
        self.export
            .as_ref()
            .map(|p| {
                let decoder = self
                    .descriptor
                    .as_ref()
                    .and_then(|d| d.get("export_settings"))
                    .and_then(|s| s.get("decoder"))
                    .and_then(|d| serde_json::from_value(d.clone()).ok())
                    .unwrap_or_default();
                program::progress_value_for(&p.lock().unwrap(), decoder)
            })
            .or_else(|| {
                self.durable
                    .as_ref()
                    .and_then(|stored| stored.record.progress.clone())
            })
    }
    fn value(&self) -> Value {
        let previous = self
            .durable
            .as_ref()
            .and_then(|stored| stored.record.previous_state.as_ref());
        let revision = self.durable.as_ref().map(StoredExport::revision);
        json!({"id":self.id,"state":self.state,"frames":self.progress,"error":self.error,"program":self.descriptor,"source_window":self.source_window,"source_assets":self.source_assets,"source_version":self.source_version,"progress":self.progress_value(),"source_asset":self.source_asset,"project_epoch":self.export_epoch,"durable":self.durable.is_some(),"durability_error":self.durability_error,"cancel_requested":self.explicit_cancel,"previous_state":previous,"export_revision":revision})
    }
    fn persist(&mut self, store: &ExportStore) -> Result<()> {
        let progress = self.progress_value();
        if let Some(stored) = &mut self.durable {
            let mut record = stored.record.clone();
            record.state = self.state.into();
            record.error = self.error.clone();
            record.cancel_requested = self.explicit_cancel;
            record.progress = progress;
            record.bytes = ExportStore::bytes(stored);
            self.bytes = record.bytes;
            if let Err(error) = store.save(stored, record) {
                self.durability_error = true;
                return Err(error);
            }
            self.durability_error = false;
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct MediaJobs {
    root: Arc<PathBuf>,
    jobs: Arc<Mutex<VecDeque<Job>>>,
    send: mpsc::SyncSender<(String, Work)>,
    exports: Option<Arc<ExportStore>>,
    exports_blocked: bool,
    pub(crate) proxies: crate::proxy::Manager,
}
enum Work {
    Source(
        Box<SourceSpec>,
        (ProxyQuality, u32),
        Option<SourceWindow>,
        u32,
    ),
    SourceAll(Box<SourceSpec>, (ProxyQuality, u32), Option<SourceWindow>),
    Program(Box<ProgramTask>),
    Assets(Box<SourceSpec>, u32, bool),
    LibraryAssets(Box<SourceSpec>, u32, bool),
}
impl MediaJobs {
    pub fn software_lock_path(&self) -> PathBuf {
        self.root.join("software.lock")
    }
    #[cfg(test)]
    pub fn start() -> std::io::Result<Self> {
        Self::start_inner(None, false, None)
    }
    #[cfg(test)]
    pub fn start_with_exports(root: File) -> std::io::Result<Self> {
        match ExportStore::open(&root) {
            Ok(store) => Self::start_inner(Some(Arc::new(store)), false, Some(root)),
            Err(_) => Self::start_inner(None, true, Some(root)),
        }
    }
    pub(crate) fn start_with_exports_and_roots(
        root: File,
        media_roots: crate::media_roots::MediaRoots,
    ) -> std::io::Result<Self> {
        match ExportStore::open(&root) {
            Ok(store) => Self::start_inner_with_roots(
                Some(Arc::new(store)),
                false,
                Some(root),
                Some(media_roots),
            ),
            Err(_) => Self::start_inner_with_roots(None, true, Some(root), Some(media_roots)),
        }
    }
    #[cfg(test)]
    fn start_inner(
        exports: Option<Arc<ExportStore>>,
        exports_blocked: bool,
        proxy_root: Option<File>,
    ) -> std::io::Result<Self> {
        Self::start_inner_with_roots(exports, exports_blocked, proxy_root, None)
    }
    fn start_inner_with_roots(
        exports: Option<Arc<ExportStore>>,
        mut exports_blocked: bool,
        proxy_root: Option<File>,
        media_roots: Option<crate::media_roots::MediaRoots>,
    ) -> std::io::Result<Self> {
        let root = std::env::temp_dir().join(format!(
            "venturi-web-media-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::DirBuilder::new().mode(0o700).create(&root)?;
        let proxy_path = proxy_root
            .as_ref()
            .map(|file| PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd())))
            .unwrap_or_else(|| root.clone());
        let proxies = match media_roots {
            Some(roots) => crate::proxy::Manager::start_with_roots(&proxy_path, roots),
            None => crate::proxy::Manager::start(&proxy_path),
        }
        .map_err(|error| std::io::Error::other(error.2))?;
        let worker_proxies = proxies.clone();
        let worker_root = root.clone();
        let mut recovered = VecDeque::<Job>::new();
        if let Some(store) = &exports {
            let history = match store.recover() {
                Ok(history) => history,
                Err(_) => {
                    exports_blocked = true;
                    vec![]
                }
            };
            for stored in history {
                recovered.push_back(Job {
                    id: stored.record.id.clone(),
                    key: stored.record.key.clone(),
                    state: stored.record.state_name(),
                    progress: 0,
                    error: stored.record.error.clone(),
                    directory: stored.directory(),
                    cancel: Arc::new(AtomicBool::new(false)),
                    bytes: stored.record.bytes,
                    touched: Instant::now(),
                    export: None,
                    descriptor: Some(stored.record.program.clone()),
                    source_window: None,
                    source_assets: None,
                    source_version: None,
                    inputs: vec![],
                    originals: None,
                    original_manifest: None,
                    source_asset: None,
                    render_tag: "originals".into(),
                    export_epoch: Some(stored.record.epoch.clone()),
                    program_query: None,
                    explicit_cancel: stored.record.cancel_requested,
                    durability_error: false,
                    durable: Some(stored),
                });
            }
        }
        let jobs = Arc::new(Mutex::new(recovered));
        let owned = jobs.clone();
        let worker_exports = exports.clone();
        let (send, receive) = mpsc::sync_channel::<(String, Work)>(1);
        std::thread::spawn(move || {
            while let Ok((id, work)) = receive.recv() {
                let (directory, cancel, progress, inputs, durable) = {
                    let mut jobs = owned.lock().unwrap();
                    let Some(job) = jobs.iter_mut().find(|j| j.id == id) else {
                        continue;
                    };
                    if job.export_epoch.is_some() && job.explicit_cancel {
                        job.state = "canceled";
                        if let Some(store) = &worker_exports {
                            let _ = job.persist(store);
                        }
                        continue;
                    }
                    job.state = "running";
                    if let Some(store) = &worker_exports
                        && let Err(error) = job.persist(store)
                    {
                        job.state = "failed";
                        job.error = Some(error.1.into());
                        continue;
                    }
                    (
                        job.directory.clone(),
                        job.cancel.clone(),
                        job.export.clone(),
                        job.inputs.clone(),
                        job.durable.is_some(),
                    )
                };
                let mut original_manifest = None;
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _proxy_pause = worker_proxies.suspend()?;
                    match work {
                        Work::Source(spec, quality, window, audio_stream_index) => generate(
                            &spec,
                            &directory,
                            quality,
                            window,
                            audio_stream_index,
                            &cancel,
                            |frames| {
                                if let Some(job) =
                                    owned.lock().unwrap().iter_mut().find(|j| j.id == id)
                                {
                                    job.progress = frames;
                                }
                            },
                        ),
                        Work::SourceAll(spec, quality, window) => generate_audio(
                            &spec,
                            &directory,
                            quality,
                            window,
                            (crate::source_audio::AudioMode::All, 0),
                            &cancel,
                            |frames| {
                                if let Some(job) =
                                    owned.lock().unwrap().iter_mut().find(|job| job.id == id)
                                {
                                    job.progress = frames;
                                }
                            },
                        ),
                        Work::Assets(spec, index, waveform) => {
                            generate_assets(&spec, &directory, &cancel, index, waveform)
                        }
                        Work::LibraryAssets(spec, index, waveform) => {
                            generate_assets_profile(&spec, &directory, &cancel, index, waveform, true)
                        }
                        Work::Program(task) => {
                            task.generate(
                                &directory,
                                &cancel,
                                progress.as_ref().unwrap(),
                                &inputs,
                                durable,
                            )?;
                            original_manifest = task
                                .snapshot
                                .originals
                                .as_ref()
                                .map(|sources| sources.manifest())
                                .transpose()?;
                            Ok(())
                        }
                    }
                }))
                .unwrap_or_else(|_| Err(ApiError::invalid("Native source generation failed")));
                let mut jobs = owned.lock().unwrap();
                if let Some(job) = jobs.iter_mut().find(|j| j.id == id) {
                    let result = if job.source_assets.is_some() && cancel.load(Ordering::Relaxed) {
                        Err(ApiError::invalid("Source assets analysis was canceled"))
                    } else if job.export_epoch.is_some() && job.explicit_cancel {
                        Err(ApiError::invalid("Export was canceled"))
                    } else if job.durable.is_none()
                        && result.is_ok()
                        && !available_bytes(&directory)
                            .is_ok_and(|free| publication_fits(directory_bytes(&directory), free))
                    {
                        Err(cache_full())
                    } else {
                        result
                    };
                    match result {
                        Ok(()) => {
                            job.original_manifest = original_manifest;
                            let published = job.validate_program_sources().and_then(|()| {
                                match (&worker_exports, &mut job.durable) {
                                    (Some(store), Some(stored)) => {
                                        store.publish_output(stored).map(|output| {
                                            stored.record.output = Some(output);
                                        })
                                    }
                                    _ => Ok(()),
                                }
                            });
                            match published {
                                Ok(()) => {
                                    job.state = "ready";
                                    if job.program_query.is_some()
                                        && let Some(descriptor) = &mut job.descriptor
                                        && descriptor["audio_present"].as_bool() == Some(true)
                                    {
                                        descriptor["telemetry"] = crate::audio_telemetry::descriptor(&directory)
                                            .unwrap_or_else(|_| json!({"state":"unavailable","error":"Prepared audio telemetry is unavailable"}));
                                    }
                                    job.bytes = directory_bytes(&directory);
                                    job.touch();
                                }
                                Err(error) => {
                                    job.state = "failed";
                                    job.error = Some(error.1.into());
                                }
                            }
                        }
                        Err(error) => {
                            let canceled = if job.export_epoch.is_some() {
                                job.explicit_cancel
                            } else {
                                cancel.load(Ordering::Relaxed)
                            };
                            job.state = if canceled { "canceled" } else { "failed" };
                            job.error = Some(error.1.into());
                            if job.durable.is_none() {
                                let _ = reclaim(job);
                            }
                        }
                    }
                    if let Some(store) = &worker_exports
                        && let Err(error) = job.persist(store)
                    {
                        if job.state == "ready" {
                            job.state = "failed";
                        }
                        job.error = Some(error.1.into());
                    }
                }
                trim(&mut jobs);
            }
            let mut jobs = owned.lock().unwrap();
            jobs.retain_mut(|job| job.durable.is_some() || !reclaim(job));
            let _ = remove_cache_directory(&worker_root);
        });
        Ok(Self {
            root: Arc::new(root),
            jobs,
            send,
            exports,
            exports_blocked,
            proxies,
        })
    }
    pub fn prepare(&self, spec: SourceSpec, quality: &str) -> Result<Value> {
        self.prepare_selected(spec, quality, None, 0)
    }
    pub fn prepare_window(
        &self,
        spec: SourceSpec,
        quality: &str,
        window: SourceWindow,
    ) -> Result<Value> {
        self.prepare_selected(spec, quality, Some(window), 0)
    }
    pub fn prepare_selected(
        &self,
        spec: SourceSpec,
        quality: &str,
        window: Option<SourceWindow>,
        audio_stream_index: u32,
    ) -> Result<Value> {
        self.prepare_audio(
            spec,
            quality,
            window,
            crate::source_audio::AudioMode::Selected,
            audio_stream_index,
        )
    }
    pub fn prepare_audio(
        &self,
        spec: SourceSpec,
        quality: &str,
        window: Option<SourceWindow>,
        mode: crate::source_audio::AudioMode,
        audio_stream_index: u32,
    ) -> Result<Value> {
        crate::source_audio::selection(&spec.meta, mode, audio_stream_index)
            .map_err(|_| ApiError::invalid("Invalid source audio mode or stream ordinal"))?;
        let original = quality == "original";
        let quality = if original {
            ProxyQuality::High
        } else {
            ProxyQuality::from_id(quality).ok_or_else(|| {
                ApiError::invalid("Choose original, low, medium or high Source quality")
            })?
        };
        let max_width = if original { 8192 } else { quality.max_width() };
        let seconds = spec.meta.duration_frames as f64 / spec.meta.fps.as_f64();
        if let Some(window) = window {
            window.validate(&spec.meta)?;
        } else if (!spec.meta.is_image()
            && (!seconds.is_finite() || seconds <= 0.0 || seconds > 600.0))
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
        let identity = spec.identity()?;
        let key = source_audio_key(&spec, quality, window, &identity, mode, audio_stream_index);
        let key = if original {
            format!("{key}:original-width")
        } else {
            key
        };
        let source_window = window.map(|window| {
            let mut descriptor = window.descriptor(&spec, &identity, audio_stream_index);
            descriptor["audio_mode"] = json!(mode);
            if mode == crate::source_audio::AudioMode::All {
                descriptor["audio_stream_index"] = Value::Null;
            }
            descriptor
        });
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs
            .iter_mut()
            .find(|j| j.key == key && !matches!(j.state, "failed" | "canceled"))
        {
            job.touch();
            return Ok(job.value());
        }
        admit_source_audio_memory(&spec.meta, max_width, window, mode)?;
        if jobs.iter().any(|job| job.state == "queued") {
            return Err(ApiError::conflict(
                "SOURCE_BUSY",
                "One source job is running and one is pending",
            ));
        }
        admit_cache(&mut jobs, &self.root)?;
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
            touched: Instant::now(),
            export: None,
            descriptor: None,
            source_window,
            source_assets: None,
            source_version: Some(identity),
            program_query: None,
            inputs: vec![],
            originals: None,
            original_manifest: None,
            source_asset: Some(source_asset),
            render_tag: "originals".into(),
            export_epoch: None,
            durable: None,
            explicit_cancel: false,
            durability_error: false,
        });
        let work = match mode {
            crate::source_audio::AudioMode::Selected => Work::Source(
                Box::new(spec),
                (quality, max_width),
                window,
                audio_stream_index,
            ),
            crate::source_audio::AudioMode::All => {
                Work::SourceAll(Box::new(spec), (quality, max_width), window)
            }
        };
        if self.send.try_send((id.clone(), work)).is_err() {
            reject_ephemeral(&mut jobs);
            return Err(ApiError::conflict(
                "SOURCE_BUSY",
                "One source job is running and one is pending",
            ));
        }
        preempt_assets(&jobs);
        Ok(jobs.back().unwrap().value())
    }
    pub fn prepare_assets(&self, spec: SourceSpec) -> Result<Value> {
        self.prepare_assets_selected(spec, 0)
    }
    pub fn prepare_assets_selected(
        &self,
        spec: SourceSpec,
        audio_stream_index: u32,
    ) -> Result<Value> {
        self.prepare_assets_options(spec, audio_stream_index, true)
    }
    pub fn prepare_assets_options(
        &self,
        spec: SourceSpec,
        audio_stream_index: u32,
        include_waveform: bool,
    ) -> Result<Value> {
        self.prepare_assets_profile(spec, audio_stream_index, include_waveform, false)
    }
    pub(crate) fn prepare_library_thumbnail(&self, spec: SourceSpec) -> Result<Value> {
        if !spec.meta.has_video {
            return Err(ApiError::invalid(
                "Library thumbnails require ordinary video or images",
            ));
        }
        self.prepare_assets_profile(spec, 0, false, true)
    }
    pub(crate) fn prepare_library_waveform(
        &self,
        spec: SourceSpec,
        audio_stream_index: u32,
    ) -> Result<Value> {
        if !spec.meta.has_audio {
            return Err(ApiError::invalid("Library waveforms require an audio stream"));
        }
        self.prepare_assets_profile(spec, audio_stream_index, true, true)
    }
    fn prepare_assets_profile(
        &self,
        spec: SourceSpec,
        audio_stream_index: u32,
        include_waveform: bool,
        library_thumbnail: bool,
    ) -> Result<Value> {
        if library_thumbnail {
            validate_assets_meta_profile(&spec.meta, true)?;
        } else {
            validate_assets_meta(&spec.meta)?;
        }
        validate_source_audio(&spec.meta, audio_stream_index)?;
        if !spec.meta.has_video && !include_waveform {
            return Err(ApiError::invalid(
                "Audio-only assets require waveform analysis",
            ));
        }
        let identity = spec.identity()?;
        let mut key = assets_key(&spec, &identity, audio_stream_index, include_waveform);
        if library_thumbnail {
            key.push_str(":library-thumbnail:96");
        }
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter_mut().find(|job| {
            job.key == key
                && !matches!(job.state, "failed" | "canceled")
                && !job.cancel.load(Ordering::Relaxed)
        }) {
            job.touch();
            return Ok(job.value());
        }
        admit_source_memory(&spec.meta, 256, true)?;
        if jobs
            .iter()
            .any(|job| matches!(job.state, "queued" | "running"))
        {
            return Err(ApiError::conflict(
                "SOURCE_BUSY",
                "Wait for foreground media preparation before analyzing source assets",
            ));
        }
        admit_cache(&mut jobs, &self.root)?;
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let directory = self.root.join(&id);
        std::fs::create_dir(&directory).map_err(|_| ApiError::io())?;
        jobs.push_back(Job {
            id: id.clone(), key, state: "queued", progress: 0, error: None,
            directory, cancel: Arc::new(AtomicBool::new(false)), bytes: 0,
            touched: Instant::now(), export: None, descriptor: None, source_window: None,
            source_assets: Some(json!({"source_version":identity,"total_frames":spec.meta.duration_frames,"fps":spec.meta.fps,"has_video":spec.meta.has_video,"has_audio":spec.meta.has_audio,"audio_stream_index":audio_stream_index,"include_waveform":include_waveform})),
            source_version: None,
            inputs: vec![], originals: None, original_manifest: None,
            source_asset: None, render_tag: "originals".into(), export_epoch: None, program_query: None,
            durable: None, explicit_cancel: false, durability_error: false,
        });
        if library_thumbnail {
            jobs.back_mut().unwrap().source_assets.as_mut().unwrap()["thumbnail_width"] = json!(96);
        }
        let work = if library_thumbnail {
            Work::LibraryAssets(Box::new(spec), audio_stream_index, include_waveform)
        } else {
            Work::Assets(Box::new(spec), audio_stream_index, include_waveform)
        };
        if self.send.try_send((id, work)).is_err() {
            reject_ephemeral(&mut jobs);
            return Err(ApiError::conflict(
                "SOURCE_BUSY",
                "The media worker is busy",
            ));
        }
        Ok(jobs.back().unwrap().value())
    }
    pub fn prepare_program(&self, mut task: ProgramTask) -> Result<Value> {
        if task.export.is_some() {
            self.check_exports()?;
            task.snapshot.video = Default::default();
        }
        task.validate()?;
        if task.export.is_none() {
            task.snapshot.video = Arc::new(crate::proxy_video::Selection::capture(
                &self.proxies,
                &task.snapshot,
            )?);
        }
        let render_tag = task.snapshot.video.tag.clone();
        let key = task.key();
        let inputs = task.inputs()?;
        task.snapshot.video.validate()?;
        let originals = task.snapshot.originals.clone();
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter_mut().find(|j| {
            j.inputs == inputs
                && j.render_tag == render_tag
                && j.originals.is_some() == originals.is_some()
                && j.validate_program_sources().is_ok()
                && (j.state != "ready"
                    || originals.as_ref().is_none_or(|originals| {
                        j.original_manifest
                            .as_ref()
                            .is_some_and(|manifest| originals.validate_manifest(manifest).is_ok())
                    }))
                && ((j.key == key && !matches!(j.state, "failed" | "canceled"))
                    || (task.export.is_none()
                        && j.state == "ready"
                        && j.key.ends_with(":telemetry:v2")
                        && j.program_query
                            .as_ref()
                            .is_some_and(|range| range.contains(&task.query))))
        }) {
            job.touch();
            return Ok(job.value());
        }
        task.admit_memory()?;
        if jobs.iter().any(|job| job.state == "queued") {
            return Err(ApiError::conflict(
                "MEDIA_BUSY",
                "One media job is running and one is pending",
            ));
        }
        if task.export.is_none() || self.exports.is_none() {
            admit_cache(&mut jobs, &self.root)?;
        } else {
            trim(&mut jobs);
        }
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let mut directory = self.root.join(&id);
        let descriptor = task.descriptor(&directory);
        let progress = vv_session::export::ExportProgress {
            total_frames: task.query.end_frame - task.query.start_frame,
            ..Default::default()
        };
        let durable = if let Some(store) = &self.exports
            && task.export.is_some()
        {
            let stored = store.admit(ExportRecord {
                version: 1,
                id: id.clone(),
                key: key.clone(),
                epoch: task.query.project_epoch.clone(),
                state: "queued".into(),
                previous_state: None,
                cancel_requested: false,
                error: None,
                program: descriptor.clone(),
                progress: Some(program::progress_value(&progress)),
                bytes: 0,
                output: None,
                discard: None,
            })?;
            directory = stored.directory();
            Some(stored)
        } else {
            std::fs::create_dir(&directory).map_err(|_| ApiError::io())?;
            None
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
            touched: Instant::now(),
            export: Some(Arc::new(Mutex::new(progress))),
            descriptor: Some(descriptor),
            source_window: None,
            source_assets: None,
            source_version: None,
            program_query: task.export.is_none().then(|| task.query.clone()),
            inputs,
            originals,
            original_manifest: None,
            source_asset: None,
            render_tag,
            export_epoch: task
                .export
                .as_ref()
                .map(|_| task.query.project_epoch.clone()),
            durable,
            explicit_cancel: false,
            durability_error: false,
        });
        if self
            .send
            .try_send((id, Work::Program(Box::new(task))))
            .is_err()
        {
            if let Some(job) = jobs.back_mut()
                && job.durable.is_some()
            {
                job.state = "failed";
                job.error = Some("MEDIA_BUSY".into());
                if let Some(store) = &self.exports {
                    job.persist(store)?;
                }
            } else {
                reject_ephemeral(&mut jobs);
            }
            return Err(ApiError::conflict(
                "MEDIA_BUSY",
                "One media job is running and one is pending",
            ));
        }
        preempt_assets(&jobs);
        Ok(jobs.back().unwrap().value())
    }
    pub fn cached_programs(&self, snapshot: &crate::preview::FrameSnapshot) -> Vec<Value> {
        if snapshot.video.validate().is_err() {
            return vec![];
        }
        let Ok(inputs) = program::preview_inputs(snapshot) else {
            return vec![];
        };
        self.jobs.lock().unwrap().iter().filter_map(|job| {
            let range = job.program_query.as_ref()?;
            let originals_match = match (&snapshot.originals, &job.originals, &job.original_manifest) {
                (Some(originals), Some(_), Some(manifest)) => originals.validate_manifest(manifest).is_ok(),
                (None, None, _) => true,
                _ => false,
            };
            (job.state == "ready" && job.render_tag == snapshot.video.tag
                && range.frame().same_composition(&snapshot.query) && job.inputs == inputs
                && originals_match && job.validate_program_sources().is_ok())
                .then(|| json!({"id":job.id,"start_frame":range.start_frame,"end_frame":range.end_frame}))
        }).collect()
    }
    pub fn program_status(&self, id: &str, query: &ProgramQuery, cancel: bool) -> Result<Value> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && (j.key == query.preview_key() || j.key == query.key()))
            .ok_or_else(ApiError::missing)?;
        if !cancel {
            job.validate_program_sources()?;
        }
        if cancel && matches!(job.state, "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
        }
        if !cancel {
            job.touch();
        }
        Ok(job.value())
    }
    pub fn export_status(&self, id: &str, epoch: &str, cancel: bool) -> Result<Value> {
        self.check_exports()?;
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && j.export_epoch.as_deref() == Some(epoch))
            .ok_or_else(ApiError::missing)?;
        if cancel && matches!(job.state, "queued" | "running") {
            job.explicit_cancel = true;
            job.cancel.store(true, Ordering::Relaxed);
            if let Some(store) = &self.exports {
                job.persist(store)?;
            }
        }
        if !cancel {
            job.touch();
        }
        Ok(job.value())
    }
    pub fn export_history(&self) -> Result<Value> {
        self.check_exports()?;
        let jobs = self.jobs.lock().unwrap();
        let exports: Vec<_> = jobs
            .iter()
            .filter(|job| job.export_epoch.is_some())
            .collect();
        let charged = exports
            .iter()
            .filter_map(|job| job.durable.as_ref())
            .fold(0u64, |total, stored| {
                total.saturating_add(stored.record.charge())
            });
        Ok(
            json!({"jobs":exports.iter().rev().map(|job| job.value()).collect::<Vec<_>>(),"capacity":{"max_jobs":export_store::MAX_JOBS,"max_bytes":export_store::MAX_TOTAL,"reservation_bytes":export_store::MAX_OUTPUT,"used_jobs":exports.len(),"charged_bytes":charged}}),
        )
    }
    pub fn export_discard(&self, id: &str, request: export_store::DiscardRequest) -> Result<Value> {
        self.check_exports()?;
        request.validate()?;
        let mut jobs = self.jobs.lock().unwrap();
        let index = jobs
            .iter()
            .position(|job| {
                job.id == id && job.export_epoch.as_deref() == Some(request.project_epoch.as_str())
            })
            .ok_or_else(ApiError::missing)?;
        let job = &mut jobs[index];
        if job.durability_error
            || !matches!(
                job.state,
                "ready" | "failed" | "canceled" | "interrupted" | "discarding"
            )
        {
            return Err(ApiError::conflict(
                "EXPORT_ACTIVE",
                "Only terminal saved exports with durable metadata may be discarded",
            ));
        }
        let stored = job.durable.as_mut().ok_or_else(|| {
            ApiError::conflict("EXPORT_NOT_DURABLE", "Only saved exports may be discarded")
        })?;
        let store = self.exports.as_ref().ok_or_else(ApiError::io)?;
        if let Err(error) = store.discard(stored, &request) {
            if stored.record.state == "discarding" {
                job.state = "discarding";
                job.bytes = stored.record.charge();
                job.error = Some(error.1.into());
            } else if error.1 == "IO_ERROR" {
                job.state = "failed";
                job.durability_error = true;
                job.error = Some(error.1.into());
            }
            return Err(error);
        }
        jobs.remove(index);
        Ok(json!({"id":id,"status":"discarded","project_epoch":request.project_epoch}))
    }
    pub fn export_asset(&self, id: &str, epoch: &str) -> Result<File> {
        self.check_exports()?;
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && j.export_epoch.as_deref() == Some(epoch))
            .ok_or_else(ApiError::missing)?;
        if job.state != "ready" {
            return Err(ApiError::conflict(
                "EXPORT_NOT_READY",
                "Wait for export completion",
            ));
        }
        if let Some(stored) = &job.durable {
            return self
                .exports
                .as_ref()
                .ok_or_else(ApiError::io)?
                .output(stored);
        }
        let file = open_cache_asset(&job.directory.join("program.mp4"))?;
        job.touch();
        Ok(file)
    }
    fn check_exports(&self) -> Result<()> {
        if self.exports_blocked {
            return Err(ApiError::conflict(
                "EXPORT_HISTORY_UNAVAILABLE",
                "Export history could not be opened or recovered; files were preserved. Editing and previews remain available.",
            ));
        }
        Ok(())
    }
    pub fn program_asset(&self, id: &str, query: &ProgramQuery) -> Result<File> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && (j.key == query.preview_key() || j.key == query.key()))
            .ok_or_else(ApiError::missing)?;
        if job.state != "ready" {
            return Err(ApiError::conflict(
                "PROGRAM_NOT_READY",
                "Wait for composed preview preparation",
            ));
        }
        job.validate_program_sources()?;
        let file = open_cache_asset(&job.directory.join("program.mp4"))?;
        job.touch();
        Ok(file)
    }
    pub fn program_meters(
        &self,
        id: &str,
        query: &ProgramQuery,
        from_bin: u64,
        limit: u32,
        insert: Option<&crate::audition::InsertQuery>,
    ) -> Result<Value> {
        if !(1..=64).contains(&limit)
            || insert.is_some_and(|value| value.channel.len() > 20 || value.index >= 32)
        {
            return Err(ApiError::invalid(
                "Choose a bounded prepared audio telemetry page",
            ));
        }
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|job| {
                job.id == id
                    && (job.key == query.preview_key() || job.key == query.key())
                    && job.program_query.is_some()
            })
            .ok_or_else(ApiError::missing)?;
        if job.state != "ready" {
            return Err(ApiError::conflict(
                "PROGRAM_NOT_READY",
                "Wait for composed preview preparation",
            ));
        }
        job.validate_program_sources()?;
        let mut page = crate::audio_telemetry::read(&job.directory, from_bin, limit, insert)?;
        page["job_id"] = json!(id);
        page["query"] = serde_json::to_value(query).map_err(|_| ApiError::io())?;
        job.touch();
        Ok(page)
    }
    fn authorized<'a>(
        jobs: &'a mut VecDeque<Job>,
        id: &str,
        spec: &SourceSpec,
    ) -> Result<&'a mut Job> {
        let identity = spec.identity()?;
        let prefix = format!("{}:{}:{}:v1:", spec.epoch, spec.media_id, identity);
        let ranged_prefix = format!("{}:{}:{}:v2-window:", spec.epoch, spec.media_id, identity);
        let assets_prefix = format!("{}:{}:{}:v3-assets:", spec.epoch, spec.media_id, identity);
        jobs.iter_mut()
            .find(|j| {
                j.id == id
                    && (j.key.starts_with(&prefix)
                        || j.key.starts_with(&ranged_prefix)
                        || j.key.starts_with(&assets_prefix))
            })
            .ok_or_else(ApiError::missing)
    }
    pub fn status(&self, id: &str, spec: &SourceSpec, cancel: bool) -> Result<Value> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = Self::authorized(&mut jobs, id, spec)?;
        if cancel && matches!(job.state, "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
        }
        if !cancel {
            job.touch();
        }
        Ok(job.value())
    }
    pub(crate) fn verify_placement(
        &self,
        id: &str,
        version: &str,
        spec: SourceSpec,
    ) -> Result<PlacementVerification> {
        if spec.identity()? != version {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Source changed after it was loaded in the viewer",
            ));
        }
        let mut jobs = self.jobs.lock().unwrap();
        let job = Self::authorized(&mut jobs, id, &spec)?;
        if job.state != "ready"
            || job.source_asset.is_none()
            || job.source_assets.is_some()
            || job.program_query.is_some()
            || job.source_version.as_deref() != Some(version)
            || job.explicit_cancel
            || job.cancel.load(Ordering::Relaxed)
        {
            return Err(ApiError::conflict(
                "SOURCE_NOT_READY",
                "Place only the currently loaded ready Source job",
            ));
        }
        job.touch();
        Ok(PlacementVerification {
            spec,
            version: version.into(),
        })
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
        let file = open_cache_asset(&job.directory.join(name))?;
        job.touch();
        Ok(file)
    }
}
fn preempt_assets(jobs: &VecDeque<Job>) {
    for job in jobs {
        if job.state == "running" && job.source_assets.is_some() {
            job.cancel.store(true, Ordering::Relaxed);
        }
    }
}
fn assets_key(
    spec: &SourceSpec,
    identity: &str,
    audio_stream_index: u32,
    include_waveform: bool,
) -> String {
    format!(
        "{}:{}:{}:v3-assets:full:audio:{audio_stream_index}:waveform:{include_waveform}",
        spec.epoch, spec.media_id, identity
    )
}
fn validate_assets_meta(meta: &vv_core::MediaMeta) -> Result<()> {
    validate_assets_meta_profile(meta, false)
}
fn validate_assets_meta_profile(meta: &vv_core::MediaMeta, library_thumbnail: bool) -> Result<()> {
    let seconds = meta.duration_frames as f64 / meta.fps.as_f64();
    if meta.fps.num <= 0
        || meta.fps.den <= 0
        || meta.duration_frames <= 0
        || !seconds.is_finite()
        || seconds <= 0.0
        || (!meta.has_video && !meta.has_audio)
        || (meta.has_video && (meta.width == 0 || meta.height == 0))
        || (meta.has_audio
            && (meta.sample_rate == 0
                || meta.channels == 0
                || if library_thumbnail {
                    meta.audio_stream_count() == 0
                } else {
                    meta.audio_streams == 0
                }))
        || meta.width > 8192
        || meta.height > 8192
    {
        return Err(ApiError::invalid(
            "Source assets require valid media metadata and dimensions up to 8192 pixels",
        ));
    }
    Ok(())
}
fn same_assets_meta(expected: &vv_core::MediaMeta, actual: &vv_core::MediaMeta) -> bool {
    same_assets_meta_profile(expected, actual, false)
}
fn same_assets_meta_profile(
    expected: &vv_core::MediaMeta,
    actual: &vv_core::MediaMeta,
    library_thumbnail: bool,
) -> bool {
    expected.duration_frames == actual.duration_frames
        && expected.fps == actual.fps
        && expected.width == actual.width
        && expected.height == actual.height
        && expected.has_video == actual.has_video
        && expected.has_audio == actual.has_audio
        && expected.sample_rate == actual.sample_rate
        && expected.channels == actual.channels
        && if library_thumbnail && expected.has_audio {
            expected.audio_stream_count() == actual.audio_stream_count()
        } else {
            expected.audio_streams == actual.audio_streams
        }
}
fn assets_probe(
    spec: &SourceSpec,
    path: &Path,
    identity: &str,
    cancel: &AtomicBool,
    library_thumbnail: bool,
) -> Result<()> {
    let actual = if spec.meta.is_image() {
        crate::asset_probe::probe(&spec.file, true, cancel)
            .map_err(|_| ApiError::invalid("Source assets image is unreadable"))?
    } else {
        vv_media::probe_media(path)
            .map_err(|_| ApiError::invalid("Source assets media is unreadable"))?
    };
    validate_assets_meta_profile(&actual, library_thumbnail)?;
    if !same_assets_meta_profile(&spec.meta, &actual, library_thumbnail)
        || spec.identity()? != identity
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Reimport changed media before analyzing source assets",
        ));
    }
    Ok(())
}
fn assets_keep_running(directory: &Path, cancel: &AtomicBool, started: Instant) -> bool {
    !cancel.load(Ordering::Relaxed)
        && started.elapsed() < Duration::from_secs(600)
        && directory_bytes(directory) < MAX_JOB_BYTES
        && disk_headroom(directory)
}
fn write_asset(directory: &Path, name: &str, bytes: &[u8], limit: usize) -> Result<()> {
    if bytes.len() > limit {
        return Err(ApiError::invalid(
            "Source asset exceeds its bounded output size",
        ));
    }
    std::fs::write(directory.join(name), bytes).map_err(|_| ApiError::io())
}
fn generate_assets(
    spec: &SourceSpec,
    directory: &Path,
    cancel: &AtomicBool,
    audio_stream_index: u32,
    include_waveform: bool,
) -> Result<()> {
    generate_assets_profile(
        spec,
        directory,
        cancel,
        audio_stream_index,
        include_waveform,
        false,
    )
}
fn generate_assets_profile(
    spec: &SourceSpec,
    directory: &Path,
    cancel: &AtomicBool,
    audio_stream_index: u32,
    include_waveform: bool,
    library_thumbnail: bool,
) -> Result<()> {
    if library_thumbnail {
        validate_assets_meta_profile(&spec.meta, true)?;
    } else {
        validate_assets_meta(&spec.meta)?;
    }
    validate_source_audio(&spec.meta, audio_stream_index)?;
    admit_source_memory(&spec.meta, 256, true)?;
    let started = Instant::now();
    let identity = spec.identity()?;
    let path = PathBuf::from(format!("/proc/self/fd/{}", spec.file.as_raw_fd()));
    assets_probe(spec, &path, &identity, cancel, library_thumbnail)?;
    let budget =
        || ApiError::invalid("Source assets analysis canceled or exceeded its resource budget");
    if !assets_keep_running(directory, cancel, started) {
        return Err(budget());
    }
    let seconds = if library_thumbnail && spec.meta.is_image() {
        0.0
    } else {
        spec.meta.duration_frames as f64 / spec.meta.fps.as_f64()
    };
    if spec.meta.has_video {
        if spec.meta.is_image() && !library_thumbnail {
            let thumbnail = owned_image_output(&directory.join("thumb.png"))?;
            crate::image_derivative::generate_thumbnail(
                &spec.file,
                &thumbnail,
                (spec.meta.width, spec.meta.height),
                cancel,
                || assets_keep_running(directory, cancel, started),
            )?;
        } else {
            let width = if library_thumbnail { 96 } else { 256 };
            let thumb = vv_media::thumbnail::generate_thumbnail_bounded(&path, seconds, width)
                .map_err(|_| ApiError::invalid("Source thumbnail generation failed"))?;
            if !assets_keep_running(directory, cancel, started) {
                return Err(budget());
            }
            write_asset(
                directory,
                "thumb.png",
                &encode_png(&thumb.rgba, (thumb.width, thumb.height))?,
                1024 * 1024,
            )?;
        }
    }
    if spec.meta.has_audio && include_waveform {
        // JSON is larger than the native binary peak cache.
        let num_peaks = vv_media::recommended_num_peaks(seconds).min(65_536);
        let selected = usize::try_from(audio_stream_index)
            .map_err(|_| ApiError::invalid("Invalid source audio stream index"))?;
        let waveforms =
            vv_media::waveform::analyze_waveforms(&path, &[selected], num_peaks, || {
                assets_keep_running(directory, cancel, started)
            })
            .map_err(|_| budget())?;
        let waveform = waveforms
            .first()
            .and_then(Option::as_ref)
            .ok_or_else(|| ApiError::invalid("Source audio stream is unavailable"))?;
        if !waveform.audio_duration_secs.is_finite()
            || waveform.audio_duration_secs <= 0.0
            || waveform.peaks.iter().any(|peak| !peak.is_finite())
        {
            return Err(ApiError::invalid("Source waveform timing is invalid"));
        }
        let bytes = serde_json::to_vec(&json!({"scope":"full_source","duration_seconds":waveform.audio_duration_secs,"peaks":waveform.peaks}))
            .map_err(|_| ApiError::io())?;
        if !assets_keep_running(directory, cancel, started) {
            return Err(budget());
        }
        write_asset(directory, "waveform.json", &bytes, 4 * 1024 * 1024)?;
    }
    assets_probe(spec, &path, &identity, cancel, library_thumbnail)?;
    if !assets_keep_running(directory, cancel, started) {
        return Err(budget());
    }
    Ok(())
}
fn validate_source_audio(meta: &vv_core::MediaMeta, index: u32) -> Result<()> {
    let index = usize::try_from(index)
        .map_err(|_| ApiError::invalid("Invalid source audio stream index"))?;
    if (meta.has_audio && index >= meta.audio_stream_count()) || (!meta.has_audio && index != 0) {
        return Err(ApiError::invalid(
            "Choose an available native source audio stream",
        ));
    }
    Ok(())
}
fn source_key(
    spec: &SourceSpec,
    quality: ProxyQuality,
    window: Option<SourceWindow>,
    identity: &str,
    audio_stream_index: u32,
) -> String {
    let key = match window {
        Some(window) => format!(
            "{}:{}:{}:v2-window:{}:{}:{}",
            spec.epoch,
            spec.media_id,
            identity,
            quality.id(),
            window.start_frame,
            window.end_frame
        ),
        None => format!(
            "{}:{}:{}:v1:{}",
            spec.epoch,
            spec.media_id,
            identity,
            quality.id()
        ),
    };
    format!("{key}:audio:{audio_stream_index}")
}
fn trim(jobs: &mut VecDeque<Job>) {
    trim_for(jobs, 0, 24, Instant::now());
}

fn cache_full() -> ApiError {
    ApiError::conflict(
        "SOURCE_CACHE_FULL",
        "Preview cache or free disk space is full; stop unused playback and wait before retrying",
    )
}
fn cache_charge(jobs: &VecDeque<Job>) -> u64 {
    jobs.iter()
        .fold(0u64, |total, job| total.saturating_add(job.charge()))
}
fn cache_count(jobs: &VecDeque<Job>) -> usize {
    jobs.iter().filter(|job| job.durable.is_none()).count()
}
fn reserved_bytes(jobs: &VecDeque<Job>) -> u64 {
    jobs.iter()
        .filter(|job| job.durable.is_none() && matches!(job.state, "queued" | "running"))
        .fold(0u64, |total, _| total.saturating_add(MAX_JOB_BYTES))
}
fn admission_fits(jobs: &VecDeque<Job>, free: u64) -> bool {
    cache_count(jobs) < MAX_CACHE_JOBS
        && cache_charge(jobs).saturating_add(MAX_JOB_BYTES) <= MAX_CACHE_BYTES
        && free
            >= MIN_FREE_BYTES
                .saturating_add(reserved_bytes(jobs))
                .saturating_add(MAX_JOB_BYTES)
}
fn publication_fits(bytes: u64, free: u64) -> bool {
    bytes <= MAX_JOB_BYTES && free >= MIN_FREE_BYTES
}
fn admit_cache(jobs: &mut VecDeque<Job>, root: &Path) -> Result<()> {
    let now = Instant::now();
    trim_for(jobs, MAX_JOB_BYTES, MAX_CACHE_JOBS, now);
    let mut free = available_bytes(root)?;
    let mut index = 0;
    while !admission_fits(jobs, free) && index < jobs.len() {
        if reclaimable(&jobs[index], now) && reclaim(&mut jobs[index]) {
            jobs.remove(index);
            free = available_bytes(root)?;
        } else {
            index += 1;
        }
    }
    if !admission_fits(jobs, free) {
        return Err(cache_full());
    }
    Ok(())
}
fn reclaimable(job: &Job, now: Instant) -> bool {
    job.durable.is_none()
        && !matches!(job.state, "queued" | "running")
        && !(job.state == "ready" && now.saturating_duration_since(job.touched) < CACHE_TTL)
}
fn trim_for(jobs: &mut VecDeque<Job>, extra: u64, count_limit: usize, now: Instant) {
    let mut index = 0;
    while index < jobs.len()
        && (cache_count(jobs) >= count_limit
            || cache_charge(jobs).saturating_add(extra) > MAX_CACHE_BYTES)
    {
        let job = &mut jobs[index];
        if reclaimable(job, now) && reclaim(job) {
            jobs.remove(index);
        } else {
            index += 1;
        }
    }
}
fn reject_ephemeral(jobs: &mut VecDeque<Job>) {
    if let Some(job) = jobs.back_mut() {
        job.state = "failed";
        job.error = Some("MEDIA_BUSY".into());
        if reclaim(job) {
            jobs.pop_back();
        }
    }
}
fn reclaim(job: &mut Job) -> bool {
    reclaim_with(job, remove_cache_directory)
}
fn reclaim_with(job: &mut Job, remove: impl FnOnce(&Path) -> std::io::Result<()>) -> bool {
    match remove(&job.directory) {
        Ok(()) => {
            job.bytes = 0;
            true
        }
        Err(error) => {
            job.bytes = measured_directory_bytes(&job.directory)
                .unwrap_or_else(|_| job.bytes.max(MAX_CACHE_BYTES));
            if job.state == "ready" && error.kind() != std::io::ErrorKind::WouldBlock {
                job.state = "failed";
                job.error = Some("SOURCE_CACHE_RECLAIM_FAILED".into());
            }
            false
        }
    }
}
fn available_bytes(path: &Path) -> Result<u64> {
    let directory = File::open(path).map_err(|_| ApiError::io())?;
    let stat = rustix::fs::fstatvfs(&directory).map_err(|_| ApiError::io())?;
    Ok(stat.f_bavail.saturating_mul(stat.f_frsize))
}
pub(crate) fn disk_headroom(path: &Path) -> bool {
    available_bytes(path).is_ok_and(|bytes| bytes >= MIN_FREE_BYTES)
}
fn open_cache_asset(path: &Path) -> Result<File> {
    use rustix::fs::{Mode, OFlags};
    let file: File = rustix::fs::open(
        path,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| ApiError::missing())?
    .into();
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::missing());
    }
    rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockShared).map_err(|_| {
        ApiError::conflict(
            "SOURCE_CACHE_BUSY",
            "Preview cache entry is being reclaimed",
        )
    })?;
    Ok(file)
}
fn remove_cache_directory(path: &Path) -> std::io::Result<()> {
    use rustix::fs::{AtFlags, Mode, OFlags};
    let directory: File = match rustix::fs::open(
        path,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(directory) => directory.into(),
        Err(rustix::io::Errno::NOENT) => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let anchored = PathBuf::from(format!("/proc/self/fd/{}", directory.as_raw_fd()));
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&anchored)? {
        if files.len() >= MAX_CACHE_FILES {
            return Err(std::io::Error::other(
                "Preview cache contains too many files",
            ));
        }
        let entry = entry?;
        let file: File = rustix::fs::openat(
            &directory,
            entry.file_name(),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )?
        .into();
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::other(
                "Preview cache contains a nonregular entry",
            ));
        }
        rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive)?;
        files.push((entry.file_name(), file));
    }
    for (name, file) in &files {
        let expected = file.metadata()?;
        let actual = std::fs::symlink_metadata(anchored.join(name))?;
        if !actual.is_file() || actual.dev() != expected.dev() || actual.ino() != expected.ino() {
            return Err(std::io::Error::other("Preview cache entry changed"));
        }
        rustix::fs::unlinkat(&directory, name, AtFlags::empty())?;
    }
    directory.sync_all()?;
    let expected = directory.metadata()?;
    let actual = std::fs::symlink_metadata(path)?;
    if !actual.is_dir() || actual.dev() != expected.dev() || actual.ino() != expected.ino() {
        return Err(std::io::Error::other("Preview cache directory changed"));
    }
    std::fs::remove_dir(path)?;
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}
fn directory_bytes(path: &Path) -> u64 {
    measured_directory_bytes(path).unwrap_or(MAX_CACHE_BYTES)
}
fn measured_directory_bytes(path: &Path) -> std::io::Result<u64> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };
    if !metadata.is_dir() {
        return Err(std::io::Error::other("Preview cache is not a directory"));
    }
    let mut bytes = 0u64;
    for (count, entry) in std::fs::read_dir(path)?.enumerate() {
        if count >= MAX_CACHE_FILES {
            return Err(std::io::Error::other(
                "Preview cache contains too many files",
            ));
        }
        let metadata = std::fs::symlink_metadata(entry?.path())?;
        if !metadata.is_file() {
            return Err(std::io::Error::other(
                "Preview cache contains a nonregular entry",
            ));
        }
        bytes = bytes.saturating_add(metadata.len());
    }
    Ok(bytes)
}
fn source_working_bytes(
    meta: &vv_core::MediaMeta,
    max_width: u32,
    assets: bool,
    mode: crate::source_audio::AudioMode,
) -> u64 {
    let pixels = u64::from(meta.width) * u64::from(meta.height);
    let width = meta.width.min(max_width).max(1);
    let height = if meta.width == 0 {
        0
    } else {
        (u64::from(meta.height) * u64::from(width))
            .div_ceil(u64::from(meta.width))
            .saturating_add(2)
    };
    let video = if meta.is_image() {
        pixels.saturating_mul(20)
    } else if meta.has_video {
        pixels
            .saturating_mul(16)
            .saturating_add((u64::from(width) * height).saturating_mul(12))
    } else {
        0
    };
    // The selected stream can differ from the probe's best-stream channel count.
    let audio = if meta.has_audio && !assets && mode == crate::source_audio::AudioMode::Selected {
        64 * 1024 * 1024 * 4
    } else {
        0
    };
    video.saturating_add(audio).saturating_add(64 * 1024 * 1024)
}
fn source_audio_key(
    spec: &SourceSpec,
    quality: ProxyQuality,
    window: Option<SourceWindow>,
    identity: &str,
    mode: crate::source_audio::AudioMode,
    index: u32,
) -> String {
    let key = source_key(spec, quality, window, identity, index);
    match mode {
        crate::source_audio::AudioMode::Selected => key,
        crate::source_audio::AudioMode::All => format!("{key}:audio-mode:all"),
    }
}
fn admit_source_memory(meta: &vv_core::MediaMeta, max_width: u32, assets: bool) -> Result<()> {
    program::admit_memory(
        source_working_bytes(
            meta,
            max_width,
            assets,
            crate::source_audio::AudioMode::Selected,
        ),
        64 * 1024 * 1024,
        ApiError::conflict(
            "SOURCE_MEMORY_PRESSURE",
            "Not enough host or process memory headroom for native source preparation; retry when memory is available",
        ),
    )
}
fn admit_source_audio_memory(
    meta: &vv_core::MediaMeta,
    max_width: u32,
    window: Option<SourceWindow>,
    mode: crate::source_audio::AudioMode,
) -> Result<()> {
    program::admit_memory(
        source_audio_working_bytes(meta, max_width, window, mode)?,
        64 * 1024 * 1024,
        source_audio_memory_pressure(),
    )
}
fn source_audio_memory_pressure() -> ApiError {
    ApiError::conflict(
        "SOURCE_MEMORY_PRESSURE",
        "Not enough native source audio memory budget; choose a shorter window or retry later",
    )
}
fn source_audio_working_bytes(
    meta: &vv_core::MediaMeta,
    max_width: u32,
    window: Option<SourceWindow>,
    mode: crate::source_audio::AudioMode,
) -> Result<u64> {
    let pressure = source_audio_memory_pressure;
    let mut required = source_working_bytes(meta, max_width, false, mode);
    if mode == crate::source_audio::AudioMode::All && meta.has_audio {
        let frames = window.map_or(0..meta.duration_frames, |window| {
            window.start_frame..window.end_frame
        });
        let bounds =
            crate::source_audio::sample_bounds(frames, meta.fps).map_err(|_| pressure())?;
        required = required
            .saturating_add(
                crate::source_audio::working_bytes(meta.audio_stream_count(), &bounds)
                    .map_err(|_| pressure())?,
            )
            .saturating_add(8 * 1024 * 1024);
    }
    Ok(required)
}
fn generate(
    spec: &SourceSpec,
    directory: &Path,
    video_quality: (ProxyQuality, u32),
    window: Option<SourceWindow>,
    audio_stream_index: u32,
    cancel: &AtomicBool,
    progress: impl FnMut(u64),
) -> Result<()> {
    generate_audio(
        spec,
        directory,
        video_quality,
        window,
        (crate::source_audio::AudioMode::Selected, audio_stream_index),
        cancel,
        progress,
    )
}
fn generate_audio(
    spec: &SourceSpec,
    directory: &Path,
    video_quality: (ProxyQuality, u32),
    window: Option<SourceWindow>,
    selection: (crate::source_audio::AudioMode, u32),
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<()> {
    let (quality, max_width) = video_quality;
    let (mode, audio_stream_index) = selection;
    crate::source_audio::selection(&spec.meta, mode, audio_stream_index)
        .map_err(|_| ApiError::invalid("Invalid source audio mode or ordinal"))?;
    admit_source_audio_memory(&spec.meta, max_width, window, mode)?;
    validate_source_audio(&spec.meta, audio_stream_index)?;
    if spec.meta.is_image() {
        if window.is_some() {
            return Err(ApiError::invalid(
                "Still sources do not have playback windows",
            ));
        }
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
        || (window.is_none() && seconds > 600.0)
        || actual.width > 8192
        || actual.height > 8192
        || actual.duration_frames != spec.meta.duration_frames
        || actual.fps != spec.meta.fps
        || ((window.is_some()
            || audio_stream_index != 0
            || mode == crate::source_audio::AudioMode::All)
            && !same_assets_meta(&spec.meta, &actual))
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Reimport changed media before preparing a source preview",
        ));
    }
    validate_source_audio(&actual, audio_stream_index)?;
    let selected = usize::try_from(audio_stream_index)
        .map_err(|_| ApiError::invalid("Invalid source audio stream index"))?;
    if let Some(window) = window {
        window.validate(&actual)?;
    }
    let mut keep_running = |frames| {
        if frames > 0 {
            progress(frames);
        }
        !cancel.load(Ordering::Relaxed)
            && started.elapsed() < Duration::from_secs(600)
            && directory_bytes(directory) < MAX_JOB_BYTES
            && disk_headroom(directory)
    };
    let generated = if mode == crate::source_audio::AudioMode::All {
        let streams = crate::source_audio::selection(&actual, mode, audio_stream_index)
            .map_err(|_| ApiError::invalid("Source audio streams changed"))?;
        let frames = window.map_or(0..actual.duration_frames, |window| {
            window.start_frame..window.end_frame
        });
        let bounds = crate::source_audio::sample_bounds(frames.clone(), actual.fps)
            .map_err(|_| ApiError::invalid("Invalid source audio mix range"))?;
        vv_media::browser_proxy::generate_with_audio_width(
            &path,
            directory,
            quality,
            max_width,
            window.map(|_| frames),
            &mut keep_running,
            |output, keep_running| {
                let samples =
                    crate::source_audio::render(&path, &streams, bounds, actual.fps, || {
                        keep_running(0)
                    })?;
                if !keep_running(0) {
                    return Err(vv_media::MediaError::Cancelled);
                }
                vv_media::audio_file::write_audio_file(
                    output,
                    vv_media::audio_file::AudioFileFormat::Aac,
                    &samples,
                    48_000,
                    2,
                )
            },
        )
    } else {
        match window {
            Some(window) => vv_media::browser_proxy::generate_range_selected_width(
                &path,
                directory,
                quality,
                max_width,
                window.start_frame..window.end_frame,
                selected,
                &mut keep_running,
            ),
            None => vv_media::browser_proxy::generate_selected_width(
                &path,
                directory,
                quality,
                max_width,
                selected,
                &mut keep_running,
            ),
        }
    };
    generated.map_err(|_| {
        ApiError::invalid("Source generation failed, canceled or exceeded its resource budget")
    })?;
    if window.is_none() && spec.meta.has_video {
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
    if window.is_none() && spec.meta.has_audio && mode == crate::source_audio::AudioMode::Selected {
        let seconds = spec.meta.duration_frames as f64 / spec.meta.fps.as_f64();
        let waveforms = vv_media::waveform::analyze_waveforms(
            &path,
            &[selected],
            vv_media::recommended_num_peaks(seconds),
            || {
                !cancel.load(Ordering::Relaxed)
                    && started.elapsed() < Duration::from_secs(600)
                    && disk_headroom(directory)
            },
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

fn owned_image_output(path: &Path) -> Result<File> {
    rustix::fs::open(
        path,
        rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::CREATE
            | rustix::fs::OFlags::EXCL
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
    )
    .map(File::from)
    .map_err(|_| ApiError::io())
}
fn image_asset(file: &File) -> Result<&'static str> {
    image_representation(file).map(|(name, _)| name)
}
fn image_representation(file: &File) -> Result<(&'static str, bool)> {
    let mut signature = [0; 12];
    let read = file
        .read_at(&mut signature, 0)
        .map_err(|_| ApiError::io())?;
    if read >= 8 && signature[..8] == *b"\x89PNG\r\n\x1a\n" {
        Ok(("source.png", false))
    } else if read >= 3 && signature[..3] == [0xff, 0xd8, 0xff] {
        Ok(("source.jpg", false))
    } else if read == 12 && &signature[..4] == b"RIFF" && &signature[8..12] == b"WEBP" {
        Ok(("source.webp", false))
    } else if read >= 2 && &signature[..2] == b"BM"
        || read >= 4 && (&signature[..4] == b"II\x2a\0" || &signature[..4] == b"MM\0\x2a")
    {
        Ok(("source.png", true))
    } else {
        Err(ApiError::invalid(
            "Source still preview supports PNG, JPEG, WebP, BMP and TIFF",
        ))
    }
}
fn generate_image(spec: &SourceSpec, directory: &Path, cancel: &AtomicBool) -> Result<()> {
    let before = spec.identity()?;
    let started = Instant::now();
    let check = || {
        if cancel.load(Ordering::Relaxed)
            || started.elapsed() >= Duration::from_secs(600)
            || !disk_headroom(directory)
        {
            Err(ApiError::invalid(
                "Image preparation canceled or exceeded its budget",
            ))
        } else {
            Ok(())
        }
    };
    check()?;
    if spec.file.metadata().map_err(|_| ApiError::io())?.len() > MAX_JOB_BYTES {
        return Err(ApiError::invalid("Image exceeds the 512 MiB source budget"));
    }
    let (asset, convert) = image_representation(&spec.file)?;
    let path = directory.join(asset);
    if convert {
        let output = owned_image_output(&path)?;
        let thumbnail = owned_image_output(&directory.join("thumb.png"))?;
        crate::image_derivative::generate(
            &spec.file,
            &output,
            &thumbnail,
            (spec.meta.width, spec.meta.height),
            cancel,
            || check().is_ok() && directory_bytes(directory) <= MAX_JOB_BYTES,
        )?;
    } else {
        let mut output = File::create(&path).map_err(|_| ApiError::io())?;
        let mut offset = 0;
        let mut buffer = [0; 64 * 1024];
        loop {
            check()?;
            let read = spec
                .file
                .read_at(&mut buffer, offset)
                .map_err(|_| ApiError::io())?;
            if read == 0 {
                break;
            }
            offset += read as u64;
            if offset > MAX_JOB_BYTES {
                return Err(ApiError::invalid("Image exceeds the source budget"));
            }
            output
                .write_all(&buffer[..read])
                .map_err(|_| ApiError::io())?;
        }
    }
    check()?;
    if !convert {
        let thumbnail = owned_image_output(&directory.join("thumb.png"))?;
        crate::image_derivative::generate_thumbnail(
            &spec.file,
            &thumbnail,
            (spec.meta.width, spec.meta.height),
            cancel,
            || check().is_ok() && directory_bytes(directory) <= MAX_JOB_BYTES,
        )?;
    }
    check()?;
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
