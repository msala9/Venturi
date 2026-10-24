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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleField {
    Text,
    FontFamily,
    FontWeight,
    Italic,
    Size,
    Tracking,
    LineSpacing,
    Underline,
    Strikethrough,
    Case,
    Align,
    Anchor,
    Position,
    Color,
    Background,
    BackgroundEnabled,
    BackgroundColor,
    BackgroundOutlineColor,
    BackgroundOutlineWidth,
    BackgroundWidth,
    BackgroundHeight,
    BackgroundCornerRadius,
    BackgroundCenter,
    BackgroundOpacity,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FilterParameter {
    Radius {},
    Direction {},
    Amount {},
    Grow {},
    Offset { axis: usize },
    Grade { param: core::GradeParam },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum InspectorEdit {
    Transform {
        parameters: Vec<Parameter>,
    },
    Flip {
        axis: usize,
        enabled: bool,
    },
    ToggleTransformKeys {
        params: Vec<TransformParam>,
    },
    ResetTransform {
        params: Vec<TransformParam>,
        reset_flip: bool,
    },
    Gain {
        value: f32,
    },
    ToggleGainKey {},
    ResetGain {},
    ResetCompositing {},
    Title {
        patch: Box<TitleEdit>,
    },
    ToggleTextKey {},
    TitleShadow {
        enabled: bool,
    },
    ResetTitle {
        fields: Vec<TitleField>,
    },
    SolidColor {
        value: core::Rgba,
    },
    ToggleColorKey {},
    Filter {
        filter: core::FilterKind,
        patch: Box<crate::visual::FilterPatch>,
    },
    FilterPresence {
        filter: core::FilterKind,
        enabled: bool,
    },
    FilterMove {
        filter: core::FilterKind,
        to_index: usize,
    },
    ToggleFilterKeys {
        filter: core::FilterKind,
        params: Vec<FilterParameter>,
    },
    ResetFilter {
        filter: core::FilterKind,
        params: Vec<FilterParameter>,
        reset_enabled: bool,
        reset_color: bool,
        reset_grade: bool,
    },
    GradePreset {
        preset: String,
    },
}

fn changed_title(
    target: &core::TitleParams,
    before: &core::TitleParams,
    after: &core::TitleParams,
) -> core::TitleParams {
    let mut out = target.clone();
    macro_rules! fields {
        ($($field:ident),*) => {$(if before.$field != after.$field { out.$field = after.$field; })*};
    }
    if before.font_family != after.font_family {
        out.font_family = after.font_family.clone();
    }
    fields!(
        font_weight,
        italic,
        size,
        tracking,
        line_spacing,
        underline,
        strikethrough,
        case,
        align,
        anchor,
        position,
        color
    );
    macro_rules! background {
        ($($field:ident),*) => {$(if before.background.$field != after.background.$field { out.background.$field = after.background.$field; })*};
    }
    background!(
        enabled,
        color,
        outline_color,
        outline_width,
        width,
        height,
        corner_radius,
        center,
        opacity
    );
    if before.content != after.content && target.content.is_constant() {
        out.content = after.content.clone();
    }
    out
}

fn reset_title_fields(title: &mut core::TitleParams, fields: &[TitleField]) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    if fields.is_empty() || fields.len() > 24 || fields.iter().any(|field| !seen.insert(*field)) {
        return Err(ApiError::invalid("Choose distinct native title fields"));
    }
    let defaults = core::TitleParams::default();
    for field in fields {
        match field {
            TitleField::Text => title.content = defaults.content.clone(),
            TitleField::FontFamily => title.font_family = defaults.font_family.clone(),
            TitleField::FontWeight => title.font_weight = defaults.font_weight,
            TitleField::Italic => title.italic = defaults.italic,
            TitleField::Size => title.size = defaults.size,
            TitleField::Tracking => title.tracking = defaults.tracking,
            TitleField::LineSpacing => title.line_spacing = defaults.line_spacing,
            TitleField::Underline => title.underline = defaults.underline,
            TitleField::Strikethrough => title.strikethrough = defaults.strikethrough,
            TitleField::Case => title.case = defaults.case,
            TitleField::Align => title.align = defaults.align,
            TitleField::Anchor => title.anchor = defaults.anchor,
            TitleField::Position => title.position = defaults.position,
            TitleField::Color => title.color = defaults.color,
            TitleField::Background => {
                title.background = core::TitleBackground {
                    enabled: title.background.enabled,
                    ..defaults.background.clone()
                };
            }
            TitleField::BackgroundEnabled => title.background.enabled = defaults.background.enabled,
            TitleField::BackgroundColor => title.background.color = defaults.background.color,
            TitleField::BackgroundOutlineColor => {
                title.background.outline_color = defaults.background.outline_color
            }
            TitleField::BackgroundOutlineWidth => {
                title.background.outline_width = defaults.background.outline_width
            }
            TitleField::BackgroundWidth => title.background.width = defaults.background.width,
            TitleField::BackgroundHeight => title.background.height = defaults.background.height,
            TitleField::BackgroundCornerRadius => {
                title.background.corner_radius = defaults.background.corner_radius
            }
            TitleField::BackgroundCenter => title.background.center = defaults.background.center,
            TitleField::BackgroundOpacity => title.background.opacity = defaults.background.opacity,
        }
    }
    Ok(())
}

impl FilterParameter {
    fn validate(self, kind: core::FilterKind) -> Result<()> {
        let valid = match self {
            Self::Radius {} => kind.is_blur() || kind == core::FilterKind::DropShadow,
            Self::Direction {} => kind.is_blur(),
            Self::Amount {} => crate::visual::amount_range(kind).is_ok(),
            Self::Grow {} => kind == core::FilterKind::DropShadow,
            Self::Offset { axis } => kind == core::FilterKind::DropShadow && axis < 2,
            Self::Grade { .. } => kind == core::FilterKind::ColorCorrection,
        };
        if !valid {
            return Err(ApiError::invalid(
                "That row does not belong to the native filter",
            ));
        }
        Ok(())
    }
    fn scalar(self, filter: &core::ClipFilter) -> Option<&core::Keyframed<f32>> {
        match self {
            Self::Radius {} => Some(&filter.radius),
            Self::Amount {} => Some(&filter.amount),
            Self::Grow {} => Some(&filter.grow),
            Self::Offset { axis } => Some(&filter.offset[axis]),
            Self::Grade { param } => Some(filter.grade.track(param)),
            Self::Direction {} => None,
        }
    }
    fn scalar_mut(self, filter: &mut core::ClipFilter) -> Option<&mut core::Keyframed<f32>> {
        match self {
            Self::Radius {} => Some(&mut filter.radius),
            Self::Amount {} => Some(&mut filter.amount),
            Self::Grow {} => Some(&mut filter.grow),
            Self::Offset { axis } => Some(&mut filter.offset[axis]),
            Self::Grade { param } => Some(filter.grade.track_mut(param)),
            Self::Direction {} => None,
        }
    }
    fn target(self, kind: core::FilterKind) -> core::KeyframeTarget {
        match self {
            Self::Radius {} => core::KeyframeTarget::FilterRadius(kind),
            Self::Direction {} => core::KeyframeTarget::FilterDirection(kind),
            Self::Amount {} => core::KeyframeTarget::FilterAmount(kind),
            Self::Grow {} => core::KeyframeTarget::FilterGrow(kind),
            Self::Offset { axis } => core::KeyframeTarget::FilterOffset(
                kind,
                if axis == 0 {
                    core::Axis::X
                } else {
                    core::Axis::Y
                },
            ),
            Self::Grade { param } => core::KeyframeTarget::Grade(param),
        }
    }
    fn value(self, filter: &core::ClipFilter, frame: i64) -> core::KeyframeValue {
        match self {
            Self::Radius {} => {
                core::KeyframeValue::FilterRadius(filter.kind, filter.radius.value_at(frame))
            }
            Self::Direction {} => {
                core::KeyframeValue::FilterDirection(filter.kind, filter.direction.value_at(frame))
            }
            Self::Amount {} => {
                core::KeyframeValue::FilterAmount(filter.kind, filter.amount.value_at(frame))
            }
            Self::Grow {} => {
                core::KeyframeValue::FilterGrow(filter.kind, filter.grow.value_at(frame))
            }
            Self::Offset { axis } => core::KeyframeValue::FilterOffset(
                filter.kind,
                if axis == 0 {
                    core::Axis::X
                } else {
                    core::Axis::Y
                },
                filter.offset[axis].value_at(frame),
            ),
            Self::Grade { param } => {
                core::KeyframeValue::Grade(param, filter.grade.track(param).value_at(frame))
            }
        }
    }
    fn on_key(self, filter: &core::ClipFilter, frame: i64) -> bool {
        match self {
            Self::Direction {} => filter.direction.keyframe_at(frame).is_some(),
            _ => self
                .scalar(filter)
                .is_some_and(|value| value.keyframe_at(frame).is_some()),
        }
    }
    fn range(self, kind: core::FilterKind) -> Result<(f32, f32)> {
        Ok(match self {
            Self::Radius {} => (0.0, core::BLUR_RADIUS_MAX),
            Self::Amount {} => crate::visual::amount_range(kind)?,
            Self::Grow {} => (0.0, core::SHADOW_GROW_MAX),
            Self::Offset { .. } => (-8192.0, 8192.0),
            Self::Grade { param } => (*param.range().start(), *param.range().end()),
            Self::Direction {} => return Err(ApiError::invalid("Direction is a native enum")),
        })
    }
}

fn filter_params(
    kind: core::FilterKind,
    params: &[FilterParameter],
    allow_empty: bool,
) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    if (!allow_empty && params.is_empty())
        || params.len() > 24
        || params.iter().any(|param| !seen.insert(*param))
    {
        return Err(ApiError::invalid("Choose distinct native filter rows"));
    }
    for param in params {
        param.validate(kind)?;
    }
    Ok(())
}

