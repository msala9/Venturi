use crate::{
    commands,
    error::{ApiError, Result},
};
use std::collections::{BTreeMap, HashMap, HashSet};
use vv_core::{self as core, Command, TimelineId, clipboard::ClipboardEntry};
use vv_session::Session;

pub struct Clipboard {
    epoch: u64,
    entries: Vec<ClipboardEntry>,
    crossings: Vec<core::CrossTransition>,
}
impl Clipboard {
    pub fn count(&self, session: &Session) -> usize {
        if self.epoch == session.epoch() {
            self.entries.len()
        } else {
            0
        }
    }
}
pub fn copy(session: &Session, id: TimelineId, ids: &[String]) -> Result<Clipboard> {
    let timeline = &session.project.timelines[id];
    let selected = commands::copied_refs(timeline, ids)?;
    let anchor = selected
        .iter()
        .map(|&(track, id)| timeline.clip(track, id).unwrap().timeline_start)
        .min()
        .unwrap();
    let entries = selected
        .iter()
        .map(|&(track, id)| {
            let clip = timeline.clip(track, id).unwrap();
            ClipboardEntry {
                track_kind: timeline.tracks[track].kind,
                track_number: timeline.track_number(track),
                relative_start: clip.timeline_start - anchor,
                clip: clip.clone(),
                timeline_fps: timeline.fps,
                link_tag: clip.linked_group.map(|g| g.0),
            }
        })
        .collect::<Vec<_>>();
    let ids = selected.iter().map(|r| r.1).collect::<HashSet<_>>();
    let crossings = timeline
        .tracks
        .iter()
        .flat_map(|t| &t.crossings)
        .filter(|c| ids.contains(&c.left_clip) && ids.contains(&c.right_clip))
        .cloned()
        .collect::<Vec<_>>();
    if serde_json::to_vec(&(&entries, &crossings))
        .map_err(|_| ApiError::io())?
        .len()
        > 4 * 1024 * 1024
    {
        return Err(ApiError::invalid(
            "Copied clips exceed the 4 MiB clipboard budget",
        ));
    }
    Ok(Clipboard {
        epoch: session.epoch(),
        entries,
        crossings,
    })
}
pub fn paste(
    session: &mut Session,
    id: TimelineId,
    clipboard: &Clipboard,
    frame: i64,
) -> Result<()> {
    if clipboard.count(session) == 0 {
        return Err(ApiError::conflict(
            "CLIPBOARD_STALE",
            "Copy clips from the current project first",
        ));
    }
    if !(0..=commands::MAX_FRAME).contains(&frame) {
        return Err(ApiError::invalid("Choose a bounded timeline frame"));
    }
    let fps = session.project.timelines[id].fps;
    if clipboard
        .entries
        .iter()
        .any(|entry| entry.timeline_fps != fps)
    {
        return Err(ApiError::invalid(
            "Clip paste currently requires matching timeline FPS; media insertion supports native FPS conformance",
        ));
    }
    let mut trial = session.project.clone();
    let mut command = plan(&mut trial, id, clipboard, frame)?;
    command.apply(&mut trial);
    crate::files::validate_project(&trial)?;
    let command = plan(&mut session.project, id, clipboard, frame)?;
    session.apply(command);
    session.sync_timeline_media(id);
    Ok(())
}
fn plan(
    project: &mut core::Project,
    id: TimelineId,
    clipboard: &Clipboard,
    frame: i64,
) -> Result<Box<dyn Command>> {
    let mut layout = project.timelines[id].clone();
    let mut commands: Vec<Box<dyn Command>> = vec![];
    let mut mapped = HashMap::new();
    let mut groups: BTreeMap<u64, Vec<(usize, core::ClipId)>> = BTreeMap::new();
    for entry in &clipboard.entries {
        while layout
            .track_of_kind_numbered(entry.track_kind, entry.track_number)
            .is_none()
        {
            if layout.tracks.len() >= 128 {
                return Err(ApiError::invalid(
                    "Pasting these clips would exceed the track limit",
                ));
            }
            layout.tracks.push(core::Track::new(entry.track_kind));
            commands.push(Box::new(core::AddTrack::new(id, entry.track_kind)));
        }
        let track = layout
            .track_of_kind_numbered(entry.track_kind, entry.track_number)
            .unwrap();
        if layout.tracks[track].locked {
            return Err(ApiError::conflict(
                "TRACK_LOCKED",
                "A destination track is locked",
            ));
        }
        if let core::ClipSource::Media(media) = entry.clip.source {
            if !project.media_pool.contains_key(media) {
                return Err(ApiError::invalid(
                    "Copied media was removed from the project",
                ));
            }
            if project.would_create_a_cycle(media, id) {
                return Err(ApiError::invalid(
                    "Pasting this compound would create a timeline cycle",
                ));
            }
        }
        let mut clip = entry.clip.clone();
        let original = clip.id;
        clip.id = project.alloc_clip_id();
        clip.timeline_start = frame + entry.relative_start;
        clip.linked_group = None;
        commands::free(
            &layout,
            track,
            clip.timeline_start,
            clip.timeline_len,
            &HashSet::new(),
        )?;
        mapped.insert(original, (track, clip.id));
        if let Some(group) = entry.link_tag {
            groups.entry(group).or_default().push((track, clip.id));
        }
        layout.tracks[track].insert_sorted(clip.clone());
        commands.push(Box::new(core::InsertClip {
            timeline: id,
            track_index: track,
            clip,
        }));
    }
    for members in groups.into_values().filter(|members| members.len() > 1) {
        commands.push(Box::new(core::LinkClips::new(id, members)));
    }
    for crossing in &clipboard.crossings {
        let (track, left) = mapped[&crossing.left_clip];
        let (right_track, right) = mapped[&crossing.right_clip];
        if track != right_track {
            return Err(ApiError::invalid(
                "Copied crossing spans incompatible destination tracks",
            ));
        }
        commands.push(Box::new(core::SetCrossTransition::new(
            id,
            track,
            left,
            Some(core::CrossTransition {
                left_clip: left,
                right_clip: right,
                transition: crossing.transition.clone(),
            }),
        )));
    }
    Ok(Box::new(core::CompositeCommand::new(
        core::CommandLabel::PasteClips,
        commands,
    )))
}

#[cfg(test)]
#[path = "tests/clipboard.rs"]
mod tests;
