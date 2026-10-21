use crate::{
    error::{ApiError, Result},
    inspector,
    visual::bounded,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use vv_core::{self as core, MaskParam, MaskShape, TimelineId};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum MaskEdit {
    Add {
        shape: MaskShape,
        #[serde(default)]
        path: Option<core::MaskPath>,
    },
    Remove {
        index: usize,
    },
    Move {
        index: usize,
        to_index: usize,
    },
    Set {
        index: usize,
        patch: MaskPatch,
    },
    PathKey {
        index: usize,
        timeline_frame: i64,
        path: Option<core::MaskPath>,
    },
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MaskPatch {
    pub enabled: Option<bool>,
    pub invert: Option<bool>,
    pub mode: Option<core::MaskMode>,
    #[serde(default)]
    pub parameters: Vec<MaskValue>,
    pub path: Option<core::MaskPath>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MaskValue {
    pub param: MaskParam,
    pub value: f32,
}
pub fn limits(param: MaskParam) -> (f32, f32) {
    match param {
        MaskParam::Width | MaskParam::Height => (0.0, 100_000.0),
        MaskParam::CenterX | MaskParam::CenterY | MaskParam::Expansion => (-100_000.0, 100_000.0),
        MaskParam::Rotation => (-360.0, 360.0),
        MaskParam::Feather | MaskParam::Roundness => (0.0, core::MASK_SOFTNESS_MAX),
        MaskParam::Opacity => (0.0, 100.0),
    }
}
fn validate(masks: &[core::ClipMask]) -> Result<()> {
    if masks.len() > 8 {
        return Err(ApiError::invalid(
            "The native compositor supports at most eight masks",
        ));
    }
    let mut points = 0;
    for mask in masks {
        if mask.shape != MaskShape::Path {
            continue;
        }
        let mut maximum = 0;
        for path in
            std::iter::once(&mask.path.default).chain(mask.path.keyframes().iter().map(|k| &k.1))
        {
            if !(3..=21).contains(&path.points.len()) {
                return Err(ApiError::invalid(
                    "A closed mask path needs 3–21 Bezier vertices",
                ));
            }
            maximum = maximum.max(path.points.len() * 12);
            for point in &path.points {
                for value in point
                    .point
                    .into_iter()
                    .chain(point.in_handle)
                    .chain(point.out_handle)
                {
                    bounded(value, (-100_000.0, 100_000.0))?;
                }
            }
        }
        points += maximum;
    }
    if points > 256 {
        return Err(ApiError::invalid(
            "Mask paths exceed the native shared 256-point flattened polygon budget",
        ));
    }
    Ok(())
}
pub fn edit(session: &mut Session, id: TimelineId, raw: &str, edit: &MaskEdit) -> Result<()> {
    let (track, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video {
        return Err(ApiError::invalid("Masks require a video clip"));
    }
    let mut masks = clip.effects.masks.clone();
    match edit {
        MaskEdit::Add { shape, path } => {
            if path.is_some() && *shape != MaskShape::Path {
                return Err(ApiError::invalid("Bezier vertices require a Path mask"));
            }
            let timeline_size = session.project.timelines[id].resolution;
            let source_size = if let core::ClipSource::Media(media) = clip.source {
                session
                    .project
                    .media_pool
                    .get(media)
                    .map(|m| (m.meta.width, m.meta.height))
                    .unwrap_or(timeline_size)
            } else {
                timeline_size
            };
            let (sw, sh) = (source_size.0.max(1) as f32, source_size.1.max(1) as f32);
            let scale = (timeline_size.0 as f32 / sw).min(timeline_size.1 as f32 / sh);
            let mut mask = core::ClipMask::new(
                *shape,
                ((sw * scale).round() as u32, (sh * scale).round() as u32),
            );
            if let Some(path) = path {
                mask.path.default = path.clone();
            }
            masks.push(mask);
        }
        MaskEdit::Remove { index } => {
            if *index >= masks.len() {
                return Err(ApiError::missing());
            }
            masks.remove(*index);
        }
        MaskEdit::Move { index, to_index } => {
            if *index >= masks.len() || *to_index >= masks.len() {
                return Err(ApiError::missing());
            }
            let mask = masks.remove(*index);
            masks.insert(*to_index, mask);
        }
        MaskEdit::Set { index, patch } => {
            let mask = masks.get_mut(*index).ok_or_else(ApiError::missing)?;
            if let Some(value) = patch.enabled {
                mask.enabled = value;
            }
            if let Some(value) = patch.invert {
                mask.invert = value;
            }
            if let Some(value) = patch.mode {
                mask.mode = value;
            }
            let mut seen = std::collections::HashSet::new();
            for value in &patch.parameters {
                if !seen.insert(value.param) || !value.param.applies_to(mask.shape) {
                    return Err(ApiError::invalid(
                        "Choose unique applicable mask parameters",
                    ));
                }
                bounded(value.value, limits(value.param))?;
                mask.track_mut(value.param).default = value.value;
            }
            if let Some(path) = &patch.path {
                if mask.shape != MaskShape::Path {
                    return Err(ApiError::invalid("Bezier vertices require a Path mask"));
                }
                mask.path.default = path.clone();
            }
        }
        MaskEdit::PathKey {
            index,
            timeline_frame,
            path,
        } => {
            if !clip.contains(*timeline_frame) {
                return Err(ApiError::invalid(
                    "Place the playhead inside the selected video clip",
                ));
            }
            let mask = masks.get_mut(*index).ok_or_else(ApiError::missing)?;
            if mask.shape != MaskShape::Path {
                return Err(ApiError::invalid("Bezier keyframes require a Path mask"));
            }
            let source_frame = clip.source_frame_at(*timeline_frame);
            if let Some(path) = path {
                mask.path
                    .upsert(source_frame, path.clone(), core::Interpolation::Linear);
            } else {
                mask.path.remove_at(source_frame);
            }
        }
    }
    validate(&masks)?;
    if matches!(edit, MaskEdit::PathKey { .. }) && masks == clip.effects.masks {
        return Ok(());
    }
    session.apply(Box::new(core::set_clip_masks(id, track, clip_id, masks)));
    Ok(())
}
pub fn viewer_edit(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    index: usize,
    timeline_frame: i64,
    parameters: &[MaskValue],
    path: Option<&core::MaskPath>,
) -> Result<()> {
    if parameters.len() > 5 || parameters.is_empty() && path.is_none() {
        return Err(ApiError::invalid(
            "Choose geometric mask parameters or a closed path",
        ));
    }
    let (track, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video
        || !clip.contains(timeline_frame)
    {
        return Err(ApiError::invalid(
            "Place the playhead inside the selected video clip",
        ));
    }
    let source_frame = clip.source_frame_at(timeline_frame);
    let mut masks = clip.effects.masks.clone();
    let mask = masks.get_mut(index).ok_or_else(ApiError::missing)?;
    let mut seen = std::collections::HashSet::new();
    for parameter in parameters {
        if !matches!(
            parameter.param,
            MaskParam::CenterX
                | MaskParam::CenterY
                | MaskParam::Width
                | MaskParam::Height
                | MaskParam::Rotation
        ) || !parameter.param.applies_to(mask.shape)
            || !seen.insert(parameter.param)
        {
            return Err(ApiError::invalid(
                "Choose unique applicable geometric mask parameters",
            ));
        }
        bounded(parameter.value, limits(parameter.param))?;
        let values = mask.track_mut(parameter.param);
        if (values.value_at(source_frame) - parameter.value).abs() > f32::EPSILON {
            if values.is_constant() {
                values.default = parameter.value;
            } else {
                values.upsert(source_frame, parameter.value, core::Interpolation::Linear);
            }
        }
    }
    if let Some(path) = path {
        if mask.shape != MaskShape::Path {
            return Err(ApiError::invalid("Bezier vertices require a Path mask"));
        }
        if mask.path.value_at(source_frame) != *path {
            if mask.path.is_constant() {
                mask.path.default = path.clone();
            } else {
                mask.path
                    .upsert(source_frame, path.clone(), core::Interpolation::Linear);
            }
        }
    }
    validate(&masks)?;
    if masks != clip.effects.masks {
        session.apply(Box::new(core::set_clip_masks(id, track, clip_id, masks)));
    }
    Ok(())
}
pub fn detail(clip: &core::Clip, frame: i64) -> Value {
    json!({"shapes":MaskShape::ALL,"modes":core::MaskMode::ALL,"items":clip.effects.masks.iter().enumerate().map(|(index,mask)|json!({"index":index,"shape":mask.shape,"enabled":mask.enabled,"invert":mask.invert,"mode":mask.mode,"path":mask.path.default,"evaluated_path":mask.path.value_at(frame),"path_keyframes":mask.path.keyframes().len(),"path_keys":mask.path.keyframes().iter().take(16).collect::<Vec<_>>(),"path_navigation":(mask.shape==MaskShape::Path).then(||path_navigation(clip,mask,frame)),"parameters":MaskParam::ALL.into_iter().filter(|p|p.applies_to(mask.shape)).map(|param|{let track=mask.track(param);let (min,max)=limits(param);json!({"param":param,"default":track.default,"value":track.value_at(frame),"keyframes":track.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":track.keyframes().len(),"min":min,"max":max})}).collect::<Vec<_>>() })).collect::<Vec<_>>()})
}

fn path_navigation(clip: &core::Clip, mask: &core::ClipMask, frame: i64) -> Value {
    let visible = clip.source_in()..clip.source_out();
    let key = |source_frame| json!({"source_frame":source_frame,"timeline_frame":clip.timeline_frame_at(source_frame)});
    json!({"on_keyframe":mask.path.keyframe_at(frame).is_some(),
        "previous":mask.path.keyframe_before(frame).filter(|at|visible.contains(at)).map(key),
        "next":mask.path.keyframe_after(frame).filter(|at|visible.contains(at)).map(key)})
}

#[cfg(test)]
#[path = "tests/masks.rs"]
mod tests;
