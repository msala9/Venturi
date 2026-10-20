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
    Session,
    Timeline(String),
    Projects,
    Lease(String),
    Mutation(Option<String>, Mutation),
    Lookup(String),
    FrameSnapshot(FrameQuery, oneshot::Sender<Result<FrameSnapshot>>),
    CheckFrame(FrameQuery),
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
}
impl Editor {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        Ok(Self {
            session: Session::default(),
            files: Files::new(root)?,
            epoch: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
                .to_string(),
            lease: None,
            completed: HashMap::new(),
        })
    }
    fn snapshot(&self) -> Value {
        snapshot::session(&self.session, &self.epoch)
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
        let result=self.perform(timeline,&request).map(|_|json!({"command_id":request.command_id,"status":"applied","project_epoch":format!("{}:{}",self.epoch,self.session.epoch()),"generation":self.session.history.generation().to_string()}));
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
            return commands::apply(&mut self.session, id, &request.operation);
        }
        match &request.operation {
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
                self.files.save(&session.project, &path_token, true)?;
                self.session
                    .install_project(session.project, Some(self.files.path(&path_token)?));
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
            Action::Projects => self.files.list(),
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
    pub fn start(root: &Path) -> std::io::Result<Self> {
        let mut editor = Editor::new(root)?;
        let (tx, rx) = mpsc::sync_channel::<Message>(16);
        std::thread::spawn(move || {
            while let Ok((action, reply)) = rx.recv() {
                let _ = reply.send(editor.handle(action));
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
