use crate::{
    curves,
    error::{ApiError, Result},
    eventkeys, inspector,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use vv_core::{self as core, Clip, KeyframeTarget, TimelineId, TransformParam};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Target {
    Scalar(inspector::Target),
    Value(eventkeys::Target),
}
impl Target {
    fn native(&self) -> KeyframeTarget {
        match self {
            Self::Scalar(target) => match *target {
                inspector::Target::Transform { param } => KeyframeTarget::TransformParam(param),
                inspector::Target::Gain => KeyframeTarget::Gain,
                inspector::Target::Grade { param } => KeyframeTarget::Grade(param),
                inspector::Target::FilterRadius { filter } => KeyframeTarget::FilterRadius(filter),
                inspector::Target::FilterAmount { filter } => KeyframeTarget::FilterAmount(filter),
                inspector::Target::FilterGrow { filter } => KeyframeTarget::FilterGrow(filter),
                inspector::Target::FilterOffset { filter, axis } => KeyframeTarget::FilterOffset(
                    filter,
                    if axis == 0 {
                        core::Axis::X
                    } else {
                        core::Axis::Y
                    },
                ),
                inspector::Target::Mask { index, param } => KeyframeTarget::Mask(index, param),
            },
            Self::Value(target) => target.native(),
        }
    }
    fn frames(
        &self,
        session: &Session,
        id: TimelineId,
        clip: &Clip,
        lane: usize,
    ) -> Result<Vec<i64>> {
        match self {
            Self::Scalar(target) => curves::key_frames(session, id, clip, lane, target),
            Self::Value(target) => {
                if session.project.timelines[id].tracks[lane].kind != core::TrackKind::Video {
                    return Err(ApiError::invalid("Value keys require a video track"));
                }
                eventkeys::keys(clip, target)
            }
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Pick {
    pub target: Target,
    pub source_frame: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Grabbed {
    pub target: inspector::Target,
    pub source_frame: i64,
    pub value: f32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Move {
        delta_source_frames: i64,
    },
    Drag {
        delta_source_frames: i64,
        grabbed: Grabbed,
    },
    Delete,
    Interpolation {
        interpolation: core::Interpolation,
    },
}

fn validate_move(
    clip: &Clip,
    rows: &[(KeyframeTarget, Vec<i64>)],
    picks: &[(KeyframeTarget, i64)],
    selected: &HashSet<(KeyframeTarget, i64)>,
    delta: i64,
    replace_destination_keys: bool,
) -> Result<()> {
    let bounds =
        clip.source_frame_at(clip.timeline_start)..=clip.source_frame_at(clip.timeline_end() - 1);
    for &(target, frame) in picks {
        let next = frame
            .checked_add(delta)
            .filter(|next| bounds.contains(next))
            .ok_or_else(|| ApiError::invalid("Keep all keys inside the visible source range"))?;
        let frames = &rows.iter().find(|(row, _)| *row == target).unwrap().1;
        if !replace_destination_keys
            && frames.contains(&next)
            && !selected.contains(&(target, next))
        {
            return Err(ApiError::conflict(
                "KEYFRAME_COLLISION",
                "An unselected key occupies a destination",
            ));
        }
    }
    Ok(())
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub picks: Vec<Pick>,
    pub link_zoom: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replace_destination_keys: bool,
    pub action: Action,
}

pub fn edit(session: &mut Session, id: TimelineId, raw: &str, edit: &Edit) -> Result<()> {
    if edit.picks.is_empty() || edit.picks.len() > 2048 {
        return Err(ApiError::invalid("Choose 1–2048 distinct native keys"));
    }
    let (lane, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, lane)?;
    let mut picks = Vec::new();
    let mut selected = HashSet::new();
    let mut rows = Vec::new();
    for pick in &edit.picks {
        if matches!(pick.target, Target::Scalar(inspector::Target::FilterOffset { axis, .. }) if axis > 1)
        {
            return Err(ApiError::invalid("Choose a native X/Y filter axis"));
        }
        let native = pick.target.native();
        if !selected.insert((native, pick.source_frame)) {
            return Err(ApiError::invalid("Select each native key only once"));
        }
        if !rows.iter().any(|(target, _)| *target == native) {
            rows.push((native, pick.target.frames(session, id, clip, lane)?));
        }
        let frames = &rows.iter().find(|(target, _)| *target == native).unwrap().1;
        if !frames.contains(&pick.source_frame) {
            return Err(ApiError::invalid("A selected keyframe no longer exists"));
        }
        picks.push((native, pick.source_frame));
    }
    if edit.link_zoom {
        for &(target, frame) in &picks.clone() {
            let twin = match target {
                KeyframeTarget::TransformParam(TransformParam::ZoomX) => TransformParam::ZoomY,
                KeyframeTarget::TransformParam(TransformParam::ZoomY) => TransformParam::ZoomX,
                _ => continue,
            };
            let target = KeyframeTarget::TransformParam(twin);
            let frames = clip.effects.transform.track(twin).keyframes();
            if frames.iter().any(|key| key.0 == frame) && selected.insert((target, frame)) {
                picks.push((target, frame));
                if !rows.iter().any(|(row, _)| *row == target) {
                    rows.push((target, frames.iter().map(|key| key.0).collect()));
                }
            }
        }
    }
    match edit.action {
        Action::Move {
            delta_source_frames,
        } => {
            validate_move(
                clip,
                &rows,
                &picks,
                &selected,
                delta_source_frames,
                edit.replace_destination_keys,
            )?;
            if delta_source_frames != 0 {
                session.apply(Box::new(core::MoveKeyframes::new(
                    id,
                    lane,
                    clip_id,
                    picks,
                    delta_source_frames,
                )));
            }
        }
        Action::Drag {
            delta_source_frames,
            ref grabbed,
        } => {
            let target = Target::Scalar(grabbed.target.clone()).native();
            if !edit.picks.iter().any(|pick| {
                pick.target.native() == target && pick.source_frame == grabbed.source_frame
            }) {
                return Err(ApiError::invalid("The grabbed scalar key must be selected"));
            }
            validate_move(
                clip,
                &rows,
                &picks,
                &selected,
                delta_source_frames,
                edit.replace_destination_keys,
            )?;
            let (old_value, interpolation) = curves::key_value(
                session,
                id,
                clip,
                lane,
                &grabbed.target,
                grabbed.source_frame,
            )?;
            let mut value_changed = old_value != grabbed.value;
            let destination = grabbed
                .source_frame
                .checked_add(delta_source_frames)
                .ok_or_else(|| ApiError::invalid("Keyframe frame overflow"))?;
            let mut commands = vec![inspector::keyframe_command_at(
                session,
                id,
                raw,
                &inspector::Keyframe {
                    target: grabbed.target.clone(),
                    timeline_frame: clip.timeline_start,
                    value: Some(grabbed.value),
                    interpolation,
                },
                Some(destination),
            )?];
            if edit.link_zoom {
                let twin = match grabbed.target {
                    inspector::Target::Transform {
                        param: TransformParam::ZoomX,
                    } => Some(TransformParam::ZoomY),
                    inspector::Target::Transform {
                        param: TransformParam::ZoomY,
                    } => Some(TransformParam::ZoomX),
                    _ => None,
                };
                if let Some(param) = twin {
                    let target = inspector::Target::Transform { param };
                    if let Ok((value, twin_interpolation)) =
                        curves::key_value(session, id, clip, lane, &target, grabbed.source_frame)
                    {
                        value_changed |=
                            value != grabbed.value || twin_interpolation != interpolation;
                        commands.push(inspector::keyframe_command_at(
                            session,
                            id,
                            raw,
                            &inspector::Keyframe {
                                target,
                                timeline_frame: clip.timeline_start,
                                value: Some(grabbed.value),
                                interpolation,
                            },
                            Some(destination),
                        )?);
                    }
                }
            }
            if delta_source_frames == 0 && !value_changed {
                return Ok(());
            }
            if delta_source_frames != 0 {
                commands.insert(
                    0,
                    Box::new(core::MoveKeyframes::new(
                        id,
                        lane,
                        clip_id,
                        picks,
                        delta_source_frames,
                    )),
                );
            }
            session.apply(Box::new(core::CompositeCommand::new(
                core::CommandLabel::SetKeyframe,
                commands,
            )));
        }
        Action::Delete => session.apply(Box::new(core::CompositeCommand::new(
            core::CommandLabel::SetKeyframe,
            picks
                .into_iter()
                .map(|(target, frame)| {
                    Box::new(core::RemoveKeyframe::new(id, lane, clip_id, target, frame))
                        as Box<dyn core::Command>
                })
                .collect(),
        ))),
        Action::Interpolation { interpolation } => {
            eventkeys::interpolation(interpolation)?;
            session.apply(Box::new(core::SetKeyframeInterpolation::new(
                id,
                lane,
                clip_id,
                picks,
                interpolation,
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/keyselection.rs"]
mod tests;
