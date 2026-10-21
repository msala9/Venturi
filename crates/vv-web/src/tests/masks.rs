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
            path: None,
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
            path: None,
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
                shape: MaskShape::Path,
                path: None,
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
                path: None,
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
                shape: MaskShape::Rectangle,
                path: None,
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

fn values(parameters: &[(MaskParam, f32)]) -> Vec<MaskValue> {
    parameters
        .iter()
        .map(|&(param, value)| MaskValue { param, value })
        .collect()
}
fn timeline_value(session: &Session, id: TimelineId) -> Value {
    serde_json::to_value(&session.project.timelines[id]).unwrap()
}

#[test]
fn viewer_boxes_mix_defaults_and_existing_keys_in_one_native_undo_without_touching_other_layers() {
    for shape in [MaskShape::Rectangle, MaskShape::Ellipse] {
        let (mut session, id, raw) = fixture();
        let other = core::ClipMask::new(MaskShape::Ellipse, (640, 360));
        let clip = &mut session.project.timelines[id].tracks[0].clips[0];
        clip.effects.masks = vec![core::ClipMask::new(shape, (640, 360)), other.clone()];
        clip.effects.masks[0].enabled = false;
        clip.effects.masks[0].track_mut(MaskParam::CenterY).upsert(
            12,
            6.0,
            core::Interpolation::Hold,
        );
        clip.effects
            .transform
            .track_mut(core::TransformParam::PositionX)
            .default = 73.0;
        clip.fade_in = 5;
        let other_id = session.project.alloc_clip_id();
        let mut other_track = core::Track::new(core::TrackKind::Video);
        other_track.insert_sorted(core::Clip::from_source_range(
            other_id,
            core::ClipSource::Text,
            0,
            48,
            0,
            core::Rational::one(),
        ));
        session.project.timelines[id].tracks.push(other_track);
        let before = timeline_value(&session, id);
        let position = session.history.position();
        let operation = crate::commands::Operation::EditViewerMask {
            clip_id: raw.clone(),
            index: 0,
            timeline_frame: 12,
            parameters: values(&[
                (MaskParam::CenterX, 20.0),
                (MaskParam::CenterY, 18.0),
                (MaskParam::Width, 128.0),
                (MaskParam::Height, 90.0),
                (MaskParam::Rotation, 30.0),
            ]),
            path: None,
        };
        crate::commands::apply(&mut session, id, &operation).unwrap();
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            session.history.labels().last(),
            Some(core::CommandLabel::Masks)
        );
        let clip = &session.project.timelines[id].tracks[0].clips[0];
        let mask = &clip.effects.masks[0];
        assert!(!mask.enabled);
        assert_eq!(clip.effects.masks[1], other);
        assert_eq!(mask.track(MaskParam::CenterX).default, 20.0);
        assert!(mask.track(MaskParam::CenterX).is_constant());
        assert_eq!(mask.track(MaskParam::CenterY).default, 0.0);
        assert_eq!(
            mask.track(MaskParam::CenterY).keyframes(),
            &[(12, 18.0, core::Interpolation::Linear)]
        );
        assert_eq!(mask.track(MaskParam::Width).default, 128.0);
        assert_eq!(mask.track(MaskParam::Height).default, 90.0);
        assert_eq!(mask.track(MaskParam::Rotation).default, 30.0);
        assert_eq!(
            clip.effects
                .transform
                .track(core::TransformParam::PositionX)
                .default,
            73.0
        );
        assert_eq!(clip.fade_in, 5);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id].tracks[1]).unwrap(),
            before["tracks"][1]
        );
        let after = timeline_value(&session, id);
        session.history.undo(&mut session.project);
        assert_eq!(timeline_value(&session, id), before);
        session.history.redo(&mut session.project);
        assert_eq!(timeline_value(&session, id), after);
    }
}

