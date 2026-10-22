use super::*;

#[test]
fn batch_compositing_accepts_500_targets_as_one_undo_and_preserves_redo_on_noop() {
    let mut session = Session::default();
    let timeline = session.create_timeline(Timeline {
        name: "500 native compositing targets".into(),
        fps: core::Rational::new(24, 1),
        resolution: (64, 64),
        tracks: vec![
            core::Track::new(TrackKind::Video),
            core::Track::new(TrackKind::Audio),
            core::Track::new(TrackKind::Video),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let mut ids = Vec::new();
    for index in 0..500 {
        let clip = core::Clip::from_source_range(
            session.project.alloc_clip_id(),
            core::ClipSource::SolidColor,
            0,
            1,
            index * 2,
            core::Rational::one(),
        );
        ids.push(clip.id.0.to_string());
        session.project.timelines[timeline].tracks[if index % 2 == 0 { 0 } else { 2 }]
            .insert_sorted(clip);
    }
    session.sync_timeline_media(timeline);
    let original = serde_json::to_value(&session.project.timelines[timeline]).unwrap();
    let position = session.history.position();
    let generation = session.history.generation();
    let noop = Operation::SetPropertiesBatch {
        clip_ids: ids.clone(),
        patch: Box::new(crate::inspector::Properties {
            blend: Some(core::BlendMode::Normal),
            matte: Some("None".into()),
            ..Default::default()
        }),
    };
    let before_noop = serde_json::to_value(&session.project).unwrap();
    apply(&mut session, timeline, &noop).unwrap();
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before_noop);
    assert_eq!(session.history.generation(), generation);
    let changed = Operation::SetPropertiesBatch {
        clip_ids: ids.clone(),
        patch: Box::new(crate::inspector::Properties {
            blend: Some(core::BlendMode::Overlay),
            matte: Some("LumaInverted".into()),
            ..Default::default()
        }),
    };
    let mut expected = session.project.timelines[timeline].clone();
    for clip in expected
        .tracks
        .iter_mut()
        .flat_map(|track| &mut track.clips)
    {
        clip.effects.blend_mode = core::BlendMode::Overlay;
        clip.effects.matte = Some(core::MatteMode::LumaInverted);
    }
    apply(&mut session, timeline, &changed).unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(session.history.generation(), generation + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(CommandLabel::Transform)
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[timeline]).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    apply(&mut session, timeline, &Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[timeline]).unwrap(),
        original
    );
    let before_noop = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    let labels: Vec<_> = session.history.labels().collect();
    apply(&mut session, timeline, &noop).unwrap();
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before_noop);
    assert_eq!(session.history.generation(), generation);
    assert_eq!(session.history.position(), position);
    assert_eq!(session.history.labels().collect::<Vec<_>>(), labels);
    apply(&mut session, timeline, &Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[timeline]).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    apply(&mut session, timeline, &changed).unwrap();
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
    let too_many = Operation::SetPropertiesBatch {
        clip_ids: (0..4097)
            .map(|index| ids[index % ids.len()].clone())
            .collect(),
        patch: Box::new(crate::inspector::Properties {
            blend: Some(core::BlendMode::Screen),
            ..Default::default()
        }),
    };
    assert!(apply(&mut session, timeline, &too_many).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
}

#[test]
fn batch_compositing_routes_every_native_mode_without_changing_legacy_single_clip_scope() {
    let (mut session, timeline, ids) = fixture();
    apply(
        &mut session,
        timeline,
        &Operation::SetProperties {
            clip_id: ids[0].0.to_string(),
            patch: Box::new(crate::inspector::Properties {
                blend: Some(core::BlendMode::Multiply),
                ..Default::default()
            }),
        },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[timeline].tracks[0]
            .clip(ids[0])
            .unwrap()
            .effects
            .blend_mode,
        core::BlendMode::Multiply
    );
    assert_eq!(
        session.project.timelines[timeline].tracks[0]
            .clip(ids[1])
            .unwrap()
            .effects
            .blend_mode,
        core::BlendMode::Normal
    );
    let selected: Vec<_> = ids.iter().map(|id| id.0.to_string()).collect();
    for blend in core::BlendMode::ALL {
        apply(
            &mut session,
            timeline,
            &Operation::SetPropertiesBatch {
                clip_ids: selected.clone(),
                patch: Box::new(crate::inspector::Properties {
                    blend: Some(blend),
                    ..Default::default()
                }),
            },
        )
        .unwrap();
        for id in &ids {
            assert_eq!(
                session.project.timelines[timeline].tracks[0]
                    .clip(*id)
                    .unwrap()
                    .effects
                    .blend_mode,
                blend
            );
        }
    }
    for matte in ["Alpha", "AlphaInverted", "Luma", "LumaInverted", "None"] {
        apply(
            &mut session,
            timeline,
            &Operation::SetPropertiesBatch {
                clip_ids: selected.clone(),
                patch: Box::new(crate::inspector::Properties {
                    matte: Some(matte.into()),
                    ..Default::default()
                }),
            },
        )
        .unwrap();
        for id in &ids {
            let value = session.project.timelines[timeline].tracks[0]
                .clip(*id)
                .unwrap()
                .effects
                .matte;
            assert_eq!(
                value
                    .map(|mode| format!("{mode:?}"))
                    .unwrap_or_else(|| "None".into()),
                matte
            );
        }
    }
}

fn close_gap_fixture(leading: bool) -> (Session, TimelineId, core::MediaId) {
    let mut session = Session::default();
    let id = session.create_timeline(Timeline {
        name: "Native gap closure".into(),
        fps: core::Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![
            core::Track::new(TrackKind::Video),
            core::Track::new(TrackKind::Audio),
            core::Track::new(TrackKind::Video),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let media = session.project.media_pool.insert(core::MediaItem {
        path: "gap-source.mov".into(),
        meta: core::MediaMeta {
            duration_frames: 240,
            fps: core::Rational::new(24, 1),
            width: 16,
            height: 16,
            has_video: true,
            has_audio: true,
            sample_rate: 48_000,
            channels: 2,
            audio_streams: 2,
            file: Default::default(),
        },
        content_hash: 0x1234,
        compound: None,
        folder: None,
    });
    let gap_start = if leading { 0 } else { 12 };
    let gap_end = gap_start + 24;
    for (track, start, len, linked) in [
        (0, gap_end, 12, true),
        (0, gap_end + 48, 12, false),
        (1, gap_end + 8, 12, true),
        (2, gap_end + 28, 8, false),
    ] {
        let mut clip = core::Clip::from_source_range(
            session.project.alloc_clip_id(),
            core::ClipSource::Media(media),
            4,
            4 + len,
            start,
            core::Rational::one(),
        );
        clip.fade_in = 2;
        clip.fade_out = 3;
        clip.audio_stream_index = 1;
        clip.effects.gain_db.default = -3.0;
        clip.display_color = Some(core::ClipColor::Orange);
        clip.linked_group = linked.then_some(core::LinkGroupId(9));
        session.project.timelines[id].tracks[track].insert_sorted(clip);
    }
    if !leading {
        for (track, len) in [(0, 12), (1, 8)] {
            let clip = core::Clip::from_source_range(
                session.project.alloc_clip_id(),
                core::ClipSource::Media(media),
                2,
                2 + len,
                0,
                core::Rational::one(),
            );
            session.project.timelines[id].tracks[track].insert_sorted(clip);
        }
    }
    session.project.timelines[id].tracks[2].locked = true;
    let positions = if leading {
        vec![gap_start + 4, gap_end, gap_end + 20]
    } else {
        vec![6, gap_start + 4, gap_end, gap_end + 20]
    };
    session.project.timelines[id].markers = positions
        .into_iter()
        .enumerate()
        .map(|(index, start)| core::Marker {
            id: core::MarkerId(index as u64 + 1),
            start,
            duration: 5,
            note: format!("Gap cue {index}"),
            color: core::ClipColor::Orange,
        })
        .collect();
    (session, id, media)
}

#[test]
fn close_gap_leading_and_internal_use_native_ripple_markers_and_one_undo_redo() {
    for leading in [true, false] {
        let (mut session, id, media) = close_gap_fixture(leading);
        let start = if leading { 0 } else { 12 };
        let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let source = serde_json::to_value(&session.project.media_pool[media]).unwrap();
        let mut expected = session.project.timelines[id].clone();
        for track in &mut expected.tracks[..2] {
            for clip in &mut track.clips {
                if clip.timeline_start >= start {
                    clip.timeline_start -= 24;
                }
            }
        }
        for marker in &mut expected.markers {
            if marker.start >= start + 24 {
                marker.start -= 24;
            } else if marker.start >= start {
                marker.start = start;
            }
        }
        let expected = serde_json::to_value(expected).unwrap();
        let position = session.history.position();
        apply(
            &mut session,
            id,
            &Operation::CloseGap {
                track: "0".into(),
                frame: start,
            },
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(&session.project.media_pool[media]).unwrap(),
            source
        );
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            session.history.labels().last(),
            Some(CommandLabel::RippleDelete)
        );
        apply(&mut session, id, &Operation::Undo).unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            before
        );
        assert_eq!(session.history.position(), position);
        apply(&mut session, id, &Operation::Redo).unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            expected
        );
        assert_eq!(
            serde_json::to_value(&session.project.media_pool[media]).unwrap(),
            source
        );
    }
}

#[test]
fn close_gap_repairs_other_lane_overlap_and_preserves_crossing_using_the_native_ripple_plan() {
    let (mut session, id, media) = close_gap_fixture(false);
    session.project.timelines[id].tracks[1].clips[0].timeline_len = 24;
    let left = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::Media(media),
        4,
        48,
        0,
        core::Rational::one(),
    );
    let right = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::Media(media),
        60,
        72,
        44,
        core::Rational::one(),
    );
    let crossing = core::CrossTransition {
        left_clip: left.id,
        right_clip: right.id,
        transition: core::Transition {
            kind: core::TransitionKind::CrossDissolve,
            duration: 8,
            direction: core::PushDirection::Left,
            ease: core::Ease::InOut,
            curve: 0.5,
        },
    };
    let mut lane = core::Track::new(TrackKind::Video);
    lane.clips = vec![left, right];
    lane.crossings.push(crossing.clone());
    session.project.timelines[id].tracks.push(lane);
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let mut native = session.project.clone();
    let mut history = core::History::default();
    edit::ripple_delete_gap(&mut native, &mut history, id, 12, 36);
    let expected = serde_json::to_value(&native.timelines[id]).unwrap();
    let position = session.history.position();
    apply(
        &mut session,
        id,
        &Operation::CloseGap {
            track: "0".into(),
            frame: 24,
        },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        expected
    );
    assert_eq!(
        session.project.timelines[id].tracks[1].clips[0].timeline_len,
        20
    );
    let repaired = &session.project.timelines[id].tracks[3];
    assert_eq!(
        repaired.clips[0].timeline_end(),
        repaired.clips[1].timeline_start
    );
    assert_eq!(
        serde_json::to_value(&repaired.crossings[0]).unwrap(),
        serde_json::to_value(crossing).unwrap()
    );
    assert_eq!(session.history.position(), position + 1);
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    apply(&mut session, id, &Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        expected
    );
}

