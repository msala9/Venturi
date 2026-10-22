use super::*;

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
