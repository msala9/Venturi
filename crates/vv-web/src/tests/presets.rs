use super::*;
use vv_core::{
    Clip, ClipSource, Interpolation, Rational, Timeline, Track, TrackKind, TransformParam,
};

fn fixture() -> (Session, core::TimelineId, String, core::TimelineId, String) {
    let mut session = Session::default();
    let mut create = |fps, resolution, start, source_in, source_out| {
        let id = session.create_timeline(Timeline {
            name: "Preset test".into(),
            fps,
            resolution,
            tracks: vec![Track::new(TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        });
        let clip_id = session.project.alloc_clip_id();
        session.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
            clip_id,
            ClipSource::SolidColor,
            source_in,
            source_out,
            start,
            Rational::one(),
        ));
        (id, clip_id.0.to_string())
    };
    let (source, source_clip) = create(Rational::new(24, 1), (640, 360), 0, 0, 48);
    let (target, target_clip) = create(Rational::new(48, 1), (1280, 720), 100, 10, 154);
    let clip = &mut session.project.timelines[source].tracks[0].clips[0];
    clip.effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .default = 2.0;
    clip.effects
        .transform
        .track_mut(TransformParam::PositionX)
        .default = 10.0;
    clip.effects
        .transform
        .track_mut(TransformParam::PositionY)
        .default = 20.0;
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(0, 20.0, Interpolation::EaseIn);
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(24, 80.0, Interpolation::Hold);
    clip.fade_in = 12;
    let mut blur = core::ClipFilter::new(core::FilterKind::BoxBlur);
    blur.radius.default = 3.0;
    clip.effects.filters.push(blur);
    session.project.timelines[target].tracks[0].clips[0]
        .effects
        .filters
        .push(core::ClipFilter::new(core::FilterKind::Exposure));
    (session, source, source_clip, target, target_clip)
}
fn options(anchor: KeyframeAnchor) -> Options {
    Options {
        name: "Native look α".into(),
        attributes: vec![
            Attribute::Position,
            Attribute::Zoom,
            Attribute::Opacity,
            Attribute::Fades,
            Attribute::Filters,
        ],
        anchor,
        append_filters: true,
    }
}

#[test]
fn native_preset_converts_fps_resolution_and_all_anchors_as_one_undo() {
    for (anchor, frames) in [
        (KeyframeAnchor::Start, [10, 58]),
        (KeyframeAnchor::End, [58, 106]),
        (KeyframeAnchor::Stretch, [10, 82]),
    ] {
        let (mut session, source, source_clip, target, target_clip) = fixture();
        let before = serde_json::to_value(&session.project.timelines[target]).unwrap();
        let position = session.history.position();
        let mut preset = capture(&session, source, &[source_clip], &options(anchor)).unwrap();
        preset.video.as_mut().unwrap().id = session.project.timelines[target].tracks[0].clips[0].id;
        let wire = serde_json::to_value(&preset).unwrap();
        assert_eq!(wire["version"], 1);
        assert_eq!(wire["shortcut"], Value::Null);
        let preset: Preset = serde_json::from_value(wire).unwrap();
        apply(&mut session, target, &[target_clip], &preset).unwrap();
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            session.history.labels().last().unwrap(),
            core::CommandLabel::ApplyPreset
        );
        let clip = &session.project.timelines[target].tracks[0].clips[0];
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::PositionX)
                .default,
            20.0
        );
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::PositionY)
                .default,
            40.0
        );
        assert_eq!(
            clip.effects.transform.track(TransformParam::ZoomX).default,
            2.0
        );
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::Opacity)
                .keyframes(),
            &[
                (frames[0], 20.0, Interpolation::EaseIn),
                (frames[1], 80.0, Interpolation::Hold)
            ]
        );
        assert_eq!(clip.fade_in, 24);
        assert_eq!(
            clip.effects
                .filters
                .iter()
                .map(|filter| filter.kind)
                .collect::<Vec<_>>(),
            vec![core::FilterKind::Exposure, core::FilterKind::BoxBlur]
        );
        assert_eq!(clip.effects.filters[1].radius.default, 6.0);
        assert_eq!(
            (clip.timeline_start, clip.timeline_len, clip.source_in()),
            (100, 144, 10)
        );
        session.history.undo(&mut session.project);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[target]).unwrap(),
            before
        );
    }
}

