use crate::{
    commands,
    error::{ApiError, Result},
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use vv_core::{self as core, Command, TimelineId, clipboard::ClipboardEntry};
use vv_session::Session;

type SpeedTargets = Vec<((core::Rational, bool), Vec<core::edit::ClipRef>)>;

pub struct Clipboard {
    epoch: u64,
    revision: String,
    entries: Vec<ClipboardEntry>,
    crossings: Vec<core::CrossTransition>,
}
impl Clipboard {
    pub fn revision(&self, session: &Session) -> Option<&str> {
        (self.count(session) > 0).then_some(self.revision.as_str())
    }
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
    let bytes = serde_json::to_vec(&(&entries, &crossings)).map_err(|_| ApiError::io())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(ApiError::invalid(
            "Copied clips exceed the 4 MiB clipboard budget",
        ));
    }
    Ok(Clipboard {
        epoch: session.epoch(),
        revision: format!("{:x}", Sha256::digest(bytes)),
        entries,
        crossings,
    })
}
pub fn paste_attributes(
    session: &mut Session,
    id: TimelineId,
    clipboard: &Clipboard,
    revision: &str,
    clip_ids: &[String],
    attributes: &[core::attributes::Attribute],
    mode: core::attributes::KeyframeMode,
) -> Result<()> {
    if clipboard.revision(session) != Some(revision) {
        return Err(ApiError::conflict(
            "CLIPBOARD_STALE",
            "The copied properties changed; reopen Paste properties",
        ));
    }
    let timeline = &session.project.timelines[id];
    if clipboard
        .entries
        .iter()
        .any(|entry| entry.timeline_fps != timeline.fps)
    {
        return Err(ApiError::invalid(
            "Property paste requires matching timeline FPS; use a native attribute preset for cross-format conversion",
        ));
    }
    let source_for = |kind| {
        clipboard
            .entries
            .iter()
            .find(|entry| entry.track_kind == kind)
            .map(|entry| &entry.clip)
    };
    let skip = clipboard
        .entries
        .iter()
        .map(|entry| entry.clip.id)
        .collect::<Vec<_>>();
    apply_attributes(
        session,
        id,
        clip_ids,
        AttributeSource {
            video: source_for(core::TrackKind::Video),
            audio: source_for(core::TrackKind::Audio),
            attributes,
            skip: &skip,
            mode: AttributeMode::Paste(mode),
        },
    )
}

