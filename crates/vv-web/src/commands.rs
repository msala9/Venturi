use crate::error::{ApiError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use vv_core::{
    self as core, ClipId, Command, CommandLabel, CompositeCommand, FrameIdx, Id, Timeline,
    TimelineId, TrackKind, TrimEdge, edit,
};
use vv_session::Session;

pub const MAX_FRAME: FrameIdx = 1_000_000_000;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Mutation {
    pub command_id: String,
    pub client_id: String,
    pub project_epoch: String,
    pub if_generation: String,
    pub if_revision: Option<String>,
    pub operation: Operation,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    NewProject {
        name: String,
    },
    OpenProject {
        path_token: String,
    },
    Save,
    ImportMedia {
        path_token: String,
    },
    InsertMedia {
        media_id: String,
        start_frame: FrameIdx,
    },
    SafeMove {
        moves: Vec<Move>,
    },
    Trim {
        clip_id: String,
        edge: Edge,
        frame: FrameIdx,
    },
    Split {
        clip_ids: Vec<String>,
        frame: FrameIdx,
    },
    Delete {
        clip_ids: Vec<String>,
        ripple: bool,
    },
    Undo,
    Redo,
    AddSolid {
        track: String,
        start_frame: FrameIdx,
        length_frames: FrameIdx,
    },
    AddTrack {
        audio: bool,
    },
    SetTrack {
        track: String,
        locked: Option<bool>,
        muted: Option<bool>,
        solo: Option<bool>,
    },
    SetProperties {
        clip_id: String,
        patch: crate::inspector::Properties,
    },
    SetKeyframe {
        clip_id: String,
        edit: crate::inspector::Keyframe,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Move {
    pub clip_id: String,
    pub to_track: String,
    pub to_start_frame: FrameIdx,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Edge {
    Start,
    End,
}
impl Edge {
    fn native(self) -> TrimEdge {
        match self {
            Self::Start => TrimEdge::Start,
            Self::End => TrimEdge::End,
        }
    }
}
fn clip_ref(tl: &Timeline, id: &str) -> Result<edit::ClipRef> {
    let id = ClipId(id.parse().map_err(|_| ApiError::missing())?);
    tl.tracks
        .iter()
        .enumerate()
        .find_map(|(i, t)| t.clip(id).map(|_| (i, id)))
        .ok_or_else(ApiError::missing)
}
fn track_index(tl: &Timeline, index: &str) -> Result<usize> {
    let i = index.parse::<usize>().map_err(|_| ApiError::missing())?;
    if i >= tl.tracks.len() {
        return Err(ApiError::missing());
    }
    unlocked(tl, i)?;
    Ok(i)
}
fn unlocked(tl: &Timeline, index: usize) -> Result<()> {
    if tl.tracks[index].locked {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "A selected or linked track is locked",
        ));
    }
    Ok(())
}
fn refs(tl: &Timeline, ids: &[String]) -> Result<Vec<edit::ClipRef>> {
    if ids.is_empty() || ids.len() > 4096 {
        return Err(ApiError::invalid("Select between 1 and 4096 clips"));
    }
    let mut selected = ids
        .iter()
        .map(|id| clip_ref(tl, id))
        .collect::<Result<BTreeSet<_>>>()?;
    let groups: HashSet<_> = selected
        .iter()
        .filter_map(|&(t, id)| tl.clip(t, id).and_then(|c| c.linked_group))
        .collect();
    for (i, t) in tl.tracks.iter().enumerate() {
        for clip in &t.clips {
            if clip.linked_group.is_some_and(|g| groups.contains(&g)) {
                selected.insert((i, clip.id));
            }
        }
    }
    for &(t, _) in &selected {
        unlocked(tl, t)?;
    }
    Ok(selected.into_iter().collect())
}
fn range(start: FrameIdx, len: FrameIdx) -> Result<()> {
    if start < 0 || !(1..=MAX_FRAME).contains(&len) || start > MAX_FRAME - len {
        return Err(ApiError::invalid(
            "Frame range must be positive and bounded",
        ));
    }
    Ok(())
}
fn free(
    tl: &Timeline,
    track: usize,
    start: FrameIdx,
    len: FrameIdx,
    exclude: &HashSet<ClipId>,
) -> Result<()> {
    range(start, len)?;
    if tl.tracks[track].clips.iter().any(|c| {
        !exclude.contains(&c.id) && start < c.timeline_end() && start + len > c.timeline_start
    }) {
        return Err(ApiError::conflict(
            "OVERLAP",
            "Safe edit would overwrite another clip",
        ));
    }
    Ok(())
}
pub fn apply(session: &mut Session, id: TimelineId, operation: &Operation) -> Result<()> {
    let tl = &session.project.timelines[id];
    match operation {
        Operation::SetProperties { clip_id, patch } => {
            crate::inspector::properties(session, id, clip_id, patch)?
        }
        Operation::SetKeyframe { clip_id, edit } => {
            crate::inspector::keyframe(session, id, clip_id, edit)?
        }
        Operation::InsertMedia {
            media_id,
            start_frame,
        } => {
            let raw = media_id.parse::<u64>().map_err(|_| ApiError::missing())?;
            let media = core::MediaId::from_raw(raw);
            let meta = &session
                .project
                .media_pool
                .get(media)
                .ok_or_else(ApiError::missing)?
                .meta;
            if session.project.media_pool[media].compound.is_some() {
                return Err(ApiError::invalid(
                    "Compound insertion is not implemented yet",
                ));
            }
            let out = if meta.is_image() {
                (meta.fps.as_f64() * 5.0).round() as FrameIdx
            } else {
                meta.duration_frames
            };
            range(*start_frame, out)?;
            let insert = edit::MediaInsert {
                media_id: media,
                source_in: 0,
                source_out: out,
                video: meta.has_video,
                audio: meta.has_audio,
            };
            let tracks = edit::TargetTracks {
                video: tl.first_unlocked_track_index(TrackKind::Video),
                extra_audio: tl.first_unlocked_track_index(TrackKind::Audio),
            };
            if meta.has_video && tracks.video.is_none() {
                return Err(ApiError::invalid("Add or unlock a video track first"));
            }
            let mut candidate = session.project.clone();
            let mut history = core::History::default();
            edit::insert_media(
                &mut candidate,
                &mut history,
                id,
                insert,
                *start_frame,
                tracks,
            )
            .ok_or_else(ApiError::missing)?;
            let planned = &candidate.timelines[id];
            if planned.tracks.len() > 128 {
                return Err(ApiError::invalid("Too many audio streams or tracks"));
            }
            for (index, track) in tl.tracks.iter().enumerate() {
                for clip in &track.clips {
                    if planned.clip(index, clip.id).is_none_or(|next| {
                        serde_json::to_value(next).ok() != serde_json::to_value(clip).ok()
                    }) {
                        return Err(ApiError::conflict(
                            "OVERLAP",
                            "Insertion would overwrite existing material",
                        ));
                    }
                }
            }
            for track in &planned.tracks {
                for clip in &track.clips {
                    range(clip.timeline_start, clip.timeline_len)?;
                }
            }
            edit::insert_media(
                &mut session.project,
                &mut session.history,
                id,
                insert,
                *start_frame,
                tracks,
            );
        }
        Operation::SafeMove { moves } => {
            if moves.is_empty() || moves.len() > 4096 {
                return Err(ApiError::invalid("Move between 1 and 4096 clips"));
            }
            let mut seen = HashSet::new();
            let mut plan = Vec::new();
            let mut deltas = HashMap::new();
            for m in moves {
                let (from, clip_id) = clip_ref(tl, &m.clip_id)?;
                unlocked(tl, from)?;
                if !seen.insert(clip_id) {
                    return Err(ApiError::invalid("A clip cannot be moved twice"));
                }
                let to = track_index(tl, &m.to_track)?;
                if tl.tracks[from].kind != tl.tracks[to].kind {
                    return Err(ApiError::invalid("Track types must match"));
                }
                let clip = tl.clip(from, clip_id).unwrap();
                range(m.to_start_frame, clip.timeline_len)?;
                if let Some(group) = clip.linked_group {
                    let delta = m.to_start_frame - clip.timeline_start;
                    if deltas
                        .insert(group, delta)
                        .is_some_and(|previous| previous != delta)
                    {
                        return Err(ApiError::invalid(
                            "Linked clips must move by the same frame delta",
                        ));
                    }
                }
                plan.push((clip_id, from, to, m.to_start_frame));
            }
            let expanded = refs(
                tl,
                &moves.iter().map(|m| m.clip_id.clone()).collect::<Vec<_>>(),
            )?;
            if expanded.len() != seen.len() {
                return Err(ApiError::invalid(
                    "Every linked clip must be included in the move",
                ));
            }
            for &(clip_id, from, to, start) in &plan {
                let len = tl.clip(from, clip_id).unwrap().timeline_len;
                free(tl, to, start, len, &seen)?;
                for &(other, other_from, other_to, other_start) in &plan {
                    if other != clip_id
                        && to == other_to
                        && start < other_start + tl.clip(other_from, other).unwrap().timeline_len
                        && start + len > other_start
                    {
                        return Err(ApiError::conflict(
                            "OVERLAP",
                            "Selected destinations overlap",
                        ));
                    }
                }
            }
            session.apply(Box::new(core::MoveClips::new(id, plan)));
        }
        Operation::Trim {
            clip_id,
            edge,
            frame,
        } => {
            if !(0..=MAX_FRAME).contains(frame) {
                return Err(ApiError::invalid("Invalid trim frame"));
            }
            let selected = clip_ref(tl, clip_id)?;
            let clip = tl.clip(selected.0, selected.1).unwrap();
            let original = match edge {
                Edge::Start => clip.timeline_start,
                Edge::End => clip.timeline_end(),
            };
            let delta = frame - original;
            let refs = refs(tl, std::slice::from_ref(clip_id))?;
            let exclude = refs.iter().map(|r| r.1).collect();
            let mut commands: Vec<Box<dyn Command>> = Vec::new();
            let mut ranges = Vec::new();
            for (t, clip_id) in refs {
                let clip = tl.clip(t, clip_id).unwrap();
                let value = match edge {
                    Edge::Start => clip.timeline_start,
                    Edge::End => clip.timeline_end(),
                } + delta;
                let (min, max) = edit::trim_range(&session.project, clip, edge.native());
                if !(min..=max).contains(&value) {
                    return Err(ApiError::invalid(
                        "Trim exceeds source handles or removes the clip",
                    ));
                }
                let (start, len) = match edge {
                    Edge::Start => (value, clip.timeline_end() - value),
                    Edge::End => (clip.timeline_start, value - clip.timeline_start),
                };
                free(tl, t, start, len, &exclude)?;
                if ranges.iter().any(|&(track, other_start, other_len)| {
                    track == t && start < other_start + other_len && start + len > other_start
                }) {
                    return Err(ApiError::conflict(
                        "OVERLAP",
                        "Linked trim would overlap another selected clip",
                    ));
                }
                ranges.push((t, start, len));
                commands.push(Box::new(core::TrimClip::new(
                    id,
                    t,
                    clip_id,
                    edge.native(),
                    value,
                )));
            }
            session.apply(Box::new(CompositeCommand::new(
                CommandLabel::TrimClips,
                commands,
            )));
        }
        Operation::Split { clip_ids, frame } => {
            if !(0..=MAX_FRAME).contains(frame) {
                return Err(ApiError::invalid("Invalid split frame"));
            }
            let refs = refs(tl, clip_ids)?;
            if !refs.iter().any(|&(t, id)| {
                tl.clip(t, id)
                    .is_some_and(|c| c.timeline_start < *frame && *frame < c.timeline_end())
            }) {
                return Err(ApiError::invalid("No selected clip crosses this frame"));
            }
            edit::split_clips(
                &mut session.project,
                &mut session.history,
                id,
                *frame,
                Some(&refs.into_iter().collect()),
            );
        }
        Operation::Delete { clip_ids, ripple } => {
            let refs = refs(tl, clip_ids)?;
            if *ripple {
                if tl.tracks.iter().any(|t| t.locked) {
                    return Err(ApiError::conflict(
                        "TRACK_LOCKED",
                        "Unlock all tracks before a global ripple delete",
                    ));
                }
                edit::ripple_delete_clips(&mut session.project, &mut session.history, id, &refs);
            } else {
                edit::delete_clips(&mut session.project, &mut session.history, id, &refs);
            }
        }
        Operation::Undo => {
            if session.history.position() == 0 {
                return Err(ApiError::invalid("Nothing to undo"));
            }
            session.history.undo(&mut session.project);
        }
        Operation::Redo => {
            if session.history.position() == session.history.labels().count() {
                return Err(ApiError::invalid("Nothing to redo"));
            }
            session.history.redo(&mut session.project);
        }
        Operation::AddSolid {
            track,
            start_frame,
            length_frames,
        } => {
            let t = track_index(tl, track)?;
            if tl.tracks[t].kind != TrackKind::Video {
                return Err(ApiError::invalid("Solids require a video track"));
            }
            free(tl, t, *start_frame, *length_frames, &HashSet::new())?;
            edit::insert_generator(
                &mut session.project,
                &mut session.history,
                id,
                edit::Generator::SolidColor,
                t,
                *start_frame,
                Some(*length_frames),
            );
        }
        Operation::AddTrack { audio } => {
            if tl.tracks.len() >= 128 {
                return Err(ApiError::invalid("Timeline track limit reached"));
            }
            edit::add_track(
                &mut session.project,
                &mut session.history,
                id,
                if *audio {
                    TrackKind::Audio
                } else {
                    TrackKind::Video
                },
            );
        }
        Operation::SetTrack {
            track,
            locked,
            muted,
            solo,
        } => {
            let t = track.parse::<usize>().map_err(|_| ApiError::missing())?;
            if t >= tl.tracks.len() {
                return Err(ApiError::missing());
            }
            let mut commands: Vec<Box<dyn Command>> = Vec::new();
            for (flag, value) in [
                (core::TrackFlag::Locked, locked),
                (core::TrackFlag::Muted, muted),
                (core::TrackFlag::Solo, solo),
            ] {
                if let Some(value) = value {
                    commands.push(Box::new(core::SetTrackFlag::new(id, t, flag, *value)));
                }
            }
            if commands.is_empty() {
                return Err(ApiError::invalid("Choose a track flag"));
            }
            session.apply(Box::new(CompositeCommand::new(
                CommandLabel::LockTrack,
                commands,
            )));
        }
        _ => {
            return Err(ApiError::invalid(
                "Project operations require the project command endpoint",
            ));
        }
    }
    session.sync_timeline_media(id);
    Ok(())
}

#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
