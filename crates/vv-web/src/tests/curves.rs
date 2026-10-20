use super::*;
use vv_core::{ClipSource, Interpolation, Rational, Timeline, Track, TrackKind, TransformParam};

fn fixture() -> (Session, TimelineId, String) {
    let mut session = Session::default();
    let id = session.create_timeline(Timeline {
        name: "Curves".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let clip_id = session.project.alloc_clip_id();
    let mut clip = Clip::from_source_range(
        clip_id,
        ClipSource::SolidColor,
        12,
        60,
        100,
        Rational::new(1, 2),
    );
    let track = clip.effects.transform.track_mut(TransformParam::Opacity);
    track.upsert(25, 20.0, Interpolation::EaseIn);
    track.upsert(40, 80.0, Interpolation::Hold);
    session.project.timelines[id].tracks[0].insert_sorted(clip);
    (session, id, clip_id.0.to_string())
}

fn change() -> Edit {
    Edit {
        target: Target::Transform {
            param: TransformParam::Opacity,
        },
        previous_source_frame: Some(25),
        source_frame: 27,
        value: Some(30.0),
        interpolation: Interpolation::Bezier {
            c1: [0.2, -0.5],
            c2: [0.8, 1.5],
        },
    }
}

#[test]
fn curve_samples_use_native_evaluation_and_exact_source_keys() {
    let (session, id, raw) = fixture();
    let (lane, _, clip) = inspector::find(&session, id, &raw).unwrap();
    let data = detail(&session, id, clip, lane);
    let curve = &data["tracks"][12];
    assert_eq!(curve["keys"][0]["source_frame"], 25);
    assert_eq!(
        curve["keys"][0]["controls"],
        json!(Interpolation::EaseIn.control_points())
    );
    assert_eq!(
        curve["keys"][0]["timeline_frame"],
        clip.timeline_frame_at(25)
    );
    let track = clip.effects.transform.track(TransformParam::Opacity);
    for sample in curve["samples"].as_array().unwrap() {
        assert_eq!(
            sample[1],
            json!(track.value_at(sample[0].as_i64().unwrap()))
        );
    }
    assert!(curve["samples"].as_array().unwrap().len() <= 769);
    assert!(data["tracks"][0]["samples"].as_array().unwrap().len() <= 2);
}

#[test]
fn move_and_bezier_change_are_one_atomic_undo_without_source_roundtrip() {
    let (mut session, id, raw) = fixture();
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    edit(&mut session, id, &raw, &change()).unwrap();
    let (_, _, clip) = inspector::find(&session, id, &raw).unwrap();
    let keys = clip
        .effects
        .transform
        .track(TransformParam::Opacity)
        .keyframes();
    assert_eq!(keys[0], (27, 30.0, change().interpolation));
    assert_eq!(keys[1], (40, 80.0, Interpolation::Hold));
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    session.history.redo(&mut session.project);
    let mut remove = change();
    remove.previous_source_frame = Some(27);
    remove.value = None;
    edit(&mut session, id, &raw, &remove).unwrap();
    assert_eq!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()
            .len(),
        1
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()[0]
            .0,
        27
    );
}

#[test]
fn invalid_moves_and_collisions_preserve_the_whole_document_and_history() {
    let (mut session, id, raw) = fixture();
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let mut invalid = Vec::new();
    let mut value = change();
    value.source_frame = 40;
    invalid.push(value);
    let mut value = change();
    value.source_frame = 1;
    invalid.push(value);
    let mut value = change();
    value.previous_source_frame = Some(26);
    invalid.push(value);
    let mut value = change();
    value.value = Some(101.0);
    invalid.push(value);
    let mut value = change();
    value.interpolation = Interpolation::Bezier {
        c1: [1.1, 0.0],
        c2: [0.5, 1.0],
    };
    invalid.push(value);
    let mut value = change();
    value.interpolation = Interpolation::Bezier {
        c1: [0.1, f32::NAN],
        c2: [0.5, 1.0],
    };
    invalid.push(value);
    let mut value = change();
    value.target = Target::Gain;
    invalid.push(value);
    let mut value = change();
    value.previous_source_frame = None;
    value.value = None;
    invalid.push(value);
    for value in invalid {
        assert!(edit(&mut session, id, &raw, &value).is_err());
        assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
        assert_eq!(session.history.position(), position);
    }
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        edit(&mut session, id, &raw, &change()).unwrap_err().1,
        "TRACK_LOCKED"
    );
}

