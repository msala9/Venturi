use crate::{
    asset_payload::{self, AssetFile},
    asset_store::{self, Store},
    error::{ApiError, Result},
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, renameat_with, unlinkat};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::File,
    io::Write,
    os::{fd::AsRawFd, unix::fs::FileExt},
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use vv_core::clipboard::ClipboardPayload;

const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_ASSET: u64 = 2 * 1024 * 1024 * 1024;
const RESERVE: u64 = 512 * 1024 * 1024;
const MAX_FILES: usize = 64;
const MAX_RECORDS: usize = 8;
const MEDIA_IMPORT_BUDGET: Duration = Duration::from_secs(600);
#[derive(Clone)]
pub struct PreparedMedia {
    pub path_token: String,
    pub path: PathBuf,
    pub meta: vv_core::MediaMeta,
    pub content_hash: u64,
}
pub struct ImportPayload {
    pub items: Vec<PreparedMedia>,
    pub errors: Vec<Value>,
    pub first_error: Option<ApiError>,
}
struct ImportFile {
    item: PreparedMedia,
    file: File,
    identity: String,
}
struct PreparedImport {
    items: Vec<ImportFile>,
    errors: Vec<Value>,
    first_error: Option<ApiError>,
}
impl PreparedImport {
    fn validate(&self, inner: &Inner) -> Result<()> {
        project_root(inner)?;
        for item in &self.items {
            validate_import_file(inner, item)?;
        }
        Ok(())
    }
    fn value(&self) -> Value {
        json!({"items":self.items.iter().map(|file|json!({"path_token":file.item.path_token,"name":file.item.path_token,"state":"ready"})).collect::<Vec<_>>(),"errors":self.errors})
    }
}
pub struct PinnedSource {
    pub path: PathBuf,
    pub file: File,
    pub identity: String,
}
struct Witness {
    directory: File,
    base: File,
    parent: Option<String>,
    name: String,
    file: File,
    identity: String,
}
impl Witness {
    fn validate(&self) -> Result<()> {
        if let Some(parent) = &self.parent {
            let live = File::from(
                openat(
                    &self.base,
                    parent.as_str(),
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .map_err(|_| source_changed())?,
            );
            asset_store::same_directory(&live, &self.directory)?;
        } else {
            asset_store::same_directory(&self.base, &self.directory)?;
        }
        if asset_store::stable_identity(&self.file)? != self.identity
            || asset_store::stable_identity(&asset_store::regular(&self.directory, &self.name)?)?
                != self.identity
        {
            return Err(source_changed());
        }
        Ok(())
    }
}
struct Prepared {
    asset: AssetFile,
    files: Vec<Witness>,
}
struct Job {
    id: String,
    kind: &'static str,
    epoch: String,
    generation: String,
    state: &'static str,
    bytes: u64,
    total: u64,
    error: Option<&'static str>,
    failure: Option<ApiError>,
    asset_id: Option<String>,
    revision: Option<String>,
    cancel: Arc<AtomicBool>,
    result: Option<Prepared>,
    edit_result: Option<crate::asset_journal::PreparedEdit>,
    edit: Option<asset_store::Edit>,
    command_id: Option<String>,
    fingerprint: Option<[u8; 32]>,
    media_import: Option<PreparedImport>,
    import_completed: usize,
    import_total: usize,
}
impl Job {
    fn value(&self) -> Value {
        let result = self.result.as_ref().map(|prepared| {
            let payload = asset_payload::decode(&prepared.asset).ok();
            json!({"asset_id":self.asset_id,"revision":self.revision,"name":prepared.asset.name,"media_count":payload.as_ref().map_or(0,|p| p.media_items().count()),"file_count":prepared.files.len(),"bytes":self.bytes})
        }).or_else(||self.edit_result.as_ref().map(|prepared|prepared.summary())).or_else(||self.media_import.as_ref().map(PreparedImport::value));
        let mut value = json!({"id":self.id,"kind":self.kind,"project_epoch":self.epoch,"generation":self.generation,"state":self.state,"bytes":self.bytes,"total_bytes":self.total,"error":self.error,"result":result});
        if self.kind == "media_import" {
            value["progress"] =
                json!({"completed":self.import_completed,"total":self.import_total});
        }
        value
    }
}
struct Work {
    id: String,
    asset: Option<AssetFile>,
    sources: Vec<PinnedSource>,
    cancel: Arc<AtomicBool>,
    import: Option<(String, String)>,
    edit: Option<(asset_store::Edit, crate::asset_journal::Completion)>,
    media_import: Option<Vec<String>>,
}
enum Finished {
    Media(Prepared),
    Edit(crate::asset_journal::PreparedEdit),
    Import(PreparedImport),
}
struct Inner {
    store: Store,
    root: PathBuf,
    directory: File,
    jobs: Mutex<VecDeque<Job>>,
    sender: mpsc::SyncSender<Work>,
}
#[derive(Clone)]
pub struct Jobs(Arc<Inner>);
pub(crate) fn nonce() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn source_changed() -> ApiError {
    ApiError::conflict(
        "SOURCE_CHANGED",
        "Asset media changed; refresh and prepare again",
    )
}
fn canceled() -> ApiError {
    ApiError::conflict("ASSET_CANCELED", "Asset preparation was canceled")
}
fn busy() -> ApiError {
    ApiError::conflict(
        "ASSET_BUSY",
        "Asset preparation is busy; retry after the current operation",
    )
}
fn binding(epoch: &str, generation: &str) -> Result<()> {
    if [epoch, generation]
        .iter()
        .any(|v| v.is_empty() || v.len() > 256 || v.chars().any(char::is_control))
    {
        return Err(ApiError::invalid("Invalid asset project binding"));
    }
    Ok(())
}
impl Jobs {
    pub fn new(store: Store, project_root: &Path, project_dir: File) -> std::io::Result<Self> {
        let root = project_root.canonicalize()?;
        if !project_dir.metadata()?.is_dir() {
            return Err(std::io::Error::other(
                "Asset project root must be a directory",
            ));
        }
        let live = File::open(&root)?;
        if crate::source::file_identity(&live).map_err(|e| std::io::Error::other(e.2))?
            != crate::source::file_identity(&project_dir).map_err(|e| std::io::Error::other(e.2))?
        {
            return Err(std::io::Error::other("Asset project directory changed"));
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        let inner = Arc::new(Inner {
            store,
            root,
            directory: project_dir,
            jobs: Mutex::new(VecDeque::new()),
            sender,
        });
        let weak = Arc::downgrade(&inner);
        std::thread::Builder::new()
            .name("native-assets".into())
            .spawn(move || {
                while let Ok(work) = receiver.recv() {
                    let Some(inner) = weak.upgrade() else {
                        break;
                    };
                    if let Ok(mut jobs) = inner.jobs.lock()
                        && let Some(job) = jobs.iter_mut().find(|j| j.id == work.id)
                    {
                        job.state = "running";
                    }
                    let result = if let Some(tokens) = &work.media_import {
                        run_media_import(&inner, &work, tokens, MEDIA_IMPORT_BUDGET)
                            .map(Finished::Import)
                    } else if let Some((edit, completion)) = &work.edit {
                        inner
                            .store
                            .prepare_edit(edit, completion.clone(), &work.cancel)
                            .map(Finished::Edit)
                    } else {
                        run(&inner, &work).map(Finished::Media)
                    };
                    if let Ok(mut jobs) = inner.jobs.lock()
                        && let Some(job) = jobs.iter_mut().find(|j| j.id == work.id)
                    {
                        match result {
                            Ok(prepared) if !job.cancel.load(Ordering::Acquire) => {
                                job.state = "ready";
                                job.bytes = job.total;
                                match prepared {
                                    Finished::Media(prepared) => job.result = Some(prepared),
                                    Finished::Edit(prepared) => job.edit_result = Some(prepared),
                                    Finished::Import(prepared) => job.media_import = Some(prepared),
                                }
                            }
                            Ok(_) => {
                                job.state = "canceled";
                                job.error = Some("ASSET_CANCELED");
                                job.failure = Some(canceled());
                            }
                            Err(error) => {
                                job.state = if job.cancel.load(Ordering::Acquire)
                                    || error.1 == "ASSET_CANCELED"
                                {
                                    "canceled"
                                } else {
                                    "failed"
                                };
                                job.error = Some(error.1);
                                job.failure = Some(error);
                            }
                        }
                    }
                }
            })?;
        Ok(Self(inner))
    }
    pub fn prepare_capture(
        &self,
        epoch: &str,
        generation: &str,
        asset: AssetFile,
        sources: Vec<PinnedSource>,
    ) -> Result<Value> {
        let payload = asset_payload::decode(&asset)?;
        let wanted: HashSet<_> = payload.files().map(|m| m.path.clone()).collect();
        let actual: HashSet<_> = sources.iter().map(|s| s.path.clone()).collect();
        if wanted != actual || actual.len() != sources.len() {
            return Err(ApiError::invalid(
                "Asset sources must exactly match its native dependencies",
            ));
        }
        for source in &sources {
            if source.path.parent() != Some(self.0.root.as_path()) {
                return Err(ApiError::invalid(
                    "Asset capture sources must be inside the project root",
                ));
            }
            simple_name(
                source
                    .path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(ApiError::missing)?,
            )?;
        }
        self.enqueue(epoch, generation, asset, sources, None)
    }
    pub fn prepare_edit(
        &self,
        epoch: &str,
        generation: &str,
        command_id: &str,
        fingerprint: [u8; 32],
        receipt: Value,
        edit: asset_store::Edit,
    ) -> Result<Value> {
        binding(epoch, generation)?;
        if !edit.requires_preparation() {
            return Err(ApiError::invalid("Choose a native asset folder operation"));
        }
        let completion = crate::asset_journal::Completion {
            version: 1,
            command_id: command_id.into(),
            fingerprint,
            project_root_binding: crate::asset_journal::project_binding(&self.0.directory)?,
            receipt,
        };
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        if let Some(job) = jobs
            .iter()
            .find(|job| job.command_id.as_deref() == Some(command_id))
        {
            if job.fingerprint != Some(fingerprint) {
                return Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Native asset command ID was reused",
                ));
            }
            return Ok(job.value());
        }
        reserve(&mut jobs)?;
        let id = format!("asset-{}", nonce());
        let cancel = Arc::new(AtomicBool::new(false));
        let work = Work {
            id: id.clone(),
            asset: None,
            sources: vec![],
            cancel: cancel.clone(),
            import: None,
            edit: Some((edit.clone(), completion)),
            media_import: None,
        };
        let job = Job {
            id,
            kind: "library_edit",
            epoch: epoch.into(),
            generation: generation.into(),
            state: "queued",
            bytes: 0,
            total: 0,
            error: None,
            failure: None,
            asset_id: None,
            revision: None,
            cancel,
            result: None,
            edit_result: None,
            edit: Some(edit),
            command_id: Some(command_id.into()),
            fingerprint: Some(fingerprint),
            media_import: None,
            import_completed: 0,
            import_total: 0,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn commit_edit(
        &self,
        command_id: &str,
        fingerprint: [u8; 32],
        epoch: &str,
        generation: &str,
        edit: &asset_store::Edit,
    ) -> Result<()> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|job| job.command_id.as_deref() == Some(command_id))
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "library_edit")?;
        if job.fingerprint != Some(fingerprint)
            || serde_json::to_vec(&job.edit).map_err(|_| ApiError::io())?
                != serde_json::to_vec(&Some(edit)).map_err(|_| ApiError::io())?
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Native asset command ID was reused",
            ));
        }
        self.0.store.commit_edit(
            job.edit_result.as_mut().ok_or_else(ApiError::missing)?,
            &job.cancel,
        )?;
        job.state = "applied";
        job.edit_result = None;
        Ok(())
    }
    pub fn prepare_import(
        &self,
        epoch: &str,
        generation: &str,
        id: &str,
        revision: &str,
    ) -> Result<Value> {
        let asset = self.0.store.load(id, revision)?;
        let payload = asset_payload::decode(&asset)?;
        let mut paths = HashSet::new();
        let mut sources = Vec::new();
        for item in payload.files() {
            let (directory, name, hash) = store_location(&self.0.store, &item.path)?;
            if legacy_hash(&hash).is_some_and(|hash| hash != item.content_hash) {
                return Err(source_changed());
            }
            if paths.insert(item.path.clone()) {
                if sources.len() >= MAX_FILES {
                    return Err(ApiError::invalid(
                        "Native assets support at most 64 unique files",
                    ));
                }
                let file = asset_store::regular(&directory, &name)?;
                sources.push(PinnedSource {
                    path: item.path.clone(),
                    identity: crate::source::file_identity(&file)?,
                    file,
                });
            }
        }
        self.enqueue(
            epoch,
            generation,
            asset,
            sources,
            Some((id.into(), revision.into())),
        )
    }
    fn enqueue(
        &self,
        epoch: &str,
        generation: &str,
        asset: AssetFile,
        sources: Vec<PinnedSource>,
        import: Option<(String, String)>,
    ) -> Result<Value> {
        binding(epoch, generation)?;
        if sources.len() > MAX_FILES {
            return Err(ApiError::invalid(
                "Native assets support at most 64 unique files",
            ));
        }
        let mut total = 0_u64;
        for source in &sources {
            let meta = source.file.metadata().map_err(|_| ApiError::io())?;
            if !meta.is_file() || meta.len() > MAX_FILE {
                return Err(ApiError::invalid(
                    "Asset files must be regular files within 512 MiB",
                ));
            }
            if crate::source::file_identity(&source.file)? != source.identity {
                return Err(source_changed());
            }
            total = total
                .checked_add(meta.len())
                .ok_or_else(|| ApiError::invalid("Asset byte budget exceeded"))?;
        }
        if total > MAX_ASSET {
            return Err(ApiError::invalid("Native assets are limited to 2 GiB"));
        }
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        reserve(&mut jobs)?;
        let id = format!("asset-{}", nonce());
        let cancel = Arc::new(AtomicBool::new(false));
        let work = Work {
            id: id.clone(),
            asset: Some(asset),
            sources,
            cancel: cancel.clone(),
            import: import.clone(),
            edit: None,
            media_import: None,
        };
        let job = Job {
            id,
            kind: if import.is_some() {
                "import"
            } else {
                "capture"
            },
            epoch: epoch.into(),
            generation: generation.into(),
            state: "queued",
            bytes: 0,
            total,
            error: None,
            failure: None,
            asset_id: import.as_ref().map(|v| v.0.clone()),
            revision: import.map(|v| v.1),
            cancel,
            result: None,
            edit_result: None,
            edit: None,
            command_id: None,
            fingerprint: None,
            media_import: None,
            import_completed: 0,
            import_total: 0,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn prepare_media_import(
        &self,
        epoch: &str,
        generation: &str,
        path_tokens: Vec<String>,
    ) -> Result<Value> {
        binding(epoch, generation)?;
        let tokens = crate::files::media_import_tokens(&path_tokens)?;
        project_root(&self.0)?;
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        // Ready records retain descriptors too. Reserve the complete running/queued
        // batch up front so the eight-record ring cannot accumulate 2048 witnesses.
        let retained: usize = jobs
            .iter()
            .map(|job| {
                if matches!(job.state, "queued" | "running") {
                    job.import_total
                } else {
                    job.media_import
                        .as_ref()
                        .map_or(0, |prepared| prepared.items.len())
                }
            })
            .sum();
        if retained.saturating_add(tokens.len()) > crate::files::MAX_MEDIA_IMPORTS {
            return Err(busy());
        }
        reserve(&mut jobs)?;
        let id = format!("asset-{}", nonce());
        let cancel = Arc::new(AtomicBool::new(false));
        let total = tokens.len();
        let work = Work {
            id: id.clone(),
            asset: None,
            sources: vec![],
            cancel: cancel.clone(),
            import: None,
            edit: None,
            media_import: Some(tokens),
        };
        let job = Job {
            id,
            kind: "media_import",
            epoch: epoch.into(),
            generation: generation.into(),
            state: "queued",
            bytes: 0,
            total: 0,
            error: None,
            failure: None,
            asset_id: None,
            revision: None,
            cancel,
            result: None,
            edit_result: None,
            edit: None,
            command_id: None,
            fingerprint: None,
            media_import: None,
            import_completed: 0,
            import_total: total,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn media_import_payload(
        &self,
        id: &str,
        epoch: &str,
        generation: &str,
    ) -> Result<ImportPayload> {
        let jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "media_import")?;
        let prepared = job.media_import.as_ref().ok_or_else(ApiError::missing)?;
        prepared.validate(&self.0)?;
        Ok(ImportPayload {
            items: prepared
                .items
                .iter()
                .map(|file| file.item.clone())
                .collect(),
            errors: prepared.errors.clone(),
            first_error: prepared.first_error.clone(),
        })
    }
    // The actor calls this only after its complete native trial, immediately before
    // infallible allocation/apply. Cancellation and acceptance share this mutex.
    pub fn accept_media_import(&self, id: &str, epoch: &str, generation: &str) -> Result<()> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "media_import")?;
        let prepared = job.media_import.as_ref().ok_or_else(ApiError::missing)?;
        prepared.validate(&self.0)?;
        if prepared.items.is_empty() {
            return Err(prepared
                .first_error
                .clone()
                .unwrap_or_else(|| ApiError::invalid("No readable media files were prepared")));
        }
        job.state = "applied";
        job.media_import = None;
        Ok(())
    }
    pub fn status(&self, id: &str, epoch: &str, cancel: bool) -> Result<Value> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id && j.epoch == epoch)
            .ok_or_else(ApiError::missing)?;
        if job.state == "applied" {
            return Ok(job.value());
        }
        if cancel {
            job.cancel.store(true, Ordering::Release);
            if !matches!(job.state, "running" | "queued") {
                job.state = "canceled";
                job.result = None;
                job.edit_result = None;
                job.media_import = None;
                job.error = Some("ASSET_CANCELED");
                job.failure = Some(canceled());
            }
        }
        Ok(job.value())
    }
    pub fn read_failure(&self, id: &str, epoch: &str) -> Result<Option<ApiError>> {
        let jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter()
            .find(|job| job.id == id && job.epoch == epoch)
            .ok_or_else(ApiError::missing)?;
        Ok(job.failure.clone())
    }
    pub fn cancel_obsolete(&self, epoch: &str) {
        let mut jobs = self
            .0
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for job in jobs
            .iter_mut()
            .filter(|job| job.epoch != epoch && job.state != "applied")
        {
            job.cancel.store(true, Ordering::Release);
            job.result = None;
            job.edit_result = None;
            job.media_import = None;
            if !matches!(job.state, "running" | "queued") {
                job.state = "canceled";
                job.error = Some("ASSET_CANCELED");
                job.failure = Some(canceled());
            }
        }
    }
    pub fn publish(&self, command_id: &str, id: &str, epoch: &str, generation: &str) -> Result<()> {
        roots(&self.0)?;
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "capture")?;
        if job
            .asset_id
            .as_deref()
            .is_some_and(|value| value != command_id)
        {
            return Err(ApiError::conflict(
                "ASSET_PUBLISHED",
                "Prepared asset was already published by another command",
            ));
        }
        let prepared = job.result.as_ref().ok_or_else(ApiError::missing)?;
        for file in &prepared.files {
            file.validate()?;
        }
        self.0.store.create(command_id, &prepared.asset)?;
        job.asset_id = Some(command_id.into());
        job.revision = self.0.store.item(command_id, false)?["revision"]
            .as_str()
            .map(str::to_owned);
        Ok(())
    }
    pub fn import_payload(
        &self,
        id: &str,
        asset_id: &str,
        revision: &str,
        epoch: &str,
        generation: &str,
    ) -> Result<ClipboardPayload> {
        roots(&self.0)?;
        let jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter()
            .find(|j| j.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "import")?;
        if job.asset_id.as_deref() != Some(asset_id) || job.revision.as_deref() != Some(revision) {
            return Err(asset_store::changed());
        }
        self.0.store.load(asset_id, revision)?;
        let prepared = job.result.as_ref().ok_or_else(ApiError::missing)?;
        for file in &prepared.files {
            file.validate()?;
        }
        asset_payload::decode(&prepared.asset)
    }
}
fn reserve(jobs: &mut VecDeque<Job>) -> Result<()> {
    if jobs
        .iter()
        .filter(|job| matches!(job.state, "queued" | "running"))
        .count()
        >= 2
    {
        return Err(busy());
    }
    while jobs.len() >= MAX_RECORDS {
        let index = jobs
            .iter()
            .position(|job| !matches!(job.state, "queued" | "running"))
            .ok_or_else(busy)?;
        jobs.remove(index);
    }
    Ok(())
}
fn ready(job: &Job, epoch: &str, generation: &str, kind: &str) -> Result<()> {
    if job.epoch != epoch || job.generation != generation {
        return Err(ApiError::conflict(
            "ASSET_CONTEXT_CHANGED",
            "Project changed; prepare the native asset again",
        ));
    }
    if job.kind != kind || job.state != "ready" || job.cancel.load(Ordering::Acquire) {
        return Err(ApiError::conflict(
            "ASSET_NOT_READY",
            "Choose a ready native asset preparation",
        ));
    }
    Ok(())
}
fn simple_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 128
        || name.starts_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(ApiError::invalid(
            "Asset media requires a simple bounded file name",
        ));
    }
    Ok(())
}
fn store_location(store: &Store, path: &Path) -> Result<(File, String, String)> {
    let relative = path.strip_prefix(store.root().join("media")).map_err(|_| {
        ApiError::invalid("Native asset files must be inside this library media store")
    })?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 2 || parts.iter().any(|p| !matches!(p, Component::Normal(_))) {
        return Err(ApiError::invalid(
            "Native asset media paths must contain a hash and file name",
        ));
    }
    let hash = parts[0]
        .as_os_str()
        .to_str()
        .ok_or_else(ApiError::missing)?;
    let name = parts[1]
        .as_os_str()
        .to_str()
        .ok_or_else(ApiError::missing)?;
    if ![16, 64].contains(&hash.len())
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ApiError::invalid(
            "Native asset media requires a native fingerprint or full SHA-256 directory",
        ));
    }
    simple_name(name)?;
    let directory = File::from(
        openat(
            store.media(),
            hash,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?,
    );
    Ok((directory, name.into(), hash.into()))
}
fn legacy_hash(hash: &str) -> Option<u64> {
    (hash.len() == 16)
        .then(|| u64::from_str_radix(hash, 16).ok())
        .flatten()
}
struct Budget {
    start: Instant,
    cancel: Arc<AtomicBool>,
}
impl Budget {
    fn check(&self, directory: &File) -> Result<()> {
        if self.cancel.load(Ordering::Acquire) {
            return Err(canceled());
        }
        if self.start.elapsed() > Duration::from_secs(600) {
            return Err(ApiError::conflict(
                "ASSET_TIMEOUT",
                "Asset preparation exceeded its processing budget",
            ));
        }
        let stat = rustix::fs::fstatvfs(directory).map_err(|_| ApiError::io())?;
        if stat.f_bavail.saturating_mul(stat.f_frsize) < RESERVE + 1024 * 1024 {
            return Err(ApiError::conflict(
                "ASSET_DISK_FULL",
                "Asset preparation requires 512 MiB free disk reserve",
            ));
        }
        Ok(())
    }
}
fn live_source(inner: &Inner, source: &PinnedSource, import: bool) -> Result<()> {
    roots(inner)?;
    let live = if import {
        let (dir, name, _) = store_location(&inner.store, &source.path)?;
        asset_store::regular(&dir, &name)?
    } else {
        asset_store::regular(
            &inner.directory,
            source
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(ApiError::missing)?,
        )?
    };
    if crate::source::file_identity(&source.file)? != source.identity
        || crate::source::file_identity(&live)? != source.identity
    {
        return Err(source_changed());
    }
    Ok(())
}
fn digest(file: &File, budget: &Budget, directory: &File) -> Result<String> {
    let size = file.metadata().map_err(|_| ApiError::io())?.len();
    if size > MAX_FILE {
        return Err(ApiError::invalid("Asset file exceeds 512 MiB"));
    }
    let mut hash = Sha256::new();
    let mut offset = 0;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        budget.check(directory)?;
        let n = file
            .read_at(&mut buffer, offset)
            .map_err(|_| ApiError::io())?;
        if n == 0 {
            break;
        }
        offset += n as u64;
        if offset > size {
            return Err(source_changed());
        }
        hash.update(&buffer[..n]);
    }
    if offset != size {
        return Err(source_changed());
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn header(file: &File, path: &Path) -> Result<()> {
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut h = [0; 16];
    let n = file.read_at(&mut h, 0).map_err(|_| ApiError::io())?;
    let valid = match extension.as_str() {
        "png" => n >= 8 && h[..8] == *b"\x89PNG\r\n\x1a\n",
        "jpg" | "jpeg" => n >= 3 && h[..3] == [0xff, 0xd8, 0xff],
        "webp" => n >= 12 && &h[..4] == b"RIFF" && &h[8..12] == b"WEBP",
        "wav" => n >= 12 && (&h[..4] == b"RIFF" || &h[..4] == b"RF64") && &h[8..12] == b"WAVE",
        "mp4" | "m4a" => n >= 8 && &h[4..8] == b"ftyp",
        "mov" => {
            n >= 8
                && [
                    &b"ftyp"[..],
                    &b"moov"[..],
                    &b"wide"[..],
                    &b"mdat"[..],
                    &b"free"[..],
                ]
                .contains(&&h[4..8])
        }
        "webm" | "mkv" => n >= 4 && h[..4] == [0x1a, 0x45, 0xdf, 0xa3],
        "mp3" => n >= 3 && (&h[..3] == b"ID3" || h[0] == 0xff && h[1] & 0xe0 == 0xe0),
        "flac" => n >= 4 && &h[..4] == b"fLaC",
        "ogg" | "opus" => n >= 4 && &h[..4] == b"OggS",
        _ => false,
    };
    if !valid {
        return Err(ApiError::invalid(
            "Asset bytes must match a supported binary media extension; playlists are refused",
        ));
    }
    Ok(())
}
fn same_meta(a: &vv_core::MediaMeta, b: &vv_core::MediaMeta) -> bool {
    a.duration_frames == b.duration_frames
        && a.fps == b.fps
        && a.width == b.width
        && a.height == b.height
        && a.has_video == b.has_video
        && a.has_audio == b.has_audio
        && a.sample_rate == b.sample_rate
        && a.channels == b.channels
        && a.audio_stream_count() == b.audio_stream_count()
}
fn probe(file: &File, original: &Path, cancel: &AtomicBool) -> Result<vv_core::MediaMeta> {
    header(file, original)?;
    crate::asset_probe::probe(file, vv_media::is_image_path(original), cancel)
}
fn fingerprint(file: &File) -> Result<u64> {
    vv_media::content_fingerprint(&PathBuf::from(format!(
        "/proc/self/fd/{}",
        file.as_raw_fd()
    )))
    .map_err(|_| ApiError::io())
}
struct Partial<'a> {
    directory: &'a File,
    name: String,
}
impl Drop for Partial<'_> {
    fn drop(&mut self) {
        let _ = unlinkat(self.directory, self.name.as_str(), AtFlags::empty());
    }
}
struct Copied {
    path: PathBuf,
    witness: Witness,
    size: u64,
    meta: vv_core::MediaMeta,
    source_hash: u64,
    hash: u64,
}
fn copy(inner: &Inner, source: &PinnedSource, work: &Work, budget: &Budget) -> Result<Copied> {
    live_source(inner, source, work.import.is_some())?;
    let source_identity = asset_store::stable_identity(&source.file)?;
    let source_hash = fingerprint(&source.file)?;
    let source_name = source
        .path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(ApiError::missing)?;
    simple_name(source_name)?;
    header(&source.file, &source.path)?;
    let staging = if work.import.is_some() {
        &inner.directory
    } else {
        inner.store.media()
    };
    budget.check(staging)?;
    let partial = Partial {
        directory: staging,
        name: format!(".venturi-asset-{}.part", nonce()),
    };
    let mut file = File::from(
        openat(
            staging,
            partial.name.as_str(),
            OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ApiError::io())?,
    );
    let size = source.file.metadata().map_err(|_| ApiError::io())?.len();
    let mut hash = Sha256::new();
    let mut offset = 0;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        budget.check(staging)?;
        let n = source
            .file
            .read_at(&mut buffer, offset)
            .map_err(|_| ApiError::io())?;
        if n == 0 {
            break;
        }
        offset += n as u64;
        if offset > size || offset > MAX_FILE {
            return Err(source_changed());
        }
        file.write_all(&buffer[..n]).map_err(|_| ApiError::io())?;
        hash.update(&buffer[..n]);
        if let Ok(mut jobs) = inner.jobs.lock()
            && let Some(job) = jobs.iter_mut().find(|j| j.id == work.id)
        {
            job.bytes = job.bytes.saturating_add(n as u64);
        }
    }
    if offset != size {
        return Err(source_changed());
    }
    let hash = format!("{:x}", hash.finalize());
    if work.import.is_some() {
        let (_, _, expected) = store_location(&inner.store, &source.path)?;
        if expected.len() == 64 && hash != expected {
            return Err(source_changed());
        }
    }
    file.sync_all().map_err(|_| ApiError::io())?;
    let before = asset_store::stable_identity(&file)?;
    let meta = probe(&file, &source.path, &work.cancel)?;
    budget.check(staging)?;
    if asset_store::stable_identity(&file)? != before
        || asset_store::stable_identity(&source.file)? != source_identity
    {
        return Err(source_changed());
    }
    live_source(inner, source, work.import.is_some())?;
    let (destination, name, path) = if work.import.is_some() {
        let suffix: String = source_name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || "._-".contains(c) {
                    c
                } else {
                    '_'
                }
            })
            .rev()
            .take(45)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let name = format!("asset-{hash}-{suffix}");
        simple_name(&name)?;
        (
            inner.directory.try_clone().map_err(|_| ApiError::io())?,
            name.clone(),
            inner.root.join(name),
        )
    } else {
        let directory = asset_store::directory(inner.store.media(), &hash)?;
        (
            directory,
            source_name.into(),
            inner
                .store
                .root()
                .join("media")
                .join(&hash)
                .join(source_name),
        )
    };
    let expected_identity = match renameat_with(
        staging,
        partial.name.as_str(),
        &destination,
        name.as_str(),
        RenameFlags::NOREPLACE,
    ) {
        Ok(()) => asset_store::stable_identity(&file)?,
        Err(rustix::io::Errno::EXIST) => {
            let existing = asset_store::regular(&destination, &name)?;
            let identity = asset_store::stable_identity(&existing)?;
            if digest(&existing, budget, &destination)? != hash
                || asset_store::stable_identity(&existing)? != identity
            {
                return Err(ApiError::conflict(
                    "FILE_EXISTS",
                    "Existing asset media was preserved because its bytes differ",
                ));
            }
            identity
        }
        Err(_) => return Err(ApiError::io()),
    };
    destination.sync_all().map_err(|_| ApiError::io())?;
    staging.sync_all().map_err(|_| ApiError::io())?;
    let file = asset_store::regular(&destination, &name)?;
    let identity = asset_store::stable_identity(&file)?;
    if identity != expected_identity {
        return Err(source_changed());
    }
    let fingerprint = fingerprint(&file)?;
    let base = if work.import.is_some() {
        &inner.directory
    } else {
        inner.store.media()
    };
    let witness = Witness {
        directory: destination,
        base: base.try_clone().map_err(|_| ApiError::io())?,
        parent: if work.import.is_some() {
            None
        } else {
            Some(hash)
        },
        name,
        file,
        identity,
    };
    witness.validate()?;
    Ok(Copied {
        path,
        witness,
        size,
        meta,
        source_hash,
        hash: fingerprint,
    })
}
fn run(inner: &Inner, work: &Work) -> Result<Prepared> {
    roots(inner)?;
    let _lock = inner.store.lock()?;
    let budget = Budget {
        start: Instant::now(),
        cancel: work.cancel.clone(),
    };
    budget.check(if work.import.is_some() {
        &inner.directory
    } else {
        inner.store.media()
    })?;
    if let Some((id, revision)) = &work.import {
        inner.store.load(id, revision)?;
    }
    let source_asset = work.asset.as_ref().ok_or_else(ApiError::missing)?;
    let mut payload = asset_payload::decode(source_asset)?;
    let mut remap = HashMap::new();
    let mut files = Vec::new();
    let mut bytes = 0_u64;
    for source in &work.sources {
        let copied = copy(inner, source, work, &budget)?;
        bytes = bytes
            .checked_add(copied.size)
            .ok_or_else(|| ApiError::invalid("Asset byte budget exceeded"))?;
        if bytes > MAX_ASSET {
            return Err(ApiError::invalid("Native asset exceeds 2 GiB"));
        }
        let legacy = if work.import.is_some() {
            let (_, _, hash) = store_location(&inner.store, &source.path)?;
            legacy_hash(&hash)
        } else {
            None
        };
        for item in payload.files().filter(|item| item.path == source.path) {
            let hash_matches = legacy.map_or(
                item.content_hash == 0 || item.content_hash == copied.source_hash,
                |hash| hash == item.content_hash,
            );
            if !same_meta(&item.meta, &copied.meta) || !hash_matches {
                return Err(source_changed());
            }
        }
        remap.insert(source.path.clone(), (copied.path, copied.hash));
        files.push(copied.witness);
    }
    for item in payload.files_mut() {
        let (path, hash) = remap
            .get(&item.path)
            .ok_or_else(|| ApiError::invalid("Asset dependency was not prepared"))?;
        item.path = path.clone();
        item.content_hash = *hash;
    }
    let asset = AssetFile {
        version: source_asset.version,
        name: source_asset.name.clone(),
        folder: source_asset.folder.clone(),
        payload: payload.to_text(),
    };
    asset_payload::decode(&asset)?;
    if let Some((id, revision)) = &work.import {
        inner.store.load(id, revision)?;
    }
    for source in &work.sources {
        live_source(inner, source, work.import.is_some())?;
    }
    for file in &files {
        file.validate()?;
    }
    budget.check(if work.import.is_some() {
        &inner.directory
    } else {
        inner.store.media()
    })?;
    Ok(Prepared { asset, files })
}
fn roots(inner: &Inner) -> Result<()> {
    inner.store.validate_root()?;
    project_root(inner)
}
fn project_root(inner: &Inner) -> Result<()> {
    let live = File::from(
        rustix::fs::open(
            inner.root.as_path(),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| source_changed())?,
    );
    asset_store::same_directory(&live, &inner.directory)
}

