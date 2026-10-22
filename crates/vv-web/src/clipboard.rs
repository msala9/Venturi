use crate::{
    commands,
    error::{ApiError, Result},
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use vv_core::{
    self as core, Command, Id, TimelineId,
    clipboard::{ClipboardEntry, ClipboardOrigin, ClipboardPayload},
};
use vv_session::Session;

type SpeedTargets = Vec<((core::Rational, bool), Vec<core::edit::ClipRef>)>;

#[derive(Clone)]
pub struct Clipboard {
    epoch: u64,
    revision: String,
    entries: Vec<ClipboardEntry>,
    crossings: Vec<core::CrossTransition>,
    media: Vec<core::MediaId>,
    payload: ClipboardPayload,
    text: String,
}
impl Clipboard {
    pub fn revision(&self, session: &Session) -> Option<&str> {
        (self.count(session) > 0 || self.media_count() > 0).then_some(self.revision.as_str())
    }
    pub fn count(&self, _session: &Session) -> usize {
        self.entries.len()
    }
    pub fn media_count(&self) -> usize {
        self.media.len()
    }
    pub fn text(&self) -> &str {
        &self.text
    }
    pub fn is_current(&self, session: &Session) -> bool {
        self.epoch == session.epoch()
    }
    pub fn matches_payload(&self, session: &Session, payload: &ClipboardPayload) -> bool {
        self.is_current(session) && self.text == payload.to_text()
    }
    pub fn same_project_media_ids(&self, session: &Session) -> Vec<core::MediaId> {
        if self.is_current(session) {
            self.media
                .iter()
                .copied()
                .filter(|id| session.project.media_pool.contains_key(*id))
                .collect()
        } else {
            Vec::new()
        }
    }
}
#[cfg(test)]
pub fn copy(session: &Session, id: TimelineId, ids: &[String]) -> Result<Clipboard> {
    copy_with_origin(
        session,
        id,
        ids,
        ClipboardOrigin {
            instance: 0,
            epoch: session.epoch(),
        },
    )
}
pub fn copy_with_origin(
    session: &Session,
    id: TimelineId,
    ids: &[String],
    origin: ClipboardOrigin,
) -> Result<Clipboard> {
    let timeline = session
        .project
        .timelines
        .get(id)
        .ok_or_else(ApiError::missing)?;
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
    capture(session, origin, vec![], entries, crossings)
}
pub fn copy_media(session: &Session, ids: &[String], origin: ClipboardOrigin) -> Result<Clipboard> {
    if ids.is_empty() || ids.len() > 4096 {
        return Err(ApiError::invalid("Select between 1 and 4096 media items"));
    }
    let mut selected = std::collections::BTreeSet::new();
    for value in ids {
        let id = core::MediaId::from_raw(
            value
                .parse()
                .map_err(|_| ApiError::invalid("Invalid media ID"))?,
        );
        if !session.project.media_pool.contains_key(id) {
            return Err(ApiError::missing());
        }
        if !selected.insert(id) {
            return Err(ApiError::invalid("Select distinct media items"));
        }
    }
    capture(
        session,
        origin,
        selected.into_iter().collect(),
        vec![],
        vec![],
    )
}
fn capture(
    session: &Session,
    origin: ClipboardOrigin,
    media: Vec<core::MediaId>,
    entries: Vec<ClipboardEntry>,
    crossings: Vec<core::CrossTransition>,
) -> Result<Clipboard> {
    if origin.epoch != session.epoch() {
        return Err(ApiError::invalid(
            "Clipboard origin does not match the current project",
        ));
    }
    crate::asset_payload::validate_clipboard_capture(&session.project, &media, &entries)?;
    let payload = ClipboardPayload::new(origin, &session.project, &media, &entries);
    crate::asset_payload::validate_clipboard(&payload)?;
    let text = payload.to_text();
    if text.len() > 4 * 1024 * 1024 {
        return Err(ApiError::invalid(
            "Copied entities exceed the 4 MiB clipboard budget",
        ));
    }
    let bytes = serde_json::to_vec(&(&text, &crossings)).map_err(|_| ApiError::io())?;
    Ok(Clipboard {
        epoch: session.epoch(),
        revision: format!("{:x}", Sha256::digest(bytes)),
        entries,
        crossings,
        media,
        payload,
        text,
    })
}
pub fn cut(
    session: &mut Session,
    id: TimelineId,
    ids: &[String],
    revision: &str,
    clipboard: &Clipboard,
) -> Result<()> {
    if !clipboard.is_current(session) || clipboard.revision(session) != Some(revision) {
        return Err(ApiError::conflict(
            "CLIPBOARD_STALE",
            "Copy the selected clips before cutting",
        ));
    }
    let timeline = session
        .project
        .timelines
        .get(id)
        .ok_or_else(ApiError::missing)?;
    let selected = commands::copied_refs(timeline, ids)?;
    if selected
        .iter()
        .any(|(track, _)| timeline.tracks[*track].locked)
    {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "A selected or linked track is locked",
        ));
    }
    let current = copy_with_origin(session, id, ids, clipboard.payload.origin)?;
    if current.revision != clipboard.revision {
        return Err(ApiError::conflict(
            "CLIPBOARD_STALE",
            "The selected clips changed after copying",
        ));
    }
    core::edit::delete_clips(&mut session.project, &mut session.history, id, &selected);
    session.sync_timeline_media(id);
    Ok(())
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
        .filter(|_| clipboard.is_current(session))
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
    if clipboard.count(session) == 0 || !clipboard.is_current(session) {
        return Err(ApiError::conflict(
            "CLIPBOARD_STALE",
            "Prepare the retained clipboard for this project before pasting",
        ));
    }
    prepare_paste(
        session,
        clipboard.payload.clone(),
        Some(clipboard),
        Some(id),
        frame,
        false,
    )?
    .apply(session);
    Ok(())
}
#[derive(Clone)]
enum PasteSource {
    Local(Clipboard),
    Foreign(ClipboardPayload),
}
pub struct PreparedPaste {
    source: PasteSource,
    timeline: Option<TimelineId>,
    frame: i64,
    to_pool: bool,
    no_op: Option<PasteReport>,
}
#[derive(Clone)]
pub struct PasteReport {
    pub media: Vec<core::MediaId>,
    pub clips: Vec<core::ClipId>,
    pub changed: bool,
}
pub fn prepare_paste(
    session: &Session,
    payload: ClipboardPayload,
    local: Option<&Clipboard>,
    id: Option<TimelineId>,
    frame: i64,
    to_pool: bool,
) -> Result<PreparedPaste> {
    if !(0..=commands::MAX_FRAME).contains(&frame) {
        return Err(ApiError::invalid("Choose a bounded timeline frame"));
    }
    crate::asset_payload::validate_clipboard(&payload)?;
    let to_pool = to_pool || !payload.has_clips();
    if !to_pool && id.is_none() {
        return Err(ApiError::invalid("Choose a destination timeline"));
    }
    if let Some(id) = id {
        session
            .project
            .timelines
            .get(id)
            .ok_or_else(ApiError::missing)?;
    }
    let source = if let Some(local) = local.filter(|local| local.matches_payload(session, &payload))
    {
        PasteSource::Local(local.clone())
    } else {
        PasteSource::Foreign(payload)
    };
    let mut prepared = PreparedPaste {
        source,
        timeline: id,
        frame,
        to_pool,
        no_op: None,
    };
    let mut trial = session.project.clone();
    let (command, mut report) = prepared.build(&mut trial)?;
    if let Some(mut command) = command {
        command.apply(&mut trial);
    }
    crate::files::validate_project(&trial)?;
    if let PasteSource::Local(local) = &prepared.source
        && to_pool
    {
        report.media = local.same_project_media_ids(session);
    }
    if !report.changed {
        prepared.no_op = Some(report);
    }
    Ok(prepared)
}
impl PreparedPaste {
    fn build(
        &self,
        project: &mut core::Project,
    ) -> Result<(Option<Box<dyn Command>>, PasteReport)> {
        match &self.source {
            PasteSource::Local(local) if self.to_pool => Ok((
                None,
                PasteReport {
                    media: local
                        .media
                        .iter()
                        .copied()
                        .filter(|id| project.media_pool.contains_key(*id))
                        .collect(),
                    clips: vec![],
                    changed: false,
                },
            )),
            PasteSource::Local(local) => {
                let dependencies = project.clone();
                let (command, clips) = plan(
                    project,
                    &dependencies,
                    self.timeline.unwrap(),
                    &local.entries,
                    &local.crossings,
                    self.frame,
                    false,
                )?;
                Ok((
                    Some(command),
                    PasteReport {
                        media: vec![],
                        clips,
                        changed: !local.entries.is_empty(),
                    },
                ))
            }
            PasteSource::Foreign(payload) => {
                if self.to_pool && !payload.has_media() {
                    return Ok((
                        None,
                        PasteReport {
                            media: vec![],
                            clips: vec![],
                            changed: false,
                        },
                    ));
                }
                let label = if self.to_pool {
                    core::CommandLabel::PasteMedia
                } else {
                    core::CommandLabel::PasteClips
                };
                let mut additions = core::pool::AddEntities::new(label);
                let pasted = payload.clone().merge_into(project, &mut additions);
                let added = !additions.is_empty();
                let mut dependencies = project.clone();
                additions.apply(&mut dependencies);
                let mut commands: Vec<Box<dyn Command>> = vec![];
                if added {
                    commands.push(Box::new(additions));
                }
                let clips = if self.to_pool {
                    vec![]
                } else {
                    let (command, clips) = plan(
                        project,
                        &dependencies,
                        self.timeline.unwrap(),
                        &pasted.clips,
                        &[],
                        self.frame,
                        true,
                    )?;
                    if !pasted.clips.is_empty() {
                        commands.push(command);
                    }
                    clips
                };
                let changed = !commands.is_empty();
                let command = changed.then(|| {
                    Box::new(core::CompositeCommand::new(label, commands)) as Box<dyn Command>
                });
                Ok((
                    command,
                    PasteReport {
                        media: pasted.media,
                        clips,
                        changed,
                    },
                ))
            }
        }
    }
    pub fn apply(mut self, session: &mut Session) -> PasteReport {
        if let Some(report) = self.no_op.take() {
            return report;
        }
        let (command, report) = self
            .build(&mut session.project)
            .expect("A validated clipboard plan must apply to its unchanged session");
        if let Some(command) = command {
            session.apply(command);
            if !self.to_pool {
                session.sync_timeline_media(self.timeline.unwrap());
            }
        }
        report
    }
}
fn plan(
    project: &mut core::Project,
    dependencies: &core::Project,
    id: TimelineId,
    entries: &[ClipboardEntry],
    crossings: &[core::CrossTransition],
    frame: i64,
    allow_offline: bool,
) -> Result<(Box<dyn Command>, Vec<core::ClipId>)> {
    let mut layout = dependencies
        .timelines
        .get(id)
        .ok_or_else(ApiError::missing)?
        .clone();
    let mut commands: Vec<Box<dyn Command>> = vec![];
    let mut inserted = vec![];
    let mut mapped = HashMap::new();
    let mut groups: BTreeMap<u64, Vec<(usize, core::ClipId)>> = BTreeMap::new();
    for entry in entries {
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
            if !allow_offline && !dependencies.media_pool.contains_key(media) {
                return Err(ApiError::invalid(
                    "Copied media was removed from the project",
                ));
            }
            if dependencies.would_create_a_cycle(media, id) {
                return Err(ApiError::invalid(
                    "Pasting this compound would create a timeline cycle",
                ));
            }
        }
        let mut clip = entry.clip.clone();
        let original = clip.id;
        clip.id = project.alloc_clip_id();
        clip.timeline_start = entry.relative_start;
        clip.linked_group = None;
        if entry.timeline_fps != layout.fps {
            let conform_rate = match clip.source {
                core::ClipSource::Media(media) => dependencies
                    .media_pool
                    .get(media)
                    .map_or(clip.conform_rate(), |item| {
                        core::Rational::conform_rate(layout.fps, item.meta.fps)
                    }),
                core::ClipSource::SolidColor
                | core::ClipSource::Text
                | core::ClipSource::Adjustment => clip.conform_rate(),
            };
            for frames in [clip.timeline_start, clip.timeline_end(), clip.source_offset] {
                let from = entry.timeline_fps;
                let to = layout.fps;
                let den = to.den as i128 * from.num as i128;
                let num = frames as i128 * to.num as i128 * from.den as i128;
                if den <= 0
                    || num < 0
                    || (2 * num + den).div_euclid(2 * den) > commands::MAX_FRAME as i128
                {
                    return Err(ApiError::invalid(
                        "Converted clipboard frames exceed supported limits",
                    ));
                }
            }
            clip.retime(entry.timeline_fps, layout.fps, conform_rate);
        }
        clip.timeline_start += frame;
        commands::free(
            &layout,
            track,
            clip.timeline_start,
            clip.timeline_len,
            &HashSet::new(),
        )?;
        mapped.insert(original, (track, clip.id, entry.timeline_fps));
        inserted.push(clip.id);
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
    for crossing in crossings {
        let (track, left, from) = mapped[&crossing.left_clip];
        let (right_track, right, right_fps) = mapped[&crossing.right_clip];
        if track != right_track || from != right_fps {
            return Err(ApiError::invalid(
                "Copied crossing spans incompatible destination tracks",
            ));
        }
        let mut transition = crossing.transition.clone();
        transition.duration = core::convert_frames(transition.duration, from, layout.fps).max(1);
        commands.push(Box::new(core::SetCrossTransition::new(
            id,
            track,
            left,
            Some(core::CrossTransition {
                left_clip: left,
                right_clip: right,
                transition,
            }),
        )));
    }
    Ok((
        Box::new(core::CompositeCommand::new(
            core::CommandLabel::PasteClips,
            commands,
        )),
        inserted,
    ))
}

#[cfg(test)]
#[path = "tests/clipboard.rs"]
mod tests;
