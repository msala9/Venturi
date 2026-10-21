use crate::error::{ApiError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use vv_core::{
    self as core, Clip, ClipId, ClipSource, Command, CommandLabel, TimelineId, TransformParam,
};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Properties {
    #[serde(default)]
    pub transform: Vec<Parameter>,
    pub flip: Option<[bool; 2]>,
    pub gain_db: Option<f32>,
    pub blend: Option<core::BlendMode>,
    pub matte: Option<String>,
    pub color: Option<core::Rgba>,
    pub fade_in: Option<i64>,
    pub fade_out: Option<i64>,
    pub title: Option<TitleEdit>,
}
#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(deny_unknown_fields)]
pub struct TitleEdit {
    pub text: Option<String>,
    pub font_family: Option<String>,
    pub font_weight: Option<u16>,
    pub italic: Option<bool>,
    pub size: Option<f32>,
    pub tracking: Option<f32>,
    pub line_spacing: Option<f32>,
    pub underline: Option<bool>,
    pub strikethrough: Option<bool>,
    pub case: Option<core::FontCase>,
    pub align: Option<core::TextAlign>,
    pub anchor: Option<(core::HAnchor, core::VAnchor)>,
    pub position: Option<[f32; 2]>,
    pub color: Option<core::Rgba>,
    pub background: Option<core::TitleBackground>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub param: TransformParam,
    pub value: f32,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    Transform {
        param: TransformParam,
    },
    Gain,
    Grade {
        param: core::GradeParam,
    },
    FilterRadius {
        filter: core::FilterKind,
    },
    FilterAmount {
        filter: core::FilterKind,
    },
    FilterGrow {
        filter: core::FilterKind,
    },
    FilterOffset {
        filter: core::FilterKind,
        axis: usize,
    },
    Mask {
        index: usize,
        param: core::MaskParam,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub target: Target,
    pub timeline_frame: i64,
    pub value: Option<f32>,
    pub interpolation: core::Interpolation,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionSlot {
    In,
    Out,
    CutAfter,
}
pub fn transition(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    slot: TransitionSlot,
    value: &Option<core::Transition>,
) -> Result<()> {
    let (track, clip_id, clip) = find(session, id, raw)?;
    writable(session, id, track)?;
    let lane = &session.project.timelines[id].tracks[track];
    if lane.kind != core::TrackKind::Video || clip.is_adjustment() {
        return Err(ApiError::invalid("Transitions require a video clip"));
    }
    let right = lane
        .clips
        .iter()
        .find(|c| c.timeline_start == clip.timeline_end() && c.id != clip_id && !c.is_adjustment());
    let maximum = match slot {
        TransitionSlot::CutAfter => {
            2 * clip.timeline_len.min(
                right
                    .ok_or_else(|| ApiError::invalid("A crossing requires an adjacent video clip"))?
                    .timeline_len,
            )
        }
        _ => clip.timeline_len,
    };
    if let Some(value) = value {
        if !(1..=maximum).contains(&value.duration) {
            return Err(ApiError::invalid(
                "Transition exceeds the native clip or crossing duration",
            ));
        }
        bounded(value.curve, (0.0, 1.0))?;
    }
    let unchanged = match slot {
        TransitionSlot::In => clip.effects.transition_in.as_ref() == value.as_ref(),
        TransitionSlot::Out => clip.effects.transition_out.as_ref() == value.as_ref(),
        TransitionSlot::CutAfter => match (lane.crossing_from(clip_id), value) {
            (None, None) => true,
            (Some(current), Some(value)) => {
                current.right_clip == right.unwrap().id && &current.transition == value
            }
            _ => false,
        },
    };
    if unchanged {
        return Ok(());
    }
    let command: Box<dyn Command> = match slot {
        TransitionSlot::In | TransitionSlot::Out => Box::new(core::set_clip_transition(
            id,
            track,
            clip_id,
            if matches!(slot, TransitionSlot::In) {
                core::FadeEdge::In
            } else {
                core::FadeEdge::Out
            },
            value.clone(),
        )),
        TransitionSlot::CutAfter => Box::new(core::SetCrossTransition::new(
            id,
            track,
            clip_id,
            value.as_ref().map(|transition| core::CrossTransition {
                left_clip: clip_id,
                right_clip: right.unwrap().id,
                transition: transition.clone(),
            }),
        )),
    };
    session.apply(command);
    Ok(())
}
pub(crate) fn find<'a>(
    session: &'a Session,
    id: TimelineId,
    raw: &str,
) -> Result<(usize, ClipId, &'a Clip)> {
    let clip = ClipId(raw.parse().map_err(|_| ApiError::missing())?);
    session.project.timelines[id]
        .tracks
        .iter()
        .enumerate()
        .find_map(|(t, track)| track.clip(clip).map(|c| (t, clip, c)))
        .ok_or_else(ApiError::missing)
}
fn size(session: &Session, id: TimelineId, clip: &Clip) -> (u32, u32) {
    if let ClipSource::Media(media) = clip.source
        && let Some(item) = session.project.media_pool.get(media)
    {
        return (item.meta.width, item.meta.height);
    }
    session.project.timelines[id].resolution
}
pub fn limits(param: TransformParam, size: (u32, u32)) -> (f32, f32) {
    use TransformParam::*;
    match param {
        ZoomX | ZoomY => (0.01, 20.0),
        Opacity => (0.0, 100.0),
        CropLeft | CropRight => (0.0, size.0 as f32),
        CropTop | CropBottom => (0.0, size.1 as f32),
        CropSoftness => {
            let bound = size.0.min(size.1) as f32 / 2.0;
            (-bound, bound)
        }
        _ => (-1_000_000.0, 1_000_000.0),
    }
}
fn bounded(value: f32, bounds: (f32, f32)) -> Result<()> {
    if !value.is_finite() || !(bounds.0..=bounds.1).contains(&value) {
        return Err(ApiError::invalid(
            "Property value is outside the native supported range",
        ));
    }
    Ok(())
}
fn rgba(color: core::Rgba) -> Result<()> {
    for value in [color.r, color.g, color.b, color.a] {
        bounded(value, (0.0, 1.0))?;
    }
    Ok(())
}
pub(crate) fn writable(session: &Session, id: TimelineId, track: usize) -> Result<()> {
    if session.project.timelines[id].tracks[track].locked {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "The selected clip track is locked",
        ));
    }
    Ok(())
}
pub fn viewer_transform(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    timeline_frame: i64,
    parameters: &[Parameter],
) -> Result<()> {
    if parameters.is_empty() || parameters.len() > 11 {
        return Err(ApiError::invalid(
            "Choose between 1 and 11 viewer transform axes",
        ));
    }
    let (track, clip_id, clip) = find(session, id, raw)?;
    writable(session, id, track)?;
    if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video {
        return Err(ApiError::invalid("Viewer transforms require a video clip"));
    }
    if !clip.contains(timeline_frame) {
        return Err(ApiError::invalid(
            "Place the playhead inside the selected clip",
        ));
    }
    let source_size = size(session, id, clip);
    let mut seen = std::collections::HashSet::new();
    for parameter in parameters {
        if matches!(
            parameter.param,
            TransformParam::Opacity | TransformParam::CropSoftness
        ) || !seen.insert(parameter.param)
        {
            return Err(ApiError::invalid(
                "Choose distinct geometric viewer transform axes",
            ));
        }
        bounded(parameter.value, limits(parameter.param, source_size))?;
    }
    let source_frame = clip.source_frame_at(timeline_frame);
    let crop_params = [
        TransformParam::CropLeft,
        TransformParam::CropTop,
        TransformParam::CropRight,
        TransformParam::CropBottom,
    ];
    if crop_params.iter().any(|param| seen.contains(param)) {
        let crop = crop_params.map(|param| {
            parameters
                .iter()
                .find(|parameter| parameter.param == param)
                .map(|parameter| parameter.value)
                .unwrap_or_else(|| clip.effects.transform.track(param).value_at(source_frame))
        });
        if crop.iter().any(|value| !value.is_finite() || *value < 0.0)
            || source_size.0 == 0
            || source_size.1 == 0
            || crop[0] + crop[2] > source_size.0.saturating_sub(1) as f32
            || crop[1] + crop[3] > source_size.1.saturating_sub(1) as f32
        {
            return Err(ApiError::invalid(
                "Viewer crop must retain at least one source pixel per axis",
            ));
        }
    }
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    for param in TransformParam::ALL {
        let Some(parameter) = parameters.iter().find(|parameter| parameter.param == param) else {
            continue;
        };
        let values = clip.effects.transform.track(param);
        if values.value_at(source_frame) == parameter.value {
            continue;
        }
        commands.push(if values.is_constant() {
            Box::new(core::set_clip_transform_param(
                id,
                track,
                clip_id,
                param,
                parameter.value,
            ))
        } else {
            Box::new(core::UpsertKeyframe::new(
                id,
                track,
                clip_id,
                source_frame,
                core::KeyframeValue::TransformParam(param, parameter.value),
                core::Interpolation::Linear,
            ))
        });
    }
    if let Some(first) = commands.first() {
        session.apply(Box::new(core::CompositeCommand::new(
            first.label(),
            commands,
        )));
    }
    Ok(())
}
pub fn properties(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    patch: &Properties,
) -> Result<()> {
    let (track, clip_id, clip) = find(session, id, raw)?;
    writable(session, id, track)?;
    let video = session.project.timelines[id].tracks[track].kind == core::TrackKind::Video;
    if !video
        && (!patch.transform.is_empty()
            || patch.flip.is_some()
            || patch.blend.is_some()
            || patch.matte.is_some()
            || patch.color.is_some()
            || patch.title.is_some())
    {
        return Err(ApiError::invalid("Visual properties require a video clip"));
    }
    if patch.gain_db.is_some() && video {
        return Err(ApiError::invalid("Gain requires an audio clip"));
    }
    if patch.transform.len() > 13 {
        return Err(ApiError::invalid("Too many transform parameters"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    if let Some(edit) = &patch.title {
        if !matches!(clip.source, ClipSource::Text) {
            return Err(ApiError::invalid("Typography requires a title clip"));
        }
        let mut title = clip.effects.title.clone().unwrap_or_default();
        if let Some(text) = &edit.text {
            if text.len() > 4096 {
                return Err(ApiError::invalid("Title text exceeds 4096 bytes"));
            }
            title.content.default = text.clone();
        }
        if let Some(family) = &edit.font_family {
            if family.len() > 128 || family.chars().any(char::is_control) {
                return Err(ApiError::invalid("Invalid font family"));
            }
            title.font_family = family.clone();
        }
        if let Some(weight) = edit.font_weight {
            if !(100..=900).contains(&weight) {
                return Err(ApiError::invalid("Font weight must be 100–900"));
            }
            title.font_weight = weight;
        }
        for (field, value, range) in [
            (&mut title.size, edit.size, (1.0, 1000.0)),
            (&mut title.tracking, edit.tracking, (-300.0, 1000.0)),
            (&mut title.line_spacing, edit.line_spacing, (-200.0, 500.0)),
        ] {
            if let Some(value) = value {
                bounded(value, range)?;
                *field = value;
            }
        }
        for (field, value) in [
            (&mut title.italic, edit.italic),
            (&mut title.underline, edit.underline),
            (&mut title.strikethrough, edit.strikethrough),
        ] {
            if let Some(value) = value {
                *field = value;
            }
        }
        if let Some(value) = edit.case {
            title.case = value;
        }
        if let Some(value) = edit.align {
            title.align = value;
        }
        if let Some(value) = edit.anchor {
            title.anchor = value;
        }
        if let Some(value) = edit.position {
            for axis in value {
                bounded(axis, (-1_000_000.0, 1_000_000.0))?;
            }
            title.position = value;
        }
        if let Some(color) = edit.color {
            rgba(color)?;
            title.color = color;
        }
        if let Some(background) = &edit.background {
            rgba(background.color)?;
            rgba(background.outline_color)?;
            bounded(background.width, (0.0, 1.0))?;
            bounded(background.height, (0.0, 1.0))?;
            bounded(background.outline_width, (0.0, 1000.0))?;
            bounded(background.corner_radius, (0.0, 0.5))?;
            bounded(background.opacity, (0.0, 100.0))?;
            for axis in background.center {
                bounded(axis, (-1_000_000.0, 1_000_000.0))?;
            }
            title.background = background.clone();
        }
        commands.push(Box::new(core::set_clip_title(id, track, clip_id, title)));
    }
    for parameter in &patch.transform {
        if !seen.insert(parameter.param) {
            return Err(ApiError::invalid("Duplicate transform parameter"));
        }
        bounded(
            parameter.value,
            limits(parameter.param, size(session, id, clip)),
        )?;
        commands.push(Box::new(core::set_clip_transform_param(
            id,
            track,
            clip_id,
            parameter.param,
            parameter.value,
        )));
    }
    if let Some(flip) = patch.flip {
        commands.push(Box::new(core::set_clip_flip(id, track, clip_id, flip)));
    }
    if let Some(gain) = patch.gain_db {
        bounded(gain, (core::GAIN_DB_MIN, core::GAIN_DB_MAX))?;
        commands.push(Box::new(core::set_clip_gain(id, track, clip_id, gain)));
    }
    if let Some(blend) = patch.blend {
        commands.push(Box::new(core::set_clip_blend_mode(
            id, track, clip_id, blend,
        )));
    }
    if let Some(matte) = &patch.matte {
        let value = match matte.as_str() {
            "None" => None,
            value => Some(
                core::MatteMode::ALL
                    .into_iter()
                    .find(|m| format!("{m:?}") == value)
                    .ok_or_else(|| ApiError::invalid("Unknown matte mode"))?,
            ),
        };
        commands.push(Box::new(core::set_clip_matte(id, track, clip_id, value)));
    }
    if let Some(color) = patch.color {
        if !matches!(clip.source, ClipSource::SolidColor) {
            return Err(ApiError::invalid(
                "Color requires a solid clip; use title color for typography",
            ));
        }
        for value in [color.r, color.g, color.b, color.a] {
            bounded(value, (0.0, 1.0))?;
        }
        commands.push(Box::new(core::SetClipColor::new(id, track, clip_id, color)));
    }
    for (value, incoming) in [(patch.fade_in, true), (patch.fade_out, false)] {
        if let Some(frames) = value {
            if !(0..=clip.timeline_len).contains(&frames) {
                return Err(ApiError::invalid("Fade exceeds the clip duration"));
            }
            commands.push(Box::new(core::SetClipValue::new(
                id,
                track,
                clip_id,
                CommandLabel::Fade,
                frames,
                move |c| {
                    if incoming {
                        &mut c.fade_in
                    } else {
                        &mut c.fade_out
                    }
                },
            )));
        }
    }
    if commands.is_empty() {
        return Err(ApiError::invalid("Choose a property to change"));
    }
    session.apply(Box::new(core::CompositeCommand::new(
        CommandLabel::Transform,
        commands,
    )));
    Ok(())
}
fn keyframe_command(
    session: &Session,
    id: TimelineId,
    raw: &str,
    edit: &Keyframe,
) -> Result<Box<dyn Command>> {
    keyframe_command_at(session, id, raw, edit, None)
}
pub(crate) fn keyframe_command_at(
    session: &Session,
    id: TimelineId,
    raw: &str,
    edit: &Keyframe,
    source_frame: Option<i64>,
) -> Result<Box<dyn Command>> {
    let (track, clip_id, clip) = find(session, id, raw)?;
    writable(session, id, track)?;
    if !(clip.timeline_start..clip.timeline_end()).contains(&edit.timeline_frame) {
        return Err(ApiError::invalid(
            "Place the playhead inside the selected clip",
        ));
    }
    if let core::Interpolation::Bezier { c1, c2 } = edit.interpolation {
        for point in [c1, c2] {
            bounded(point[0], (0.0, 1.0))?;
            bounded(point[1], (-10.0, 10.0))?;
        }
    }
    let video = session.project.timelines[id].tracks[track].kind == core::TrackKind::Video;
    let value = edit.value.unwrap_or_default();
    let native = match edit.target {
        Target::Mask { index, param } if video => {
            let mask = clip
                .effects
                .masks
                .get(index)
                .ok_or_else(ApiError::missing)?;
            if !param.applies_to(mask.shape) {
                return Err(ApiError::invalid(
                    "The scalar mask parameter does not apply to this shape",
                ));
            }
            if edit.value.is_some() {
                bounded(value, crate::masks::limits(param))?;
            }
            core::KeyframeValue::Mask(index, param, value)
        }
        Target::Transform { param } if video => {
            if edit.value.is_some() {
                bounded(value, limits(param, size(session, id, clip)))?;
            }
            core::KeyframeValue::TransformParam(param, value)
        }
        Target::Gain if !video => {
            if edit.value.is_some() {
                bounded(value, (core::GAIN_DB_MIN, core::GAIN_DB_MAX))?;
            }
            core::KeyframeValue::Gain(value)
        }
        Target::Grade { param } if video => {
            if !clip
                .effects
                .filters
                .iter()
                .any(|f| f.kind == core::FilterKind::ColorCorrection)
            {
                return Err(ApiError::invalid(
                    "Add ColorCorrection before keyframing a grade",
                ));
            }
            if edit.value.is_some() {
                let range = param.range();
                bounded(value, (*range.start(), *range.end()))?;
            }
            core::KeyframeValue::Grade(param, value)
        }
        Target::FilterRadius { filter }
        | Target::FilterAmount { filter }
        | Target::FilterGrow { filter }
        | Target::FilterOffset { filter, .. }
            if video =>
        {
            if !clip.effects.filters.iter().any(|f| f.kind == filter) {
                return Err(ApiError::invalid("Add the filter before keyframing it"));
            }
            let (native, range) = match edit.target {
                Target::FilterRadius { .. }
                    if filter.is_blur() || filter == core::FilterKind::DropShadow =>
                {
                    (
                        core::KeyframeValue::FilterRadius(filter, value),
                        (0.0, core::BLUR_RADIUS_MAX),
                    )
                }
                Target::FilterAmount { .. } => (
                    core::KeyframeValue::FilterAmount(filter, value),
                    crate::visual::amount_range(filter)?,
                ),
                Target::FilterGrow { .. } if filter == core::FilterKind::DropShadow => (
                    core::KeyframeValue::FilterGrow(filter, value),
                    (0.0, core::SHADOW_GROW_MAX),
                ),
                Target::FilterOffset { axis, .. }
                    if filter == core::FilterKind::DropShadow && axis < 2 =>
                {
                    (
                        core::KeyframeValue::FilterOffset(
                            filter,
                            if axis == 0 {
                                core::Axis::X
                            } else {
                                core::Axis::Y
                            },
                            value,
                        ),
                        (-8192.0, 8192.0),
                    )
                }
                _ => {
                    return Err(ApiError::invalid(
                        "That keyframe target does not apply to this filter",
                    ));
                }
            };
            if edit.value.is_some() {
                bounded(value, range)?;
            }
            native
        }
        _ => {
            return Err(ApiError::invalid(
                "Keyframe target does not match the clip track kind",
            ));
        }
    };
    let frame = source_frame.unwrap_or_else(|| clip.source_frame_at(edit.timeline_frame));
    let command: Box<dyn Command> = if edit.value.is_some() {
        Box::new(core::UpsertKeyframe::new(
            id,
            track,
            clip_id,
            frame,
            native,
            edit.interpolation,
        ))
    } else {
        Box::new(core::RemoveKeyframe::new(
            id,
            track,
            clip_id,
            native.target(),
            frame,
        ))
    };
    Ok(command)
}
pub fn keyframe(session: &mut Session, id: TimelineId, raw: &str, edit: &Keyframe) -> Result<()> {
    let command = keyframe_command(session, id, raw, edit)?;
    session.apply(command);
    Ok(())
}
pub fn keyframes(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    edits: &[Keyframe],
) -> Result<()> {
    if edits.is_empty() || edits.len() > 64 {
        return Err(ApiError::invalid("Choose between 1 and 64 keyframes"));
    }
    let commands = edits
        .iter()
        .map(|edit| keyframe_command(session, id, raw, edit))
        .collect::<Result<Vec<_>>>()?;
    session.apply(Box::new(core::CompositeCommand::new(
        CommandLabel::SetKeyframe,
        commands,
    )));
    Ok(())
}
pub fn detail(session: &Session, id: TimelineId, raw: &str, timeline_frame: i64) -> Result<Value> {
    detail_page(session, id, raw, timeline_frame, None)
}
pub fn detail_page(
    session: &Session,
    id: TimelineId,
    raw: &str,
    timeline_frame: i64,
    page: Option<usize>,
) -> Result<Value> {
    let offset = page
        .unwrap_or(0)
        .checked_mul(256)
        .ok_or_else(|| ApiError::invalid("Key page is too large"))?;
    let (track, _, clip) = find(session, id, raw)?;
    let frame =
        clip.source_frame_at(timeline_frame.clamp(clip.timeline_start, clip.timeline_end() - 1));
    let parameters: Vec<_> = TransformParam::ALL.into_iter().map(|param| {
        let values = clip.effects.transform.track(param);
        let bounds = limits(param, size(session, id, clip));
        json!({"param":param,"default":values.default,"value":values.value_at(frame),"keyframes":values.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":values.keyframes().len(),"min":bounds.0,"max":bounds.1})
    }).collect();
    let lane = &session.project.timelines[id].tracks[track];
    let right = lane
        .clips
        .iter()
        .find(|c| c.timeline_start == clip.timeline_end() && c.id != clip.id && !c.is_adjustment());
    let mut result = json!({"clip_id":raw,"source_frame":frame,"timeline_frame":timeline_frame,"locked":session.project.timelines[id].tracks[track].locked,"video":session.project.timelines[id].tracks[track].kind == core::TrackKind::Video,"transform":parameters,"flip":clip.effects.transform.flip,"blend":clip.effects.blend_mode,"blends":core::BlendMode::ALL,"matte":clip.effects.matte.map(|m|format!("{m:?}")).unwrap_or_else(||"None".into()),"mattes":["None","Alpha","AlphaInverted","Luma","LumaInverted"],"gain":{"default":clip.effects.gain_db.default,"value":clip.effects.gain_db.value_at(frame),"keyframes":clip.effects.gain_db.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":clip.effects.gain_db.keyframes().len()},"color":clip.effects.color.as_ref().map(|c|c.default),"fade_in":clip.fade_in,"fade_out":clip.fade_out,"length_frames":clip.timeline_len});
    result["source_size"] = json!(size(session, id, clip));
    result["transitions"] = json!({"in":clip.effects.transition_in,"out":clip.effects.transition_out,"cut_after":lane.crossing_from(clip.id).map(|c|&c.transition),"cut_max_frames":right.map(|r|2*r.timeline_len.min(clip.timeline_len))});
    result["title"] = clip.effects.title.as_ref().map(|title|json!({"content":{"default":title.content.default,"keyframes":title.content.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":title.content.keyframes().len()},"font_family":title.font_family,"font_weight":title.font_weight,"italic":title.italic,"color":title.color,"size":title.size,"tracking":title.tracking,"line_spacing":title.line_spacing,"underline":title.underline,"strikethrough":title.strikethrough,"case":title.case,"align":title.align,"anchor":title.anchor,"position":title.position,"background":title.background})).unwrap_or(Value::Null);
    result["masks"] = crate::masks::detail(clip, frame);
    result["display_color"] = json!(clip.display_color);
    result["display_colors"] = json!(core::ClipColor::ALL);
    if matches!(clip.source, core::ClipSource::Media(_)) {
        result["retime"] = json!({"speed_percent":clip.speed().as_percent(),"pitch_correction":clip.pitch_correction,"freeze_source_frame":clip.freeze});
    }
    result["filters"] = crate::visual::detail(clip, frame);
    result["filters"]["wheel_hues"] = crate::visual::wheel_palette();
    result["filters"]["wheels"] = crate::visual::wheels();
    result["curves"] = if page.is_some() {
        crate::curves::detail_page(session, id, clip, track, offset, 256)
    } else {
        crate::curves::detail(session, id, clip, track)
    };
    result["event_keys"] =
        if session.project.timelines[id].tracks[track].kind == core::TrackKind::Video {
            if page.is_some() {
                crate::eventkeys::detail_page(clip, offset, 256)
            } else {
                crate::eventkeys::detail(clip)
            }
        } else {
            json!([])
        };
    if let Some(page) = page {
        let count = result["curves"]["tracks"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(result["event_keys"].as_array().into_iter().flatten())
            .filter_map(|row| row["key_count"].as_u64())
            .max()
            .unwrap_or(0);
        let pages = count.div_ceil(256).max(1);
        if page as u64 >= pages {
            return Err(ApiError::invalid(
                "Key page is beyond the last native key page",
            ));
        }
        result["key_page"] = json!({"index":page,"page_size":256,"total_pages":pages});
    }
    Ok(result)
}

#[cfg(test)]
#[path = "tests/inspector.rs"]
mod tests;
