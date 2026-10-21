use super::*;

#[test]
fn webp_shared_images_keep_original_bytes_and_use_the_native_thumbnail_path() {
    use std::io::Read;
    let service = MediaJobs::start().unwrap();
    let path = service.root.join("shared.webp");
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=orange:size=64x36",
            "-frames:v",
            "1",
            "-c:v",
            "libwebp",
            "-lossless",
            "1",
        ],
        &path,
    );
    let original = std::fs::read(&path).unwrap();
    let spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "webp:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_image(&path).unwrap(),
    };
    assert_eq!(image_asset(&spec.file).unwrap(), "source.webp");
    let job = service
        .prepare(
            SourceSpec {
                file: spec.file.try_clone().unwrap(),
                epoch: spec.epoch.clone(),
                media_id: spec.media_id.clone(),
                meta: spec.meta.clone(),
            },
            "low",
        )
        .unwrap();
    assert_eq!(job["source_asset"], "source.webp");
    let id = job["id"].as_str().unwrap();
    let started = Instant::now();
    loop {
        let status = service.status(id, &spec, false).unwrap();
        if status["state"] == "ready" {
            break;
        }
        assert_ne!(status["state"], "failed", "{status}");
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
    let mut delivered = Vec::new();
    service
        .asset(id, &spec, "source.webp")
        .unwrap()
        .read_to_end(&mut delivered)
        .unwrap();
    assert_eq!(delivered, original);
    assert!(service.asset(id, &spec, "thumb.png").is_ok());
    assert!(service.asset(id, &spec, "source.mp4").is_err());
}

#[test]
fn still_source_preserves_original_png_bytes_and_alpha_without_creating_a_video() {
    use std::io::Read;
    let service = MediaJobs::start().unwrap();
    let path = service.root.join("transparent.png");
    let original = encode_png(&[255, 64, 32, 127].repeat(64 * 36), (64, 36)).unwrap();
    std::fs::write(&path, &original).unwrap();
    let spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "still:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_image(&path).unwrap(),
    };
    let job = service
        .prepare(
            SourceSpec {
                file: spec.file.try_clone().unwrap(),
                epoch: spec.epoch.clone(),
                media_id: spec.media_id.clone(),
                meta: spec.meta.clone(),
            },
            "high",
        )
        .unwrap();
    assert_eq!(job["source_asset"], "source.png");
    let id = job["id"].as_str().unwrap();
    let start = Instant::now();
    loop {
        let status = service.status(id, &spec, false).unwrap();
        if status["state"] == "ready" {
            break;
        }
        assert!(
            matches!(status["state"].as_str(), Some("queued" | "running")),
            "{status}"
        );
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
    let mut delivered = Vec::new();
    service
        .asset(id, &spec, "source.png")
        .unwrap()
        .read_to_end(&mut delivered)
        .unwrap();
    assert_eq!(original, delivered);
    assert!(service.asset(id, &spec, "thumb.png").is_ok());
    assert!(service.asset(id, &spec, "source.mp4").is_err());
    assert!(service.asset(id, &spec, "waveform.json").is_err());
    std::fs::write(path, b"not an image").unwrap();
    assert!(image_asset(&spec.file).is_err());
}