#[test]
fn duplicate_and_hidden_key_deletion_preserve_other_keys() {
    let (mut session, id, raw) = fixture();
    let mut duplicate = change();
    duplicate.previous_source_frame = None;
    edit(&mut session, id, &raw, &duplicate).unwrap();
    assert_eq!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()
            .len(),
        3
    );
    assert!(edit(&mut session, id, &raw, &duplicate).is_err());
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(1, 50.0, Interpolation::Linear);
    duplicate.previous_source_frame = Some(1);
    duplicate.value = None;
    edit(&mut session, id, &raw, &duplicate).unwrap();
    assert_eq!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()
            .len(),
        3
    );
}

#[test]
fn every_advertised_filter_grade_mask_and_audio_curve_accepts_its_native_default() {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    for kind in [
        core::FilterKind::ColorCorrection,
        core::FilterKind::Exposure,
        core::FilterKind::BoxBlur,
        core::FilterKind::GaussianBlur,
        core::FilterKind::DropShadow,
    ] {
        clip.effects.filters.push(core::ClipFilter::new(kind));
    }
    crate::masks::edit(
        &mut session,
        id,
        &raw,
        &crate::masks::MaskEdit::Add {
            shape: core::MaskShape::Rectangle,
        },
    )
    .unwrap();
    let (_, _, clip) = inspector::find(&session, id, &raw).unwrap();
    let advertised: Vec<_> = curves(&session, id, clip, 0)
        .into_iter()
        .map(|c| (c.target, c.track.default))
        .collect();
    assert!(advertised.len() > 40);
    for (target, value) in advertised {
        edit(
            &mut session,
            id,
            &raw,
            &Edit {
                target,
                previous_source_frame: None,
                source_frame: 26,
                value: Some(value),
                interpolation: Interpolation::EaseOut,
            },
        )
        .unwrap();
    }
    let audio_id = session.project.alloc_clip_id();
    session.project.timelines[id].tracks[1].insert_sorted(Clip::from_source_range(
        audio_id,
        ClipSource::SolidColor,
        0,
        48,
        0,
        Rational::one(),
    ));
    edit(
        &mut session,
        id,
        &audio_id.0.to_string(),
        &Edit {
            target: Target::Gain,
            previous_source_frame: None,
            source_frame: 0,
            value: Some(-6.0),
            interpolation: Interpolation::Linear,
        },
    )
    .unwrap();
    let clip = &session.project.timelines[id].tracks[1].clips[0];
    let data = detail(&session, id, clip, 1);
    assert_eq!(data["tracks"].as_array().unwrap().len(), 1);
    assert_eq!(data["tracks"][0]["keys"][0]["value"], -6.0);
}

#[test]
fn long_dense_curves_bound_sampling_and_report_truncated_key_lists() {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    clip.timeline_len = 1_000_000;
    let track = clip.effects.transform.track_mut(TransformParam::PositionX);
    for frame in 24..3024 {
        track.upsert(frame, frame as f32, Interpolation::Linear);
    }
    let clip = &session.project.timelines[id].tracks[0].clips[0];
    let data = detail(&session, id, clip, 0);
    let curve = &data["tracks"][2];
    assert_eq!(curve["key_count"], 3000);
    assert_eq!(curve["keys"].as_array().unwrap().len(), 2048);
    assert!(curve["samples"].as_array().unwrap().len() <= 769);
    assert_eq!(
        inspector::find(&session, id, &raw).unwrap().2.timeline_len,
        1_000_000
    );
}
