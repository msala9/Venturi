use crate::{
    error::{ApiError, Result},
    inspector::{self, Keyframe, Target},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use vv_core::{self as core, Clip, Keyframed, TimelineId};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub target: Target,
    pub previous_source_frame: Option<i64>,
    pub source_frame: i64,
    pub value: Option<f32>,
    pub interpolation: core::Interpolation,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GroupEdit {
    pub target: Target,
    pub source_frames: Vec<i64>,
    pub delta_source_frames: i64,
    pub delta_value: f32,
    pub delete: bool,
}

struct Curve<'a> {
    target: Target,
    name: String,
    track: &'a Keyframed<f32>,
    bounds: (f32, f32),
}

fn curves<'a>(session: &Session, id: TimelineId, clip: &'a Clip, lane: usize) -> Vec<Curve<'a>> {
    let mut result = Vec::new();
    let mut add = |target, name, track, bounds| {
        result.push(Curve {
            target,
            name,
            track,
            bounds,
        })
    };
    if session.project.timelines[id].tracks[lane].kind == core::TrackKind::Audio {
        add(
            Target::Gain,
            "Gain dB".into(),
            &clip.effects.gain_db,
            (core::GAIN_DB_MIN, core::GAIN_DB_MAX),
        );
        return result;
    }
    let size = if let core::ClipSource::Media(media) = clip.source {
        session
            .project
            .media_pool
            .get(media)
            .map(|m| (m.meta.width, m.meta.height))
    } else {
        None
    }
    .unwrap_or(session.project.timelines[id].resolution);
    for param in core::TransformParam::ALL {
        add(
            Target::Transform { param },
            format!("Transform · {param:?}"),
            clip.effects.transform.track(param),
            inspector::limits(param, size),
        );
    }
    for filter in &clip.effects.filters {
        let kind = filter.kind;
        if kind == core::FilterKind::ColorCorrection {
            for param in core::GradeParam::ALL {
                let range = param.range();
                add(
                    Target::Grade { param },
                    format!("Grade · {param:?}"),
                    filter.grade.track(param),
                    (*range.start(), *range.end()),
                );
            }
        }
        if kind.is_blur() || kind == core::FilterKind::DropShadow {
            add(
                Target::FilterRadius { filter: kind },
                format!("{kind:?} · Radius"),
                &filter.radius,
                (0.0, core::BLUR_RADIUS_MAX),
            );
        }
        if let Ok(bounds) = crate::visual::amount_range(kind) {
            add(
                Target::FilterAmount { filter: kind },
                format!("{kind:?} · Amount"),
                &filter.amount,
                bounds,
            );
        }
        if kind == core::FilterKind::DropShadow {
            add(
                Target::FilterGrow { filter: kind },
                "Shadow · Grow".into(),
                &filter.grow,
                (0.0, core::SHADOW_GROW_MAX),
            );
            for axis in 0..2 {
                add(
                    Target::FilterOffset { filter: kind, axis },
                    format!("Shadow · Offset {}", if axis == 0 { "X" } else { "Y" }),
                    &filter.offset[axis],
                    (-8192.0, 8192.0),
                );
            }
        }
    }
    for (index, mask) in clip.effects.masks.iter().enumerate() {
        for param in core::MaskParam::ALL
            .into_iter()
            .filter(|p| p.applies_to(mask.shape))
        {
            add(
                Target::Mask { index, param },
                format!("Mask {} · {param:?}", index + 1),
                mask.track(param),
                crate::masks::limits(param),
            );
        }
    }
    result
}

pub fn detail(session: &Session, id: TimelineId, clip: &Clip, lane: usize) -> Value {
    let start = clip.source_frame_at(clip.timeline_start);
    let end = clip.source_frame_at(clip.timeline_end() - 1);
    let entries: Vec<_> = curves(session, id, clip, lane).into_iter().map(|curve| {
        let mut frames = BTreeSet::from([start, end]);
        if !curve.track.keyframes().is_empty() {
            for index in 0..=256i128 {
                frames.insert((i128::from(start) + (i128::from(end) - i128::from(start)) * index / 256) as i64);
            }
            for &(frame, _, _) in curve.track.keyframes().iter().filter(|k| (start..=end).contains(&k.0)).take(256) {
                frames.insert(frame);
                if frame > start { frames.insert(frame - 1); }
            }
        }
        let samples: Vec<_> = frames.into_iter().map(|frame| (frame, curve.track.value_at(frame))).collect();
        let keys: Vec<_> = curve.track.keyframes().iter().take(2048).map(|&(frame, value, interpolation)| json!({"source_frame":frame,"timeline_frame":clip.timeline_frame_at(frame),"value":value,"interpolation":interpolation,"controls":interpolation.control_points()})).collect();
        json!({"name":curve.name,"target":curve.target,"min":curve.bounds.0,"max":curve.bounds.1,"default":curve.track.default,"samples":samples,"keys":keys,"key_count":curve.track.keyframes().len()})
    }).collect();
    json!({"source_start":start,"source_end":end,"timeline_start":clip.timeline_start,"timeline_end":clip.timeline_end(),"tracks":entries})
}

