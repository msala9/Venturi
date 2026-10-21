use crate::{
    error::{ApiError, Result},
    files::Files,
    preview::FrameQuery,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use vv_core::{self as core, Id};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize)]
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
    pub source_version: Option<String>,
}
fn preserve_audio_streams(policy: &core::take::AudioStreamPolicy) -> bool {
    matches!(policy, core::take::AudioStreamPolicy::Preserve)
}
#[derive(Deserialize)]
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
            ApiError::invalid("Unfreeze the selected and linked clips before replacing the take")
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
    files: &Files,
    id: core::TimelineId,
    replacement: &Replacement,
    require_version: bool,
) -> Result<(core::take::Request, String)> {
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
    let file = files.media_file(&source.path)?;
    let version = crate::source::file_identity(&file)?;
    if (require_version && replacement.source_version.is_none())
        || replacement
            .source_version
            .as_ref()
            .is_some_and(|expected| expected != &version)
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Preview the current take again before replacing clips",
        ));
    }
    let name = source
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(ApiError::missing)?;
    let (_, meta, hash) = files.prepare_media(name)?;
    if crate::source::file_identity(&file)? != version
        || crate::source::file_identity(&files.media_file(&source.path)?)? != version
        || hash != source.content_hash
        || meta.fps != source.meta.fps
        || meta.duration_frames != source.meta.duration_frames
        || meta.sample_rate != source.meta.sample_rate
        || meta.channels != source.meta.channels
        || meta.audio_streams != source.meta.audio_streams
        || (meta.width, meta.height, meta.has_video, meta.has_audio)
            != (
                source.meta.width,
                source.meta.height,
                source.meta.has_video,
                source.meta.has_audio,
            )
    {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "The imported take changed; relink or import the current file explicitly",
        ));
    }
    Ok((
        core::take::Request {
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
        },
        version,
    ))
}
pub fn preview(
    session: &Session,
    files: &Files,
    id: core::TimelineId,
    request_body: &Preview,
) -> Result<Value> {
    let (request, version) = request(session, files, id, &request_body.replacement, false)?;
    let plan = core::take::plan(&session.project, &request).map_err(error)?;
    Ok(
        json!({"version":1,"query":request_body.query,"source_version":version,"removed_crossings":plan.removed_crossings,"merged_keys":plan.merged_keys,"audio_stream_count":plan.audio_stream_count,"changes":plan.changes.iter().map(|change|json!({"track":change.track.to_string(),"clip_id":change.clip.0.to_string(),"previous_media_id":change.previous_media.raw().to_string(),"media_id":change.media.raw().to_string(),"start_frame":change.start_frame,"previous_length":change.previous_length,"length":change.length,"source_in":change.source_in,"source_out":change.source_out,"previous_audio_stream_index":change.previous_audio_stream_index,"audio_stream_index":change.audio_stream_index})).collect::<Vec<_>>()}),
    )
}
pub fn apply(
    session: &mut Session,
    files: &Files,
    id: core::TimelineId,
    replacement: &Replacement,
) -> Result<()> {
    let (request, _) = request(session, files, id, replacement, true)?;
    let plan = core::take::plan(&session.project, &request).map_err(error)?;
    let mut trial = Session::default();
    trial.project = session.project.clone();
    trial.apply(Box::new(plan.into_command()));
    trial.sync_timeline_media(id);
    crate::files::validate_project(&trial.project)?;
    let plan = core::take::plan(&session.project, &request).map_err(error)?;
    session.apply(Box::new(plan.into_command()));
    session.sync_timeline_media(id);
    Ok(())
}

#[cfg(test)]
#[path = "tests/take.rs"]
mod tests;