#[test]
fn mask_viewer_uses_native_retimed_animation_clock_even_when_picture_is_frozen() {
    for (rate, expected) in [
        (core::Rational::one(), 20),
        (core::Rational::new(2, 1), 10),
        (core::Rational::new(1, 2), 40),
    ] {
        let (mut session, id, raw) = fixture();
        let clip_id = session.project.timelines[id].tracks[0].clips[0].id;
        let mut clip = core::Clip::from_source_range(
            clip_id,
            core::ClipSource::SolidColor,
            12,
            60,
            100,
            core::Rational::one(),
        );
        clip.conform(rate);
        clip.freeze = Some(3);
        let mut mask = core::ClipMask::new(MaskShape::Path, (640, 360));
        let original = mask.path.default.clone();
        for frame in [0, 100] {
            mask.path
                .upsert(frame, original.clone(), core::Interpolation::Hold);
            mask.track_mut(MaskParam::CenterX)
                .upsert(frame, 0.0, core::Interpolation::Hold);
        }
        clip.effects.masks.push(mask);
        assert_eq!(clip.source_frame_at(108), expected);
        assert_eq!(clip.picture_frame_at(108), 3);
        session.project.timelines[id].tracks[0].clips[0] = clip;
        let before = timeline_value(&session, id);
        let position = session.history.position();
        let mut changed = original.clone();
        changed.points[0].point[0] += 10.0;
        changed.points[0].out_handle = [12.0, -3.0];
        viewer_edit(
            &mut session,
            id,
            &raw,
            0,
            108,
            &values(&[(MaskParam::CenterX, 45.0)]),
            Some(&changed),
        )
        .unwrap();
        let clip = &session.project.timelines[id].tracks[0].clips[0];
        let mask = &clip.effects.masks[0];
        assert_eq!(
            mask.track(MaskParam::CenterX).keyframe_at(expected),
            Some((45.0, core::Interpolation::Linear))
        );
        assert_eq!(
            mask.path.keyframe_at(expected),
            Some((changed.clone(), core::Interpolation::Linear))
        );
        assert_eq!(mask.path.default, original);
        assert_eq!(clip.picture_frame_at(108), 3);
        let summary = detail(clip, expected);
        assert_eq!(
            summary["items"][0]["evaluated_path"],
            serde_json::to_value(&changed).unwrap()
        );
        assert_eq!(
            summary["items"][0]["path"],
            serde_json::to_value(&original).unwrap()
        );
        assert_eq!(summary["items"][0]["path_keyframes"], 3);
        assert_eq!(session.history.position(), position + 1);
        session.history.undo(&mut session.project);
        assert_eq!(timeline_value(&session, id), before);
    }
}

