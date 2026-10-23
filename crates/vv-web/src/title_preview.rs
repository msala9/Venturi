use crate::{
    error::{ApiError, Result},
    inspector::{self, InspectorEdit, TitleEdit},
    preview::{FrameQuery, FrameSnapshot, frame_size},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vv_core::Id;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub clip_ids: Vec<String>,
    pub font_family: Option<String>,
    pub font_weight: Option<u16>,
    pub italic: Option<bool>,
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
            "Title preview no longer matches the captured frame",
        ));
    }
    if request.font_family.is_none() && request.font_weight.is_none() && request.italic.is_none() {
        return Err(ApiError::invalid("Choose a title font field to preview"));
    }
    let edit = InspectorEdit::Title {
        patch: Box::new(TitleEdit {
            font_family: request.font_family.clone(),
            font_weight: request.font_weight,
            italic: request.italic,
            ..Default::default()
        }),
    };
    let mut session = vv_session::Session::default();
    session.install_project(snapshot.project, None);
    inspector::edit_selection(
        &mut session,
        snapshot.timeline,
        &request.clip_ids,
        request.query.frame,
        &edit,
    )?;
    snapshot.project = session.project;
    let tag = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(request).map_err(|_| ApiError::invalid("Invalid title preview"))?
        )
    );
    Ok((snapshot, tag))
}

#[cfg(test)]
#[path = "tests/title_preview.rs"]
mod tests;