#[test]
fn close_gap_rejects_occupied_trailing_invalid_or_locked_targets_without_mutation() {
    let (mut session, id, _) = close_gap_fixture(false);
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let generation = session.history.generation();
    for (track, frame) in [
        ("0", -1),
        ("0", 0),
        ("0", 11),
        ("0", 36),
        ("0", 47),
        ("0", 96),
        ("0", MAX_FRAME),
        ("0", i64::MAX),
        ("99", 24),
        ("invalid", 24),
        ("2", 24),
    ] {
        assert!(
            apply(
                &mut session,
                id,
                &Operation::CloseGap {
                    track: track.into(),
                    frame
                }
            )
            .is_err()
        );
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), position);
        assert_eq!(session.history.generation(), generation);
    }
}

#[test]
fn close_gap_refuses_partial_linked_group_movement_on_locked_or_unlocked_peers() {
    for locked in [false, true] {
        let (mut session, id, _) = close_gap_fixture(false);
        if locked {
            session.project.timelines[id].tracks[1].locked = true;
        } else {
            let track = &mut session.project.timelines[id].tracks[1];
            track.clips.retain(|clip| clip.linked_group.is_some());
            track.clips[0].timeline_start = 0;
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        let error = apply(
            &mut session,
            id,
            &Operation::CloseGap {
                track: "0".into(),
                frame: 24,
            },
        )
        .unwrap_err();
        assert_eq!(
            error.1,
            if locked {
                "TRACK_LOCKED"
            } else {
                "LINKED_GROUP"
            }
        );
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), position);
        assert_eq!(session.history.generation(), generation);
    }
}

#[test]
fn ripple_delete_linked_clips_accepts_unrelated_locked_material_and_matches_native_undo_redo() {
    let (mut session, id, media) = close_gap_fixture(false);
    let selected = session.project.timelines[id].tracks[0]
        .clips
        .iter()
        .find(|clip| clip.linked_group == Some(core::LinkGroupId(9)))
        .unwrap()
        .id;
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let source = serde_json::to_value(&session.project.media_pool[media]).unwrap();
    let locked = serde_json::to_value(&session.project.timelines[id].tracks[2]).unwrap();
    let mut native = session.project.clone();
    let mut native_history = core::History::default();
    assert_eq!(
        edit::ripple_delete_clips(&mut native, &mut native_history, id, &[(0, selected)]),
        Some(36)
    );
    let expected = serde_json::to_value(&native.timelines[id]).unwrap();
    let position = session.history.position();
    apply(
        &mut session,
        id,
        &Operation::Delete {
            clip_ids: vec![selected.0.to_string()],
            ripple: true,
        },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        expected
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id].tracks[2]).unwrap(),
        locked
    );
    assert_eq!(
        serde_json::to_value(&session.project.media_pool[media]).unwrap(),
        source
    );
    assert!(
        session.project.timelines[id].tracks[..2]
            .iter()
            .flat_map(|track| &track.clips)
            .all(|clip| clip.linked_group != Some(core::LinkGroupId(9)))
    );
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[1].timeline_start,
        64
    );
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(CommandLabel::RippleDelete)
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(session.history.position(), position);
    apply(&mut session, id, &Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        expected
    );
    assert_eq!(
        serde_json::to_value(&session.project.media_pool[media]).unwrap(),
        source
    );
}

#[test]
fn ripple_delete_refuses_selected_locked_peers_and_remaining_linked_group_split_atomically() {
    for selected_locked in [false, true] {
        let (mut session, id, _) = close_gap_fixture(false);
        let selected = session.project.timelines[id].tracks[0]
            .clips
            .iter()
            .find(|clip| clip.linked_group == Some(core::LinkGroupId(9)))
            .unwrap()
            .id;
        if selected_locked {
            session.project.timelines[id].tracks[1].locked = true;
        } else {
            let timeline = &mut session.project.timelines[id];
            timeline.tracks[0].clips.last_mut().unwrap().linked_group = Some(core::LinkGroupId(77));
            timeline.tracks[2].clips[0].linked_group = Some(core::LinkGroupId(77));
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        let error = apply(
            &mut session,
            id,
            &Operation::Delete {
                clip_ids: vec![selected.0.to_string()],
                ripple: true,
            },
        )
        .unwrap_err();
        assert_eq!(error.1, "TRACK_LOCKED");
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), position);
        assert_eq!(session.history.generation(), generation);
    }
}

#[test]
fn clipboard_overwrite_is_explicit_and_preserves_legacy_command_identity() {
    let legacy = serde_json::json!({"kind":"paste_prepared_clipboard","job_id":"clipboard-job","to_pool":false,"timeline_id":"1","timeline_revision":"revision","frame":12});
    let operation: Operation = serde_json::from_value(legacy.clone()).unwrap();
    assert!(matches!(
        &operation,
        Operation::PastePreparedClipboard {
            overwrite: false,
            ..
        }
    ));
    assert_eq!(serde_json::to_value(operation).unwrap(), legacy);
    let mut explicit = legacy;
    explicit["overwrite"] = serde_json::json!(true);
    let operation: Operation = serde_json::from_value(explicit.clone()).unwrap();
    assert!(matches!(
        &operation,
        Operation::PastePreparedClipboard {
            overwrite: true,
            ..
        }
    ));
    assert_eq!(serde_json::to_value(operation).unwrap(), explicit);
}

#[test]
fn native_track_removal_keeps_one_per_kind_respects_locks_and_undo_restores_contents() {
    let (mut session, id, _) = fixture();
    let remove = Operation::RemoveTrack { track: "0".into() };
    assert!(apply(&mut session, id, &remove).is_err());
    apply(&mut session, id, &Operation::AddTrack { audio: false }).unwrap();
    let original = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        apply(&mut session, id, &remove).unwrap_err().1,
        "TRACK_LOCKED"
    );
    assert_eq!(session.history.position(), position);
    session.project.timelines[id].tracks[0].locked = false;
    apply(&mut session, id, &remove).unwrap();
    assert_eq!(session.project.timelines[id].tracks.len(), 2);
    assert_eq!(session.history.position(), position + 1);
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        original
    );
}

