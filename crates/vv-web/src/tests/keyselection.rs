use super::*;
use vv_core::{ClipSource, Interpolation, Keyframed, Rational, Timeline, Track, TrackKind};

fn fixture() -> (Session, TimelineId, String) {
    let mut s = Session::default();
    let id = s.create_timeline(Timeline {
        name: "Cross parameter keys".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 36),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let raw = s.project.alloc_clip_id();
    let mut clip = Clip::from_source_range(raw, ClipSource::SolidColor, 0, 96, 0, Rational::one());
    for param in [
        TransformParam::ZoomX,
        TransformParam::ZoomY,
        TransformParam::Opacity,
    ] {
        clip.effects
            .transform
            .track_mut(param)
            .upsert(10, 1.0, Interpolation::EaseIn);
    }
    clip.effects.color = Some(Keyframed::constant(core::Rgba::WHITE));
    clip.effects
        .color
        .as_mut()
        .unwrap()
        .upsert(12, core::Rgba::BLACK, Interpolation::Hold);
    clip.effects.title = Some(Default::default());
    clip.effects.title.as_mut().unwrap().content.upsert(
        14,
        "<literal> α".into(),
        Interpolation::Hold,
    );
    let mut blur = core::ClipFilter::new(core::FilterKind::GaussianBlur);
    blur.direction
        .upsert(16, core::BlurDirection::Vertical, Interpolation::EaseOut);
    clip.effects.filters.push(blur);
    s.project.timelines[id].tracks[0].insert_sorted(clip);
    (s, id, raw.0.to_string())
}

#[test]
fn pointer_drag_matches_native_mixed_time_move_and_grabbed_only_value_with_one_undo() {
    use vv_core::Command;
    let (mut s, id, raw) = fixture();
    let clip = &mut s.project.timelines[id].tracks[0].clips[0];
    let clip_id = clip.id;
    clip.effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .upsert(20, 1.5, Interpolation::Hold);
    clip.effects
        .transform
        .track_mut(TransformParam::ZoomY)
        .upsert(10, 0.7, Interpolation::Hold);
    let mut request = selection();
    request.picks.push(Pick {
        target: Target::Scalar(inspector::Target::Transform {
            param: TransformParam::ZoomX,
        }),
        source_frame: 20,
    });
    request.action = Action::Drag {
        delta_source_frames: 3,
        grabbed: Grabbed {
            target: inspector::Target::Transform {
                param: TransformParam::ZoomX,
            },
            source_frame: 10,
            value: 1.75,
        },
    };
    let before = serde_json::to_value(&s.project).unwrap();
    let mut expected = s.project.clone();
    let picks = vec![
        (KeyframeTarget::TransformParam(TransformParam::ZoomX), 10),
        (KeyframeTarget::TransformParam(TransformParam::ZoomY), 10),
        (KeyframeTarget::TransformParam(TransformParam::ZoomX), 20),
        (KeyframeTarget::TransformParam(TransformParam::Opacity), 10),
        (KeyframeTarget::Color, 12),
        (KeyframeTarget::Text, 14),
        (
            KeyframeTarget::FilterDirection(core::FilterKind::GaussianBlur),
            16,
        ),
    ];
    core::MoveKeyframes::new(id, 0, clip_id, picks, 3).apply(&mut expected);
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        core::UpsertKeyframe::new(
            id,
            0,
            clip_id,
            13,
            core::KeyframeValue::TransformParam(param, 1.75),
            Interpolation::EaseIn,
        )
        .apply(&mut expected);
    }
    let position = s.history.position();
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position + 1);
    assert_eq!(
        serde_json::to_value(&s.project).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::ZoomX)
            .keyframes()[1],
        (23, 1.5, Interpolation::Hold)
    );
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()[0]
            .1,
        1.0
    );
    let after = serde_json::to_value(&s.project).unwrap();
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
    s.history.redo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), after);
}