fn selected_content_commands(
    id: TimelineId,
    targets: &[(usize, ClipId, &Clip, i64)],
    edit: &InspectorEdit,
    commands: &mut Vec<Box<dyn Command>>,
) -> Result<()> {
    let (_, _, primary, primary_frame) = targets[0];
    match edit {
        InspectorEdit::TitleShadow { enabled } => {
            if !matches!(primary.source, ClipSource::Text) || primary.effects.title.is_none() {
                return Err(ApiError::invalid(
                    "The native primary video clip must be a title",
                ));
            }
            for &(track, clip_id, clip, _) in targets {
                if !matches!(clip.source, ClipSource::Text) {
                    continue;
                }
                let mut filters = clip.effects.filters.clone();
                let kind = core::FilterKind::DropShadow;
                if *enabled && !filters.iter().any(|filter| filter.kind == kind) {
                    filters.push(core::ClipFilter::new(kind));
                }
                if !*enabled {
                    filters.retain(|filter| filter.kind != kind);
                }
                if filters != clip.effects.filters {
                    commands.push(Box::new(core::set_clip_filters(
                        id, track, clip_id, filters,
                    )));
                }
            }
        }
        InspectorEdit::Title { .. }
        | InspectorEdit::ResetTitle { .. }
        | InspectorEdit::ToggleTextKey {} => {
            if !matches!(primary.source, ClipSource::Text) || primary.effects.title.is_none() {
                return Err(ApiError::invalid(
                    "The native primary video clip must be a title",
                ));
            }
            let before = primary.effects.title.as_ref().unwrap().at(primary_frame);
            let mut after = before.clone();
            match edit {
                InspectorEdit::Title { patch } => after = patch_title(after, patch)?,
                InspectorEdit::ResetTitle { fields } => reset_title_fields(&mut after, fields)?,
                _ => {}
            }
            for &(track, clip_id, clip, frame) in targets {
                if !matches!(clip.source, ClipSource::Text) {
                    continue;
                }
                let Some(current) = clip.effects.title.as_ref() else {
                    continue;
                };
                let edited = changed_title(current, &before, &after);
                if edited != *current {
                    commands.push(Box::new(core::set_clip_title(id, track, clip_id, edited)));
                }
                if matches!(edit, InspectorEdit::ToggleTextKey {}) {
                    if current.content.keyframe_at(frame).is_some() {
                        commands.push(Box::new(core::RemoveKeyframe::new(
                            id,
                            track,
                            clip_id,
                            core::KeyframeTarget::Text,
                            frame,
                        )));
                    } else {
                        commands.push(Box::new(core::UpsertKeyframe::new(
                            id,
                            track,
                            clip_id,
                            frame,
                            core::KeyframeValue::Text(current.content.value_at(frame)),
                            core::Interpolation::Hold,
                        )));
                    }
                } else if before.content != after.content && !current.content.is_constant() {
                    commands.push(Box::new(core::UpsertKeyframe::new(
                        id,
                        track,
                        clip_id,
                        frame,
                        core::KeyframeValue::Text(after.content.default.clone()),
                        core::Interpolation::Hold,
                    )));
                }
            }
        }
        InspectorEdit::SolidColor { .. } | InspectorEdit::ToggleColorKey {} => {
            if !matches!(primary.source, ClipSource::SolidColor) {
                return Err(ApiError::invalid(
                    "The native primary video clip must be a solid",
                ));
            }
            let primary_color = primary.effects.color.as_ref();
            let before = primary_color.map_or(core::edit::DEFAULT_SOLID_COLOR, |color| {
                color.value_at(primary_frame)
            });
            let value = if let InspectorEdit::SolidColor { value } = edit {
                rgba(*value)?;
                Some(*value)
            } else {
                None
            };
            let remove =
                primary_color.is_some_and(|color| color.keyframe_at(primary_frame).is_some());
            for &(track, clip_id, clip, frame) in targets {
                if !matches!(clip.source, ClipSource::SolidColor) {
                    continue;
                }
                let color = clip.effects.color.as_ref();
                if let Some(value) = value {
                    if value == before {
                        continue;
                    }
                    commands.push(if color.is_none_or(|color| color.is_constant()) {
                        Box::new(core::SetClipColor::new(id, track, clip_id, value))
                            as Box<dyn Command>
                    } else {
                        Box::new(core::UpsertKeyframe::new(
                            id,
                            track,
                            clip_id,
                            frame,
                            core::KeyframeValue::Color(value),
                            core::Interpolation::Linear,
                        ))
                    });
                } else if remove {
                    commands.push(Box::new(core::RemoveKeyframe::new(
                        id,
                        track,
                        clip_id,
                        core::KeyframeTarget::Color,
                        frame,
                    )));
                } else {
                    if color.is_none() {
                        commands.push(Box::new(core::SetClipColor::new(
                            id,
                            track,
                            clip_id,
                            core::edit::DEFAULT_SOLID_COLOR,
                        )));
                    }
                    let own = color.map_or(before, |color| color.value_at(frame));
                    rgba(own)?;
                    commands.push(Box::new(core::UpsertKeyframe::new(
                        id,
                        track,
                        clip_id,
                        frame,
                        core::KeyframeValue::Color(own),
                        core::Interpolation::Linear,
                    )));
                }
            }
        }
        _ => selected_filter_commands(id, targets, edit, commands)?,
    }
    Ok(())
}