#[test]
fn arming_requires_a_saved_unlocked_audio_track_and_uses_native_history_labels() {
    let (mut session, id, _) = fixture();
    let arm = |track: &str| Operation::SetTrack {
        track: track.into(),
        locked: None,
        muted: None,
        solo: None,
        armed: Some(true),
    };
    let position = session.history.position();
    assert!(apply(&mut session, id, &arm("1")).is_err());
    assert_eq!(session.history.position(), position);
    let root = std::env::temp_dir().join(format!(
        "vv-web-arm-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    session.save_to(&root.join("saved.vvproj")).unwrap();
    assert!(apply(&mut session, id, &arm("0")).is_err());
    session.project.timelines[id].tracks[1].locked = true;
    assert!(apply(&mut session, id, &arm("1")).is_err());
    session.project.timelines[id].tracks[1].locked = false;
    apply(&mut session, id, &arm("1")).unwrap();
    assert!(session.project.timelines[id].tracks[1].armed);
    assert_eq!(
        session.history.labels().last(),
        Some(CommandLabel::ArmTrack)
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert!(!session.project.timelines[id].tracks[1].armed);
    std::fs::remove_dir_all(root).unwrap();
}

fn fixture() -> (Session, TimelineId, Vec<ClipId>) {
    let mut s = Session::default();
    let id = s.create_timeline(Timeline {
        name: "Test".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(TrackKind::Video),
            core::Track::new(TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let a = edit::insert_generator(
        &mut s.project,
        &mut s.history,
        id,
        edit::Generator::SolidColor,
        0,
        0,
        Some(24),
    );
    let b = edit::insert_generator(
        &mut s.project,
        &mut s.history,
        id,
        edit::Generator::SolidColor,
        0,
        48,
        Some(24),
    );
    (s, id, vec![a, b])
}

#[test]
fn selected_compound_refuses_unselected_material_and_undo_restores_all_entities() {
    let (mut session, id, clips) = fixture();
    let revision = session.timeline_revision(id);
    apply(
        &mut session,
        id,
        &Operation::AddSolid {
            track: "0".into(),
            start_frame: 24,
            length_frames: 24,
        },
    )
    .unwrap();
    let request = Operation::MakeCompound {
        clip_ids: clips.iter().map(|c| c.0.to_string()).collect(),
        name: "Selected shots".into(),
    };
    let before = serde_json::to_value(&session.project).unwrap();
    let steps = session.history.position();
    assert_eq!(apply(&mut session, id, &request).unwrap_err().1, "OVERLAP");
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
    apply(&mut session, id, &Operation::Undo).unwrap();
    let steps = session.history.position();
    apply(&mut session, id, &request).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(session.project.timelines.len(), 2);
    let parent = &session.project.timelines[id];
    assert_eq!(parent.tracks[0].clips.len(), 1);
    assert_eq!(parent.tracks[0].clips[0].timeline_len, 72);
    let nested = session
        .project
        .timelines
        .iter()
        .find(|(key, _)| *key != id)
        .unwrap()
        .1;
    assert_eq!(nested.name, "Selected shots");
    assert_eq!(nested.tracks[0].clips.len(), 2);
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.project.timelines.len(), 1);
    assert_eq!(session.timeline_revision(id), revision);
}

#[test]
fn native_timeline_duplicate_uses_fresh_clip_ids_and_rename_is_one_undo_step() {
    let (mut session, id, clips) = fixture();
    let revision = session.timeline_revision(id);
    let steps = session.history.position();
    apply(
        &mut session,
        id,
        &Operation::RenameTimeline {
            name: "Renamed".into(),
        },
    )
    .unwrap();
    assert_eq!(session.project.timelines[id].name, "Renamed");
    assert_eq!(session.history.position(), steps + 1);
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.timeline_revision(id), revision);
    apply(
        &mut session,
        id,
        &Operation::DuplicateTimeline {
            name: "Copied".into(),
        },
    )
    .unwrap();
    assert_eq!(session.project.timelines.len(), 2);
    let copy = session
        .project
        .timelines
        .iter()
        .find(|(key, _)| *key != id)
        .unwrap()
        .1;
    assert_eq!(copy.name, "Copied");
    assert_eq!(copy.tracks[0].clips.len(), 2);
    assert!(
        copy.tracks[0]
            .clips
            .iter()
            .all(|clip| !clips.contains(&clip.id))
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.project.timelines.len(), 1);
    assert_eq!(session.timeline_revision(id), revision);
}

#[test]
fn a_compound_cannot_change_the_normalization_policy_of_multiple_audio_clips() {
    let (mut session, id, _) = fixture();
    let media = session.add_media(
        std::path::PathBuf::from("offline-normalization.wav"),
        core::MediaMeta {
            duration_frames: 48,
            fps: core::Rational::new(24, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
    );
    let mut selected = vec![];
    for start in [0, 24] {
        let clip_id = session.project.alloc_clip_id();
        session.project.timelines[id].tracks[1].insert_sorted(core::Clip::from_source_range(
            clip_id,
            core::ClipSource::Media(media),
            0,
            24,
            start,
            core::Rational::one(),
        ));
        selected.push(clip_id.0.to_string());
    }
    session.project.timelines[id].tracks[1]
        .mix
        .effects
        .push(core::AudioEffect::new(core::AudioEffectKind::Normalize {
            target_db: -1.0,
            mode: core::NormalizeMode::SamplePeak,
            set_level: core::SetLevel::Relative,
        }));
    let operation = Operation::MakeCompound {
        clip_ids: selected,
        name: "Normalized pair".into(),
    };
    let before = serde_json::to_value(&session.project).unwrap();
    let steps = session.history.position();
    assert!(
        apply(&mut session, id, &operation)
            .unwrap_err()
            .2
            .contains("normalization")
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
    session.project.timelines[id].tracks[1].mix.effects[0].enabled = false;
    apply(&mut session, id, &operation).unwrap();
    assert_eq!(session.project.timelines.len(), 2);
}

fn multitrack_compound_fixture() -> (Session, TimelineId, Vec<ClipId>) {
    let mut session = Session::default();
    let id = session.create_timeline(Timeline {
        name: "Multitrack".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: [
            TrackKind::Video,
            TrackKind::Video,
            TrackKind::Audio,
            TrackKind::Audio,
        ]
        .into_iter()
        .map(core::Track::new)
        .collect(),
        markers: vec![],
        master: Default::default(),
    });
    let media = session.add_media(
        std::path::PathBuf::from("offline-compound.wav"),
        core::MediaMeta {
            duration_frames: 48,
            fps: core::Rational::new(24, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
    );
    let mut clips = vec![];
    for track in 0..4 {
        let clip_id = session.project.alloc_clip_id();
        let mut clip = core::Clip::from_source_range(
            clip_id,
            if track < 2 {
                core::ClipSource::SolidColor
            } else {
                core::ClipSource::Media(media)
            },
            0,
            48,
            0,
            core::Rational::one(),
        );
        if track == 0 || track == 2 {
            clip.linked_group = Some(core::LinkGroupId(9));
        }
        session.project.timelines[id].tracks[track].insert_sorted(clip);
        clips.push(clip_id);
    }
    session.project.timelines[id].tracks[2].mix.gain_db = -3.0;
    session.project.timelines[id].tracks[3].mix.gain_db = -9.0;
    (session, id, clips)
}

fn desktop_compound_oracle(
    session: &Session,
    id: TimelineId,
    clips: &[ClipId],
    name: &str,
) -> Session {
    let mut oracle = Session::default();
    oracle.project = session.project.clone();
    let targets: Vec<_> = oracle.project.timelines[id]
        .tracks
        .iter()
        .enumerate()
        .flat_map(|(track, lane)| {
            lane.clips
                .iter()
                .filter(|clip| clips.contains(&clip.id))
                .map(move |clip| (track, clip.id))
        })
        .collect();
    let mut plan = core::plan_compound_clip(&oracle.project, id, &targets).unwrap();
    plan.nested_timeline.name = name.into();
    let (media, mut native) =
        core::compound_clip_commands(&mut oracle.project, id, &targets, &plan);
    native.push(Box::new(core::RenameTimeline::new(media, name.into())));
    oracle.apply(Box::new(CompositeCommand::new(
        CommandLabel::MakeCompoundClip,
        native,
    )));
    oracle.sync_timeline_media(id);
    oracle
}

#[test]
fn native_compound_matches_desktop_regrouping_for_muted_nonlinear_normalized_and_external_compositing_contexts_with_one_undo()
 {
    for case in 0..4 {
        let (mut session, id, mut clips) = multitrack_compound_fixture();
        match case {
            0 => {
                let timeline = &mut session.project.timelines[id];
                timeline.tracks[1].muted = true;
                timeline.tracks[2].mix.pan = -0.4;
                timeline.tracks[3].solo = true;
                timeline.tracks[3].muted = true;
                timeline.tracks[2].mix.effects.push(core::AudioEffect::new(
                    core::AudioEffectKind::Equalizer(core::Equalizer::DEFAULT),
                ));
                timeline.tracks[3].mix.effects.push(core::AudioEffect::new(
                    core::AudioEffectKind::MultibandCompressor(core::MultibandCompressor::DEFAULT),
                ));
            }
            1 => {
                let extra_id = session.project.alloc_clip_id();
                let timeline = &mut session.project.timelines[id];
                let lane = &mut timeline.tracks[2];
                lane.clips[0].timeline_len = 24;
                let mut extra = lane.clips[0].clone();
                extra.id = extra_id;
                extra.timeline_start = 24;
                extra.linked_group = None;
                lane.insert_sorted(extra);
                clips.push(extra_id);
                lane.mix
                    .effects
                    .push(core::AudioEffect::new(core::AudioEffectKind::Normalize {
                        target_db: -6.0,
                        mode: core::NormalizeMode::SamplePeak,
                        set_level: core::SetLevel::Relative,
                    }));
            }
            2 => {
                let extra = core::Clip::from_source_range(
                    session.project.alloc_clip_id(),
                    core::ClipSource::Adjustment,
                    0,
                    48,
                    0,
                    core::Rational::one(),
                );
                let mut intervening = core::Track::new(TrackKind::Video);
                intervening.insert_sorted(extra);
                let timeline = &mut session.project.timelines[id];
                timeline.tracks[1].clips[0].effects.blend_mode = core::BlendMode::Multiply;
                timeline.tracks[1].clips[0].effects.matte = Some(core::MatteMode::Luma);
                timeline.tracks.insert(1, intervening);
            }
            _ => {
                let extra_id = session.project.alloc_clip_id();
                let extra = core::Clip::from_source_range(
                    extra_id,
                    core::ClipSource::SolidColor,
                    0,
                    48,
                    48,
                    core::Rational::one(),
                );
                let lane = &mut session.project.timelines[id].tracks[1];
                lane.insert_sorted(extra);
                lane.crossings.push(core::CrossTransition {
                    left_clip: clips[1],
                    right_clip: extra_id,
                    transition: core::Transition {
                        kind: core::TransitionKind::CrossDissolve,
                        duration: 12,
                        direction: core::PushDirection::Left,
                        ease: core::Ease::InOut,
                        curve: 0.5,
                    },
                });
            }
        }
        session.sync_timeline_media(id);
        let parent = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let count = session.project.timelines.len();
        let pool = session.project.media_pool.len();
        let position = session.history.position();
        let name = "Native regrouping";
        let mut oracle = desktop_compound_oracle(&session, id, &clips, name);
        // The linked audio peer is omitted explicitly, as with native GUI selection expansion.
        let requested: Vec<_> = clips
            .iter()
            .filter(|clip| **clip != clips[2])
            .map(|clip| clip.0.to_string())
            .collect();
        apply(
            &mut session,
            id,
            &Operation::MakeNativeCompound {
                clip_ids: requested,
                name: name.into(),
            },
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            serde_json::to_value(&oracle.project).unwrap(),
            "case {case}"
        );
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            session.history.labels().last(),
            Some(CommandLabel::MakeCompoundClip)
        );
        let after = serde_json::to_value(&session.project.timelines[id]).unwrap();
        for state in [&mut session, &mut oracle] {
            apply(state, id, &Operation::Undo).unwrap();
        }
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            parent
        );
        assert_eq!(session.project.timelines.len(), count);
        assert_eq!(session.project.media_pool.len(), pool);
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            serde_json::to_value(&oracle.project).unwrap(),
            "native Undo, case {case}"
        );
        for state in [&mut session, &mut oracle] {
            apply(state, id, &Operation::Redo).unwrap();
        }
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            after
        );
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            serde_json::to_value(&oracle.project).unwrap(),
            "native Redo, case {case}"
        );
    }
}

#[test]
fn native_compound_matches_desktop_cpu_pcm_after_regrouping_nonlinear_buses_without_claiming_before_after_invariance()
 {
    let root = std::env::temp_dir().join(format!(
        "vv-native-compound-pcm-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("native.wav");
    let samples: Vec<_> = (0..4800)
        .map(|sample| (sample as f32 * std::f32::consts::TAU * 731.0 / 48000.0).sin() * 0.2)
        .collect();
    vv_media::audio_file::write_audio_file(
        &path,
        vv_media::audio_file::AudioFileFormat::Wav,
        &samples,
        48000,
        1,
    )
    .unwrap();
    let (mut session, id, clips) = multitrack_compound_fixture();
    let audio_media = match session.project.timelines[id].tracks[2].clips[0].source {
        core::ClipSource::Media(media) => media,
        _ => unreachable!(),
    };
    session.project.media_pool[audio_media].path = path;
    session.project.media_pool[audio_media].meta.channels = 1;
    for track in [2, 3] {
        session.project.timelines[id].tracks[track].clips[0].timeline_len = 2;
    }
    let timeline = &mut session.project.timelines[id];
    timeline.tracks[2].mix.pan = -0.2;
    timeline.tracks[2].mix.effects = vec![
        core::AudioEffect::new(core::AudioEffectKind::Equalizer(core::Equalizer::DEFAULT)),
        core::AudioEffect::new(core::AudioEffectKind::MultibandCompressor(
            core::MultibandCompressor::DEFAULT,
        )),
    ];
    timeline.tracks[3]
        .mix
        .effects
        .push(core::AudioEffect::new(core::AudioEffectKind::Mono));
    timeline.master.gain_db = -4.0;
    session.sync_timeline_media(id);
    let oracle = desktop_compound_oracle(&session, id, &clips, "Native PCM");
    apply(
        &mut session,
        id,
        &Operation::MakeNativeCompound {
            clip_ids: clips.iter().map(|clip| clip.0.to_string()).collect(),
            name: "Native PCM".into(),
        },
    )
    .unwrap();
    let render = |state: &Session| {
        let mut levels = vv_session::audio_render::LevelCache::default();
        levels.threads = 1;
        let mut output = Vec::new();
        vv_session::audio_render::render_offline(
            &state.project,
            &state.project.timelines[id],
            0..4000,
            &mut levels,
            |samples| {
                output.extend_from_slice(samples);
                std::ops::ControlFlow::Continue(())
            },
        )
        .unwrap();
        output
    };
    let actual = render(&session);
    let expected = render(&oracle);
    assert_eq!(actual.len(), 8000);
    assert!(actual.iter().any(|sample| sample.abs() > 0.001));
    assert_eq!(
        actual, expected,
        "The web native path must match the desktop AFTER regrouping"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_compound_keeps_structural_locked_linked_overlap_and_depth_safety_and_legacy_wire_unchanged()
 {
    for case in 0..5 {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let mut name = "Native refusal".to_string();
        match case {
            0 => session.project.timelines[id].tracks[2].locked = true,
            1 => {
                let extra_id = session.project.alloc_clip_id();
                let lane = &mut session.project.timelines[id].tracks[0];
                lane.clips[0].timeline_len = 12;
                lane.insert_sorted(core::Clip::from_source_range(
                    extra_id,
                    core::ClipSource::SolidColor,
                    0,
                    12,
                    12,
                    core::Rational::one(),
                ));
            }
            2 => name = "Invalid\nname".into(),
            3 => {
                while session.project.timelines.len() < 64 {
                    let copy = session.project.timelines[id].clone();
                    session.project.timelines.insert(copy);
                }
            }
            _ => {
                let mut previous = None;
                for depth in 0..15 {
                    let mut lane = core::Track::new(TrackKind::Video);
                    lane.insert_sorted(core::Clip::from_source_range(
                        session.project.alloc_clip_id(),
                        previous.map_or(core::ClipSource::SolidColor, core::ClipSource::Media),
                        0,
                        48,
                        0,
                        core::Rational::one(),
                    ));
                    let child = session.project.timelines.insert(Timeline {
                        name: format!("Child {depth}"),
                        fps: core::Rational::new(24, 1),
                        resolution: (16, 16),
                        tracks: vec![lane],
                        markers: vec![],
                        master: Default::default(),
                    });
                    previous = Some(session.project.media_pool.insert(core::MediaItem {
                        path: format!("Child {depth}").into(),
                        meta: core::MediaMeta {
                            duration_frames: 48,
                            fps: core::Rational::new(24, 1),
                            width: 16,
                            height: 16,
                            has_video: true,
                            has_audio: false,
                            sample_rate: 0,
                            channels: 0,
                            audio_streams: 0,
                            file: Default::default(),
                        },
                        content_hash: 0,
                        compound: Some(child),
                        folder: None,
                    }));
                }
                session.project.timelines[id].tracks[0].clips[0].source =
                    core::ClipSource::Media(previous.unwrap());
                crate::files::validate_project(&session.project).unwrap();
            }
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let generation = session.history.generation();
        let position = session.history.position();
        assert!(
            apply(
                &mut session,
                id,
                &Operation::MakeNativeCompound {
                    clip_ids: vec![clips[0].0.to_string(), clips[1].0.to_string()],
                    name
                }
            )
            .is_err(),
            "case {case}"
        );
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.generation(), generation);
        assert_eq!(session.history.position(), position);
    }
    let legacy = Operation::MakeCompound {
        clip_ids: vec!["1".into()],
        name: "Legacy".into(),
    };
    assert_eq!(
        serde_json::to_string(&legacy).unwrap(),
        "{\"kind\":\"make_compound\",\"clip_ids\":[\"1\"],\"name\":\"Legacy\"}"
    );
    assert!(serde_json::from_value::<Operation>(serde_json::json!({"kind":"make_native_compound","clip_ids":["1"],"name":"Strict","mode":"linear"})).is_err());
}

#[test]
fn selected_freeze_raw_playhead_matches_native_per_clip_clamp_for_jl_spans_rates_and_existing_freeze_with_atomic_undo()
 {
    for (frame, already_frozen) in [
        (0, false),
        (40, false),
        (MAX_FRAME, false),
        (MAX_FRAME, true),
    ] {
        let (mut session, id, _) = close_gap_fixture(false);
        let mut selected = Vec::new();
        for track in [0, 1] {
            let clip = session.project.timelines[id].tracks[track]
                .clips
                .iter_mut()
                .find(|clip| clip.linked_group.is_some())
                .unwrap();
            clip.set_speed(
                if track == 0 {
                    core::Rational::new(3, 2)
                } else {
                    core::Rational::new(1, 2)
                },
                core::Rational::new(4, 5),
            );
            if already_frozen && track == 1 {
                clip.freeze = Some(88);
            }
            selected.push((track, clip.id));
        }
        session.sync_timeline_media(id);
        let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let expected: Vec<_> = selected
            .iter()
            .map(|&(track, clip_id)| {
                let clip = session.project.timelines[id].clip(track, clip_id).unwrap();
                clip.picture_frame_at(frame.clamp(clip.timeline_start, clip.timeline_end() - 1))
            })
            .collect();
        let mut oracle = Session::default();
        oracle.project = session.project.clone();
        oracle.apply(Box::new(core::SetClipFreeze::new(
            id,
            selected.clone(),
            Some(frame),
        )));
        oracle.sync_timeline_media(id);
        let position = session.history.position();
        apply(
            &mut session,
            id,
            &Operation::SetFreeze {
                clip_ids: vec![selected[0].1.0.to_string()],
                frame: Some(frame),
            },
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            serde_json::to_value(&oracle.project).unwrap()
        );
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            session.history.labels().last(),
            Some(CommandLabel::FreezeFrame)
        );
        for ((track, clip_id), held) in selected.iter().zip(&expected) {
            let clip = session.project.timelines[id]
                .clip(*track, *clip_id)
                .unwrap();
            assert_eq!(clip.freeze, Some(*held));
        }
        if already_frozen {
            assert_eq!(expected[1], 88);
        }
        let after = serde_json::to_value(&session.project.timelines[id]).unwrap();
        apply(&mut session, id, &Operation::Undo).unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            before
        );
        apply(&mut session, id, &Operation::Redo).unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            after
        );
        for bad in [Some(-1), Some(MAX_FRAME + 1)] {
            let before = serde_json::to_value(&session.project).unwrap();
            let generation = session.history.generation();
            assert!(
                apply(
                    &mut session,
                    id,
                    &Operation::SetFreeze {
                        clip_ids: vec![selected[0].1.0.to_string()],
                        frame: bad
                    }
                )
                .is_err()
            );
            assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
            assert_eq!(session.history.generation(), generation);
        }
        session.project.timelines[id].tracks[1].locked = true;
        let before = serde_json::to_value(&session.project).unwrap();
        let generation = session.history.generation();
        assert_eq!(
            apply(
                &mut session,
                id,
                &Operation::SetFreeze {
                    clip_ids: vec![selected[0].1.0.to_string()],
                    frame: Some(frame)
                }
            )
            .unwrap_err()
            .1,
            "TRACK_LOCKED"
        );
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.generation(), generation);
    }
}

#[test]
fn neutral_multitrack_compound_preserves_layers_gain_links_and_one_step_undo() {
    let (mut session, id, clips) = multitrack_compound_fixture();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let media_count = session.project.media_pool.len();
    let steps = session.history.position();
    let request = Operation::MakeCompound {
        clip_ids: [clips[0], clips[1], clips[3]]
            .iter()
            .map(|clip| clip.0.to_string())
            .collect(),
        name: "Four tracks".into(),
    };
    apply(&mut session, id, &request).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(session.project.media_pool.len(), media_count + 1);
    let parent = &session.project.timelines[id];
    assert_eq!(parent.tracks.len(), 5);
    assert!(parent.tracks[1].clips.is_empty());
    assert!(parent.tracks[2].clips.is_empty());
    assert!(parent.tracks[3].clips.is_empty());
    let wrapper = &parent.tracks[0].clips[0];
    assert_eq!(wrapper.linked_group, parent.tracks[4].clips[0].linked_group);
    assert!(wrapper.linked_group.is_some());
    let core::ClipSource::Media(media) = &wrapper.source else {
        panic!("Expected native compound media")
    };
    let nested_id = session.project.media_pool[*media].compound.unwrap();
    let nested = &session.project.timelines[nested_id];
    assert_eq!(nested.tracks.len(), 4);
    for (index, clip_id) in clips.iter().enumerate() {
        assert_eq!(nested.tracks[index].clips[0].id, *clip_id);
    }
    assert_eq!(nested.tracks[2].mix.gain_db, -3.0);
    assert_eq!(nested.tracks[3].mix.gain_db, -9.0);
    assert_eq!(parent.tracks[2].mix.gain_db, -3.0);
    assert_eq!(parent.tracks[3].mix.gain_db, -9.0);
    assert_eq!(parent.tracks[4].kind, TrackKind::Audio);
    assert_eq!(parent.tracks[4].mix.gain_db, 0.0);
    assert_eq!(parent.tracks[4].mix.pan, 0.0);
    assert!(parent.tracks[4].mix.effects.is_empty());
    let after_parent = serde_json::to_value(parent).unwrap();
    let after_nested = serde_json::to_value(nested).unwrap();
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.project.timelines.len(), 1);
    assert_eq!(session.project.media_pool.len(), media_count);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    apply(&mut session, id, &Operation::Redo).unwrap();
    assert_eq!(
        session.project.timelines[nested_id].tracks[3].mix.gain_db,
        -9.0
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        after_parent
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[nested_id]).unwrap(),
        after_nested
    );
}

#[test]
fn multivideo_compound_preserves_single_audio_host_processing_audibility_and_exact_undo() {
    for case in 0..6 {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let timeline = &mut session.project.timelines[id];
        match case {
            0 => timeline.tracks[2].mix.pan = 0.5,
            1 => timeline.tracks[2]
                .mix
                .effects
                .push(core::AudioEffect::new(core::AudioEffectKind::Mono)),
            2 => timeline.tracks[2].solo = true,
            3 => timeline.tracks[2].muted = true,
            4 => timeline.tracks[3].solo = true,
            _ => {
                timeline.tracks[2].mix.pan = -0.25;
                timeline.tracks[2]
                    .mix
                    .effects
                    .push(core::AudioEffect::new(core::AudioEffectKind::Mono));
                timeline.tracks[2].solo = true;
                timeline.tracks[2].muted = true;
            }
        }
        let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let pool_count = session.project.media_pool.len();
        let position = session.history.position();
        let mut native = core::plan_compound_clip(
            &session.project,
            id,
            &[(0, clips[0]), (1, clips[1]), (2, clips[2])],
        )
        .unwrap();
        native.nested_timeline.name = "Two video, one audio".into();
        // The linked audio peer is expanded by the adapter, as in the desktop UI.
        let request = Operation::MakeCompound {
            clip_ids: vec![clips[0].0.to_string(), clips[1].0.to_string()],
            name: native.nested_timeline.name.clone(),
        };
        apply(&mut session, id, &request).unwrap();
        assert_eq!(session.history.position(), position + 1, "case {case}");
        let parent = &session.project.timelines[id];
        for (index, track) in parent.tracks.iter().enumerate() {
            assert_eq!(
                serde_json::to_value(&track.mix).unwrap(),
                before["tracks"][index]["mix"],
                "case {case}, track {index}"
            );
            assert_eq!(
                track.muted,
                before["tracks"][index]["muted"].as_bool().unwrap()
            );
            assert_eq!(
                track.solo,
                before["tracks"][index]["solo"].as_bool().unwrap()
            );
        }
        assert_eq!(
            serde_json::to_value(&parent.tracks[3]).unwrap(),
            before["tracks"][3]
        );
        let core::ClipSource::Media(media) = &parent.tracks[0].clips[0].source else {
            panic!("Expected compound wrapper")
        };
        let nested = session.project.media_pool[*media].compound.unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[nested]).unwrap(),
            serde_json::to_value(&native.nested_timeline).unwrap()
        );
        assert_eq!(
            parent.tracks[2].clips[0].linked_group,
            parent.tracks[0].clips[0].linked_group
        );
        let after_parent = serde_json::to_value(parent).unwrap();
        let after_nested = serde_json::to_value(&session.project.timelines[nested]).unwrap();
        apply(&mut session, id, &Operation::Undo).unwrap();
        assert_eq!(session.history.position(), position);
        assert_eq!(session.project.timelines.len(), 1);
        assert_eq!(session.project.media_pool.len(), pool_count);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            before,
            "case {case}"
        );
        apply(&mut session, id, &Operation::Redo).unwrap();
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            after_parent
        );
        assert_eq!(
            serde_json::to_value(&session.project.timelines[nested]).unwrap(),
            after_nested
        );
    }
}

