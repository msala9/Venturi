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
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{FileExt, MetadataExt},
    },
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
pub struct OtioPayload {
    pub project: vv_core::Project,
    pub warnings: Vec<String>,
}
struct OtioWitness {
    token: String,
    parent: Option<String>,
    entry: Option<String>,
    file: Option<File>,
    identity: Option<String>,
}
impl OtioWitness {
    fn validate(&self, inner: &Inner) -> Result<()> {
        let (entry, parent) = otio_entry(inner, &self.token).map_err(|_| source_changed())?;
        if parent != self.parent || entry.map(|meta| entry_identity(&meta)) != self.entry {
            return Err(source_changed());
        }
        if let Some(file) = &self.file
            && (Some(entry_identity(
                &file.metadata().map_err(|_| source_changed())?,
            )) != self.entry
                || Some(asset_store::stable_identity(file)?) != self.identity)
        {
            return Err(source_changed());
        }
        Ok(())
    }
}
struct PreparedOtio {
    token: String,
    payload: OtioPayload,
    witnesses: Vec<OtioWitness>,
}
struct ClipboardWork {
    text: String,
    fallback: Option<String>,
    to_pool: bool,
}
struct PreparedClipboard {
    payload: ClipboardPayload,
    witnesses: Vec<OtioWitness>,
    warnings: Vec<String>,
}
struct PreparedImage {
    stage: crate::clipboard_image::Stage,
    meta: vv_core::MediaMeta,
    summary: Value,
}
impl PreparedClipboard {
    fn validate(&self, inner: &Inner) -> Result<()> {
        project_root(inner)?;
        for witness in &self.witnesses {
            witness.validate(inner)?;
        }
        Ok(())
    }
    fn value(&self) -> Value {
        json!({"clip_count":self.payload.clip_entries().len(),"media_count":self.payload.media_ids().len(),"warnings":self.warnings})
    }
}
impl PreparedOtio {
    fn validate(&self, inner: &Inner) -> Result<()> {
        project_root(inner)?;
        for witness in &self.witnesses {
            witness.validate(inner)?;
        }
        Ok(())
    }
    fn value(&self) -> Value {
        json!({"path_token":self.token,"timeline_count":self.payload.project.timelines.len(),"media_count":self.payload.project.media_pool.len(),"warnings":self.payload.warnings})
    }
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
struct PreparedLibraryEdit {
    edit: crate::asset_journal::PreparedEdit,
    sources: Vec<OtioWitness>,
    files: Vec<Witness>,
    media: Vec<(PathBuf, Option<String>)>,
    tree: Option<crate::files::SourceTreeWitness>,
}
impl PreparedLibraryEdit {
    fn summary(&self) -> Value {
        self.edit.summary()
    }
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
    edit_result: Option<PreparedLibraryEdit>,
    edit: Option<asset_store::Edit>,
    command_id: Option<String>,
    fingerprint: Option<[u8; 32]>,
    media_import: Option<PreparedImport>,
    import_completed: usize,
    import_total: usize,
    otio_probe_total: Option<usize>,
    otio: Option<PreparedOtio>,
    clipboard: Option<PreparedClipboard>,
    clipboard_image: Option<PreparedImage>,
    applied_image: Option<(String, PreparedMedia)>,
}
impl Job {
    fn value(&self) -> Value {
        let result = self.result.as_ref().map(|prepared| {
            let payload = asset_payload::decode(&prepared.asset).ok();
            json!({"asset_id":self.asset_id,"revision":self.revision,"name":prepared.asset.name,"media_count":payload.as_ref().map_or(0,|p| p.media_items().count()),"file_count":prepared.files.len(),"bytes":self.bytes})
        }).or_else(||self.edit_result.as_ref().map(|prepared|prepared.summary())).or_else(||self.media_import.as_ref().map(PreparedImport::value)).or_else(||self.otio.as_ref().map(PreparedOtio::value)).or_else(||self.clipboard.as_ref().map(PreparedClipboard::value)).or_else(||self.clipboard_image.as_ref().map(|prepared|prepared.summary.clone()));
        let mut value = json!({"id":self.id,"kind":self.kind,"project_epoch":self.epoch,"generation":self.generation,"state":self.state,"bytes":self.bytes,"total_bytes":self.total,"error":self.error,"result":result});
        if self.kind == "media_import" {
            value["progress"] =
                json!({"completed":self.import_completed,"total":self.import_total});
        } else if let Some(total) = self.otio_probe_total {
            value["progress"] = json!({"completed":self.import_completed.min(total),"total":total});
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
    otio: Option<String>,
    clipboard: Option<ClipboardWork>,
    clipboard_image: Option<(String, Vec<u8>)>,
}
enum Finished {
    Media(Prepared),
    Edit(PreparedLibraryEdit),
    Import(PreparedImport),
    Otio(PreparedOtio),
    Clipboard(PreparedClipboard),
    Image(PreparedImage),
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
                    let result = if let Some((mime, bytes)) = &work.clipboard_image {
                        run_clipboard_image(&inner, &work, mime, bytes).map(Finished::Image)
                    } else if let Some(clipboard) = &work.clipboard {
                        run_clipboard(&inner, &work, clipboard, MEDIA_IMPORT_BUDGET)
                            .map(Finished::Clipboard)
                    } else if let Some(token) = &work.otio {
                        run_otio(&inner, &work, token, MEDIA_IMPORT_BUDGET).map(Finished::Otio)
                    } else if let Some(tokens) = &work.media_import {
                        run_media_import(&inner, &work, tokens, MEDIA_IMPORT_BUDGET)
                            .map(Finished::Import)
                    } else if let Some((edit, completion)) = &work.edit {
                        if matches!(edit, asset_store::Edit::ImportTree { .. }) {
                            run_import_tree(&inner, &work, edit, completion.clone())
                                .map(Finished::Edit)
                        } else if matches!(
                            edit,
                            asset_store::Edit::Relink { .. }
                                | asset_store::Edit::RelinkFolder { .. }
                        ) {
                            run_relink(&inner, &work, edit, completion.clone()).map(Finished::Edit)
                        } else {
                            inner
                                .store
                                .prepare_edit(edit, completion.clone(), &work.cancel)
                                .map(|edit| {
                                    Finished::Edit(PreparedLibraryEdit {
                                        edit,
                                        sources: vec![],
                                        files: vec![],
                                        media: vec![],
                                        tree: None,
                                    })
                                })
                        }
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
                                    Finished::Otio(prepared) => job.otio = Some(prepared),
                                    Finished::Clipboard(prepared) => job.clipboard = Some(prepared),
                                    Finished::Image(prepared) => {
                                        job.clipboard_image = Some(prepared)
                                    }
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
            crate::files::root_media_token(&self.0.root, &source.path)?;
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
            return Err(ApiError::invalid(
                "Choose a prepared native asset library operation",
            ));
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
        let witness_reservation = if matches!(
            &edit,
            asset_store::Edit::ImportTree { .. } | asset_store::Edit::RelinkFolder { .. }
        ) {
            reserve_witnesses(&jobs, MAX_FILES * 4)?;
            MAX_FILES * 4
        } else if let asset_store::Edit::Relink {
            id,
            revision,
            path_tokens,
        } = &edit
        {
            if path_tokens.is_empty()
                || path_tokens.len() > MAX_FILES
                || path_tokens.iter().collect::<HashSet<_>>().len() != path_tokens.len()
            {
                return Err(ApiError::invalid(
                    "Choose 1 to 64 unique approved replacement files",
                ));
            }
            for token in path_tokens {
                crate::files::root_media_token(&self.0.root, &self.0.root.join(token))?;
                if !vv_media::is_media_path(Path::new(token)) {
                    return Err(ApiError::invalid(
                        "Choose approved native media replacement files",
                    ));
                }
            }
            let asset = self.0.store.load(id, revision)?;
            let payload = asset_payload::decode(&asset)?;
            let reservation = payload
                .files()
                .map(|item| &item.path)
                .collect::<HashSet<_>>()
                .len()
                .saturating_mul(4);
            reserve_witnesses(&jobs, reservation)?;
            reservation
        } else {
            0
        };
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
            otio: None,
            clipboard: None,
            clipboard_image: None,
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
            import_total: witness_reservation,
            otio_probe_total: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
            applied_image: None,
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
    ) -> Result<Value> {
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
        let prepared = job.edit_result.as_mut().ok_or_else(ApiError::missing)?;
        let summary = prepared.summary();
        let PreparedLibraryEdit {
            edit,
            sources,
            files,
            media,
            tree,
        } = prepared;
        if sources.is_empty() && files.is_empty() && media.is_empty() && tree.is_none() {
            self.0.store.commit_edit(edit, &job.cancel)?;
        } else {
            self.0.store.commit_edit_checked(edit, &job.cancel, || {
                roots(&self.0)?;
                if let Some(tree) = tree {
                    tree.validate(&self.0.root, &self.0.directory, &job.cancel)?;
                }
                for source in sources {
                    source.validate(&self.0)?;
                }
                for file in files {
                    file.validate()?;
                }
                for (path, expected) in media {
                    let actual = self
                        .0
                        .store
                        .media_entry(path)?
                        .map(|file| asset_store::stable_identity(&file))
                        .transpose()?;
                    if actual != *expected {
                        return Err(source_changed());
                    }
                }
                Ok(())
            })?;
        }
        job.state = "applied";
        job.edit_result = None;
        Ok(summary)
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
        let sources_descriptor_reservation = sources.len().saturating_mul(4);
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        reserve_witnesses(&jobs, sources_descriptor_reservation)?;
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
            otio: None,
            clipboard: None,
            clipboard_image: None,
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
            import_total: sources_descriptor_reservation,
            otio_probe_total: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
            applied_image: None,
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
        reserve_witnesses(&jobs, tokens.len())?;
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
            otio: None,
            clipboard: None,
            clipboard_image: None,
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
            otio_probe_total: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
            applied_image: None,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn prepare_clipboard_image(
        &self,
        epoch: &str,
        generation: &str,
        mime: &str,
        bytes: Vec<u8>,
    ) -> Result<Value> {
        binding(epoch, generation)?;
        crate::clipboard_image::validate(mime, &bytes)?;
        project_root(&self.0)?;
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        reserve_witnesses(&jobs, 8)?;
        reserve(&mut jobs)?;
        let id = format!("asset-{}", nonce());
        let cancel = Arc::new(AtomicBool::new(false));
        let total = bytes.len() as u64;
        let work = Work {
            id: id.clone(),
            asset: None,
            sources: vec![],
            cancel: cancel.clone(),
            import: None,
            edit: None,
            media_import: None,
            otio: None,
            clipboard: None,
            clipboard_image: Some((mime.into(), bytes)),
        };
        let job = Job {
            id,
            kind: "clipboard_image",
            epoch: epoch.into(),
            generation: generation.into(),
            state: "queued",
            bytes: 0,
            total,
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
            import_total: 8,
            otio_probe_total: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
            applied_image: None,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn clipboard_image_payload(
        &self,
        id: &str,
        epoch: &str,
        generation: &str,
        name: &str,
    ) -> Result<PreparedMedia> {
        let jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        if let Some(item) = applied_image(job, epoch, generation, name)? {
            return Ok(item);
        }
        ready(job, epoch, generation, "clipboard_image")?;
        project_root(&self.0)?;
        let prepared = job.clipboard_image.as_ref().ok_or_else(ApiError::missing)?;
        let target = prepared.stage.preview(name)?;
        Ok(PreparedMedia {
            path: target.path,
            path_token: target.path_token,
            meta: prepared.meta.clone(),
            content_hash: 0,
        })
    }
    // Publication and cancellation share the actor's final acceptance mutex.
    pub fn accept_clipboard_image(
        &self,
        id: &str,
        epoch: &str,
        generation: &str,
        name: &str,
    ) -> Result<PreparedMedia> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        if let Some(item) = applied_image(job, epoch, generation, name)? {
            return Ok(item);
        }
        ready(job, epoch, generation, "clipboard_image")?;
        project_root(&self.0)?;
        let prepared = job.clipboard_image.as_mut().ok_or_else(ApiError::missing)?;
        let published = prepared.stage.publish(name, &job.cancel)?;
        let item = PreparedMedia {
            path: published.path,
            path_token: published.path_token,
            meta: prepared.meta.clone(),
            content_hash: published.content_hash,
        };
        job.applied_image = Some((name.trim().into(), item.clone()));
        job.state = "applied";
        job.clipboard_image = None;
        Ok(item)
    }
    pub fn prepare_clipboard(
        &self,
        epoch: &str,
        generation: &str,
        text: &str,
        fallback: Option<&str>,
        to_pool: bool,
    ) -> Result<Value> {
        binding(epoch, generation)?;
        if text.len() > asset_payload::MAX_ASSET_BYTES
            || fallback.is_some_and(|text| text.len() > asset_payload::MAX_ASSET_BYTES)
        {
            return Err(ApiError::invalid("Native clipboard text exceeds 4 MiB"));
        }
        project_root(&self.0)?;
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        reserve_witnesses(&jobs, 64)?;
        reserve(&mut jobs)?;
        let id = format!("asset-{}", nonce());
        let cancel = Arc::new(AtomicBool::new(false));
        let work = Work {
            id: id.clone(),
            asset: None,
            sources: vec![],
            cancel: cancel.clone(),
            import: None,
            edit: None,
            media_import: None,
            otio: None,
            clipboard: Some(ClipboardWork {
                text: text.into(),
                fallback: fallback.map(str::to_owned),
                to_pool,
            }),
            clipboard_image: None,
        };
        let job = Job {
            id,
            kind: "clipboard_import",
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
            import_total: 64,
            otio_probe_total: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
            applied_image: None,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn clipboard_payload(
        &self,
        id: &str,
        epoch: &str,
        generation: &str,
    ) -> Result<ClipboardPayload> {
        let jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "clipboard_import")?;
        let prepared = job.clipboard.as_ref().ok_or_else(ApiError::missing)?;
        prepared.validate(&self.0)?;
        Ok(prepared.payload.clone())
    }
    pub fn mark_clipboard_applied(&self, id: &str, epoch: &str, generation: &str) -> Result<()> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "clipboard_import")?;
        job.clipboard
            .as_ref()
            .ok_or_else(ApiError::missing)?
            .validate(&self.0)?;
        job.state = "applied";
        job.clipboard = None;
        Ok(())
    }
    pub fn prepare_otio(&self, epoch: &str, generation: &str, path_token: &str) -> Result<Value> {
        binding(epoch, generation)?;
        simple_name(path_token)?;
        if !path_token.ends_with(".otio") {
            return Err(ApiError::invalid("Choose a listed .otio file"));
        }
        project_root(&self.0)?;
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        reserve_witnesses(&jobs, 65)?;
        reserve(&mut jobs)?;
        let id = format!("asset-{}", nonce());
        let cancel = Arc::new(AtomicBool::new(false));
        let work = Work {
            id: id.clone(),
            asset: None,
            sources: vec![],
            cancel: cancel.clone(),
            import: None,
            edit: None,
            media_import: None,
            otio: Some(path_token.into()),
            clipboard: None,
            clipboard_image: None,
        };
        let job = Job {
            id,
            kind: "otio_import",
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
            import_total: 65,
            otio_probe_total: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
            applied_image: None,
        };
        let value = job.value();
        jobs.push_back(job);
        if self.0.sender.try_send(work).is_err() {
            jobs.pop_back();
            return Err(busy());
        }
        Ok(value)
    }
    pub fn otio_payload(&self, id: &str, epoch: &str, generation: &str) -> Result<OtioPayload> {
        let jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "otio_import")?;
        let prepared = job.otio.as_ref().ok_or_else(ApiError::missing)?;
        prepared.validate(&self.0)?;
        Ok(OtioPayload {
            project: prepared.payload.project.clone(),
            warnings: prepared.payload.warnings.clone(),
        })
    }
    pub fn mark_otio_applied(&self, id: &str, epoch: &str, generation: &str) -> Result<()> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or_else(ApiError::missing)?;
        ready(job, epoch, generation, "otio_import")?;
        job.otio
            .as_ref()
            .ok_or_else(ApiError::missing)?
            .validate(&self.0)?;
        job.state = "applied";
        job.otio = None;
        Ok(())
    }
    // Only the legacy save coordinator may report a failed save after consuming
    // the preparation and before installing its new project.
    pub fn mark_otio_failed(&self, id: &str, epoch: &str, error: ApiError) -> Result<()> {
        let mut jobs = self.0.jobs.lock().map_err(|_| ApiError::io())?;
        let job = jobs
            .iter_mut()
            .find(|job| {
                job.id == id
                    && job.epoch == epoch
                    && job.kind == "otio_import"
                    && job.state == "applied"
            })
            .ok_or_else(ApiError::missing)?;
        job.state = "failed";
        job.error = Some(error.1);
        job.failure = Some(error);
        Ok(())
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
                job.otio = None;
                job.clipboard = None;
                job.clipboard_image = None;
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
            job.otio = None;
            job.clipboard = None;
            job.clipboard_image = None;
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
fn applied_image(
    job: &Job,
    epoch: &str,
    generation: &str,
    name: &str,
) -> Result<Option<PreparedMedia>> {
    if job.kind != "clipboard_image" || job.state != "applied" {
        return Ok(None);
    }
    if job.epoch != epoch || job.generation != generation {
        return Err(ApiError::conflict(
            "ASSET_CONTEXT_CHANGED",
            "Project changed; prepare the clipboard image again",
        ));
    }
    match &job.applied_image {
        Some((saved, item)) if saved == name.trim() => Ok(Some(item.clone())),
        _ => Err(ApiError::conflict(
            "ASSET_PUBLISHED",
            "The clipboard image was already added under another name",
        )),
    }
}
fn reserve_witnesses(jobs: &VecDeque<Job>, additional: usize) -> Result<()> {
    let retained: usize = jobs
        .iter()
        .map(|job| {
            if matches!(job.state, "queued" | "running") {
                job.import_total
            } else {
                job.media_import
                    .as_ref()
                    .map_or(0, |prepared| prepared.items.len())
                    + job
                        .result
                        .as_ref()
                        .map_or(0, |prepared| prepared.files.len().saturating_mul(3))
                    + job.otio.as_ref().map_or(0, |prepared| {
                        prepared
                            .witnesses
                            .iter()
                            .filter(|witness| witness.file.is_some())
                            .count()
                    })
                    + job.clipboard.as_ref().map_or(0, |prepared| {
                        prepared
                            .witnesses
                            .iter()
                            .filter(|witness| witness.file.is_some())
                            .count()
                    })
                    + job.clipboard_image.as_ref().map_or(0, |_| 8)
                    + job.edit_result.as_ref().map_or(0, |prepared| {
                        prepared.sources.len() + prepared.files.len().saturating_mul(3)
                    })
            }
        })
        .sum();
    if retained.saturating_add(additional) > crate::files::MAX_MEDIA_IMPORTS {
        return Err(busy());
    }
    Ok(())
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
    if import {
        let (dir, name, _) = store_location(&inner.store, &source.path)?;
        let live = asset_store::regular(&dir, &name)?;
        if crate::source::file_identity(&live)? != source.identity {
            return Err(source_changed());
        }
    } else {
        let token = crate::files::root_media_token(&inner.root, &source.path)?;
        crate::files::validate_approved_file(&inner.root, &inner.directory, &token, &source.file)?;
    }
    if crate::source::file_identity(&source.file)? != source.identity {
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
        "gif" => n >= 6 && (&h[..6] == b"GIF87a" || &h[..6] == b"GIF89a"),
        "bmp" => n >= 2 && &h[..2] == b"BM",
        "tif" | "tiff" => n >= 4 && (&h[..4] == b"II\x2a\0" || &h[..4] == b"MM\0\x2a"),
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
fn reopen_written_stage(file: File, directory: &File, name: &str) -> Result<File> {
    file.sync_all().map_err(|_| ApiError::io())?;
    let written = file.metadata().map_err(|_| ApiError::io())?;
    // CIFS can finalize write timestamps only when the last writer closes.
    drop(file);
    let file = asset_store::regular(directory, name)?;
    let reopened = file.metadata().map_err(|_| ApiError::io())?;
    if (written.dev(), written.ino(), written.len())
        != (reopened.dev(), reopened.ino(), reopened.len())
    {
        return Err(source_changed());
    }
    Ok(file)
}
fn copy(inner: &Inner, source: &PinnedSource, work: &Work, budget: &Budget) -> Result<Copied> {
    copy_checked(inner, source, work, budget, None, |_, _, _| Ok(()))
}
fn copy_checked(
    inner: &Inner,
    source: &PinnedSource,
    work: &Work,
    budget: &Budget,
    publish_path: Option<&Path>,
    validate: impl FnOnce(&vv_core::MediaMeta, u64, &str) -> Result<()>,
) -> Result<Copied> {
    live_source(inner, source, work.import.is_some())?;
    let source_identity = asset_store::stable_identity(&source.file)?;
    let source_hash = fingerprint(&source.file)?;
    let source_name = source
        .path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(ApiError::missing)?;
    let managed_name;
    let source_name = if work.import.is_none()
        && source_name.starts_with('.')
        && crate::files::root_media_token(&inner.root, &source.path)?.starts_with("Pasted Images/")
    {
        managed_name = format!(
            "image.{}",
            source
                .path
                .extension()
                .and_then(|extension| extension.to_str())
                .ok_or_else(ApiError::missing)?
        );
        managed_name.as_str()
    } else {
        source_name
    };
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
    let file = reopen_written_stage(file, staging, &partial.name)?;
    let before = asset_store::stable_identity(&file)?;
    if digest(&file, budget, staging)? != hash {
        return Err(source_changed());
    }
    let meta = probe(&file, &source.path, &work.cancel)?;
    budget.check(staging)?;
    if asset_store::stable_identity(&file)? != before
        || asset_store::stable_identity(&source.file)? != source_identity
    {
        return Err(source_changed());
    }
    live_source(inner, source, work.import.is_some())?;
    validate(&meta, source_hash, &hash)?;
    let (destination, name, path) = if let Some(path) = publish_path {
        inner.store.media_entry(path)?;
        let parent = path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .ok_or_else(ApiError::missing)?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(ApiError::missing)?;
        (
            asset_store::directory(inner.store.media(), parent)?,
            name.to_owned(),
            path.to_owned(),
        )
    } else if work.import.is_some() {
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
            Some(
                path.parent()
                    .and_then(|parent| parent.file_name())
                    .and_then(|name| name.to_str())
                    .ok_or_else(ApiError::missing)?
                    .to_owned(),
            )
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
            // SHA-directory imports already authenticate bytes; native fingerprints include path/mtime.
            let hash_matches = legacy.map_or(
                work.import.is_some()
                    || item.content_hash == 0
                    || item.content_hash == copied.source_hash,
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
fn run_relink(
    inner: &Inner,
    work: &Work,
    edit: &asset_store::Edit,
    completion: crate::asset_journal::Completion,
) -> Result<PreparedLibraryEdit> {
    let scan = if let asset_store::Edit::RelinkFolder {
        directory_token, ..
    } = edit
    {
        Some(crate::files::scan_media_tree(
            &inner.root,
            &inner.directory,
            directory_token,
            &work.cancel,
        )?)
    } else {
        None
    };
    let scanned_tokens;
    let (id, revision, path_tokens) = match edit {
        asset_store::Edit::Relink {
            id,
            revision,
            path_tokens,
        } => (id, revision, path_tokens),
        asset_store::Edit::RelinkFolder { id, revision, .. } => {
            scanned_tokens = scan
                .as_ref()
                .ok_or_else(ApiError::missing)?
                .tree
                .files
                .iter()
                .map(|(path, _)| crate::files::root_media_token(&inner.root, path))
                .collect::<Result<Vec<_>>>()?;
            (id, revision, &scanned_tokens)
        }
        _ => return Err(ApiError::invalid("Choose a native asset relink")),
    };
    roots(inner)?;
    let lock = inner.store.lock()?;
    let asset = inner.store.load(id, revision)?;
    let payload = asset_payload::decode(&asset)?;
    let missing = inner.store.missing_files(&asset)?;
    let budget = Budget {
        start: Instant::now(),
        cancel: work.cancel.clone(),
    };
    budget.check(inner.store.media())?;
    let mut names = HashMap::new();
    for token in path_tokens {
        crate::files::root_media_token(&inner.root, &inner.root.join(token))?;
        let name = Path::new(token)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(ApiError::missing)?;
        if names.contains_key(name) && scan.is_none() {
            return Err(ApiError::invalid(
                "Selected replacement file names are ambiguous",
            ));
        }
        names.entry(name.to_owned()).or_insert(token);
    }
    let original_missing: HashSet<_> = missing
        .iter()
        .filter(|(_, missing)| *missing)
        .map(|(path, _)| path.clone())
        .collect();
    let mut remap = HashMap::new();
    let mut sources = Vec::new();
    let mut files = Vec::new();
    let mut total = 0_u64;
    for (path, is_missing) in missing {
        if !is_missing {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(ApiError::missing)?;
        let Some(token) = names.get(filename) else {
            continue;
        };
        budget.check(inner.store.media())?;
        let source_path = inner.root.join(token);
        let file = crate::files::open_root_media(&inner.root, &inner.directory, &source_path)?;
        let identity = asset_store::stable_identity(&file)?;
        let (entry, parent) = otio_entry(inner, token)?;
        let size = file.metadata().map_err(|_| ApiError::io())?.len();
        total = total
            .checked_add(size)
            .ok_or_else(|| ApiError::invalid("Asset byte budget exceeded"))?;
        if size > MAX_FILE || total > MAX_ASSET {
            return Err(ApiError::invalid(
                "Relink exceeds 512 MiB per file or 2 GiB total",
            ));
        }
        if let Ok(mut jobs) = inner.jobs.lock()
            && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
        {
            job.total = total;
        }
        let source = PinnedSource {
            identity: crate::source::file_identity(&file)?,
            path: source_path,
            file,
        };
        let copied = copy_checked(
            inner,
            &source,
            work,
            &budget,
            Some(&path),
            |meta, _, sha| validate_relink_match(&payload, &path, meta, sha),
        )?;
        let witness = OtioWitness {
            token: (*token).clone(),
            parent,
            entry: entry.map(|meta| entry_identity(&meta)),
            file: Some(source.file),
            identity: Some(identity),
        };
        witness.validate(inner)?;
        copied.witness.validate()?;
        remap.insert(path, copied.path);
        sources.push(witness);
        files.push(copied.witness);
    }
    for source in &sources {
        source.validate(inner)?;
    }
    for file in &files {
        file.validate()?;
    }
    let media = inner
        .store
        .missing_files(&asset)?
        .into_iter()
        .map(|(path, _)| {
            let identity = inner
                .store
                .media_entry(&path)?
                .map(|file| asset_store::stable_identity(&file))
                .transpose()?;
            Ok((path, identity))
        })
        .collect::<Result<Vec<_>>>()?;
    budget.check(inner.store.media())?;
    drop(lock);
    let edit =
        inner
            .store
            .prepare_relink(edit, &remap, &original_missing, completion, &work.cancel)?;
    Ok(PreparedLibraryEdit {
        edit,
        sources,
        files,
        media,
        tree: scan.map(|scan| scan.witness),
    })
}
fn run_import_tree(
    inner: &Inner,
    work: &Work,
    edit: &asset_store::Edit,
    completion: crate::asset_journal::Completion,
) -> Result<PreparedLibraryEdit> {
    let asset_store::Edit::ImportTree {
        directory_token, ..
    } = edit
    else {
        return Err(ApiError::invalid("Choose a native folder import"));
    };
    roots(inner)?;
    let budget = Budget {
        start: Instant::now(),
        cancel: work.cancel.clone(),
    };
    let scan = crate::files::scan_media_tree(
        &inner.root,
        &inner.directory,
        directory_token,
        &work.cancel,
    )?;
    let plan =
        inner
            .store
            .plan_import_tree(edit, &scan.tree, &completion.command_id, &work.cancel)?;
    let prefix = format!(
        "tree-{:x}",
        Sha256::digest(completion.command_id.as_bytes())
    );
    let mut assets = Vec::new();
    let mut sources = Vec::new();
    let mut files = Vec::new();
    let mut skipped = 0;
    let mut errors = Vec::new();
    let mut total = 0_u64;
    for (index, (path, folder)) in scan.tree.files.iter().enumerate() {
        budget.check(inner.store.media())?;
        let token = crate::files::root_media_token(&inner.root, path)?;
        let witness = otio_witness(inner, &token)?;
        let destination_folder = match folder {
            Some(folder) => plan
                .folders
                .get(*folder)
                .cloned()
                .ok_or_else(ApiError::missing)?,
            None => None,
        };
        let result = (|| {
            let file = crate::files::open_approved_media(&inner.root, &inner.directory, &token)?;
            let size = file.metadata().map_err(|_| ApiError::io())?.len();
            total = total
                .checked_add(size)
                .ok_or_else(|| ApiError::invalid("Asset byte budget exceeded"))?;
            if total > MAX_ASSET {
                return Err(ApiError::conflict(
                    "ASSET_BYTE_BUDGET",
                    "Folder import exceeds its 2 GiB total byte budget",
                ));
            }
            if size > MAX_FILE {
                return Err(ApiError::invalid("Asset file exceeds 512 MiB"));
            }
            if let Ok(mut jobs) = inner.jobs.lock()
                && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
            {
                job.total = total;
            }
            let source_hash = fingerprint(&file)?;
            if plan
                .present
                .contains(&(source_hash, destination_folder.clone()))
            {
                probe(&file, path, &work.cancel)?;
                skipped += 1;
                return Ok(());
            }
            let source = PinnedSource {
                path: path.clone(),
                identity: crate::source::file_identity(&file)?,
                file,
            };
            let copied = copy(inner, &source, work, &budget)?;
            let mut project = vv_core::Project::default();
            let id = project.media_pool.insert(vv_core::MediaItem {
                path: copied.path,
                meta: copied.meta,
                content_hash: copied.source_hash,
                compound: None,
                folder: None,
            });
            let payload = ClipboardPayload::new(
                vv_core::clipboard::ClipboardOrigin {
                    instance: 0,
                    epoch: 0,
                },
                &project,
                &[id],
                &[],
            );
            let asset = AssetFile {
                version: 1,
                name: vv_session::file_label(path),
                folder: destination_folder,
                payload: payload.to_text(),
            };
            asset_payload::decode(&asset)?;
            files.push(copied.witness);
            assets.push((format!("{prefix}-a{index}"), asset));
            Ok(())
        })();
        witness.validate(inner)?;
        sources.push(witness);
        if let Err(error) = result {
            if matches!(
                error.1,
                "ASSET_CANCELED"
                    | "ASSET_TIMEOUT"
                    | "ASSET_DISK_FULL"
                    | "ASSET_SOURCE_CHANGED"
                    | "SOURCE_CHANGED"
                    | "ASSET_BYTE_BUDGET"
            ) {
                return Err(error);
            }
            errors.push(json!({"path_token":token,"code":error.1,"message":error.2}));
        }
    }
    scan.witness
        .validate(&inner.root, &inner.directory, &work.cancel)?;
    for source in &sources {
        source.validate(inner)?;
    }
    for file in &files {
        file.validate()?;
    }
    budget.check(inner.store.media())?;
    let edit =
        inner
            .store
            .prepare_import_tree(plan, assets, skipped, errors, completion, &work.cancel)?;
    Ok(PreparedLibraryEdit {
        edit,
        sources,
        files,
        media: vec![],
        tree: Some(scan.witness),
    })
}
fn validate_relink_match(
    payload: &ClipboardPayload,
    path: &Path,
    meta: &vv_core::MediaMeta,
    sha256: &str,
) -> Result<()> {
    let directory = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .ok_or_else(ApiError::missing)?;
    if directory.len() == 64 && directory != sha256 {
        return Err(source_changed());
    }
    let legacy = legacy_hash(directory);
    if payload
        .files()
        .filter(|item| item.path == path)
        .any(|item| {
            !same_meta(&item.meta, meta) || legacy.is_some_and(|hash| hash != item.content_hash)
        })
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Replacement must match the native asset metadata and managed content identity",
        ));
    }
    Ok(())
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
    let live = crate::files::open_root_media(&inner.root, &inner.directory, &item.item.path)
        .map_err(|_| source_changed())?;
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
    let file =
        crate::files::open_root_media(&inner.root, &inner.directory, &inner.root.join(token))?;
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::invalid("Media must be a regular file"));
    }
    let identity = asset_store::stable_identity(&file)?;
    let item = probe_import_file(inner, token, &file, cancel, remaining)?;
    let result = ImportFile {
        item,
        file,
        identity,
    };
    project_root(inner)?;
    validate_import_file(inner, &result)?;
    Ok(result)
}
fn probe_import_file(
    inner: &Inner,
    token: &str,
    file: &File,
    cancel: &AtomicBool,
    remaining: Duration,
) -> Result<PreparedMedia> {
    let meta = crate::asset_probe::probe_root_media(
        file,
        vv_media::is_image_path(Path::new(token)),
        cancel,
        remaining,
    )?;
    let content_hash = fingerprint(file)?;
    Ok(PreparedMedia {
        path_token: token.into(),
        path: inner.root.join(token),
        meta,
        content_hash,
    })
}
fn entry_identity(meta: &std::fs::Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        meta.dev(),
        meta.ino(),
        meta.len(),
        meta.mtime(),
        meta.mtime_nsec(),
        meta.ctime(),
        meta.ctime_nsec(),
        meta.mode()
    )
}
fn otio_entry(inner: &Inner, token: &str) -> Result<(Option<std::fs::Metadata>, Option<String>)> {
    project_root(inner)?;
    crate::files::source_entry(&inner.root, &inner.directory, token)
}
fn otio_witness(inner: &Inner, token: &str) -> Result<OtioWitness> {
    let (metadata, parent) = otio_entry(inner, token)?;
    if metadata
        .as_ref()
        .is_some_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
    {
        return Err(ApiError::invalid(
            "Media links and special files are refused",
        ));
    }
    let file =
        crate::files::open_root_media(&inner.root, &inner.directory, &inner.root.join(token)).ok();
    let identity = file
        .as_ref()
        .map(asset_store::stable_identity)
        .transpose()?;
    let witness = OtioWitness {
        token: token.into(),
        parent,
        entry: metadata.as_ref().map(entry_identity),
        file,
        identity,
    };
    witness.validate(inner)?;
    if let Some(file) = &witness.file
        && !file.metadata().map_err(|_| ApiError::io())?.is_file()
    {
        return Err(ApiError::invalid("Media must be a regular file"));
    }
    Ok(witness)
}
fn otio_budget(start: Instant, budget: Duration, cancel: &AtomicBool) -> Result<Duration> {
    if cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    let remaining = budget.saturating_sub(start.elapsed());
    if remaining.is_zero() {
        return Err(ApiError::conflict(
            "OTIO_IMPORT_BUDGET",
            "OTIO import exceeded its processing budget",
        ));
    }
    Ok(remaining)
}
fn clipboard_budget(start: Instant, budget: Duration, cancel: &AtomicBool) -> Result<Duration> {
    otio_budget(start, budget, cancel).map_err(|error| {
        if error.1 == "OTIO_IMPORT_BUDGET" {
            ApiError::conflict(
                "CLIPBOARD_IMPORT_BUDGET",
                "Clipboard preparation exceeded its processing budget",
            )
        } else {
            error
        }
    })
}
fn clipboard_token(inner: &Inner, path: &Path) -> Result<String> {
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        inner.root.join(path)
    };
    crate::files::root_media_token(&inner.root, &path)
}
fn clipboard_text(work: &ClipboardWork) -> Result<ClipboardPayload> {
    if work.text.is_empty() {
        return Err(ApiError::invalid(
            "Clipboard contains no text; image paste is not supported",
        ));
    }
    let parsed = match ClipboardPayload::from_text(&work.text) {
        Some(result) => Some(result),
        None if work.to_pool => {
            return Ok(ClipboardPayload::new(
                vv_core::clipboard::ClipboardOrigin {
                    instance: 0,
                    epoch: 0,
                },
                &vv_core::Project::default(),
                &[],
                &[],
            ));
        }
        None => work
            .fallback
            .as_deref()
            .and_then(ClipboardPayload::from_text),
    };
    parsed
        .ok_or_else(|| {
            ApiError::conflict(
                "CLIPBOARD_EMPTY",
                "Copy native clips before pasting ordinary text",
            )
        })?
        .map_err(|_| ApiError::invalid("Unsupported or malformed native clipboard payload"))
}
fn image_disk(inner: &Inner, additional: u64) -> Result<()> {
    let stat = rustix::fs::fstatvfs(&inner.directory).map_err(|_| ApiError::io())?;
    if stat.f_bavail.saturating_mul(stat.f_frsize) < RESERVE.saturating_add(additional) {
        return Err(ApiError::conflict(
            "ASSET_DISK_FULL",
            "Clipboard image preparation requires 512 MiB of free disk reserve",
        ));
    }
    Ok(())
}
fn run_clipboard_image(
    inner: &Inner,
    work: &Work,
    mime: &str,
    bytes: &[u8],
) -> Result<PreparedImage> {
    project_root(inner)?;
    image_disk(inner, bytes.len() as u64)?;
    let start = Instant::now();
    let stage = crate::clipboard_image::Stage::new(
        &inner.root,
        inner.directory.try_clone().map_err(|_| ApiError::io())?,
        mime,
        bytes,
        &work.cancel,
    )?;
    stage.validate()?;
    let meta = crate::asset_probe::probe_root_media(
        stage.file(),
        stage.is_image(),
        &work.cancel,
        MEDIA_IMPORT_BUDGET.saturating_sub(start.elapsed()),
    )?;
    if work.cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    project_root(inner)?;
    stage.verify_content()?;
    image_disk(inner, 0)?;
    if !meta.has_video
        || meta.width == 0
        || meta.height == 0
        || meta.width > 32768
        || meta.height > 32768
    {
        return Err(ApiError::invalid("Clipboard image dimensions are invalid"));
    }
    let summary = json!({
        "suggested_name":stage.suggested_name()?,
        "extension":stage.extension(),
        "mime":stage.mime(),
        "bytes":bytes.len(),
        "width":meta.width,
        "height":meta.height,
    });
    Ok(PreparedImage {
        stage,
        meta,
        summary,
    })
}

fn run_clipboard(
    inner: &Inner,
    work: &Work,
    source: &ClipboardWork,
    budget: Duration,
) -> Result<PreparedClipboard> {
    let start = Instant::now();
    clipboard_budget(start, budget, &work.cancel)?;
    project_root(inner)?;
    let mut payload = clipboard_text(source)?;
    asset_payload::validate_clipboard(&payload)?;
    let mut files: std::collections::BTreeMap<String, Vec<PathBuf>> =
        std::collections::BTreeMap::new();
    for item in payload.files() {
        files
            .entry(clipboard_token(inner, &item.path)?)
            .or_default()
            .push(item.path.clone());
    }
    if let Ok(mut jobs) = inner.jobs.lock()
        && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
    {
        job.otio_probe_total = Some(files.len());
    }
    let mut witnesses = Vec::new();
    let mut warnings = Vec::new();
    for (token, originals) in files {
        let remaining = clipboard_budget(start, budget, &work.cancel)?;
        project_root(inner)?;
        let witness = otio_witness(inner, &token)?;
        let probe = if let Some(file) = &witness.file {
            probe_import_file(inner, &token, file, &work.cancel, remaining)
        } else {
            Err(ApiError::missing())
        };
        witness.validate(inner)?;
        clipboard_budget(start, budget, &work.cancel)?;
        let hash = match probe {
            Ok(actual) => {
                if payload
                    .files()
                    .filter(|item| originals.contains(&item.path))
                    .any(|item| !same_meta(&item.meta, &actual.meta))
                {
                    return Err(source_changed());
                }
                actual.content_hash
            }
            Err(error)
                if matches!(
                    error.1,
                    "SOURCE_CHANGED"
                        | "ASSET_CANCELED"
                        | "MEDIA_IMPORT_TIMEOUT"
                        | "ASSET_PROBE_TIMEOUT"
                ) || error.2
                    == "Indirect playlists and network manifests cannot be imported as root media" =>
            {
                return Err(error);
            }
            Err(_) => {
                warnings.push(format!("Media {token} was kept offline"));
                0
            }
        };
        // An external hash is never a reuse credential. The native engine may
        // reuse only this independently fingerprinted file, or this offline path.
        for item in payload
            .files_mut()
            .filter(|item| originals.contains(&item.path))
        {
            item.content_hash = hash;
            item.path = inner.root.join(&token);
        }
        witnesses.push(witness);
        if let Ok(mut jobs) = inner.jobs.lock()
            && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
        {
            job.import_completed = job.import_completed.saturating_add(1);
        }
    }
    asset_payload::validate_clipboard(&payload)?;
    let prepared = PreparedClipboard {
        payload,
        witnesses,
        warnings,
    };
    prepared.validate(inner)?;
    clipboard_budget(start, budget, &work.cancel)?;
    Ok(prepared)
}
fn run_otio(inner: &Inner, work: &Work, token: &str, budget: Duration) -> Result<PreparedOtio> {
    let start = Instant::now();
    otio_budget(start, budget, &work.cancel)?;
    project_root(inner)?;
    let descriptor = otio_witness(inner, token)?;
    let file = descriptor.file.as_ref().ok_or_else(ApiError::missing)?;
    if file.metadata().map_err(|_| ApiError::io())?.len() > crate::files::MAX_PROJECT {
        return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
    }
    let mut bytes = Vec::new();
    file.take(crate::files::MAX_PROJECT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    descriptor.validate(inner)?;
    let mut witnesses = vec![descriptor];
    let mut cached: HashMap<PathBuf, crate::files::OtioProbeResult> = HashMap::new();
    let mut fatal: Option<ApiError> = None;
    let result = crate::files::parse_otio(
        &bytes,
        &inner.root,
        &mut |path| {
            let mut offline = false;
            let attempt = (|| -> Result<(vv_core::MediaMeta, u64)> {
                if let Some(error) = &fatal {
                    return Err(error.clone());
                }
                let remaining = otio_budget(start, budget, &work.cancel)?;
                project_root(inner)?;
                let token = crate::files::root_media_token(&inner.root, path)?;
                if let Some(result) = cached.get(path) {
                    offline = result.is_err();
                    return result
                        .clone()
                        .map_err(|_| ApiError::invalid("Media is offline"));
                }
                if witnesses.len() > 64 {
                    return Err(ApiError::invalid(
                        "OTIO import currently supports at most 64 distinct media URLs",
                    ));
                }
                let witness = otio_witness(inner, &token)?;
                let probe = if let Some(file) = &witness.file {
                    probe_import_file(inner, &token, file, &work.cancel, remaining)
                        .map(|item| (item.meta, item.content_hash))
                } else {
                    Err(ApiError::missing())
                };
                witness.validate(inner)?;
                witnesses.push(witness);
                otio_budget(start, budget, &work.cancel)?;
                match probe {
                    Ok(value) => Ok(value),
                    Err(error)
                        if matches!(
                            error.1,
                            "SOURCE_CHANGED"
                                | "ASSET_CANCELED"
                                | "MEDIA_IMPORT_TIMEOUT"
                                | "ASSET_PROBE_TIMEOUT"
                        ) || error.2
                            == "Indirect playlists and network manifests cannot be imported as root media" =>
                    {
                        Err(error)
                    }
                    Err(error) => {
                        cached.insert(path.to_owned(), Err(error.2.to_owned()));
                        offline = true;
                        Err(error)
                    }
                }
            })();
            let callback_result = match attempt {
                Ok(value) => {
                    cached.insert(path.to_owned(), Ok(value.clone()));
                    Ok(value)
                }
                Err(error) => {
                    // Native callback failures become offline clips. Only unchanged
                    // regular unreadable/missing sources may follow that path.
                    if !offline && fatal.is_none() {
                        fatal = Some(error.clone());
                    }
                    Err(error.2.to_owned())
                }
            };
            if let Ok(mut jobs) = inner.jobs.lock()
                && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
            {
                job.import_completed = job.import_completed.saturating_add(1);
            }
            callback_result
        },
        &mut |total| {
            if let Ok(mut jobs) = inner.jobs.lock()
                && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
            {
                job.otio_probe_total = Some(total);
            }
        },
    );
    if let Some(error) = fatal {
        return Err(error);
    }
    otio_budget(start, budget, &work.cancel)?;
    let (project, warnings) = result?;
    if ron::ser::to_string(&project)
        .map_err(|_| ApiError::io())?
        .len() as u64
        > crate::files::MAX_PROJECT
    {
        return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
    }
    let prepared = PreparedOtio {
        token: token.into(),
        payload: OtioPayload { project, warnings },
        witnesses,
    };
    prepared.validate(inner)?;
    otio_budget(start, budget, &work.cancel)?;
    Ok(prepared)
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
