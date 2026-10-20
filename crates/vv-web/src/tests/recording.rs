use super::*;

const ID: &str = "01234567-89ab-4def-8123-456789abcdef";
fn saved_session(root: &std::path::Path) -> (Session, core::TimelineId) {
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Voiceover".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
            core::Track::new(core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    for track in &mut session.project.timelines[id].tracks[1..] {
        track.armed = true;
    }
    session.save_to(&root.join("saved.vvproj")).unwrap();
    (session, id)
}
fn setup() -> (Files, Store, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "vv-web-recording-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    let store = Store::new(files.root_file().unwrap());
    (files, store, root)
}
fn query() -> Query {
    Query {
        project_epoch: "epoch".into(),
        client_id: "recorder-client".into(),
        sample_rate: 48000,
        channels: 1,
        format: "wav".into(),
    }
}
fn pcm(frames: usize) -> Vec<u8> {
    (0..frames)
        .flat_map(|n| ((n as f32 * 0.025).sin() * 0.25).to_le_bytes())
        .collect()
}

#[tokio::test]
async fn native_recording_upload_is_sample_exact_retry_safe_and_preserves_changed_files() {
    let (files, store, root) = setup();
    let bytes = pcm(4817);
    let first = store
        .upload(ID.into(), query(), Body::from(bytes.clone()))
        .await
        .unwrap();
    assert_eq!(first["frames"], 4817);
    assert_eq!(first["sample_rate"], 48000);
    assert_eq!(
        store
            .upload(ID.into(), query(), Body::from(bytes.clone()))
            .await
            .unwrap(),
        first
    );
    let path = root.join(first["path_token"].as_str().unwrap());
    let decoded = vv_media::decode_audio_track(&path, 0).unwrap().unwrap();
    let recovered: Vec<_> = decoded
        .samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    assert_eq!(recovered, bytes);
    let changed = store
        .upload(ID.into(), query(), Body::from(pcm(4818)))
        .await
        .unwrap_err();
    assert_eq!(changed.1, "RECORDING_ID_REUSED");
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_eq!(store.get(ID).unwrap_err().1, "SOURCE_CHANGED");
    let before = std::fs::read(&path).unwrap();
    assert_eq!(
        store
            .upload(ID.into(), query(), Body::from(bytes))
            .await
            .unwrap_err()
            .1,
        "FILE_EXISTS"
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    drop(store);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn invalid_capture_packets_never_publish_an_audio_file() {
    let (files, store, root) = setup();
    for bytes in [vec![], vec![0; 5], f32::NAN.to_le_bytes().to_vec()] {
        assert!(
            store
                .upload(ID.into(), query(), Body::from(bytes))
                .await
                .is_err()
        );
    }
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    assert!(
        store
            .upload("../escape".into(), query(), Body::from(pcm(1)))
            .await
            .is_err()
    );
    drop(store);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn voiceover_rejects_a_late_locked_target_and_requires_explicit_overwrite_before_any_mutation()
 {
    let (files, store, root) = setup();
    let result = store
        .upload(ID.into(), query(), Body::from(pcm(48000)))
        .await
        .unwrap();
    let (mut session, id) = saved_session(&root);
    let placement = Placement {
        recording_id: ID.into(),
        tracks: vec!["1".into(), "2".into()],
        start_frame: 0,
        latency_frames: 0,
        overwrite: false,
    };
    session.project.timelines[id].tracks[2].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    assert!(place(&mut session, &files, id, &placement).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    session.project.timelines[id].tracks[2].locked = false;
    std::fs::copy(
        root.join(result["path_token"].as_str().unwrap()),
        root.join("existing.wav"),
    )
    .unwrap();
    let (path, meta) = files.probe("existing.wav").unwrap();
    let rate = core::Rational::conform_rate(core::Rational::new(24, 1), meta.fps);
    let end = meta.duration_frames;
    let media = session.add_media(path, meta);
    let clip = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::Media(media),
        0,
        end,
        0,
        rate,
    );
    session.project.timelines[id].tracks[1].insert_sorted(clip);
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    assert_eq!(
        place(&mut session, &files, id, &placement).unwrap_err().1,
        "OVERLAP"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    let overwrite = Placement {
        overwrite: true,
        ..placement
    };
    place(&mut session, &files, id, &overwrite).unwrap();
    assert_eq!(session.history.position(), position + 1);
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(session.project.timelines[id].tracks[1].clips.len(), 1);
    assert!(session.project.timelines[id].tracks[1].armed);
    assert!(session.project.timelines[id].tracks[2].clips.is_empty());
    drop(store);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn latency_correction_at_timeline_zero_trims_the_native_source_offset_without_shifting_other_tracks()
 {
    let (files, store, root) = setup();
    store
        .upload(ID.into(), query(), Body::from(pcm(48000)))
        .await
        .unwrap();
    let (mut session, id) = saved_session(&root);
    place(
        &mut session,
        &files,
        id,
        &Placement {
            recording_id: ID.into(),
            tracks: vec!["1".into()],
            start_frame: 0,
            latency_frames: 2,
            overwrite: false,
        },
    )
    .unwrap();
    let clip = &session.project.timelines[id].tracks[1].clips[0];
    assert_eq!(
        (clip.timeline_start, clip.source_offset, clip.timeline_len),
        (0, 2, 22)
    );
    assert!(session.project.timelines[id].tracks[2].armed);
    drop(store);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn recording_overwrite_preserves_a_locked_video_link_before_any_native_mutation() {
    let (files, store, root) = setup();
    let receipt = store
        .upload(ID.into(), query(), Body::from(pcm(48000)))
        .await
        .unwrap();
    let (mut session, id) = saved_session(&root);
    std::fs::copy(
        root.join(receipt["path_token"].as_str().unwrap()),
        root.join("linked.wav"),
    )
    .unwrap();
    let (path, meta) = files.probe("linked.wav").unwrap();
    let rate = core::Rational::conform_rate(session.project.timelines[id].fps, meta.fps);
    let end = meta.duration_frames;
    let media = session.add_media(path, meta);
    let mut audio = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::Media(media),
        0,
        end,
        0,
        rate,
    );
    audio.linked_group = Some(core::LinkGroupId(42));
    let mut video = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::SolidColor,
        0,
        24,
        0,
        core::Rational::new(1, 1),
    );
    video.linked_group = Some(core::LinkGroupId(42));
    session.project.timelines[id].tracks[0].clips.push(video);
    session.project.timelines[id].tracks[0].locked = true;
    session.project.timelines[id].tracks[1].clips.push(audio);
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    assert_eq!(
        place(
            &mut session,
            &files,
            id,
            &Placement {
                recording_id: ID.into(),
                tracks: vec!["1".into()],
                start_frame: 0,
                latency_frames: 0,
                overwrite: true
            }
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    drop(store);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn one_native_voiceover_step_places_all_armed_tracks_disarms_and_undo_restores_every_clip() {
    let (files, store, root) = setup();
    store
        .upload(ID.into(), query(), Body::from(pcm(48000)))
        .await
        .unwrap();
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Voiceover".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
            core::Track::new(core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    for track in &mut session.project.timelines[id].tracks[1..] {
        track.armed = true;
    }
    session.save_to(&root.join("saved.vvproj")).unwrap();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    let placement = Placement {
        recording_id: ID.into(),
        tracks: vec!["1".into(), "2".into()],
        start_frame: 12,
        latency_frames: 0,
        overwrite: false,
    };
    place(&mut session, &files, id, &placement).unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(core::CommandLabel::RecordVoiceover)
    );
    for track in &session.project.timelines[id].tracks[1..] {
        assert!(!track.armed);
        assert_eq!(track.clips.len(), 1);
        assert_eq!(
            (track.clips[0].timeline_start, track.clips[0].timeline_len),
            (12, 24)
        );
    }
    let placed = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        place(&mut session, &files, id, &placement).unwrap_err().1,
        "TAKE_ALREADY_PLACED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), placed);
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(session.project.media_pool.len(), 1);
    assert!(store.get(ID).is_ok());
    drop(store);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