pub fn edit(session: &mut Session, id: TimelineId, raw: &str, edit: &Edit) -> Result<()> {
    let (lane, _, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, lane)?;
    let entries = curves(session, id, clip, lane);
    let curve = entries
        .iter()
        .find(|c| c.target == edit.target)
        .ok_or_else(ApiError::missing)?;
    let keys = curve.track.keyframes();
    if let Some(previous) = edit.previous_source_frame {
        if !keys.iter().any(|k| k.0 == previous) {
            return Err(ApiError::invalid("The selected keyframe no longer exists"));
        }
    } else if edit.value.is_none() {
        return Err(ApiError::invalid("Select a keyframe to remove"));
    }
    if edit.value.is_some() {
        let start = clip.source_frame_at(clip.timeline_start);
        let end = clip.source_frame_at(clip.timeline_end() - 1);
        if !(start..=end).contains(&edit.source_frame) {
            return Err(ApiError::invalid(
                "Place the keyframe inside the visible source range",
            ));
        }
        if edit.previous_source_frame != Some(edit.source_frame)
            && keys.iter().any(|k| k.0 == edit.source_frame)
        {
            return Err(ApiError::conflict(
                "KEYFRAME_COLLISION",
                "Another keyframe occupies the destination",
            ));
        }
    }
    let mut commands = Vec::new();
    let mut change = Keyframe {
        target: edit.target.clone(),
        timeline_frame: clip.timeline_start,
        value: edit.value,
        interpolation: edit.interpolation,
    };
    if edit.value.is_none()
        || edit
            .previous_source_frame
            .is_some_and(|old| old != edit.source_frame)
    {
        change.value = None;
        commands.push(inspector::keyframe_command_at(
            session,
            id,
            raw,
            &change,
            edit.previous_source_frame,
        )?);
    }
    if edit.value.is_some() {
        change.value = edit.value;
        commands.push(inspector::keyframe_command_at(
            session,
            id,
            raw,
            &change,
            Some(edit.source_frame),
        )?);
    }
    session.apply(Box::new(core::CompositeCommand::new(
        core::CommandLabel::SetKeyframe,
        commands,
    )));
    Ok(())
}

pub fn edit_group(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    edit: &GroupEdit,
) -> Result<()> {
    let selected = edit.source_frames.iter().copied().collect::<BTreeSet<_>>();
    if selected.is_empty()
        || selected.len() > 2048
        || selected.len() != edit.source_frames.len()
        || !edit.delta_value.is_finite()
    {
        return Err(ApiError::invalid(
            "Choose between 1 and 2048 distinct native keyframes and finite deltas",
        ));
    }
    let (lane, _, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, lane)?;
    let entries = curves(session, id, clip, lane);
    let curve = entries
        .iter()
        .find(|curve| curve.target == edit.target)
        .ok_or_else(ApiError::missing)?;
    let keys = curve
        .track
        .keyframes()
        .iter()
        .filter(|key| selected.contains(&key.0))
        .copied()
        .collect::<Vec<_>>();
    if keys.len() != selected.len() {
        return Err(ApiError::invalid("A selected keyframe no longer exists"));
    }
    let start = clip.source_frame_at(clip.timeline_start);
    let end = clip.source_frame_at(clip.timeline_end() - 1);
    let mut commands = Vec::new();
    let mut inserts = Vec::new();
    for (frame, value, interpolation) in keys {
        let change = Keyframe {
            target: edit.target.clone(),
            timeline_frame: clip.timeline_start,
            value: None,
            interpolation,
        };
        commands.push(inspector::keyframe_command_at(
            session,
            id,
            raw,
            &change,
            Some(frame),
        )?);
        if edit.delete {
            continue;
        }
        let destination = frame
            .checked_add(edit.delta_source_frames)
            .ok_or_else(|| ApiError::invalid("Keyframe frame overflow"))?;
        if !(start..=end).contains(&destination) {
            return Err(ApiError::invalid(
                "Keep every moved keyframe inside the visible source range",
            ));
        }
        if !selected.contains(&destination)
            && curve
                .track
                .keyframes()
                .iter()
                .any(|key| key.0 == destination)
        {
            return Err(ApiError::conflict(
                "KEYFRAME_COLLISION",
                "Another keyframe occupies a group destination",
            ));
        }
        let value = value + edit.delta_value;
        if !value.is_finite() || value < curve.bounds.0 || value > curve.bounds.1 {
            return Err(ApiError::invalid(
                "Keep every moved value inside the native parameter range",
            ));
        }
        inserts.push(inspector::keyframe_command_at(
            session,
            id,
            raw,
            &Keyframe {
                value: Some(value),
                ..change
            },
            Some(destination),
        )?);
    }
    if !edit.delete && edit.delta_source_frames == 0 && edit.delta_value == 0.0 {
        return Ok(());
    }
    commands.extend(inserts);
    session.apply(Box::new(core::CompositeCommand::new(
        core::CommandLabel::SetKeyframe,
        commands,
    )));
    Ok(())
}

#[cfg(test)]
#[path = "tests/curves.rs"]
mod tests;
