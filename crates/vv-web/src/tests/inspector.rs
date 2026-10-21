use super::*;
use vv_core::{Rational, Timeline, Track, TrackKind};

#[test]
fn viewer_geometry_uses_native_source_dimensions_instead_of_timeline_dimensions() {
    let (mut session, id, raw) = fixture();
    assert_eq!(
        detail(&session, id, &raw, 100).unwrap()["source_size"],
        json!([640, 360])
    );
    let media = session.project.media_pool.insert(core::MediaItem {
        path: "geometry-source.mp4".into(),
        meta: core::MediaMeta {
            width: 1920,
            height: 800,
            duration_frames: 120,
            fps: Rational::new(24, 1),
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 0,
        compound: None,
        folder: None,
    });
    session.project.timelines[id].tracks[0].clips[0].source = ClipSource::Media(media);
    let before = session.timeline_revision(id);
    let position = session.history.position();
    assert_eq!(
        detail(&session, id, &raw, 100).unwrap()["source_size"],
        json!([1920, 800])
    );
    assert_eq!(session.timeline_revision(id), before);
    assert_eq!(session.history.position(), position);
}

#[test]
fn dense_key_pages_expose_every_native_scalar_and_text_key_without_unbounded_summaries() {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    clip.timeline_len = 6000;
    clip.effects.title = Some(Default::default());
    let interpolation = core::Interpolation::Bezier {
        c1: [0.2, 0.1],
        c2: [0.8, 0.9],
    };
    for index in 0..2501 {
        clip.effects
            .transform
            .track_mut(TransformParam::ZoomX)
            .upsert(index * 2, 1.25, interpolation);
        clip.effects.title.as_mut().unwrap().content.upsert(
            index * 2,
            format!("Title {index} α"),
            core::Interpolation::Hold,
        );
    }
    let revision = session.timeline_revision(id);
    let position = session.history.position();
    let mut scalar = Vec::new();
    let mut text = Vec::new();
    for page in 0..10 {
        let detail = detail_page(&session, id, &raw, 12, Some(page)).unwrap();
        assert_eq!(
            detail["key_page"],
            json!({"index":page,"page_size":256,"total_pages":10})
        );
        let zoom = detail["curves"]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"]["param"] == "ZoomX")
            .unwrap();
        assert!(zoom["keys"].as_array().unwrap().len() <= 256);
        scalar.extend(zoom["keys"].as_array().unwrap().iter().cloned());
        let title = detail["event_keys"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"]["kind"] == "text")
            .unwrap();
        text.extend(title["keys"].as_array().unwrap().iter().cloned());
        let summary = detail["transform"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["param"] == "ZoomX")
            .unwrap();
        assert_eq!(summary["key_count"], 2501);
        assert_eq!(summary["keyframes"].as_array().unwrap().len(), 16);
        assert_eq!(
            detail["title"]["content"]["keyframes"]
                .as_array()
                .unwrap()
                .len(),
            16
        );
    }
    assert_eq!(scalar.len(), 2501);
    assert_eq!(text.len(), 2501);
    for index in 0..2501 {
        assert_eq!(scalar[index]["source_frame"], json!(index * 2));
        assert_eq!(scalar[index]["interpolation"], json!(interpolation));
        assert_eq!(text[index]["value"], json!(format!("Title {index} α")));
        assert_eq!(text[index]["interpolation"], "Hold");
    }
    assert!(detail_page(&session, id, &raw, 12, Some(10)).is_err());
    assert!(detail_page(&session, id, &raw, 12, Some(usize::MAX)).is_err());
    assert_eq!(session.history.position(), position);
    assert_eq!(session.timeline_revision(id), revision);
    crate::curves::edit(
        &mut session,
        id,
        &raw,
        &crate::curves::Edit {
            target: Target::Transform {
                param: TransformParam::ZoomX,
            },
            previous_source_frame: Some(4400),
            source_frame: 4401,
            value: Some(1.5),
            interpolation,
            link_zoom: false,
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(session.timeline_revision(id), revision);
}
fn fixture() -> (Session, TimelineId, String) {
    let mut session = Session::default();
    let id = session.create_timeline(Timeline {
        name: "Properties".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let clip_id = session.project.alloc_clip_id();
    let clip = Clip::from_source_range(
        clip_id,
        ClipSource::SolidColor,
        12,
        60,
        100,
        Rational::one(),
    );
    session.project.timelines[id].tracks[0].insert_sorted(clip);
    (session, id, clip_id.0.to_string())
}
#[test]
fn properties_validate_every_field_before_mutation_and_undo_as_one_step() {
    let (mut session, id, clip) = fixture();
    let position = session.history.position();
    let original = serde_json::to_value(&session.project).unwrap();
    let mut patch = Properties {
        transform: vec![Parameter {
            param: TransformParam::PositionX,
            value: 30.0,
        }],
        fade_in: Some(1000),
        ..Default::default()
    };
    assert!(properties(&mut session, id, &clip, &patch).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    assert_eq!(session.history.position(), position);
    patch.fade_in = Some(8);
    patch.blend = Some(core::BlendMode::Multiply);
    patch.matte = Some("Luma".into());
    properties(&mut session, id, &clip, &patch).unwrap();
    assert_eq!(session.history.position(), position + 1);
    let detail = detail(&session, id, &clip, 108).unwrap();
    assert_eq!(detail["transform"][2]["default"], 30.0);
    assert_eq!(detail["blend"], "Multiply");
    assert_eq!(detail["matte"], "Luma");
    assert_eq!(detail["fade_in"], 8);
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    session.history.redo(&mut session.project);
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        properties(&mut session, id, &clip, &patch).unwrap_err().1,
        "TRACK_LOCKED"
    );
}
#[test]
fn keyframes_map_timeline_to_native_source_frames_and_restore_interpolation() {
    let (mut session, id, clip) = fixture();
    let edit = |frame, value| Keyframe {
        target: Target::Transform {
            param: TransformParam::Opacity,
        },
        timeline_frame: frame,
        value,
        interpolation: core::Interpolation::EaseInOut,
    };
    keyframe(&mut session, id, &clip, &edit(108, Some(50.0))).unwrap();
    let values = detail(&session, id, &clip, 108).unwrap();
    assert_eq!(values["source_frame"], 20);
    assert_eq!(
        values["transform"][12]["keyframes"][0],
        json!([20, 50.0, "EaseInOut"])
    );
    let before = session.history.position();
    assert!(keyframe(&mut session, id, &clip, &edit(99, Some(50.0))).is_err());
    assert!(keyframe(&mut session, id, &clip, &edit(108, Some(101.0))).is_err());
    assert_eq!(session.history.position(), before);
    keyframe(&mut session, id, &clip, &edit(108, None)).unwrap();
    assert_eq!(
        detail(&session, id, &clip, 108).unwrap()["transform"][12]["keyframes"],
        json!([])
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        detail(&session, id, &clip, 108).unwrap()["transform"][12]["keyframes"][0][2],
        "EaseInOut"
    );
}

#[test]
fn transitions_validate_adjacency_duration_and_restore_native_crossings() {
    let (mut s, id, clip) = fixture();
    let value = core::Transition {
        kind: core::TransitionKind::CrossDissolve,
        duration: 12,
        direction: core::PushDirection::Left,
        ease: core::Ease::None,
        curve: 0.5,
    };
    assert!(
        transition(
            &mut s,
            id,
            &clip,
            TransitionSlot::CutAfter,
            &Some(value.clone())
        )
        .is_err()
    );
    let right = s.project.alloc_clip_id();
    s.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
        right,
        ClipSource::SolidColor,
        0,
        24,
        148,
        Rational::one(),
    ));
    let before = s.timeline_revision(id);
    transition(
        &mut s,
        id,
        &clip,
        TransitionSlot::CutAfter,
        &Some(value.clone()),
    )
    .unwrap();
    let crossing = &s.project.timelines[id].tracks[0].crossings[0];
    assert_eq!(crossing.right_clip, right);
    assert_eq!(crossing.transition.duration, 12);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
    let mut invalid = value.clone();
    invalid.duration = 49;
    assert!(transition(&mut s, id, &clip, TransitionSlot::CutAfter, &Some(invalid)).is_err());
    transition(&mut s, id, &clip, TransitionSlot::In, &Some(value)).unwrap();
    assert_eq!(
        detail(&s, id, &clip, 108).unwrap()["transitions"]["in"]["kind"],
        "CrossDissolve"
    );
    transition(&mut s, id, &clip, TransitionSlot::In, &None).unwrap();
    assert!(detail(&s, id, &clip, 108).unwrap()["transitions"]["in"].is_null());
}

#[test]
fn title_edits_preserve_animation_and_validate_before_atomic_apply() {
    let (mut s, id, raw) = fixture();
    let clip = &mut s.project.timelines[id].tracks[0].clips[0];
    clip.source = ClipSource::Text;
    clip.effects.title = Some(core::TitleParams::default());
    clip.effects.title.as_mut().unwrap().content.upsert(
        20,
        "Animated title".into(),
        core::Interpolation::Hold,
    );
    let before = s.timeline_revision(id);
    let mut patch = Properties {
        title: Some(TitleEdit {
            text: Some("New default".into()),
            size: Some(80.0),
            font_weight: Some(700),
            ..Default::default()
        }),
        ..Default::default()
    };
    properties(&mut s, id, &raw, &patch).unwrap();
    let current = detail(&s, id, &raw, 108).unwrap();
    assert_eq!(current["title"]["content"]["default"], "New default");
    assert_eq!(
        current["title"]["content"]["keyframes"][0][1],
        "Animated title"
    );
    assert_eq!(current["title"]["size"], 80.0);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
    patch.title.as_mut().unwrap().size = Some(f32::INFINITY);
    assert!(properties(&mut s, id, &raw, &patch).is_err());
    assert_eq!(s.timeline_revision(id), before);
}

#[test]
fn joint_keyframes_validate_the_entire_gesture_before_creating_one_history_step() {
    let (mut s, id, clip) = fixture();
    let before = s.timeline_revision(id);
    let position = s.history.position();
    let edit = |param, value| Keyframe {
        target: Target::Transform { param },
        timeline_frame: 108,
        value: Some(value),
        interpolation: core::Interpolation::Linear,
    };
    assert!(
        keyframes(
            &mut s,
            id,
            &clip,
            &[
                edit(TransformParam::PositionX, 20.0),
                edit(TransformParam::Opacity, 101.0)
            ]
        )
        .is_err()
    );
    assert_eq!(s.timeline_revision(id), before);
    assert_eq!(s.history.position(), position);
    keyframes(
        &mut s,
        id,
        &clip,
        &[
            edit(TransformParam::PositionX, 20.0),
            edit(TransformParam::Opacity, 50.0),
        ],
    )
    .unwrap();
    assert_eq!(s.history.position(), position + 1);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
}