fn validate_filter_patch(
    kind: core::FilterKind,
    patch: &crate::visual::FilterPatch,
) -> Result<Vec<(FilterParameter, f32)>> {
    let mut values = Vec::new();
    for (param, value) in [
        (FilterParameter::Radius {}, patch.radius),
        (FilterParameter::Amount {}, patch.amount),
        (FilterParameter::Grow {}, patch.grow),
    ] {
        if let Some(value) = value {
            values.push((param, value));
        }
    }
    if let Some(offset) = patch.offset {
        for (axis, value) in offset.into_iter().enumerate() {
            values.push((FilterParameter::Offset { axis }, value));
        }
    }
    for value in &patch.grade {
        values.push((FilterParameter::Grade { param: value.param }, value.value));
    }
    let params: Vec<_> = values.iter().map(|(param, _)| *param).collect();
    filter_params(kind, &params, true)?;
    for &(param, value) in &values {
        bounded(value, param.range(kind)?)?;
    }
    if patch.direction.is_some() {
        FilterParameter::Direction {}.validate(kind)?;
    }
    if let Some(color) = patch.color {
        if kind != core::FilterKind::DropShadow {
            return Err(ApiError::invalid("Only DropShadow has a color"));
        }
        rgba(color)?;
    }
    Ok(values)
}

fn validate_filter_grade(filter: &core::ClipFilter, frame: i64) -> Result<()> {
    if filter.kind == core::FilterKind::ColorCorrection {
        for wheel in core::GradeWheel::ALL {
            let x = filter.grade.track(wheel.x()).value_at(frame);
            let y = filter.grade.track(wheel.y()).value_at(frame);
            if !x.is_finite() || !y.is_finite() || x * x + y * y > 1.000001 {
                return Err(ApiError::invalid(
                    "Grade wheel offsets must stay inside the unit disc",
                ));
            }
        }
    }
    Ok(())
}

