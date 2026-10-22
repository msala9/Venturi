use crate::{
    error::{ApiError, Result},
    preview::FrameQuery,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashSet;
use vv_core::{ClipId, ClipSource, TimelineId, TrackKind};
use vv_session::Session;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub clip_ids: Vec<String>,
}

pub fn rows(session: &Session, id: TimelineId, frame: i64, ids: &[String]) -> Result<Vec<Value>> {
    if ids.is_empty() || ids.len() > 2048 {
        return Err(ApiError::invalid("Choose 1–2048 distinct selected clips"));
    }
    let mut selected = HashSet::new();
    for raw in ids {
        let clip = ClipId(
            raw.parse()
                .map_err(|_| ApiError::invalid("Choose native clip IDs"))?,
        );
        if !selected.insert(clip) {
            return Err(ApiError::invalid("Select each clip only once"));
        }
    }
    let mut rows = Vec::with_capacity(selected.len());
    for kind in [TrackKind::Video, TrackKind::Audio] {
        for (track_id, track) in session.project.timelines[id]
            .tracks
            .iter()
            .enumerate()
            .filter(|(_, track)| track.kind == kind)
        {
            for clip in &track.clips {
                if !selected.remove(&clip.id) {
                    continue;
                }
                let name = match clip.source {
                    ClipSource::Media(media) => session
                        .project
                        .media_pool
                        .get(media)
                        .map(|item| vv_session::file_label(&item.path))
                        .unwrap_or_else(|| "Offline media".into()),
                    ClipSource::SolidColor => "Solid color".into(),
                    ClipSource::Text => "Title".into(),
                    ClipSource::Adjustment => "Adjustment".into(),
                };
                rows.push(json!({"clip_id":clip.id.0.to_string(),"track_id":track_id.to_string(),
                    "kind":if kind == TrackKind::Video { "video" } else { "audio" },"name":name,
                    "start_frame":clip.timeline_start,"length_frames":clip.timeline_len,
                    "source_frame":clip.source_frame_at(frame.clamp(clip.timeline_start,clip.timeline_end()-1)),"locked":track.locked}));
            }
        }
    }
    if !selected.is_empty() {
        return Err(ApiError::missing());
    }
    Ok(rows)
}

#[cfg(test)]
#[path = "tests/selection.rs"]
mod tests;
