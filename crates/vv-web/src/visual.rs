use crate::{
    error::{ApiError, Result},
    inspector,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use vv_core::{self as core, FilterKind, TimelineId};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum FilterEdit {
    Add {
        filter: FilterKind,
    },
    Remove {
        filter: FilterKind,
    },
    Move {
        filter: FilterKind,
        to_index: usize,
    },
    Set {
        filter: FilterKind,
        patch: Box<FilterPatch>,
    },
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FilterPatch {
    pub enabled: Option<bool>,
    pub radius: Option<f32>,
    pub direction: Option<core::BlurDirection>,
    pub amount: Option<f32>,
    pub offset: Option<[f32; 2]>,
    pub grow: Option<f32>,
    pub color: Option<core::Rgba>,
    #[serde(default)]
    pub grade: Vec<GradeValue>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GradeValue {
    pub param: core::GradeParam,
    pub value: f32,
}
pub fn bounded(value: f32, range: (f32, f32)) -> Result<()> {
    if !value.is_finite() || !(range.0..=range.1).contains(&value) {
        return Err(ApiError::invalid(
            "Filter or grade value is outside its native range",
        ));
    }
    Ok(())
}
pub fn amount_range(kind: FilterKind) -> Result<(f32, f32)> {
    match kind {
        FilterKind::Exposure => Ok((core::EXPOSURE_MIN, core::EXPOSURE_MAX)),
        FilterKind::DropShadow => Ok((0.0, 100.0)),
        _ => Err(ApiError::invalid("This filter has no amount parameter")),
    }
}
pub fn edit(session: &mut Session, id: TimelineId, raw: &str, edit: &FilterEdit) -> Result<()> {
    let (track, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video {
        return Err(ApiError::invalid("Visual filters require a video clip"));
    }
    let mut filters = clip.effects.filters.clone();
    let kind = match edit {
        FilterEdit::Add { filter }
        | FilterEdit::Remove { filter }
        | FilterEdit::Move { filter, .. }
        | FilterEdit::Set { filter, .. } => *filter,
    };
    let existing = filters.iter().position(|filter| filter.kind == kind);
    match edit {
        FilterEdit::Add { .. } => {
            if existing.is_some() {
                return Err(ApiError::invalid(
                    "That native filter already exists on this clip",
                ));
            }
            filters.push(core::ClipFilter::new(kind));
        }
        FilterEdit::Remove { .. } => {
            filters.remove(existing.ok_or_else(ApiError::missing)?);
        }
        FilterEdit::Move { to_index, .. } => {
            if *to_index >= filters.len() {
                return Err(ApiError::invalid("Filter destination is outside the stack"));
            }
            let value = filters.remove(existing.ok_or_else(ApiError::missing)?);
            filters.insert(*to_index, value);
        }
        FilterEdit::Set { patch, .. } => {
            let filter = &mut filters[existing.ok_or_else(ApiError::missing)?];
            if let Some(value) = patch.enabled {
                filter.enabled = value;
            }
            if let Some(value) = patch.radius {
                if !kind.is_blur() && kind != FilterKind::DropShadow {
                    return Err(ApiError::invalid("This filter has no radius"));
                }
                bounded(value, (0.0, core::BLUR_RADIUS_MAX))?;
                filter.radius.default = value;
            }
            if let Some(value) = patch.direction {
                if !kind.is_blur() {
                    return Err(ApiError::invalid("Blur direction requires a blur"));
                }
                filter.direction.default = value;
            }
            if let Some(value) = patch.amount {
                bounded(value, amount_range(kind)?)?;
                filter.amount.default = value;
            }
            if (patch.offset.is_some() || patch.grow.is_some() || patch.color.is_some())
                && kind != FilterKind::DropShadow
            {
                return Err(ApiError::invalid("Shadow parameters require DropShadow"));
            }
            if let Some(offset) = patch.offset {
                for (axis, value) in offset.into_iter().enumerate() {
                    bounded(value, (-8192.0, 8192.0))?;
                    filter.offset[axis].default = value;
                }
            }
            if let Some(value) = patch.grow {
                bounded(value, (0.0, core::SHADOW_GROW_MAX))?;
                filter.grow.default = value;
            }
            if let Some(color) = patch.color {
                for value in [color.r, color.g, color.b, color.a] {
                    bounded(value, (0.0, 1.0))?;
                }
                filter.color = color;
            }
            if !patch.grade.is_empty() && kind != FilterKind::ColorCorrection {
                return Err(ApiError::invalid(
                    "Grade parameters require ColorCorrection",
                ));
            }
            if patch.grade.len() > core::GradeParam::COUNT {
                return Err(ApiError::invalid("Too many grade parameters"));
            }
            let mut seen = std::collections::HashSet::new();
            for parameter in &patch.grade {
                if !seen.insert(parameter.param) {
                    return Err(ApiError::invalid("Duplicate grade parameter"));
                }
                let range = parameter.param.range();
                bounded(parameter.value, (*range.start(), *range.end()))?;
                filter.grade.track_mut(parameter.param).default = parameter.value;
            }
            if !patch.grade.is_empty() {
                for wheel in core::GradeWheel::ALL {
                    let x = filter.grade.track(wheel.x()).default;
                    let y = filter.grade.track(wheel.y()).default;
                    if x * x + y * y > 1.000001 {
                        return Err(ApiError::invalid(
                            "Grade wheel offsets must stay inside the unit disc",
                        ));
                    }
                }
            }
        }
    }
    session.apply(Box::new(core::set_clip_filters(
        id, track, clip_id, filters,
    )));
    Ok(())
}
pub fn wheel_palette() -> Value {
    json!(
        (0..72)
            .map(|index| {
                let angle = (index as f32 + 0.5) / 72.0 * std::f32::consts::TAU;
                core::chroma_shift(angle.cos(), angle.sin()).map(|value| {
                    ((0.5 + value / core::WHEEL_CHROMA_STRENGTH * 0.3).clamp(0.0, 1.0) * 255.0)
                        as u8
                })
            })
            .collect::<Vec<_>>()
    )
}
pub fn apply_preset(session: &mut Session, id: TimelineId, raw: &str, name: &str) -> Result<()> {
    let (track, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video {
        return Err(ApiError::invalid("Color presets require a video clip"));
    }
    let preset = core::GradePreset::ALL
        .into_iter()
        .find(|p| format!("{p:?}") == name)
        .ok_or_else(|| ApiError::invalid("Unknown native grade preset"))?;
    let mut filters = clip.effects.filters.clone();
    let filter = filters
        .iter_mut()
        .find(|f| f.kind == FilterKind::ColorCorrection)
        .ok_or_else(|| ApiError::invalid("Add ColorCorrection before applying a color preset"))?;
    filter.grade.apply_preset(preset);
    session.apply(Box::new(core::set_clip_filters(
        id, track, clip_id, filters,
    )));
    Ok(())
}

pub fn apply_grade_at_frame(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    frame: i64,
    values: &[GradeValue],
) -> Result<()> {
    let (track, clip_id, clip) = inspector::find(session, id, raw)?;
    inspector::writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video
        || !clip.contains(frame)
        || values.is_empty()
        || values.len() > core::GradeParam::COUNT
    {
        return Err(ApiError::invalid(
            "Choose a video clip frame and 1–18 grade values",
        ));
    }
    let source_frame = clip.source_frame_at(frame);
    let mut filters = clip.effects.filters.clone();
    let grade = &mut filters
        .iter_mut()
        .find(|f| f.kind == FilterKind::ColorCorrection && f.enabled)
        .ok_or_else(|| ApiError::invalid("Enable ColorCorrection on the selected clip first"))?
        .grade;
    let animated = core::GradeParam::ALL.map(|param| {
        core::GradeWheel::of(param).map_or_else(
            || !grade.track(param).is_constant(),
            |wheel| {
                wheel
                    .params()
                    .iter()
                    .any(|p| !grade.track(*p).is_constant())
            },
        )
    });
    let mut seen = std::collections::HashSet::new();
    for entry in values {
        if !seen.insert(entry.param) {
            return Err(ApiError::invalid("Duplicate grade parameter"));
        }
        let range = entry.param.range();
        bounded(entry.value, (*range.start(), *range.end()))?;
        if animated[entry.param.index()] {
            grade.track_mut(entry.param).upsert(
                source_frame,
                entry.value,
                core::Interpolation::Linear,
            );
        } else {
            grade.track_mut(entry.param).default = entry.value;
        }
    }
    let evaluated = grade.value_at(source_frame);
    for wheel in core::GradeWheel::ALL {
        if evaluated.get(wheel.x()).hypot(evaluated.get(wheel.y())) > 1.000001 {
            return Err(ApiError::invalid(
                "Grade wheel offsets must stay inside the unit disc",
            ));
        }
    }
    session.apply(Box::new(core::set_clip_filters(
        id, track, clip_id, filters,
    )));
    Ok(())
}
pub fn wheels() -> Value {
    json!(core::GradeWheel::ALL.map(|wheel|json!({"name":format!("{wheel:?}"),"x":wheel.x(),"y":wheel.y(),"luma":wheel.luma(),"saturation":wheel.saturation()})))
}
pub fn detail(clip: &core::Clip, frame: i64) -> Value {
    json!({"grade_presets":core::GradePreset::ALL.map(|p|format!("{p:?}")),"kinds":[FilterKind::ColorCorrection,FilterKind::BoxBlur,FilterKind::GaussianBlur,FilterKind::Exposure,FilterKind::DropShadow],"blur_radius_max":core::BLUR_RADIUS_MAX,"shadow_grow_max":core::SHADOW_GROW_MAX,"blur_directions":core::BlurDirection::ALL,
    "stack":clip.effects.filters.iter().map(|filter|{
        let value=|track:&core::Keyframed<f32>|json!({"default":track.default,"value":track.value_at(frame),"keyframes":track.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":track.keyframes().len()});
        json!({"kind":filter.kind,"enabled":filter.enabled,"radius":value(&filter.radius),"direction":filter.direction.value_at(frame),"amount":value(&filter.amount),"amount_range":amount_range(filter.kind).ok(),"offset":[value(&filter.offset[0]),value(&filter.offset[1])],"grow":value(&filter.grow),"color":filter.color,"grade":core::GradeParam::ALL.map(|param|{let track=filter.grade.track(param);let range=param.range();json!({"param":param,"default":track.default,"value":track.value_at(frame),"keyframes":track.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":track.keyframes().len(),"range":[range.start(),range.end()]})})})
    }).collect::<Vec<_>>()})
}

#[cfg(test)]
#[path = "tests/visual.rs"]
mod tests;
