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

fn viewport_request(start: i64, end: i64, points: usize) -> ViewportRequest {
    ViewportRequest {
        query: crate::preview::FrameQuery {
            timeline_id: "1".into(),
            project_epoch: "reader".into(),
            if_generation: "0".into(),
            revision: "revision".into(),
            frame: 0,
            width: 64,
        },
        target: Target::Transform {
            param: TransformParam::Opacity,
        },
        source_start: start,
        source_end: end,
        points,
    }
}

#[test]
fn curve_viewport_matches_native_fractional_ease_hold_and_unclamped_bezier_overshoot() {
    let (mut session, id, raw) = fixture();
    let request = viewport_request(25, 26, 5);
    let value = viewport(&session, id, &raw, &request).unwrap();
    for (index, row) in value["samples"].as_array().unwrap().iter().enumerate() {
        let at = 25.0 + index as f32 / 4.0;
        let expected = 20.0 + 60.0 * Interpolation::EaseIn.ease((at - 25.0) / 15.0);
        assert_eq!(row[0], json!(25.0 + index as f64 / 4.0));
        assert_eq!(row[1], json!(expected));
    }
    assert_ne!(value["samples"][1][1], json!(20.0));
    for interpolation in [
        Interpolation::Hold,
        Interpolation::Bezier {
            c1: [0.25, 3.0],
            c2: [0.75, 3.0],
        },
    ] {
        let track = session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track_mut(TransformParam::Opacity);
        *track = Keyframed::constant(100.0);
        track.upsert(25, 20.0, interpolation);
        track.upsert(26, 80.0, Interpolation::Linear);
        let result = viewport(&session, id, &raw, &request).unwrap();
        for (index, row) in result["samples"].as_array().unwrap().iter().enumerate() {
            let expected = match index {
                0 => 20.0,
                4 => 80.0,
                _ => 20.0 + 60.0 * interpolation.ease(index as f32 / 4.0),
            };
            assert_eq!(row[1], json!(expected));
        }
        if matches!(interpolation, Interpolation::Hold) {
            assert_eq!(result["samples"][3][1], 20.0);
            assert_eq!(result["samples"][4][1], 80.0);
        } else {
            assert!(result["samples"][2][1].as_f64().unwrap() > 100.0);
        }
    }
    *session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::Opacity) = Keyframed::constant(37.0);
    let clip = &session.project.timelines[id].tracks[0].clips[0];
    let constant = viewport(
        &session,
        id,
        &raw,
        &viewport_request(clip.source_in(), clip.source_out(), 2),
    )
    .unwrap();
    assert_eq!(constant["samples"][0][1], 37.0);
    assert_eq!(constant["samples"][1][1], 37.0);
}

#[test]
fn curve_viewport_uses_late_dense_keys_and_full_track_page_neighbors_without_editing() {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    *clip = Clip::from_source_range(
        clip.id,
        ClipSource::SolidColor,
        12,
        1000,
        100,
        Rational::new(1, 2),
    );
    clip.freeze = Some(20);
    let track = clip.effects.transform.track_mut(TransformParam::Opacity);
    track.upsert(-5, 11.0, Interpolation::Hold);
    for frame in 0..=600 {
        track.upsert(frame, (frame % 100) as f32, Interpolation::EaseOut);
    }
    let before = json!(session.project);
    let generation = session.history.generation();
    let result = viewport(&session, id, &raw, &viewport_request(550, 551, 3)).unwrap();
    assert_eq!(result["samples"][1], json!([550.5, 50.75]));
    let clip = &session.project.timelines[id].tracks[0].clips[0];
    let page = detail_page(&session, id, clip, 0, 256, 2);
    let curve = page["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["target"] == json!(viewport_request(0, 0, 2).target))
        .unwrap();
    assert_eq!(curve["keys"][0]["source_frame"], 255);
    assert_eq!(
        curve["keys"][0]["previous_key"],
        json!({"source_frame":254,"value":54.0,"interpolation":"EaseOut","controls":Interpolation::EaseOut.control_points()})
    );
    assert_eq!(curve["keys"][1]["next_key"]["source_frame"], 257);
    let first = detail_page(&session, id, clip, 0, 0, 1);
    let last = detail_page(&session, id, clip, 0, 601, 1);
    let key = |page: &Value| {
        page["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"] == json!(viewport_request(0, 0, 2).target))
            .unwrap()["keys"][0]
            .clone()
    };
    assert_eq!(key(&first)["source_frame"], -5);
    assert!(key(&first)["previous_key"].is_null());
    assert_eq!(key(&first)["next_key"]["source_frame"], 0);
    assert!(key(&last)["next_key"].is_null());
    assert_eq!(json!(session.project), before);
    assert_eq!(session.history.generation(), generation);
}