#[test]
fn invalid_presets_and_locked_targets_do_not_mutate_any_native_state() {
    let (mut session, source, source_clip, target, target_clip) = fixture();
    let preset = capture(
        &session,
        source,
        &[source_clip],
        &options(KeyframeAnchor::Start),
    )
    .unwrap();
    let mut invalid = Vec::new();
    let mut value = preset.clone();
    value.version = 2;
    invalid.push(value);
    let mut value = preset.clone();
    value.fps = Rational::new(0, 1);
    invalid.push(value);
    let mut value = preset.clone();
    value.fps = Rational::new(1, i32::MAX);
    invalid.push(value);
    let mut value = preset.clone();
    value.attributes.push(Attribute::Volume);
    invalid.push(value);
    let mut value = preset.clone();
    value
        .video
        .as_mut()
        .unwrap()
        .effects
        .transform
        .track_mut(TransformParam::PositionX)
        .default = f32::MAX;
    invalid.push(value);
    let mut value = serde_json::to_value(&preset).unwrap();
    value["video"]["rate"] = serde_json::json!({"num":i32::MAX,"den":1});
    invalid.push(serde_json::from_value(value).unwrap());
    let mut value = preset.clone();
    value.attributes.push(value.attributes[0]);
    invalid.push(value);
    let mut value = preset.clone();
    value.video.as_mut().unwrap().timeline_len = 0;
    invalid.push(value);
    let mut value = preset.clone();
    value
        .video
        .as_mut()
        .unwrap()
        .effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(i64::MIN, 42.0, Interpolation::Linear);
    invalid.push(value);
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    for preset in invalid {
        assert!(
            apply(
                &mut session,
                target,
                std::slice::from_ref(&target_clip),
                &preset
            )
            .is_err()
        );
    }
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    session.project.timelines[target].tracks[0].locked = true;
    let before = session.timeline_revision(target);
    assert_eq!(
        apply(&mut session, target, &[target_clip], &preset)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(session.timeline_revision(target), before);
    assert_eq!(session.history.position(), position);
}

#[test]
fn capture_includes_linked_audio_and_chooses_earliest_video_without_history() {
    let (mut session, source, source_clip, _, _) = fixture();
    let group = session.project.alloc_link_group_id();
    session.project.timelines[source].tracks[0].clips[0].linked_group = Some(group);
    session.project.timelines[source].tracks[0].clips[0].timeline_start = 20;
    let early_id = session.project.alloc_clip_id();
    let mut earlier =
        Clip::from_source_range(early_id, ClipSource::SolidColor, 0, 10, 0, Rational::one());
    earlier
        .effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .default = 3.0;
    session.project.timelines[source].tracks[0].insert_sorted(earlier);
    let id = session.project.alloc_clip_id();
    let mut audio = Clip::from_source_range(id, ClipSource::SolidColor, 0, 48, 20, Rational::one());
    audio.linked_group = Some(group);
    audio.effects.gain_db.default = -6.0;
    let timeline = &mut session.project.timelines[source];
    timeline.tracks.push(Track::new(TrackKind::Audio));
    timeline.tracks[1].insert_sorted(audio);
    let mut opts = options(KeyframeAnchor::Start);
    opts.attributes.push(Attribute::Volume);
    let before = session.timeline_revision(source);
    let position = session.history.position();
    let preset = capture(
        &session,
        source,
        &[source_clip, early_id.0.to_string()],
        &opts,
    )
    .unwrap();
    assert_eq!(preset.audio.unwrap().effects.gain_db.default, -6.0);
    assert_eq!(
        preset
            .video
            .unwrap()
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .default,
        3.0
    );
    assert_eq!(session.timeline_revision(source), before);
    assert_eq!(session.history.position(), position);
}