#[test]
fn pointer_drag_rejects_stale_grab_invalid_value_collision_and_locks_before_moving_any_key() {
    for case in 0..8 {
        let (mut s, id, raw) = fixture();
        let mut request = selection();
        let mut grabbed = Grabbed {
            target: inspector::Target::Transform {
                param: TransformParam::ZoomX,
            },
            source_frame: 10,
            value: 1.5,
        };
        let mut delta = 2;
        match case {
            0 => grabbed.source_frame = 11,
            1 => grabbed.value = f32::NAN,
            2 => grabbed.value = -1.0,
            3 => delta = i64::MAX,
            4 => delta = -20,
            5 => s.project.timelines[id].tracks[0].locked = true,
            6 => s.project.timelines[id].tracks[0].clips[0]
                .effects
                .transform
                .track_mut(TransformParam::Opacity)
                .upsert(12, 0.2, Interpolation::Hold),
            _ => {
                grabbed.target = inspector::Target::FilterOffset {
                    filter: core::FilterKind::GaussianBlur,
                    axis: 2,
                }
            }
        }
        request.action = Action::Drag {
            delta_source_frames: delta,
            grabbed,
        };
        let before = serde_json::to_value(&s.project).unwrap();
        let position = s.history.position();
        assert!(edit(&mut s, id, &raw, &request).is_err(), "case {case}");
        assert_eq!(s.history.position(), position, "case {case}");
        assert_eq!(
            serde_json::to_value(&s.project).unwrap(),
            before,
            "case {case}"
        );
    }
}

#[test]
fn pointer_vertical_only_drag_updates_existing_twin_but_does_not_create_missing_twin() {
    let (mut s, id, raw) = fixture();
    let mut request = selection();
    request.picks.truncate(1);
    request.action = Action::Drag {
        delta_source_frames: 0,
        grabbed: Grabbed {
            target: inspector::Target::Transform {
                param: TransformParam::ZoomX,
            },
            source_frame: 10,
            value: 1.0,
        },
    };
    let position = s.history.position();
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position);
    s.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::ZoomY)
        .upsert(10, 0.5, Interpolation::Hold);
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position + 1);
    assert_eq!(
        s.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()[0],
        (10, 1.0, Interpolation::EaseIn)
    );
    s.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::ZoomY)
        .remove_at(10);
    request.action = Action::Drag {
        delta_source_frames: 0,
        grabbed: Grabbed {
            target: inspector::Target::Transform {
                param: TransformParam::ZoomX,
            },
            source_frame: 10,
            value: 1.4,
        },
    };
    edit(&mut s, id, &raw, &request).unwrap();
    assert!(
        s.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()
            .is_empty()
    );
}
fn selection() -> Edit {
    Edit {
        picks: vec![
            Pick {
                target: Target::Scalar(inspector::Target::Transform {
                    param: TransformParam::ZoomX,
                }),
                source_frame: 10,
            },
            Pick {
                target: Target::Scalar(inspector::Target::Transform {
                    param: TransformParam::Opacity,
                }),
                source_frame: 10,
            },
            Pick {
                target: Target::Value(eventkeys::Target::Color),
                source_frame: 12,
            },
            Pick {
                target: Target::Value(eventkeys::Target::Text),
                source_frame: 14,
            },
            Pick {
                target: Target::Value(eventkeys::Target::Direction {
                    filter: core::FilterKind::GaussianBlur,
                }),
                source_frame: 16,
            },
        ],
        link_zoom: true,
        replace_destination_keys: false,
        action: Action::Move {
            delta_source_frames: 2,
        },
    }
}
#[test]
fn mixed_targets_and_zoom_twins_use_native_commands_and_restore_exactly_in_one_undo() {
    let (mut s, id, raw) = fixture();
    let before = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    let mut request = selection();
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position + 1);
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    for param in [
        TransformParam::ZoomX,
        TransformParam::ZoomY,
        TransformParam::Opacity,
    ] {
        assert_eq!(
            clip.effects.transform.track(param).keyframes(),
            &[(12, 1.0, Interpolation::EaseIn)]
        );
    }
    assert_eq!(
        clip.effects.color.as_ref().unwrap().keyframes(),
        &[(14, core::Rgba::BLACK, Interpolation::Hold)]
    );
    assert_eq!(
        clip.effects.title.as_ref().unwrap().content.keyframes()[0].0,
        16
    );
    assert_eq!(
        clip.effects.title.as_ref().unwrap().content.keyframes()[0].1,
        "<literal> α"
    );
    assert_eq!(clip.effects.filters[0].direction.keyframes()[0].0, 18);
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
    request.action = Action::Interpolation {
        interpolation: Interpolation::Bezier {
            c1: [0.2, -0.1],
            c2: [0.8, 1.1],
        },
    };
    edit(&mut s, id, &raw, &request).unwrap();
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()[0]
            .2,
        Interpolation::Bezier {
            c1: [0.2, -0.1],
            c2: [0.8, 1.1]
        }
    );
    assert!(matches!(
        clip.effects.title.as_ref().unwrap().content.keyframes()[0].2,
        Interpolation::Bezier { .. }
    ));
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
    request.action = Action::Delete;
    edit(&mut s, id, &raw, &request).unwrap();
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    assert!(
        clip.effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()
            .is_empty()
    );
    assert!(clip.effects.color.as_ref().unwrap().keyframes().is_empty());
    assert!(
        clip.effects
            .title
            .as_ref()
            .unwrap()
            .content
            .keyframes()
            .is_empty()
    );
    assert!(clip.effects.filters[0].direction.keyframes().is_empty());
    assert_eq!(s.project.timelines[id].tracks[0].clips.len(), 1);
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
}
#[test]
fn mixed_selection_rejects_collisions_missing_keys_locks_overflow_and_invalid_controls_atomically()
{
    for case in 0..9 {
        let (mut s, id, raw) = fixture();
        let mut request = selection();
        match case {
            0 => s.project.timelines[id].tracks[0].clips[0]
                .effects
                .transform
                .track_mut(TransformParam::ZoomY)
                .upsert(12, 3.0, Interpolation::Hold),
            1 => request.picks[4].source_frame = 17,
            2 => request.picks.push(request.picks[0].clone()),
            3 => {
                request.action = Action::Move {
                    delta_source_frames: i64::MAX,
                }
            }
            4 => {
                request.action = Action::Move {
                    delta_source_frames: -17,
                }
            }
            5 => s.project.timelines[id].tracks[0].locked = true,
            6 => {
                request.action = Action::Interpolation {
                    interpolation: Interpolation::Bezier {
                        c1: [f32::NAN, 0.0],
                        c2: [0.8, 1.0],
                    },
                }
            }
            7 => request.picks.clear(),
            _ => {
                request.picks[0].target = Target::Scalar(inspector::Target::FilterOffset {
                    filter: core::FilterKind::GaussianBlur,
                    axis: 2,
                })
            }
        }
        let before = serde_json::to_value(&s.project).unwrap();
        let position = s.history.position();
        assert!(edit(&mut s, id, &raw, &request).is_err(), "case {case}");
        assert_eq!(s.history.position(), position, "case {case}");
        assert_eq!(
            serde_json::to_value(&s.project).unwrap(),
            before,
            "case {case}"
        );
    }
}
#[test]
fn zoom_link_ignores_missing_twins_and_zero_delta_has_no_history_step() {
    let (mut s, id, raw) = fixture();
    let mut request = selection();
    s.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::ZoomY)
        .remove_at(10);
    request.picks.truncate(1);
    request.action = Action::Move {
        delta_source_frames: 0,
    };
    let position = s.history.position();
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position);
    request.action = Action::Move {
        delta_source_frames: 2,
    };
    edit(&mut s, id, &raw, &request).unwrap();
    assert!(
        s.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()
            .is_empty()
    );
    let serialized = serde_json::to_string(&request).unwrap();
    let decoded: Edit = serde_json::from_str(&serialized).unwrap();
    assert_eq!(decoded.picks.len(), 1);
    let invalid = serialized.replace("\"link_zoom\":true", "\"link_zoom\":true,\"unexpected\":1");
    assert!(serde_json::from_str::<Edit>(&invalid).is_err());
}

