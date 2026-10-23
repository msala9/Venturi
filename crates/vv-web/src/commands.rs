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
pub enum AssetDropTarget {
    Track { track_id: String },
    NewVideoTrack {},
    NewAudioTrack {},
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStreams {
    All,
    VideoOnly,
    AudioOnly,
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
    MakeNativeCompound {
        clip_ids: Vec<String>,
        name: String,
    },
    CopyClips {
        clip_ids: Vec<String>,
    },
    CopyMedia {
        media_ids: Vec<String>,
    },
    CutClips {
        clip_ids: Vec<String>,
        clipboard_revision: String,
    },
    PasteClips {
        frame: FrameIdx,
    },
    PastePreparedClipboard {
        job_id: String,
        to_pool: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
        timeline_id: Option<String>,
        timeline_revision: Option<String>,
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
    ImportPreparedMedia {
        job_id: String,
    },
    ImportPreparedProjectMedia {
        job_id: String,
    },
    RelinkPreparedMedia {
        job_id: String,
    },
    ImportClipboardImage {
        job_id: String,
        name: String,
    },
    PublishNativeAsset {
        job_id: String,
    },
    ImportNativeAsset {
        job_id: String,
        asset_id: String,
        revision: String,
    },
    PlaceNativeAssets {
        job_id: String,
        assets: Vec<crate::asset_store::ImportRef>,
        start_frame: FrameIdx,
        target: AssetDropTarget,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
    },
    EditNativeAssetLibrary {
        edit: crate::asset_store::Edit,
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
    ImportPreparedOtio {
        job_id: String,
        name: String,
        reuse_existing: bool,
    },
    InsertMedia {
        media_id: String,
        start_frame: FrameIdx,
        source_in: Option<FrameIdx>,
        source_out: Option<FrameIdx>,
    },
    PlaceSource {
        media_id: String,
        job_id: String,
        source_version: String,
        source_in: FrameIdx,
        source_out: FrameIdx,
        start_frame: FrameIdx,
        target: AssetDropTarget,
        streams: SourceStreams,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
    },
    PlaceProjectMedia {
        media_ids: Vec<String>,
        start_frame: FrameIdx,
        target: AssetDropTarget,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
    },
    SafeMove {
        moves: Vec<Move>,
    },
    MoveClips {
        new_video_tracks: usize,
        new_audio_tracks: usize,
        moves: Vec<TrackMove>,
        #[serde(default, skip_serializing_if = "is_false")]
        duplicate: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
    },
    Trim {
        clip_id: String,
        edge: Edge,
        frame: FrameIdx,
    },
    TrimGroup {
        clip_id: String,
        clip_ids: Vec<String>,
        edge: Edge,
        frame: FrameIdx,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        roll_neighbor_id: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
    },
    Split {
        clip_ids: Vec<String>,
        frame: FrameIdx,
    },
    Delete {
        clip_ids: Vec<String>,
        ripple: bool,
    },
    CloseGap {
        track: String,
        frame: FrameIdx,
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
    SetPropertiesBatch {
        clip_ids: Vec<String>,
        patch: Box<crate::inspector::Properties>,
    },
    EditInspectorSelection {
        clip_ids: Vec<String>,
        timeline_frame: FrameIdx,
        edit: crate::inspector::InspectorEdit,
    },
    EditViewerTransform {
        clip_id: String,
        timeline_frame: FrameIdx,
        transform: Vec<crate::inspector::Parameter>,
    },
    EditViewerMask {
        clip_id: String,
        index: usize,
        timeline_frame: FrameIdx,
        #[serde(default)]
        parameters: Vec<crate::masks::MaskValue>,
        path: Option<core::MaskPath>,
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
    EditAudioPresetLibrary {
        edit: crate::audio_presets::Edit,
    },
    ApplySavedAudioPreset {
        channel: String,
        index: usize,
        preset_kind: crate::audio_presets::Kind,
        name: String,
        revision: String,
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
    RetimeClip {
        clip_id: String,
        end_frame: FrameIdx,
        #[serde(default)]
        overwrite: bool,
    },
    RetimePreset {
        clip_id: String,
        percent: f64,
        #[serde(default)]
        overwrite: bool,
    },
    ContextSpeedPreset {
        clip_id: String,
        clip_ids: Vec<String>,
        percent: f64,
        #[serde(default)]
        overwrite: bool,
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
    PlaceGenerator {
        generator: crate::effect_placement::Generator,
        start_frame: FrameIdx,
        target: AssetDropTarget,
        #[serde(default, skip_serializing_if = "is_false")]
        overwrite: bool,
    },
    ApplyPaletteFilter {
        clip_id: String,
        filter: core::FilterKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preset: Option<crate::effect_placement::Preset>,
    },
}

fn is_false(value: &bool) -> bool {
    !value
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
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MoveTrack {
    Existing { track_id: String },
    New { depth: usize },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrackMove {
    pub clip_id: String,
    pub to_track: MoveTrack,
    pub to_start_frame: FrameIdx,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
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
pub(crate) fn track_index(tl: &Timeline, index: &str) -> Result<usize> {
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
        Operation::PlaceProjectMedia { .. } => {
            return Err(ApiError::conflict(
                "PROJECT_MEDIA_PLACEMENT_REQUIRED",
                "Verify the selected project sources before placing them",
            ));
        }
        Operation::PlaceSource { .. } => {
            return Err(ApiError::conflict(
                "SOURCE_PREPARATION_REQUIRED",
                "Place only the currently verified Source viewer media",
            ));
        }
        Operation::PublishNativeAsset { .. } | Operation::EditNativeAssetLibrary { .. } => {
            return Err(ApiError::invalid(
                "Native asset library writes require the native asset command endpoint",
            ));
        }
        Operation::ImportNativeAsset { .. } | Operation::PlaceNativeAssets { .. } => {
            return Err(ApiError::invalid(
                "Native asset imports require the project command endpoint",
            ));
        }
        Operation::ImportPreparedMedia { .. }
        | Operation::ImportPreparedProjectMedia { .. }
        | Operation::RelinkPreparedMedia { .. }
        | Operation::ImportClipboardImage { .. }
        | Operation::ImportPreparedOtio { .. }
        | Operation::PastePreparedClipboard { .. } => {
            return Err(ApiError::invalid(
                "Media imports require the project command endpoint",
            ));
        }
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
        Operation::MakeNativeCompound { clip_ids, name } => {
            timeline_name(name)?;
            if session.project.timelines.len() >= 64 {
                return Err(ApiError::invalid("Timeline limit reached"));
            }
            let selected = refs(tl, clip_ids)?;
            if selected.len() > 4096 {
                return Err(ApiError::invalid(
                    "Compound selection exceeds 4096 linked clips",
                ));
            }
            let mut plan = core::plan_compound_clip(&session.project, id, &selected)
                .ok_or_else(ApiError::missing)?;
            plan.nested_timeline.name = name.clone();
            let ids = selected.iter().map(|(_, clip)| *clip).collect();
            for track in [plan.video_track, plan.audio_track].into_iter().flatten() {
                free(tl, track, plan.range_start, plan.len, &ids)?;
            }
            let mut trial = session.project.clone();
            compound_command(&mut trial, id, &selected, &plan, None, name).apply(&mut trial);
            crate::files::validate_project(&trial)?;
            let command = compound_command(&mut session.project, id, &selected, &plan, None, name);
            session.apply(command);
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
            let multiple_video_tracks = video.len() > 1;
            let multiple_audio_tracks = audio.len() > 1;
            let multiple_tracks = multiple_video_tracks || multiple_audio_tracks;
            if multiple_video_tracks && video.iter().any(|&index| tl.tracks[index].muted) {
                return Err(ApiError::invalid(
                    "Multitrack video compounds require unmuted source tracks",
                ));
            }
            if multiple_audio_tracks && tl.tracks.len() >= 128 {
                return Err(ApiError::invalid("Timeline track limit reached"));
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
            let mut linear_audio = if multiple_audio_tracks {
                Some(
                    core::plan_linear_audio_compound(
                        &session.project,
                        id,
                        &selected,
                        vv_audio::mixer::PROJECT_SAMPLE_RATE,
                    )
                    .map_err(ApiError::invalid)?,
                )
            } else {
                None
            };
            let mut legacy_plan = if multiple_audio_tracks {
                None
            } else {
                Some(
                    core::plan_compound_clip(&session.project, id, &selected)
                        .ok_or_else(ApiError::missing)?,
                )
            };
            let plan = if let Some(linear) = &mut linear_audio {
                &mut linear.compound
            } else {
                legacy_plan.as_mut().unwrap()
            };
            plan.nested_timeline.name = name.clone();
            if multiple_tracks && !video.is_empty() {
                let first = *video.iter().min().unwrap();
                let last = *video.iter().max().unwrap();
                for (index, track) in tl
                    .tracks
                    .iter()
                    .enumerate()
                    .filter(|(_, track)| track.kind == TrackKind::Video)
                {
                    for clip in &track.clips {
                        if clip.timeline_start >= plan.range_start + plan.len
                            || clip.timeline_end() <= plan.range_start
                        {
                            continue;
                        }
                        if clip.is_adjustment()
                            || clip.effects.matte.is_some()
                            || ids.contains(&clip.id)
                                && clip.effects.blend_mode != core::BlendMode::Normal
                        {
                            return Err(ApiError::invalid(
                                "Multitrack compounds cannot change adjustment, matte or selected blend dependencies",
                            ));
                        }
                        if (first..=last).contains(&index) && !ids.contains(&clip.id) {
                            return Err(ApiError::conflict(
                                "OVERLAP",
                                "Include intervening video material before making a multitrack compound",
                            ));
                        }
                    }
                }
            }
            for track in [plan.video_track, plan.audio_track].into_iter().flatten() {
                if track < tl.tracks.len() {
                    free(tl, track, plan.range_start, plan.len, &ids)?;
                }
            }
            for track in video.iter().chain(audio.iter()).copied() {
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
            let plan = linear_audio
                .as_ref()
                .map(|linear| &linear.compound)
                .or(legacy_plan.as_ref())
                .unwrap();
            let mut trial = session.project.clone();
            compound_command(&mut trial, id, &selected, plan, linear_audio.as_ref(), name)
                .apply(&mut trial);
            crate::files::validate_project(&trial)?;
            let command = compound_command(
                &mut session.project,
                id,
                &selected,
                plan,
                linear_audio.as_ref(),
                name,
            );
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
        Operation::RetimeClip {
            clip_id,
            end_frame,
            overwrite,
        } => {
            if !crate::retime::apply(session, id, clip_id, *end_frame, *overwrite)? {
                return Ok(());
            }
        }
        Operation::RetimePreset {
            clip_id,
            percent,
            overwrite,
        } => {
            if !crate::retime::apply_preset(session, id, clip_id, *percent, *overwrite)? {
                return Ok(());
            }
        }
        Operation::ContextSpeedPreset {
            clip_id,
            clip_ids,
            percent,
            overwrite,
        } => {
            if !crate::retime::apply_context_preset(
                session, id, clip_id, clip_ids, *percent, *overwrite,
            )? {
                return Ok(());
            }
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
        Operation::EditViewerMask {
            clip_id,
            index,
            timeline_frame,
            parameters,
            path,
        } => crate::masks::viewer_edit(
            session,
            id,
            clip_id,
            *index,
            *timeline_frame,
            parameters,
            path.as_ref(),
        )?,
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
        } => {
            let generation = session.history.generation();
            crate::inspector::transition(session, id, clip_id, *slot, transition)?;
            if session.history.generation() == generation {
                return Ok(());
            }
        }
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
        Operation::PlaceGenerator {
            generator,
            start_frame,
            target,
            overwrite,
        } => {
            crate::effect_placement::generator(
                session,
                id,
                *generator,
                *start_frame,
                target,
                *overwrite,
            )?;
        }
        Operation::ApplyPaletteFilter {
            clip_id,
            filter,
            preset,
        } => {
            crate::effect_placement::filter(session, id, clip_id, *filter, *preset)?;
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
        Operation::SetPropertiesBatch { clip_ids, patch } => {
            let generation = session.history.generation();
            crate::inspector::properties_batch(session, id, clip_ids, patch)?;
            if session.history.generation() == generation {
                return Ok(());
            }
        }
        Operation::EditInspectorSelection {
            clip_ids,
            timeline_frame,
            edit,
        } => {
            let generation = session.history.generation();
            crate::inspector::edit_selection(session, id, clip_ids, *timeline_frame, edit)?;
            if session.history.generation() == generation {
                return Ok(());
            }
        }
        Operation::EditViewerTransform {
            clip_id,
            timeline_frame,
            transform,
        } => crate::inspector::viewer_transform(session, id, clip_id, *timeline_frame, transform)?,
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
        Operation::MoveClips { .. } => {
            let generation = session.history.generation();
            move_clips_with_selection(session, id, operation)?;
            if session.history.generation() == generation {
                return Ok(());
            }
        }
        Operation::TrimGroup { .. } => {
            if !trim_group(session, id, operation)? {
                return Ok(());
            }
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
                let mut trial = Session::default();
                trial.project = session.project.clone();
                edit::ripple_delete_clips(&mut trial.project, &mut trial.history, id, &refs);
                crate::files::validate_project(&trial.project)?;
                validate_ripple(tl, &trial.project.timelines[id])?;
                edit::ripple_delete_clips(&mut session.project, &mut session.history, id, &refs);
            } else {
                edit::delete_clips(&mut session.project, &mut session.history, id, &refs);
            }
        }
        Operation::CloseGap { track, frame } => close_gap(session, id, track, *frame)?,
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
/// The caller synchronizes timeline media after a changed native edit, as `apply` does.
pub fn move_clips_with_selection(
    session: &mut Session,
    id: TimelineId,
    operation: &Operation,
) -> Result<Vec<String>> {
    let Operation::MoveClips {
        new_video_tracks,
        new_audio_tracks,
        moves,
        duplicate,
        overwrite,
    } = operation
    else {
        return Err(ApiError::invalid(
            "Choose a native move or duplicate operation",
        ));
    };
    move_to_tracks(
        session,
        id,
        *new_video_tracks,
        *new_audio_tracks,
        moves,
        *duplicate,
        *overwrite,
    )
}
fn move_to_tracks(
    session: &mut Session,
    id: TimelineId,
    new_video_tracks: usize,
    new_audio_tracks: usize,
    moves: &[TrackMove],
    duplicate: bool,
    overwrite: bool,
) -> Result<Vec<String>> {
    let tl = &session.project.timelines[id];
    let track_count = tl.tracks.len();
    let total = track_count
        .checked_add(new_video_tracks)
        .and_then(|count| count.checked_add(new_audio_tracks));
    if moves.is_empty() || moves.len() > 4096 || total.is_none_or(|count| count > 128) {
        return Err(ApiError::invalid("Move 1 to 4096 clips within 128 tracks"));
    }
    let mut seen = HashSet::new();
    let mut deltas = HashMap::new();
    let mut plan = Vec::with_capacity(moves.len());
    let mut video_depth = 0;
    let mut audio_depth = 0;
    for movement in moves {
        if movement.clip_id.is_empty()
            || movement.clip_id.len() > 20
            || !movement.clip_id.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(ApiError::invalid(
                "Clip IDs must be unsigned decimal strings",
            ));
        }
        let (from, clip_id) = clip_ref(tl, &movement.clip_id)?;
        unlocked(tl, from)?;
        if !seen.insert(clip_id) {
            return Err(ApiError::invalid("A clip cannot be moved twice"));
        }
        let kind = tl.tracks[from].kind;
        let to = match &movement.to_track {
            MoveTrack::Existing { track_id } => {
                let to = track_index(tl, track_id)?;
                if tl.tracks[to].kind != kind {
                    return Err(ApiError::invalid("Track types must match"));
                }
                to
            }
            MoveTrack::New { depth } => {
                let (count, maximum, offset) = match kind {
                    TrackKind::Video => (new_video_tracks, &mut video_depth, track_count),
                    TrackKind::Audio => (
                        new_audio_tracks,
                        &mut audio_depth,
                        track_count + new_video_tracks,
                    ),
                };
                if *depth == 0 || *depth > count {
                    return Err(ApiError::invalid(
                        "New track depth exceeds its declared count",
                    ));
                }
                *maximum = (*maximum).max(*depth);
                offset + *depth - 1
            }
        };
        let clip = tl.clip(from, clip_id).unwrap();
        range(movement.to_start_frame, clip.timeline_len)?;
        if let Some(group) = clip.linked_group {
            let delta = movement.to_start_frame - clip.timeline_start;
            if deltas.insert(group, delta).is_some_and(|old| old != delta) {
                return Err(ApiError::invalid(
                    "Linked clips must move by the same frame delta",
                ));
            }
        }
        plan.push((clip_id, from, to, movement.to_start_frame));
    }
    if video_depth != new_video_tracks || audio_depth != new_audio_tracks {
        return Err(ApiError::invalid(
            "New track counts must match referenced depths",
        ));
    }
    let expanded = refs(
        tl,
        &moves
            .iter()
            .map(|movement| movement.clip_id.clone())
            .collect::<Vec<_>>(),
    )?;
    if expanded.len() != seen.len() {
        return Err(ApiError::invalid(
            "Every linked clip must be included in the move",
        ));
    }
    let excluded = if duplicate {
        HashSet::new()
    } else {
        seen.clone()
    };
    let mut destinations = Vec::with_capacity(plan.len());
    for &(clip_id, from, to, start) in &plan {
        let len = tl.clip(from, clip_id).unwrap().timeline_len;
        if !overwrite && to < track_count {
            free(tl, to, start, len, &excluded)?;
        }
        destinations.push((to, start, start + len));
    }
    destinations.sort_unstable();
    if destinations
        .windows(2)
        .any(|pair| pair[0].0 == pair[1].0 && pair[0].2 > pair[1].1)
    {
        return Err(ApiError::conflict(
            "OVERLAP",
            "Selected destinations overlap",
        ));
    }
    if overwrite {
        overwrite_targets(tl, &destinations, &excluded)?;
    }
    if !duplicate
        && new_video_tracks == 0
        && new_audio_tracks == 0
        && plan.iter().all(|&(clip_id, from, to, start)| {
            from == to && tl.clip(from, clip_id).unwrap().timeline_start == start
        })
    {
        return Ok(Vec::new());
    }
    // Build against the original allocator; the trial alone consumes its IDs.
    let mut trial = session.project.clone();
    let (mut command, _) = movement_command(
        &mut trial,
        id,
        new_video_tracks,
        new_audio_tracks,
        &plan,
        duplicate,
        overwrite,
    );
    command.apply(&mut trial);
    validate_edge_trial(&session.project, &trial, id, &excluded)?;
    let (command, copies) = movement_command(
        &mut session.project,
        id,
        new_video_tracks,
        new_audio_tracks,
        &plan,
        duplicate,
        overwrite,
    );
    session.apply(command);
    Ok(copies.into_iter().map(|clip| clip.0.to_string()).collect())
}
fn movement_command(
    project: &mut core::Project,
    id: TimelineId,
    video: usize,
    audio: usize,
    plan: &[(ClipId, usize, usize, FrameIdx)],
    duplicate: bool,
    overwrite: bool,
) -> (Box<dyn Command>, Vec<ClipId>) {
    let mut copied_ids = Vec::new();
    let mut commands: Vec<Box<dyn Command>> = std::iter::repeat_n(TrackKind::Video, video)
        .chain(std::iter::repeat_n(TrackKind::Audio, audio))
        .map(|kind| Box::new(core::AddTrack::new(id, kind)) as Box<dyn Command>)
        .collect();
    if duplicate {
        let copies: Vec<_> = plan
            .iter()
            .map(|&(clip_id, from, to, start)| {
                let original = project.timelines[id].clip(from, clip_id).unwrap();
                let mut clip = original.clone();
                clip.timeline_start = start;
                clip.linked_group = None;
                (to, clip, original.linked_group)
            })
            .collect();
        let copies = copies
            .into_iter()
            .map(|(track, mut clip, group)| {
                clip.id = project.alloc_clip_id();
                copied_ids.push(clip.id);
                (track, clip, group)
            })
            .collect();
        commands.extend(core::insert_overwriting(project, id, copies));
    } else {
        if overwrite {
            let ranges = plan
                .iter()
                .map(|&(clip, from, to, start)| {
                    (
                        to,
                        start,
                        start + project.timelines[id].clip(from, clip).unwrap().timeline_len,
                    )
                })
                .collect::<Vec<_>>();
            let exclude = plan
                .iter()
                .map(|&(clip, from, _, _)| (from, clip))
                .collect::<Vec<_>>();
            core::make_room_for_ranges(project, id, &ranges, &exclude, &mut commands);
        }
        commands.push(Box::new(core::MoveClips::new(id, plan.to_vec())));
    }
    (
        Box::new(CompositeCommand::new(
            if duplicate {
                CommandLabel::DuplicateClips
            } else {
                CommandLabel::MoveClips
            },
            commands,
        )),
        copied_ids,
    )
}
pub(crate) fn whole_media_out(meta: &core::MediaMeta) -> Result<FrameIdx> {
    let out = if meta.is_image() {
        (meta.fps.as_f64() * 5.0).round() as FrameIdx
    } else {
        meta.duration_frames
    };
    if meta.fps.num <= 0
        || meta.fps.den <= 0
        || !(1..=MAX_FRAME).contains(&out)
        || !meta.has_video && !meta.has_audio
        || meta.audio_stream_count() > 128
    {
        return Err(ApiError::invalid(
            "Asset media cannot be placed within native timeline bounds",
        ));
    }
    Ok(out)
}
pub(crate) struct NativeAssetPlacement {
    timeline: TimelineId,
    inserts: Vec<edit::MediaInsert>,
    target: AssetDropTarget,
    start: FrameIdx,
}
impl NativeAssetPlacement {
    fn insert(&self, project: &mut core::Project, history: &mut core::History) -> Vec<ClipId> {
        let id = self.timeline;
        let any_video = self.inserts.iter().any(|insert| insert.video);
        let any_audio = self.inserts.iter().any(|insert| insert.audio);
        let video = if !any_video {
            None
        } else if matches!(self.target, AssetDropTarget::NewVideoTrack {}) {
            Some(edit::add_track(project, history, id, TrackKind::Video))
        } else {
            let hovered = match &self.target {
                AssetDropTarget::Track { track_id } => Some(
                    track_id
                        .parse::<usize>()
                        .expect("Validated native drop track"),
                ),
                _ => None,
            };
            hovered
                .filter(|index| project.timelines[id].tracks[*index].kind == TrackKind::Video)
                .or_else(|| project.timelines[id].first_unlocked_track_index(TrackKind::Video))
                .or_else(|| Some(edit::add_track(project, history, id, TrackKind::Video)))
        };
        let extra_audio = (any_audio && matches!(self.target, AssetDropTarget::NewAudioTrack {}))
            .then(|| edit::add_track(project, history, id, TrackKind::Audio));
        let tracks = edit::TargetTracks { video, extra_audio };
        let mut cursor = self.start;
        let mut clips = Vec::new();
        for insert in &self.inserts {
            let meta = &project.media_pool[insert.media_id].meta;
            let rate = core::Rational::conform_rate(project.timelines[id].fps, meta.fps);
            let len = rate.scale_round(insert.source_out) - rate.scale_round(insert.source_in);
            clips.extend(
                edit::insert_media(project, history, id, *insert, cursor, tracks)
                    .expect("Validated native asset media")
                    .into_iter()
                    .map(|(_, clip)| clip),
            );
            cursor += len;
        }
        clips
    }
    pub(crate) fn apply(&self, session: &mut Session) -> Vec<ClipId> {
        let mark = session.history.begin_group();
        let clips = self.insert(&mut session.project, &mut session.history);
        session
            .history
            .end_group_as(mark, CommandLabel::InsertClips);
        clips
    }
}
pub(crate) fn prepare_native_asset_placement(
    project: &core::Project,
    id: TimelineId,
    selected: &[core::MediaId],
    operation: &Operation,
) -> Result<NativeAssetPlacement> {
    let Operation::PlaceNativeAssets {
        start_frame,
        target,
        overwrite,
        ..
    } = operation
    else {
        return Err(ApiError::invalid("Choose a native asset placement"));
    };
    if selected.is_empty() || selected.len() > 32 {
        return Err(ApiError::invalid("Place 1 to 32 native asset roots"));
    }
    prepare_whole_media_placement(project, id, selected, *start_frame, target, *overwrite)
}
pub(crate) fn prepare_whole_media_placement(
    project: &core::Project,
    id: TimelineId,
    selected: &[core::MediaId],
    start_frame: FrameIdx,
    target: &AssetDropTarget,
    overwrite: bool,
) -> Result<NativeAssetPlacement> {
    let timeline = project.timelines.get(id).ok_or_else(ApiError::missing)?;
    if let AssetDropTarget::Track { track_id } = target {
        track_index(timeline, track_id)?;
    }
    let mut cursor = start_frame;
    let mut inserts = Vec::new();
    for media in selected {
        let meta = &project
            .media_pool
            .get(*media)
            .ok_or_else(ApiError::missing)?
            .meta;
        let out = whole_media_out(meta)?;
        if project.would_create_a_cycle(*media, id) {
            return Err(ApiError::invalid(
                "Asset placement would create a compound cycle",
            ));
        }
        let rate = core::Rational::conform_rate(timeline.fps, meta.fps);
        let len = rate.scale_round(out);
        range(cursor, len)?;
        cursor += len;
        inserts.push(edit::MediaInsert {
            media_id: *media,
            source_in: 0,
            source_out: out,
            video: meta.has_video,
            audio: meta.has_audio,
        });
    }
    let plan = NativeAssetPlacement {
        timeline: id,
        inserts,
        target: target.clone(),
        start: start_frame,
    };
    validate_native_placement(project, &plan, overwrite)?;
    Ok(plan)
}
pub(crate) fn prepare_source_placement(
    project: &core::Project,
    id: TimelineId,
    operation: &Operation,
) -> Result<NativeAssetPlacement> {
    let Operation::PlaceSource {
        media_id,
        source_in,
        source_out,
        start_frame,
        target,
        streams,
        overwrite,
        ..
    } = operation
    else {
        return Err(ApiError::invalid("Choose a Source placement"));
    };
    let timeline = project.timelines.get(id).ok_or_else(ApiError::missing)?;
    if let AssetDropTarget::Track { track_id } = target {
        track_index(timeline, track_id)?;
    }
    let media = core::MediaId::from_raw(media_id.parse().map_err(|_| ApiError::missing())?);
    let item = project
        .media_pool
        .get(media)
        .ok_or_else(ApiError::missing)?;
    if item.compound.is_some() || project.would_create_a_cycle(media, id) {
        return Err(ApiError::invalid("Source placement requires regular media"));
    }
    let out = whole_media_out(&item.meta)?;
    if *source_in < 0 || source_out <= source_in || *source_out > out {
        return Err(ApiError::invalid(
            "Choose a nonempty marked range inside Source",
        ));
    }
    let video = item.meta.has_video && !matches!(streams, SourceStreams::AudioOnly);
    let audio = item.meta.has_audio && !matches!(streams, SourceStreams::VideoOnly);
    if !video && !audio {
        return Err(ApiError::invalid(
            "The source lacks the requested video or audio stream",
        ));
    }
    let rate = core::Rational::conform_rate(timeline.fps, item.meta.fps);
    let len = rate.scale_round(*source_out) - rate.scale_round(*source_in);
    if len < 1 {
        return Err(ApiError::invalid(
            "The marked source range must span at least one timeline frame",
        ));
    }
    range(*start_frame, len)?;
    let plan = NativeAssetPlacement {
        timeline: id,
        inserts: vec![edit::MediaInsert {
            media_id: media,
            source_in: *source_in,
            source_out: *source_out,
            video,
            audio,
        }],
        target: target.clone(),
        start: *start_frame,
    };
    validate_native_placement(project, &plan, *overwrite)?;
    Ok(plan)
}
fn validate_native_placement(
    project: &core::Project,
    plan: &NativeAssetPlacement,
    overwrite: bool,
) -> Result<()> {
    let id = plan.timeline;
    let timeline = &project.timelines[id];
    let mut trial = project.clone();
    let fresh = plan.insert(&mut trial, &mut core::History::default());
    let ranges = trial.timelines[id]
        .tracks
        .iter()
        .enumerate()
        .flat_map(|(index, track)| {
            track
                .clips
                .iter()
                .filter(|clip| fresh.contains(&clip.id))
                .map(move |clip| (index, clip.timeline_start, clip.timeline_end()))
        })
        .collect::<Vec<_>>();
    if overwrite {
        overwrite_targets(timeline, &ranges, &HashSet::new())?;
    } else {
        for (index, lane) in timeline.tracks.iter().enumerate() {
            for clip in &lane.clips {
                if trial.timelines[id]
                    .clip(index, clip.id)
                    .is_none_or(|after| {
                        serde_json::to_value(after).ok() != serde_json::to_value(clip).ok()
                    })
                {
                    return Err(ApiError::conflict(
                        "OVERLAP",
                        "Asset placement would overwrite existing material",
                    ));
                }
            }
        }
    }
    validate_edge_trial(project, &trial, id, &HashSet::new())?;
    Ok(())
}
pub(crate) fn overwrite_targets(
    timeline: &Timeline,
    ranges: &[(usize, FrameIdx, FrameIdx)],
    excluded: &HashSet<ClipId>,
) -> Result<()> {
    for &(track, start, end) in ranges {
        let Some(lane) = timeline.tracks.get(track) else {
            continue;
        };
        for target in lane.clips.iter().filter(|clip| {
            !excluded.contains(&clip.id) && clip.timeline_start < end && clip.timeline_end() > start
        }) {
            unlocked(timeline, track)?;
            let Some(group) = target.linked_group else {
                continue;
            };
            for (index, member_lane) in timeline.tracks.iter().enumerate() {
                for member in member_lane
                    .clips
                    .iter()
                    .filter(|clip| clip.linked_group == Some(group))
                {
                    unlocked(timeline, index)?;
                    if excluded.contains(&member.id)
                        || member.timeline_start >= end
                        || member.timeline_end() <= start
                        || !ranges.contains(&(index, start, end))
                    {
                        return Err(ApiError::conflict(
                            "LINKED_OVERWRITE",
                            "Overwrite must cover every affected linked member with the same interval",
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}
pub(crate) fn validate_edge_trial(
    before: &core::Project,
    trial: &core::Project,
    id: TimelineId,
    excluded: &HashSet<ClipId>,
) -> Result<()> {
    let original = &before.timelines[id];
    let result = &trial.timelines[id];
    let after: HashMap<_, _> = result
        .tracks
        .iter()
        .flat_map(|track| track.clips.iter().map(|clip| (clip.id, clip)))
        .collect();
    let mut groups = HashMap::new();
    for (index, lane) in original.tracks.iter().enumerate() {
        if lane.locked
            && serde_json::to_value(lane).map_err(|_| ApiError::io())?
                != serde_json::to_value(&result.tracks[index]).map_err(|_| ApiError::io())?
        {
            return Err(ApiError::conflict(
                "TRACK_LOCKED",
                "The edit would change a locked track",
            ));
        }
        for clip in lane
            .clips
            .iter()
            .filter(|clip| !excluded.contains(&clip.id))
        {
            if let Some(group) = clip.linked_group {
                let change = after.get(&clip.id).map(|next| {
                    (
                        next.timeline_start - clip.timeline_start,
                        next.source_offset - clip.source_offset,
                        next.timeline_len - clip.timeline_len,
                    )
                });
                if groups
                    .insert(group, change)
                    .is_some_and(|previous| previous != change)
                {
                    return Err(ApiError::conflict(
                        "LINKED_OVERWRITE",
                        "The edit would change only part of a linked group",
                    ));
                }
            }
        }
    }
    crate::files::validate_project(trial)
}
fn trim_group(session: &mut Session, id: TimelineId, operation: &Operation) -> Result<bool> {
    let Operation::TrimGroup {
        clip_id: raw,
        clip_ids: ids,
        edge,
        frame,
        roll_neighbor_id,
        overwrite,
    } = operation
    else {
        return Err(ApiError::invalid("Choose a native group trim operation"));
    };
    let (edge, frame, neighbor, overwrite) =
        (*edge, *frame, roll_neighbor_id.as_deref(), *overwrite);
    let valid_id = |raw: &str| {
        !raw.is_empty() && raw.len() <= 20 && raw.bytes().all(|byte| byte.is_ascii_digit())
    };
    if !(0..=MAX_FRAME).contains(&frame)
        || ids.is_empty()
        || ids.len() > 4096
        || !valid_id(raw)
        || neighbor.is_some_and(|raw| !valid_id(raw))
    {
        return Err(ApiError::invalid(
            "Choose 1 to 4096 clips and a bounded trim frame",
        ));
    }
    let timeline = &session.project.timelines[id];
    let primary = clip_ref(timeline, raw)?;
    unlocked(timeline, primary.0)?;
    let mut explicit = HashSet::new();
    for raw in ids {
        if raw.is_empty()
            || raw.len() > 20
            || !raw.bytes().all(|byte| byte.is_ascii_digit())
            || !explicit.insert(clip_ref(timeline, raw)?.1)
        {
            return Err(ApiError::invalid("Choose distinct unsigned clip IDs"));
        }
    }
    let mut targets = if neighbor.is_some() || !explicit.contains(&primary.1) {
        refs(timeline, std::slice::from_ref(raw))?
    } else {
        refs(timeline, ids)?
    }
    .into_iter()
    .map(|reference| (reference, edge))
    .collect::<Vec<_>>();
    if let Some(raw) = neighbor {
        let other = clip_ref(timeline, raw)?;
        let clip = timeline.clip(primary.0, primary.1).unwrap();
        let peer = timeline.clip(other.0, other.1).unwrap();
        if other.0 != primary.0
            || other == primary
            || match edge {
                Edge::Start => peer.timeline_end() != clip.timeline_start,
                Edge::End => clip.timeline_end() != peer.timeline_start,
            }
        {
            return Err(ApiError::invalid(
                "Roll requires the adjacent clip on the same track",
            ));
        }
        let opposite = match edge {
            Edge::Start => Edge::End,
            Edge::End => Edge::Start,
        };
        for reference in refs(timeline, &[raw.to_owned()])? {
            if targets.iter().any(|(selected, _)| *selected == reference) {
                return Err(ApiError::conflict(
                    "LINKED_GROUP",
                    "The two roll sides cannot share a linked group",
                ));
            }
            targets.push((reference, opposite));
        }
    }
    if targets.len() > 4096 {
        return Err(ApiError::invalid("Trim exceeds 4096 linked clips"));
    }
    let value = |clip: &core::Clip, edge| match edge {
        Edge::Start => clip.timeline_start,
        Edge::End => clip.timeline_end(),
    };
    let original = value(timeline.clip(primary.0, primary.1).unwrap(), edge);
    let (mut minimum, mut maximum) = (0, MAX_FRAME);
    for &((track, clip_id), own_edge) in &targets {
        let clip = timeline.clip(track, clip_id).unwrap();
        let offset = value(clip, own_edge) - original;
        let (mut lower, mut upper) = edit::trim_range(&session.project, clip, own_edge.native());
        lower = lower.max(0);
        upper = upper.min(MAX_FRAME);
        for &((other_track, other_id), other_edge) in &targets {
            if other_track != track || other_id == clip_id || other_edge != own_edge {
                continue;
            }
            let peer = timeline.clip(other_track, other_id).unwrap();
            match own_edge {
                Edge::End if peer.timeline_start >= clip.timeline_end() => {
                    upper = upper.min(peer.timeline_start)
                }
                Edge::Start if peer.timeline_end() <= clip.timeline_start => {
                    lower = lower.max(peer.timeline_end())
                }
                _ => {}
            }
        }
        minimum = minimum.max(lower.saturating_sub(offset));
        maximum = maximum.min(upper.saturating_sub(offset));
    }
    if minimum > maximum {
        return Err(ApiError::invalid(
            "The trim group has no common native range",
        ));
    }
    let delta = frame.clamp(minimum, maximum) - original;
    if delta == 0 {
        return Ok(false);
    }
    let excluded: HashSet<_> = targets.iter().map(|((_, clip), _)| *clip).collect();
    let mut trims = Vec::with_capacity(targets.len());
    let mut grown = Vec::new();
    for &((track, clip_id), own_edge) in &targets {
        let clip = timeline.clip(track, clip_id).unwrap();
        let next = value(clip, own_edge) + delta;
        let (start, len) = match own_edge {
            Edge::Start => (next, clip.timeline_end() - next),
            Edge::End => (clip.timeline_start, next - clip.timeline_start),
        };
        range(start, len)?;
        if !overwrite {
            free(timeline, track, start, len, &excluded)?;
        }
        if let Some(range) = edit::grown_range(clip, track, own_edge.native(), next) {
            grown.push(range);
        }
        trims.push((track, clip_id, own_edge, next));
    }
    if overwrite {
        overwrite_targets(timeline, &grown, &excluded)?;
    }
    let build = |project: &mut core::Project| {
        let mut commands: Vec<Box<dyn Command>> = Vec::new();
        if overwrite {
            let exclude = targets
                .iter()
                .map(|(reference, _)| *reference)
                .collect::<Vec<_>>();
            core::make_room_for_ranges(project, id, &grown, &exclude, &mut commands);
        }
        commands.extend(trims.iter().map(|&(track, clip, edge, frame)| {
            Box::new(core::TrimClip::new(id, track, clip, edge.native(), frame)) as Box<dyn Command>
        }));
        Box::new(CompositeCommand::new(CommandLabel::TrimClips, commands)) as Box<dyn Command>
    };
    let mut trial = session.project.clone();
    build(&mut trial).apply(&mut trial);
    validate_edge_trial(&session.project, &trial, id, &excluded)?;
    let command = build(&mut session.project);
    session.apply(command);
    Ok(true)
}
fn close_gap(session: &mut Session, id: TimelineId, track: &str, frame: FrameIdx) -> Result<()> {
    let before = &session.project.timelines[id];
    let index = track_index(before, track)?;
    if before.tracks[index].locked {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "The gap track is locked",
        ));
    }
    let (start, len) = edit::timeline_gap_at(before, index, frame)
        .ok_or_else(|| ApiError::invalid("Choose an empty leading or internal gap"))?;
    range(start, len)?;
    let mut trial = Session::default();
    trial.project = session.project.clone();
    edit::ripple_delete_gap(
        &mut trial.project,
        &mut trial.history,
        id,
        start,
        start + len,
    );
    crate::files::validate_project(&trial.project)?;
    validate_ripple(before, &trial.project.timelines[id])?;
    edit::ripple_delete_gap(
        &mut session.project,
        &mut session.history,
        id,
        start,
        start + len,
    );
    Ok(())
}
fn validate_ripple(before: &Timeline, after: &Timeline) -> Result<()> {
    let mut groups = HashMap::new();
    for (index, old_track) in before.tracks.iter().enumerate() {
        let new_track = &after.tracks[index];
        let old_clips: HashMap<_, _> = old_track.clips.iter().map(|clip| (clip.id, clip)).collect();
        let new_clips: HashMap<_, _> = new_track.clips.iter().map(|clip| (clip.id, clip)).collect();
        let new_crossings: HashSet<_> = new_track
            .crossings
            .iter()
            .map(|crossing| (crossing.left_clip, crossing.right_clip))
            .collect();
        for old in &old_track.clips {
            if let Some(group) = old.linked_group {
                let change = new_clips.get(&old.id).map(|new| {
                    (
                        new.timeline_start - old.timeline_start,
                        new.source_offset - old.source_offset,
                        new.timeline_len - old.timeline_len,
                    )
                });
                let entry = groups.entry(group).or_insert((change, false, false));
                entry.1 |= entry.0 != change;
                entry.2 |= old_track.locked;
            }
        }
        for crossing in &old_track.crossings {
            let valid_before = old_clips
                .get(&crossing.left_clip)
                .zip(old_clips.get(&crossing.right_clip))
                .is_some_and(|(left, right)| {
                    left.timeline_end() == right.timeline_start
                        && !left.is_adjustment()
                        && !right.is_adjustment()
                });
            if valid_before
                && new_crossings.contains(&(crossing.left_clip, crossing.right_clip))
                && !new_clips
                    .get(&crossing.left_clip)
                    .zip(new_clips.get(&crossing.right_clip))
                    .is_some_and(|(left, right)| left.timeline_end() == right.timeline_start)
            {
                return Err(ApiError::conflict(
                    "CROSSING_CHANGED",
                    "Ripple delete would break a crossing transition",
                ));
            }
        }
    }
    for (_, mismatch, locked) in groups.into_values() {
        if mismatch {
            return Err(ApiError::conflict(
                if locked {
                    "TRACK_LOCKED"
                } else {
                    "LINKED_GROUP"
                },
                "Ripple delete would modify only part of a linked group",
            ));
        }
    }
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
    linear_audio: Option<&core::LinearAudioCompoundPlan>,
    name: &str,
) -> Box<dyn Command> {
    let (media, mut commands) = if let Some(linear) = linear_audio {
        core::linear_audio_compound_commands(project, id, selected, linear)
    } else {
        core::compound_clip_commands(project, id, selected, plan)
    };
    commands.push(Box::new(core::RenameTimeline::new(media, name.to_owned())));
    Box::new(CompositeCommand::new(
        CommandLabel::MakeCompoundClip,
        commands,
    ))
}

pub(crate) fn media_refs(tl: &Timeline, ids: &[String]) -> Result<Vec<edit::ClipRef>> {
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
