use super::*;
use vv_core::{Rational, Timeline, Track, TrackKind};
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