#[test]
fn explicit_path_keys_enable_animated_viewer_topology_and_removal_with_exact_native_undo() {
    let (mut session, id, raw) = fixture();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::Add {
            shape: MaskShape::Path,
            path: None,
        },
    )
    .unwrap();
    let original = session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0]
        .path
        .default
        .clone();
    let first: MaskEdit = serde_json::from_value(
        json!({"action":"path_key","index":0,"timeline_frame":0,"path":original}),
    )
    .unwrap();
    edit(&mut session, id, &raw, &first).unwrap();
    let mut triangle = original.clone();
    triangle.points.pop();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::PathKey {
            index: 0,
            timeline_frame: 24,
            path: Some(triangle.clone()),
        },
    )
    .unwrap();
    let before = timeline_value(&session, id);
    let position = session.history.position();
    let mut changed = original.clone();
    changed.points[0].in_handle = [-12.0, 6.0];
    changed.points[0].out_handle = [12.0, -6.0];
    changed.points.push(core::PathPoint::corner([-70.0, 0.0]));
    viewer_edit(
        &mut session,
        id,
        &raw,
        0,
        12,
        &values(&[(MaskParam::CenterY, 13.0), (MaskParam::Rotation, 15.0)]),
        Some(&changed),
    )
    .unwrap();
    let mask = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0];
    assert_eq!(mask.path.default, original);
    assert_eq!(mask.path.value_at(6), original);
    assert_eq!(mask.path.value_at(18), changed);
    assert_eq!(mask.path.value_at(24), triangle);
    assert_eq!(
        mask.path.keyframe_at(12),
        Some((changed.clone(), core::Interpolation::Linear))
    );
    assert_eq!(session.history.position(), position + 1);
    let after = timeline_value(&session, id);
    session.history.undo(&mut session.project);
    assert_eq!(timeline_value(&session, id), before);
    session.history.redo(&mut session.project);
    assert_eq!(timeline_value(&session, id), after);
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::PathKey {
            index: 0,
            timeline_frame: 12,
            path: None,
        },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .masks[0]
            .path
            .keyframes()
            .len(),
        2
    );
    session.history.undo(&mut session.project);
    assert_eq!(timeline_value(&session, id), after);
    let position = session.history.position();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::PathKey {
            index: 0,
            timeline_frame: 13,
            path: None,
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position);
    let mask = &mut session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0];
    for frame in 0..20 {
        mask.path
            .upsert(frame, original.clone(), core::Interpolation::Linear);
    }
    let summary = detail(&session.project.timelines[id].tracks[0].clips[0], 12);
    assert_eq!(
        summary["items"][0]["path_keys"].as_array().unwrap().len(),
        16
    );
    assert_eq!(summary["items"][0]["path_keyframes"], 21);
    assert_eq!(
        summary["items"][0]["path_keys"][0],
        json!([0, original, "Linear"])
    );
}

#[test]
fn static_path_viewer_edits_vertices_handles_and_center_as_one_default_change() {
    let (mut session, id, raw) = fixture();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::Add {
            shape: MaskShape::Path,
            path: None,
        },
    )
    .unwrap();
    let before = timeline_value(&session, id);
    let position = session.history.position();
    let mut path = session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0]
        .path
        .default
        .clone();
    path.points[1].point = [50.0, 30.0];
    path.points[1].in_handle = [-10.0, 2.0];
    path.points[1].out_handle = [10.0, -2.0];
    viewer_edit(
        &mut session,
        id,
        &raw,
        0,
        12,
        &values(&[(MaskParam::CenterX, 25.0), (MaskParam::Rotation, -20.0)]),
        Some(&path),
    )
    .unwrap();
    let mask = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0];
    assert_eq!(mask.path.default, path);
    assert!(mask.path.is_constant());
    assert_eq!(mask.track(MaskParam::CenterX).default, 25.0);
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(timeline_value(&session, id), before);
}

#[test]
fn viewer_noops_preserve_hold_interpolation_defaults_and_history() {
    let (mut session, id, raw) = fixture();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::Add {
            shape: MaskShape::Path,
            path: None,
        },
    )
    .unwrap();
    let mask = &mut session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks[0];
    let path = mask.path.default.clone();
    mask.path
        .upsert(12, path.clone(), core::Interpolation::Hold);
    mask.track_mut(MaskParam::CenterX)
        .upsert(12, 30.0, core::Interpolation::Hold);
    let before = timeline_value(&session, id);
    let position = session.history.position();
    viewer_edit(
        &mut session,
        id,
        &raw,
        0,
        12,
        &values(&[
            (MaskParam::CenterX, 30.0),
            (MaskParam::CenterY, f32::EPSILON / 2.0),
        ]),
        Some(&path),
    )
    .unwrap();
    assert_eq!(timeline_value(&session, id), before);
    assert_eq!(session.history.position(), position);
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::PathKey {
            index: 0,
            timeline_frame: 13,
            path: None,
        },
    )
    .unwrap();
    assert_eq!(timeline_value(&session, id), before);
    assert_eq!(session.history.position(), position);
}

