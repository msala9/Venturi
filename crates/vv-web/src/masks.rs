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
    Add { shape: MaskShape },
    Remove { index: usize },
    Move { index: usize, to_index: usize },
    Set { index: usize, patch: MaskPatch },
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
        MaskEdit::Add { shape } => {
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
            masks.push(core::ClipMask::new(
                *shape,
                ((sw * scale).round() as u32, (sh * scale).round() as u32),
            ));
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
    }
    validate(&masks)?;
    session.apply(Box::new(core::set_clip_masks(id, track, clip_id, masks)));
    Ok(())
}
pub fn detail(clip: &core::Clip, frame: i64) -> Value {
    json!({"shapes":MaskShape::ALL,"modes":core::MaskMode::ALL,"items":clip.effects.masks.iter().enumerate().map(|(index,mask)|json!({"index":index,"shape":mask.shape,"enabled":mask.enabled,"invert":mask.invert,"mode":mask.mode,"path":mask.path.default,"path_keyframes":mask.path.keyframes().len(),"parameters":MaskParam::ALL.into_iter().filter(|p|p.applies_to(mask.shape)).map(|param|{let track=mask.track(param);let (min,max)=limits(param);json!({"param":param,"default":track.default,"value":track.value_at(frame),"keyframes":track.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":track.keyframes().len(),"min":min,"max":max})}).collect::<Vec<_>>() })).collect::<Vec<_>>()})
}

#[cfg(test)]
#[path = "tests/masks.rs"]
mod tests;
