use crate::{Clip, ClipAttributes, FrameIdx, Keyframed, Lerp, Rational, TransformParam};
use std::collections::HashSet;

/// Serialized in the library presets: the names must never change.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Attribute {
    Fades,
    Speed,
    BlendMode,
    Matte,
    Opacity,
    Position,
    Rotation,
    AnchorPoint,
    Zoom,
    Crop,
    CropSoftness,
    Flip,
    Filters,
    Masks,
    Transitions,
    Volume,
}

impl Attribute {
    pub const ALL: [Attribute; 16] = [
        Attribute::Zoom,
        Attribute::Position,
        Attribute::Rotation,
        Attribute::AnchorPoint,
        Attribute::Flip,
        Attribute::Crop,
        Attribute::CropSoftness,
        Attribute::BlendMode,
        Attribute::Matte,
        Attribute::Opacity,
        Attribute::Filters,
        Attribute::Masks,
        Attribute::Transitions,
        Attribute::Volume,
        Attribute::Fades,
        Attribute::Speed,
    ];

    /// Transform tracks the attribute is made of; empty for the ones that
    /// are not a transform parameter.
    fn transform_params(self) -> &'static [TransformParam] {
        match self {
            Attribute::Opacity => &[TransformParam::Opacity],
            Attribute::Position => &[TransformParam::PositionX, TransformParam::PositionY],
            Attribute::Rotation => &[TransformParam::Rotation],
            Attribute::AnchorPoint => &[TransformParam::AnchorX, TransformParam::AnchorY],
            Attribute::Zoom => &[TransformParam::ZoomX, TransformParam::ZoomY],
            Attribute::Crop => &[
                TransformParam::CropLeft,
                TransformParam::CropTop,
                TransformParam::CropRight,
                TransformParam::CropBottom,
            ],
            Attribute::CropSoftness => &[TransformParam::CropSoftness],
            _ => &[],
        }
    }
}

/// What to do with the keyframes of an attribute when source and
/// destination clips have different durations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyframeMode {
    MaintainTiming,
    StretchToFit,
}

/// The attributes of `target` with the ones selected replaced by those of
/// `source`. Durations (fades, transitions) are clamped to the target clip,
/// which can be shorter than the source one.
pub fn merge(
    source: &Clip,
    target: &Clip,
    selected: &HashSet<Attribute>,
    conversion: &Conversion,
) -> ClipAttributes {
    let mut attributes = ClipAttributes::of(target);
    let remap = &conversion.remap;
    let len = target.timeline_len.max(1);
    let duration = |frames: FrameIdx| conversion.duration(frames);
    let [sx, sy] = conversion.space_scale;
    let scaled = |track: &Keyframed<f32>, k: f32| {
        let mut track = remap.apply(track);
        if k != 1.0 {
            track.map_values(|v| v * k);
        }
        track
    };

    for attribute in selected {
        for param in attribute.transform_params() {
            let k = match param {
                TransformParam::PositionX | TransformParam::AnchorX => sx,
                TransformParam::PositionY | TransformParam::AnchorY => sy,
                _ => 1.0,
            };
            *attributes.effects.transform.track_mut(*param) =
                scaled(source.effects.transform.track(*param), k);
        }
        match attribute {
            Attribute::Fades => {
                attributes.fade_in = duration(source.fade_in).clamp(0, len);
                attributes.fade_out = duration(source.fade_out).clamp(0, len);
            }
            Attribute::BlendMode => attributes.effects.blend_mode = source.effects.blend_mode,
            Attribute::Matte => attributes.effects.matte = source.effects.matte,
            Attribute::Flip => attributes.effects.transform.flip = source.effects.transform.flip,
            Attribute::Filters => {
                let size = (sx * sy).sqrt();
                let filters = source.effects.filters.iter().map(|f| {
                    let mut filter = crate::ClipFilter {
                        radius: scaled(&f.radius, size),
                        direction: remap.apply(&f.direction),
                        amount: remap.apply(&f.amount),
                        offset: [scaled(&f.offset[0], sx), scaled(&f.offset[1], sy)],
                        grow: scaled(&f.grow, size),
                        ..f.clone()
                    };
                    for track in filter.grade.tracks_mut() {
                        *track = remap.apply(track);
                    }
                    filter
                });
                if conversion.append_filters {
                    attributes.effects.filters.extend(filters);
                } else {
                    attributes.effects.filters = filters.collect();
                }
            }
            Attribute::Masks => {
                attributes.effects.masks = source.effects.masks.clone();
                for mask in &mut attributes.effects.masks {
                    for track in mask.tracks_mut() {
                        *track = remap.apply(track);
                    }
                    mask.path = remap.apply(&mask.path);
                }
            }
            Attribute::Transitions => {
                let clamped = |t: &Option<crate::Transition>| {
                    t.clone().map(|mut t| {
                        t.duration = duration(t.duration).clamp(1, len);
                        t
                    })
                };
                attributes.effects.transition_in = clamped(&source.effects.transition_in);
                attributes.effects.transition_out = clamped(&source.effects.transition_out);
            }
            Attribute::Volume => {
                attributes.effects.gain_db = remap.apply(&source.effects.gain_db);
            }
            _ => {}
        }
    }
    attributes
}