#[derive(Clone, Copy)]
pub enum AttributeMode {
    Paste(core::attributes::KeyframeMode),
    Preset {
        format: core::attributes::TimelineFormat,
        anchor: core::attributes::KeyframeAnchor,
        append_filters: bool,
    },
}
pub struct AttributeSource<'a> {
    pub video: Option<&'a core::Clip>,
    pub audio: Option<&'a core::Clip>,
    pub attributes: &'a [core::attributes::Attribute],
    pub skip: &'a [core::ClipId],
    pub mode: AttributeMode,
}
pub fn apply_attributes(
    session: &mut Session,
    id: TimelineId,
    clip_ids: &[String],
    source: AttributeSource<'_>,
) -> Result<()> {
    use core::attributes::{Attribute, Conversion, TimelineFormat, merge};
    if source.attributes.is_empty() || source.attributes.len() > Attribute::ALL.len() {
        return Err(ApiError::invalid("Choose at least one property group"));
    }
    let selected: HashSet<_> = source.attributes.iter().copied().collect();
    if selected.len() != source.attributes.len() {
        return Err(ApiError::invalid("Choose distinct property groups"));
    }
    let timeline = &session.project.timelines[id];
    let targets = commands::copied_refs(timeline, clip_ids)?;
    if targets
        .iter()
        .any(|(track, _)| timeline.tracks[*track].locked)
    {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "A selected or linked target track is locked",
        ));
    }
    let source_for = |kind| {
        if kind == core::TrackKind::Video {
            source.video
        } else {
            source.audio
        }
    };
    let video = source_for(core::TrackKind::Video);
    let audio = source_for(core::TrackKind::Audio);
    if selected.contains(&Attribute::Speed)
        && targets
            .iter()
            .any(|(track, _)| source_for(timeline.tracks[*track].kind).is_none())
    {
        return Err(ApiError::invalid(
            "Copy both video and audio before pasting speed to linked targets",
        ));
    }
    if selected.contains(&Attribute::Speed)
        && let (Some(video), Some(audio)) = (video, audio)
        && (video.speed(), video.pitch_correction) != (audio.speed(), audio.pitch_correction)
    {
        return Err(ApiError::invalid(
            "Copied video/audio speeds differ; copy a matching linked source group",
        ));
    }
    let mut commands: Vec<Box<dyn Command>> = vec![];
    let mut speeds: SpeedTargets = vec![];
    for (track, clip_id) in targets.iter().copied() {
        let target = timeline.clip(track, clip_id).unwrap();
        if source.skip.contains(&clip_id) {
            continue;
        }
        let kind = timeline.tracks[track].kind;
        let Some(source_clip) = source_for(kind) else {
            continue;
        };
        let applicable = selected
            .iter()
            .copied()
            .filter(|attribute| match kind {
                core::TrackKind::Video => *attribute != Attribute::Volume,
                core::TrackKind::Audio => matches!(
                    attribute,
                    Attribute::Volume | Attribute::Fades | Attribute::Speed
                ),
            })
            .collect::<HashSet<_>>();
        if applicable.is_empty() {
            continue;
        }
        commands.push(Box::new(core::SetClipAttributes::new(
            id,
            track,
            clip_id,
            merge(
                source_clip,
                target,
                &applicable,
                &match source.mode {
                    AttributeMode::Paste(mode) => Conversion::paste(source_clip, target, mode),
                    AttributeMode::Preset {
                        format,
                        anchor,
                        append_filters,
                    } => Conversion::preset(
                        source_clip,
                        format,
                        target,
                        TimelineFormat {
                            fps: timeline.fps,
                            resolution: timeline.resolution,
                        },
                        anchor,
                        append_filters,
                    ),
                },
            ),
        )));
        if applicable.contains(&Attribute::Speed)
            && matches!(target.source, core::ClipSource::Media(_))
            && (target.speed(), target.pitch_correction)
                != (source_clip.speed(), source_clip.pitch_correction)
        {
            let key = (source_clip.speed(), source_clip.pitch_correction);
            match speeds.iter_mut().find(|(k, _)| *k == key) {
                Some((_, clips)) => clips.push((track, clip_id)),
                None => speeds.push((key, vec![(track, clip_id)])),
            }
        }
    }
    if commands.is_empty() {
        return Err(ApiError::invalid(
            "No selected targets can receive these copied properties",
        ));
    }
    for ((speed, pitch), clips) in speeds {
        commands.push(Box::new(core::SetClipSpeed::new(
            id,
            clips,
            speed,
            pitch,
            core::SpeedFit::Ripple,
        )));
    }
    let mut command = Box::new(core::CompositeCommand::new(
        match source.mode {
            AttributeMode::Paste(_) => core::CommandLabel::PasteAttributes,
            AttributeMode::Preset { .. } => core::CommandLabel::ApplyPreset,
        },
        commands,
    ));
    let mut trial = session.project.clone();
    command.apply(&mut trial);
    crate::files::validate_project(&trial)?;
    if matches!(source.mode, AttributeMode::Preset { .. }) {
        for (track, clip_id) in targets {
            let value = serde_json::to_value(trial.timelines[id].clip(track, clip_id).unwrap())
                .map_err(|_| ApiError::invalid("Converted preset values are invalid"))?;
            serde_json::from_value::<core::Clip>(value).map_err(|_| {
                ApiError::invalid("Converted preset values exceed the native numeric range")
            })?;
        }
    }
    let mut group_deltas = HashMap::new();
    for (track, original) in session.project.timelines[id].tracks.iter().enumerate() {
        for clip in &original.clips {
            if let Some(group) = clip.linked_group {
                let delta = trial.timelines[id]
                    .clip(track, clip.id)
                    .unwrap()
                    .timeline_start
                    - clip.timeline_start;
                if group_deltas
                    .insert(group, delta)
                    .is_some_and(|previous| previous != delta)
                {
                    return Err(ApiError::conflict(
                        "LINKED_SYNC",
                        "Ripple would move only part of a linked group; resolve its locks or placement first",
                    ));
                }
            }
        }
    }
    session.apply(command);
    session.sync_timeline_media(id);
    Ok(())
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
