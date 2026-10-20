use super::*;
fn fixture() -> (Session, TimelineId, String) {
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Masks".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let clip = session.project.alloc_clip_id();
    session.project.timelines[id].tracks[0].insert_sorted(core::Clip::from_source_range(
        clip,
        core::ClipSource::SolidColor,
        0,
        48,
        0,
        core::Rational::one(),
    ));
    (session, id, clip.0.to_string())
}
#[test]
fn mask_changes_validate_before_mutation_preserve_keys_and_undo_the_whole_patch() {
    let (mut session, id, clip) = fixture();
    edit(
        &mut session,
        id,
        &clip,
        &MaskEdit::Add {
            shape: MaskShape::Rectangle,
        },
    )
    .unwrap();
    inspector::keyframe(
        &mut session,
        id,
        &clip,
        &inspector::Keyframe {
            target: inspector::Target::Mask {
                index: 0,
                param: MaskParam::Feather,
            },
            timeline_frame: 12,
            value: Some(10.0),
            interpolation: core::Interpolation::Linear,
        },
    )
    .unwrap();
    let baseline = session.timeline_revision(id);
    let steps = session.history.position();
    let invalid = MaskPatch {
        enabled: Some(false),
        parameters: vec![MaskValue {
            param: MaskParam::Feather,
            value: f32::NAN,
        }],
        ..Default::default()
    };
    assert!(
        edit(
            &mut session,
            id,
            &clip,
            &MaskEdit::Set {
                index: 0,
                patch: invalid
            }
        )
        .is_err()
    );
    assert_eq!(session.timeline_revision(id), baseline);
    assert_eq!(session.history.position(), steps);
    let patch = MaskPatch {
        enabled: Some(false),
        invert: Some(true),
        mode: Some(core::MaskMode::Subtract),
        parameters: vec![MaskValue {
            param: MaskParam::Feather,
            value: 25.0,
        }],
        ..Default::default()
    };
    edit(&mut session, id, &clip, &MaskEdit::Set { index: 0, patch }).unwrap();
    let mask = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0];
    assert!(!mask.enabled);
    assert!(mask.invert);
    assert_eq!(mask.mode, core::MaskMode::Subtract);
    assert_eq!(mask.track(MaskParam::Feather).default, 25.0);
    assert_eq!(mask.track(MaskParam::Feather).keyframes().len(), 1);
    assert_eq!(session.history.position(), steps + 1);
    session.history.undo(&mut session.project);
    assert_eq!(session.timeline_revision(id), baseline);
    session.project.timelines[id].tracks[0].locked = true;
    assert!(edit(&mut session, id, &clip, &MaskEdit::Remove { index: 0 }).is_err());
}
#[test]
fn path_and_stack_budgets_refuse_silent_native_polygon_truncation() {
    let (mut session, id, clip) = fixture();
    edit(
        &mut session,
        id,
        &clip,
        &MaskEdit::Add {
            shape: MaskShape::Path,
        },
    )
    .unwrap();
    let baseline = session.timeline_revision(id);
    let mut path = core::MaskPath {
        points: vec![core::PathPoint::corner([0.0, 0.0]); 22],
    };
    assert!(
        edit(
            &mut session,
            id,
            &clip,
            &MaskEdit::Set {
                index: 0,
                patch: MaskPatch {
                    path: Some(path.clone()),
                    ..Default::default()
                }
            }
        )
        .is_err()
    );
    path.points.truncate(21);
    edit(
        &mut session,
        id,
        &clip,
        &MaskEdit::Set {
            index: 0,
            patch: MaskPatch {
                path: Some(path),
                ..Default::default()
            },
        },
    )
    .unwrap();
    assert!(
        edit(
            &mut session,
            id,
            &clip,
            &MaskEdit::Add {
                shape: MaskShape::Path
            }
        )
        .is_err()
    );
    session.history.undo(&mut session.project);
    assert_eq!(session.timeline_revision(id), baseline);
    let invalid = MaskPatch {
        parameters: vec![MaskValue {
            param: MaskParam::Width,
            value: 20.0,
        }],
        ..Default::default()
    };
    assert!(
        edit(
            &mut session,
            id,
            &clip,
            &MaskEdit::Set {
                index: 0,
                patch: invalid
            }
        )
        .is_err()
    );
    for _ in 1..8 {
        edit(
            &mut session,
            id,
            &clip,
            &MaskEdit::Add {
                shape: MaskShape::Ellipse,
            },
        )
        .unwrap();
    }
    assert!(
        edit(
            &mut session,
            id,
            &clip,
            &MaskEdit::Add {
                shape: MaskShape::Rectangle
            }
        )
        .is_err()
    );
    edit(
        &mut session,
        id,
        &clip,
        &MaskEdit::Move {
            index: 0,
            to_index: 7,
        },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .masks[7]
            .shape,
        MaskShape::Path
    );
}