#[test]
fn curve_viewport_rejects_invalid_ranges_targets_counts_and_nonfinite_native_values() {
    let (mut session, id, raw) = fixture();
    let clip = &session.project.timelines[id].tracks[0].clips[0];
    let start = clip.source_in();
    let end = clip.source_out();
    for (start, end, points) in [
        (start - 1, end, 2),
        (start, end + 1, 2),
        (end, start, 2),
        (start, end, 1),
        (start, end, 2049),
    ] {
        assert!(viewport(&session, id, &raw, &viewport_request(start, end, points)).is_err());
    }
    assert_eq!(
        viewport(&session, id, &raw, &viewport_request(end, end, 2048)).unwrap()["samples"]
            .as_array()
            .unwrap()
            .len(),
        2048
    );
    let mut request = viewport_request(start, end, 2);
    request.target = Target::Gain;
    assert!(viewport(&session, id, &raw, &request).is_err());
    *session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::Opacity) = Keyframed::constant(f32::NAN);
    assert!(viewport(&session, id, &raw, &viewport_request(start, end, 2)).is_err());
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
        link_zoom: false,
    }
}

fn group() -> GroupEdit {
    GroupEdit {
        target: change().target,
        source_frames: vec![25, 40],
        delta_source_frames: 2,
        delta_value: 5.0,
        delete: false,
        link_zoom: false,
        replace_destination_keys: false,
    }
}

fn zoom_fixture() -> (Session, TimelineId, String) {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    for (param, values) in [
        (TransformParam::ZoomX, [1.0, 2.0]),
        (TransformParam::ZoomY, [2.0, 3.0]),
    ] {
        let track = clip.effects.transform.track_mut(param);
        track.upsert(25, values[0], Interpolation::EaseIn);
        track.upsert(40, values[1], Interpolation::Hold);
    }
    (session, id, raw)
}

#[test]
fn linked_zoom_single_edits_create_move_remove_and_undo_as_one_native_command() {
    let (mut session, id, raw) = zoom_fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let mut request = Edit {
        target: Target::Transform {
            param: TransformParam::ZoomX,
        },
        value: Some(1.5),
        link_zoom: true,
        ..change()
    };
    edit(&mut session, id, &raw, &request).unwrap();
    assert_eq!(session.history.position(), position + 1);
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        let keys = session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(param)
            .keyframes();
        assert_eq!(keys[0], (27, 1.5, request.interpolation));
        assert_eq!(keys.len(), 2);
    }
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    request.value = None;
    edit(&mut session, id, &raw, &request).unwrap();
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        assert_eq!(
            session.project.timelines[id].tracks[0].clips[0]
                .effects
                .transform
                .track(param)
                .keyframes()
                .len(),
            1
        );
    }
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    request.previous_source_frame = None;
    request.source_frame = 30;
    request.value = Some(1.7);
    edit(&mut session, id, &raw, &request).unwrap();
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        assert!(
            session.project.timelines[id].tracks[0].clips[0]
                .effects
                .transform
                .track(param)
                .keyframes()
                .iter()
                .any(|key| key.0 == 30 && key.1 == 1.7)
        );
    }
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}

