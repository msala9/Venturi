use crate::{
    error::{ApiError, Result},
    inspector::{self, InspectorEdit, TitleEdit},
    masks::{self, MaskEdit, MaskPatch},
    preview::{FrameQuery, FrameSnapshot, frame_size},
    visual::FilterPatch,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vv_core::{BlurDirection, FilterKind, FontCase, Id, MaskMode};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub clip_ids: Vec<String>,
    pub choice: Choice,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Choice {
    MaskMode {
        index: usize,
        mode: MaskMode,
    },
    BlurDirection {
        filter: BlurFilter,
        direction: BlurDirection,
    },
    TitleCase {
        case: FontCase,
    },
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub enum BlurFilter {
    BoxBlur,
    GaussianBlur,
}

impl BlurFilter {
    fn native(self) -> FilterKind {
        match self {
            Self::BoxBlur => FilterKind::BoxBlur,
            Self::GaussianBlur => FilterKind::GaussianBlur,
        }
    }
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
            "Inspector preview no longer matches the captured frame",
        ));
    }
    let mut session = vv_session::Session::default();
    session.install_project(snapshot.project, None);
    match &request.choice {
        Choice::MaskMode { index, mode } => {
            if request.clip_ids.len() != 1 {
                return Err(ApiError::invalid(
                    "Mask preview requires one selected video clip",
                ));
            }
            let raw = &request.clip_ids[0];
            if raw.is_empty() || raw.len() > 20 || !raw.bytes().all(|value| value.is_ascii_digit())
            {
                return Err(ApiError::invalid("Invalid Inspector clip ID"));
            }
            masks::edit(
                &mut session,
                snapshot.timeline,
                raw,
                &MaskEdit::Set {
                    index: *index,
                    patch: MaskPatch {
                        mode: Some(*mode),
                        ..Default::default()
                    },
                },
            )?;
        }
        Choice::BlurDirection { filter, direction } => inspector::edit_selection(
            &mut session,
            snapshot.timeline,
            &request.clip_ids,
            request.query.frame,
            &InspectorEdit::Filter {
                filter: filter.native(),
                patch: Box::new(FilterPatch {
                    direction: Some(*direction),
                    ..Default::default()
                }),
            },
        )?,
        Choice::TitleCase { case } => inspector::edit_selection(
            &mut session,
            snapshot.timeline,
            &request.clip_ids,
            request.query.frame,
            &InspectorEdit::Title {
                patch: Box::new(TitleEdit {
                    case: Some(*case),
                    ..Default::default()
                }),
            },
        )?,
    }
    snapshot.project = session.project;
    let mut digest = Sha256::new();
    digest.update(b"inspector-choice-preview:v1:");
    digest.update(
        serde_json::to_vec(request).map_err(|_| ApiError::invalid("Invalid Inspector preview"))?,
    );
    Ok((snapshot, format!("{:x}", digest.finalize())))
}

#[cfg(test)]
#[path = "tests/inspector_choice_preview.rs"]
mod tests;
