use crate::{
    commands::{MAX_FRAME, media_refs},
    error::{ApiError, Result},
    inspector,
};
use serde::Serialize;
use std::collections::HashSet;
use vv_core::{self as core, Command, FrameIdx, TimelineId, edit::ClipRef};
use vv_session::Session;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Metadata {
    pub source_span: FrameIdx,
    pub min_length: FrameIdx,
    pub max_length: FrameIdx,
    pub pitch_correction: bool,
}

pub fn metadata(
    project: &core::Project,
    timeline: &core::Timeline,
    clip: &core::Clip,
) -> Option<Metadata> {
    let core::ClipSource::Media(id) = clip.source else {
        return None;
    };
    let media = project.media_pool.get(id)?;
    if media.meta.duration_frames <= 0
        || media.meta.duration_frames > MAX_FRAME
        || media.meta.fps.num <= 0
        || media.meta.fps.den <= 0
        || timeline.fps.num <= 0
        || timeline.fps.den <= 0
        || clip.rate().num <= 0
        || clip.rate().den <= 0
        || clip.speed().num <= 0
        || clip.speed().den <= 0
        || clip.timeline_start < 0
        || clip.timeline_start >= MAX_FRAME
        || clip.timeline_len <= 0
        || clip.timeline_len > MAX_FRAME - clip.timeline_start
        || clip.source_offset < 0
        || clip.source_offset > MAX_FRAME - clip.timeline_len
    {
        return None;
    }
    let first = clip.source_in();
    let last = clip.source_out();
    if first < 0
        || first >= media.meta.duration_frames
        || last <= first
        || (clip.freeze.is_none() && last > media.meta.duration_frames)
    {
        return None;
    }
    let conform = core::Rational::conform_rate(timeline.fps, media.meta.fps);
    let source_span = conform
        .scale_round(last)
        .checked_sub(conform.scale_round(first))?;
    if source_span <= 0 || i32::try_from(source_span).is_err() {
        return None;
    }
    let min_length = ((source_span + 99) / 100).max(1);
    let max_length = source_span
        .checked_mul(100)?
        .min(MAX_FRAME - clip.timeline_start)
        .min(i32::MAX as i64);
    (min_length <= max_length).then_some(Metadata {
        source_span,
        min_length,
        max_length,
        pitch_correction: clip.pitch_correction,
    })
}

pub fn apply(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    end: FrameIdx,
    overwrite: bool,
) -> Result<bool> {
    let (_, _, primary) = inspector::find(session, id, raw)?;
    let timeline = &session.project.timelines[id];
    let selected = media_refs(timeline, &[raw.to_owned()])?;
    let bounds = metadata(&session.project, timeline, primary)
        .ok_or_else(|| ApiError::invalid("The clip has no bounded native speed handles"))?;
    let length = end
        .checked_sub(primary.timeline_start)
        .filter(|length| (bounds.min_length..=bounds.max_length).contains(length))
        .ok_or_else(|| ApiError::invalid("Speed handle exceeds native speed or timeline bounds"))?;
    for &(track, clip_id) in &selected {
        if metadata(
            &session.project,
            timeline,
            timeline.clip(track, clip_id).unwrap(),
        )
        .is_none()
        {
            return Err(ApiError::invalid(
                "A linked clip has unsupported source metadata",
            ));
        }
    }
    let from = primary.timeline_end();
    if end == from {
        return Ok(false);
    }
    let speed = core::Rational::new(bounds.source_span as i32, 1)
        .divided_by(core::Rational::new(length as i32, 1));
    let fit = core::SpeedFit::ResizeTo { from, to: end };
    let pitch = bounds.pitch_correction;
    let mut speed_trial = session.project.clone();
    core::SetClipSpeed::new(id, selected.clone(), speed, pitch, fit).apply(&mut speed_trial);
    let changed = &speed_trial.timelines[id];
    for &(track, clip_id) in &selected {
        let original = timeline.clip(track, clip_id).unwrap();
        let result = changed.clip(track, clip_id).unwrap();
        if original.timeline_end() == from
            && (end <= original.timeline_start || result.timeline_end() != end)
        {
            return Err(ApiError::invalid(
                "Source bounds prevent a linked speed handle endpoint",
            ));
        }
        if metadata(&speed_trial, changed, result).is_none() {
            return Err(ApiError::invalid(
                "Speed change exceeds a linked clip's representable source bounds",
            ));
        }
    }
    let grown: Vec<_> = selected
        .iter()
        .filter_map(|&(track, clip_id)| {
            core::edit::grown_range(
                timeline.clip(track, clip_id).unwrap(),
                track,
                core::TrimEdge::End,
                changed.clip(track, clip_id).unwrap().timeline_end(),
            )
        })
        .collect();
    drop(speed_trial);
    if overwrite {
        overwrite_allowed(timeline, &grown, &selected)?;
    }
    let mut trial = session.project.clone();
    build(
        &mut trial, id, &selected, &grown, speed, pitch, fit, overwrite,
    )
    .apply(&mut trial);
    validate_trial(&session.project, &trial, id)?;
    drop(trial);
    let command = build(
        &mut session.project,
        id,
        &selected,
        &grown,
        speed,
        pitch,
        fit,
        overwrite,
    );
    session.apply(command);
    Ok(true)
}