fn selected_filter_commands(
    id: TimelineId,
    targets: &[(usize, ClipId, &Clip, i64)],
    edit: &InspectorEdit,
    commands: &mut Vec<Box<dyn Command>>,
) -> Result<()> {
    let (_, _, primary, primary_frame) = targets[0];
    let kind = match edit {
        InspectorEdit::Filter { filter, .. }
        | InspectorEdit::FilterPresence { filter, .. }
        | InspectorEdit::FilterMove { filter, .. }
        | InspectorEdit::ToggleFilterKeys { filter, .. }
        | InspectorEdit::ResetFilter { filter, .. } => *filter,
        InspectorEdit::GradePreset { .. } => core::FilterKind::ColorCorrection,
        _ => return Err(ApiError::invalid("Unknown selected Inspector action")),
    };
    let primary_filter = primary
        .effects
        .filters
        .iter()
        .find(|filter| filter.kind == kind);
    if !matches!(edit, InspectorEdit::FilterPresence { .. }) && primary_filter.is_none() {
        return Err(ApiError::invalid(
            "The native primary clip must already have that filter",
        ));
    }
    let patch_values = if let InspectorEdit::Filter { patch, .. } = edit {
        validate_filter_patch(kind, patch)?
    } else {
        Vec::new()
    };
    let preset = if let InspectorEdit::GradePreset { preset } = edit {
        Some(
            core::GradePreset::ALL
                .into_iter()
                .find(|value| format!("{value:?}") == *preset)
                .ok_or_else(|| ApiError::invalid("Unknown native grade preset"))?,
        )
    } else {
        None
    };
    match edit {
        InspectorEdit::ToggleFilterKeys { params, .. } => filter_params(kind, params, false)?,
        InspectorEdit::ResetFilter {
            params,
            reset_enabled,
            reset_color,
            reset_grade,
            ..
        } => {
            filter_params(kind, params, *reset_enabled || *reset_color || *reset_grade)?;
            if (*reset_color && kind != core::FilterKind::DropShadow)
                || (*reset_grade && kind != core::FilterKind::ColorCorrection)
            {
                return Err(ApiError::invalid(
                    "Reset fields do not belong to this native filter",
                ));
            }
        }
        _ => {}
    }
    for &(track, clip_id, clip, frame) in targets {
        let mut filters = clip.effects.filters.clone();
        let existing = filters.iter().position(|filter| filter.kind == kind);
        if let InspectorEdit::FilterPresence { enabled, .. } = edit {
            if *enabled && existing.is_none() {
                filters.push(core::ClipFilter::new(kind));
            }
            if !*enabled {
                filters.retain(|filter| filter.kind != kind);
            }
        } else if let Some(index) = existing {
            if let InspectorEdit::FilterMove { to_index, .. } = edit {
                if *to_index >= filters.len() {
                    return Err(ApiError::invalid(
                        "Filter destination is outside a selected stack",
                    ));
                }
                let filter = filters.remove(index);
                filters.insert(*to_index, filter);
            } else {
                let own = &mut filters[index];
                let before = own.clone();
                let primary_filter = primary_filter.unwrap();
                let mut keys: Vec<Box<dyn Command>> = Vec::new();
                match edit {
                    InspectorEdit::Filter { patch, .. } => {
                        if let Some(enabled) = patch.enabled
                            && enabled != primary_filter.enabled
                        {
                            own.enabled = enabled;
                        }
                        if let Some(color) = patch.color
                            && color != primary_filter.color
                        {
                            own.color = color;
                        }
                        for &(param, value) in &patch_values {
                            if param
                                .scalar(primary_filter)
                                .unwrap()
                                .value_at(primary_frame)
                                == value
                            {
                                continue;
                            }
                            let animated = if let FilterParameter::Grade { param } = param {
                                core::GradeWheel::of(param).map_or_else(
                                    || !before.grade.track(param).is_constant(),
                                    |wheel| {
                                        wheel
                                            .params()
                                            .iter()
                                            .any(|p| !before.grade.track(*p).is_constant())
                                    },
                                )
                            } else {
                                !param.scalar(&before).unwrap().is_constant()
                            };
                            if animated {
                                let key = match param {
                                    FilterParameter::Radius {} => {
                                        core::KeyframeValue::FilterRadius(kind, value)
                                    }
                                    FilterParameter::Amount {} => {
                                        core::KeyframeValue::FilterAmount(kind, value)
                                    }
                                    FilterParameter::Grow {} => {
                                        core::KeyframeValue::FilterGrow(kind, value)
                                    }
                                    FilterParameter::Offset { axis } => {
                                        core::KeyframeValue::FilterOffset(
                                            kind,
                                            if axis == 0 {
                                                core::Axis::X
                                            } else {
                                                core::Axis::Y
                                            },
                                            value,
                                        )
                                    }
                                    FilterParameter::Grade { param } => {
                                        core::KeyframeValue::Grade(param, value)
                                    }
                                    FilterParameter::Direction {} => unreachable!(),
                                };
                                keys.push(Box::new(core::UpsertKeyframe::new(
                                    id,
                                    track,
                                    clip_id,
                                    frame,
                                    key,
                                    core::Interpolation::Linear,
                                )));
                            } else {
                                param.scalar_mut(own).unwrap().default = value;
                            }
                        }
                        if let Some(direction) = patch.direction
                            && direction != primary_filter.direction.value_at(primary_frame)
                        {
                            if before.direction.is_constant() {
                                own.direction.default = direction;
                            } else {
                                keys.push(Box::new(core::UpsertKeyframe::new(
                                    id,
                                    track,
                                    clip_id,
                                    frame,
                                    core::KeyframeValue::FilterDirection(kind, direction),
                                    core::Interpolation::Linear,
                                )));
                            }
                        }
                        let mut evaluated = own.clone();
                        for &(param, value) in &patch_values {
                            if param
                                .scalar(primary_filter)
                                .unwrap()
                                .value_at(primary_frame)
                                != value
                            {
                                param.scalar_mut(&mut evaluated).unwrap().upsert(
                                    frame,
                                    value,
                                    core::Interpolation::Linear,
                                );
                            }
                        }
                        validate_filter_grade(&evaluated, frame)?;
                    }
                    InspectorEdit::ToggleFilterKeys { params, .. } => {
                        let remove = params
                            .iter()
                            .any(|param| param.on_key(primary_filter, primary_frame));
                        let mut evaluated = before.clone();
                        for &param in params {
                            if let Some(values) = param.scalar(&before) {
                                bounded(values.value_at(frame), param.range(kind)?)?;
                            }
                            if remove {
                                if matches!(param, FilterParameter::Direction {}) {
                                    evaluated.direction.remove_at(frame);
                                } else {
                                    param.scalar_mut(&mut evaluated).unwrap().remove_at(frame);
                                }
                                if let Some(values) = param.scalar(&evaluated) {
                                    bounded(values.value_at(frame), param.range(kind)?)?;
                                }
                                keys.push(Box::new(core::RemoveKeyframe::new(
                                    id,
                                    track,
                                    clip_id,
                                    param.target(kind),
                                    frame,
                                )));
                            } else {
                                keys.push(Box::new(core::UpsertKeyframe::new(
                                    id,
                                    track,
                                    clip_id,
                                    frame,
                                    param.value(&before, frame),
                                    core::Interpolation::Linear,
                                )));
                            }
                        }
                        validate_filter_grade(&evaluated, frame)?;
                    }
                    InspectorEdit::ResetFilter {
                        params,
                        reset_enabled,
                        reset_color,
                        reset_grade,
                        ..
                    } => {
                        let defaults = core::ClipFilter::new(kind);
                        for &param in params {
                            if matches!(param, FilterParameter::Direction {}) {
                                own.direction = defaults.direction.clone();
                            } else {
                                *param.scalar_mut(own).unwrap() =
                                    param.scalar(&defaults).unwrap().clone();
                            }
                        }
                        if *reset_enabled {
                            own.enabled = true;
                        }
                        if *reset_color {
                            own.color = defaults.color;
                        }
                        if *reset_grade {
                            own.grade = defaults.grade;
                        }
                        validate_filter_grade(own, frame)?;
                    }
                    InspectorEdit::GradePreset { .. } => own.grade.apply_preset(preset.unwrap()),
                    _ => {}
                }
                if filters != clip.effects.filters {
                    commands.push(Box::new(core::set_clip_filters(
                        id, track, clip_id, filters,
                    )));
                }
                commands.append(&mut keys);
                continue;
            }
        }
        if filters != clip.effects.filters {
            commands.push(Box::new(core::set_clip_filters(
                id, track, clip_id, filters,
            )));
        }
    }
    Ok(())
}

