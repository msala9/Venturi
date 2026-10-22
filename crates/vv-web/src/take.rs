use crate::{
    error::{ApiError, Result},
    files::Files,
    preview::FrameQuery,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::File,
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use vv_core::{self as core, Id};
use vv_session::Session;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Replacement {
    pub clip_id: String,
    pub media_id: String,
    pub source_in: i64,
    pub duration: core::take::DurationPolicy,
    pub links: core::take::LinkPolicy,
    pub attributes: core::take::AttributePolicy,
    #[serde(default, skip_serializing_if = "preserve_audio_streams")]
    pub audio_streams: core::take::AudioStreamPolicy,
    #[serde(default, skip_serializing_if = "reject_frozen")]
    pub frozen: core::take::FrozenPolicy,
    pub source_version: Option<String>,
}
fn reject_frozen(policy: &core::take::FrozenPolicy) -> bool {
    matches!(policy, core::take::FrozenPolicy::Reject)
}
fn preserve_audio_streams(policy: &core::take::AudioStreamPolicy) -> bool {
    matches!(policy, core::take::AudioStreamPolicy::Preserve)
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    pub query: FrameQuery,
    pub replacement: Replacement,
}

fn error(error: core::take::Error) -> ApiError {
    use core::take::Error::*;
    match error {
        Missing => ApiError::missing(),
        Locked => ApiError::conflict("TRACK_LOCKED", "A selected or linked track is locked"),
        TooShort => ApiError::conflict(
            "TAKE_TOO_SHORT",
            "The take is too short; explicitly shorten the edit or cancel",
        ),
        Stream => ApiError::invalid("The take lacks a required audio or video stream"),
        AudioStream => ApiError::conflict(
            "TAKE_AUDIO_STREAM",
            "The take lacks an affected audio stream; explicitly choose an available source stream or keep other linked clips",
        ),
        Compound => {
            ApiError::invalid("Choose a source media clip; compound replacement is unsupported")
        }
        Frozen => {
            ApiError::invalid("Choose Hold B Source In or Unfreeze for affected frozen clips")
        }
        LinkedSource => ApiError::invalid(
            "Linked clips use different media or speeds; explicitly keep the other linked clips",
        ),
        SourceStart => ApiError::invalid("Choose a source In that covers every linked clip"),
        Empty => ApiError::invalid("The replacement leaves no available source frames"),
        Timing => ApiError::invalid("The take has invalid native source timing"),
    }
}
fn request(
    session: &Session,
    id: core::TimelineId,
    replacement: &Replacement,
) -> Result<core::take::Request> {
    if session.path().is_none() {
        return Err(ApiError::invalid(
            "Save the project before replacing a take",
        ));
    }
    if !(0..=crate::commands::MAX_FRAME).contains(&replacement.source_in) {
        return Err(ApiError::invalid("Choose a bounded native source frame"));
    }
    let media = core::MediaId::from_raw(
        replacement
            .media_id
            .parse()
            .map_err(|_| ApiError::missing())?,
    );
    let source = session
        .project
        .media_pool
        .get(media)
        .ok_or_else(ApiError::missing)?;
    if source.compound.is_some() {
        return Err(error(core::take::Error::Compound));
    }
    Ok(core::take::Request {
        timeline: id,
        clip: core::ClipId(
            replacement
                .clip_id
                .parse()
                .map_err(|_| ApiError::missing())?,
        ),
        media,
        source_in: replacement.source_in,
        duration: replacement.duration,
        links: replacement.links,
        attributes: replacement.attributes,
        audio_streams: replacement.audio_streams,
        frozen: replacement.frozen,
    })
}
fn source_changed() -> ApiError {
    ApiError::conflict(
        "SOURCE_CHANGED",
        "The imported take changed; preview or import the current source explicitly",
    )
}
fn canceled() -> ApiError {
    ApiError::conflict("TAKE_CANCELED", "Take verification was canceled")
}
fn same_meta(a: &core::MediaMeta, b: &core::MediaMeta) -> bool {
    a.fps == b.fps
        && a.duration_frames == b.duration_frames
        && a.sample_rate == b.sample_rate
        && a.channels == b.channels
        && a.audio_streams == b.audio_streams
        && (a.width, a.height, a.has_video, a.has_audio)
            == (b.width, b.height, b.has_video, b.has_audio)
}
pub struct Task {
    timeline: core::TimelineId,
    replacement: Replacement,
    require_version: bool,
    epoch: u64,
    generation: String,
    revision: String,
    project_path: PathBuf,
    file: File,
    root: File,
    root_path: PathBuf,
    path: PathBuf,
    token: String,
    parent: Option<String>,
    identity: String,
    version: String,
    meta: core::MediaMeta,
    content_hash: u64,
}
pub struct Verified {
    task: Task,
}
impl Task {
    pub fn new(
        session: &Session,
        files: &Files,
        id: core::TimelineId,
        replacement: &Replacement,
        require_version: bool,
    ) -> Result<Self> {
        let native = request(session, id, replacement)?;
        if session.project.timelines.get(id).is_none() {
            return Err(ApiError::missing());
        }
        let source = &session.project.media_pool[native.media];
        let token = files.media_token(&source.path)?;
        let file = files.media_file(&source.path)?;
        let version = crate::source::source_version(&file)?;
        if require_version && replacement.source_version.is_none()
            || replacement
                .source_version
                .as_ref()
                .is_some_and(|expected| expected != &version)
        {
            return Err(source_changed());
        }
        let root = files.root_file()?;
        let root_path = source
            .path
            .ancestors()
            .nth(Path::new(&token).components().count())
            .ok_or_else(source_changed)?
            .to_path_buf();
        let parent = crate::files::source_entry(&root_path, &root, &token)?.1;
        let task = Self {
            timeline: id,
            replacement: replacement.clone(),
            require_version,
            epoch: session.epoch(),
            generation: session.history.generation().to_string(),
            revision: session.timeline_revision(id),
            project_path: session.path().ok_or_else(source_changed)?.to_path_buf(),
            identity: crate::asset_store::stable_identity(&file)?,
            file,
            root,
            root_path,
            path: source.path.clone(),
            token,
            parent,
            version,
            meta: source.meta.clone(),
            content_hash: source.content_hash,
        };
        task.validate_source()?;
        Ok(task)
    }
    fn validate_source(&self) -> Result<()> {
        if crate::source::source_version(&self.file)? != self.version
            || crate::asset_store::stable_identity(&self.file)? != self.identity
            || crate::files::source_entry(&self.root_path, &self.root, &self.token)
                .map_err(|_| source_changed())?
                .1
                != self.parent
        {
            return Err(source_changed());
        }
        crate::files::validate_approved_file(&self.root_path, &self.root, &self.token, &self.file)
            .map_err(|_| source_changed())
    }
    pub fn run(self, cancel: &AtomicBool) -> Result<Verified> {
        if cancel.load(Ordering::Acquire) {
            return Err(canceled());
        }
        self.validate_source()?;
        let meta = crate::asset_probe::probe_root_media(
            &self.file,
            vv_media::is_image_path(&self.path),
            cancel,
            Duration::from_secs(20),
        )?;
        let hash = vv_media::content_fingerprint(&PathBuf::from(format!(
            "/proc/self/fd/{}",
            self.file.as_raw_fd()
        )))
        .map_err(|_| source_changed())?;
        if cancel.load(Ordering::Acquire) {
            return Err(canceled());
        }
        self.validate_source()?;
        if hash != self.content_hash || !same_meta(&meta, &self.meta) {
            return Err(source_changed());
        }
        Ok(Verified { task: self })
    }
}
impl Verified {
    fn request(
        &self,
        session: &Session,
        files: &Files,
        id: core::TimelineId,
        replacement: &Replacement,
        apply: bool,
    ) -> Result<core::take::Request> {
        let task = &self.task;
        if session.epoch() != task.epoch
            || session.history.generation().to_string() != task.generation
            || id != task.timeline
            || session.project.timelines.get(id).is_none()
            || session.timeline_revision(id) != task.revision
            || session.path() != Some(task.project_path.as_path())
        {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Project changed during take verification; preview again",
            ));
        }
        if replacement != &task.replacement || apply && !task.require_version {
            return Err(source_changed());
        }
        let native = request(session, id, replacement)?;
        let source = &session.project.media_pool[native.media];
        if source.path != task.path
            || source.content_hash != task.content_hash
            || !same_meta(&source.meta, &task.meta)
            || source.meta.file != task.meta.file
            || files.media_token(&source.path)? != task.token
        {
            return Err(source_changed());
        }
        crate::asset_store::same_directory(&files.root_file()?, &task.root)
            .map_err(|_| source_changed())?;
        task.validate_source()?;
        Ok(native)
    }
}
pub fn preview_verified(
    session: &Session,
    files: &Files,
    id: core::TimelineId,
    request_body: &Preview,
    verified: &Verified,
) -> Result<Value> {
    let request = verified.request(session, files, id, &request_body.replacement, false)?;
    let version = &verified.task.version;
    let plan = core::take::plan(&session.project, &request).map_err(error)?;
    Ok(
        json!({"version":1,"query":request_body.query,"source_version":version,"removed_crossings":plan.removed_crossings,"merged_keys":plan.merged_keys,"audio_stream_count":plan.audio_stream_count,"changes":plan.changes.iter().map(|change|json!({"track":change.track.to_string(),"clip_id":change.clip.0.to_string(),"previous_media_id":change.previous_media.raw().to_string(),"media_id":change.media.raw().to_string(),"start_frame":change.start_frame,"previous_length":change.previous_length,"length":change.length,"source_in":change.source_in,"source_out":change.source_out,"previous_audio_stream_index":change.previous_audio_stream_index,"audio_stream_index":change.audio_stream_index,"previous_freeze_source_frame":change.previous_freeze_source_frame,"freeze_source_frame":change.freeze_source_frame})).collect::<Vec<_>>()}),
    )
}
pub fn apply_verified(
    session: &mut Session,
    files: &Files,
    id: core::TimelineId,
    replacement: &Replacement,
    verified: &Verified,
) -> Result<()> {
    let request = verified.request(session, files, id, replacement, true)?;
    let plan = core::take::plan(&session.project, &request).map_err(error)?;
    let mut trial = Session::default();
    trial.project = session.project.clone();
    trial.apply(Box::new(plan.into_command()));
    trial.sync_timeline_media(id);
    crate::files::validate_project(&trial.project)?;
    let plan = core::take::plan(&session.project, &request).map_err(error)?;
    verified.request(session, files, id, replacement, true)?;
    session.apply(Box::new(plan.into_command()));
    session.sync_timeline_media(id);
    Ok(())
}
#[cfg(test)]
pub fn preview(
    session: &Session,
    files: &Files,
    id: core::TimelineId,
    request_body: &Preview,
) -> Result<Value> {
    let verified = Task::new(session, files, id, &request_body.replacement, false)?
        .run(&AtomicBool::new(false))?;
    preview_verified(session, files, id, request_body, &verified)
}
#[cfg(test)]
pub fn apply(
    session: &mut Session,
    files: &Files,
    id: core::TimelineId,
    replacement: &Replacement,
) -> Result<()> {
    let verified =
        Task::new(session, files, id, replacement, true)?.run(&AtomicBool::new(false))?;
    apply_verified(session, files, id, replacement, &verified)
}

#[cfg(test)]
#[path = "tests/take.rs"]
mod tests;