#[test]
fn every_advertised_scalar_target_and_mixed_values_share_one_native_move() {
    let (mut s, id, raw) = fixture();
    for kind in [
        core::FilterKind::ColorCorrection,
        core::FilterKind::Exposure,
        core::FilterKind::BoxBlur,
        core::FilterKind::DropShadow,
    ] {
        s.project.timelines[id].tracks[0].clips[0]
            .effects
            .filters
            .push(core::ClipFilter::new(kind));
    }
    crate::masks::edit(
        &mut s,
        id,
        &raw,
        &crate::masks::MaskEdit::Add {
            shape: core::MaskShape::Rectangle,
            path: None,
        },
    )
    .unwrap();
    let detail = curves::detail(&s, id, &s.project.timelines[id].tracks[0].clips[0], 0);
    let mut picks = Vec::new();
    for row in detail["tracks"].as_array().unwrap() {
        let target: inspector::Target = serde_json::from_value(row["target"].clone()).unwrap();
        curves::edit(
            &mut s,
            id,
            &raw,
            &curves::Edit {
                target: target.clone(),
                previous_source_frame: None,
                source_frame: 20,
                value: Some(row["default"].as_f64().unwrap() as f32),
                interpolation: Interpolation::EaseOut,
                link_zoom: false,
            },
        )
        .unwrap();
        picks.push(Pick {
            target: Target::Scalar(target),
            source_frame: 20,
        });
    }
    assert!(picks.len() > 40);
    let before = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    edit(
        &mut s,
        id,
        &raw,
        &Edit {
            picks,
            link_zoom: true,
            replace_destination_keys: false,
            action: Action::Move {
                delta_source_frames: 2,
            },
        },
    )
    .unwrap();
    assert_eq!(s.history.position(), position + 1);
    let moved = curves::detail(&s, id, &s.project.timelines[id].tracks[0].clips[0], 0);
    for row in moved["tracks"].as_array().unwrap() {
        assert!(
            row["keys"]
                .as_array()
                .unwrap()
                .iter()
                .any(|key| key["source_frame"] == 22)
        );
    }
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
}