#[test]
fn viewer_mask_rejections_are_atomic_for_shape_geometry_clock_and_shared_path_budget() {
    for case in 0..14 {
        let (mut session, id, raw) = fixture();
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .masks = vec![
            core::ClipMask::new(MaskShape::Path, (640, 360)),
            core::ClipMask::new(MaskShape::Path, (640, 360)),
        ];
        let mut parameters = values(&[(MaskParam::CenterX, 10.0)]);
        let mut path = None;
        let mut index = 0;
        let mut frame = 12;
        match case {
            0 => parameters.push(MaskValue {
                param: MaskParam::CenterX,
                value: 20.0,
            }),
            1 => parameters.push(MaskValue {
                param: MaskParam::Width,
                value: 20.0,
            }),
            2 => parameters.push(MaskValue {
                param: MaskParam::Opacity,
                value: 50.0,
            }),
            3 => parameters.push(MaskValue {
                param: MaskParam::Rotation,
                value: 361.0,
            }),
            4 => parameters.push(MaskValue {
                param: MaskParam::CenterY,
                value: f32::NAN,
            }),
            5 => {
                path = Some(core::MaskPath {
                    points: vec![core::PathPoint::corner([0.0, 0.0]); 2],
                })
            }
            6 => {
                path = Some(core::MaskPath {
                    points: vec![core::PathPoint::corner([0.0, 0.0]); 21],
                })
            }
            7 => {
                let mut invalid = core::ClipMask::new(MaskShape::Path, (640, 360))
                    .path
                    .default;
                invalid.points[0].out_handle = [f32::INFINITY, 0.0];
                path = Some(invalid);
            }
            8 => {
                session.project.timelines[id].tracks[0].clips[0]
                    .effects
                    .masks[0]
                    .shape = MaskShape::Rectangle;
                path = Some(
                    core::ClipMask::new(MaskShape::Path, (640, 360))
                        .path
                        .default,
                );
            }
            9 => index = 8,
            10 => frame = 48,
            11 => frame = -1,
            12 => session.project.timelines[id].tracks[0].locked = true,
            _ => session.project.timelines[id].tracks[0].kind = core::TrackKind::Audio,
        }
        let before = timeline_value(&session, id);
        let position = session.history.position();
        assert!(
            viewer_edit(
                &mut session,
                id,
                &raw,
                index,
                frame,
                &parameters,
                path.as_ref()
            )
            .is_err(),
            "Case {case}"
        );
        assert_eq!(timeline_value(&session, id), before, "Case {case}");
        assert_eq!(session.history.position(), position, "Case {case}");
    }
}

#[test]
fn explicit_path_key_rejects_invalid_geometry_before_any_native_history_change() {
    let (mut session, id, raw) = fixture();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::Add {
            shape: MaskShape::Path,
            path: None,
        },
    )
    .unwrap();
    let before = timeline_value(&session, id);
    let position = session.history.position();
    for invalid in [
        MaskEdit::PathKey {
            index: 0,
            timeline_frame: 48,
            path: None,
        },
        MaskEdit::PathKey {
            index: 8,
            timeline_frame: 12,
            path: None,
        },
        MaskEdit::PathKey {
            index: 0,
            timeline_frame: 12,
            path: Some(core::MaskPath {
                points: vec![core::PathPoint::corner([0.0, 0.0]); 22],
            }),
        },
    ] {
        assert!(edit(&mut session, id, &raw, &invalid).is_err());
        assert_eq!(timeline_value(&session, id), before);
        assert_eq!(session.history.position(), position);
    }
}

fn drawn_path() -> core::MaskPath {
    core::MaskPath {
        points: vec![
            core::PathPoint {
                point: [-45.0, 30.0],
                in_handle: [-2.0, -3.0],
                out_handle: [12.0, 5.0],
            },
            core::PathPoint::corner([70.0, 10.0]),
            core::PathPoint {
                point: [0.0, -55.0],
                in_handle: [8.0, 4.0],
                out_handle: [-6.0, 2.0],
            },
        ],
    }
}

