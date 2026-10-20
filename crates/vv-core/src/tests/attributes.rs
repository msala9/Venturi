use super::*;
use crate::{ClipId, ClipSource, Interpolation, Rational};

fn clip(id: u64, source_in: FrameIdx, source_out: FrameIdx) -> Clip {
    Clip::from_source_range(
        ClipId(id),
        ClipSource::SolidColor,
        source_in,
        source_out,
        0,
        Rational::one(),
    )
}

fn source_clip() -> Clip {
    let mut clip = clip(1, 0, 20);
    clip.effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .default = 2.0;
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .default = 0.5;
    clip.fade_in = 4;
    clip
}

#[test]
fn only_the_ticked_attributes_are_pasted() {
    let target = clip(2, 0, 20);
    let selected = HashSet::from([Attribute::Zoom]);
    let pasted = merged_attributes(
        &source_clip(),
        &target,
        &selected,
        KeyframeMode::MaintainTiming,
    );

    assert_eq!(
        pasted
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .default,
        2.0
    );
    assert_eq!(
        pasted
            .effects
            .transform
            .track(TransformParam::Opacity)
            .default,
        target
            .effects
            .transform
            .track(TransformParam::Opacity)
            .default,
        "unselected opacity stays that of the destination clip"
    );
    assert_eq!(pasted.fade_in, 0, "unselected fades are left alone");
}

/// The keyframes are in source frames: a target clip starting from
/// another point of its media must keep the same distances from its
/// own start.
#[test]
fn maintain_timing_keeps_the_offsets_from_the_start_of_the_clip() {
    let mut source = source_clip();
    source
        .effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .upsert(5, 3.0, Interpolation::Linear);
    let target = clip(2, 100, 120);

    let pasted = merged_attributes(
        &source,
        &target,
        &HashSet::from([Attribute::Zoom]),
        KeyframeMode::MaintainTiming,
    );

    let keyframes = pasted
        .effects
        .transform
        .track(TransformParam::ZoomX)
        .keyframes();
    assert_eq!(keyframes.len(), 1);
    assert_eq!(keyframes[0].0, 105);
}

#[test]
fn stretch_to_fit_scales_the_keyframes_on_the_target_duration() {
    let mut source = source_clip();
    let track = source.effects.transform.track_mut(TransformParam::ZoomX);
    track.upsert(10, 3.0, Interpolation::Linear);
    track.upsert(15, 4.0, Interpolation::Linear);
    // Half the source: 20 source frames against 40.
    let target = clip(2, 0, 40);

    let pasted = merged_attributes(
        &source,
        &target,
        &HashSet::from([Attribute::Zoom]),
        KeyframeMode::StretchToFit,
    );

    let keyframes = pasted
        .effects
        .transform
        .track(TransformParam::ZoomX)
        .keyframes();
    assert_eq!(
        keyframes.iter().map(|k| k.0).collect::<Vec<_>>(),
        vec![20, 30]
    );
}

/// As a trim would, the animation is cut keeping its value at the edge.
#[test]
fn keyframes_outside_the_target_clip_leave_their_value_at_its_edge() {
    let mut source = source_clip();
    source
        .effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .upsert(15, 3.0, Interpolation::Linear);
    let target = clip(2, 0, 5);

    let pasted = merged_attributes(
        &source,
        &target,
        &HashSet::from([Attribute::Zoom]),
        KeyframeMode::MaintainTiming,
    );

    assert!(
        pasted
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .is_constant()
    );
    assert_eq!(
        pasted
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .default,
        3.0
    );
}

#[test]
fn fades_and_transitions_are_clamped_to_the_target_length() {
    let mut source = source_clip();
    source.fade_out = 8;
    let target = clip(2, 0, 5);

    let pasted = merged_attributes(
        &source,
        &target,
        &HashSet::from([Attribute::Fades]),
        KeyframeMode::MaintainTiming,
    );

    assert_eq!(pasted.fade_in, 4);
    assert_eq!(pasted.fade_out, 5);
}

/// The whole path: copy, select another clip, apply the dialog.
#[test]
fn pasted_filters_bring_their_keyframes_into_the_target_clip() {
    let mut source = source_clip();
    let mut filter = crate::ClipFilter::new(crate::FilterKind::BoxBlur);
    filter.radius.upsert(5, 30.0, Interpolation::Linear);
    filter
        .direction
        .upsert(5, crate::BlurDirection::Vertical, Interpolation::Linear);
    source.effects.filters.push(filter);
    let target = clip(2, 100, 120);

    let pasted = merged_attributes(
        &source,
        &target,
        &HashSet::from([Attribute::Filters]),
        KeyframeMode::MaintainTiming,
    );

    let filter = &pasted.effects.filters[0];
    assert_eq!(filter.radius.keyframes()[0].0, 105);
    assert_eq!(filter.direction.keyframes()[0].0, 105);
}

#[test]
fn pasted_color_corrections_bring_their_keyframes_into_the_target_clip() {
    let mut source = source_clip();
    let mut filter = crate::ClipFilter::new(crate::FilterKind::ColorCorrection);
    filter
        .grade
        .track_mut(crate::GradeParam::HighlightsY)
        .upsert(5, 0.4, Interpolation::Linear);
    source.effects.filters.push(filter);
    let target = clip(2, 100, 120);

    let pasted = merged_attributes(
        &source,
        &target,
        &HashSet::from([Attribute::Filters]),
        KeyframeMode::MaintainTiming,
    );

    let track = pasted.effects.filters[0]
        .grade
        .track(crate::GradeParam::HighlightsY);
    assert_eq!(track.keyframes()[0].0, 105);
}

fn merged_attributes(
    source: &Clip,
    target: &Clip,
    selected: &HashSet<Attribute>,
    mode: KeyframeMode,
) -> ClipAttributes {
    merge(
        source,
        target,
        selected,
        &Conversion::paste(source, target, mode),
    )
}
