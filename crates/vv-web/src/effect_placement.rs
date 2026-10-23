use crate::{
    commands::{self, AssetDropTarget},
    error::{ApiError, Result},
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use vv_core::{self as core, Command, FrameIdx, TimelineId, TrackKind, edit};
use vv_session::Session;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Generator {
    Title,
    Solid,
    Adjustment,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum Preset {
    BlackAndWhite,
}
impl Generator {
    fn native(self) -> edit::Generator {
        match self {
            Self::Title => edit::Generator::Text,
            Self::Solid => edit::Generator::SolidColor,
            Self::Adjustment => edit::Generator::Adjustment,
        }
    }
}

fn insert(
    project: &mut core::Project,
    history: &mut core::History,
    id: TimelineId,
    generator: Generator,
    track: usize,
    append: bool,
    start: FrameIdx,
) {
    let group = history.begin_group();
    if append {
        edit::add_track(project, history, id, TrackKind::Video);
    }
    edit::insert_generator(project, history, id, generator.native(), track, start, None);
    history.end_group_as(group, core::CommandLabel::InsertClips);
}

pub(crate) fn generator(
    session: &mut Session,
    id: TimelineId,
    generator: Generator,
    start: FrameIdx,
    target: &AssetDropTarget,
    overwrite: bool,
) -> Result<()> {
    let timeline = session
        .project
        .timelines
        .get(id)
        .ok_or_else(ApiError::missing)?;
    let length = generator.native().default_len(timeline.fps);
    if length <= 0 || start < 0 || start > commands::MAX_FRAME - length {
        return Err(ApiError::invalid(
            "Generator range exceeds the timeline frame limit",
        ));
    }
    let target = match target {
        AssetDropTarget::Track { track_id } => {
            let index = commands::track_index(timeline, track_id)?;
            (timeline.tracks[index].kind == TrackKind::Video)
                .then_some(index)
                .or_else(|| timeline.first_unlocked_track_index(TrackKind::Video))
        }
        AssetDropTarget::NewVideoTrack {} => None,
        AssetDropTarget::NewAudioTrack {} => {
            return Err(ApiError::invalid("Generators cannot create an audio track"));
        }
    };
    let append = target.is_none();
    if append && timeline.tracks.len() >= 128 {
        return Err(ApiError::invalid(
            "The timeline track limit would be exceeded",
        ));
    }
    let track = target.unwrap_or(timeline.tracks.len());
    if !append {
        if overwrite {
            commands::overwrite_targets(
                timeline,
                &[(track, start, start + length)],
                &HashSet::new(),
            )?;
        } else {
            commands::free(timeline, track, start, length, &HashSet::new())?;
        }
    }
    let mut trial = session.project.clone();
    insert(
        &mut trial,
        &mut core::History::default(),
        id,
        generator,
        track,
        append,
        start,
    );
    commands::validate_edge_trial(&session.project, &trial, id, &HashSet::new())?;
    insert(
        &mut session.project,
        &mut session.history,
        id,
        generator,
        track,
        append,
        start,
    );
    Ok(())
}

pub(crate) fn filter(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    kind: core::FilterKind,
    preset: Option<Preset>,
) -> Result<()> {
    let (track, clip_id, clip) = crate::inspector::find(session, id, raw)?;
    crate::inspector::writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != TrackKind::Video {
        return Err(ApiError::invalid("Visual filters require a video clip"));
    }
    if preset.is_some() && kind != core::FilterKind::ColorCorrection {
        return Err(ApiError::invalid(
            "Choose the native BlackAndWhite palette entry",
        ));
    }
    let mut filters = clip.effects.filters.clone();
    let position = match filters.iter().position(|filter| filter.kind == kind) {
        Some(position) => position,
        None => {
            filters.push(core::ClipFilter::new(kind));
            filters.len() - 1
        }
    };
    filters[position].enabled = true;
    if preset.is_some() {
        filters[position]
            .grade
            .apply_preset(core::GradePreset::BlackAndWhite);
    }
    if serde_json::to_value(&filters).map_err(|_| ApiError::io())?
        == serde_json::to_value(&clip.effects.filters).map_err(|_| ApiError::io())?
    {
        return Ok(());
    }
    let mut trial = session.project.clone();
    core::set_clip_filters(id, track, clip_id, filters.clone()).apply(&mut trial);
    crate::files::validate_project(&trial)?;
    session.apply(Box::new(core::set_clip_filters(
        id, track, clip_id, filters,
    )));
    Ok(())
}

#[cfg(test)]
#[path = "tests/effect_placement.rs"]
mod tests;