#[test]
fn native_source_job_deduplicates_and_publishes_video_audio_thumbnail_and_waveform() {
    let source = MediaJobs::start().unwrap();
    let path = source.root.join("input.mp4");
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
        ],
        &path,
    );
    let make = || SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "test:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_media(&path).unwrap(),
    };
    let first = source.prepare(make(), "medium").unwrap();
    let repeated = source.prepare(make(), "medium").unwrap();
    assert_eq!(first["id"], repeated["id"]);
    let spec = make();
    let id = first["id"].as_str().unwrap();
    let started = Instant::now();
    loop {
        let status = source.status(id, &spec, false).unwrap();
        if status["state"] == "ready" {
            break;
        }
        assert!(
            matches!(status["state"].as_str(), Some("running" | "queued")),
            "{status}"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        source
            .asset(id, &spec, "source.mp4")
            .unwrap()
            .metadata()
            .unwrap()
            .len()
            > 100
    );
    assert!(
        source
            .asset(id, &spec, "thumb.png")
            .unwrap()
            .metadata()
            .unwrap()
            .len()
            > 100
    );
    let waveform: Value =
        serde_json::from_reader(source.asset(id, &spec, "waveform.json").unwrap()).unwrap();
    assert!(waveform["peaks"].as_array().unwrap().len() >= 100);
    assert!(
        waveform["peaks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p.as_f64().unwrap() > 0.01)
    );
}

#[test]
fn ranges_cover_prefix_suffix_open_end_and_reject_overflow_or_multiple_ranges() {
    assert_eq!(byte_range("bytes=0-1", 10), Some((0, 1)));
    assert_eq!(byte_range("bytes=8-", 10), Some((8, 9)));
    assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
    assert_eq!(byte_range("bytes=0-999", 10), Some((0, 9)));
    for value in [
        "bytes=-0",
        "bytes=10-",
        "bytes=3-1",
        "bytes=0-1,3-4",
        "bytes=+1-2",
        "bytes=184467440737095516160-",
        "junk",
    ] {
        assert!(byte_range(value, 10).is_none(), "{value}");
    }
    assert!(byte_range("bytes=0-", 0).is_none());
}

#[tokio::test]
async fn byte_delivery_returns_exact_range_416_and_honors_if_range() {
    use axum::{
        body::to_bytes,
        http::{HeaderMap, StatusCode, header},
    };
    let path = std::env::temp_dir().join(format!("vv-source-range-{}", std::process::id()));
    std::fs::write(&path, b"0123456789").unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(header::RANGE, "bytes=2-4".parse().unwrap());
    let response = stream_file(File::open(&path).unwrap(), "video/mp4", "test", &headers)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 2-4/10");
    assert_eq!(
        &to_bytes(response.into_body(), 20).await.unwrap()[..],
        b"234"
    );
    headers.insert(header::IF_RANGE, "\"old\"".parse().unwrap());
    let response = stream_file(File::open(&path).unwrap(), "video/mp4", "test", &headers)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        &to_bytes(response.into_body(), 20).await.unwrap()[..],
        b"0123456789"
    );
    headers.remove(header::IF_RANGE);
    headers.insert(header::RANGE, "bytes=20-".parse().unwrap());
    let response = stream_file(File::open(&path).unwrap(), "video/mp4", "test", &headers)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes */10");
    std::fs::remove_file(path).unwrap();
}

#[test]
fn cache_assets_are_scoped_to_epoch_media_and_source_file_identity() {
    let source = MediaJobs::start().unwrap();
    let path = source.root.join("fixture.mp4");
    std::fs::write(&path, b"source").unwrap();
    let mut spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "p:1".into(),
        media_id: "1".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 24,
            fps: vv_core::Rational::new(24, 1),
            width: 2,
            height: 2,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
    };
    let directory = source.root.join("test");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("source.mp4"), b"proxy").unwrap();
    source.jobs.lock().unwrap().push_back(Job {
        id: "test".into(),
        key: format!("p:1:1:{}:v1:medium", spec.identity().unwrap()),
        state: "ready",
        progress: 24,
        error: None,
        directory,
        cancel: Arc::new(AtomicBool::new(false)),
        bytes: 5,
        export: None,
        descriptor: None,
        program_query: None,
        inputs: vec![],
        source_asset: Some("source.mp4"),
        export_epoch: None,
        durable: None,
        explicit_cancel: false,
        durability_error: false,
    });
    assert!(source.asset("test", &spec, "source.mp4").is_ok());
    assert!(source.asset("test", &spec, "../source.mp4").is_err());
    spec.epoch = "p:2".into();
    assert!(source.asset("test", &spec, "source.mp4").is_err());
    spec.epoch = "p:1".into();
    spec.media_id = "2".into();
    assert!(source.status("test", &spec, false).is_err());
    spec.media_id = "1".into();
    std::fs::write(&path, b"replacement source").unwrap();
    assert!(source.asset("test", &spec, "source.mp4").is_err());
}