#[test]
fn destination_replacement_is_explicit_and_matches_native_value_interpolation_undo_and_redo() {
    use vv_core::Command;
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    let clip_id = clip.id;
    clip.effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .upsert(
            12,
            1.75,
            Interpolation::Bezier {
                c1: [0.3, -0.2],
                c2: [0.7, 1.2],
            },
        );
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(12, 0.3, Interpolation::Hold);
    let mut request = selection();
    request.picks.truncate(1);
    request.link_zoom = false;
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let generation = session.history.generation();
    assert_eq!(
        edit(&mut session, id, &raw, &request).unwrap_err().1,
        "KEYFRAME_COLLISION"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
    request.replace_destination_keys = true;
    let mut expected = session.project.clone();
    core::MoveKeyframes::new(
        id,
        0,
        clip_id,
        vec![(KeyframeTarget::TransformParam(TransformParam::ZoomX), 10)],
        2,
    )
    .apply(&mut expected);
    edit(&mut session, id, &raw, &request).unwrap();
    let after = serde_json::to_value(&session.project).unwrap();
    assert_eq!(after, serde_json::to_value(expected).unwrap());
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .keyframes(),
        &[(12, 1.0, Interpolation::EaseIn)],
    );
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.history.redo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), after);

    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    let clip_id = clip.id;
    let track = clip.effects.transform.track_mut(TransformParam::ZoomX);
    track.upsert(12, 1.25, Interpolation::Hold);
    track.upsert(14, 1.75, Interpolation::EaseOut);
    let mut request = selection();
    request.picks.truncate(1);
    request.picks.push(Pick {
        target: request.picks[0].target.clone(),
        source_frame: 12,
    });
    request.link_zoom = false;
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    assert_eq!(
        edit(&mut session, id, &raw, &request).unwrap_err().1,
        "KEYFRAME_COLLISION"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    request.replace_destination_keys = true;
    let mut expected = session.project.clone();
    core::MoveKeyframes::new(
        id,
        0,
        clip_id,
        vec![
            (KeyframeTarget::TransformParam(TransformParam::ZoomX), 10),
            (KeyframeTarget::TransformParam(TransformParam::ZoomX), 12),
        ],
        2,
    )
    .apply(&mut expected);
    edit(&mut session, id, &raw, &request).unwrap();
    let after = serde_json::to_value(&session.project).unwrap();
    assert_eq!(after, serde_json::to_value(expected).unwrap());
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .keyframes(),
        &[
            (12, 1.0, Interpolation::EaseIn),
            (14, 1.25, Interpolation::Hold)
        ],
    );
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.history.redo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), after);
}

#[test]
fn destination_replacement_mixed_move_and_drag_match_native_zoom_twins_as_one_undo() {
    use vv_core::Command;
    for drag in [false, true] {
        let (mut session, id, raw) = fixture();
        let clip = &mut session.project.timelines[id].tracks[0].clips[0];
        let clip_id = clip.id;
        for param in [
            TransformParam::ZoomX,
            TransformParam::ZoomY,
            TransformParam::Opacity,
        ] {
            clip.effects
                .transform
                .track_mut(param)
                .upsert(12, 0.5, Interpolation::EaseOut);
        }
        clip.effects
            .transform
            .track_mut(TransformParam::ZoomY)
            .upsert(10, 0.75, Interpolation::Hold);
        clip.effects
            .color
            .as_mut()
            .unwrap()
            .upsert(14, core::Rgba::WHITE, Interpolation::EaseOut);
        clip.effects.title.as_mut().unwrap().content.upsert(
            16,
            "Destination text".into(),
            Interpolation::Linear,
        );
        clip.effects.filters[0].direction.upsert(
            18,
            core::BlurDirection::Horizontal,
            Interpolation::Linear,
        );
        let mut request = selection();
        request.replace_destination_keys = true;
        if drag {
            request.action = Action::Drag {
                delta_source_frames: 2,
                grabbed: Grabbed {
                    target: inspector::Target::Transform {
                        param: TransformParam::ZoomX,
                    },
                    source_frame: 10,
                    value: 1.5,
                },
            };
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let mut expected = session.project.clone();
        core::MoveKeyframes::new(
            id,
            0,
            clip_id,
            vec![
                (KeyframeTarget::TransformParam(TransformParam::ZoomX), 10),
                (KeyframeTarget::TransformParam(TransformParam::ZoomY), 10),
                (KeyframeTarget::TransformParam(TransformParam::Opacity), 10),
                (KeyframeTarget::Color, 12),
                (KeyframeTarget::Text, 14),
                (
                    KeyframeTarget::FilterDirection(core::FilterKind::GaussianBlur),
                    16,
                ),
            ],
            2,
        )
        .apply(&mut expected);
        if drag {
            for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
                core::UpsertKeyframe::new(
                    id,
                    0,
                    clip_id,
                    12,
                    core::KeyframeValue::TransformParam(param, 1.5),
                    Interpolation::EaseIn,
                )
                .apply(&mut expected);
            }
        }
        edit(&mut session, id, &raw, &request).unwrap();
        let after = serde_json::to_value(&session.project).unwrap();
        assert_eq!(
            after,
            serde_json::to_value(expected).unwrap(),
            "drag={drag}"
        );
        assert_eq!(session.history.position(), position + 1);
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        session.history.redo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), after);
    }
}

