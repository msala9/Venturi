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
    #[serde(default)]
    pub command_epoch: Option<String>,
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
    RecoverAutosave {
        revision: String,
        name: String,
        open: bool,
    },
    SaveAs {
        name: String,
    },
    RecoverBackup {
        path_token: String,
        name: String,
    },
    NewTimeline {
        name: String,
        fps: core::Rational,
        resolution: [u32; 2],
    },
    RenameTimeline {
        name: String,
    },
    DuplicateTimeline {
        name: String,
    },
    MakeCompound {
        clip_ids: Vec<String>,
        name: String,
    },
    CopyClips {
        clip_ids: Vec<String>,
    },
    PasteClips {
        frame: FrameIdx,
    },
    PasteAttributes {
        clip_ids: Vec<String>,
        clipboard_revision: String,
        attributes: Vec<core::attributes::Attribute>,
        keyframes: core::attributes::KeyframeMode,
    },
    ImportMedia {
        path_token: String,
    },
    EditCatalog {
        edit: crate::catalog::Edit,
    },
    EditReview {
        project_token: String,
        revision: String,
        edit: crate::reviewmeta::Edit,
    },
    ImportOtio {
        path_token: String,
        name: String,
    },
    InsertMedia {
        media_id: String,
        start_frame: FrameIdx,
        source_in: Option<FrameIdx>,
        source_out: Option<FrameIdx>,
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
    RemoveSilences {
        ranges: Vec<[i64; 2]>,
    },
    PlaceRecording {
        placement: crate::recording::Placement,
    },
    ReplaceTake {
        replacement: crate::take::Replacement,
    },
    Undo,
    Redo,
    HistoryJump {
        position: usize,
    },
    AddSolid {
        track: String,
        start_frame: FrameIdx,
        length_frames: FrameIdx,
    },
    AddTrack {
        audio: bool,
    },
    RemoveTrack {
        track: String,
    },
    SetTrack {
        track: String,
        locked: Option<bool>,
        muted: Option<bool>,
        solo: Option<bool>,
        armed: Option<bool>,
    },
    SetProperties {
        clip_id: String,
        patch: Box<crate::inspector::Properties>,
    },
    SetKeyframe {
        clip_id: String,
        edit: crate::inspector::Keyframe,
    },
    SetKeyframes {
        clip_id: String,
        edits: Vec<crate::inspector::Keyframe>,
    },
    EditCurveKey {
        clip_id: String,
        edit: crate::curves::Edit,
    },
    EditCurveKeys {
        clip_id: String,
        edit: crate::curves::GroupEdit,
    },
    EditEventKey {
        clip_id: String,
        edit: crate::eventkeys::Edit,
    },
    EditEventKeys {
        clip_id: String,
        edit: crate::eventkeys::Group,
    },
    EditKeySelection {
        clip_id: String,
        edit: crate::keyselection::Edit,
    },
    ApplyGradeAtFrame {
        clip_id: String,
        frame: FrameIdx,
        values: Vec<crate::visual::GradeValue>,
    },
    ApplyGradePreset {
        clip_id: String,
        preset: String,
    },
    ApplyAttributePreset {
        clip_ids: Vec<String>,
        preset: Box<crate::presets::Preset>,
    },
    SaveAttributePreset {
        clip_ids: Vec<String>,
        options: crate::presets::Options,
    },
    ApplySavedPreset {
        clip_ids: Vec<String>,
        preset_id: String,
        revision: String,
    },
    EditPresetLibrary {
        edit: crate::preset_store::Edit,
    },
    ApplyAudioPreset {
        channel: String,
        index: usize,
        preset: String,
    },
    Slip {
        clip_ids: Vec<String>,
        delta_frames: FrameIdx,
    },
    LinkClips {
        clip_ids: Vec<String>,
        unlink: bool,
    },
    SetDisabled {
        clip_ids: Vec<String>,
        disabled: bool,
    },
    SetSpeed {
        clip_ids: Vec<String>,
        percent: f64,
        pitch_correction: bool,
        fit: SpeedFit,
    },
    SetFreeze {
        clip_ids: Vec<String>,
        frame: Option<FrameIdx>,
    },
    SetDisplayColor {
        clip_ids: Vec<String>,
        color: Option<core::ClipColor>,
    },
    SetMixer {
        channel: String,
        gain_db: Option<f32>,
        pan: Option<f32>,
    },
    EditFilter {
        clip_id: String,
        edit: crate::visual::FilterEdit,
    },
    EditMask {
        clip_id: String,
        edit: crate::masks::MaskEdit,
    },
    SetAudioEffects {
        channel: String,
        effects: Vec<core::AudioEffect>,
    },
    SetMarker {
        marker: MarkerEdit,
    },
    MoveMarker {
        marker_id: String,
        start_frame: FrameIdx,
        duration_frames: FrameIdx,
    },
    SetTransition {
        clip_id: String,
        slot: crate::inspector::TransitionSlot,
        transition: Option<core::Transition>,
    },
    AddGenerator {
        track: String,
        start_frame: FrameIdx,
        length_frames: FrameIdx,
        generator: Generator,
    },
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Generator {
    Title,
    Adjustment,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeedFit {
    KeepLength,
    Resize,
    Ripple,
}
impl SpeedFit {
    fn native(self) -> core::SpeedFit {
        match self {
            Self::KeepLength => core::SpeedFit::KeepLength,
            Self::Resize => core::SpeedFit::Resize,
            Self::Ripple => core::SpeedFit::Ripple,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarkerEdit {
    pub id: Option<String>,
    pub delete: bool,
    pub start_frame: FrameIdx,
    pub duration_frames: FrameIdx,
    pub note: String,
    pub color: core::ClipColor,
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
    let selected = copied_refs(tl, ids)?;
    for &(track, _) in &selected {
        unlocked(tl, track)?;
    }
    Ok(selected)
}
pub(crate) fn copied_refs(tl: &Timeline, ids: &[String]) -> Result<Vec<edit::ClipRef>> {
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
pub(crate) fn free(
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
pub fn history(session: &mut Session, operation: &Operation) -> Result<()> {
    let target = match operation {
        Operation::HistoryJump { position } => *position,
        Operation::Undo => session
            .history
            .position()
            .checked_sub(1)
            .ok_or_else(|| ApiError::invalid("Nothing to undo"))?,
        Operation::Redo => session.history.position() + 1,
        _ => return Err(ApiError::invalid("Choose a history operation")),
    };
    if target > session.history.labels().count() {
        return Err(ApiError::invalid(
            "History position is outside the current command history",
        ));
    }
    session.history.go_to(&mut session.project, target);
    let compounds: Vec<_> = session
        .project
        .media_pool
        .iter()
        .filter_map(|(id, m)| m.compound.map(|_| id))
        .collect();
    for media in compounds {
        session.project.sync_compound_meta(media);
    }
    Ok(())
}
pub fn apply(session: &mut Session, id: TimelineId, operation: &Operation) -> Result<()> {
    if matches!(
        operation,
        Operation::Undo | Operation::Redo | Operation::HistoryJump { .. }
    ) {
        return history(session, operation);
    }
    let tl = &session.project.timelines[id];
    match operation {
        Operation::RenameTimeline { name } | Operation::DuplicateTimeline { name } => {
            timeline_name(name)?;
            let media = session
                .project
                .media_pool
                .iter()
                .find(|(_, m)| m.compound == Some(id))
                .map(|(id, _)| id)
                .ok_or_else(ApiError::missing)?;
            if matches!(operation, Operation::DuplicateTimeline { .. }) {
                if session.project.timelines.len() >= 64 {
                    return Err(ApiError::invalid("Timeline limit reached"));
                }
                let (_, command) =
                    core::pool::duplicate_timeline(&mut session.project, media, name.clone())
                        .ok_or_else(ApiError::missing)?;
                session.apply(Box::new(command));
            } else {
                session.apply(Box::new(core::RenameTimeline::new(media, name.clone())));
            }
        }
        Operation::MakeCompound { clip_ids, name } => {
            timeline_name(name)?;
            if session.project.timelines.len() >= 64 {
                return Err(ApiError::invalid("Timeline limit reached"));
            }
            let selected = refs(tl, clip_ids)?;
            let video = selected
                .iter()
                .filter(|(t, _)| tl.tracks[*t].kind == TrackKind::Video)
                .map(|(t, _)| *t)
                .collect::<HashSet<_>>();
            let audio = selected
                .iter()
                .filter(|(t, _)| tl.tracks[*t].kind == TrackKind::Audio)
                .map(|(t, _)| *t)
                .collect::<HashSet<_>>();
            if video.len() > 1 || audio.len() > 1 {
                return Err(ApiError::invalid(
                    "This compound adapter supports one video and one audio track at a time",
                ));
            }
            if let Some(&track) = audio.iter().next()
                && selected.iter().filter(|(t, _)| *t == track).count() > 1
                && tl.tracks[track].mix.effects.iter().any(|effect| {
                    effect.enabled && matches!(effect.kind, core::AudioEffectKind::Normalize { .. })
                })
            {
                return Err(ApiError::invalid(
                    "Multiple audio clips with per-clip normalization cannot be compounded without changing their level policy",
                ));
            }
            let ids = selected.iter().map(|r| r.1).collect::<HashSet<_>>();
            let mut plan = core::plan_compound_clip(&session.project, id, &selected)
                .ok_or_else(ApiError::missing)?;
            plan.nested_timeline.name = name.clone();
            for track in [plan.video_track, plan.audio_track].into_iter().flatten() {
                free(tl, track, plan.range_start, plan.len, &ids)?;
                if tl.tracks[track]
                    .crossings
                    .iter()
                    .any(|c| ids.contains(&c.left_clip) != ids.contains(&c.right_clip))
                {
                    return Err(ApiError::invalid(
                        "Include both clips of a crossing transition in the compound selection",
                    ));
                }
            }
            let mut trial = session.project.clone();
            compound_command(&mut trial, id, &selected, &plan, name).apply(&mut trial);
            crate::files::validate_project(&trial)?;
            let command = compound_command(&mut session.project, id, &selected, &plan, name);
            session.apply(command);
        }
        Operation::SetSpeed {
            clip_ids,
            percent,
            pitch_correction,
            fit,
        } => {
            if !percent.is_finite() || !(1.0..=10_000.0).contains(percent) {
                return Err(ApiError::invalid(
                    "Choose native clip speed from 1% to 10000%",
                ));
            }
            let selected = media_refs(tl, clip_ids)?;
            checked_retime(
                session,
                id,
                Box::new(core::SetClipSpeed::new(
                    id,
                    selected,
                    core::Rational::from_percent(*percent),
                    *pitch_correction,
                    fit.native(),
                )),
            )?;
        }
        Operation::SetFreeze { clip_ids, frame } => {
            let selected = media_refs(tl, clip_ids)?;
            if frame.is_some_and(|at| !(0..=MAX_FRAME).contains(&at)) {
                return Err(ApiError::invalid("Choose a bounded timeline frame"));
            }
            checked_retime(
                session,
                id,
                Box::new(core::SetClipFreeze::new(id, selected, *frame)),
            )?;
        }
        Operation::SetDisplayColor { clip_ids, color } => {
            let selected = refs(tl, clip_ids)?;
            session.apply(Box::new(core::SetClipsDisplayColor::new(
                id, selected, *color,
            )));
        }
        Operation::SetKeyframes { clip_id, edits } => {
            crate::inspector::keyframes(session, id, clip_id, edits)?
        }
        Operation::EditCurveKey { clip_id, edit } => {
            crate::curves::edit(session, id, clip_id, edit)?
        }
        Operation::EditCurveKeys { clip_id, edit } => {
            crate::curves::edit_group(session, id, clip_id, edit)?
        }
        Operation::EditEventKey { clip_id, edit } => {
            crate::eventkeys::edit(session, id, clip_id, edit)?
        }
        Operation::EditEventKeys { clip_id, edit } => {
            crate::eventkeys::group(session, id, clip_id, edit)?
        }
        Operation::EditKeySelection { clip_id, edit } => {
            crate::keyselection::edit(session, id, clip_id, edit)?
        }
        Operation::EditFilter { clip_id, edit } => crate::visual::edit(session, id, clip_id, edit)?,
        Operation::ApplyGradePreset { clip_id, preset } => {
            crate::visual::apply_preset(session, id, clip_id, preset)?
        }
        Operation::ApplyAttributePreset { clip_ids, preset } => {
            crate::presets::apply(session, id, clip_ids, preset)?
        }
        Operation::ApplyAudioPreset {
            channel,
            index,
            preset,
        } => crate::audio::apply_preset(session, id, channel, *index, preset)?,
        Operation::ApplyGradeAtFrame {
            clip_id,
            frame,
            values,
        } => crate::visual::apply_grade_at_frame(session, id, clip_id, *frame, values)?,
        Operation::EditMask { clip_id, edit } => crate::masks::edit(session, id, clip_id, edit)?,
        Operation::SetAudioEffects { channel, effects } => {
            crate::audio::set_effects(session, id, channel, effects)?
        }
        Operation::SetMixer {
            channel,
            gain_db,
            pan,
        } => {
            let channel = crate::audio::channel(tl, channel)?;
            let mut commands: Vec<Box<dyn Command>> = vec![];
            for (param, value) in [
                (core::MixerParam::GainDb, gain_db),
                (core::MixerParam::Pan, pan),
            ] {
                if let Some(value) = value {
                    if !value.is_finite() || !param.range().contains(value) {
                        return Err(ApiError::invalid(
                            "Mixer gain or balance is outside its native range",
                        ));
                    }
                    commands.push(Box::new(core::SetMixerParam::new(
                        id, channel, param, *value,
                    )));
                }
            }
            if commands.is_empty() {
                return Err(ApiError::invalid("Choose mixer gain or balance"));
            }
            session.apply(Box::new(CompositeCommand::new(
                CommandLabel::MixerGain,
                commands,
            )));
        }
        Operation::SetTransition {
            clip_id,
            slot,
            transition,
        } => crate::inspector::transition(session, id, clip_id, *slot, transition)?,
        Operation::AddGenerator {
            track,
            start_frame,
            length_frames,
            generator,
        } => {
            let track = track_index(tl, track)?;
            if tl.tracks[track].kind != TrackKind::Video {
                return Err(ApiError::invalid("Generators require a video track"));
            }
            free(tl, track, *start_frame, *length_frames, &HashSet::new())?;
            edit::insert_generator(
                &mut session.project,
                &mut session.history,
                id,
                match generator {
                    Generator::Title => edit::Generator::Text,
                    Generator::Adjustment => edit::Generator::Adjustment,
                },
                track,
                *start_frame,
                Some(*length_frames),
            );
        }
        Operation::SetMarker { marker } => {
            let existing = marker
                .id
                .as_ref()
                .map(|raw| {
                    let key = core::MarkerId(raw.parse().map_err(|_| ApiError::missing())?);
                    tl.marker(key).ok_or_else(ApiError::missing).map(|_| key)
                })
                .transpose()?;
            if marker.delete {
                session.apply(Box::new(core::SetMarker::remove(
                    id,
                    existing.ok_or_else(|| ApiError::invalid("Select a marker to remove"))?,
                )));
            } else {
                if marker.start_frame < 0
                    || marker.duration_frames < 0
                    || marker.start_frame > MAX_FRAME - marker.duration_frames
                    || marker.note.len() > 4096
                    || (existing.is_none() && tl.markers.len() >= 4096)
                    || tl.markers.iter().any(|m| m.id.0 == u64::MAX)
                {
                    return Err(ApiError::invalid(
                        "Marker range, note or count exceeds the supported limit",
                    ));
                }
                let value = core::Marker {
                    id: existing.unwrap_or_else(|| tl.alloc_marker_id()),
                    start: marker.start_frame,
                    duration: marker.duration_frames,
                    note: marker.note.clone(),
                    color: marker.color,
                };
                session.apply(Box::new(if existing.is_some() {
                    core::SetMarker::edit(id, value)
                } else {
                    core::SetMarker::add(id, value)
                }));
            }
        }
        Operation::MoveMarker {
            marker_id,
            start_frame,
            duration_frames,
        } => {
            if *start_frame < 0
                || *duration_frames < 0
                || *duration_frames > MAX_FRAME
                || *start_frame > MAX_FRAME - *duration_frames
            {
                return Err(ApiError::invalid(
                    "Marker range exceeds the supported limit",
                ));
            }
            let key = core::MarkerId(marker_id.parse().map_err(|_| ApiError::missing())?);
            let mut marker = tl.marker(key).ok_or_else(ApiError::missing)?.clone();
            if marker.start == *start_frame && marker.duration == *duration_frames {
                return Ok(());
            }
            marker.start = *start_frame;
            marker.duration = *duration_frames;
            session.apply(Box::new(core::SetMarker::moved(id, marker)));
        }
        Operation::SetDisabled { clip_ids, disabled } => {
            let selected = refs(tl, clip_ids)?;
            session.apply(Box::new(core::SetClipsDisabled::new(
                id, selected, *disabled,
            )));
        }
        Operation::LinkClips { clip_ids, unlink } => {
            let selected = refs(tl, clip_ids)?;
            if *unlink {
                let mut groups = HashSet::new();
                let commands: Vec<Box<dyn Command>> = selected
                    .into_iter()
                    .filter_map(|(track, clip)| {
                        tl.clip(track, clip)
                            .and_then(|c| c.linked_group)
                            .filter(|group| groups.insert(*group))
                            .map(|_| {
                                Box::new(core::UnlinkClip::new(id, track, clip)) as Box<dyn Command>
                            })
                    })
                    .collect();
                if commands.is_empty() {
                    return Err(ApiError::invalid("Selected clips have no links"));
                }
                session.apply(Box::new(CompositeCommand::new(
                    CommandLabel::UnlinkClips,
                    commands,
                )));
            } else {
                if selected.len() < 2 {
                    return Err(ApiError::invalid("Select at least two clips to link"));
                }
                session.apply(Box::new(core::LinkClips::new(id, selected)));
            }
        }
        Operation::Slip {
            clip_ids,
            delta_frames,
        } => {
            if *delta_frames == 0 || !(-MAX_FRAME..=MAX_FRAME).contains(delta_frames) {
                return Err(ApiError::invalid("Choose a nonzero bounded slip delta"));
            }
            let selected = refs(tl, clip_ids)?;
            for &(track, clip) in &selected {
                let clip = tl.clip(track, clip).unwrap();
                let (min, max) = edit::slip_range(&session.project, clip)
                    .ok_or_else(|| ApiError::invalid("Selected clip has no source handles"))?;
                if !(min..=max).contains(delta_frames) {
                    return Err(ApiError::invalid(
                        "Slip exceeds a selected or linked clip source handle",
                    ));
                }
            }
            edit::slip_clips(
                &mut session.project,
                &mut session.history,
                id,
                &selected,
                *delta_frames,
            );
        }
        Operation::SetProperties { clip_id, patch } => {
            crate::inspector::properties(session, id, clip_id, patch)?
        }
        Operation::SetKeyframe { clip_id, edit } => {
            crate::inspector::keyframe(session, id, clip_id, edit)?
        }
        Operation::InsertMedia {
            media_id,
            start_frame,
            source_in,
            source_out,
        } => {
            let raw = media_id.parse::<u64>().map_err(|_| ApiError::missing())?;
            let media = core::MediaId::from_raw(raw);
            let meta = &session
                .project
                .media_pool
                .get(media)
                .ok_or_else(ApiError::missing)?
                .meta;
            if session.project.would_create_a_cycle(media, id) {
                return Err(ApiError::invalid(
                    "Compound insertion would create a timeline cycle",
                ));
            }
            let default_out = if meta.is_image() {
                (meta.fps.as_f64() * 5.0).round() as FrameIdx
            } else {
                meta.duration_frames
            };
            let source_in = source_in.unwrap_or(0);
            let out = source_out.unwrap_or(default_out);
            if source_in < 0 || out <= source_in || out > meta.duration_frames {
                return Err(ApiError::invalid(
                    "Source in/out must be a nonempty range inside the media",
                ));
            }
            range(*start_frame, 1)?;
            let insert = edit::MediaInsert {
                media_id: media,
                source_in,
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
        Operation::RemoveSilences { ranges } => crate::silence::remove_ranges(session, id, ranges)?,
        Operation::RemoveTrack { track } => {
            let index = track_index(tl, track)?;
            let removed = &tl.tracks[index];
            if removed.locked {
                return Err(ApiError::conflict(
                    "TRACK_LOCKED",
                    "Unlock the track before removing it",
                ));
            }
            if tl
                .tracks
                .iter()
                .filter(|track| track.kind == removed.kind)
                .count()
                <= 1
            {
                return Err(ApiError::invalid("Keep at least one track of each kind"));
            }
            session.apply(Box::new(core::RemoveTrack::new(id, index)));
        }
        Operation::SetTrack {
            track,
            locked,
            muted,
            solo,
            armed,
        } => {
            let t = track.parse::<usize>().map_err(|_| ApiError::missing())?;
            if t >= tl.tracks.len() {
                return Err(ApiError::missing());
            }
            if armed.is_some() && tl.tracks[t].kind != TrackKind::Audio {
                return Err(ApiError::invalid("Only audio tracks can be armed"));
            }
            if *armed == Some(true) && (tl.tracks[t].locked || session.path().is_none()) {
                return Err(ApiError::invalid(
                    "Save the project and unlock the audio track before arming it",
                ));
            }
            let mut commands: Vec<Box<dyn Command>> = Vec::new();
            for (flag, value) in [
                (core::TrackFlag::Locked, locked),
                (core::TrackFlag::Muted, muted),
                (core::TrackFlag::Solo, solo),
                (core::TrackFlag::Armed, armed),
            ] {
                if let Some(value) = value {
                    commands.push(Box::new(core::SetTrackFlag::new(id, t, flag, *value)));
                }
            }
            if commands.is_empty() {
                return Err(ApiError::invalid("Choose a track flag"));
            }
            let label = commands[0].label();
            session.apply(Box::new(CompositeCommand::new(label, commands)));
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
fn timeline_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.len() > 128 || name.chars().any(char::is_control) {
        return Err(ApiError::invalid(
            "Choose a nonempty timeline name up to 128 bytes",
        ));
    }
    Ok(())
}
fn compound_command(
    project: &mut core::Project,
    id: TimelineId,
    selected: &[edit::ClipRef],
    plan: &core::CompoundPlan,
    name: &str,
) -> Box<dyn Command> {
    let (media, mut commands) = core::compound_clip_commands(project, id, selected, plan);
    commands.push(Box::new(core::RenameTimeline::new(media, name.to_owned())));
    Box::new(CompositeCommand::new(
        CommandLabel::MakeCompoundClip,
        commands,
    ))
}

fn media_refs(tl: &Timeline, ids: &[String]) -> Result<Vec<edit::ClipRef>> {
    let selected = refs(tl, ids)?;
    if selected.iter().any(|&(track, id)| {
        !matches!(
            tl.clip(track, id).unwrap().source,
            core::ClipSource::Media(_)
        )
    }) {
        return Err(ApiError::invalid(
            "Speed and freeze require media clips, including their whole linked group",
        ));
    }
    Ok(selected)
}
fn checked_retime(
    session: &mut Session,
    id: TimelineId,
    mut command: Box<dyn Command>,
) -> Result<()> {
    let mut trial = session.project.clone();
    command.apply(&mut trial);
    for track in &trial.timelines[id].tracks {
        let mut end = 0;
        for clip in &track.clips {
            range(clip.timeline_start, clip.timeline_len)?;
            if clip.timeline_start < end {
                return Err(ApiError::conflict(
                    "OVERLAP",
                    "Speed change would overlap another clip; choose Keep length or explicit Ripple",
                ));
            }
            end = clip.timeline_end();
        }
    }
    session.apply(command);
    Ok(())
}

#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