fn validate_import_file(inner: &Inner, item: &ImportFile) -> Result<()> {
    let live = File::from(
        openat(
            &inner.directory,
            item.item.path_token.as_str(),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| source_changed())?,
    );
    if asset_store::stable_identity(&item.file)? != item.identity
        || asset_store::stable_identity(&live)? != item.identity
    {
        return Err(source_changed());
    }
    Ok(())
}
fn prepare_import_file(
    inner: &Inner,
    token: &str,
    cancel: &AtomicBool,
    remaining: Duration,
) -> Result<ImportFile> {
    project_root(inner)?;
    if cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    let file = File::from(
        openat(
            &inner.directory,
            token,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::invalid("Media must be a regular file"));
    }
    let identity = asset_store::stable_identity(&file)?;
    let meta = crate::asset_probe::probe_root_media(
        &file,
        vv_media::is_image_path(Path::new(token)),
        cancel,
        remaining,
    )?;
    let content_hash = fingerprint(&file)?;
    let result = ImportFile {
        item: PreparedMedia {
            path_token: token.into(),
            path: inner.root.join(token),
            meta,
            content_hash,
        },
        file,
        identity,
    };
    project_root(inner)?;
    validate_import_file(inner, &result)?;
    Ok(result)
}
fn run_media_import(
    inner: &Inner,
    work: &Work,
    tokens: &[String],
    budget: Duration,
) -> Result<PreparedImport> {
    let start = Instant::now();
    let mut prepared = PreparedImport {
        items: vec![],
        errors: vec![],
        first_error: None,
    };
    project_root(inner)?;
    for (index, token) in tokens.iter().enumerate() {
        if work.cancel.load(Ordering::Acquire) {
            return Err(canceled());
        }
        let remaining = budget.saturating_sub(start.elapsed());
        let result = if remaining.is_zero() {
            Err(ApiError::conflict(
                "MEDIA_IMPORT_BUDGET",
                "The media import processing budget was exhausted; this file was not prepared",
            ))
        } else {
            prepare_import_file(inner, token, &work.cancel, remaining)
        };
        if work.cancel.load(Ordering::Acquire) {
            return Err(canceled());
        }
        match result {
            Ok(file) => prepared.items.push(file),
            Err(error) => {
                prepared.errors.push(json!({"path_token":token,"name":token,"code":error.1,"message":error.2,"status":error.0.as_u16()}));
                if prepared.first_error.is_none() {
                    prepared.first_error = Some(error);
                }
            }
        }
        if let Ok(mut jobs) = inner.jobs.lock()
            && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
        {
            job.import_completed = index + 1;
        }
    }
    if work.cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    prepared.validate(inner)?;
    Ok(prepared)
}

#[cfg(test)]
#[path = "tests/asset_jobs.rs"]
mod tests;