#[test]
fn linked_zoom_groups_preserve_time_only_values_and_copy_edited_values_to_existing_twins() {
    for delta_value in [0.0, 0.5] {
        let (mut session, id, raw) = zoom_fixture();
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let request = GroupEdit {
            target: Target::Transform {
                param: TransformParam::ZoomX,
            },
            delta_value,
            link_zoom: true,
            ..group()
        };
        edit_group(&mut session, id, &raw, &request).unwrap();
        assert_eq!(session.history.position(), position + 1);
        let clip = &session.project.timelines[id].tracks[0].clips[0];
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::ZoomX)
                .keyframes(),
            &[
                (27, 1.0 + delta_value, Interpolation::EaseIn),
                (42, 2.0 + delta_value, Interpolation::Hold)
            ]
        );
        let expected = if delta_value == 0.0 {
            [2.0, 3.0]
        } else {
            [1.5, 2.5]
        };
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::ZoomY)
                .keyframes(),
            &[
                (27, expected[0], Interpolation::EaseIn),
                (42, expected[1], Interpolation::Hold)
            ]
        );
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        edit_group(
            &mut session,
            id,
            &raw,
            &GroupEdit {
                delete: true,
                ..request
            },
        )
        .unwrap();
        for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
            assert!(
                session.project.timelines[id].tracks[0].clips[0]
                    .effects
                    .transform
                    .track(param)
                    .keyframes()
                    .is_empty()
            );
        }
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    }
}

#[test]
fn linked_zoom_missing_twins_are_ignored_and_twin_collisions_refuse_the_whole_edit() {
    for group_edit in [false, true] {
        let (mut session, id, raw) = zoom_fixture();
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track_mut(TransformParam::ZoomY)
            .upsert(27, 4.0, Interpolation::Hold);
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let result = if group_edit {
            edit_group(
                &mut session,
                id,
                &raw,
                &GroupEdit {
                    target: Target::Transform {
                        param: TransformParam::ZoomX,
                    },
                    delta_value: 0.0,
                    link_zoom: true,
                    ..group()
                },
            )
        } else {
            edit(
                &mut session,
                id,
                &raw,
                &Edit {
                    target: Target::Transform {
                        param: TransformParam::ZoomX,
                    },
                    value: Some(1.5),
                    link_zoom: true,
                    ..change()
                },
            )
        };
        assert!(result.is_err());
        assert_eq!(session.history.position(), position);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    }
    let (mut session, id, raw) = zoom_fixture();
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::ZoomY)
        .remove_at(25);
    edit(
        &mut session,
        id,
        &raw,
        &Edit {
            target: Target::Transform {
                param: TransformParam::ZoomX,
            },
            value: Some(1.5),
            link_zoom: true,
            ..change()
        },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes(),
        &[(40, 3.0, Interpolation::Hold)]
    );
}

#[test]
fn omitted_zoom_link_keeps_legacy_receipt_fingerprints_unchanged() {
    let mut single = change();
    let old = serde_json::to_value(&single).unwrap();
    assert!(old.get("link_zoom").is_none());
    let decoded: Edit = serde_json::from_value(old.clone()).unwrap();
    assert!(!decoded.link_zoom);
    assert_eq!(serde_json::to_value(decoded).unwrap(), old);
    single.link_zoom = true;
    assert_eq!(serde_json::to_value(single).unwrap()["link_zoom"], true);
    let old = serde_json::to_value(group()).unwrap();
    assert!(old.get("link_zoom").is_none());
    let decoded: GroupEdit = serde_json::from_value(old.clone()).unwrap();
    assert!(!decoded.link_zoom);
    assert_eq!(serde_json::to_value(decoded).unwrap(), old);
}

