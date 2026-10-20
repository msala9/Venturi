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
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub param: TransformParam,
    pub value: f32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    Transform { param: TransformParam },
    Gain,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub target: Target,
    pub timeline_frame: i64,
    pub value: Option<f32>,
    pub interpolation: core::Interpolation,
}
fn find<'a>(session: &'a Session, id: TimelineId, raw: &str) -> Result<(usize, ClipId, &'a Clip)> {
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
fn writable(session: &Session, id: TimelineId, track: usize) -> Result<()> {
    if session.project.timelines[id].tracks[track].locked {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "The selected clip track is locked",
        ));
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
            || patch.color.is_some())
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
        if !matches!(clip.source, ClipSource::SolidColor | ClipSource::Text) {
            return Err(ApiError::invalid("Color requires a solid or title clip"));
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
pub fn keyframe(session: &mut Session, id: TimelineId, raw: &str, edit: &Keyframe) -> Result<()> {
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
        _ => {
            return Err(ApiError::invalid(
                "Keyframe target does not match the clip track kind",
            ));
        }
    };
    let frame = clip.source_frame_at(edit.timeline_frame);
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
    session.apply(command);
    Ok(())
}
pub fn detail(session: &Session, id: TimelineId, raw: &str, timeline_frame: i64) -> Result<Value> {
    let (track, _, clip) = find(session, id, raw)?;
    let frame =
        clip.source_frame_at(timeline_frame.clamp(clip.timeline_start, clip.timeline_end() - 1));
    let parameters: Vec<_> = TransformParam::ALL.into_iter().map(|param| {
        let values = clip.effects.transform.track(param);
        let bounds = limits(param, size(session, id, clip));
        json!({"param":param,"default":values.default,"value":values.value_at(frame),"keyframes":values.keyframes(),"min":bounds.0,"max":bounds.1})
    }).collect();
    Ok(
        json!({"clip_id":raw,"source_frame":frame,"timeline_frame":timeline_frame,"locked":session.project.timelines[id].tracks[track].locked,"video":session.project.timelines[id].tracks[track].kind == core::TrackKind::Video,"transform":parameters,"flip":clip.effects.transform.flip,"blend":clip.effects.blend_mode,"blends":core::BlendMode::ALL,"matte":clip.effects.matte.map(|m|format!("{m:?}")).unwrap_or_else(||"None".into()),"mattes":["None","Alpha","AlphaInverted","Luma","LumaInverted"],"gain":{"default":clip.effects.gain_db.default,"value":clip.effects.gain_db.value_at(frame),"keyframes":clip.effects.gain_db.keyframes()},"color":clip.effects.color.as_ref().map(|c|c.default),"fade_in":clip.fade_in,"fade_out":clip.fade_out,"length_frames":clip.timeline_len}),
    )
}

#[cfg(test)]
#[path = "tests/inspector.rs"]
mod tests;
