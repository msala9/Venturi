use crate::{
    clipboard::{self, AttributeMode, AttributeSource},
    commands,
    error::{ApiError, Result},
    preview::FrameQuery,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vv_core::{
    self as core,
    attributes::{Attribute, KeyframeAnchor, TimelineFormat},
};
use vv_session::Session;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub version: u32,
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub anchor: KeyframeAnchor,
    #[serde(default)]
    pub append_filters: bool,
    #[serde(default)]
    pub shortcut: Option<Value>,
    pub fps: core::Rational,
    pub resolution: (u32, u32),
    pub video: Option<Box<core::Clip>>,
    pub audio: Option<Box<core::Clip>>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub anchor: KeyframeAnchor,
    pub append_filters: bool,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capture {
    pub query: FrameQuery,
    pub clip_ids: Vec<String>,
    pub options: Options,
}

fn validate_keys(value: &Value) -> Result<()> {
    match value {
        Value::Object(fields) => {
            for (name, value) in fields {
                if name == "keyframes" {
                    let keys = value
                        .as_array()
                        .ok_or_else(|| ApiError::invalid("Invalid native preset keyframes"))?;
                    let mut previous = None;
                    for key in keys {
                        let frame = key[0]
                            .as_i64()
                            .filter(|frame| {
                                (-commands::MAX_FRAME..=commands::MAX_FRAME).contains(frame)
                            })
                            .ok_or_else(|| {
                                ApiError::invalid(
                                    "Preset keyframes exceed supported source coordinates",
                                )
                            })?;
                        if previous.is_some_and(|previous| previous >= frame) {
                            return Err(ApiError::invalid(
                                "Preset keys must be distinct and sorted",
                            ));
                        }
                        previous = Some(frame);
                        let interpolation =
                            serde_json::from_value(key[2].clone()).map_err(|_| {
                                ApiError::invalid("Invalid native preset interpolation")
                            })?;
                        crate::eventkeys::interpolation(interpolation)?;
                    }
                }
                validate_keys(value)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_keys(item)?;
            }
        }
        _ => (),
    }
    Ok(())
}
impl Preset {
    pub fn validate(&self) -> Result<()> {
        if self.shortcut.as_ref().is_some_and(|value| {
            value.as_str().is_none_or(|text| {
                text.is_empty() || text.len() > 128 || text.chars().any(char::is_control)
            })
        }) {
            return Err(ApiError::invalid(
                "Native shortcut metadata must be a nonempty string within 128 UTF-8 bytes",
            ));
        }
        if self.version != 1
            || self.name.trim().is_empty()
            || self.name.len() > 128
            || self.name.chars().any(char::is_control)
            || self.attributes.is_empty()
            || self.attributes.len() > Attribute::ALL.len()
            || self
                .attributes
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.attributes.len()
            || self.fps.num <= 0
            || self.fps.den <= 0
            || self.fps.as_f64() > 240.0
            || self.resolution.0 == 0
            || self.resolution.1 == 0
            || self.resolution.0 > 8192
            || self.resolution.1 > 8192
            || self.video.is_none() && self.audio.is_none()
            || self.attributes.iter().any(|attribute| match attribute {
                Attribute::Volume => self.audio.is_none(),
                Attribute::Fades | Attribute::Speed => false,
                _ => self.video.is_none(),
            })
        {
            return Err(ApiError::invalid(
                "Choose a named native v1 preset with valid format and property groups",
            ));
        }
        for clip in self.video.iter().chain(self.audio.iter()) {
            if clip.timeline_len < 1
                || clip.timeline_start < 0
                || clip.timeline_start > commands::MAX_FRAME - clip.timeline_len
                || clip.source_offset < 0
                || clip.source_offset > commands::MAX_FRAME - clip.timeline_len
                || clip.rate().num <= 0
                || clip.rate().den <= 0
                || clip.speed().num <= 0
                || clip.speed().den <= 0
            {
                return Err(ApiError::invalid("Preset source clip geometry is invalid"));
            }
        }
        let value = serde_json::to_value(self)
            .map_err(|_| ApiError::invalid("Invalid native preset values"))?;
        if serde_json::to_vec(&value)
            .map_err(|_| ApiError::io())?
            .len()
            > 4 * 1024 * 1024
        {
            return Err(ApiError::invalid("Native preset exceeds 4 MiB"));
        }
        validate_keys(&value)
    }
}
pub fn capture(
    session: &Session,
    id: core::TimelineId,
    clip_ids: &[String],
    options: &Options,
) -> Result<Preset> {
    let timeline = &session.project.timelines[id];
    let mut refs = commands::copied_refs(timeline, clip_ids)?;
    refs.sort_by_key(|&(track, id)| (timeline.clip(track, id).unwrap().timeline_start, track));
    let first = |kind| {
        refs.iter()
            .find(|(track, _)| timeline.tracks[*track].kind == kind)
            .map(|&(track, id)| Box::new(timeline.clip(track, id).unwrap().clone()))
    };
    let preset = Preset {
        version: 1,
        name: options.name.trim().into(),
        attributes: options.attributes.clone(),
        anchor: options.anchor,
        append_filters: options.append_filters,
        shortcut: None,
        fps: timeline.fps,
        resolution: timeline.resolution,
        video: first(core::TrackKind::Video),
        audio: first(core::TrackKind::Audio),
    };
    preset.validate()?;
    Ok(preset)
}
pub fn apply(
    session: &mut Session,
    id: core::TimelineId,
    clip_ids: &[String],
    preset: &Preset,
) -> Result<()> {
    preset.validate()?;
    let timeline = &session.project.timelines[id];
    let scale = timeline.fps.as_f64() / preset.fps.as_f64();
    for (track, clip_id) in commands::copied_refs(timeline, clip_ids)? {
        let target = timeline.clip(track, clip_id).unwrap();
        let source = if timeline.tracks[track].kind == core::TrackKind::Video {
            preset.video.as_deref()
        } else {
            preset.audio.as_deref()
        };
        if let Some(source) = source {
            let source_time = commands::MAX_FRAME as f64 * source.rate().as_f64()
                + source.timeline_start as f64
                + source.source_offset as f64
                + source.timeline_len as f64
                + 1.0;
            let time = source_time
                * scale.max(target.timeline_len as f64 / source.timeline_len as f64)
                + target.timeline_start as f64
                + target.source_offset as f64
                + target.timeline_len as f64
                + 1.0;
            let limit = i64::MAX as f64 / 32.0;
            if !time.is_finite()
                || source_time > limit
                || time > limit
                || time / target.rate().as_f64() > limit
            {
                return Err(ApiError::invalid(
                    "Preset conversion exceeds native frame coordinates",
                ));
            }
        }
    }
    clipboard::apply_attributes(
        session,
        id,
        clip_ids,
        AttributeSource {
            video: preset.video.as_deref(),
            audio: preset.audio.as_deref(),
            attributes: &preset.attributes,
            skip: &[],
            mode: AttributeMode::Preset {
                format: TimelineFormat {
                    fps: preset.fps,
                    resolution: preset.resolution,
                },
                anchor: preset.anchor,
                append_filters: preset.append_filters,
            },
        },
    )
}

#[cfg(test)]
#[path = "tests/presets.rs"]
mod tests;