#[test]
fn group_move_delete_and_undo_preserve_native_source_timing_values_and_outgoing_interpolation() {
    let (mut session, id, raw) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    edit_group(&mut session, id, &raw, &group()).unwrap();
    let keys = inspector::find(&session, id, &raw)
        .unwrap()
        .2
        .effects
        .transform
        .track(TransformParam::Opacity)
        .keyframes();
    assert_eq!(
        keys,
        &[
            (27, 25.0, Interpolation::EaseIn),
            (42, 85.0, Interpolation::Hold)
        ]
    );
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    edit_group(
        &mut session,
        id,
        &raw,
        &GroupEdit {
            delete: true,
            ..group()
        },
    )
    .unwrap();
    assert!(
        inspector::find(&session, id, &raw)
            .unwrap()
            .2
            .effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()
            .is_empty()
    );
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}

#[test]
fn group_destinations_can_overlap_selected_origins_but_never_overwrite_unselected_keys_or_partially_apply()
 {
    let (mut session, id, raw) = fixture();
    let (_, _, clip) = inspector::find(&session, id, &raw).unwrap();
    let end = clip.source_frame_at(clip.timeline_end() - 1);
    assert!(end >= 55);
    edit_group(
        &mut session,
        id,
        &raw,
        &GroupEdit {
            delta_source_frames: 15,
            delta_value: 0.0,
            ..group()
        },
    )
    .unwrap();
    let keys = inspector::find(&session, id, &raw)
        .unwrap()
        .2
        .effects
        .transform
        .track(TransformParam::Opacity)
        .keyframes();
    assert_eq!(
        keys,
        &[
            (40, 20.0, Interpolation::EaseIn),
            (55, 80.0, Interpolation::Hold)
        ]
    );
    session.history.undo(&mut session.project);
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let cases = [
        GroupEdit {
            source_frames: vec![25],
            delta_source_frames: 15,
            ..group()
        },
        GroupEdit {
            delta_source_frames: i64::MAX,
            ..group()
        },
        GroupEdit {
            delta_source_frames: -100,
            ..group()
        },
        GroupEdit {
            delta_value: 30.0,
            ..group()
        },
        GroupEdit {
            delta_value: f32::NAN,
            ..group()
        },
        GroupEdit {
            source_frames: vec![25, 25],
            ..group()
        },
        GroupEdit {
            source_frames: vec![25, 41],
            ..group()
        },
    ];
    for edit in cases {
        assert!(edit_group(&mut session, id, &raw, &edit).is_err());
        assert_eq!(session.history.position(), position);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    }
    edit_group(
        &mut session,
        id,
        &raw,
        &GroupEdit {
            delta_source_frames: 0,
            delta_value: 0.0,
            ..group()
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position);
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        edit_group(&mut session, id, &raw, &group()).unwrap_err().1,
        "TRACK_LOCKED"
    );
}

