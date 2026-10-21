use super::*;

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
    assert!(parent.tracks[1].clips.is_empty());
    assert!(parent.tracks[3].clips.is_empty());
    let wrapper = &parent.tracks[0].clips[0];
    assert_eq!(wrapper.linked_group, parent.tracks[2].clips[0].linked_group);
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
    assert_eq!(nested.tracks[2].mix.gain_db, 0.0);
    assert_eq!(nested.tracks[3].mix.gain_db, -6.0);
    assert_eq!(parent.tracks[2].mix.gain_db, -3.0);
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
        -6.0
    );
}

#[test]
fn multitrack_compound_rejects_processing_audibility_and_linked_locks_without_mutation() {
    for case in 0..11 {
        let (mut session, id, clips) = multitrack_compound_fixture();
        let timeline = &mut session.project.timelines[id];
        match case {
            0 => timeline.tracks[1].muted = true,
            1 => timeline.tracks[3].muted = true,
            2 => timeline.tracks[2].solo = true,
            3 => timeline.tracks[3].mix.pan = 0.5,
            4 => timeline.tracks[3]
                .mix
                .effects
                .push(core::AudioEffect::new(core::AudioEffectKind::Mono)),
            5 => timeline.tracks[1].clips[0].effects.blend_mode = core::BlendMode::Multiply,
            6 => timeline.tracks[1].clips[0].source = core::ClipSource::Adjustment,
            7 => timeline.tracks[2].locked = true,
            8 => {
                let mut outside = core::Track::new(TrackKind::Audio);
                outside.solo = true;
                timeline.tracks.push(outside);
            }
            9 => timeline.tracks[3].mix.effects.push(core::AudioEffect::new(
                core::AudioEffectKind::Normalize {
                    target_db: -1.0,
                    mode: core::NormalizeMode::SamplePeak,
                    set_level: core::SetLevel::Relative,
                },
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
        if case == 7 {
            assert_eq!(error.1, "TRACK_LOCKED");
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