#[test]
fn multiaudio_compound_preserves_linear_buses_flags_and_external_solo_with_exact_undo_redo() {
    for case in 0..9 {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let timeline = &mut session.project.timelines[id];
        match case {
            0 => timeline.tracks[3].mix.pan = 0.25,
            1 => timeline.tracks[3]
                .mix
                .effects
                .push(core::AudioEffect::new(core::AudioEffectKind::Mono)),
            2 => timeline.tracks[2].solo = true,
            3 => timeline.tracks[3].muted = true,
            4 => {
                let mut outside = core::Track::new(TrackKind::Audio);
                outside.solo = true;
                timeline.tracks.push(outside);
            }
            5 => {
                timeline.tracks[2].solo = true;
                timeline.tracks[2].muted = true;
            }
            6 => {
                for kind in [
                    core::AudioEffectKind::Equalizer(core::Equalizer::DEFAULT),
                    core::AudioEffectKind::MultibandCompressor(core::MultibandCompressor::DEFAULT),
                    core::AudioEffectKind::Normalize {
                        target_db: -1.0,
                        mode: core::NormalizeMode::SamplePeak,
                        set_level: core::SetLevel::Relative,
                    },
                ] {
                    let mut effect = core::AudioEffect::new(kind);
                    effect.enabled = false;
                    timeline.tracks[3].mix.effects.push(effect);
                }
            }
            7 => {
                timeline.tracks[2].mix.pan = -0.4;
                timeline.tracks[3].mix.pan = 0.6;
                timeline.tracks[2]
                    .mix
                    .effects
                    .push(core::AudioEffect::new(core::AudioEffectKind::Mono));
                timeline.tracks[3]
                    .mix
                    .effects
                    .push(core::AudioEffect::new(core::AudioEffectKind::Mono));
                timeline.tracks[2].muted = true;
                timeline.tracks[3].solo = true;
            }
            _ => {
                timeline.tracks[0].clips[0].linked_group = None;
                timeline.tracks[2].clips[0].linked_group = None;
            }
        }
        let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let original_tracks = session.project.timelines[id].tracks.len();
        let pool_count = session.project.media_pool.len();
        let position = session.history.position();
        let request = Operation::MakeCompound {
            clip_ids: vec![clips[2].0.to_string(), clips[3].0.to_string()],
            name: "Linear audio buses".into(),
        };
        apply(&mut session, id, &request).unwrap();
        assert_eq!(session.history.position(), position + 1, "case {case}");
        let parent = &session.project.timelines[id];
        assert_eq!(parent.tracks.len(), original_tracks + 1, "case {case}");
        for (index, track) in parent.tracks[..original_tracks].iter().enumerate() {
            assert_eq!(
                serde_json::to_value(&track.mix).unwrap(),
                before["tracks"][index]["mix"],
                "case {case} track {index}"
            );
            assert_eq!(
                track.muted,
                before["tracks"][index]["muted"].as_bool().unwrap()
            );
            assert_eq!(
                track.solo,
                before["tracks"][index]["solo"].as_bool().unwrap()
            );
        }
        assert!(parent.tracks[2].clips.is_empty());
        assert!(parent.tracks[3].clips.is_empty());
        let wrapper = &parent.tracks[original_tracks];
        assert_eq!(wrapper.kind, TrackKind::Audio);
        assert_eq!(wrapper.mix.gain_db, 0.0);
        assert_eq!(wrapper.mix.pan, 0.0);
        assert!(wrapper.mix.effects.is_empty());
        assert!(!wrapper.muted);
        assert_eq!(
            wrapper.solo,
            before["tracks"][2]["solo"].as_bool().unwrap()
                || before["tracks"][3]["solo"].as_bool().unwrap()
        );
        let core::ClipSource::Media(media) = &wrapper.clips[0].source else {
            panic!("Expected native audio wrapper")
        };
        let nested_id = session.project.media_pool[*media].compound.unwrap();
        let nested = &session.project.timelines[nested_id];
        let source_tracks: &[usize] = if case == 8 { &[2, 3] } else { &[0, 2, 3] };
        assert_eq!(nested.tracks.len(), source_tracks.len());
        for (child_index, source_index) in source_tracks.iter().copied().enumerate() {
            let child = &nested.tracks[child_index];
            assert_eq!(child.clips[0].id, clips[source_index]);
            assert_eq!(
                serde_json::to_value(&child.mix).unwrap(),
                before["tracks"][source_index]["mix"]
            );
            assert_eq!(
                child.muted,
                before["tracks"][source_index]["muted"].as_bool().unwrap()
            );
            assert_eq!(
                child.solo,
                before["tracks"][source_index]["solo"].as_bool().unwrap()
            );
        }
        if case != 8 {
            assert_eq!(
                wrapper.clips[0].linked_group,
                parent.tracks[0].clips[0].linked_group
            );
            assert!(wrapper.clips[0].linked_group.is_some());
        }
        assert_eq!(
            serde_json::to_value(&parent.tracks[1]).unwrap(),
            before["tracks"][1]
        );
        if case == 4 {
            assert_eq!(
                serde_json::to_value(&parent.tracks[4]).unwrap(),
                before["tracks"][4]
            );
        }
        let after_parent = serde_json::to_value(parent).unwrap();
        let after_nested = serde_json::to_value(nested).unwrap();
        apply(&mut session, id, &Operation::Undo).unwrap();
        assert_eq!(session.history.position(), position);
        assert_eq!(session.project.timelines.len(), 1);
        assert_eq!(session.project.media_pool.len(), pool_count);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            before,
            "case {case}"
        );
        apply(&mut session, id, &Operation::Redo).unwrap();
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            after_parent
        );
        assert_eq!(
            serde_json::to_value(&session.project.timelines[nested_id]).unwrap(),
            after_nested
        );
    }
}

