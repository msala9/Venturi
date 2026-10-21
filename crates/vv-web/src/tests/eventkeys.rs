use super::*;
use vv_core::{ClipSource, Interpolation, Keyframed, Rational, Track, TrackKind};
fn fixture() -> (Session, TimelineId, String) {
    let mut session = Session::default();
    let timeline = session.create_timeline(core::Timeline {
        name: "Event keys".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 36),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let id = session.project.alloc_clip_id();
    let mut clip =
        Clip::from_source_range(id, ClipSource::SolidColor, 0, 48, 0, Rational::new(1, 1));
    clip.effects.color = Some(Keyframed::constant(core::Rgba::WHITE));
    clip.effects.title = Some(Default::default());
    clip.effects
        .filters
        .push(core::ClipFilter::new(core::FilterKind::GaussianBlur));
    session.project.timelines[timeline].tracks[0].insert_sorted(clip);
    (session, timeline, id.0.to_string())
}
fn change(target: Target, value: Value, frame: i64) -> Edit {
    Edit {
        target,
        previous_source_frame: None,
        source_frame: frame,
        value: Some(value),
        interpolation: Interpolation::EaseInOut,
    }
}
#[test]
fn native_rgba_text_and_direction_keys_preserve_values_timing_interpolation_and_one_undo() {
    for (target, value) in [
        (Target::Color, json!({"r":0.2,"g":0.4,"b":0.6,"a":0.8})),
        (Target::Text, json!("Title <literal> α\nsecond line")),
        (
            Target::Direction {
                filter: core::FilterKind::GaussianBlur,
            },
            json!("Vertical"),
        ),
    ] {
        let (mut session, id, raw) = fixture();
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        edit(
            &mut session,
            id,
            &raw,
            &change(target.clone(), value.clone(), 7),
        )
        .unwrap();
        let row = detail(inspector::find(&session, id, &raw).unwrap().2)
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"] == json!(target))
            .unwrap()
            .clone();
        assert_eq!(row["keys"][0]["source_frame"], 7);
        assert_eq!(row["keys"][0]["interpolation"], "EaseInOut");
        let group_edit = Group {
            target: target.clone(),
            source_frames: vec![7],
            delta_source_frames: 5,
            delete: false,
        };
        group(&mut session, id, &raw, &group_edit).unwrap();
        assert_eq!(session.history.position(), position + 2);
        assert_eq!(
            session.history.labels().last(),
            Some(core::CommandLabel::MoveKeyframes)
        );
        let moved = detail(inspector::find(&session, id, &raw).unwrap().2);
        let moved = moved
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"] == json!(target))
            .unwrap();
        assert_eq!(moved["keys"][0]["source_frame"], 12);
        assert_eq!(moved["keys"][0]["value"], row["keys"][0]["value"]);
        session.history.undo(&mut session.project);
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    }
}
#[test]
fn event_key_groups_never_overwrite_unselected_keys_and_delete_is_one_atomic_native_undo() {
    let (mut session, id, raw) = fixture();
    for frame in [0, 10, 20] {
        edit(
            &mut session,
            id,
            &raw,
            &change(Target::Text, json!(format!("At {frame}")), frame),
        )
        .unwrap();
    }
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let request = Group {
        target: Target::Text,
        source_frames: vec![0, 10],
        delta_source_frames: 10,
        delete: false,
    };
    assert_eq!(
        group(&mut session, id, &raw, &request).unwrap_err().1,
        "KEYFRAME_COLLISION"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    group(
        &mut session,
        id,
        &raw,
        &Group {
            delete: true,
            ..request
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        keys(
            inspector::find(&session, id, &raw).unwrap().2,
            &Target::Text
        )
        .unwrap(),
        vec![20]
    );
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}
#[test]
fn invalid_event_values_targets_bounds_and_locks_leave_model_and_history_unchanged() {
    let (mut session, id, raw) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let mut cases = vec![
        change(Target::Color, json!({"r":1.1,"g":0,"b":0,"a":1}), 0),
        change(Target::Text, json!("x".repeat(4097)), 0),
        change(Target::Text, json!(42), 0),
        change(
            Target::Direction {
                filter: core::FilterKind::GaussianBlur,
            },
            json!("Unknown"),
            0,
        ),
        change(
            Target::Direction {
                filter: core::FilterKind::Exposure,
            },
            json!("Both"),
            0,
        ),
        change(Target::Text, json!("outside"), 48),
    ];
    let mut invalid = change(Target::Text, json!("curve"), 0);
    invalid.interpolation = Interpolation::Bezier {
        c1: [2.0, 0.0],
        c2: [1.0, 1.0],
    };
    cases.push(invalid);
    for edit_request in cases {
        assert!(edit(&mut session, id, &raw, &edit_request).is_err());
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), position);
    }
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        edit(
            &mut session,
            id,
            &raw,
            &change(Target::Text, json!("locked"), 0)
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
}