#[test]
fn completed_pen_path_adds_one_native_static_mask_and_undo_redo_preserves_existing_stack() {
    let (mut session, id, raw) = fixture();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::Add {
            shape: MaskShape::Ellipse,
            path: None,
        },
    )
    .unwrap();
    let before = timeline_value(&session, id);
    let steps = session.history.position();
    let path = drawn_path();
    edit(
        &mut session,
        id,
        &raw,
        &MaskEdit::Add {
            shape: MaskShape::Path,
            path: Some(path.clone()),
        },
    )
    .unwrap();
    let masks = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .masks;
    assert_eq!(masks.len(), 2);
    assert_eq!(
        serde_json::to_value(&masks[0]).unwrap(),
        before["tracks"][0]["clips"][0]["effects"]["masks"][0]
    );
    assert_eq!(masks[1].path.default, path);
    assert!(masks[1].path.is_constant());
    assert_eq!(masks[1].track(MaskParam::CenterX).default, 0.0);
    assert_eq!(masks[1].track(MaskParam::CenterY).default, 0.0);
    assert_eq!(masks[1].track(MaskParam::Rotation).default, 0.0);
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(core::CommandLabel::Masks)
    );
    let after = timeline_value(&session, id);
    session.history.undo(&mut session.project);
    assert_eq!(timeline_value(&session, id), before);
    session.history.redo(&mut session.project);
    assert_eq!(timeline_value(&session, id), after);
    let legacy: MaskEdit = serde_json::from_value(json!({"action":"add","shape":"Path"})).unwrap();
    assert!(matches!(legacy, MaskEdit::Add { path: None, .. }));
    edit(&mut session, id, &raw, &legacy).unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .masks[2]
            .path
            .default
            .points
            .len(),
        4
    );
}

#[test]
fn completed_pen_add_rejects_invalid_shape_geometry_budget_or_lock_without_partial_mask() {
    for scenario in 0..10 {
        let (mut session, id, raw) = fixture();
        let mut path = drawn_path();
        let mut shape = MaskShape::Path;
        match scenario {
            0 => shape = MaskShape::Rectangle,
            1 => shape = MaskShape::Ellipse,
            2 => path.points.truncate(2),
            3 => path.points = vec![core::PathPoint::corner([0.0, 0.0]); 22],
            4 => path.points[0].in_handle[0] = f32::NAN,
            5 => path.points[1].point[1] = 100_001.0,
            6 => {
                edit(
                    &mut session,
                    id,
                    &raw,
                    &MaskEdit::Add {
                        shape: MaskShape::Path,
                        path: None,
                    },
                )
                .unwrap();
                path.points = vec![core::PathPoint::corner([0.0, 0.0]); 21];
            }
            7 => {
                for _ in 0..8 {
                    edit(
                        &mut session,
                        id,
                        &raw,
                        &MaskEdit::Add {
                            shape: MaskShape::Ellipse,
                            path: None,
                        },
                    )
                    .unwrap();
                }
            }
            8 => session.project.timelines[id].tracks[0].locked = true,
            _ => session.project.timelines[id].tracks[0].kind = core::TrackKind::Audio,
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let steps = session.history.position();
        assert!(
            edit(
                &mut session,
                id,
                &raw,
                &MaskEdit::Add {
                    shape,
                    path: Some(path)
                }
            )
            .is_err(),
            "scenario {scenario}"
        );
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            before,
            "scenario {scenario}"
        );
        assert_eq!(session.history.position(), steps);
    }
}