#[test]
fn group_destination_replacement_with_value_delta_and_zoom_twins_matches_native_undo_redo() {
    use vv_core::Command;
    let (mut session, id, raw) = zoom_fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    let clip_id = clip.id;
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        clip.effects.transform.track_mut(param).upsert(
            27,
            4.0,
            Interpolation::Bezier {
                c1: [0.2, -0.1],
                c2: [0.8, 1.2],
            },
        );
        clip.effects
            .transform
            .track_mut(param)
            .upsert(42, 3.5, Interpolation::EaseOut);
    }
    let mut request = GroupEdit {
        target: Target::Transform {
            param: TransformParam::ZoomX,
        },
        delta_value: 0.5,
        link_zoom: true,
        ..group()
    };
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let generation = session.history.generation();
    assert_eq!(
        edit_group(&mut session, id, &raw, &request).unwrap_err().1,
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
        vec![
            (
                core::KeyframeTarget::TransformParam(TransformParam::ZoomX),
                25,
            ),
            (
                core::KeyframeTarget::TransformParam(TransformParam::ZoomX),
                40,
            ),
            (
                core::KeyframeTarget::TransformParam(TransformParam::ZoomY),
                25,
            ),
            (
                core::KeyframeTarget::TransformParam(TransformParam::ZoomY),
                40,
            ),
        ],
        2,
    )
    .apply(&mut expected);
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        for (frame, value, interpolation) in [
            (27, 1.5, Interpolation::EaseIn),
            (42, 2.5, Interpolation::Hold),
        ] {
            core::UpsertKeyframe::new(
                id,
                0,
                clip_id,
                frame,
                core::KeyframeValue::TransformParam(param, value),
                interpolation,
            )
            .apply(&mut expected);
        }
    }
    edit_group(&mut session, id, &raw, &request).unwrap();
    let after = serde_json::to_value(&session.project).unwrap();
    assert_eq!(after, serde_json::to_value(expected).unwrap());
    assert_eq!(session.history.position(), position + 1);
    for param in [TransformParam::ZoomX, TransformParam::ZoomY] {
        assert_eq!(
            session.project.timelines[id].tracks[0].clips[0]
                .effects
                .transform
                .track(param)
                .keyframes(),
            &[
                (27, 1.5, Interpolation::EaseIn),
                (42, 2.5, Interpolation::Hold)
            ]
        );
    }
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.history.redo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), after);
}

#[test]
fn group_destination_replacement_keeps_locks_missing_keys_and_invalid_values_atomic() {
    for case in 0..7 {
        let (mut session, id, raw) = zoom_fixture();
        let mut request = GroupEdit {
            target: Target::Transform {
                param: TransformParam::ZoomX,
            },
            delta_value: 0.5,
            link_zoom: true,
            replace_destination_keys: true,
            ..group()
        };
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track_mut(TransformParam::ZoomY)
            .upsert(27, 4.0, Interpolation::Hold);
        match case {
            0 => session.project.timelines[id].tracks[0].locked = true,
            1 => request.source_frames = vec![25, 41],
            2 => request.source_frames = vec![25, 25],
            3 => request.delta_source_frames = i64::MAX,
            4 => request.delta_source_frames = -100,
            5 => request.delta_value = f32::NAN,
            6 => {
                request.delta_value = 0.0;
                session.project.timelines[id].tracks[0].clips[0]
                    .effects
                    .transform
                    .track_mut(TransformParam::ZoomY)
                    .upsert(40, -1.0, Interpolation::Hold);
            }
            _ => unreachable!(),
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        assert!(
            edit_group(&mut session, id, &raw, &request).is_err(),
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
}

#[test]
fn group_destination_replacement_is_strict_optional_and_keeps_legacy_wire_bytes() {
    let legacy = serde_json::to_value(group()).unwrap();
    assert!(legacy.get("replace_destination_keys").is_none());
    let decoded: GroupEdit = serde_json::from_value(legacy.clone()).unwrap();
    assert!(!decoded.replace_destination_keys);
    assert_eq!(serde_json::to_value(decoded).unwrap(), legacy);
    let mut explicit_false = legacy.clone();
    explicit_false["replace_destination_keys"] = json!(false);
    assert_eq!(
        serde_json::to_value(serde_json::from_value::<GroupEdit>(explicit_false).unwrap()).unwrap(),
        legacy
    );
    let mut replacement = group();
    replacement.replace_destination_keys = true;
    let operation = crate::commands::Operation::EditCurveKeys {
        clip_id: "1".into(),
        edit: replacement,
    };
    let encoded = serde_json::to_value(&operation).unwrap();
    assert_eq!(encoded["edit"]["replace_destination_keys"], true);
    assert!(serde_json::from_value::<crate::commands::Operation>(encoded).is_ok());
    for invalid in [json!("true"), json!(1), Value::Null, json!([])] {
        let mut value = legacy.clone();
        value["replace_destination_keys"] = invalid;
        assert!(serde_json::from_value::<GroupEdit>(value).is_err());
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
            path: None,
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
                link_zoom: false,
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
            link_zoom: false,
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