#[test]
fn destination_replacement_keeps_invalid_selections_atomic_and_zero_delta_keeps_redo() {
    for case in 0..8 {
        let (mut session, id, raw) = fixture();
        let mut request = selection();
        request.replace_destination_keys = true;
        match case {
            0 => session.project.timelines[id].tracks[0].locked = true,
            1 => request.picks[3].source_frame += 1,
            2 => request.picks.push(request.picks[0].clone()),
            3 => {
                request.action = Action::Move {
                    delta_source_frames: i64::MAX,
                }
            }
            4 => {
                request.action = Action::Move {
                    delta_source_frames: -20,
                }
            }
            5 => {
                request.picks[0].target = Target::Scalar(inspector::Target::FilterOffset {
                    filter: core::FilterKind::GaussianBlur,
                    axis: 2,
                })
            }
            6 | 7 => {
                request.action = Action::Drag {
                    delta_source_frames: 2,
                    grabbed: Grabbed {
                        target: inspector::Target::Transform {
                            param: TransformParam::ZoomX,
                        },
                        source_frame: if case == 6 { 10 } else { 11 },
                        value: if case == 6 { f32::NAN } else { 1.5 },
                    },
                }
            }
            _ => unreachable!(),
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        assert!(
            edit(&mut session, id, &raw, &request).is_err(),
            "case {case}"
        );
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            before,
            "case {case}"
        );
        assert_eq!(session.history.position(), position);
        assert_eq!(session.history.generation(), generation);
    }
    let (mut session, id, raw) = fixture();
    let mut request = selection();
    request.replace_destination_keys = true;
    edit(&mut session, id, &raw, &request).unwrap();
    let moved = serde_json::to_value(&session.project).unwrap();
    session.history.undo(&mut session.project);
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    request.action = Action::Move {
        delta_source_frames: 0,
    };
    edit(&mut session, id, &raw, &request).unwrap();
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
    session.history.redo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), moved);
}

#[test]
fn destination_replacement_flag_is_strict_optional_and_preserves_legacy_command_bytes() {
    let legacy = serde_json::to_value(selection()).unwrap();
    assert!(legacy.get("replace_destination_keys").is_none());
    let decoded: Edit = serde_json::from_value(legacy.clone()).unwrap();
    assert!(!decoded.replace_destination_keys);
    assert_eq!(serde_json::to_value(decoded).unwrap(), legacy);
    for flag in [false, true] {
        let mut value = legacy.clone();
        value["replace_destination_keys"] = serde_json::json!(flag);
        let operation = serde_json::json!({"kind":"edit_key_selection","clip_id":"1","edit":value});
        let decoded: crate::commands::Operation = serde_json::from_value(operation).unwrap();
        let serialized = serde_json::to_value(decoded).unwrap();
        if !flag {
            assert!(serialized["edit"].get("replace_destination_keys").is_none());
        } else {
            assert_eq!(serialized["edit"]["replace_destination_keys"], true);
        }
    }
    for flag in [
        serde_json::json!("true"),
        serde_json::json!(1),
        serde_json::Value::Null,
        serde_json::json!([]),
    ] {
        let mut value = legacy.clone();
        value["replace_destination_keys"] = flag;
        assert!(serde_json::from_value::<Edit>(value).is_err());
    }
}