fn inspector_params(params: &[TransformParam], allow_empty: bool) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    if (!allow_empty && params.is_empty())
        || params.len() > TransformParam::ALL.len()
        || params.iter().any(|param| !seen.insert(*param))
    {
        return Err(ApiError::invalid("Choose distinct native Inspector axes"));
    }
    Ok(())
}

fn inspector_crop(size: (u32, u32), clip: &Clip, frame: i64, values: &[Parameter]) -> Result<()> {
    let params = [
        TransformParam::CropLeft,
        TransformParam::CropTop,
        TransformParam::CropRight,
        TransformParam::CropBottom,
    ];
    if !values.iter().any(|value| params.contains(&value.param)) {
        return Ok(());
    }
    let crop = params.map(|param| {
        values
            .iter()
            .find(|value| value.param == param)
            .map_or_else(
                || clip.effects.transform.track(param).value_at(frame),
                |value| value.value,
            )
    });
    if size.0 == 0
        || size.1 == 0
        || crop.iter().any(|value| !value.is_finite() || *value < 0.0)
        || crop[0] + crop[2] > size.0.saturating_sub(1) as f32
        || crop[1] + crop[3] > size.1.saturating_sub(1) as f32
    {
        return Err(ApiError::invalid(
            "Inspector crop must retain at least one source pixel per axis",
        ));
    }
    Ok(())
}