#[test]
fn completed_exports_keep_their_snapshot_when_sources_or_current_revision_change() {
    let jobs = MediaJobs::start().unwrap();
    let directory = jobs.root.join("export-test");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("program.mp4"), b"frozen-output").unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.jobs.lock().unwrap().push_back(Job {
        id: "export-test".into(),
        key: "export:old-revision".into(),
        state: "ready",
        progress: 24,
        error: None,
        directory,
        cancel: cancel.clone(),
        bytes: 13,
        export: None,
        descriptor: None,
        program_query: None,
        inputs: vec![(
            jobs.root.join("source-no-longer-present"),
            "old-identity".into(),
        )],
        source_asset: None,
        export_epoch: Some("p:1".into()),
        durable: None,
        explicit_cancel: false,
        durability_error: false,
    });
    assert_eq!(
        jobs.export_status("export-test", "p:1", false).unwrap()["state"],
        "ready"
    );
    assert!(jobs.export_asset("export-test", "p:1").is_ok());
    let query = ProgramQuery {
        project_epoch: "p:1".into(),
        if_generation: "0".into(),
        timeline_id: "1".into(),
        revision: "r".into(),
        start_frame: 0,
        end_frame: 48,
        width: 960,
    };
    let inputs = jobs.jobs.lock().unwrap()[0].inputs.clone();
    assert!(
        jobs.cached_programs(&query.frame(), &inputs).is_empty(),
        "Exports are not preview cache"
    );
    jobs.jobs.lock().unwrap()[0].program_query = Some(query.clone());
    assert_eq!(
        jobs.cached_programs(&query.frame(), &inputs)[0]["end_frame"],
        48
    );
    assert!(
        jobs.cached_programs(&query.frame(), &vec![]).is_empty(),
        "Changed inputs cannot advertise cached movies"
    );
    let mut changed = query.clone();
    changed.revision = "new".into();
    assert!(jobs.cached_programs(&changed.frame(), &inputs).is_empty());
    assert!(jobs.export_asset("export-test", "p:2").is_err());
    assert!(jobs.export_status("another-job", "p:1", false).is_err());
    jobs.jobs.lock().unwrap()[0].state = "running";
    assert!(jobs.cached_programs(&query.frame(), &inputs).is_empty());
    assert!(jobs.export_asset("export-test", "p:1").is_err());
    jobs.export_status("export-test", "p:1", true).unwrap();
    assert!(cancel.load(Ordering::Relaxed));
    jobs.jobs.lock().unwrap()[0].export_epoch = None;
    assert!(jobs.export_status("export-test", "p:1", false).is_err());
}

