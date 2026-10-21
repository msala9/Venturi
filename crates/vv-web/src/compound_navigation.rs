use crate::{
    error::{ApiError, Result},
    preview::FrameQuery,
    snapshot,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashSet};
use vv_core::{Clip, ClipId, ClipSource, Id, TimelineId};
use vv_session::Session;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub action: Navigation,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Navigation {
    Enter { clip_ids: Vec<String> },
    Exit { ancestors: Vec<Ancestor> },
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ancestor {
    pub timeline_id: String,
    pub revision: String,
    #[serde(deserialize_with = "nullable_clip")]
    pub clip_id: Option<String>,
    pub entry_playhead: i64,
}
fn nullable_clip<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
fn identifier(text: &str) -> Result<u64> {
    if text.is_empty() || text.len() > 20 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::invalid(
            "Choose canonical native timeline and clip IDs",
        ));
    }
    let raw = text
        .parse::<u64>()
        .map_err(|_| ApiError::invalid("Native ID is out of range"))?;
    if raw.to_string() != text {
        return Err(ApiError::invalid(
            "Choose canonical native timeline and clip IDs",
        ));
    }
    Ok(raw)
}
fn bounded_frame(frame: i64) -> bool {
    (0..=crate::commands::MAX_FRAME).contains(&frame)
}
fn identity_text(text: &str) -> bool {
    !text.is_empty() && text.len() <= 256 && !text.chars().any(char::is_control)
}
impl Request {
    pub fn validate(&self) -> Result<()> {
        let current = identifier(&self.query.timeline_id)?;
        if !bounded_frame(self.query.frame)
            || !identity_text(&self.query.project_epoch)
            || !identity_text(&self.query.if_generation)
            || !identity_text(&self.query.revision)
        {
            return Err(ApiError::invalid(
                "Compound navigation requires bounded native frame and query identity",
            ));
        }
        match &self.action {
            Navigation::Enter { clip_ids } => {
                if clip_ids.is_empty() || clip_ids.len() > 4096 {
                    return Err(ApiError::invalid(
                        "Select between 1 and 4096 clips to enter a compound",
                    ));
                }
                let mut ids = HashSet::new();
                for clip in clip_ids {
                    if !ids.insert(identifier(clip)?) {
                        return Err(ApiError::invalid(
                            "Compound navigation clip IDs must be distinct",
                        ));
                    }
                }
            }
            Navigation::Exit { ancestors } => {
                if ancestors.is_empty() || ancestors.len() > vv_core::MAX_COMPOUND_DEPTH as usize {
                    return Err(ApiError::invalid(
                        "Choose a bounded native compound ancestor path",
                    ));
                }
                let mut ids = HashSet::from([current]);
                for ancestor in ancestors {
                    if !ids.insert(identifier(&ancestor.timeline_id)?)
                        || !identity_text(&ancestor.revision)
                        || !bounded_frame(ancestor.entry_playhead)
                    {
                        return Err(ApiError::invalid(
                            "Compound ancestors must be distinct current parents with bounded entry playheads",
                        ));
                    }
                    if let Some(clip) = &ancestor.clip_id {
                        identifier(clip)?;
                    }
                }
            }
        }
        Ok(())
    }
}
fn valid_wrapper(clip: &Clip) -> Result<()> {
    if clip.timeline_start < 0
        || clip.timeline_len <= 0
        || clip.timeline_start > crate::commands::MAX_FRAME - clip.timeline_len
        || clip.source_offset < 0
        || clip.source_offset > crate::commands::MAX_FRAME - clip.timeline_len
        || clip.rate().num <= 0
        || clip.rate().den <= 0
    {
        return Err(ApiError::invalid(
            "Compound wrapper has invalid native timing",
        ));
    }
    Ok(())
}
pub fn navigate(session: &Session, source: TimelineId, request: &Request) -> Result<Value> {
    request.validate()?;
    if source.raw() != identifier(&request.query.timeline_id)? {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    if !session.project.timelines.contains_key(source) {
        return Err(ApiError::missing());
    }
    let (target, frame, via) = match &request.action {
        Navigation::Enter { clip_ids } => {
            let timeline = &session.project.timelines[source];
            let mut selected = BTreeSet::new();
            for text in clip_ids {
                let id = ClipId(identifier(text)?);
                let (track, _) = timeline
                    .tracks
                    .iter()
                    .enumerate()
                    .find(|(_, track)| track.clips.iter().any(|clip| clip.id == id))
                    .ok_or_else(ApiError::missing)?;
                selected.insert((track, id));
            }
            let mut entry = None;
            for (track, id) in selected {
                let clip = timeline.clip(track, id).ok_or_else(ApiError::missing)?;
                let ClipSource::Media(media) = clip.source else {
                    continue;
                };
                let item = session
                    .project
                    .media_pool
                    .get(media)
                    .ok_or_else(ApiError::missing)?;
                let Some(child) = item.compound else {
                    continue;
                };
                valid_wrapper(clip)?;
                if child == source || !session.project.timelines.contains_key(child) {
                    return Err(ApiError::invalid(
                        "Compound target is missing or references its source timeline",
                    ));
                }
                if let Some((target, _, _)) = entry {
                    if target != child {
                        return Err(ApiError::invalid(
                            "Selected compounds must open the same child timeline",
                        ));
                    }
                } else {
                    let outer = request
                        .query
                        .frame
                        .clamp(clip.timeline_start, clip.timeline_end() - 1);
                    entry = Some((child, clip.picture_frame_at(outer), Some(id)));
                }
            }
            let (target, frame, via) = entry
                .ok_or_else(|| ApiError::invalid("Select a compound clip to enter its timeline"))?;
            let end = session.project.timelines[target].total_frames().max(1) - 1;
            (target, frame.clamp(0, end), via)
        }
        Navigation::Exit { ancestors } => {
            // Check the entire path before computing any fallback or inverse mapping.
            let parents = ancestors
                .iter()
                .map(|ancestor| {
                    let parent = snapshot::timeline_id(session, &ancestor.timeline_id)?;
                    if session.timeline_revision(parent) != ancestor.revision {
                        return Err(ApiError::conflict(
                            "REVISION_CONFLICT",
                            "A compound parent changed; refresh the navigation path",
                        ));
                    }
                    Ok(parent)
                })
                .collect::<Result<Vec<_>>>()?;
            let mut frame = request.query.frame;
            for (ancestor, &parent) in ancestors.iter().zip(&parents).rev() {
                let wrapper = ancestor.clip_id.as_ref().and_then(|text| {
                    let id = ClipId(text.parse().ok()?);
                    session.project.timelines[parent]
                        .tracks
                        .iter()
                        .flat_map(|track| &track.clips)
                        .find(|clip| clip.id == id)
                });
                frame = match wrapper {
                    Some(clip) if clip.freeze.is_none() => {
                        valid_wrapper(clip)?;
                        clip.timeline_frame_at(frame)
                            .clamp(clip.timeline_start, clip.timeline_end() - 1)
                    }
                    _ => ancestor.entry_playhead,
                };
            }
            (parents[0], frame, None)
        }
    };
    Ok(
        json!({"project_epoch":request.query.project_epoch,"generation":session.history.generation().to_string(),"source_timeline_id":source.raw().to_string(),"source_revision":session.timeline_revision(source),"source_frame":request.query.frame,"timeline_id":target.raw().to_string(),"revision":session.timeline_revision(target),"frame":frame,"via_clip_id":via.map(|clip|clip.0.to_string())}),
    )
}

#[cfg(test)]
#[path = "tests/compound_navigation.rs"]
mod tests;