/// Where a preset's keyframes are pinned on a clip of another length.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyframeAnchor {
    Start,
    End,
    Stretch,
}

/// How the values of a source clip are brought onto a target clip.
pub struct Conversion {
    remap: KeyframeRemap,
    /// Target fps over source fps, for the durations in timeline frames.
    time_scale: f64,
    /// Target resolution over source resolution, per axis, for the values
    /// in timeline pixels.
    space_scale: [f32; 2],
    append_filters: bool,
}

/// The timeline a preset's source clip lived in.
#[derive(Clone, Copy)]
pub struct TimelineFormat {
    pub fps: Rational,
    pub resolution: (u32, u32),
}

impl Conversion {
    pub fn paste(source: &Clip, target: &Clip, mode: KeyframeMode) -> Self {
        Self {
            remap: KeyframeRemap::source_frames(source, target, mode),
            time_scale: 1.0,
            space_scale: [1.0, 1.0],
            append_filters: false,
        }
    }

    /// Keyframes keep their *time* from the anchor, so they survive a
    /// different fps, speed or media fps.
    pub fn preset(
        source: &Clip,
        from: TimelineFormat,
        target: &Clip,
        to: TimelineFormat,
        anchor: KeyframeAnchor,
        append_filters: bool,
    ) -> Self {
        let time_scale = to.fps.as_f64() / from.fps.as_f64().max(1e-9);
        let axis = |to: u32, from: u32| to as f32 / from.max(1) as f32;
        Self {
            remap: KeyframeRemap::Anchored {
                source: Box::new(source.clone()),
                target: Box::new(target.clone()),
                time_scale,
                anchor,
            },
            time_scale,
            space_scale: [
                axis(to.resolution.0, from.resolution.0),
                axis(to.resolution.1, from.resolution.1),
            ],
            append_filters,
        }
    }

    fn duration(&self, frames: FrameIdx) -> FrameIdx {
        (frames as f64 * self.time_scale).round() as FrameIdx
    }
}

/// Source frames of the keyframes of `source` brought into the space of
/// `target`: the clips can start at a different point of their media and
/// last a different time.
enum KeyframeRemap {
    SourceFrames {
        source_in: FrameIdx,
        target_in: FrameIdx,
        target_out: FrameIdx,
        /// `None` keeps the distances from the start of the clip (Maintain Timing).
        scale: Option<f64>,
    },
    Anchored {
        source: Box<Clip>,
        target: Box<Clip>,
        time_scale: f64,
        anchor: KeyframeAnchor,
    },
}

impl KeyframeRemap {
    fn source_frames(source: &Clip, target: &Clip, mode: KeyframeMode) -> Self {
        let scale = match mode {
            KeyframeMode::MaintainTiming => None,
            KeyframeMode::StretchToFit => {
                Some(target.source_len().max(1) as f64 / source.source_len().max(1) as f64)
            }
        };
        Self::SourceFrames {
            source_in: source.source_in(),
            target_in: target.source_in(),
            target_out: target.source_out(),
            scale,
        }
    }

    fn target_range(&self) -> std::ops::Range<FrameIdx> {
        match self {
            Self::SourceFrames {
                target_in,
                target_out,
                ..
            } => *target_in..*target_out,
            Self::Anchored { target, .. } => target.source_in()..target.source_out(),
        }
    }

    fn frame(&self, frame: FrameIdx) -> FrameIdx {
        match self {
            Self::SourceFrames {
                source_in,
                target_in,
                scale,
                ..
            } => {
                let offset = frame - source_in;
                let offset = match scale {
                    Some(scale) => (offset as f64 * scale).round() as FrameIdx,
                    None => offset,
                };
                target_in + offset
            }
            Self::Anchored {
                source,
                target,
                time_scale,
                anchor,
            } => {
                let offset = source.timeline_frame_at(frame) - source.timeline_start;
                let rescale = |frames: FrameIdx| (frames as f64 * time_scale).round() as FrameIdx;
                let offset = match anchor {
                    KeyframeAnchor::Start => rescale(offset),
                    KeyframeAnchor::End => {
                        target.timeline_len + rescale(offset - source.timeline_len)
                    }
                    KeyframeAnchor::Stretch => (offset as f64 * target.timeline_len as f64
                        / source.timeline_len.max(1) as f64)
                        .round() as FrameIdx,
                };
                target.source_frame_at(target.timeline_start + offset)
            }
        }
    }

    /// Keyframes outside the target clip are cut as a trim would: the
    /// animation keeps the value it has at the edges of the clip.
    fn apply<T: Lerp + Clone + PartialEq>(&self, track: &Keyframed<T>) -> Keyframed<T> {
        let range = self.target_range();
        let mut out = Keyframed::constant(track.default.clone());
        for (frame, value, interpolation) in track.keyframes() {
            out.upsert(self.frame(*frame), value.clone(), *interpolation);
        }
        out.drop_before(range.start);
        out.drop_from(range.end);
        out
    }
}

#[cfg(test)]
#[path = "tests/attributes.rs"]
mod tests;