#[test]
fn multitrack_compound_rejects_nonlinear_audio_video_dependencies_and_linked_locks_without_mutation()
 {
    for case in 0..8 {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let timeline = &mut session.project.timelines[id];
        match case {
            0 => timeline.tracks[1].muted = true,
            1 => timeline.tracks[1].clips[0].effects.blend_mode = core::BlendMode::Multiply,
            2 => timeline.tracks[1].clips[0].source = core::ClipSource::Adjustment,
            3 => timeline.tracks[2].locked = true,
            4 => timeline.tracks[3].mix.effects.push(core::AudioEffect::new(
                core::AudioEffectKind::Normalize {
                    target_db: -1.0,
                    mode: core::NormalizeMode::SamplePeak,
                    set_level: core::SetLevel::Relative,
                },
            )),
            5 => timeline.tracks[3].mix.effects.push(core::AudioEffect::new(
                core::AudioEffectKind::Equalizer(core::Equalizer::DEFAULT),
            )),
            6 => timeline.tracks[3].mix.effects.push(core::AudioEffect::new(
                core::AudioEffectKind::MultibandCompressor(core::MultibandCompressor::DEFAULT),
            )),
            _ => timeline.tracks[1].clips[0].effects.matte = Some(core::MatteMode::Alpha),
        }
        let request = Operation::MakeCompound {
            clip_ids: [clips[0], clips[1], clips[3]]
                .iter()
                .map(|clip| clip.0.to_string())
                .collect(),
            name: "Refused processing".into(),
        };
        let before = serde_json::to_value(&session.project).unwrap();
        let steps = session.history.position();
        let error = apply(&mut session, id, &request).unwrap_err();
        if case == 3 {
            assert_eq!(error.1, "TRACK_LOCKED");
        } else {
            assert_eq!(error.0.as_u16(), 422, "case {case}");
        }
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            before,
            "Case {case}"
        );
        assert_eq!(session.history.position(), steps, "Case {case}");
    }
}

#[test]
fn multitrack_compound_refuses_intervening_layers_and_crossing_boundaries() {
    for crossing in [false, true] {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let extra_id = session.project.alloc_clip_id();
        let extra = core::Clip::from_source_range(
            extra_id,
            core::ClipSource::SolidColor,
            0,
            48,
            if crossing { 48 } else { 0 },
            core::Rational::one(),
        );
        let timeline = &mut session.project.timelines[id];
        if crossing {
            timeline.tracks[1].insert_sorted(extra);
            timeline.tracks[1].crossings.push(core::CrossTransition {
                left_clip: clips[1],
                right_clip: extra_id,
                transition: core::Transition {
                    kind: core::TransitionKind::CrossDissolve,
                    duration: 12,
                    direction: core::PushDirection::Left,
                    ease: core::Ease::InOut,
                    curve: 0.5,
                },
            });
        } else {
            let mut intervening = core::Track::new(TrackKind::Video);
            intervening.insert_sorted(extra);
            timeline.tracks.insert(1, intervening);
        }
        let request = Operation::MakeCompound {
            clip_ids: clips.iter().map(|clip| clip.0.to_string()).collect(),
            name: "Refused boundary".into(),
        };
        let before = serde_json::to_value(&session.project).unwrap();
        let steps = session.history.position();
        let error = apply(&mut session, id, &request).unwrap_err();
        if crossing {
            assert!(error.2.contains("crossing transition"));
        } else {
            assert_eq!(error.1, "OVERLAP");
        }
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), steps);
    }
}

#[test]
fn multiaudio_partial_buses_keep_unselected_host_material_under_the_new_wrapper_range() {
    let (mut session, id, clips) = multitrack_compound_fixture();
    let extra_id = session.project.alloc_clip_id();
    let source = session.project.timelines[id].tracks[2].clips[0]
        .source
        .clone();
    let extra = core::Clip::from_source_range(extra_id, source, 0, 24, 0, core::Rational::one());
    let lane = &mut session.project.timelines[id];
    lane.tracks[2].clips[0].timeline_start = 48;
    lane.tracks[2].mix.pan = -0.25;
    lane.tracks[2]
        .mix
        .effects
        .push(core::AudioEffect::new(core::AudioEffectKind::Mono));
    lane.tracks[2].insert_sorted(extra);
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let outside_before =
        serde_json::to_value(&session.project.timelines[id].tracks[2].clips[0]).unwrap();
    let position = session.history.position();
    apply(
        &mut session,
        id,
        &Operation::MakeCompound {
            clip_ids: vec![clips[2].0.to_string(), clips[3].0.to_string()],
            name: "Partial buses".into(),
        },
    )
    .unwrap();
    let parent = &session.project.timelines[id];
    assert_eq!(parent.tracks.len(), 5);
    assert_eq!(parent.tracks[2].clips.len(), 1);
    assert_eq!(
        serde_json::to_value(&parent.tracks[2].clips[0]).unwrap(),
        outside_before
    );
    assert_eq!(
        serde_json::to_value(&parent.tracks[2].mix).unwrap(),
        before["tracks"][2]["mix"]
    );
    assert_eq!(parent.tracks[4].clips[0].timeline_start, 0);
    assert_eq!(parent.tracks[4].clips[0].timeline_len, 96);
    let core::ClipSource::Media(media) = &parent.tracks[4].clips[0].source else {
        panic!("Expected appended compound wrapper")
    };
    let child_id = session.project.media_pool[*media].compound.unwrap();
    let child = &session.project.timelines[child_id];
    assert_eq!(child.tracks[1].clips.len(), 1);
    assert_eq!(child.tracks[1].clips[0].id, clips[2]);
    assert_eq!(child.tracks[1].clips[0].timeline_start, 48);
    assert_eq!(
        serde_json::to_value(&child.tracks[1].mix).unwrap(),
        before["tracks"][2]["mix"]
    );
    assert!(
        child
            .tracks
            .iter()
            .all(|track| track.clips.iter().all(|clip| clip.id != extra_id))
    );
    let after_parent = serde_json::to_value(parent).unwrap();
    let after_child = serde_json::to_value(child).unwrap();
    assert_eq!(session.history.position(), position + 1);
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.history.position(), position);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    apply(&mut session, id, &Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        after_parent
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[child_id]).unwrap(),
        after_child
    );
}

