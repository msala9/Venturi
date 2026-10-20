use super::*;
use vv_core::{Clip, ClipSource, MediaItem, Rational, Timeline, Track, TrackKind};

fn fixture() -> (
    Session,
    Files,
    std::path::PathBuf,
    core::TimelineId,
    Request,
) {
    let root = std::env::temp_dir().join(format!(
        "vv-web-speech-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    vv_media::audio_file::write_audio_file(
        &root.join("silence.wav"),
        vv_media::audio_file::AudioFileFormat::Wav,
        &vec![0.0; 96000],
        48000,
        1,
    )
    .unwrap();
    let (path, meta) = files.probe("silence.wav").unwrap();
    let rate = Rational::conform_rate(Rational::new(24, 1), meta.fps);
    let end = meta.duration_frames;
    let mut session = Session::default();
    let timeline = session.create_timeline(Timeline {
        name: "Speech".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let media = session.project.media_pool.insert(MediaItem {
        path,
        meta,
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let mut selected = Vec::new();
    for lane in 0..2 {
        let id = session.project.alloc_clip_id();
        let mut clip = Clip::from_source_range(id, ClipSource::Media(media), 0, end, 0, rate);
        clip.linked_group = Some(core::LinkGroupId(1));
        session.project.timelines[timeline].tracks[lane].insert_sorted(clip);
        selected.push(id.0.to_string());
    }
    let request = Request {
        query: FrameQuery {
            project_epoch: "epoch".into(),
            if_generation: "0".into(),
            timeline_id: timeline.raw().to_string(),
            revision: session.timeline_revision(timeline),
            frame: 0,
            width: 640,
        },
        clip_ids: vec![selected[0].clone()],
        params: Params {
            threshold: 0.5,
            min_silence_secs: 0.3,
            head_secs: 0.1,
            tail_secs: 0.1,
        },
    };
    (session, files, root, timeline, request)
}

#[test]
fn native_silero_analysis_of_real_silent_audio_proposes_one_global_range() {
    let (session, files, root, timeline, request) = fixture();
    let mut task = snapshot(&session, &files, timeline, request).unwrap();
    let before = serde_json::to_value(&session.project).unwrap();
    let mut cache = SpeechCache::default();
    let result = task
        .run(&AtomicBool::new(false), |_, _| {}, &mut cache)
        .unwrap();
    assert_eq!(result["ranges"], json!([[0, 48]]));
    assert_eq!(result["audio_clips"], 1);
    assert_eq!(result["operation"]["kind"], "remove_silences");
    let analysis = cache.entries[0].1.clone();
    task.request.params.threshold = 0.7;
    assert_eq!(
        task.run(&AtomicBool::new(false), |_, _| {}, &mut cache)
            .unwrap(),
        result
    );
    assert!(Arc::ptr_eq(&analysis, &cache.entries[0].1));
    assert_eq!(cache.entries.len(), 1);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    drop(task);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_silence_removal_is_one_undo_and_any_affected_locked_track_refuses_atomically() {
    let (mut session, files, root, timeline, _) = fixture();
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    session.project.timelines[timeline].tracks[0].locked = true;
    assert_eq!(
        remove_ranges(&mut session, timeline, &[[10, 20]])
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(session.history.position(), position);
    session.project.timelines[timeline].tracks[0].locked = false;
    assert!(remove_ranges(&mut session, timeline, &[[10, 20], [40, 1000]]).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    remove_ranges(&mut session, timeline, &[[10, 20], [30, 40]]).unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(session.project.timelines[timeline].total_frames(), 28);
    let edited = serde_json::to_value(&session.project.timelines[timeline]).unwrap();
    session.history.undo(&mut session.project);
    let mut restored = serde_json::to_value(&session.project).unwrap();
    let mut original_entities = original;
    // Native IDs are never reused, including after Undo.
    for counter in ["next_clip_id", "next_link_group_id"] {
        assert!(restored[counter].as_u64() >= original_entities[counter].as_u64());
        restored.as_object_mut().unwrap().remove(counter);
        original_entities.as_object_mut().unwrap().remove(counter);
    }
    assert_eq!(restored, original_entities);
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[timeline]).unwrap(),
        edited
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn speech_snapshot_validates_parameters_sources_and_selection_before_work_is_queued() {
    let (session, files, root, timeline, mut request) = fixture();
    request.params.threshold = f32::NAN;
    assert!(snapshot(&session, &files, timeline, request.clone()).is_err());
    request.params.threshold = 0.5;
    request.clip_ids.push(request.clip_ids[0].clone());
    assert!(snapshot(&session, &files, timeline, request.clone()).is_err());
    request.clip_ids = vec!["999999".into()];
    assert!(snapshot(&session, &files, timeline, request).is_err());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn queued_speech_jobs_deduplicate_and_refuse_obsolete_documents_or_changed_source_files() {
    let (session, files, root, timeline, request) = fixture();
    let jobs = Jobs::start();
    let first = jobs
        .prepare(snapshot(&session, &files, timeline, request.clone()).unwrap())
        .unwrap();
    let id = first["id"].as_str().unwrap();
    let duplicate = jobs
        .prepare(snapshot(&session, &files, timeline, request.clone()).unwrap())
        .unwrap();
    assert_eq!(duplicate["id"], first["id"]);
    let mut stale = request.query.clone();
    stale.if_generation = "changed".into();
    assert!(jobs.request(id, &stale).is_err());
    let started = Instant::now();
    loop {
        let task = snapshot(&session, &files, timeline, request.clone()).unwrap();
        let status = jobs.status(id, &task).unwrap();
        if status["state"] == "ready" {
            assert_eq!(status["result"]["ranges"], json!([[0, 48]]));
            break;
        }
        assert_ne!(status["state"], "failed");
        assert!(started.elapsed() < Duration::from_secs(20));
        std::thread::sleep(Duration::from_millis(10));
    }
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(root.join("silence.wav"))
        .unwrap()
        .write_all(&[0])
        .unwrap();
    let changed = snapshot(&session, &files, timeline, request.clone()).unwrap();
    assert_eq!(jobs.status(id, &changed).unwrap_err().1, "SOURCE_CHANGED");
    assert!(jobs.cancel(id, &request.query).is_ok());
    drop(changed);
    drop(jobs);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
