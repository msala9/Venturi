use crate::{
    error::{ApiError, Result},
    inspector::{self, Keyframe, Target},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use vv_core::{self as core, Clip, Keyframed, TimelineId};
use vv_session::Session;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewportRequest {
    pub query: crate::preview::FrameQuery,
    #[serde(deserialize_with = "viewport_target")]
    pub target: Target,
    pub source_start: i64,
    pub source_end: i64,
    pub points: usize,
}

fn viewport_target<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Target, D::Error> {
    let value = Value::deserialize(deserializer)?;
    let target: Target = serde_json::from_value(value.clone()).map_err(serde::de::Error::custom)?;
    // Internally tagged unit variants otherwise accept extra fields.
    if json!(target) != value {
        return Err(serde::de::Error::custom("Unexpected curve target fields"));
    }
    Ok(target)
}

// Match the native editor's fractional f32 sampling, including Bezier overshoot.
fn sample(track: &Keyframed<f32>, at: f32) -> f32 {
    let keys = track.keyframes();
    let Some(first) = keys.first() else {
        return track.default;
    };
    let last = keys.last().unwrap();
    if at <= first.0 as f32 {
        return first.1;
    }
    if at >= last.0 as f32 {
        return last.1;
    }
    let index = keys.partition_point(|(frame, _, _)| (*frame as f32) <= at) - 1;
    let ((f0, v0, interpolation), (f1, v1, _)) = (keys[index], keys[index + 1]);
    let t = (at - f0 as f32) / (f1 - f0) as f32;
    v0 + (v1 - v0) * interpolation.ease(t)
}

pub fn viewport(
    session: &Session,
    id: TimelineId,
    raw: &str,
    request: &ViewportRequest,
) -> Result<Value> {
    let (lane, _, clip) = inspector::find(session, id, raw)?;
    if !(2..=2048).contains(&request.points)
        || request.source_end < request.source_start
        || request.source_start < clip.source_in()
        || request.source_end > clip.source_out()
    {
        return Err(ApiError::invalid(
            "Curve viewport exceeds the native clip range or sample limit",
        ));
    }
    let curve = curves(session, id, clip, lane)
        .into_iter()
        .find(|curve| curve.target == request.target)
        .ok_or_else(ApiError::missing)?;
    let span = request.source_end - request.source_start;
    let mut samples = Vec::with_capacity(request.points);
    for index in 0..request.points {
        let fraction = index as f64 / (request.points - 1) as f64;
        let frame = request.source_start as f64 + fraction * span as f64;
        let at =
            request.source_start as f32 + index as f32 / (request.points - 1) as f32 * span as f32;
        let value = sample(curve.track, at);
        if !value.is_finite() {
            return Err(ApiError::invalid(
                "The native curve produced a non-finite value",
            ));
        }
        samples.push((frame, value));
    }
    Ok(
        json!({"clip_id":raw,"target":request.target,"source_start":request.source_start,
        "source_end":request.source_end,"points":request.points,"samples":samples}),
    )
}

fn neighbor(key: Option<&(i64, f32, core::Interpolation)>) -> Value {
    key.map_or(Value::Null, |&(frame, value, interpolation)| {
        json!({
            "source_frame":frame,"value":value,"interpolation":interpolation,
            "controls":interpolation.control_points()
        })
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub target: Target,
    pub previous_source_frame: Option<i64>,
    pub source_frame: i64,
    pub value: Option<f32>,
    pub interpolation: core::Interpolation,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub link_zoom: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GroupEdit {
    pub target: Target,
    pub source_frames: Vec<i64>,
    pub delta_source_frames: i64,
    pub delta_value: f32,
    pub delete: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub link_zoom: bool,
}

fn zoom_twin(target: &Target) -> Option<Target> {
    match target {
        Target::Transform {
            param: core::TransformParam::ZoomX,
        } => Some(Target::Transform {
            param: core::TransformParam::ZoomY,
        }),
        Target::Transform {
            param: core::TransformParam::ZoomY,
        } => Some(Target::Transform {
            param: core::TransformParam::ZoomX,
        }),
        _ => None,
    }
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
    detail_page(session, id, clip, lane, 0, 2048)
}

pub fn detail_page(
    session: &Session,
    id: TimelineId,
    clip: &Clip,
    lane: usize,
    offset: usize,
    limit: usize,
) -> Value {
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
        let all_keys = curve.track.keyframes();
        let keys: Vec<_> = all_keys.iter().enumerate().skip(offset).take(limit).map(|(index, &(frame, value, interpolation))| json!({"source_frame":frame,"timeline_frame":clip.timeline_frame_at(frame),"value":value,"interpolation":interpolation,"controls":interpolation.control_points(),"previous_key":neighbor(index.checked_sub(1).and_then(|index| all_keys.get(index))),"next_key":neighbor(all_keys.get(index + 1))})).collect();
        json!({"name":curve.name,"target":curve.target,"min":curve.bounds.0,"max":curve.bounds.1,"default":curve.track.default,"samples":samples,"keys":keys,"key_count":curve.track.keyframes().len()})
    }).collect();
    json!({"source_start":start,"source_end":end,"timeline_start":clip.timeline_start,"timeline_end":clip.timeline_end(),"tracks":entries})
}

pub(crate) fn key_frames(
    session: &Session,
    id: TimelineId,
    clip: &Clip,
    lane: usize,
    target: &Target,
) -> Result<Vec<i64>> {
    curves(session, id, clip, lane)
        .into_iter()
        .find(|curve| &curve.target == target)
        .map(|curve| curve.track.keyframes().iter().map(|key| key.0).collect())
        .ok_or_else(ApiError::missing)
}

pub(crate) fn key_value(
    session: &Session,
    id: TimelineId,
    clip: &Clip,
    lane: usize,
    target: &Target,
    frame: i64,
) -> Result<(f32, core::Interpolation)> {
    curves(session, id, clip, lane)
        .into_iter()
        .find(|curve| &curve.target == target)
        .and_then(|curve| {
            curve
                .track
                .keyframes()
                .iter()
                .find(|key| key.0 == frame)
                .map(|key| (key.1, key.2))
        })
        .ok_or_else(ApiError::missing)
}

pub fn edit(session: &mut Session, id: TimelineId, raw: &str, edit: &Edit) -> Result<()> {
    let mut commands = edit_commands(session, id, raw, edit)?;
    if edit.link_zoom
        && let Some(target) = zoom_twin(&edit.target)
    {
        let (lane, _, clip) = inspector::find(session, id, raw)?;
        let frames = key_frames(session, id, clip, lane, &target)?;
        if edit
            .previous_source_frame
            .is_none_or(|frame| frames.contains(&frame))
        {
            commands.extend(edit_commands(
                session,
                id,
                raw,
                &Edit {
                    target,
                    link_zoom: false,
                    ..edit.clone()
                },
            )?);
        }
    }
    session.apply(Box::new(core::CompositeCommand::new(
        core::CommandLabel::SetKeyframe,
        commands,
    )));
    Ok(())
}

fn edit_commands(
    session: &Session,
    id: TimelineId,
    raw: &str,
    edit: &Edit,
) -> Result<Vec<Box<dyn core::Command>>> {
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
    Ok(commands)
}

pub fn edit_group(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    edit: &GroupEdit,
) -> Result<()> {
    let mut commands = group_commands(session, id, raw, edit, None)?;
    if edit.link_zoom
        && let Some(target) = zoom_twin(&edit.target)
    {
        let (lane, _, clip) = inspector::find(session, id, raw)?;
        let selected = edit.source_frames.iter().copied().collect::<BTreeSet<_>>();
        let source_frames = key_frames(session, id, clip, lane, &target)?
            .into_iter()
            .filter(|frame| selected.contains(frame))
            .collect::<Vec<_>>();
        if !source_frames.is_empty() {
            let values = if !edit.delete && edit.delta_value != 0.0 {
                let entries = curves(session, id, clip, lane);
                let curve = entries
                    .iter()
                    .find(|curve| curve.target == edit.target)
                    .ok_or_else(ApiError::missing)?;
                Some(
                    curve
                        .track
                        .keyframes()
                        .iter()
                        .filter(|key| selected.contains(&key.0))
                        .map(|key| (key.0, key.1 + edit.delta_value))
                        .collect::<BTreeMap<_, _>>(),
                )
            } else {
                None
            };
            commands.extend(group_commands(
                session,
                id,
                raw,
                &GroupEdit {
                    target,
                    source_frames,
                    delta_value: 0.0,
                    link_zoom: false,
                    ..edit.clone()
                },
                values.as_ref(),
            )?);
        }
    }
    if !edit.delete && edit.delta_source_frames == 0 && edit.delta_value == 0.0 {
        return Ok(());
    }
    session.apply(Box::new(core::CompositeCommand::new(
        core::CommandLabel::SetKeyframe,
        commands,
    )));
    Ok(())
}

fn group_commands(
    session: &Session,
    id: TimelineId,
    raw: &str,
    edit: &GroupEdit,
    values: Option<&BTreeMap<i64, f32>>,
) -> Result<Vec<Box<dyn core::Command>>> {
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
        let value = values
            .and_then(|values| values.get(&frame))
            .copied()
            .unwrap_or(value + edit.delta_value);
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
    commands.extend(inserts);
    Ok(commands)
}

#[cfg(test)]
#[path = "tests/curves.rs"]
mod tests;