pub fn edit_selection(
    session: &mut Session,
    id: TimelineId,
    clip_ids: &[String],
    timeline_frame: i64,
    edit: &InspectorEdit,
) -> Result<()> {
    if clip_ids.is_empty()
        || clip_ids.len() > 4096
        || !(0..=crate::commands::MAX_FRAME).contains(&timeline_frame)
    {
        return Err(ApiError::invalid(
            "Choose 1 to 4096 Inspector clips and a bounded timeline frame",
        ));
    }
    let audio = matches!(
        edit,
        InspectorEdit::Gain { .. } | InspectorEdit::ToggleGainKey {} | InspectorEdit::ResetGain {}
    );
    let mut seen = std::collections::HashSet::new();
    let mut targets = Vec::with_capacity(clip_ids.len());
    for raw in clip_ids {
        if raw.is_empty() || raw.len() > 20 || !raw.bytes().all(|value| value.is_ascii_digit()) {
            return Err(ApiError::invalid("Invalid Inspector clip ID"));
        }
        let (track, clip_id, clip) = find(session, id, raw)?;
        if !seen.insert(clip_id) {
            return Err(ApiError::invalid("Duplicate Inspector clip"));
        }
        writable(session, id, track)?;
        if (session.project.timelines[id].tracks[track].kind == core::TrackKind::Audio) != audio {
            return Err(ApiError::invalid(
                "Inspector targets must match the selected property tab",
            ));
        }
        let end = clip
            .timeline_start
            .checked_add(clip.timeline_len)
            .filter(|_| clip.timeline_len > 0)
            .ok_or_else(|| ApiError::invalid("Invalid Inspector clip range"))?;
        let frame = clip.source_frame_at(timeline_frame.clamp(clip.timeline_start, end - 1));
        if !(0..=crate::commands::MAX_FRAME).contains(&frame) {
            return Err(ApiError::invalid("Inspector source frame is out of range"));
        }
        targets.push((track, clip_id, clip, frame));
    }
    targets.sort_by_key(|(track, clip_id, clip, _)| (*track, clip.timeline_start, *clip_id));
    let (_, _, primary, primary_frame) = targets[0];
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    match edit {
        InspectorEdit::Transform { parameters } => {
            let params: Vec<_> = parameters.iter().map(|value| value.param).collect();
            inspector_params(&params, false)?;
            for parameter in parameters {
                bounded(
                    parameter.value,
                    limits(parameter.param, size(session, id, primary)),
                )?;
            }
            let changed: Vec<_> = parameters
                .iter()
                .filter(|parameter| {
                    parameter.value
                        != primary
                            .effects
                            .transform
                            .track(parameter.param)
                            .value_at(primary_frame)
                })
                .collect();
            for &(track, clip_id, clip, frame) in &targets {
                let mut values = Vec::with_capacity(changed.len());
                for parameter in &changed {
                    let current = clip.effects.transform.track(parameter.param);
                    let value = match parameter.param {
                        TransformParam::PositionX | TransformParam::PositionY => {
                            current.value_at(frame) + parameter.value
                                - primary
                                    .effects
                                    .transform
                                    .track(parameter.param)
                                    .value_at(primary_frame)
                        }
                        _ => parameter.value,
                    };
                    bounded(value, limits(parameter.param, size(session, id, clip)))?;
                    values.push(Parameter {
                        param: parameter.param,
                        value,
                    });
                    commands.push(if current.is_constant() {
                        Box::new(core::set_clip_transform_param(
                            id,
                            track,
                            clip_id,
                            parameter.param,
                            value,
                        )) as Box<dyn Command>
                    } else {
                        Box::new(core::UpsertKeyframe::new(
                            id,
                            track,
                            clip_id,
                            frame,
                            core::KeyframeValue::TransformParam(parameter.param, value),
                            core::Interpolation::Linear,
                        ))
                    });
                }
                inspector_crop(size(session, id, clip), clip, frame, &values)?;
            }
        }
        InspectorEdit::Flip { axis, enabled } => {
            if *axis > 1 {
                return Err(ApiError::invalid("Choose horizontal or vertical flip"));
            }
            if primary.effects.transform.flip[*axis] != *enabled {
                for &(track, clip_id, clip, _) in &targets {
                    let mut flip = clip.effects.transform.flip;
                    flip[*axis] = *enabled;
                    commands.push(Box::new(core::set_clip_flip(id, track, clip_id, flip)));
                }
            }
        }
        InspectorEdit::ToggleTransformKeys { params } => {
            inspector_params(params, false)?;
            let remove = params.iter().any(|param| {
                primary
                    .effects
                    .transform
                    .track(*param)
                    .keyframe_at(primary_frame)
                    .is_some()
            });
            for &(track, clip_id, clip, frame) in &targets {
                let mut values = Vec::with_capacity(params.len());
                for &param in params {
                    let current = clip.effects.transform.track(param);
                    let value = if remove {
                        let mut reduced = current.clone();
                        reduced.remove_at(frame);
                        reduced.value_at(frame)
                    } else {
                        current.value_at(frame)
                    };
                    bounded(value, limits(param, size(session, id, clip)))?;
                    values.push(Parameter { param, value });
                    commands.push(if remove {
                        Box::new(core::RemoveKeyframe::new(
                            id,
                            track,
                            clip_id,
                            core::KeyframeTarget::TransformParam(param),
                            frame,
                        )) as Box<dyn Command>
                    } else {
                        Box::new(core::UpsertKeyframe::new(
                            id,
                            track,
                            clip_id,
                            frame,
                            core::KeyframeValue::TransformParam(param, value),
                            core::Interpolation::Linear,
                        ))
                    });
                }
                inspector_crop(size(session, id, clip), clip, frame, &values)?;
            }
        }
        InspectorEdit::ResetTransform { params, reset_flip } => {
            inspector_params(params, *reset_flip)?;
            let defaults = core::Transform::default();
            let values: Vec<_> = params
                .iter()
                .map(|param| Parameter {
                    param: *param,
                    value: param.of(&defaults),
                })
                .collect();
            for &(track, clip_id, clip, frame) in &targets {
                inspector_crop(size(session, id, clip), clip, frame, &values)?;
                commands.push(Box::new(core::ResetTransformParams::new(
                    id,
                    track,
                    clip_id,
                    params.clone(),
                    *reset_flip,
                )));
            }
        }
        InspectorEdit::Gain { value } => {
            bounded(*value, (core::GAIN_DB_MIN, core::GAIN_DB_MAX))?;
            if primary.effects.gain_db.value_at(primary_frame) != *value {
                for &(track, clip_id, clip, frame) in &targets {
                    commands.push(if clip.effects.gain_db.is_constant() {
                        Box::new(core::set_clip_gain(id, track, clip_id, *value))
                            as Box<dyn Command>
                    } else {
                        Box::new(core::UpsertKeyframe::new(
                            id,
                            track,
                            clip_id,
                            frame,
                            core::KeyframeValue::Gain(*value),
                            core::Interpolation::Linear,
                        ))
                    });
                }
            }
        }
        InspectorEdit::ToggleGainKey {} => {
            let remove = primary.effects.gain_db.keyframe_at(primary_frame).is_some();
            for &(track, clip_id, clip, frame) in &targets {
                let value = if remove {
                    let mut reduced = clip.effects.gain_db.clone();
                    reduced.remove_at(frame);
                    reduced.value_at(frame)
                } else {
                    clip.effects.gain_db.value_at(frame)
                };
                bounded(value, (core::GAIN_DB_MIN, core::GAIN_DB_MAX))?;
                commands.push(if remove {
                    Box::new(core::RemoveKeyframe::new(
                        id,
                        track,
                        clip_id,
                        core::KeyframeTarget::Gain,
                        frame,
                    )) as Box<dyn Command>
                } else {
                    Box::new(core::UpsertKeyframe::new(
                        id,
                        track,
                        clip_id,
                        frame,
                        core::KeyframeValue::Gain(value),
                        core::Interpolation::Linear,
                    ))
                });
            }
        }
        InspectorEdit::ResetGain {} => {
            for &(track, clip_id, _, _) in &targets {
                commands.push(Box::new(core::reset_clip_gain(id, track, clip_id)));
            }
        }
        InspectorEdit::ResetCompositing {} => {
            for &(track, clip_id, _, _) in &targets {
                commands.push(Box::new(core::set_clip_blend_mode(
                    id,
                    track,
                    clip_id,
                    core::BlendMode::Normal,
                )));
            }
            for &(track, clip_id, _, _) in &targets {
                commands.push(Box::new(core::set_clip_matte(id, track, clip_id, None)));
            }
            for &(track, clip_id, _, _) in &targets {
                commands.push(Box::new(core::ResetTransformParams::new(
                    id,
                    track,
                    clip_id,
                    vec![TransformParam::Opacity],
                    false,
                )));
            }
        }
        _ => selected_content_commands(id, &targets, edit, &mut commands)?,
    }
    if let Some(first) = commands.first() {
        session.apply(Box::new(core::CompositeCommand::new(
            first.label(),
            commands,
        )));
    }
    Ok(())
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
fn patch_title(mut title: core::TitleParams, edit: &TitleEdit) -> Result<core::TitleParams> {
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
        if !(100..=900).contains(&weight)
            && !crate::fonts::supports_style(weight, edit.italic.unwrap_or(title.italic))
        {
            return Err(ApiError::invalid(
                "Choose a font weight from 100–900 or an installed native font style",
            ));
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
    Ok(title)
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
        let title = patch_title(clip.effects.title.clone().unwrap_or_default(), edit)?;
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
    commands.extend(compositing_commands(
        id,
        track,
        clip_id,
        patch.blend,
        patch.matte.as_deref().map(matte_mode).transpose()?,
    ));
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

fn matte_mode(value: &str) -> Result<Option<core::MatteMode>> {
    if value == "None" {
        return Ok(None);
    }
    core::MatteMode::ALL
        .into_iter()
        .find(|mode| format!("{mode:?}") == value)
        .map(Some)
        .ok_or_else(|| ApiError::invalid("Unknown matte mode"))
}

fn compositing_commands(
    id: TimelineId,
    track: usize,
    clip: ClipId,
    blend: Option<core::BlendMode>,
    matte: Option<Option<core::MatteMode>>,
) -> Vec<Box<dyn Command>> {
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    if let Some(value) = blend {
        commands.push(Box::new(core::set_clip_blend_mode(id, track, clip, value)));
    }
    if let Some(value) = matte {
        commands.push(Box::new(core::set_clip_matte(id, track, clip, value)));
    }
    commands
}

pub fn properties_batch(
    session: &mut Session,
    id: TimelineId,
    clip_ids: &[String],
    patch: &Properties,
) -> Result<()> {
    if clip_ids.is_empty() || clip_ids.len() > 4096 {
        return Err(ApiError::invalid("Choose between 1 and 4096 video clips"));
    }
    if !patch.transform.is_empty()
        || patch.flip.is_some()
        || patch.gain_db.is_some()
        || patch.color.is_some()
        || patch.fade_in.is_some()
        || patch.fade_out.is_some()
        || patch.title.is_some()
        || patch.blend.is_none() && patch.matte.is_none()
    {
        return Err(ApiError::invalid(
            "Batch properties support only blend and matte changes",
        ));
    }
    let matte = patch.matte.as_deref().map(matte_mode).transpose()?;
    let mut seen = std::collections::HashSet::new();
    let mut targets = Vec::with_capacity(clip_ids.len());
    for raw in clip_ids {
        let (track, clip_id, clip) = find(session, id, raw)?;
        if !seen.insert(clip_id) {
            return Err(ApiError::invalid("Duplicate batch property clip"));
        }
        writable(session, id, track)?;
        if session.project.timelines[id].tracks[track].kind != core::TrackKind::Video {
            return Err(ApiError::invalid(
                "Batch visual properties require video clips",
            ));
        }
        targets.push((track, clip_id, clip));
    }
    let commands = targets
        .into_iter()
        .flat_map(|(track, clip_id, clip)| {
            compositing_commands(
                id,
                track,
                clip_id,
                patch
                    .blend
                    .filter(|value| *value != clip.effects.blend_mode),
                matte.filter(|value| *value != clip.effects.matte),
            )
        })
        .collect::<Vec<_>>();
    if !commands.is_empty() {
        session.apply(Box::new(core::CompositeCommand::new(
            CommandLabel::Transform,
            commands,
        )));
    }
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
fn inspector_keyframe_info<T: Clone>(
    values: &core::Keyframed<T>,
    clip: &Clip,
    frame: i64,
) -> Value {
    let in_trim = |value: &i64| (clip.source_in()..clip.source_out()).contains(value);
    json!({
        "on_keyframe":values.keyframe_at(frame).is_some(),
        "previous_frame":values.keyframe_before(frame).filter(in_trim).map(|source| clip.timeline_frame_at(source)),
        "next_frame":values.keyframe_after(frame).filter(in_trim).map(|source| clip.timeline_frame_at(source))
    })
}

pub fn keyframe_navigation(
    session: &Session,
    id: TimelineId,
    raw: &str,
    source_frame: i64,
) -> Result<Value> {
    if !(0..=crate::commands::MAX_FRAME).contains(&source_frame) {
        return Err(ApiError::invalid(
            "Keyframe navigation source frame is out of range",
        ));
    }
    let (_, clip_id, clip) = find(session, id, raw)?;
    let start = clip.source_in();
    let end = clip.source_out();
    if start < 0 || end < start || end > crate::commands::MAX_FRAME {
        return Err(ApiError::invalid("Invalid native clip source range"));
    }
    let source_frame = source_frame.clamp(start, end);
    Ok(
        json!({"clip_id":clip_id.0.to_string(),"source_frame":source_frame,"timeline_frame":clip.timeline_frame_at(source_frame)}),
    )
}

fn keyframe_clock(clip: &Clip, timeline_frame: i64) -> Value {
    let start = clip.source_in();
    let end = clip.source_out();
    let mut ticks = Vec::new();
    for index in 0..=8 {
        let source_frame = start + ((i128::from(end) - i128::from(start)) * index / 8) as i64;
        if ticks
            .last()
            .is_some_and(|value: &Value| value["source_frame"] == source_frame)
        {
            continue;
        }
        ticks.push(json!({"source_frame":source_frame,"timeline_frame":clip.timeline_frame_at(source_frame)}));
    }
    json!({"source_frame":clip.source_frame_at(timeline_frame),"source_in":start,"source_out":end,"ticks":ticks})
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
        json!({"param":param,"default":values.default,"value":values.value_at(frame),"on_keyframe":values.keyframe_at(frame).is_some(),"keyframe_info":inspector_keyframe_info(values,clip,frame),"keyframes":values.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":values.keyframes().len(),"min":bounds.0,"max":bounds.1})
    }).collect();
    let lane = &session.project.timelines[id].tracks[track];
    let right = lane
        .clips
        .iter()
        .find(|c| c.timeline_start == clip.timeline_end() && c.id != clip.id && !c.is_adjustment());
    let mut result = json!({"clip_id":raw,"source_frame":frame,"timeline_frame":timeline_frame,"locked":session.project.timelines[id].tracks[track].locked,"video":session.project.timelines[id].tracks[track].kind == core::TrackKind::Video,"transform":parameters,"flip":clip.effects.transform.flip,"blend":clip.effects.blend_mode,"blends":core::BlendMode::ALL,"matte":clip.effects.matte.map(|m|format!("{m:?}")).unwrap_or_else(||"None".into()),"mattes":["None","Alpha","AlphaInverted","Luma","LumaInverted"],"gain":{"default":clip.effects.gain_db.default,"value":clip.effects.gain_db.value_at(frame),"keyframes":clip.effects.gain_db.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":clip.effects.gain_db.keyframes().len()},"color":clip.effects.color.as_ref().map(|c|c.default),"fade_in":clip.fade_in,"fade_out":clip.fade_out,"length_frames":clip.timeline_len});
    result["source_size"] = json!(size(session, id, clip));
    result["keyframe_clock"] = keyframe_clock(clip, timeline_frame);
    result["gain"]["on_keyframe"] = json!(clip.effects.gain_db.keyframe_at(frame).is_some());
    result["gain"]["keyframe_info"] = inspector_keyframe_info(&clip.effects.gain_db, clip, frame);
    result["transitions"] = json!({"in":clip.effects.transition_in,"out":clip.effects.transition_out,"cut_after":lane.crossing_from(clip.id).map(|c|&c.transition),"cut_max_frames":right.map(|r|2*r.timeline_len.min(clip.timeline_len))});
    result["title"] = clip.effects.title.as_ref().map(|title|json!({"content":{"default":title.content.default,"keyframes":title.content.keyframes().iter().take(16).collect::<Vec<_>>(),"key_count":title.content.keyframes().len()},"font_family":title.font_family,"font_weight":title.font_weight,"italic":title.italic,"color":title.color,"size":title.size,"tracking":title.tracking,"line_spacing":title.line_spacing,"underline":title.underline,"strikethrough":title.strikethrough,"case":title.case,"align":title.align,"anchor":title.anchor,"position":title.position,"background":title.background})).unwrap_or(Value::Null);
    if let Some(title) = &clip.effects.title {
        result["title"]["content"]["value"] = json!(title.content.value_at(frame));
        result["title"]["content"]["keyframe_info"] =
            inspector_keyframe_info(&title.content, clip, frame);
    }
    let default_color = core::Keyframed::constant(core::edit::DEFAULT_SOLID_COLOR);
    let color = clip.effects.color.as_ref().unwrap_or(&default_color);
    result["color_info"] = if matches!(clip.source, ClipSource::SolidColor) {
        json!({"value":color.value_at(frame),"keyframe_info":inspector_keyframe_info(color,clip,frame)})
    } else {
        Value::Null
    };
    result["masks"] = crate::masks::detail(clip, frame);
    result["display_color"] = json!(clip.display_color);
    result["display_colors"] = json!(core::ClipColor::ALL);
    if matches!(clip.source, core::ClipSource::Media(_)) {
        result["retime"] = json!({"speed_percent":clip.speed().as_percent(),"pitch_correction":clip.pitch_correction,"freeze_source_frame":clip.freeze});
    }
    result["filters"] = crate::visual::detail(clip, frame);
    for (index, filter) in clip.effects.filters.iter().enumerate() {
        let row = &mut result["filters"]["stack"][index];
        for (name, values) in [
            ("radius", &filter.radius),
            ("amount", &filter.amount),
            ("grow", &filter.grow),
        ] {
            row[name]["keyframe_info"] = inspector_keyframe_info(values, clip, frame);
        }
        for axis in 0..2 {
            row["offset"][axis]["keyframe_info"] =
                inspector_keyframe_info(&filter.offset[axis], clip, frame);
        }
        row["direction_info"] = json!({"value":filter.direction.value_at(frame),"keyframe_info":inspector_keyframe_info(&filter.direction,clip,frame)});
        for (index, param) in core::GradeParam::ALL.into_iter().enumerate() {
            row["grade"][index]["keyframe_info"] =
                inspector_keyframe_info(filter.grade.track(param), clip, frame);
        }
    }
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