#[test]
fn durable_export_history_restores_old_epoch_downloads_without_restarting_jobs_or_cache_eviction() {
    let path = std::env::temp_dir().join(format!(
        "venturi-durable-history-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    let root = File::open(&path).unwrap();
    let store = ExportStore::open(&root).unwrap();
    let make = |id: &str| ExportRecord {
        version: 1,
        id: id.into(),
        key: format!("export:old:{id}"),
        epoch: "old-process:7".into(),
        state: "queued".into(),
        previous_state: None,
        cancel_requested: false,
        error: None,
        program: json!({"start_frame":0,"end_frame":24,"width":640,"height":360}),
        progress: None,
        bytes: 0,
        output: None,
    };
    let queued = store.admit(make("1")).unwrap();
    let mut completed = store.admit(make("2")).unwrap();
    std::fs::write(
        completed.directory().join("rendering.mp4"),
        b"frozen completed output",
    )
    .unwrap();
    let output = store.publish_output(&completed).unwrap();
    let mut ready = completed.record.clone();
    ready.state = "ready".into();
    ready.bytes = output.bytes;
    ready.output = Some(output);
    store.save(&mut completed, ready).unwrap();
    drop((queued, completed));
    drop(store);
    let jobs = MediaJobs::start_with_exports(root).unwrap();
    assert_eq!(
        jobs.export_status("1", "old-process:7", false).unwrap()["state"],
        "interrupted"
    );
    assert_eq!(
        jobs.export_status("2", "old-process:7", false).unwrap()["state"],
        "ready"
    );
    assert!(jobs.export_status("2", "new-process:1", false).is_err());
    let mut bytes = vec![];
    std::io::Read::read_to_end(
        &mut jobs.export_asset("2", "old-process:7").unwrap(),
        &mut bytes,
    )
    .unwrap();
    assert_eq!(bytes, b"frozen completed output");
    {
        let mut owned = jobs.jobs.lock().unwrap();
        owned[1].bytes = MAX_CACHE_BYTES + 1;
        trim(&mut owned);
        assert_eq!(owned.len(), 2);
    }
    let history = jobs.export_history().unwrap();
    assert_eq!(history["jobs"][0]["project_epoch"], "old-process:7");
    assert_eq!(history["capacity"]["used_jobs"], 2);
    assert_eq!(
        history["capacity"]["charged_bytes"],
        b"frozen completed output".len() as u64
    );
    assert_eq!(
        jobs.export_status("1", "old-process:7", false).unwrap()["state"],
        "interrupted"
    );
    assert!(path.join(".exports/2/program.mp4").is_file());
    drop(jobs);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn a_full_pending_queue_refuses_exports_before_creating_durable_history() {
    let path = std::env::temp_dir().join(format!(
        "venturi-export-queue-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    let jobs = MediaJobs::start_with_exports(File::open(&path).unwrap()).unwrap();
    jobs.jobs.lock().unwrap().push_back(Job {
        id: "queued-marker".into(),
        key: "source:queued".into(),
        state: "queued",
        progress: 0,
        error: None,
        directory: jobs.root.join("queued-marker"),
        cancel: Arc::new(AtomicBool::new(false)),
        bytes: 0,
        export: None,
        descriptor: None,
        inputs: vec![],
        source_asset: None,
        export_epoch: None,
        program_query: None,
        durable: None,
        explicit_cancel: false,
        durability_error: false,
    });
    let mut project = vv_core::Project::default();
    let mut track = vv_core::Track::new(vv_core::TrackKind::Video);
    track.insert_sorted(vv_core::Clip::from_source_range(
        vv_core::ClipId(1),
        vv_core::ClipSource::SolidColor,
        0,
        24,
        0,
        vv_core::Rational::one(),
    ));
    let timeline = project.timelines.insert(vv_core::Timeline {
        name: "Queued export".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let query = ProgramQuery {
        project_epoch: "p:1".into(),
        if_generation: "0".into(),
        timeline_id: "1".into(),
        revision: "r".into(),
        start_frame: 0,
        end_frame: 24,
        width: 640,
    };
    for _ in 0..3 {
        let task = ProgramTask {
            snapshot: crate::preview::FrameSnapshot {
                project: project.clone(),
                timeline,
                query: query.frame(),
                size: (640, 360),
            },
            query: query.clone(),
            preview: crate::preview::Preview::disabled(),
            export: Some(program::ExportOptions {
                quality: 23,
                preset: "medium".into(),
                audio: false,
            }),
        };
        assert_eq!(jobs.prepare_program(task).unwrap_err().1, "MEDIA_BUSY");
    }
    assert!(jobs.exports.as_ref().unwrap().recover().unwrap().is_empty());
    assert_eq!(jobs.jobs.lock().unwrap().len(), 1);
    drop(jobs);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn corrupt_export_history_blocks_exports_without_preventing_media_service_startup() {
    let path = std::env::temp_dir().join(format!(
        "venturi-corrupt-export-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    let root = File::open(&path).unwrap();
    {
        let _store = ExportStore::open(&root).unwrap();
    }
    let bytes = b"unreadable existing export manifest";
    std::fs::write(path.join(".exports/1.json"), bytes).unwrap();
    let jobs = MediaJobs::start_with_exports(root).unwrap();
    assert_eq!(
        jobs.export_history().unwrap_err().1,
        "EXPORT_HISTORY_UNAVAILABLE"
    );
    assert_eq!(
        jobs.export_status("1", "old:1", false).unwrap_err().1,
        "EXPORT_HISTORY_UNAVAILABLE"
    );
    assert_eq!(
        jobs.export_asset("1", "old:1").unwrap_err().1,
        "EXPORT_HISTORY_UNAVAILABLE"
    );
    assert!(jobs.jobs.lock().unwrap().is_empty());
    assert!(jobs.software_lock_path().parent().unwrap().is_dir());
    assert_eq!(std::fs::read(path.join(".exports/1.json")).unwrap(), bytes);
    drop(jobs);
    std::fs::remove_dir_all(path).unwrap();
}
