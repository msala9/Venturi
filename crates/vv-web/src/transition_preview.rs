use crate::{
    error::{ApiError, Result},
    inspector::{self, TransitionSlot},
    preview::{FrameQuery, FrameSnapshot, frame_size},
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use vv_core::{Id, Transition};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub clip_id: String,
    pub slot: TransitionSlot,
    #[serde(deserialize_with = "transition")]
    pub transition: Transition,
}

fn transition<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Transition, D::Error> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Value {
        kind: vv_core::TransitionKind,
        duration: i64,
        direction: vv_core::PushDirection,
        ease: vv_core::Ease,
        curve: f32,
    }
    let value = Value::deserialize(deserializer)?;
    Ok(Transition {
        kind: value.kind,
        duration: value.duration,
        direction: value.direction,
        ease: value.ease,
        curve: value.curve,
    })
}

pub fn apply(mut snapshot: FrameSnapshot, request: &Request) -> Result<(FrameSnapshot, String)> {
    let timeline = snapshot
        .project
        .timelines
        .get(snapshot.timeline)
        .ok_or_else(ApiError::missing)?;
    if !request.query.same_composition(&snapshot.query)
        || request.query.frame != snapshot.query.frame
        || request.query.timeline_id != snapshot.timeline.raw().to_string()
        || !(0..=crate::commands::MAX_FRAME).contains(&request.query.frame)
        || !(0..timeline.total_frames().max(1)).contains(&request.query.frame)
        || snapshot.size != frame_size(timeline.resolution, request.query.width)?
    {
        return Err(ApiError::conflict(
            "STALE_PREVIEW",
            "Transition preview no longer matches the captured frame",
        ));
    }
    let mut session = vv_session::Session::default();
    session.install_project(snapshot.project, None);
    let (track, clip_id, clip) = inspector::find(&session, snapshot.timeline, &request.clip_id)?;
    let lane = &session.project.timelines[snapshot.timeline].tracks[track];
    let existing = match request.slot {
        TransitionSlot::In => clip.effects.transition_in.as_ref(),
        TransitionSlot::Out => clip.effects.transition_out.as_ref(),
        TransitionSlot::CutAfter => lane
            .crossing_from(clip_id)
            .filter(|crossing| {
                lane.clip(crossing.right_clip)
                    .is_some_and(|right| right.timeline_start == clip.timeline_end())
            })
            .map(|crossing| &crossing.transition),
    };
    let existing = existing.ok_or_else(|| {
        ApiError::conflict(
            "TRANSITION_CHANGED",
            "Choose an existing native transition to preview",
        )
    })?;
    if existing.kind != request.transition.kind {
        return Err(ApiError::invalid(
            "Transition preview must preserve the existing native kind",
        ));
    }
    inspector::transition(
        &mut session,
        snapshot.timeline,
        &request.clip_id,
        request.slot,
        &Some(request.transition.clone()),
    )?;
    snapshot.project = session.project;
    let mut digest = Sha256::new();
    digest.update(b"transition-preview:v1:");
    digest.update(
        serde_json::to_vec(request).map_err(|_| ApiError::invalid("Invalid transition preview"))?,
    );
    Ok((snapshot, format!("{:x}", digest.finalize())))
}

#[cfg(test)]
#[path = "tests/transition_preview.rs"]
mod tests;