#[test]
fn path_navigation_uses_full_native_track_source_range_and_retimed_clock_independent_of_freeze() {
    for (fps, source_fps, speed) in [
        (
            core::Rational::new(24, 1),
            core::Rational::new(24, 1),
            core::Rational::one(),
        ),
        (
            core::Rational::new(30000, 1001),
            core::Rational::new(24, 1),
            core::Rational::new(3, 2),
        ),
        (
            core::Rational::new(24, 1),
            core::Rational::new(30, 1),
            core::Rational::new(2, 1),
        ),
        (
            core::Rational::new(24, 1),
            core::Rational::new(24, 1),
            core::Rational::new(1, 2),
        ),
    ] {
        let (mut session, id, raw) = fixture();
        session.project.timelines[id].fps = fps;
        let clip_id = session.project.timelines[id].tracks[0].clips[0].id;
        let conform = core::Rational::conform_rate(fps, source_fps);
        let mut clip = core::Clip::from_source_range(
            clip_id,
            core::ClipSource::SolidColor,
            12,
            200,
            100,
            conform,
        );
        clip.set_speed(speed, conform);
        clip.freeze = Some(1);
        let first = clip.source_in();
        let last = clip.source_out();
        let mut mask = core::ClipMask::new(MaskShape::Path, (640, 360));
        let path = drawn_path();
        for source_frame in first - 1..=last + 1 {
            mask.path
                .upsert(source_frame, path.clone(), core::Interpolation::Hold);
        }
        clip.effects.masks.push(mask);
        session.project.timelines[id].tracks[0].clips[0] = clip;
        let clip = &session.project.timelines[id].tracks[0].clips[0];
        let playhead = 140;
        let frame = clip.source_frame_at(playhead);
        assert!(clip.contains(playhead));
        assert_eq!(clip.picture_frame_at(playhead), 1);
        assert!(frame > first + 16);
        let summary = inspector::detail(&session, id, &raw, playhead).unwrap();
        let item = &summary["masks"]["items"][0];
        assert_eq!(item["path_keys"].as_array().unwrap().len(), 16);
        assert!(item["path_keyframes"].as_u64().unwrap() > 16);
        assert_eq!(
            item["path_navigation"],
            json!({"on_keyframe":true,
            "previous":{"source_frame":frame-1,"timeline_frame":clip.timeline_frame_at(frame-1)},
            "next":{"source_frame":frame+1,"timeline_frame":clip.timeline_frame_at(frame+1)}})
        );
        let first_navigation = &detail(clip, first)["items"][0]["path_navigation"];
        assert_eq!(first_navigation["previous"], Value::Null);
        let last_navigation = &detail(clip, last - 1)["items"][0]["path_navigation"];
        assert_eq!(last_navigation["next"], Value::Null);
        assert_eq!(last_navigation["on_keyframe"], true);
    }
}

#[test]
fn path_navigation_is_strict_and_excludes_outside_and_exclusive_end_keys() {
    let (mut session, id, _) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    let mut mask = core::ClipMask::new(MaskShape::Path, (640, 360));
    let path = drawn_path();
    clip.effects.masks.push(mask.clone());
    assert_eq!(
        detail(clip, 12)["items"][0]["path_navigation"],
        json!({"on_keyframe":false,"previous":null,"next":null})
    );
    for frame in [-1, 0, 20, 48, 60] {
        mask.path
            .upsert(frame, path.clone(), core::Interpolation::Linear);
    }
    clip.effects.masks[0] = mask;
    assert_eq!(
        detail(clip, 20)["items"][0]["path_navigation"],
        json!({"on_keyframe":true,"previous":{"source_frame":0,"timeline_frame":0},"next":null})
    );
    assert_eq!(
        detail(clip, 12)["items"][0]["path_navigation"],
        json!({"on_keyframe":false,"previous":{"source_frame":0,"timeline_frame":0},"next":{"source_frame":20,"timeline_frame":20}})
    );
    clip.effects
        .masks
        .push(core::ClipMask::new(MaskShape::Rectangle, (640, 360)));
    assert_eq!(detail(clip, 12)["items"][1]["path_navigation"], Value::Null);
}