#[test]
fn multiaudio_compound_reserves_one_track_and_refuses_the_128_track_limit_atomically() {
    for track_count in [127, 128] {
        let (mut session, id, clips) = multitrack_compound_fixture();
        while session.project.timelines[id].tracks.len() < track_count {
            session.project.timelines[id]
                .tracks
                .push(core::Track::new(TrackKind::Audio));
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let before_timeline = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        let result = apply(
            &mut session,
            id,
            &Operation::MakeCompound {
                clip_ids: clips.iter().map(|clip| clip.0.to_string()).collect(),
                name: "Track boundary".into(),
            },
        );
        if track_count == 128 {
            assert_eq!(result.unwrap_err().0.as_u16(), 422);
            assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
            assert_eq!(session.history.position(), position);
            assert_eq!(session.history.generation(), generation);
        } else {
            result.unwrap();
            assert_eq!(session.project.timelines[id].tracks.len(), 128);
            assert_eq!(session.history.position(), position + 1);
            apply(&mut session, id, &Operation::Undo).unwrap();
            assert_eq!(
                serde_json::to_value(&session.project.timelines[id]).unwrap(),
                before_timeline
            );
            apply(&mut session, id, &Operation::Redo).unwrap();
            assert_eq!(session.project.timelines[id].tracks.len(), 128);
        }
    }
}

#[test]
fn multiaudio_fractional_fps_requires_a_sample_aligned_range_origin_not_an_integer_fps() {
    for start in [1, 5] {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let fps = core::Rational::new(30000, 1001);
        session.project.timelines[id].fps = fps;
        for (_, media) in session.project.media_pool.iter_mut() {
            media.meta.fps = fps;
        }
        for track in &mut session.project.timelines[id].tracks {
            for clip in &mut track.clips {
                clip.timeline_start = start;
            }
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let before_timeline = serde_json::to_value(&session.project.timelines[id]).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        let result = apply(
            &mut session,
            id,
            &Operation::MakeCompound {
                clip_ids: clips.iter().map(|clip| clip.0.to_string()).collect(),
                name: "Fractional origin".into(),
            },
        );
        if start == 1 {
            assert_eq!(result.unwrap_err().0.as_u16(), 422);
            assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
            assert_eq!(session.history.position(), position);
            assert_eq!(session.history.generation(), generation);
        } else {
            result.unwrap();
            let parent = &session.project.timelines[id];
            assert_eq!(parent.tracks[4].clips[0].timeline_start, 5);
            assert_eq!(parent.tracks[4].clips[0].timeline_len, 48);
            let core::ClipSource::Media(media) = &parent.tracks[4].clips[0].source else {
                panic!("Expected native audio wrapper")
            };
            let nested_id = session.project.media_pool[*media].compound.unwrap();
            let child = &session.project.timelines[nested_id];
            assert_eq!(child.fps, fps);
            assert!(
                child
                    .tracks
                    .iter()
                    .all(|track| track.clips[0].timeline_start == 0)
            );
            assert_eq!(child.tracks[2].mix.gain_db, -3.0);
            assert_eq!(child.tracks[3].mix.gain_db, -9.0);
            let after_parent = serde_json::to_value(parent).unwrap();
            let after_child = serde_json::to_value(child).unwrap();
            assert_eq!(session.history.position(), position + 1);
            apply(&mut session, id, &Operation::Undo).unwrap();
            assert_eq!(
                serde_json::to_value(&session.project.timelines[id]).unwrap(),
                before_timeline
            );
            apply(&mut session, id, &Operation::Redo).unwrap();
            assert_eq!(
                serde_json::to_value(&session.project.timelines[id]).unwrap(),
                after_parent
            );
            assert_eq!(
                serde_json::to_value(&session.project.timelines[nested_id]).unwrap(),
                after_child
            );
        }
    }
}

#[test]
fn native_linked_retime_rejects_overlap_then_ripples_atomically_and_undoes() {
    let (mut session, id, _) = fixture();
    let media = session.add_media(
        std::path::PathBuf::from("retime.mp4"),
        core::MediaMeta {
            duration_frames: 96,
            fps: core::Rational::new(24, 1),
            width: 640,
            height: 360,
            has_video: true,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
    );
    session.project.timelines[id].tracks[0].clips.clear();
    let mut selected = vec![];
    for track in 0..2 {
        let clip_id = session.project.alloc_clip_id();
        let mut clip = core::Clip::from_source_range(
            clip_id,
            core::ClipSource::Media(media),
            0,
            24,
            0,
            core::Rational::one(),
        );
        clip.linked_group = Some(core::LinkGroupId(31));
        session.project.timelines[id].tracks[track].insert_sorted(clip);
        selected.push(clip_id);
    }
    let neighbour = session.project.alloc_clip_id();
    session.project.timelines[id].tracks[0].insert_sorted(core::Clip::from_source_range(
        neighbour,
        core::ClipSource::SolidColor,
        0,
        24,
        24,
        core::Rational::one(),
    ));
    let baseline = session.timeline_revision(id);
    let steps = session.history.position();
    let speed = |percent, fit| Operation::SetSpeed {
        clip_ids: vec![selected[0].0.to_string()],
        percent,
        pitch_correction: true,
        fit,
    };
    assert_eq!(
        apply(&mut session, id, &speed(50.0, SpeedFit::Resize))
            .unwrap_err()
            .1,
        "OVERLAP"
    );
    assert_eq!(session.timeline_revision(id), baseline);
    assert_eq!(session.history.position(), steps);
    for invalid in [0.0, f64::NAN, 10001.0] {
        assert!(apply(&mut session, id, &speed(invalid, SpeedFit::KeepLength)).is_err());
    }
    session.project.timelines[id].tracks[1].locked = true;
    assert_eq!(
        apply(&mut session, id, &speed(50.0, SpeedFit::Ripple))
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    session.project.timelines[id].tracks[1].locked = false;
    apply(&mut session, id, &speed(50.0, SpeedFit::Ripple)).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    for (track, clip_id) in selected.iter().enumerate() {
        let clip = session.project.timelines[id].clip(track, *clip_id).unwrap();
        assert_eq!(clip.timeline_len, 48);
        assert_eq!(clip.speed(), core::Rational::new(1, 2));
        assert!(clip.pitch_correction);
    }
    assert_eq!(
        session.project.timelines[id]
            .clip(0, neighbour)
            .unwrap()
            .timeline_start,
        48
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.timeline_revision(id), baseline);
    let freeze = Operation::SetFreeze {
        clip_ids: vec![selected[0].0.to_string()],
        frame: Some(12),
    };
    apply(&mut session, id, &freeze).unwrap();
    for (track, clip_id) in selected.iter().enumerate() {
        assert_eq!(
            session.project.timelines[id]
                .clip(track, *clip_id)
                .unwrap()
                .freeze,
            Some(12)
        );
    }
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.timeline_revision(id), baseline);
    apply(
        &mut session,
        id,
        &Operation::SetDisplayColor {
            clip_ids: vec![selected[0].0.to_string()],
            color: Some(core::ClipColor::Orange),
        },
    )
    .unwrap();
    for (track, clip_id) in selected.iter().enumerate() {
        assert_eq!(
            session.project.timelines[id]
                .clip(track, *clip_id)
                .unwrap()
                .display_color,
            Some(core::ClipColor::Orange)
        );
    }
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(session.timeline_revision(id), baseline);
}
#[test]
fn safe_move_rejects_overlap_and_restores_in_one_undo() {
    let (mut s, id, clips) = fixture();
    let before = s.timeline_revision(id);
    let steps = s.history.position();
    let operation = |start| Operation::SafeMove {
        moves: vec![Move {
            clip_id: clips[0].0.to_string(),
            to_track: "0".into(),
            to_start_frame: start,
        }],
    };
    assert_eq!(apply(&mut s, id, &operation(48)).unwrap_err().1, "OVERLAP");
    assert_eq!(s.timeline_revision(id), before);
    assert_eq!(s.history.position(), steps);
    apply(&mut s, id, &operation(24)).unwrap();
    assert_eq!(s.history.position(), steps + 1);
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
}

fn new_track_move_fixture() -> (Session, TimelineId, Vec<TrackMove>) {
    let (mut session, id, _) = close_gap_fixture(false);
    let video = &mut session.project.timelines[id].tracks[0];
    let first = video
        .clips
        .iter_mut()
        .find(|clip| clip.linked_group.is_some())
        .unwrap();
    first.id = ClipId(9_007_199_254_740_993);
    first.freeze = Some(8);
    let first_id = first.id;
    let last = video.clips.last().unwrap().id;
    let audio = session.project.timelines[id].tracks[1]
        .clips
        .last()
        .unwrap()
        .id;
    let moves = vec![
        TrackMove {
            clip_id: first_id.0.to_string(),
            to_track: MoveTrack::New { depth: 2 },
            to_start_frame: 72,
        },
        TrackMove {
            clip_id: audio.0.to_string(),
            to_track: MoveTrack::New { depth: 2 },
            to_start_frame: 80,
        },
        TrackMove {
            clip_id: last.0.to_string(),
            to_track: MoveTrack::New { depth: 1 },
            to_start_frame: 120,
        },
    ];
    (session, id, moves)
}

#[test]
fn move_clips_creates_native_role_depths_atomically_with_exact_undo_redo() {
    let (mut session, id, moves) = new_track_move_fixture();
    let before = session.project.clone();
    let steps = session.history.position();
    let generation = session.history.generation();
    let mut oracle = Session::default();
    oracle.project = before.clone();
    for kind in [
        TrackKind::Video,
        TrackKind::Video,
        TrackKind::Audio,
        TrackKind::Audio,
    ] {
        edit::add_track(&mut oracle.project, &mut oracle.history, id, kind);
    }
    let native_moves = moves
        .iter()
        .enumerate()
        .map(|(index, movement)| {
            let (from, clip_id) = clip_ref(&before.timelines[id], &movement.clip_id).unwrap();
            (clip_id, from, [4, 6, 3][index], movement.to_start_frame)
        })
        .collect();
    edit::move_clips(&mut oracle.project, &mut oracle.history, id, native_moves);
    oracle.sync_timeline_media(id);
    apply(
        &mut session,
        id,
        &Operation::MoveClips {
            new_video_tracks: 2,
            new_audio_tracks: 2,
            moves: moves.clone(),
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(session.history.generation(), generation + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(CommandLabel::MoveClips)
    );
    assert_eq!(
        serde_json::to_value(&session.project).unwrap(),
        serde_json::to_value(&oracle.project).unwrap()
    );
    assert!(session.project.timelines[id].tracks[5].clips.is_empty());
    assert_eq!(
        session.project.timelines[id].tracks[4].clips[0].id.0,
        9_007_199_254_740_993
    );
    assert_eq!(
        session.project.timelines[id].tracks[4].clips[0].freeze,
        Some(8)
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id].tracks[2]).unwrap(),
        serde_json::to_value(&before.timelines[id].tracks[2]).unwrap()
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    oracle.history.go_to(&mut oracle.project, 0);
    oracle.sync_timeline_media(id);
    assert_eq!(
        serde_json::to_value(&session.project).unwrap(),
        serde_json::to_value(&oracle.project).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        serde_json::to_value(&before.timelines[id]).unwrap()
    );
    let unchanged = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    let noop = moves
        .iter()
        .map(|movement| {
            let (track, clip_id) =
                clip_ref(&session.project.timelines[id], &movement.clip_id).unwrap();
            TrackMove {
                clip_id: movement.clip_id.clone(),
                to_track: MoveTrack::Existing {
                    track_id: track.to_string(),
                },
                to_start_frame: session.project.timelines[id]
                    .clip(track, clip_id)
                    .unwrap()
                    .timeline_start,
            }
        })
        .collect();
    apply(
        &mut session,
        id,
        &Operation::MoveClips {
            new_video_tracks: 0,
            new_audio_tracks: 0,
            moves: noop,
        },
    )
    .unwrap();
    assert_eq!(session.history.generation(), generation);
    assert_eq!(session.history.position(), steps);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), unchanged);
    apply(&mut session, id, &Operation::Redo).unwrap();
    let end = oracle.history.labels().count();
    oracle.history.go_to(&mut oracle.project, end);
    oracle.sync_timeline_media(id);
    assert_eq!(
        serde_json::to_value(&session.project).unwrap(),
        serde_json::to_value(&oracle.project).unwrap()
    );
}

#[test]
fn move_clips_rejects_invalid_late_destinations_and_linked_plans_before_any_add_track() {
    let (mut session, id, moves) = new_track_move_fixture();
    let operation = |moves, video, audio| Operation::MoveClips {
        new_video_tracks: video,
        new_audio_tracks: audio,
        moves,
    };
    let mut cases = Vec::new();
    let mut bad = moves.clone();
    bad[2].to_track = MoveTrack::Existing {
        track_id: "2".into(),
    };
    cases.push((operation(bad, 2, 2), "TRACK_LOCKED"));
    let mut bad = moves.clone();
    bad[2].to_track = MoveTrack::Existing {
        track_id: "1".into(),
    };
    cases.push((operation(bad, 2, 2), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad[1].to_start_frame += 1;
    cases.push((operation(bad, 2, 2), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad[2].to_track = MoveTrack::New { depth: 0 };
    cases.push((operation(bad, 2, 2), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad[2].to_track = MoveTrack::New { depth: 3 };
    cases.push((operation(bad, 2, 2), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad[2].clip_id = format!("0{}", bad[0].clip_id);
    cases.push((operation(bad, 2, 2), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad.remove(1);
    cases.push((operation(bad, 2, 0), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad[2].to_start_frame = -1;
    cases.push((operation(bad, 2, 2), "INVALID_OPERATION"));
    let mut bad = moves.clone();
    bad[2].to_track = MoveTrack::New { depth: 2 };
    bad[2].to_start_frame = 75;
    cases.push((operation(bad, 2, 2), "OVERLAP"));
    cases.push((operation(moves.clone(), 3, 2), "INVALID_OPERATION"));
    cases.push((operation(moves.clone(), usize::MAX, 2), "INVALID_OPERATION"));
    cases.push((operation(moves.clone(), 126, 2), "INVALID_OPERATION"));
    for (request, code) in cases {
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        assert_eq!(
            apply(&mut session, id, &request).unwrap_err().1,
            code,
            "{request:?}"
        );
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            before,
            "{request:?}"
        );
        assert_eq!(session.history.position(), position);
        assert_eq!(session.history.generation(), generation);
    }
    session.project.timelines[id].tracks[1].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    assert_eq!(
        apply(&mut session, id, &operation(moves, 2, 2))
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
}

#[test]
fn move_clips_strict_dto_and_existing_collision_preserve_legacy_safe_move() {
    let request = serde_json::json!({"kind":"move_clips","new_video_tracks":1,"new_audio_tracks":0,
        "moves":[{"clip_id":"1","to_track":{"kind":"new","depth":1},"to_start_frame":0}]});
    assert_eq!(
        serde_json::to_value(serde_json::from_value::<Operation>(request.clone()).unwrap())
            .unwrap(),
        request
    );
    let mut invalid = Vec::new();
    for destination in [
        serde_json::json!({"kind":"new","depth":0.5}),
        serde_json::json!({"kind":"new","depth":-1}),
        serde_json::json!({"kind":"new","depth":1,"audio":true}),
        serde_json::json!({"kind":"existing","track_id":"0","depth":1}),
        serde_json::json!({"kind":"new"}),
    ] {
        let mut bad = request.clone();
        bad["moves"][0]["to_track"] = destination;
        invalid.push(bad);
    }
    let mut bad = request.clone();
    bad["new_audio_tracks"] = serde_json::json!(-1);
    invalid.push(bad);
    for bad in invalid {
        assert!(
            serde_json::from_value::<Operation>(bad.clone()).is_err(),
            "{bad}"
        );
    }
    let (mut session, id, clips) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    let movement = TrackMove {
        clip_id: clips[0].0.to_string(),
        to_track: MoveTrack::Existing {
            track_id: "0".into(),
        },
        to_start_frame: 48,
    };
    assert_eq!(
        apply(
            &mut session,
            id,
            &Operation::MoveClips {
                new_video_tracks: 0,
                new_audio_tracks: 0,
                moves: vec![movement],
            }
        )
        .unwrap_err()
        .1,
        "OVERLAP"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
    let legacy = serde_json::json!({"kind":"safe_move","moves":[{"clip_id":clips[0].0.to_string(),"to_track":"0","to_start_frame":24}]});
    let operation = serde_json::from_value::<Operation>(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(&operation).unwrap(), legacy);
    apply(&mut session, id, &operation).unwrap();
    assert_eq!(session.project.timelines[id].tracks.len(), 2);
    assert_eq!(
        session.project.timelines[id].tracks[0]
            .clip(clips[0])
            .unwrap()
            .timeline_start,
        24
    );
    let (mut session, id, moves) = new_track_move_fixture();
    let first = moves[0].clip_id.clone();
    let audio = moves[1].clip_id.clone();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let steps = session.history.position();
    apply(
        &mut session,
        id,
        &Operation::MoveClips {
            new_video_tracks: 1,
            new_audio_tracks: 0,
            moves: vec![
                TrackMove {
                    clip_id: first.clone(),
                    to_track: MoveTrack::New { depth: 1 },
                    to_start_frame: 36,
                },
                TrackMove {
                    clip_id: audio,
                    to_track: MoveTrack::Existing {
                        track_id: "1".into(),
                    },
                    to_start_frame: 44,
                },
            ],
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(session.project.timelines[id].tracks.len(), 4);
    assert_eq!(
        session.project.timelines[id].tracks[3].clips[0]
            .id
            .0
            .to_string(),
        first
    );
    assert_eq!(
        session.project.timelines[id].tracks[3].clips[0].timeline_start,
        36
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}
#[test]
fn trim_cannot_overwrite_neighbor_and_split_delete_roundtrip() {
    let (mut s, id, clips) = fixture();
    let before = s.timeline_revision(id);
    assert_eq!(
        apply(
            &mut s,
            id,
            &Operation::Trim {
                clip_id: clips[0].0.to_string(),
                edge: Edge::End,
                frame: 60
            }
        )
        .unwrap_err()
        .1,
        "OVERLAP"
    );
    assert_eq!(s.timeline_revision(id), before);
    apply(
        &mut s,
        id,
        &Operation::Split {
            clip_ids: vec![clips[0].0.to_string()],
            frame: 12,
        },
    )
    .unwrap();
    assert_eq!(s.project.timelines[id].tracks[0].clips.len(), 3);
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    apply(
        &mut s,
        id,
        &Operation::Delete {
            clip_ids: vec![clips[0].0.to_string()],
            ripple: false,
        },
    )
    .unwrap();
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
}
#[test]
fn linked_clips_and_locked_tracks_are_validated_before_mutation() {
    let (mut s, id, clips) = fixture();
    let audio = s.project.alloc_clip_id();
    let mut c = core::Clip::from_source_range(
        audio,
        core::ClipSource::SolidColor,
        0,
        24,
        0,
        core::Rational::one(),
    );
    c.linked_group = Some(core::LinkGroupId(9));
    s.project.timelines[id].tracks[1].insert_sorted(c);
    s.project.timelines[id].tracks[0].clips[0].linked_group = Some(core::LinkGroupId(9));
    let request = Operation::SafeMove {
        moves: vec![Move {
            clip_id: clips[0].0.to_string(),
            to_track: "0".into(),
            to_start_frame: 24,
        }],
    };
    assert!(apply(&mut s, id, &request).is_err());
    let before = s.timeline_revision(id);
    let steps = s.history.position();
    let paired = Operation::SafeMove {
        moves: vec![
            Move {
                clip_id: clips[0].0.to_string(),
                to_track: "0".into(),
                to_start_frame: 24,
            },
            Move {
                clip_id: audio.0.to_string(),
                to_track: "1".into(),
                to_start_frame: 24,
            },
        ],
    };
    apply(&mut s, id, &paired).unwrap();
    assert_eq!(s.history.position(), steps + 1);
    assert_eq!(
        s.project.timelines[id].tracks[1].clips[0].timeline_start,
        24
    );
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    apply(
        &mut s,
        id,
        &Operation::Trim {
            clip_id: clips[0].0.to_string(),
            edge: Edge::End,
            frame: 12,
        },
    )
    .unwrap();
    assert_eq!(s.history.position(), steps + 1);
    assert_eq!(s.project.timelines[id].tracks[1].clips[0].timeline_len, 12);
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    apply(
        &mut s,
        id,
        &Operation::Delete {
            clip_ids: vec![clips[0].0.to_string()],
            ripple: true,
        },
    )
    .unwrap();
    assert!(s.project.timelines[id].tracks[1].clips.is_empty());
    assert_eq!(
        s.project.timelines[id].tracks[0].clips[0].timeline_start,
        24
    );
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    s.project.timelines[id].tracks[1].locked = true;
    assert_eq!(
        apply(
            &mut s,
            id,
            &Operation::Delete {
                clip_ids: vec![clips[0].0.to_string()],
                ripple: false
            }
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
    assert_eq!(s.project.timelines[id].tracks[0].clips.len(), 2);
}

#[test]
fn safe_media_insert_preserves_existing_clips_and_links_audio() {
    let (mut s, id, _) = fixture();
    let media = s.add_media(
        std::path::PathBuf::from("offline-test.mp4"),
        core::MediaMeta {
            duration_frames: 24,
            fps: core::Rational::new(24, 1),
            width: 640,
            height: 360,
            has_video: true,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
    );
    let before = s.timeline_revision(id);
    let steps = s.history.position();
    assert_eq!(
        apply(
            &mut s,
            id,
            &Operation::InsertMedia {
                media_id: media.raw().to_string(),
                start_frame: 0,
                source_in: None,
                source_out: None,
            }
        )
        .unwrap_err()
        .1,
        "OVERLAP"
    );
    assert_eq!(s.history.position(), steps);
    assert_eq!(s.timeline_revision(id), before);
    apply(
        &mut s,
        id,
        &Operation::InsertMedia {
            media_id: media.raw().to_string(),
            start_frame: 72,
            source_in: Some(6),
            source_out: Some(18),
        },
    )
    .unwrap();
    assert_eq!(s.history.position(), steps + 1);
    let video = s.project.timelines[id].tracks[0].clips.last().unwrap();
    let audio = &s.project.timelines[id].tracks[1].clips[0];
    assert!(video.linked_group.is_some());
    assert_eq!(video.linked_group, audio.linked_group);
    assert_eq!(video.source_in(), 6);
    assert_eq!(video.source_out(), 18);
    let video_id = video.id;
    let audio_id = audio.id;
    let selection = vec![video_id.0.to_string()];
    let inserted = s.timeline_revision(id);
    apply(
        &mut s,
        id,
        &Operation::Slip {
            clip_ids: selection.clone(),
            delta_frames: 2,
        },
    )
    .unwrap();
    assert_eq!(s.history.position(), steps + 2);
    for (track, clip) in [(0, video_id), (1, audio_id)] {
        let clip = s.project.timelines[id].clip(track, clip).unwrap();
        assert_eq!(
            (clip.timeline_start, clip.timeline_len, clip.source_in()),
            (72, 12, 8)
        );
    }
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), inserted);
    assert!(
        apply(
            &mut s,
            id,
            &Operation::Slip {
                clip_ids: selection.clone(),
                delta_frames: 7
            }
        )
        .is_err()
    );
    assert_eq!(s.timeline_revision(id), inserted);
    s.project.timelines[id].tracks[1].locked = true;
    assert_eq!(
        apply(
            &mut s,
            id,
            &Operation::Slip {
                clip_ids: selection.clone(),
                delta_frames: 1
            }
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
    s.project.timelines[id].tracks[1].locked = false;
    apply(
        &mut s,
        id,
        &Operation::SetDisabled {
            clip_ids: selection.clone(),
            disabled: true,
        },
    )
    .unwrap();
    assert!(s.project.timelines[id].clip(0, video_id).unwrap().disabled);
    assert!(s.project.timelines[id].clip(1, audio_id).unwrap().disabled);
    apply(&mut s, id, &Operation::Undo).unwrap();
    apply(
        &mut s,
        id,
        &Operation::LinkClips {
            clip_ids: selection,
            unlink: true,
        },
    )
    .unwrap();
    assert!(
        s.project.timelines[id]
            .clip(0, video_id)
            .unwrap()
            .linked_group
            .is_none()
    );
    assert!(
        s.project.timelines[id]
            .clip(1, audio_id)
            .unwrap()
            .linked_group
            .is_none()
    );
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), inserted);
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
}

#[test]
fn markers_add_edit_remove_and_undo_without_changing_clip_positions() {
    let (mut s, id, _) = fixture();
    let original = s.timeline_revision(id);
    let steps = s.history.position();
    let operation = |key: Option<&str>, delete, start, duration, note: &str| Operation::SetMarker {
        marker: MarkerEdit {
            id: key.map(String::from),
            delete,
            start_frame: start,
            duration_frames: duration,
            note: note.into(),
            color: core::ClipColor::Orange,
        },
    };
    assert!(apply(&mut s, id, &operation(None, false, 5, -1, "invalid")).is_err());
    assert_eq!(s.history.position(), steps);
    apply(&mut s, id, &operation(None, false, 12, 0, "Cut cue")).unwrap();
    let marker = s.project.timelines[id].markers[0].id.0.to_string();
    apply(
        &mut s,
        id,
        &operation(Some(&marker), false, 18, 6, "<script>literal note</script>"),
    )
    .unwrap();
    assert_eq!(s.project.timelines[id].markers[0].start, 18);
    apply(&mut s, id, &operation(Some(&marker), true, 0, 0, "")).unwrap();
    assert!(s.project.timelines[id].markers.is_empty());
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.project.timelines[id].markers[0].duration, 6);
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.project.timelines[id].markers[0].note, "Cut cue");
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), original);
}

#[test]
fn marker_drag_preserves_native_identity_note_color_and_clips_with_one_move_undo() {
    let (mut session, id, _) = fixture();
    let marker = core::Marker {
        id: core::MarkerId(9_007_199_254_740_993),
        start: 12,
        duration: 6,
        note: "Cue <literal>".into(),
        color: core::ClipColor::Orange,
    };
    session.project.timelines[id].markers.push(marker.clone());
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let steps = session.history.position();
    let operation = |start, duration| Operation::MoveMarker {
        marker_id: marker.id.0.to_string(),
        start_frame: start,
        duration_frames: duration,
    };
    for (start, duration) in [(-1, 6), (12, -1), (MAX_FRAME, 1), (1, i64::MAX)] {
        assert!(apply(&mut session, id, &operation(start, duration)).is_err());
        assert_eq!(session.history.position(), steps);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[id]).unwrap(),
            before
        );
    }
    apply(&mut session, id, &operation(12, 6)).unwrap();
    assert_eq!(
        session.history.position(),
        steps,
        "Unchanged release is not an Undo step"
    );
    apply(&mut session, id, &operation(20, 10)).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(CommandLabel::MoveMarker)
    );
    let moved = &session.project.timelines[id].markers[0];
    assert_eq!(
        (moved.id, moved.start, moved.duration, moved.color),
        (marker.id, 20, 10, marker.color)
    );
    assert_eq!(moved.note, marker.note);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id].tracks).unwrap(),
        before["tracks"]
    );
    apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}

#[test]
fn title_and_adjustment_generators_keep_safe_insert_and_native_defaults() {
    let (mut s, id, _) = fixture();
    let before = s.timeline_revision(id);
    let command = |start, generator| Operation::AddGenerator {
        track: "0".into(),
        start_frame: start,
        length_frames: 12,
        generator,
    };
    assert_eq!(
        apply(&mut s, id, &command(0, Generator::Title))
            .unwrap_err()
            .1,
        "OVERLAP"
    );
    assert_eq!(s.timeline_revision(id), before);
    apply(&mut s, id, &command(24, Generator::Title)).unwrap();
    let title = &s.project.timelines[id].tracks[0].clips[1];
    assert!(matches!(title.source, core::ClipSource::Text));
    assert_eq!(
        title.effects.title.as_ref().unwrap().content.default,
        "Title"
    );
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    apply(&mut s, id, &command(24, Generator::Adjustment)).unwrap();
    assert!(s.project.timelines[id].tracks[0].clips[1].is_adjustment());
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
}

#[test]
fn native_history_jump_restores_selected_position_and_rejects_invalid_targets() {
    let (mut s, id, _) = fixture();
    let end = s.history.position();
    let before = s.timeline_revision(id);
    apply(&mut s, id, &Operation::HistoryJump { position: 0 }).unwrap();
    assert!(s.project.timelines.is_empty());
    assert_eq!(s.history.position(), 0);
    assert!(apply(&mut s, id, &Operation::HistoryJump { position: end + 1 }).is_err());
    assert_eq!(s.history.position(), 0);
    apply(&mut s, id, &Operation::HistoryJump { position: end }).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    assert_eq!(s.history.position(), end);
}

#[test]
fn compound_insert_conforms_native_rate_and_refuses_self_and_indirect_cycles() {
    let (mut s, parent, _) = fixture();
    let child = s.create_timeline(Timeline {
        name: "Nested".into(),
        fps: core::Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    apply(
        &mut s,
        child,
        &Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 30,
        },
    )
    .unwrap();
    let media = s
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let command = |media: core::MediaId, start_frame| Operation::InsertMedia {
        media_id: media.raw().to_string(),
        start_frame,
        source_in: None,
        source_out: None,
    };
    let original = s.timeline_revision(parent);
    apply(&mut s, parent, &command(media, 72)).unwrap();
    let clip = s.project.timelines[parent].tracks[0].clips.last().unwrap();
    assert_eq!(clip.timeline_len, 24);
    assert_eq!(clip.source_in(), 0);
    assert_eq!(clip.source_out(), 30);
    assert!(apply(&mut s, child, &command(media, 30)).is_err());
    let parent_media = s
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(parent))
        .unwrap()
        .0;
    assert!(apply(&mut s, child, &command(parent_media, 30)).is_err());
    apply(&mut s, parent, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(parent), original);
}

#[test]
fn native_mixer_patch_checks_all_values_and_undo_restores_the_whole_strip() {
    let (mut s, id, _) = fixture();
    let before = s.timeline_revision(id);
    let steps = s.history.position();
    let patch = |channel: &str, gain, pan| Operation::SetMixer {
        channel: channel.into(),
        gain_db: Some(gain),
        pan: Some(pan),
    };
    assert!(apply(&mut s, id, &patch("1", -6.0, 2.0)).is_err());
    assert_eq!(s.timeline_revision(id), before);
    apply(&mut s, id, &patch("1", -6.0, -0.25)).unwrap();
    assert_eq!(s.history.position(), steps + 1);
    assert_eq!(s.project.timelines[id].tracks[1].mix.gain_db, -6.0);
    assert_eq!(s.project.timelines[id].tracks[1].mix.pan, -0.25);
    apply(&mut s, id, &Operation::Undo).unwrap();
    assert_eq!(s.timeline_revision(id), before);
    s.project.timelines[id].tracks[1].locked = true;
    assert_eq!(
        apply(&mut s, id, &patch("1", -6.0, 0.0)).unwrap_err().1,
        "TRACK_LOCKED"
    );
    apply(&mut s, id, &patch("master", -3.0, 0.5)).unwrap();
    assert_eq!(s.project.timelines[id].master.gain_db, -3.0);
    assert_eq!(s.project.timelines[id].master.pan, 0.5);
    assert!(apply(&mut s, id, &patch("0", 0.0, 0.0)).is_err());
}
