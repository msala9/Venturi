use crate::{
    error::{ApiError, Result},
    inspector,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use vv_core::{self as core, Clip, TimelineId};
use vv_session::Session;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    Color,
    Text,
    Direction { filter: core::FilterKind },
}
impl Target {
    pub(crate) fn native(&self) -> core::KeyframeTarget {
        match self {
            Self::Color => core::KeyframeTarget::Color,
            Self::Text => core::KeyframeTarget::Text,
            Self::Direction { filter } => core::KeyframeTarget::FilterDirection(*filter),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub target: Target,
    pub previous_source_frame: Option<i64>,
    pub source_frame: i64,
    pub value: Option<Value>,
    pub interpolation: core::Interpolation,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub target: Target,
    pub source_frames: Vec<i64>,
    pub delta_source_frames: i64,
    pub delete: bool,
}
fn row<T: Clone + Serialize>(
    clip: &Clip,
    target: Target,
    name: String,
    track: &core::Keyframed<T>,
    choices: Value,
) -> Value {
    json!({"target":target,"name":name,"default":track.default,"choices":choices,"key_count":track.keyframes().len(),"keys":track.keyframes().iter().take(1024).map(|(frame,value,interpolation)|json!({"source_frame":frame,"timeline_frame":clip.timeline_frame_at(*frame),"value":value,"interpolation":interpolation,"controls":interpolation.control_points()})).collect::<Vec<_>>()})
}
pub fn detail(clip: &Clip) -> Value {
    let mut rows = Vec::new();
    if let Some(color) = &clip.effects.color {
        rows.push(row(
            clip,
            Target::Color,
            "RGBA color".into(),
            color,
            Value::Null,
        ));
    }
    if let Some(title) = &clip.effects.title {
        rows.push(row(
            clip,
            Target::Text,
            "Title content".into(),
            &title.content,
            Value::Null,
        ));
    }
    for filter in &clip.effects.filters {
        if filter.kind.is_blur() {
            rows.push(row(
                clip,
                Target::Direction {
                    filter: filter.kind,
                },
                format!("{:?} direction", filter.kind),
                &filter.direction,
                json!(core::BlurDirection::ALL),
            ));
        }
    }
    json!(rows)
}
pub(crate) fn keys(clip: &Clip, target: &Target) -> Result<Vec<i64>> {
    match target {
        Target::Color => clip
            .effects
            .color
            .as_ref()
            .map(|track| track.keyframes().iter().map(|key| key.0).collect()),
        Target::Text => clip
            .effects
            .title
            .as_ref()
            .map(|title| title.content.keyframes().iter().map(|key| key.0).collect()),
        Target::Direction { filter } => clip
            .effects
            .filters
            .iter()
            .find(|entry| entry.kind == *filter && filter.is_blur())
            .map(|entry| {
                entry
                    .direction
                    .keyframes()
                    .iter()
                    .map(|key| key.0)
                    .collect()
            }),
    }
    .ok_or_else(ApiError::missing)
}
fn parse_value(target: &Target, value: &Value) -> Result<core::KeyframeValue> {
    match target {
        Target::Color => {
            let color: core::Rgba = serde_json::from_value(value.clone())
                .map_err(|_| ApiError::invalid("Choose native RGBA components"))?;
            if [color.r, color.g, color.b, color.a]
                .iter()
                .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
            {
                return Err(ApiError::invalid(
                    "RGBA components must be finite values between 0 and 1",
                ));
            }
            Ok(core::KeyframeValue::Color(color))
        }
        Target::Text => {
            let text = value
                .as_str()
                .filter(|text| text.len() <= 4096)
                .ok_or_else(|| {
                    ApiError::invalid("Title key text must be at most 4096 UTF-8 bytes")
                })?;
            Ok(core::KeyframeValue::Text(text.into()))
        }
        Target::Direction { filter } => Ok(core::KeyframeValue::FilterDirection(
            *filter,
            serde_json::from_value(value.clone())
                .map_err(|_| ApiError::invalid("Choose a native blur direction"))?,
        )),
    }
}
pub(crate) fn interpolation(interpolation: core::Interpolation) -> Result<()> {
    if let core::Interpolation::Bezier { c1, c2 } = interpolation {
        for point in [c1, c2] {
            if !point[0].is_finite()
                || !(0.0..=1.0).contains(&point[0])
                || !point[1].is_finite()
                || !(-10.0..=10.0).contains(&point[1])
            {
                return Err(ApiError::invalid("Choose bounded native Bezier controls"));
            }
        }
    }
    Ok(())
}
pub fn edit(session: &mut Session, id: TimelineId, raw: &str, edit: &Edit) -> Result<()> {
    let (lane, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, lane)?;
    if session.project.timelines[id].tracks[lane].kind != core::TrackKind::Video {
        return Err(ApiError::invalid("Value key targets require a video track"));
    }
    let keys = keys(clip, &edit.target)?;
    interpolation(edit.interpolation)?;
    if edit
        .previous_source_frame
        .is_some_and(|frame| !keys.contains(&frame))
    {
        return Err(ApiError::invalid("The selected keyframe no longer exists"));
    }
    if edit.value.is_none() && edit.previous_source_frame.is_none() {
        return Err(ApiError::invalid("Select a keyframe to delete"));
    }
    let mut commands: Vec<Box<dyn core::Command>> = Vec::new();
    if let Some(value) = &edit.value {
        if !(clip.source_frame_at(clip.timeline_start)
            ..=clip.source_frame_at(clip.timeline_end() - 1))
            .contains(&edit.source_frame)
        {
            return Err(ApiError::invalid(
                "Place the key inside the visible source range",
            ));
        }
        if Some(edit.source_frame) != edit.previous_source_frame
            && keys.contains(&edit.source_frame)
        {
            return Err(ApiError::conflict(
                "KEYFRAME_COLLISION",
                "Another keyframe occupies the destination",
            ));
        }
        let value = parse_value(&edit.target, value)?;
        commands.push(Box::new(core::UpsertKeyframe::new(
            id,
            lane,
            clip_id,
            edit.source_frame,
            value,
            edit.interpolation,
        )));
    }
    if let Some(previous) = edit
        .previous_source_frame
        .filter(|frame| edit.value.is_none() || *frame != edit.source_frame)
    {
        commands.insert(
            0,
            Box::new(core::RemoveKeyframe::new(
                id,
                lane,
                clip_id,
                edit.target.native(),
                previous,
            )),
        );
    }
    session.apply(Box::new(core::CompositeCommand::new(
        core::CommandLabel::SetKeyframe,
        commands,
    )));
    Ok(())
}
pub fn group(session: &mut Session, id: TimelineId, raw: &str, edit: &Group) -> Result<()> {
    let selected = edit.source_frames.iter().copied().collect::<BTreeSet<_>>();
    if selected.is_empty() || selected.len() > 2048 || selected.len() != edit.source_frames.len() {
        return Err(ApiError::invalid("Choose 1–2048 distinct native keys"));
    }
    let (lane, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, lane)?;
    if session.project.timelines[id].tracks[lane].kind != core::TrackKind::Video {
        return Err(ApiError::invalid("Value key targets require a video track"));
    }
    let keys = keys(clip, &edit.target)?;
    if selected.iter().any(|frame| !keys.contains(frame)) {
        return Err(ApiError::invalid("A selected keyframe no longer exists"));
    }
    if !edit.delete {
        for frame in &selected {
            let next = frame
                .checked_add(edit.delta_source_frames)
                .ok_or_else(|| ApiError::invalid("Keyframe frame overflow"))?;
            if !(clip.source_frame_at(clip.timeline_start)
                ..=clip.source_frame_at(clip.timeline_end() - 1))
                .contains(&next)
            {
                return Err(ApiError::invalid(
                    "Keep all keys inside the visible source range",
                ));
            }
            if !selected.contains(&next) && keys.contains(&next) {
                return Err(ApiError::conflict(
                    "KEYFRAME_COLLISION",
                    "Another keyframe occupies a group destination",
                ));
            }
        }
        if edit.delta_source_frames != 0 {
            session.apply(Box::new(core::MoveKeyframes::new(
                id,
                lane,
                clip_id,
                selected
                    .into_iter()
                    .map(|frame| (edit.target.native(), frame))
                    .collect(),
                edit.delta_source_frames,
            )));
        }
    } else {
        session.apply(Box::new(core::CompositeCommand::new(
            core::CommandLabel::SetKeyframe,
            selected
                .into_iter()
                .map(|frame| {
                    Box::new(core::RemoveKeyframe::new(
                        id,
                        lane,
                        clip_id,
                        edit.target.native(),
                        frame,
                    )) as Box<dyn core::Command>
                })
                .collect(),
        )));
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/eventkeys.rs"]
mod tests;