fn overwrite_allowed(
    timeline: &core::Timeline,
    ranges: &[(usize, FrameIdx, FrameIdx)],
    selected: &[ClipRef],
) -> Result<()> {
    let selected: HashSet<_> = selected.iter().copied().collect();
    for &(track, start, end) in ranges {
        for target in &timeline.tracks[track].clips {
            if selected.contains(&(track, target.id))
                || target.timeline_start >= end
                || target.timeline_end() <= start
            {
                continue;
            }
            let Some(group) = target.linked_group else {
                continue;
            };
            for (member_track, lane) in timeline.tracks.iter().enumerate() {
                for member in lane
                    .clips
                    .iter()
                    .filter(|clip| clip.linked_group == Some(group))
                {
                    if lane.locked {
                        return Err(ApiError::conflict(
                            "TRACK_LOCKED",
                            "An overwritten linked track is locked",
                        ));
                    }
                    // The native helper shares one cut across the group's involved tracks.
                    if selected.contains(&(member_track, member.id))
                        || member.timeline_start != target.timeline_start
                        || member.timeline_end() != target.timeline_end()
                        || !ranges.contains(&(member_track, start, end))
                    {
                        return Err(ApiError::conflict(
                            "LINKED_OVERWRITE",
                            "Overwrite must cover the whole aligned linked group",
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn build(
    project: &mut core::Project,
    id: TimelineId,
    selected: &[ClipRef],
    grown: &[(usize, FrameIdx, FrameIdx)],
    speed: core::Rational,
    pitch: bool,
    fit: core::SpeedFit,
    overwrite: bool,
) -> Box<dyn Command> {
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    if overwrite {
        core::make_room_for_ranges(project, id, grown, selected, &mut commands);
    }
    commands.push(Box::new(core::SetClipSpeed::new(
        id,
        selected.to_vec(),
        speed,
        pitch,
        fit,
    )));
    Box::new(core::CompositeCommand::new(
        core::CommandLabel::ClipSpeed,
        commands,
    ))
}

fn validate_trial(before: &core::Project, trial: &core::Project, id: TimelineId) -> Result<()> {
    for (index, track) in trial.timelines[id].tracks.iter().enumerate() {
        let mut end = 0;
        for clip in &track.clips {
            if clip.timeline_start < end {
                return Err(ApiError::conflict(
                    "OVERLAP",
                    "Speed handle would overwrite another clip; explicit overwrite is required",
                ));
            }
            end = clip.timeline_end();
        }
        if before.timelines[id].tracks[index].locked
            && serde_json::to_value(track).map_err(|_| ApiError::invalid("Invalid locked track"))?
                != serde_json::to_value(&before.timelines[id].tracks[index])
                    .map_err(|_| ApiError::invalid("Invalid locked track"))?
        {
            return Err(ApiError::conflict(
                "TRACK_LOCKED",
                "Speed handle would change a locked track",
            ));
        }
    }
    crate::files::validate_project(trial)
}

#[cfg(test)]
#[path = "tests/retime.rs"]
mod tests;
