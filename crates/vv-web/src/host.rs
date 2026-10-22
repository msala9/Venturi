use crate::{
    commands::{self, Mutation, Operation},
    error::{ApiError, Result},
    files::Files,
    preview::{FrameQuery, FrameSnapshot, frame_size},
    snapshot,
    source::{SourceQuery, SourceSpec},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};
use tokio::sync::oneshot;
use vv_core::{Rational, Timeline, Track, TrackKind};
use vv_session::Session;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyframeNavigationRequest {
    pub query: FrameQuery,
    pub source_frame: i64,
}

pub enum Action {
    MediaRoot(oneshot::Sender<Result<std::fs::File>>),
    SourceBrowserTask(
        crate::files::SourcesQuery,
        oneshot::Sender<Result<crate::files::SourceBrowserTask>>,
    ),
    Session,
    Timeline(String),
    Projects,
    Recovery,
    Lease(String),
    Mutation(Option<String>, Mutation),
    Lookup(String),
    FrameSnapshot(FrameQuery, oneshot::Sender<Result<FrameSnapshot>>),
    AudioSnapshot(FrameQuery, oneshot::Sender<Result<crate::audition::Task>>),
    CheckFrame(FrameQuery),
    ClipDetail(String, FrameQuery, Option<usize>),
    InspectorSelection(crate::selection::Request),
    KeyframeNavigation(String, KeyframeNavigationRequest),
    ProjectView(crate::project_view::Request),
    SlipDetail(String, i64, FrameQuery),
    TakePlan(crate::take::Preview),
    CompoundNavigation(crate::compound_navigation::Request),
    Review(SourceQuery),
    CapturePreset(crate::presets::Capture),
    PresetList(usize, crate::preset_store::Query),
    AudioPresets(SourceQuery),
    PresetItem(String, SourceQuery),
    PresetExport(String, SourceQuery, oneshot::Sender<Result<Vec<u8>>>),
    PrepareNativeAsset(NativeAssetRequest),
    PrepareMediaImport(MediaImportRequest),
    PrepareOtio(OtioImportRequest),
    OtioImportStatus(String, SourceQuery, bool),
    Clipboard(ClipboardQuery),
    PrepareClipboard(ClipboardRequest),
    ClipboardStatus(String, SourceQuery, bool),
    CheckClipboardImage(ClipboardImageQuery),
    PrepareClipboardImage(ClipboardImageQuery, String, Vec<u8>),
    ClipboardImageStatus(String, SourceQuery, bool),
    PrepareLegacyMediaImport(Mutation, oneshot::Sender<Result<NativeEditPreparation>>),
    MediaImportStatus(String, SourceQuery, bool),
    PrepareNativeAssetEdit(Mutation, oneshot::Sender<Result<NativeEditPreparation>>),
    NativeAssetFolders(SourceQuery),
    NativeAssetList(usize, crate::asset_store::Query),
    NativeAssetItem(String, NativeAssetItemQuery),
    NativeAssetExport(String, SourceQuery, oneshot::Sender<Result<Vec<u8>>>),
    NativeAssetStatus(String, SourceQuery, bool),
    SpeechSnapshot(
        crate::silence::Request,
        oneshot::Sender<Result<crate::silence::Task>>,
    ),
    EqResponse(String, usize, FrameQuery),
    SourceSnapshot(String, SourceQuery, oneshot::Sender<Result<SourceSpec>>),
}
type Message = (Action, oneshot::Sender<Result<Value>>);
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardImageQuery {
    pub project_epoch: String,
    pub if_generation: String,
}
const MAX_RECEIPTS: usize = 4096;
const MAX_IMPORT_RECEIPT_CACHE: usize = 15 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeAssetRequest {
    pub project_epoch: String,
    pub if_generation: String,
    pub action: NativeAssetAction,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaImportRequest {
    pub project_epoch: String,
    pub if_generation: String,
    pub path_tokens: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OtioImportRequest {
    pub project_epoch: String,
    pub if_generation: String,
    pub path_token: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardQuery {
    pub project_epoch: String,
    pub if_generation: String,
    pub clipboard_revision: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardRequest {
    pub project_epoch: String,
    pub if_generation: String,
    pub text: Option<String>,
    pub to_pool: bool,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NativeAssetAction {
    Capture { media_id: String, name: String },
    Import { asset_id: String, revision: String },
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeAssetItemQuery {
    pub project_epoch: String,
    #[serde(default)]
    pub archived: bool,
}
struct ImportedAsset {
    selected: Vec<vv_core::MediaId>,
    media: HashSet<vv_core::MediaId>,
    timelines: HashSet<vv_core::TimelineId>,
}
pub enum NativeEditPreparation {
    Complete(Value),
    Pending(NativeEditGuard),
}
pub struct NativeEditGuard {
    jobs: crate::asset_jobs::Jobs,
    job: String,
    epoch: String,
    armed: bool,
}
impl Drop for NativeEditGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = self.jobs.status(&self.job, &self.epoch, true);
        }
    }
}
struct PendingNativeEdit {
    fingerprint: [u8; 32],
    job: String,
    epoch: String,
}
#[derive(Clone)]
pub struct Host(mpsc::SyncSender<Message>, Arc<tokio::sync::Semaphore>);
pub struct Editor {
    pub session: Session,
    files: Files,
    epoch: String,
    lease: Option<(String, Instant)>,
    command_epoch: u64,
    completed: HashMap<String, ([u8; 32], Result<Value>)>,
    import_warnings: Vec<String>,
    clipboard: Option<crate::clipboard::Clipboard>,
    persistence_notice: Option<&'static str>,
    autosave: crate::autosave::Store,
    receipts: Option<crate::receipts::Store>,
    presets: crate::preset_store::Store,
    audio_presets: crate::audio_presets::Store,
    assets: crate::asset_store::Store,
    asset_jobs: crate::asset_jobs::Jobs,
    asset_imports: HashMap<(u64, String, String), ImportedAsset>,
    asset_binding: String,
    native_edits: HashMap<String, PendingNativeEdit>,
    legacy_media_imports: HashMap<String, PendingNativeEdit>,
    media_import_receipt: Option<Value>,
    native_asset_receipt: Option<Value>,
    otio_import_receipt: Option<Value>,
    clipboard_receipt: Option<Value>,
    timeline_edit_selection: Option<Vec<String>>,
    persisted_view: vv_core::ProjectView,
}
impl Editor {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        Self::with_presets(root, &root.join(".presets"))
    }
    fn with_presets(root: &Path, preset_root: &Path) -> std::io::Result<Self> {
        Self::with_libraries(root, preset_root, &root.join(".assets"))
    }
    fn with_libraries(root: &Path, preset_root: &Path, asset_root: &Path) -> std::io::Result<Self> {
        let files = Files::new(root)?;
        let presets = crate::preset_store::Store::new(preset_root)?;
        let audio_presets = crate::audio_presets::Store::new(preset_root)?;
        let assets = crate::asset_store::Store::new(asset_root)?;
        let asset_jobs = crate::asset_jobs::Jobs::new(
            assets.clone(),
            &root.canonicalize()?,
            files
                .root_file()
                .map_err(|error| std::io::Error::other(error.2))?,
        )?;
        let asset_binding = crate::asset_journal::project_binding(
            &files
                .root_file()
                .map_err(|error| std::io::Error::other(error.2))?,
        )
        .map_err(|error| std::io::Error::other(error.2))?;
        let mut session = Session::default();
        let mut persistence_notice = match crate::resume::restore(&files) {
            Ok(Some((project, name))) => {
                session.install_project(
                    project,
                    Some(
                        files.path(&name).map_err(|_| {
                            std::io::Error::other("Invalid automatic reopen project")
                        })?,
                    ),
                );
                None
            }
            Ok(None) => None,
            Err(_) => Some(
                "The previous saved project could not be reopened automatically. Open a project explicitly; existing files were preserved.",
            ),
        };
        let autosave = crate::autosave::Store::new(&files);
        let (receipts, completed) = match crate::receipts::Store::open(&files) {
            Ok((store, entries)) => (Some(store), entries),
            Err(error) if error.1 == "ROOT_BUSY" => return Err(std::io::Error::other(error.2)),
            Err(_) => {
                persistence_notice = Some(
                    "Command receipts are unavailable or incomplete. Existing data was preserved. Recover unsaved edits if offered; do not replay old commands.",
                );
                (None, HashMap::new())
            }
        };
        let persisted_view = session.project.view.clone();
        let mut editor = Self {
            persisted_view,
            presets,
            audio_presets,
            assets,
            asset_jobs,
            asset_imports: HashMap::new(),
            asset_binding,
            native_edits: HashMap::new(),
            legacy_media_imports: HashMap::new(),
            media_import_receipt: None,
            native_asset_receipt: None,
            otio_import_receipt: None,
            clipboard_receipt: None,
            timeline_edit_selection: None,
            session,
            files,
            epoch: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
                .to_string(),
            lease: None,
            completed: completed
                .into_iter()
                .map(|(id, (fingerprint, value))| (id, (fingerprint, Ok(value))))
                .collect(),
            command_epoch: 0,
            import_warnings: vec![],
            clipboard: None,
            persistence_notice,
            autosave,
            receipts,
        };
        if editor.harvest_native_completions(true).is_err() {
            editor.persistence_notice = Some(
                "Native library command outcomes require recovery. Existing metadata was preserved; resolve the command before retrying.",
            );
        }
        Ok(editor)
    }
    fn clipboard_origin(&self) -> vv_core::clipboard::ClipboardOrigin {
        let digest = Sha256::digest(self.epoch.as_bytes());
        let mut instance = [0u8; 8];
        instance.copy_from_slice(&digest[..8]);
        vv_core::clipboard::ClipboardOrigin {
            instance: u64::from_le_bytes(instance),
            epoch: self.session.epoch(),
        }
    }
    fn snapshot(&self) -> Value {
        let mut snapshot = snapshot::session(&self.session, &self.epoch);
        snapshot["command_epoch"] = json!(self.command_epoch.to_string());
        snapshot["capabilities"]["native_assets"] = json!(true);
        snapshot["capabilities"]["media_imports"] = json!(true);
        let origins: HashMap<_, _> = self
            .session
            .project
            .media_pool
            .iter()
            .filter_map(|(id, media)| {
                self.files
                    .shared_origin(&media.path)
                    .map(|value| (vv_core::Id::raw(id).to_string(), value))
            })
            .collect();
        for media in snapshot["media"].as_array_mut().unwrap() {
            if let Some(origin) = media["id"].as_str().and_then(|id| origins.get(id)) {
                media["shared_origin"] = origin.clone();
            }
        }
        snapshot["import_warnings"] = json!(self.import_warnings);
        snapshot["persistence_notice"] = json!(self.persistence_notice);
        snapshot["autosave"] = self.autosave.info();
        snapshot["clipboard_count"] = json!(
            self.clipboard
                .as_ref()
                .map_or(0, |clipboard| clipboard.count(&self.session))
        );
        snapshot["clipboard_revision"] = json!(
            self.clipboard
                .as_ref()
                .and_then(|clipboard| clipboard.revision(&self.session))
        );
        snapshot["clipboard_media_count"] = json!(
            self.clipboard
                .as_ref()
                .map_or(0, |clipboard| clipboard.media_count())
        );
        snapshot["clipboard_current_project"] = json!(
            self.clipboard
                .as_ref()
                .is_some_and(|clipboard| clipboard.is_current(&self.session))
        );
        snapshot
    }
    fn lease(&mut self, client: &str) -> Result<Value> {
        if !valid_key(client) {
            return Err(ApiError::invalid("Invalid client ID"));
        }
        if let Some((owner, touched)) = &self.lease
            && owner != client
            && touched.elapsed() < Duration::from_secs(90)
        {
            return Err(ApiError::conflict(
                "READ_ONLY",
                "Another browser owns the writer lease",
            ));
        }
        self.lease = Some((client.to_owned(), Instant::now()));
        Ok(json!({"writable":true,"ttl_seconds":90}))
    }
    pub fn mutation(&mut self, timeline: Option<String>, request: Mutation) -> Result<Value> {
        if !valid_key(&request.command_id) {
            return Err(ApiError::invalid("Invalid command ID"));
        }
        let encoded = serde_json::to_vec(&(timeline.clone(), &request))
            .map_err(|_| ApiError::invalid("Invalid command"))?;
        let fingerprint: [u8; 32] = Sha256::digest(&encoded).into();
        if let Some(recorded) = self
            .receipts
            .as_ref()
            .and_then(|store| store.recorded(&request.command_id))
        {
            self.completed
                .entry(request.command_id.clone())
                .or_insert_with(|| (recorded.0, Ok(recorded.1)));
        }
        if let Some((original, result)) = self.completed.get(&request.command_id) {
            if original != &fingerprint {
                return Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Command ID was already used with another request",
                ));
            }
            return result.clone();
        }
        if self
            .native_edits
            .get(&request.command_id)
            .is_some_and(|pending| pending.fingerprint != fingerprint)
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Command ID was already used for another native library request",
            ));
        }
        if self
            .legacy_media_imports
            .get(&request.command_id)
            .is_some_and(|pending| pending.fingerprint != fingerprint)
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Command ID was already used for another media import",
            ));
        }
        let prepared_edit = matches!(&request.operation,Operation::EditNativeAssetLibrary {edit} if edit.requires_preparation());
        if prepared_edit && let Some((original,value))=self.harvest_native_completion(&request.command_id,false).map_err(|_|ApiError::conflict("OUTCOME_UNKNOWN","Native library commit requires recovery; resolve its command before retrying"))? {
            if original!=fingerprint {return Err(ApiError::conflict("COMMAND_ID_REUSED","Command ID was already used with another request"));}return Ok(value);
        }
        self.lease(&request.client_id)?;
        if request.command_epoch.as_deref().unwrap_or("0") != self.command_epoch.to_string() {
            return Err(ApiError::conflict(
                "COMMAND_EPOCH_EXPIRED",
                "Command receipt epoch expired; refresh without replaying the old command",
            ));
        }
        if prepared_edit {
            self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
            self.native_command_capacity()?;
        }
        let previous_epoch = self.session.epoch();
        self.media_import_receipt = None;
        self.native_asset_receipt = None;
        self.otio_import_receipt = None;
        self.clipboard_receipt = None;
        self.timeline_edit_selection = None;
        let outcome = self.perform(timeline, &request);
        if self.session.epoch() != previous_epoch
            || outcome.is_ok()
                && matches!(
                    request.operation,
                    Operation::Save | Operation::SaveAs { .. }
                )
        {
            self.persisted_view = self.session.project.view.clone();
        }
        let media_import_receipt = self.media_import_receipt.take();
        let native_asset_receipt = self.native_asset_receipt.take();
        let otio_import_receipt = self.otio_import_receipt.take();
        let clipboard_receipt = self.clipboard_receipt.take();
        let timeline_edit_selection = self.timeline_edit_selection.take();
        if self.session.epoch() != previous_epoch {
            self.asset_jobs
                .cancel_obsolete(&format!("{}:{}", self.epoch, self.session.epoch()));
            self.asset_imports.clear();
        }
        if prepared_edit && let Err(error) = &outcome {
            return match self.harvest_native_completion(&request.command_id, false) {
                Ok(Some((original, value))) if original == fingerprint => Ok(value),
                Ok(Some(_)) => Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Command ID was already used with another request",
                )),
                Ok(None) => Err(error.clone()),
                Err(_) => Err(ApiError::conflict(
                    "OUTCOME_UNKNOWN",
                    "Native library commit requires recovery; resolve its command before retrying",
                )),
            };
        }
        if self.completed.len() >= MAX_RECEIPTS
            || ((media_import_receipt.is_some()
                || otio_import_receipt.is_some()
                || clipboard_receipt.is_some()
                || timeline_edit_selection.is_some())
                && self.import_receipt_cache_full())
        {
            self.completed.clear();
            self.command_epoch = self
                .command_epoch
                .checked_add(1)
                .expect("Command epoch exhausted");
        }
        let mut result=outcome.map(|_|{
            if matches!(request.operation,Operation::Save|Operation::SaveAs{..}) {self.autosave.saved(&self.files,&self.session);}
            if matches!(request.operation,Operation::NewProject{..}|Operation::OpenProject{..}|Operation::Save|Operation::SaveAs{..}|Operation::RecoverBackup{..}|Operation::ImportOtio{..}|Operation::RecoverAutosave{open:true,..})
                && let Some(name)=self.session.path().and_then(|path|path.file_name()).and_then(|name|name.to_str()) {
                self.persistence_notice=crate::resume::remember(&self.files,name).err().map(|_|"The project operation succeeded, but automatic reopen could not be updated. Existing recovery metadata was preserved.");
            }
            let mut value=json!({"command_id":request.command_id,"status":"applied","project_epoch":format!("{}:{}",self.epoch,self.session.epoch()),"generation":self.session.history.generation().to_string(),"command_epoch":self.command_epoch.to_string()});
            if prepared_edit {value["library_durable"]=json!(true);}
            if let Some(report)=native_asset_receipt {
                for field in ["missing_count","relinked_files","imported_assets","skipped_files","error_count","root_folder_id","folders_revision","created_folders"] {
                    if let Some(count)=report.get(field) {value[field]=count.clone();}
                }
            }
            if let Some(report)=media_import_receipt {
                value["media_ids"]=report["media_ids"].clone();
                value["errors"]=report["errors"].clone();
            }
            if let Some(report)=otio_import_receipt {
                for field in ["timeline_ids","media_ids","folder_id","warnings"] {
                    value[field]=report[field].clone();
                }
            }
            if let Some(report)=clipboard_receipt {
                for field in ["media_ids","clip_ids","changed"] {value[field]=report[field].clone();}
            }
            if let Some(ids)=timeline_edit_selection {value["clip_ids"]=json!(ids);}
            if matches!(request.operation,Operation::CopyClips{..}|Operation::CopyMedia{..}|Operation::CutClips{..}) {
                value["clipboard_revision"]=json!(self.clipboard.as_ref().and_then(|clipboard|clipboard.revision(&self.session)));
            }
            if let Operation::ImportNativeAsset { asset_id,revision,.. }=&request.operation
                && let Some(imported)=self.asset_imports.get(&(self.session.epoch(),asset_id.clone(),revision.clone())) {
                use vv_core::Id;
                value["media_ids"]=json!(imported.selected.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>());
            }
            value
        });
        if let Ok(value) = &mut result {
            if prepared_edit {
                value["durability"] = json!({"state":"volatile","recovery_revision":null});
            } else {
                if !self.session.has_unsaved_changes() {
                    self.autosave.saved(&self.files, &self.session);
                }
                let checkpoint = if self.session.has_unsaved_changes() {
                    self.autosave.checkpoint(&self.files, &self.session)
                } else {
                    None
                };
                let saved = !self.session.has_unsaved_changes()
                    && self
                        .session
                        .path()
                        .and_then(|path| path.file_name())
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            self.files.saved_fingerprint(name).is_some_and(|expected| {
                                self.files.project_fingerprint(name).ok().as_ref()
                                    == Some(&expected)
                            })
                        });
                let state = if saved {
                    "saved"
                } else if checkpoint.is_some() {
                    "recovery"
                } else {
                    "volatile"
                };
                value["durability"] = json!({"state":state,"recovery_revision":checkpoint});
            }
            value["receipt_persisted"] = json!(true);
            if !self.receipts.as_mut().is_some_and(|store| {
                store
                    .append(&self.files, &request.command_id, fingerprint, value)
                    .is_ok()
            }) {
                value["receipt_persisted"] = json!(false);
                self.persistence_notice = Some(
                    "The command applied, but its receipt could not be persisted. Save current edits before restarting; do not replay an uncertain command.",
                );
            } else if prepared_edit
                && self
                    .assets
                    .acknowledge_completion(&request.command_id, fingerprint, &self.asset_binding)
                    .is_err()
            {
                self.persistence_notice.get_or_insert(
                    "Native library command applied durably; completion cleanup will be retried.",
                );
            }
        }
        self.completed
            .insert(request.command_id.clone(), (fingerprint, result.clone()));
        if prepared_edit && result.is_ok() {
            self.native_edits.remove(&request.command_id);
        }
        if result.is_ok() {
            self.legacy_media_imports.remove(&request.command_id);
        }
        result
    }
    fn perform(&mut self, timeline: Option<String>, request: &Mutation) -> Result<()> {
        if request.project_epoch != format!("{}:{}", self.epoch, self.session.epoch())
            || request.if_generation != self.session.history.generation().to_string()
        {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Project changed; refresh before retrying",
            ));
        }
        if let Some(timeline) = timeline {
            let id = snapshot::timeline_id(&self.session, &timeline)?;
            if request.if_revision.as_deref() != Some(self.session.timeline_revision(id).as_str()) {
                return Err(ApiError::conflict(
                    "REVISION_CONFLICT",
                    "Timeline changed; refresh before retrying",
                ));
            }
            return match &request.operation {
                Operation::ApplySavedAudioPreset {
                    channel,
                    index,
                    preset_kind,
                    name,
                    revision,
                } => {
                    let parameters = self.audio_presets.resolve(*preset_kind, name, revision)?;
                    crate::audio::apply_saved_kind(
                        &mut self.session,
                        id,
                        channel,
                        *index,
                        &parameters,
                    )?;
                    self.session.sync_timeline_media(id);
                    Ok(())
                }
                Operation::SaveAttributePreset { clip_ids, options } => self.presets.create(
                    &request.command_id,
                    &crate::presets::capture(&self.session, id, clip_ids, options)?,
                ),
                Operation::ApplySavedPreset {
                    clip_ids,
                    preset_id,
                    revision,
                } => crate::presets::apply(
                    &mut self.session,
                    id,
                    clip_ids,
                    &self.presets.load(preset_id, revision)?,
                ),
                Operation::PlaceRecording { placement } => {
                    crate::recording::place(&mut self.session, &self.files, id, placement)
                }
                Operation::ReplaceTake { replacement } => {
                    crate::take::apply(&mut self.session, &self.files, id, replacement)
                }
                Operation::CopyClips { clip_ids } => {
                    self.clipboard = Some(crate::clipboard::copy_with_origin(
                        &self.session,
                        id,
                        clip_ids,
                        self.clipboard_origin(),
                    )?);
                    Ok(())
                }
                Operation::CutClips {
                    clip_ids,
                    clipboard_revision,
                } => crate::clipboard::cut(
                    &mut self.session,
                    id,
                    clip_ids,
                    clipboard_revision,
                    self.clipboard
                        .as_ref()
                        .ok_or_else(|| ApiError::invalid("Copy clips before cutting"))?,
                ),
                Operation::PasteClips { frame } => crate::clipboard::paste(
                    &mut self.session,
                    id,
                    self.clipboard
                        .as_ref()
                        .ok_or_else(|| ApiError::invalid("Copy clips first"))?,
                    *frame,
                ),
                Operation::PasteAttributes {
                    clip_ids,
                    clipboard_revision,
                    attributes,
                    keyframes,
                } => crate::clipboard::paste_attributes(
                    &mut self.session,
                    id,
                    self.clipboard
                        .as_ref()
                        .ok_or_else(|| ApiError::invalid("Copy clips first"))?,
                    clipboard_revision,
                    clip_ids,
                    attributes,
                    *keyframes,
                ),
                Operation::MoveClips {
                    duplicate: true, ..
                } => {
                    let ids = commands::move_clips_with_selection(
                        &mut self.session,
                        id,
                        &request.operation,
                    )?;
                    self.session.sync_timeline_media(id);
                    self.timeline_edit_selection = Some(ids);
                    Ok(())
                }
                _ => commands::apply(&mut self.session, id, &request.operation),
            };
        }
        match &request.operation {
            Operation::CopyMedia { media_ids } => {
                self.clipboard = Some(crate::clipboard::copy_media(
                    &self.session,
                    media_ids,
                    self.clipboard_origin(),
                )?);
            }
            Operation::PastePreparedClipboard {
                job_id,
                to_pool,
                overwrite,
                timeline_id,
                timeline_revision,
                frame,
            } => {
                let target = if *to_pool {
                    if timeline_id.is_some()
                        || timeline_revision.is_some()
                        || *frame != 0
                        || *overwrite
                    {
                        return Err(ApiError::invalid(
                            "Pool paste does not accept a timeline, frame or overwrite",
                        ));
                    }
                    None
                } else {
                    let id = snapshot::timeline_id(
                        &self.session,
                        timeline_id
                            .as_deref()
                            .ok_or_else(|| ApiError::invalid("Choose the paste timeline"))?,
                    )?;
                    if timeline_revision.as_deref()
                        != Some(self.session.timeline_revision(id).as_str())
                    {
                        return Err(ApiError::conflict(
                            "REVISION_CONFLICT",
                            "Paste timeline changed; prepare again",
                        ));
                    }
                    Some(id)
                };
                let payload = self.asset_jobs.clipboard_payload(
                    job_id,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
                let prepared = crate::clipboard::prepare_paste(
                    &self.session,
                    payload,
                    self.clipboard.as_ref(),
                    target,
                    *frame,
                    *to_pool,
                    *overwrite,
                )?;
                self.asset_jobs.mark_clipboard_applied(
                    job_id,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
                let report = prepared.apply(&mut self.session);
                use vv_core::Id;
                self.clipboard_receipt = Some(
                    json!({"media_ids":report.media.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>(),"clip_ids":report.clips.iter().map(|id|id.0.to_string()).collect::<Vec<_>>(),"changed":report.changed}),
                );
            }
            Operation::PublishNativeAsset { job_id } => self.asset_jobs.publish(
                &request.command_id,
                job_id,
                &request.project_epoch,
                &request.if_generation,
            )?,
            Operation::EditNativeAssetLibrary { edit } => {
                if edit.requires_preparation() {
                    let fingerprint = Sha256::digest(
                        serde_json::to_vec(&(None::<String>, request))
                            .map_err(|_| ApiError::invalid("Invalid native library command"))?,
                    )
                    .into();
                    self.native_asset_receipt = Some(self.asset_jobs.commit_edit(
                        &request.command_id,
                        fingerprint,
                        &request.project_epoch,
                        &request.if_generation,
                        edit,
                    )?);
                } else {
                    self.assets.edit(&request.command_id, edit)?;
                }
            }
            Operation::ImportNativeAsset {
                job_id,
                asset_id,
                revision,
            } => self.import_native_asset(
                job_id,
                asset_id,
                revision,
                &request.project_epoch,
                &request.if_generation,
            )?,
            Operation::EditPresetLibrary { edit } => {
                self.presets.edit(&request.command_id, edit)?
            }
            Operation::EditAudioPresetLibrary { edit } => self.audio_presets.edit(edit)?,
            Operation::RecoverAutosave {
                revision,
                name,
                open,
            } => self
                .autosave
                .recover(&self.files, &mut self.session, revision, name, *open)?,
            Operation::EditReview {
                project_token,
                revision,
                edit,
            } => {
                crate::reviewmeta::edit(&self.files, &self.session, project_token, revision, edit)?;
            }
            Operation::EditCatalog { edit } => {
                crate::catalog::edit(&mut self.session, &self.files, edit)?;
            }
            Operation::Undo | Operation::Redo | Operation::HistoryJump { .. } => {
                commands::history(&mut self.session, &request.operation)?
            }
            Operation::ImportMedia { .. } => {
                let job = self
                    .legacy_media_imports
                    .get(&request.command_id)
                    .ok_or_else(|| {
                        ApiError::conflict(
                            "MEDIA_IMPORT_PREPARATION_REQUIRED",
                            "Prepare media outside the session before importing",
                        )
                    })?
                    .job
                    .clone();
                self.import_prepared_media(&job, &request.project_epoch, &request.if_generation)?;
            }
            Operation::ImportPreparedMedia { job_id } => {
                self.import_prepared_media(job_id, &request.project_epoch, &request.if_generation)?;
            }
            Operation::ImportClipboardImage { job_id, name } => {
                self.import_clipboard_image(
                    job_id,
                    name,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
            }
            Operation::ImportPreparedOtio {
                job_id,
                name,
                reuse_existing,
            } => {
                let payload = self.asset_jobs.otio_payload(
                    job_id,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
                let prepared = crate::otio::prepare(
                    &self.session.project,
                    payload.project,
                    name,
                    *reuse_existing,
                )?;
                self.asset_jobs.mark_otio_applied(
                    job_id,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
                let report = prepared.apply(&mut self.session);
                use vv_core::Id;
                self.otio_import_receipt = Some(json!({
                    "timeline_ids":report.timelines.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>(),
                    "media_ids":report.media.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>(),
                    "folder_id":report.folder.map(|id|id.raw().to_string()),
                    "warnings":payload.warnings,
                }));
                self.import_warnings = payload.warnings;
            }
            Operation::ImportOtio { name, .. } => {
                if self.session.has_unsaved_changes() {
                    return Err(ApiError::conflict(
                        "UNSAVED_CHANGES",
                        "Save the current project before importing an OTIO project",
                    ));
                }
                if name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    return Err(ApiError::invalid(
                        "Use letters, digits, underscores or hyphens for the new project name",
                    ));
                }
                let job = self
                    .legacy_media_imports
                    .get(&request.command_id)
                    .ok_or_else(|| {
                        ApiError::conflict(
                            "OTIO_PREPARATION_REQUIRED",
                            "Prepare OTIO outside the session before importing",
                        )
                    })?
                    .job
                    .clone();
                let payload = self.asset_jobs.otio_payload(
                    &job,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
                let token = format!("{name}.vvproj");
                let path = self.files.path(&token)?;
                let metadata = crate::reviewmeta::reserve_copy(&self.files, None, &token)?;
                self.asset_jobs.mark_otio_applied(
                    &job,
                    &request.project_epoch,
                    &request.if_generation,
                )?;
                if let Err(error) = self.files.save(&payload.project, &token, true) {
                    let _ = self.asset_jobs.mark_otio_failed(
                        &job,
                        &request.project_epoch,
                        error.clone(),
                    );
                    return Err(error);
                }
                metadata.commit();
                self.session.install_project(payload.project, Some(path));
                self.import_warnings = payload.warnings;
            }
            Operation::NewTimeline {
                name,
                fps,
                resolution,
            } => {
                if self.session.path().is_none() {
                    return Err(ApiError::invalid("Create or open a project first"));
                }
                if name.trim().is_empty()
                    || name.len() > 128
                    || name.chars().any(char::is_control)
                    || self.session.project.timelines.len() >= 64
                    || fps.num <= 0
                    || fps.den <= 0
                    || fps.as_f64() > 240.0
                    || resolution.iter().any(|v| *v == 0 || *v > 8192)
                {
                    return Err(ApiError::invalid(
                        "Timeline name, rate or dimensions exceed the supported limits",
                    ));
                }
                self.session.create_timeline(Timeline {
                    name: name.clone(),
                    fps: *fps,
                    resolution: (resolution[0], resolution[1]),
                    tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
                    markers: vec![],
                    master: Default::default(),
                });
            }
            Operation::NewProject { name } => {
                if self.session.has_unsaved_changes() {
                    return Err(ApiError::conflict(
                        "UNSAVED_CHANGES",
                        "Save the current project before creating another",
                    ));
                }
                if name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    return Err(ApiError::invalid(
                        "Use letters, digits, underscores or hyphens for the project name",
                    ));
                }
                let path_token = format!("{name}.vvproj");
                let mut session = Session::default();
                session.create_timeline(Timeline {
                    name: "Timeline 1".into(),
                    fps: Rational::new(24, 1),
                    resolution: (1920, 1080),
                    tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
                    markers: Vec::new(),
                    master: Default::default(),
                });
                let metadata = crate::reviewmeta::reserve_copy(&self.files, None, &path_token)?;
                self.files.save(&session.project, &path_token, true)?;
                metadata.commit();
                self.session
                    .install_project(session.project, Some(self.files.path(&path_token)?));
                self.import_warnings.clear();
            }
            Operation::OpenProject { path_token } => {
                if self.session.has_unsaved_changes() {
                    return Err(ApiError::conflict(
                        "UNSAVED_CHANGES",
                        "Save the current project before opening another",
                    ));
                }
                let project = self.files.load(path_token)?;
                self.session
                    .install_project(project, Some(self.files.path(path_token)?));
                self.import_warnings.clear();
            }
            Operation::RecoverBackup { path_token, name } => {
                if self.session.has_unsaved_changes() {
                    return Err(ApiError::conflict(
                        "UNSAVED_CHANGES",
                        "Save a copy of current edits before recovering a backup",
                    ));
                }
                if name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    return Err(ApiError::invalid(
                        "Use letters, digits, underscores or hyphens for the recovered project name",
                    ));
                }
                let project = self.files.load_backup(path_token)?;
                let token = format!("{name}.vvproj");
                let metadata = crate::reviewmeta::reserve_copy(
                    &self.files,
                    path_token.strip_suffix(".bak"),
                    &token,
                )?;
                self.files.save(&project, &token, true)?;
                metadata.commit();
                self.session
                    .install_project(project, Some(self.files.path(&token)?));
                self.import_warnings.clear();
            }
            Operation::Save => {
                let name = self
                    .session
                    .path()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| ApiError::invalid("Create or open a project first"))?
                    .to_owned();
                self.files.save(&self.session.project, &name, false)?;
                self.session.mark_saved();
            }
            Operation::SaveAs { name } => {
                if name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    return Err(ApiError::invalid(
                        "Use letters, digits, underscores or hyphens for the project name",
                    ));
                }
                let token = format!("{name}.vvproj");
                let source = crate::reviewmeta::current_project(&self.files, &self.session).ok();
                let metadata =
                    crate::reviewmeta::reserve_copy(&self.files, source.as_deref(), &token)?;
                self.files.save(&self.session.project, &token, true)?;
                metadata.commit();
                self.session.set_path(Some(self.files.path(&token)?));
                self.session.mark_saved();
            }
            _ => {
                return Err(ApiError::invalid(
                    "Timeline commands require a timeline URL",
                ));
            }
        }
        Ok(())
    }
    fn validate_asset_epoch(&self, epoch: &str, generation: Option<&str>) -> Result<()> {
        if epoch != format!("{}:{}", self.epoch, self.session.epoch())
            || generation
                .is_some_and(|value| value != self.session.history.generation().to_string())
        {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Project changed before the native asset request",
            ));
        }
        Ok(())
    }
    fn prepare_media_import(&self, request: MediaImportRequest) -> Result<Value> {
        self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
        if self.session.path().is_none() {
            return Err(ApiError::invalid(
                "Create or open a project before importing media",
            ));
        }
        let tokens = self.files.media_import_tokens(&request.path_tokens)?;
        self.asset_jobs
            .prepare_media_import(&request.project_epoch, &request.if_generation, tokens)
    }
    fn check_clipboard_image(&self, query: &ClipboardImageQuery) -> Result<()> {
        self.validate_asset_epoch(&query.project_epoch, Some(&query.if_generation))?;
        if self.session.path().is_none() {
            return Err(ApiError::invalid(
                "Save the project before pasting an image",
            ));
        }
        Ok(())
    }
    fn prepare_legacy_media_import(&mut self, request: Mutation) -> Result<NativeEditPreparation> {
        let path_token = match &request.operation {
            Operation::ImportMedia { path_token } | Operation::ImportOtio { path_token, .. } => {
                path_token
            }
            _ => {
                return self
                    .mutation(None, request)
                    .map(NativeEditPreparation::Complete);
            }
        };
        if !valid_key(&request.command_id) {
            return Err(ApiError::invalid("Invalid command ID"));
        }
        self.prune_legacy_media_imports();
        let fingerprint: [u8; 32] = Sha256::digest(
            serde_json::to_vec(&(None::<String>, &request))
                .map_err(|_| ApiError::invalid("Invalid media import command"))?,
        )
        .into();
        if let Some((previous, result)) =
            self.completed
                .get(&request.command_id)
                .cloned()
                .or_else(|| {
                    self.receipts
                        .as_ref()
                        .and_then(|store| store.recorded(&request.command_id))
                        .map(|(hash, value)| (hash, Ok(value)))
                })
        {
            if previous != fingerprint {
                return Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Command ID was already used with another request",
                ));
            }
            return result.map(NativeEditPreparation::Complete);
        }
        if self
            .legacy_media_imports
            .get(&request.command_id)
            .is_some_and(|pending| pending.fingerprint != fingerprint)
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Command ID was already used for another media import",
            ));
        }
        self.lease(&request.client_id)?;
        if request.command_epoch.as_deref().unwrap_or("0") != self.command_epoch.to_string() {
            return Err(ApiError::conflict(
                "COMMAND_EPOCH_EXPIRED",
                "Command receipt epoch expired; refresh without replaying the old command",
            ));
        }
        self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
        self.native_command_capacity()?;
        if self.legacy_media_imports.len() >= 64
            && !self.legacy_media_imports.contains_key(&request.command_id)
        {
            return Err(ApiError::conflict(
                "ASSET_BUSY",
                "Resolve previous media imports before starting more",
            ));
        }
        let id = if let Some(pending) = self.legacy_media_imports.get(&request.command_id) {
            pending.job.clone()
        } else {
            let preparation = if let Operation::ImportOtio { name, .. } = &request.operation {
                if self.session.has_unsaved_changes() {
                    Err(ApiError::conflict(
                        "UNSAVED_CHANGES",
                        "Save the current project before importing an OTIO project",
                    ))
                } else if name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    Err(ApiError::invalid(
                        "Use letters, digits, underscores or hyphens for the new project name",
                    ))
                } else {
                    self.asset_jobs.prepare_otio(
                        &request.project_epoch,
                        &request.if_generation,
                        path_token,
                    )
                }
            } else {
                self.prepare_media_import(MediaImportRequest {
                    project_epoch: request.project_epoch.clone(),
                    if_generation: request.if_generation.clone(),
                    path_tokens: vec![path_token.clone()],
                })
            };
            let value = match preparation {
                Ok(value) => value,
                Err(error) => {
                    self.completed.insert(
                        request.command_id.clone(),
                        (fingerprint, Err(error.clone())),
                    );
                    return Err(error);
                }
            };
            value["id"].as_str().ok_or_else(ApiError::io)?.to_owned()
        };
        self.legacy_media_imports.insert(
            request.command_id,
            PendingNativeEdit {
                fingerprint,
                job: id.clone(),
                epoch: request.project_epoch.clone(),
            },
        );
        Ok(NativeEditPreparation::Pending(NativeEditGuard {
            jobs: self.asset_jobs.clone(),
            job: id,
            epoch: request.project_epoch,
            armed: true,
        }))
    }
    fn prune_legacy_media_imports(&mut self) {
        let ids = self
            .legacy_media_imports
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for id in ids {
            if self.completed.contains_key(&id)
                || self
                    .receipts
                    .as_ref()
                    .is_some_and(|store| store.recorded(&id).is_some())
            {
                self.legacy_media_imports.remove(&id);
                continue;
            }
            let pending = &self.legacy_media_imports[&id];
            let terminal = match self.asset_jobs.status(&pending.job, &pending.epoch, false) {
                Ok(value) => matches!(value["state"].as_str(), Some("failed" | "canceled")),
                Err(error) => error.1 == "NOT_FOUND",
            };
            if terminal {
                let fingerprint = pending.fingerprint;
                let error = self.native_edit_failure(pending);
                self.completed.insert(id.clone(), (fingerprint, Err(error)));
                self.legacy_media_imports.remove(&id);
            }
        }
    }
    fn import_prepared_media(&mut self, job: &str, epoch: &str, generation: &str) -> Result<()> {
        use vv_core::{Command, CommandLabel, Id, MediaItem, pool::AddEntities};
        if self.session.path().is_none() {
            return Err(ApiError::invalid(
                "Create or open a project before importing media",
            ));
        }
        let payload = self
            .asset_jobs
            .media_import_payload(job, epoch, generation)?;
        if payload.items.is_empty() {
            return Err(payload
                .first_error
                .unwrap_or_else(|| ApiError::invalid("No readable media files were prepared")));
        }
        let existing = payload
            .items
            .iter()
            .filter_map(|item| {
                self.session
                    .media_with_path(&item.path)
                    .map(|id| (item.path.clone(), id))
            })
            .collect::<HashMap<_, _>>();
        let build = |project: &mut vv_core::Project| {
            let mut additions = AddEntities::new(CommandLabel::ImportMedia);
            let mut selected = Vec::new();
            for item in &payload.items {
                let id = existing.get(&item.path).copied().unwrap_or_else(|| {
                    additions.media(
                        project,
                        MediaItem {
                            path: item.path.clone(),
                            meta: item.meta.clone(),
                            content_hash: item.content_hash,
                            compound: None,
                            folder: None,
                        },
                    )
                });
                selected.push(id);
            }
            (additions, selected)
        };
        let mut trial = self.session.project.clone();
        let (mut additions, _) = build(&mut trial);
        additions.apply(&mut trial);
        crate::files::validate_project(&trial)?;
        self.asset_jobs
            .accept_media_import(job, epoch, generation)?;
        let (additions, selected) = build(&mut self.session.project);
        if !additions.is_empty() {
            self.session.apply(Box::new(additions));
        }
        self.media_import_receipt = Some(
            json!({"media_ids":selected.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>(),"errors":payload.errors}),
        );
        Ok(())
    }
    fn import_clipboard_image(
        &mut self,
        job: &str,
        name: &str,
        epoch: &str,
        generation: &str,
    ) -> Result<()> {
        use vv_core::{Command, CommandLabel, Id, MediaItem, pool::AddEntities};
        self.check_clipboard_image(&ClipboardImageQuery {
            project_epoch: epoch.into(),
            if_generation: generation.into(),
        })?;
        let preview = self
            .asset_jobs
            .clipboard_image_payload(job, epoch, generation, name)?;
        let existing = self.session.media_with_path(&preview.path);
        let build = |project: &mut vv_core::Project, item: &crate::asset_jobs::PreparedMedia| {
            let mut additions = AddEntities::new(CommandLabel::ImportMedia);
            let selected = existing.unwrap_or_else(|| {
                additions.media(
                    project,
                    MediaItem {
                        path: item.path.clone(),
                        meta: item.meta.clone(),
                        content_hash: item.content_hash,
                        compound: None,
                        folder: None,
                    },
                )
            });
            (additions, selected)
        };
        let mut trial = self.session.project.clone();
        let (mut additions, _) = build(&mut trial, &preview);
        additions.apply(&mut trial);
        crate::files::validate_project(&trial)?;
        let published = self
            .asset_jobs
            .accept_clipboard_image(job, epoch, generation, name)?;
        let (additions, selected) = build(&mut self.session.project, &published);
        if !additions.is_empty() {
            self.session.apply(Box::new(additions));
        }
        self.media_import_receipt =
            Some(json!({"media_ids":[selected.raw().to_string()],"errors":[]}));
        Ok(())
    }
    fn harvest_native_completion(
        &mut self,
        id: &str,
        restarted: bool,
    ) -> Result<Option<([u8; 32], Value)>> {
        let Some((fingerprint, seed)) = self.assets.completion(id, &self.asset_binding)? else {
            return Ok(None);
        };
        if !valid_key(id) || seed["status"] != "applied" || seed["command_id"] != id {
            return Err(ApiError::invalid(
                "Invalid durable native library completion; existing metadata was preserved",
            ));
        }
        if self
            .completed
            .get(id)
            .is_some_and(|(original, _)| *original != fingerprint)
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Native library completion conflicts with a recorded command",
            ));
        }
        let recorded = self.receipts.as_ref().and_then(|store| store.recorded(id));
        if recorded
            .as_ref()
            .is_some_and(|(original, _)| *original != fingerprint)
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Native library completion conflicts with a durable command",
            ));
        }
        let already_recorded = recorded.is_some();
        let mut value = recorded.map_or(seed, |(_, value)| value);
        if restarted {
            value["server_restarted"] = json!(true);
        }
        value["receipt_persisted"] = json!(true);
        let persisted = already_recorded
            || self
                .receipts
                .as_mut()
                .is_some_and(|store| store.append(&self.files, id, fingerprint, &value).is_ok());
        if persisted {
            let _ = self
                .assets
                .acknowledge_completion(id, fingerprint, &self.asset_binding);
        } else {
            value["receipt_persisted"] = json!(false);
            self.persistence_notice.get_or_insert("Native library changes are durable, but their command receipt still needs recovery. Resolve the command before retrying.");
        }
        self.completed
            .insert(id.to_owned(), (fingerprint, Ok(value.clone())));
        self.native_edits.remove(id);
        Ok(Some((fingerprint, value)))
    }
    fn harvest_native_completions(&mut self, restarted: bool) -> Result<()> {
        let completions = self.assets.completions(&self.asset_binding)?;
        for (id, _, _) in completions {
            self.harvest_native_completion(&id, restarted)?;
        }
        Ok(())
    }
    fn prepare_native_edit(&mut self, request: Mutation) -> Result<NativeEditPreparation> {
        if !matches!(&request.operation,Operation::EditNativeAssetLibrary {edit} if edit.requires_preparation())
        {
            return self
                .mutation(None, request)
                .map(NativeEditPreparation::Complete);
        }
        if !valid_key(&request.command_id) {
            return Err(ApiError::invalid("Invalid command ID"));
        }
        self.prune_native_edits();
        let fingerprint: [u8; 32] = Sha256::digest(
            serde_json::to_vec(&(None::<String>, &request))
                .map_err(|_| ApiError::invalid("Invalid native library command"))?,
        )
        .into();
        if self
            .native_edits
            .get(&request.command_id)
            .is_some_and(|pending| pending.fingerprint != fingerprint)
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Command ID was already used for another native library request",
            ));
        }
        if let Some((original, result)) =
            self.completed
                .get(&request.command_id)
                .cloned()
                .or_else(|| {
                    self.receipts
                        .as_ref()
                        .and_then(|store| store.recorded(&request.command_id))
                        .map(|(hash, value)| (hash, Ok(value)))
                })
        {
            if original != fingerprint {
                return Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Command ID was already used with another request",
                ));
            }
            return result.map(NativeEditPreparation::Complete);
        }
        if let Some((original, value)) = self
            .harvest_native_completion(&request.command_id, false)
            .map_err(|_| {
                ApiError::conflict(
                    "OUTCOME_UNKNOWN",
                    "Native library commit requires recovery; resolve its command before retrying",
                )
            })?
        {
            if original != fingerprint {
                return Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Command ID was already used with another request",
                ));
            }
            return Ok(NativeEditPreparation::Complete(value));
        }
        self.lease(&request.client_id)?;
        if request.command_epoch.as_deref().unwrap_or("0") != self.command_epoch.to_string() {
            return Err(ApiError::conflict(
                "COMMAND_EPOCH_EXPIRED",
                "Command receipt epoch expired; refresh without replaying the old command",
            ));
        }
        self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
        self.native_command_capacity()?;
        let Operation::EditNativeAssetLibrary { edit } = &request.operation else {
            unreachable!()
        };
        let seed = json!({"command_id":request.command_id,"status":"applied","project_epoch":request.project_epoch,"generation":request.if_generation,"command_epoch":self.command_epoch.to_string(),"durability":{"state":"volatile","recovery_revision":null},"receipt_persisted":false,"library_durable":true});
        if self.native_edits.len() >= 64 && !self.native_edits.contains_key(&request.command_id) {
            return Err(ApiError::conflict(
                "ASSET_BUSY",
                "Resolve previous native library preparations before starting more",
            ));
        }
        let job = self.asset_jobs.prepare_edit(
            &request.project_epoch,
            &request.if_generation,
            &request.command_id,
            fingerprint,
            seed,
            edit.clone(),
        )?;
        let id = job["id"].as_str().ok_or_else(ApiError::io)?.to_owned();
        self.native_edits.insert(
            request.command_id,
            PendingNativeEdit {
                fingerprint,
                job: id.clone(),
                epoch: request.project_epoch.clone(),
            },
        );
        Ok(NativeEditPreparation::Pending(NativeEditGuard {
            jobs: self.asset_jobs.clone(),
            job: id,
            epoch: request.project_epoch,
            armed: true,
        }))
    }
    fn import_receipt_cache_full(&self) -> bool {
        let mut bytes = 0usize;
        for (_, result) in self.completed.values() {
            if let Ok(value) = result {
                bytes = bytes.saturating_add(
                    serde_json::to_vec(value).map_or(MAX_IMPORT_RECEIPT_CACHE, |value| value.len()),
                );
                if bytes >= MAX_IMPORT_RECEIPT_CACHE {
                    return true;
                }
            }
        }
        false
    }
    fn native_command_capacity(&mut self) -> Result<()> {
        if self.completed.len() < MAX_RECEIPTS && !self.import_receipt_cache_full() {
            return Ok(());
        }
        self.completed.clear();
        self.command_epoch = self
            .command_epoch
            .checked_add(1)
            .expect("Command epoch exhausted");
        Err(ApiError::conflict(
            "COMMAND_EPOCH_EXPIRED",
            "Command receipt window retired before commit; refresh and submit a new command",
        ))
    }
    fn prune_native_edits(&mut self) {
        let ids = self.native_edits.keys().cloned().collect::<Vec<_>>();
        for id in ids {
            if self.completed.contains_key(&id)
                || self
                    .receipts
                    .as_ref()
                    .is_some_and(|store| store.recorded(&id).is_some())
            {
                self.native_edits.remove(&id);
                continue;
            }
            let pending = &self.native_edits[&id];
            let fingerprint = pending.fingerprint;
            let terminal = match self.asset_jobs.status(&pending.job, &pending.epoch, false) {
                Ok(value) => matches!(value["state"].as_str(), Some("failed" | "canceled")),
                Err(error) => error.1 == "NOT_FOUND",
            };
            let error = self.native_edit_failure(pending);
            if terminal && matches!(self.harvest_native_completion(&id, false), Ok(None)) {
                self.completed.insert(id.clone(), (fingerprint, Err(error)));
                self.native_edits.remove(&id);
            }
        }
    }
    fn native_edit_failure(&self, pending: &PendingNativeEdit) -> ApiError {
        self.asset_jobs
            .read_failure(&pending.job, &pending.epoch)
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                ApiError::conflict(
                    "ASSET_EDIT_NOT_APPLIED",
                    "Native library preparation did not commit; retry with a new command",
                )
            })
    }
    fn lookup(&mut self, id: &str) -> Result<Value> {
        if !valid_key(id) {
            return Err(ApiError::missing());
        }
        if let Some((_, result)) = self.completed.get(id).cloned() {
            if result.as_ref().is_ok_and(|value| {
                value["library_durable"] == true && value["receipt_persisted"] == false
            }) && let Ok(Some((_, value))) = self.harvest_native_completion(id, false)
            {
                return Ok(value);
            }
            return result;
        }
        if let Some((_, value)) = self.receipts.as_ref().and_then(|store| store.recorded(id)) {
            return Ok(value);
        }
        if let Some(pending) = self.legacy_media_imports.get(id) {
            let value = match self.asset_jobs.status(&pending.job, &pending.epoch, false) {
                Ok(value) => Some(value),
                Err(error) if error.1 == "NOT_FOUND" => None,
                Err(error) => return Err(error),
            };
            if let Some(value) = value
                && matches!(
                    value["state"].as_str(),
                    Some("queued" | "running" | "ready")
                )
            {
                return Ok(
                    json!({"command_id":id,"status":"preparing","job_id":pending.job,"project_epoch":pending.epoch,"job":value}),
                );
            }
            let fingerprint = pending.fingerprint;
            let error = self.native_edit_failure(pending);
            self.completed
                .insert(id.to_owned(), (fingerprint, Err(error.clone())));
            self.legacy_media_imports.remove(id);
            return Err(error);
        }
        match self.harvest_native_completion(id, false) {
            Ok(Some((_, value))) => return Ok(value),
            Err(_) => {
                return Ok(
                    json!({"command_id":id,"status":"pending","job_id":self.native_edits.get(id).map(|pending|&pending.job),"recovery_pending":true}),
                );
            }
            Ok(None) => {}
        }
        if let Some(pending) = self.native_edits.get(id) {
            let value = match self.asset_jobs.status(&pending.job, &pending.epoch, false) {
                Ok(value) => Some(value),
                Err(error) if error.1 == "NOT_FOUND" => None,
                Err(error) => return Err(error),
            };
            if let Some(value) = value
                && matches!(
                    value["state"].as_str(),
                    Some("queued" | "running" | "ready")
                )
            {
                return Ok(
                    json!({"command_id":id,"status":"preparing","job_id":pending.job,"project_epoch":pending.epoch,"job":value}),
                );
            }
            let fingerprint = pending.fingerprint;
            let error = self.native_edit_failure(pending);
            self.completed
                .insert(id.to_owned(), (fingerprint, Err(error.clone())));
            self.native_edits.remove(id);
            return Err(error);
        }
        Err(ApiError::missing())
    }
    fn prepare_native_asset(&self, request: NativeAssetRequest) -> Result<Value> {
        self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
        if self.session.path().is_none() {
            return Err(ApiError::invalid(
                "Create or open a saved project before preparing native assets",
            ));
        }
        match request.action {
            NativeAssetAction::Import { asset_id, revision } => self.asset_jobs.prepare_import(
                &request.project_epoch,
                &request.if_generation,
                &asset_id,
                &revision,
            ),
            NativeAssetAction::Capture { media_id, name } => {
                use vv_core::Id;
                let media_id = vv_core::MediaId::from_raw(
                    media_id
                        .parse()
                        .map_err(|_| ApiError::invalid("Choose one existing media pool item"))?,
                );
                let digest = Sha256::digest(self.epoch.as_bytes());
                let mut instance = [0u8; 8];
                instance.copy_from_slice(&digest[..8]);
                let asset = crate::asset_payload::capture(
                    &self.session,
                    media_id,
                    &name,
                    vv_core::clipboard::ClipboardOrigin {
                        instance: u64::from_le_bytes(instance),
                        epoch: self.session.epoch(),
                    },
                )?;
                let payload = crate::asset_payload::decode(&asset)?;
                let paths = payload
                    .files()
                    .map(|media| media.path.clone())
                    .collect::<HashSet<_>>();
                if paths.len() > 64 {
                    return Err(ApiError::invalid(
                        "Native assets support at most 64 source files",
                    ));
                }
                let mut sources = Vec::new();
                let mut bytes = 0u64;
                for path in paths {
                    let file = self.files.media_file(&path)?;
                    let length = file.metadata().map_err(|_| ApiError::io())?.len();
                    bytes = bytes
                        .checked_add(length)
                        .ok_or_else(|| ApiError::invalid("Native asset file budget overflow"))?;
                    if length > 512 * 1024 * 1024 || bytes > 2 * 1024 * 1024 * 1024 {
                        return Err(ApiError::invalid(
                            "Native asset copies are limited to 512 MiB per file and 2 GiB total",
                        ));
                    }
                    let identity = crate::source::file_identity(&file)?;
                    sources.push(crate::asset_jobs::PinnedSource {
                        path,
                        file,
                        identity,
                    });
                }
                self.asset_jobs.prepare_capture(
                    &request.project_epoch,
                    &request.if_generation,
                    asset,
                    sources,
                )
            }
        }
    }
    fn import_native_asset(
        &mut self,
        job: &str,
        id: &str,
        revision: &str,
        epoch: &str,
        generation: &str,
    ) -> Result<()> {
        use vv_core::{Command, CommandLabel, pool::AddEntities};
        if self.session.path().is_none() {
            return Err(ApiError::invalid(
                "Create or open a project before importing native assets",
            ));
        }
        let payload = self
            .asset_jobs
            .import_payload(job, id, revision, epoch, generation)?;
        let session_epoch = self.session.epoch();
        self.asset_imports
            .retain(|(epoch, _, _), _| *epoch == session_epoch);
        let key = (session_epoch, id.to_owned(), revision.to_owned());
        if self.asset_imports.get(&key).is_some_and(|cached| {
            cached
                .media
                .iter()
                .all(|id| self.session.project.media_pool.contains_key(*id))
                && cached
                    .timelines
                    .iter()
                    .all(|id| self.session.project.timelines.contains_key(*id))
        }) {
            return Ok(());
        }
        let mut trial = self.session.project.clone();
        let mut additions = AddEntities::new(CommandLabel::ImportMedia);
        payload.clone().merge_into(&mut trial, &mut additions);
        additions.apply(&mut trial);
        crate::files::validate_project(&trial)?;
        let mut additions = AddEntities::new(CommandLabel::ImportMedia);
        let selected = payload
            .merge_into(&mut self.session.project, &mut additions)
            .media;
        if !additions.is_empty() {
            self.session.apply(Box::new(additions));
        }
        let mut media = HashSet::new();
        let mut timelines = HashSet::new();
        let mut remaining = selected.clone();
        while let Some(id) = remaining.pop() {
            if !media.insert(id) {
                continue;
            }
            if let Some(timeline) = self
                .session
                .project
                .media_pool
                .get(id)
                .and_then(|item| item.compound)
                && timelines.insert(timeline)
            {
                remaining.extend(
                    self.session.project.timelines[timeline]
                        .tracks
                        .iter()
                        .flat_map(|track| &track.clips)
                        .filter_map(|clip| match clip.source {
                            vv_core::ClipSource::Media(id) => Some(id),
                            _ => None,
                        }),
                );
            }
        }
        if self.asset_imports.len() >= 64 {
            self.asset_imports.clear();
        }
        self.asset_imports.insert(
            key,
            ImportedAsset {
                selected,
                media,
                timelines,
            },
        );
        Ok(())
    }
    fn validate_frame_identity(
        &self,
        query: &FrameQuery,
    ) -> Result<(vv_core::TimelineId, (u32, u32))> {
        if query.project_epoch != format!("{}:{}", self.epoch, self.session.epoch())
            || query.if_generation != self.session.history.generation().to_string()
        {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Project changed before the frame snapshot",
            ));
        }
        let id = snapshot::timeline_id(&self.session, &query.timeline_id)?;
        if self.session.timeline_revision(id) != query.revision {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Timeline changed before the frame snapshot",
            ));
        }
        let tl = &self.session.project.timelines[id];
        Ok((id, frame_size(tl.resolution, query.width)?))
    }
    fn validate_view_frame(&self, query: &FrameQuery) -> Result<(vv_core::TimelineId, (u32, u32))> {
        let context = self.validate_frame_identity(query)?;
        if !(0..=commands::MAX_FRAME).contains(&query.frame) {
            return Err(ApiError::invalid(
                "Inspector playhead is outside the view range",
            ));
        }
        Ok(context)
    }
    fn validate_frame(&self, query: &FrameQuery) -> Result<(vv_core::TimelineId, (u32, u32))> {
        let (id, size) = self.validate_frame_identity(query)?;
        let tl = &self.session.project.timelines[id];
        if !(0..tl.total_frames().max(1)).contains(&query.frame) {
            return Err(ApiError::invalid("Preview frame is outside the timeline"));
        }
        Ok((id, size))
    }
    fn record_project_view(&mut self, request: crate::project_view::Request) -> Result<Value> {
        self.lease(&request.client_id)?;
        let (source, _) = self.validate_view_frame(&request.query)?;
        if request.if_view_revision.len() != 64
            || !request
                .if_view_revision
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ApiError::invalid(
                "Choose the current native project view revision",
            ));
        }
        if crate::project_view::snapshot(&self.session.project).1 != request.if_view_revision {
            return Err(ApiError::conflict(
                "VIEW_REVISION_CONFLICT",
                "The project view changed; read it before remembering this position",
            ));
        }
        let (root, frame) = if request.ancestors.is_empty() {
            (source, request.query.frame)
        } else {
            let mapped = crate::compound_navigation::navigate(
                &self.session,
                source,
                &crate::compound_navigation::Request {
                    query: request.query.clone(),
                    action: crate::compound_navigation::Navigation::Exit {
                        ancestors: request.ancestors,
                    },
                },
            )?;
            let root = snapshot::timeline_id(
                &self.session,
                mapped["timeline_id"].as_str().ok_or_else(ApiError::io)?,
            )?;
            (root, mapped["frame"].as_i64().ok_or_else(ApiError::io)?)
        };
        let view = crate::project_view::record(&self.session.project, root, frame);
        let changed = view != self.session.project.view;
        let mut saved = false;
        if request.persist
            && !self.session.has_unsaved_changes()
            && view != self.persisted_view
            && let Some(name) = self
                .session
                .path()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str())
                .map(str::to_owned)
        {
            let mut project = self.session.project.clone();
            project.view = view.clone();
            self.files.save(&project, &name, false)?;
            self.session.project.view = view.clone();
            self.session.mark_saved();
            self.persisted_view = view.clone();
            if crate::resume::remember(&self.files, &name).is_err() {
                self.persistence_notice = Some(
                    "The project view was saved, but automatic reopen metadata could not be updated. Existing recovery metadata was preserved.",
                );
            }
            saved = true;
        } else {
            self.session.project.view = view.clone();
        }
        let (value, revision) = crate::project_view::snapshot(&self.session.project);
        Ok(json!({
            "project_epoch":format!("{}:{}",self.epoch,self.session.epoch()),
            "generation":self.session.history.generation().to_string(),
            "view":value,"view_revision":revision,"changed":changed,"saved":saved,
            "persisted":self.session.path().is_some() && self.persisted_view == view,
            "persistence_notice":self.persistence_notice,
        }))
    }
    fn handle(&mut self, action: Action) -> Result<Value> {
        match action {
            Action::ProjectView(request) => self.record_project_view(request),
            Action::CompoundNavigation(request) => {
                request.validate()?;
                let (id, _) = self.validate_frame_identity(&request.query)?;
                crate::compound_navigation::navigate(&self.session, id, &request)
            }
            Action::EqResponse(channel, index, query) => {
                let (id, _) = self.validate_frame(&query)?;
                let mut value = crate::audio::eq_response(
                    &self.session.project.timelines[id],
                    &channel,
                    index,
                )?;
                value["revision"] = json!(query.revision);
                value["project_epoch"] = json!(query.project_epoch);
                value["generation"] = json!(query.if_generation);
                Ok(value)
            }
            Action::InspectorSelection(request) => {
                let (id, _) = self.validate_view_frame(&request.query)?;
                let rows = crate::selection::rows(
                    &self.session,
                    id,
                    request.query.frame,
                    &request.clip_ids,
                )?;
                Ok(json!({"query":request.query,"rows":rows}))
            }
            Action::ClipDetail(clip, query, page) => {
                let (id, _) = self.validate_view_frame(&query)?;
                let mut detail = match page {
                    Some(page) => crate::inspector::detail_page(
                        &self.session,
                        id,
                        &clip,
                        query.frame,
                        Some(page),
                    )?,
                    None => crate::inspector::detail(&self.session, id, &clip, query.frame)?,
                };
                detail["project_epoch"] = json!(query.project_epoch);
                detail["generation"] = json!(query.if_generation);
                detail["revision"] = json!(query.revision);
                detail["timeline_id"] = json!(query.timeline_id);
                Ok(detail)
            }
            Action::KeyframeNavigation(clip, request) => {
                let query = request.query;
                let (id, _) = self.validate_view_frame(&query)?;
                let mut value = crate::inspector::keyframe_navigation(
                    &self.session,
                    id,
                    &clip,
                    request.source_frame,
                )?;
                value["project_epoch"] = json!(query.project_epoch);
                value["generation"] = json!(query.if_generation);
                value["timeline_id"] = json!(query.timeline_id);
                value["revision"] = json!(query.revision);
                Ok(value)
            }
            Action::SlipDetail(clip, center, query) => {
                let (id, _) = self.validate_frame(&query)?;
                let mut detail = crate::slip::detail(&self.session, id, &clip, center)?;
                if detail["preview_available"] == true {
                    use vv_core::Id;
                    let media = vv_core::MediaId::from_raw(
                        detail["media_id"]
                            .as_str()
                            .ok_or_else(ApiError::missing)?
                            .parse()
                            .map_err(|_| ApiError::missing())?,
                    );
                    match self
                        .files
                        .media_file(&self.session.project.media_pool[media].path)
                    {
                        Ok(file) => {
                            detail["source_version"] = json!(crate::source::file_identity(&file)?)
                        }
                        Err(_) => {
                            detail["preview_available"] = json!(false);
                            detail["source_offline"] = json!(true);
                        }
                    }
                }
                detail["project_epoch"] = json!(query.project_epoch);
                detail["generation"] = json!(query.if_generation);
                detail["revision"] = json!(query.revision);
                Ok(detail)
            }
            Action::TakePlan(request) => {
                let (id, _) = self.validate_frame(&request.query)?;
                crate::take::preview(&self.session, &self.files, id, &request)
            }
            Action::Review(query) => {
                if query.project_epoch != format!("{}:{}", self.epoch, self.session.epoch()) {
                    return Err(ApiError::conflict(
                        "REVISION_CONFLICT",
                        "Project changed before reading review metadata",
                    ));
                }
                let mut value = crate::reviewmeta::read(&self.files, &self.session)?;
                value["project_epoch"] = json!(query.project_epoch);
                value["generation"] = json!(self.session.history.generation().to_string());
                Ok(value)
            }
            Action::CapturePreset(request) => {
                let (id, _) = self.validate_frame(&request.query)?;
                let preset = crate::presets::capture(
                    &self.session,
                    id,
                    &request.clip_ids,
                    &request.options,
                )?;
                Ok(
                    json!({"project_epoch":request.query.project_epoch,"generation":request.query.if_generation,"revision":request.query.revision,"preset":preset}),
                )
            }
            Action::CheckFrame(query) => self.validate_frame(&query).map(|_| Value::Null),
            Action::AudioPresets(query) => {
                self.validate_asset_epoch(&query.project_epoch, None)?;
                let mut value = self.audio_presets.list()?;
                value["project_epoch"] = json!(query.project_epoch);
                Ok(value)
            }
            Action::PresetList(page, query) => {
                if query.project_epoch != format!("{}:{}", self.epoch, self.session.epoch()) {
                    return Err(ApiError::conflict(
                        "REVISION_CONFLICT",
                        "Project changed before reading presets",
                    ));
                }
                self.presets.list(page, &query)
            }
            Action::PrepareNativeAsset(request) => self.prepare_native_asset(request),
            Action::PrepareMediaImport(request) => self.prepare_media_import(request),
            Action::Clipboard(query) => {
                self.validate_asset_epoch(&query.project_epoch, Some(&query.if_generation))?;
                let clipboard = self.clipboard.as_ref().ok_or_else(|| {
                    ApiError::conflict("CLIPBOARD_EMPTY", "Copy clips or media first")
                })?;
                if clipboard.revision(&self.session) != Some(query.clipboard_revision.as_str()) {
                    return Err(ApiError::conflict(
                        "CLIPBOARD_STALE",
                        "The native clipboard changed; copy again",
                    ));
                }
                Ok(
                    json!({"project_epoch":query.project_epoch,"generation":query.if_generation,"clipboard_revision":query.clipboard_revision,"text":clipboard.text(),"clip_count":clipboard.count(&self.session),"media_count":clipboard.media_count()}),
                )
            }
            Action::PrepareClipboard(request) => {
                self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
                let fallback = self.clipboard.as_ref().map(|clipboard| clipboard.text());
                let text = request.text.as_deref().or(fallback).ok_or_else(|| {
                    ApiError::conflict("CLIPBOARD_EMPTY", "Copy clips or media first")
                })?;
                self.asset_jobs.prepare_clipboard(
                    &request.project_epoch,
                    &request.if_generation,
                    text,
                    fallback,
                    request.to_pool,
                )
            }
            Action::CheckClipboardImage(query) => {
                self.check_clipboard_image(&query)?;
                Ok(json!({"saved":true,"max_bytes":32 * 1024 * 1024}))
            }
            Action::PrepareClipboardImage(query, mime, bytes) => {
                self.check_clipboard_image(&query)?;
                self.asset_jobs.prepare_clipboard_image(
                    &query.project_epoch,
                    &query.if_generation,
                    &mime,
                    bytes,
                )
            }
            Action::ClipboardImageStatus(job, query, cancel) => {
                if !cancel {
                    self.validate_asset_epoch(&query.project_epoch, None)?;
                }
                let value = self.asset_jobs.status(&job, &query.project_epoch, false)?;
                if value["kind"] != "clipboard_image" {
                    return Err(ApiError::missing());
                }
                if cancel {
                    self.asset_jobs.status(&job, &query.project_epoch, true)
                } else {
                    Ok(value)
                }
            }
            Action::ClipboardStatus(job, query, cancel) => {
                if !cancel {
                    self.validate_asset_epoch(&query.project_epoch, None)?;
                }
                let value = self.asset_jobs.status(&job, &query.project_epoch, false)?;
                if value["kind"] != "clipboard_import" {
                    return Err(ApiError::missing());
                }
                if cancel {
                    self.asset_jobs.status(&job, &query.project_epoch, true)
                } else {
                    Ok(value)
                }
            }
            Action::PrepareOtio(request) => {
                self.validate_asset_epoch(&request.project_epoch, Some(&request.if_generation))?;
                self.asset_jobs.prepare_otio(
                    &request.project_epoch,
                    &request.if_generation,
                    &request.path_token,
                )
            }
            Action::OtioImportStatus(job, query, cancel) => {
                if !cancel {
                    self.validate_asset_epoch(&query.project_epoch, None)?;
                }
                let value = self.asset_jobs.status(&job, &query.project_epoch, false)?;
                if value["kind"] != "otio_import" {
                    return Err(ApiError::missing());
                }
                if cancel {
                    self.asset_jobs.status(&job, &query.project_epoch, true)
                } else {
                    Ok(value)
                }
            }
            Action::PrepareLegacyMediaImport(request, reply) => {
                let _ = reply.send(self.prepare_legacy_media_import(request));
                Ok(Value::Null)
            }
            Action::MediaImportStatus(job, query, cancel) => {
                if !cancel {
                    self.validate_asset_epoch(&query.project_epoch, None)?;
                }
                let value = self.asset_jobs.status(&job, &query.project_epoch, false)?;
                if value["kind"] != "media_import" {
                    return Err(ApiError::missing());
                }
                if cancel {
                    self.asset_jobs.status(&job, &query.project_epoch, true)
                } else {
                    Ok(value)
                }
            }
            Action::PrepareNativeAssetEdit(request, reply) => {
                let _ = reply.send(self.prepare_native_edit(request));
                Ok(Value::Null)
            }
            Action::NativeAssetFolders(query) => {
                self.validate_asset_epoch(&query.project_epoch, None)?;
                let mut value = self.assets.folders()?;
                value["project_epoch"] = json!(query.project_epoch);
                Ok(value)
            }
            Action::NativeAssetList(page, query) => {
                self.validate_asset_epoch(&query.project_epoch, None)?;
                self.assets.list(page, &query)
            }
            Action::NativeAssetItem(id, query) => {
                self.validate_asset_epoch(&query.project_epoch, None)?;
                self.assets.item(&id, query.archived)
            }
            Action::NativeAssetStatus(job, query, cancel) => {
                if !cancel {
                    self.validate_asset_epoch(&query.project_epoch, None)?;
                }
                self.asset_jobs.status(&job, &query.project_epoch, cancel)
            }
            Action::NativeAssetExport(id, query, reply) => {
                let result = self
                    .validate_asset_epoch(&query.project_epoch, None)
                    .and_then(|()| self.assets.export(&id));
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::PresetItem(id, query) => {
                if query.project_epoch != format!("{}:{}", self.epoch, self.session.epoch()) {
                    return Err(ApiError::conflict(
                        "REVISION_CONFLICT",
                        "Project changed before reading the preset",
                    ));
                }
                self.presets.item(&id, false)
            }
            Action::PresetExport(id, query, reply) => {
                let result =
                    if query.project_epoch != format!("{}:{}", self.epoch, self.session.epoch()) {
                        Err(ApiError::conflict(
                            "REVISION_CONFLICT",
                            "Project changed before exporting the preset",
                        ))
                    } else {
                        self.presets.export(&id)
                    };
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::SourceSnapshot(media_id, query, reply) => {
                let result = (|| {
                    if query.project_epoch != format!("{}:{}", self.epoch, self.session.epoch()) {
                        return Err(ApiError::conflict(
                            "REVISION_CONFLICT",
                            "Project changed before the media request",
                        ));
                    }
                    use vv_core::Id;
                    let id = vv_core::MediaId::from_raw(
                        media_id.parse().map_err(|_| ApiError::missing())?,
                    );
                    let media = self
                        .session
                        .project
                        .media_pool
                        .get(id)
                        .ok_or_else(ApiError::missing)?;
                    if media.compound.is_some() {
                        return Err(ApiError::invalid("Compound sources use the Program viewer"));
                    }
                    Ok(SourceSpec {
                        file: self.files.media_file(&media.path)?,
                        epoch: query.project_epoch,
                        media_id,
                        meta: media.meta.clone(),
                    })
                })();
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::SpeechSnapshot(request, reply) => {
                let result = (|| {
                    let (id, _) = self.validate_frame(&request.query)?;
                    crate::silence::snapshot(&self.session, &self.files, id, request)
                })();
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::AudioSnapshot(query, reply) => {
                let result = (|| {
                    let (id, size) = self.validate_frame(&query)?;
                    crate::audition::pin(
                        FrameSnapshot {
                            project: self.session.project.clone(),
                            timeline: id,
                            query,
                            size,
                        },
                        &self.files,
                    )
                })();
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::FrameSnapshot(query, reply) => {
                let result = (|| {
                    let (id, size) = self.validate_frame(&query)?;
                    Ok(FrameSnapshot {
                        project: self.session.project.clone(),
                        timeline: id,
                        query,
                        size,
                    })
                })();
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::Session => Ok(self.snapshot()),
            Action::Timeline(id) => snapshot::timeline_id(&self.session, &id)
                .map(|id| snapshot::timeline(&self.session, id)),
            Action::MediaRoot(reply) => {
                let _ = reply.send(self.files.root_file());
                Ok(Value::Null)
            }
            Action::SourceBrowserTask(query, reply) => {
                let result = self
                    .validate_asset_epoch(&query.project_epoch, None)
                    .and_then(|_| self.files.source_browser_task(query));
                let _ = reply.send(result);
                Ok(Value::Null)
            }
            Action::Projects => self.files.list(),
            Action::Recovery => Ok(self.autosave.info()),
            Action::Lease(client) => self.lease(&client),
            Action::Mutation(timeline, request) => self.mutation(timeline, request),
            Action::Lookup(id) => self.lookup(&id),
        }
    }
}
fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 80
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
impl Host {
    pub async fn source_browser(&self, query: crate::files::SourcesQuery) -> Result<Value> {
        let permit = self.1.clone().try_acquire_owned().map_err(|_| {
            ApiError::conflict(
                "SOURCE_BROWSER_BUSY",
                "Source browser is busy; retry after the current directory read",
            )
        })?;
        let epoch = query.project_epoch.clone();
        let (tx, rx) = oneshot::channel();
        self.call(Action::SourceBrowserTask(query, tx)).await?;
        let task = rx.await.map_err(|_| ApiError::io())??;
        let value = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            task.run()
        })
        .await
        .map_err(|_| ApiError::io())??;
        if self.call(Action::Session).await?["project_epoch"] != epoch {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Project changed while browsing sources",
            ));
        }
        Ok(value)
    }
    pub async fn project_mutation(&self, request: Mutation) -> Result<Value> {
        if !matches!(
            request.operation,
            Operation::ImportMedia { .. } | Operation::ImportOtio { .. }
        ) {
            return self.call(Action::Mutation(None, request)).await;
        }
        let (tx, rx) = oneshot::channel();
        self.call(Action::PrepareLegacyMediaImport(request.clone(), tx))
            .await?;
        let guard = match rx.await.map_err(|_| ApiError::io())?? {
            NativeEditPreparation::Complete(value) => return Ok(value),
            NativeEditPreparation::Pending(guard) => guard,
        };
        self.finish_media_import(request, guard).await
    }
    async fn finish_media_import(
        &self,
        request: Mutation,
        mut guard: NativeEditGuard,
    ) -> Result<Value> {
        let started = Instant::now();
        loop {
            let value = guard.jobs.status(&guard.job, &guard.epoch, false)?;
            match value["state"].as_str() {
                Some("ready" | "applied") => break,
                Some("queued" | "running") => {}
                Some("failed") => {
                    let error = guard
                        .jobs
                        .read_failure(&guard.job, &guard.epoch)?
                        .unwrap_or_else(|| ApiError::invalid("Media import preparation failed"));
                    guard.armed = false;
                    return match self.call(Action::Lookup(request.command_id.clone())).await {
                        Ok(value) if value["status"] == "applied" => Ok(value),
                        Err(known) if known.1 != "NOT_FOUND" => Err(known),
                        _ => Err(error),
                    };
                }
                _ => {
                    match self.call(Action::Lookup(request.command_id.clone())).await {
                        Ok(value) if value["status"] == "applied" => {
                            guard.armed = false;
                            return Ok(value);
                        }
                        Err(error) if error.1 != "NOT_FOUND" => {
                            guard.armed = false;
                            return Err(error);
                        }
                        _ => {}
                    }
                    return Err(ApiError::conflict(
                        "ASSET_CANCELED",
                        "Media import preparation was canceled",
                    ));
                }
            }
            if started.elapsed() >= Duration::from_secs(620) {
                return Err(ApiError::conflict(
                    "MEDIA_IMPORT_TIMEOUT",
                    "Media import preparation timed out before commit",
                ));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let result = self.call(Action::Mutation(None, request)).await;
        if result.is_ok()
            || guard
                .jobs
                .status(&guard.job, &guard.epoch, false)
                .is_ok_and(|value| matches!(value["state"].as_str(), Some("applied" | "failed")))
        {
            guard.armed = false;
        }
        result
    }
    pub async fn prepare_native_asset_edit(&self, request: Mutation) -> Result<Value> {
        if !matches!(&request.operation, Operation::EditNativeAssetLibrary { edit } if edit.requires_preparation())
        {
            return Err(ApiError::invalid(
                "Choose a preparable native asset library edit",
            ));
        }
        let (tx, rx) = oneshot::channel();
        self.call(Action::PrepareNativeAssetEdit(request, tx))
            .await?;
        match rx.await.map_err(|_| ApiError::io())?? {
            NativeEditPreparation::Complete(receipt) => {
                Ok(json!({"state":"applied","receipt":receipt}))
            }
            NativeEditPreparation::Pending(mut guard) => {
                let status = guard.jobs.status(&guard.job, &guard.epoch, false)?;
                guard.armed = false;
                Ok(status)
            }
        }
    }
    pub async fn native_asset_mutation(&self, request: Mutation) -> Result<Value> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::PrepareNativeAssetEdit(request.clone(), tx))
            .await?;
        let preparation = rx.await.map_err(|_| ApiError::io())??;
        let mut guard = match preparation {
            NativeEditPreparation::Complete(value) => return Ok(value),
            NativeEditPreparation::Pending(guard) => guard,
        };
        let started = Instant::now();
        loop {
            let status = guard.jobs.status(&guard.job, &guard.epoch, false)?;
            match status["state"].as_str() {
                Some("ready" | "applied") => break,
                Some("queued" | "running") => {}
                Some("failed") => {
                    let error = guard.jobs.read_failure(&guard.job, &guard.epoch)?.unwrap_or_else(|| ApiError::conflict(
                        "ASSET_EDIT_NOT_APPLIED",
                        "Native library preparation failed before commit; refresh and retry with a new command",
                    ));
                    guard.armed = false;
                    return Err(error);
                }
                _ => {
                    return Err(ApiError::conflict(
                        "ASSET_EDIT_NOT_APPLIED",
                        "Native library preparation did not commit; refresh and retry with a new command",
                    ));
                }
            }
            if started.elapsed() >= Duration::from_secs(20) {
                return Err(ApiError::conflict(
                    "ASSET_TIMEOUT",
                    "Native library preparation timed out before commit",
                ));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let value = self.call(Action::Mutation(None, request)).await?;
        guard.armed = false;
        Ok(value)
    }
    pub async fn media_root(&self) -> Result<std::fs::File> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::MediaRoot(tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub async fn speech_snapshot(
        &self,
        request: crate::silence::Request,
    ) -> Result<crate::silence::Task> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::SpeechSnapshot(request, tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub async fn source_snapshot(&self, id: String, query: SourceQuery) -> Result<SourceSpec> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::SourceSnapshot(id, query, tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub async fn frame_snapshot(&self, query: FrameQuery) -> Result<FrameSnapshot> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::FrameSnapshot(query, tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub async fn audio_snapshot(&self, query: FrameQuery) -> Result<crate::audition::Task> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::AudioSnapshot(query, tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub fn start(root: &Path) -> std::io::Result<Self> {
        Self::run(Editor::new(root)?)
    }
    pub fn start_with_presets(root: &Path, preset_root: &Path) -> std::io::Result<Self> {
        Self::run(Editor::with_presets(root, preset_root)?)
    }
    pub fn start_with_libraries(
        root: &Path,
        preset_root: &Path,
        asset_root: &Path,
    ) -> std::io::Result<Self> {
        Self::run(Editor::with_libraries(root, preset_root, asset_root)?)
    }
    fn run(mut editor: Editor) -> std::io::Result<Self> {
        let (tx, rx) = mpsc::sync_channel::<Message>(16);
        std::thread::spawn(move || {
            loop {
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok((action, reply)) => {
                        let _ = reply.send(editor.handle(action));
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                editor.autosave.tick(&editor.files, &editor.session);
            }
        });
        Ok(Self(tx, Arc::new(tokio::sync::Semaphore::new(1))))
    }
    pub async fn call(&self, action: Action) -> Result<Value> {
        let (tx, rx) = oneshot::channel();
        self.0.try_send((action, tx)).map_err(|_| {
            ApiError(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "HOST_BUSY",
                "The session queue is full or unavailable",
            )
        })?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub async fn preset_export(&self, id: String, query: SourceQuery) -> Result<Vec<u8>> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::PresetExport(id, query, tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
    pub async fn native_asset_export(&self, id: String, query: SourceQuery) -> Result<Vec<u8>> {
        let (tx, rx) = oneshot::channel();
        self.call(Action::NativeAssetExport(id, query, tx)).await?;
        rx.await.map_err(|_| ApiError::io())?
    }
}

#[cfg(test)]
#[path = "tests/host.rs"]
mod tests;
