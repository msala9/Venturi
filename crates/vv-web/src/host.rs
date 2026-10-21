use crate::{
    commands::{self, Mutation, Operation},
    error::{ApiError, Result},
    files::Files,
    preview::{FrameQuery, FrameSnapshot, frame_size},
    snapshot,
    source::{SourceQuery, SourceSpec},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::mpsc,
    time::{Duration, Instant},
};
use tokio::sync::oneshot;
use vv_core::{Rational, Timeline, Track, TrackKind};
use vv_session::Session;

pub enum Action {
    MediaRoot(oneshot::Sender<Result<std::fs::File>>),
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
    ClipDetail(String, FrameQuery),
    SlipDetail(String, i64, FrameQuery),
    TakePlan(crate::take::Preview),
    Review(SourceQuery),
    SpeechSnapshot(
        crate::silence::Request,
        oneshot::Sender<Result<crate::silence::Task>>,
    ),
    EqResponse(String, usize, FrameQuery),
    SourceSnapshot(String, SourceQuery, oneshot::Sender<Result<SourceSpec>>),
}
type Message = (Action, oneshot::Sender<Result<Value>>);
#[derive(Clone)]
pub struct Host(mpsc::SyncSender<Message>);
pub struct Editor {
    pub session: Session,
    files: Files,
    epoch: String,
    lease: Option<(String, Instant)>,
    completed: HashMap<String, (String, Result<Value>)>,
    import_warnings: Vec<String>,
    clipboard: Option<crate::clipboard::Clipboard>,
    persistence_notice: Option<&'static str>,
    autosave: crate::autosave::Store,
}
impl Editor {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        let files = Files::new(root)?;
        let mut session = Session::default();
        let persistence_notice = match crate::resume::restore(&files) {
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
        Ok(Self {
            session,
            files,
            epoch: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
                .to_string(),
            lease: None,
            completed: HashMap::new(),
            import_warnings: vec![],
            clipboard: None,
            persistence_notice,
            autosave,
        })
    }
    fn snapshot(&self) -> Value {
        let mut snapshot = snapshot::session(&self.session, &self.epoch);
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
        let fingerprint = serde_json::to_string(&(timeline.clone(), &request))
            .map_err(|_| ApiError::invalid("Invalid command"))?;
        if let Some((original, result)) = self.completed.get(&request.command_id) {
            if original != &fingerprint {
                return Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Command ID was already used with another request",
                ));
            }
            return result.clone();
        }
        self.lease(&request.client_id)?;
        let bytes = self
            .completed
            .values()
            .map(|(key, _)| key.len())
            .sum::<usize>()
            + fingerprint.len();
        if self.completed.len() >= 4096
            || bytes > 8 * 1024 * 1024
            || (!matches!(request.operation, Operation::Save)
                && (self.completed.len() >= 4095 || bytes > 8 * 1024 * 1024 - 4096))
        {
            return Err(ApiError::conflict(
                "COMMAND_LIMIT",
                "Save and restart the host before further commands",
            ));
        }
        let result=self.perform(timeline,&request).map(|_|{
            if matches!(request.operation,Operation::Save|Operation::SaveAs{..}) {self.autosave.saved(&self.files,&self.session);}
            if matches!(request.operation,Operation::NewProject{..}|Operation::OpenProject{..}|Operation::Save|Operation::SaveAs{..}|Operation::RecoverBackup{..}|Operation::ImportOtio{..}|Operation::RecoverAutosave{open:true,..})
                && let Some(name)=self.session.path().and_then(|path|path.file_name()).and_then(|name|name.to_str()) {
                self.persistence_notice=crate::resume::remember(&self.files,name).err().map(|_|"The project operation succeeded, but automatic reopen could not be updated. Existing recovery metadata was preserved.");
            }
            json!({"command_id":request.command_id,"status":"applied","project_epoch":format!("{}:{}",self.epoch,self.session.epoch()),"generation":self.session.history.generation().to_string()})
        });
        self.completed
            .insert(request.command_id.clone(), (fingerprint, result.clone()));
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
                Operation::PlaceRecording { placement } => {
                    crate::recording::place(&mut self.session, &self.files, id, placement)
                }
                Operation::ReplaceTake { replacement } => {
                    crate::take::apply(&mut self.session, &self.files, id, replacement)
                }
                Operation::CopyClips { clip_ids } => {
                    self.clipboard = Some(crate::clipboard::copy(&self.session, id, clip_ids)?);
                    Ok(())
                }
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
                _ => commands::apply(&mut self.session, id, &request.operation),
            };
        }
        match &request.operation {
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
            Operation::ImportMedia { path_token } => {
                if self.session.path().is_none() {
                    return Err(ApiError::invalid(
                        "Create or open a project before importing media",
                    ));
                }
                let (path, meta) = self.files.probe(path_token)?;
                if self.session.media_with_path(&path).is_none() {
                    self.session.add_media(path, meta);
                }
            }
            Operation::ImportOtio { path_token, name } => {
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
                let (project, warnings) = self.files.import_otio(path_token)?;
                let token = format!("{name}.vvproj");
                let metadata = crate::reviewmeta::reserve_copy(&self.files, None, &token)?;
                self.files.save(&project, &token, true)?;
                metadata.commit();
                self.session
                    .install_project(project, Some(self.files.path(&token)?));
                self.import_warnings = warnings;
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
    fn validate_frame(&self, query: &FrameQuery) -> Result<(vv_core::TimelineId, (u32, u32))> {
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
        if !(0..tl.total_frames().max(1)).contains(&query.frame) {
            return Err(ApiError::invalid("Preview frame is outside the timeline"));
        }
        Ok((id, frame_size(tl.resolution, query.width)?))
    }
    fn handle(&mut self, action: Action) -> Result<Value> {
        match action {
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
            Action::ClipDetail(clip, query) => {
                let (id, _) = self.validate_frame(&query)?;
                let mut detail = crate::inspector::detail(&self.session, id, &clip, query.frame)?;
                detail["project_epoch"] = json!(query.project_epoch);
                detail["generation"] = json!(query.if_generation);
                detail["revision"] = json!(query.revision);
                Ok(detail)
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
            Action::CheckFrame(query) => self.validate_frame(&query).map(|_| Value::Null),
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
            Action::Projects => self.files.list(),
            Action::Recovery => Ok(self.autosave.info()),
            Action::Lease(client) => self.lease(&client),
            Action::Mutation(timeline, request) => self.mutation(timeline, request),
            Action::Lookup(id) => self
                .completed
                .get(&id)
                .map(|(_, result)| result.clone())
                .unwrap_or_else(|| Err(ApiError::missing())),
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
        let mut editor = Editor::new(root)?;
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
        Ok(Self(tx))
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
}

#[cfg(test)]
#[path = "tests/host.rs"]
mod tests;
