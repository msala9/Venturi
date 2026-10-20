use super::*;
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
