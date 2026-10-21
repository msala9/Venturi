use super::*;

fn cache_fixture_job(directory: PathBuf, state: &'static str, bytes: u64) -> Job {
    Job {
        id: "cache-fixture".into(),
        key: "cache-fixture".into(),
        state,
        progress: 0,
        error: None,
        directory,
        cancel: Arc::new(AtomicBool::new(false)),
        bytes,
        touched: Instant::now(),
        export: None,
        descriptor: None,
        source_window: None,
        source_assets: None,
        inputs: vec![],
        source_asset: Some("source.mp4"),
        export_epoch: None,
        program_query: None,
        durable: None,
        explicit_cancel: false,
        durability_error: false,
    }
}
fn cache_fixture_root(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vv-cache-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}

fn window_fixture_meta() -> vv_core::MediaMeta {
    vv_core::MediaMeta {
        duration_frames: 48_000,
        fps: vv_core::Rational::new(24, 1),
        width: 16,
        height: 16,
        has_video: true,
        has_audio: false,
        sample_rate: 0,
        channels: 0,
        audio_streams: 0,
        file: Default::default(),
    }
}
fn cloned_source(spec: &SourceSpec) -> SourceSpec {
    SourceSpec {
        file: spec.file.try_clone().unwrap(),
        epoch: spec.epoch.clone(),
        media_id: spec.media_id.clone(),
        meta: spec.meta.clone(),
    }
}

#[test]
fn source_window_dto_and_rational_validation_admit_short_windows_of_long_sources_only() {
    let window: SourceWindow =
        serde_json::from_value(json!({"start_frame":25,"end_frame":37})).unwrap();
    let mut meta = window_fixture_meta();
    assert!(window.validate(&meta).is_ok());
    assert!(meta.duration_frames as f64 / meta.fps.as_f64() > 600.);
    for value in [
        json!({"start_frame":1,"end_frame":2,"extra":true}),
        json!({"start_frame":0.5,"end_frame":2}),
        json!({"start_frame":1}),
    ] {
        assert!(serde_json::from_value::<SourceWindow>(value).is_err());
    }
    for (start_frame, end_frame) in [(-1, 1), (1, 1), (2, 1), (0, 48_001), (0, 1441)] {
        assert!(
            SourceWindow {
                start_frame,
                end_frame
            }
            .validate(&meta)
            .is_err()
        );
    }
    meta.fps = vv_core::Rational::new(24_000, 1001);
    assert!(
        SourceWindow {
            start_frame: 10,
            end_frame: 1448
        }
        .validate(&meta)
        .is_ok()
    );
    assert!(
        SourceWindow {
            start_frame: 10,
            end_frame: 1449
        }
        .validate(&meta)
        .is_err()
    );
    for invalid in [
        vv_core::MediaMeta {
            width: 0,
            ..window_fixture_meta()
        },
        vv_core::MediaMeta {
            height: 8193,
            ..window_fixture_meta()
        },
        vv_core::MediaMeta {
            fps: vv_core::Rational::new(0, 1),
            ..window_fixture_meta()
        },
        vv_core::MediaMeta {
            duration_frames: 0,
            ..window_fixture_meta()
        },
        vv_core::MediaMeta {
            duration_frames: vv_core::IMAGE_DURATION_FRAMES,
            ..window_fixture_meta()
        },
        vv_core::MediaMeta {
            has_video: false,
            has_audio: false,
            ..window_fixture_meta()
        },
        vv_core::MediaMeta {
            has_audio: true,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            ..window_fixture_meta()
        },
    ] {
        assert!(window.validate(&invalid).is_err());
    }
}

#[test]
fn source_window_keys_preserve_legacy_v1_and_separate_range_quality_epoch_and_full_file_identity() {
    let root = cache_fixture_root("window-keys");
    let path = root.join("input");
    std::fs::write(&path, b"small").unwrap();
    let mut spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "source:1".into(),
        media_id: "9007199254740993".into(),
        meta: window_fixture_meta(),
    };
    let identity = spec.identity().unwrap();
    let window = SourceWindow {
        start_frame: 25,
        end_frame: 37,
    };
    assert_eq!(
        source_key(&spec, ProxyQuality::Low, None, &identity, 0),
        format!("source:1:9007199254740993:{identity}:v1:low:audio:0")
    );
    let key = source_key(&spec, ProxyQuality::Low, Some(window), &identity, 0);
    assert_ne!(
        key,
        source_key(&spec, ProxyQuality::Low, None, &identity, 0)
    );
    assert_ne!(
        key,
        source_key(
            &spec,
            ProxyQuality::Low,
            Some(SourceWindow {
                start_frame: 26,
                end_frame: 38
            }),
            &identity,
            0
        )
    );
    assert_ne!(
        key,
        source_key(&spec, ProxyQuality::High, Some(window), &identity, 0)
    );
    spec.epoch = "source:2".into();
    assert_ne!(
        key,
        source_key(&spec, ProxyQuality::Low, Some(window), &identity, 0)
    );
    spec.epoch = "source:1".into();
    std::fs::write(&path, b"different file identity").unwrap();
    assert_ne!(
        key,
        source_key(
            &spec,
            ProxyQuality::Low,
            Some(window),
            &spec.identity().unwrap(),
            0
        )
    );
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn cached_window_of_a_long_source_reuses_only_its_exact_version_and_keeps_program_descriptor_empty()
{
    let service = MediaJobs::start().unwrap();
    let path = service.root.join("input");
    std::fs::write(&path, b"original").unwrap();
    let mut spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "window:1".into(),
        media_id: "9007199254740993".into(),
        meta: window_fixture_meta(),
    };
    let identity = spec.identity().unwrap();
    let window = SourceWindow {
        start_frame: 1000,
        end_frame: 1012,
    };
    let directory = service.root.join("cached-window");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("source.mp4"), b"window").unwrap();
    let mut job = cache_fixture_job(directory, "ready", 6);
    job.key = source_key(&spec, ProxyQuality::Low, Some(window), &identity, 0);
    job.source_window = Some(window.descriptor(&spec, &identity, 0));
    job.touched = Instant::now() - Duration::from_secs(90);
    service.jobs.lock().unwrap().push_back(job);
    let result = service
        .prepare_window(cloned_source(&spec), "low", window)
        .unwrap();
    assert_eq!(result["id"], "cache-fixture");
    assert_eq!(
        result["source_window"],
        json!({"start_frame":1000,"end_frame":1012,"total_frames":48_000,"fps":{"num":24,"den":1},"source_version":identity,"audio_stream_index":0})
    );
    assert!(result["program"].is_null());
    assert!(
        service.prepare(cloned_source(&spec), "low").is_err(),
        "Legacy full-file preparation keeps its ten-minute cap"
    );
    assert!(service.status("cache-fixture", &spec, false).is_ok());
    assert!(service.asset("cache-fixture", &spec, "source.mp4").is_ok());
    spec.epoch = "window:2".into();
    assert!(service.status("cache-fixture", &spec, false).is_err());
    spec.epoch = "window:1".into();
    spec.media_id = "other".into();
    assert!(service.asset("cache-fixture", &spec, "source.mp4").is_err());
    spec.media_id = "9007199254740993".into();
    std::fs::write(path, b"updated original source").unwrap();
    assert!(service.status("cache-fixture", &spec, false).is_err());
    assert!(service.asset("cache-fixture", &spec, "source.mp4").is_err());
}

#[test]
fn twelve_frame_source_window_job_publishes_only_its_ranged_movie_and_reuses_the_ready_job() {
    let service = MediaJobs::start().unwrap();
    let path = service.root.join("input.mp4");
    let settings = vv_media::VideoSettings {
        preset: "ultrafast".into(),
        ..Default::default()
    };
    let mut encoder =
        vv_media::Encoder::new(&path, 16, 16, vv_core::Rational::new(1, 1), &settings, None)
            .unwrap();
    let mut frame = vec![64; 256];
    frame.extend(vec![128; 128]);
    for _ in 0..601 {
        encoder.write_video_frame(&frame).unwrap();
    }
    encoder.finish().unwrap();
    let original = std::fs::read(&path).unwrap();
    assert!(original.len() <= 512 * 1024);
    let spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "window:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_media(&path).unwrap(),
    };
    let window = SourceWindow {
        start_frame: 589,
        end_frame: 601,
    };
    let pending = service
        .prepare_window(cloned_source(&spec), "low", window)
        .unwrap();
    let id = pending["id"].as_str().unwrap();
    assert!(pending["program"].is_null());
    assert_eq!(pending["source_window"]["total_frames"], 601);
    let started = Instant::now();
    loop {
        let status = service.status(id, &spec, false).unwrap();
        if status["state"] == "ready" {
            break;
        }
        assert!(
            !matches!(status["state"].as_str(), Some("failed" | "canceled")),
            "{status}"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
    let asset = service.asset(id, &spec, "source.mp4").unwrap();
    let anchored = PathBuf::from(format!("/proc/self/fd/{}", asset.as_raw_fd()));
    let mut decoder = vv_media::Decoder::open_software_bounded(&anchored, 1).unwrap();
    let mut count = 0;
    while decoder.next_frame().unwrap().is_some() {
        count += 1;
    }
    assert_eq!(count, 12);
    assert!(service.asset(id, &spec, "thumb.png").is_err());
    assert!(service.asset(id, &spec, "waveform.json").is_err());
    assert_eq!(
        service
            .prepare_window(cloned_source(&spec), "low", window)
            .unwrap()["id"],
        pending["id"]
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    let assets = service.prepare_assets(cloned_source(&spec)).unwrap();
    let assets_id = assets["id"].as_str().unwrap();
    let ready = wait_for_assets(&service, &spec, assets_id);
    assert_eq!(ready["source_assets"]["total_frames"], 601);
    assert!(service.asset(assets_id, &spec, "thumb.png").is_ok());
    assert!(service.asset(assets_id, &spec, "source.mp4").is_err());
    assert_eq!(
        std::fs::read_dir(service.root.join(assets_id))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn cache_admission_reserves_each_active_job_and_obeys_exact_cache_and_free_space_boundaries() {
    let mut jobs = VecDeque::from([
        cache_fixture_job("unused-running".into(), "running", 3),
        cache_fixture_job("unused-queued".into(), "queued", 7),
        cache_fixture_job("unused-ready".into(), "ready", 11),
    ]);
    assert_eq!(reserved_bytes(&jobs), 2 * MAX_JOB_BYTES);
    assert_eq!(cache_charge(&jobs), 2 * MAX_JOB_BYTES + 11);
    let required = MIN_FREE_BYTES + 3 * MAX_JOB_BYTES;
    assert!(admission_fits(&jobs, required));
    assert!(!admission_fits(&jobs, required - 1));
    jobs[2].bytes = 2 * MAX_JOB_BYTES;
    assert_eq!(cache_charge(&jobs), MAX_CACHE_BYTES);
    assert!(!admission_fits(&jobs, u64::MAX));
    jobs[2].bytes = MAX_JOB_BYTES;
    assert!(admission_fits(&jobs, required));
    let zero = VecDeque::from_iter(
        (0..MAX_CACHE_JOBS).map(|_| cache_fixture_job("unused-count".into(), "ready", 0)),
    );
    assert!(!admission_fits(&zero, u64::MAX));
    assert!(publication_fits(MAX_JOB_BYTES, MIN_FREE_BYTES));
    assert!(!publication_fits(MAX_JOB_BYTES + 1, MIN_FREE_BYTES));
    assert!(!publication_fits(1, MIN_FREE_BYTES - 1));
}

#[test]
fn fresh_ready_cache_is_pinned_until_the_shared_ttl_expires_then_reclaims_before_admission() {
    let root = cache_fixture_root("ttl");
    let directory = root.join("job");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("source.mp4"), b"small").unwrap();
    let now = Instant::now();
    let mut job = cache_fixture_job(directory.clone(), "ready", 5);
    job.touched = now;
    let mut jobs = VecDeque::from([job]);
    trim_for(
        &mut jobs,
        MAX_CACHE_BYTES,
        MAX_CACHE_JOBS,
        now + CACHE_TTL - Duration::from_nanos(1),
    );
    assert_eq!(jobs.len(), 1);
    assert!(directory.join("source.mp4").exists());
    trim_for(&mut jobs, MAX_CACHE_BYTES, MAX_CACHE_JOBS, now + CACHE_TTL);
    assert!(jobs.is_empty());
    assert!(!directory.exists());
    std::fs::remove_dir(root).unwrap();
}

#[tokio::test]
async fn an_active_cache_response_body_locks_every_file_against_reclamation_until_download_ends() {
    use axum::{body::to_bytes, http::HeaderMap};
    let root = cache_fixture_root("http-lock");
    let directory = root.join("job");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("source.mp4"), b"small").unwrap();
    std::fs::write(directory.join("thumb.png"), b"tiny").unwrap();
    let mut jobs = VecDeque::from([cache_fixture_job(directory.clone(), "ready", 9)]);
    let expired = jobs[0].touched + CACHE_TTL;
    let file = open_cache_asset(&directory.join("source.mp4")).unwrap();
    let response = stream_file(file, "video/mp4", "cache-fixture", &HeaderMap::new())
        .await
        .unwrap();
    trim_for(&mut jobs, MAX_CACHE_BYTES, MAX_CACHE_JOBS, expired);
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].bytes, 9);
    assert!(directory.join("source.mp4").exists());
    assert!(directory.join("thumb.png").exists());
    assert_eq!(
        &to_bytes(response.into_body(), 16).await.unwrap()[..],
        b"small"
    );
    trim_for(&mut jobs, MAX_CACHE_BYTES, MAX_CACHE_JOBS, expired);
    assert!(jobs.is_empty());
    assert!(!directory.exists());
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn failed_cache_cleanup_keeps_the_job_and_actual_remaining_bytes_and_unknown_sizes_fail_closed() {
    let root = cache_fixture_root("failed-cleanup");
    let directory = root.join("job");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("first"), b"123").unwrap();
    std::fs::write(directory.join("second"), b"12345").unwrap();
    let mut job = cache_fixture_job(directory.clone(), "ready", 8);
    assert!(!reclaim_with(&mut job, |path| {
        std::fs::remove_file(path.join("first"))?;
        Err(std::io::Error::other("injected unlink failure"))
    }));
    assert_eq!(job.bytes, 5);
    assert_eq!(job.charge(), 5);
    assert_eq!(job.state, "failed");
    assert!(directory.join("second").exists());
    std::fs::create_dir(directory.join("unknown")).unwrap();
    assert!(!reclaim(&mut job));
    assert_eq!(job.bytes, MAX_CACHE_BYTES);
    assert!(directory.join("second").exists());
    let mut jobs = VecDeque::from([job]);
    trim_for(&mut jobs, MAX_JOB_BYTES, MAX_CACHE_JOBS, Instant::now());
    assert_eq!(jobs.len(), 1);
    assert!(!admission_fits(&jobs, u64::MAX));
    std::fs::remove_dir(directory.join("unknown")).unwrap();
    assert!(reclaim(&mut jobs[0]));
    assert_eq!(jobs[0].bytes, 0);
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn ready_source_status_cache_hits_and_assets_refresh_ttl_but_cancel_does_not_unpin_another_viewer()
{
    let source = MediaJobs::start().unwrap();
    let input = source.root.join("input");
    std::fs::write(&input, b"original").unwrap();
    let spec = SourceSpec {
        file: File::open(&input).unwrap(),
        epoch: "cache:1".into(),
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
    let directory = source.root.join("cached");
    std::fs::create_dir(&directory).unwrap();
    std::fs::write(directory.join("source.mp4"), b"proxy").unwrap();
    let mut job = cache_fixture_job(directory, "ready", 5);
    job.key = source_key(
        &spec,
        ProxyQuality::Medium,
        None,
        &spec.identity().unwrap(),
        0,
    );
    let old = Instant::now() - Duration::from_secs(90);
    job.touched = old;
    source.jobs.lock().unwrap().push_back(job);
    source.status("cache-fixture", &spec, false).unwrap();
    assert!(source.jobs.lock().unwrap()[0].touched > old);
    let touched = source.jobs.lock().unwrap()[0].touched;
    source.status("cache-fixture", &spec, true).unwrap();
    assert_eq!(source.jobs.lock().unwrap()[0].touched, touched);
    source.jobs.lock().unwrap()[0].touched = old;
    let repeated = source
        .prepare(
            SourceSpec {
                file: spec.file.try_clone().unwrap(),
                epoch: spec.epoch.clone(),
                media_id: spec.media_id.clone(),
                meta: spec.meta.clone(),
            },
            "medium",
        )
        .unwrap();
    assert_eq!(repeated["id"], "cache-fixture");
    assert!(source.jobs.lock().unwrap()[0].touched > old);
    source.jobs.lock().unwrap()[0].touched = old;
    let asset = source.asset("cache-fixture", &spec, "source.mp4").unwrap();
    assert!(source.jobs.lock().unwrap()[0].touched > old);
    drop(asset);
}

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
        key: source_key(
            &spec,
            ProxyQuality::Medium,
            None,
            &spec.identity().unwrap(),
            0,
        ),
        state: "ready",
        progress: 24,
        error: None,
        directory,
        cancel: Arc::new(AtomicBool::new(false)),
        bytes: 5,
        touched: Instant::now(),
        export: None,
        descriptor: None,
        source_window: None,
        source_assets: None,
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
        touched: Instant::now(),
        export: None,
        descriptor: None,
        source_window: None,
        source_assets: None,
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
        discard: None,
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
        touched: Instant::now(),
        export: None,
        descriptor: None,
        source_window: None,
        source_assets: None,
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
                encoder: crate::codecs::Encoder::X264,
                decoder: crate::codecs::Decoder::Software,
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

#[test]
fn saved_export_discard_checks_old_epoch_state_revision_and_download_lifetime_then_reclaims_history()
 {
    let path = std::env::temp_dir().join(format!(
        "venturi-discard-source-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    let root = File::open(&path).unwrap();
    let store = ExportStore::open(&root).unwrap();
    for (index, state) in ["ready", "failed", "canceled", "interrupted"]
        .into_iter()
        .enumerate()
    {
        let mut stored = store
            .admit(ExportRecord {
                version: 1,
                id: (index + 1).to_string(),
                key: format!("export:old:{index}"),
                epoch: "old:7".into(),
                state: "queued".into(),
                previous_state: None,
                cancel_requested: false,
                error: None,
                program: json!({}),
                progress: None,
                bytes: 0,
                output: None,
                discard: None,
            })
            .unwrap();
        std::fs::write(stored.directory().join("rendering.mp4"), b"owned export").unwrap();
        let mut record = stored.record.clone();
        record.state = state.into();
        if state == "ready" {
            record.output = Some(store.publish_output(&stored).unwrap());
        }
        record.bytes = ExportStore::bytes(&stored);
        store.save(&mut stored, record).unwrap();
    }
    drop(store);
    let jobs = MediaJobs::start_with_exports(root).unwrap();
    let request = |id: &str| export_store::DiscardRequest {
        project_epoch: "old:7".into(),
        revision: jobs.export_status(id, "old:7", false).unwrap()["export_revision"]
            .as_str()
            .unwrap()
            .into(),
        command_id: "c78523aa-f779-4f6b-8881-21c2072b88ab".into(),
    };
    let mut wrong = request("1");
    wrong.project_epoch = "new:1".into();
    assert_eq!(jobs.export_discard("1", wrong).unwrap_err().1, "NOT_FOUND");
    let mut stale = request("1");
    stale.revision = "0".repeat(64);
    assert_eq!(
        jobs.export_discard("1", stale).unwrap_err().1,
        "EXPORT_CHANGED"
    );
    let download = jobs.export_asset("1", "old:7").unwrap();
    assert_eq!(
        jobs.export_discard("1", request("1")).unwrap_err().1,
        "EXPORT_DOWNLOAD_ACTIVE"
    );
    assert_eq!(
        jobs.export_status("1", "old:7", false).unwrap()["state"],
        "ready"
    );
    drop(download);
    let repeat = request("1");
    jobs.export_discard("1", repeat.clone()).unwrap();
    assert_eq!(jobs.export_discard("1", repeat).unwrap_err().1, "NOT_FOUND");
    assert!(jobs.export_asset("1", "old:7").is_err());
    {
        let store = jobs.exports.as_ref().unwrap();
        let mut owned = jobs.jobs.lock().unwrap();
        owned[0].state = "running";
        owned[0].persist(store).unwrap();
    }
    assert_eq!(
        jobs.export_discard("2", request("2")).unwrap_err().1,
        "EXPORT_ACTIVE"
    );
    {
        let store = jobs.exports.as_ref().unwrap();
        let mut owned = jobs.jobs.lock().unwrap();
        owned[0].state = "failed";
        owned[0].persist(store).unwrap();
    }
    for id in ["2", "3", "4"] {
        jobs.export_discard(id, request(id)).unwrap();
    }
    let history = jobs.export_history().unwrap();
    assert!(history["jobs"].as_array().unwrap().is_empty());
    assert_eq!(history["capacity"]["used_jobs"], 0);
    assert_eq!(history["capacity"]["charged_bytes"], 0);
    for id in ["1", "2", "3", "4"] {
        assert!(!path.join(".exports").join(id).exists());
    }
    drop(jobs);
    std::fs::remove_dir_all(path).unwrap();
}

fn wait_for_assets(service: &MediaJobs, spec: &SourceSpec, id: &str) -> Value {
    let started = Instant::now();
    loop {
        let status = service.status(id, spec, false).unwrap();
        if status["state"] == "ready" {
            return status;
        }
        assert!(
            matches!(status["state"].as_str(), Some("queued" | "running")),
            "{status}"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn source_assets_admit_long_metadata_and_separate_full_source_identity_without_movie_quality() {
    let root = cache_fixture_root("assets-meta");
    let path = root.join("input");
    std::fs::write(&path, b"fixture").unwrap();
    let mut spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "a:1".into(),
        media_id: "1".into(),
        meta: window_fixture_meta(),
    };
    assert!(validate_assets_meta(&spec.meta).is_ok());
    let identity = spec.identity().unwrap();
    let key = assets_key(&spec, &identity);
    assert!(key.ends_with(":v3-assets:full"));
    assert_ne!(
        key,
        source_key(&spec, ProxyQuality::Low, None, &identity, 0)
    );
    let mut actual = spec.meta.clone();
    actual.channels = 1;
    assert!(!same_assets_meta(&spec.meta, &actual));
    actual = spec.meta.clone();
    actual.file.video_codec = Some("older-description".into());
    assert!(same_assets_meta(&spec.meta, &actual));
    actual = spec.meta.clone();
    actual.duration_frames += 1;
    assert!(!same_assets_meta(&spec.meta, &actual));
    actual = spec.meta.clone();
    actual.has_audio = true;
    assert!(!same_assets_meta(&spec.meta, &actual));
    spec.epoch = "a:2".into();
    assert_ne!(key, assets_key(&spec, &identity));
    spec.meta.fps = vv_core::Rational::new(0, 1);
    assert!(validate_assets_meta(&spec.meta).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn native_full_source_assets_publish_only_thumbnail_and_streamed_waveform_and_reuse_scoped_jobs() {
    let service = MediaJobs::start().unwrap();
    let path = service.root.join("input.mp4");
    let settings = vv_media::VideoSettings {
        preset: "ultrafast".into(),
        ..Default::default()
    };
    let audio = vv_media::AudioSettings::default();
    let mut encoder = vv_media::Encoder::new(
        &path,
        16,
        16,
        vv_core::Rational::new(24, 1),
        &settings,
        Some((48_000, 1, &audio)),
    )
    .unwrap();
    let mut frame = vec![64; 256];
    frame.extend(vec![128; 128]);
    for _ in 0..24 {
        encoder.write_video_frame(&frame).unwrap();
    }
    let samples: Vec<f32> = (0..48_000)
        .map(|sample| {
            if sample < 24_000 {
                0.0
            } else {
                (sample as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.5
            }
        })
        .collect();
    encoder.write_audio_samples(&samples).unwrap();
    encoder.finish().unwrap();
    let original = std::fs::read(&path).unwrap();
    let spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "assets:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_media(&path).unwrap(),
    };
    let pending = service.prepare_assets(cloned_source(&spec)).unwrap();
    let id = pending["id"].as_str().unwrap();
    let ready = wait_for_assets(&service, &spec, id);
    assert!(ready["source_asset"].is_null());
    assert!(ready["source_window"].is_null());
    assert!(ready["program"].is_null());
    assert_eq!(
        ready["source_assets"]["total_frames"],
        spec.meta.duration_frames
    );
    assert_eq!(
        ready["source_assets"]["source_version"],
        spec.identity().unwrap()
    );
    assert_eq!(ready["source_assets"]["has_video"], true);
    assert_eq!(ready["source_assets"]["has_audio"], true);
    assert!(
        service
            .asset(id, &spec, "thumb.png")
            .unwrap()
            .metadata()
            .unwrap()
            .len()
            <= 1024 * 1024
    );
    let waveform: Value =
        serde_json::from_reader(service.asset(id, &spec, "waveform.json").unwrap()).unwrap();
    assert_eq!(waveform["scope"], "full_source");
    assert!((waveform["duration_seconds"].as_f64().unwrap() - 1.0).abs() < 0.1);
    let peaks = waveform["peaks"].as_array().unwrap();
    assert!(peaks.len() <= 65_536);
    assert!(
        peaks
            .iter()
            .skip(peaks.len() / 2)
            .any(|peak| peak.as_f64().unwrap() > 0.1)
    );
    let directory = service.root.join(id);
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 2);
    for name in ["source.mp4", "video.mp4", "audio.m4a"] {
        assert!(!directory.join(name).exists());
    }
    assert_eq!(
        service.prepare_assets(cloned_source(&spec)).unwrap()["id"],
        pending["id"]
    );
    let mut wrong = cloned_source(&spec);
    wrong.epoch = "assets:2".into();
    assert!(service.status(id, &wrong, false).is_err());
    assert!(service.asset(id, &wrong, "thumb.png").is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    File::options()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"changed")
        .unwrap();
    assert!(service.status(id, &spec, false).is_err());
    assert!(service.asset(id, &spec, "waveform.json").is_err());
}
#[test]
fn native_audio_only_assets_accept_legacy_descriptive_metadata_and_publish_only_full_source_waveform()
 {
    let service = MediaJobs::start().unwrap();
    let path = service.root.join("audio.wav");
    let samples: Vec<f32> = (0..4_800).map(|i| (i as f32 * 0.2).sin() * 0.5).collect();
    vv_media::audio_file::write_audio_file(
        &path,
        vv_media::audio_file::AudioFileFormat::Wav,
        &samples,
        48_000,
        1,
    )
    .unwrap();
    let mut spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "audio:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_media(&path).unwrap(),
    };
    assert_ne!(spec.meta.file, vv_core::MediaFileInfo::default());
    spec.meta.file = Default::default();
    let pending = service.prepare_assets(cloned_source(&spec)).unwrap();
    let id = pending["id"].as_str().unwrap();
    let ready = wait_for_assets(&service, &spec, id);
    assert_eq!(ready["source_assets"]["has_video"], false);
    let waveform: Value =
        serde_json::from_reader(service.asset(id, &spec, "waveform.json").unwrap()).unwrap();
    assert_eq!(waveform["scope"], "full_source");
    assert!((waveform["duration_seconds"].as_f64().unwrap() - 0.1).abs() < 0.001);
    assert_eq!(std::fs::read_dir(service.root.join(id)).unwrap().count(), 1);
    assert!(service.asset(id, &spec, "source.mp4").is_err());
    assert!(service.asset(id, &spec, "thumb.png").is_err());
}
fn dormant_assets_service() -> (MediaJobs, mpsc::Receiver<(String, Work)>, SourceSpec) {
    let root = cache_fixture_root("assets-preempt");
    let path = root.join("input");
    std::fs::write(&path, b"fixture").unwrap();
    let spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "a:1".into(),
        media_id: "1".into(),
        meta: window_fixture_meta(),
    };
    let mut analysis = cache_fixture_job(root.join("analysis"), "running", 0);
    std::fs::create_dir(&analysis.directory).unwrap();
    analysis.source_assets = Some(json!({}));
    analysis.source_asset = None;
    let foreign = cache_fixture_job(root.join("foreign"), "running", 0);
    std::fs::create_dir(&foreign.directory).unwrap();
    let (send, receive) = mpsc::sync_channel(1);
    (
        MediaJobs {
            root: Arc::new(root),
            jobs: Arc::new(Mutex::new(VecDeque::from([analysis, foreign]))),
            send,
            exports: None,
            exports_blocked: false,
        },
        receive,
        spec,
    )
}
#[test]
fn accepted_foreground_source_preempts_only_running_assets_after_validation_and_queue_admission() {
    for fail_send in [false, true] {
        let (service, receiver, spec) = dormant_assets_service();
        let analysis = service.jobs.lock().unwrap()[0].cancel.clone();
        let foreign = service.jobs.lock().unwrap()[1].cancel.clone();
        assert!(
            service
                .prepare_window(
                    cloned_source(&spec),
                    "low",
                    SourceWindow {
                        start_frame: 0,
                        end_frame: 1_441
                    }
                )
                .is_err()
        );
        assert!(!analysis.load(Ordering::Relaxed));
        let queued = cache_fixture_job(service.root.join("queued"), "queued", 0);
        service.jobs.lock().unwrap().push_back(queued);
        assert_eq!(
            service
                .prepare_window(
                    cloned_source(&spec),
                    "low",
                    SourceWindow {
                        start_frame: 0,
                        end_frame: 12
                    }
                )
                .unwrap_err()
                .1,
            "SOURCE_BUSY"
        );
        assert!(!analysis.load(Ordering::Relaxed));
        service.jobs.lock().unwrap().pop_back();
        if fail_send {
            drop(receiver);
        } else {
            assert!(
                service
                    .send
                    .try_send((
                        "occupied".into(),
                        Work::Assets(Box::new(cloned_source(&spec)))
                    ))
                    .is_ok()
            );
        }
        assert!(
            service
                .prepare_window(
                    cloned_source(&spec),
                    "low",
                    SourceWindow {
                        start_frame: 0,
                        end_frame: 12
                    }
                )
                .is_err()
        );
        assert!(!analysis.load(Ordering::Relaxed));
        assert!(!foreign.load(Ordering::Relaxed));
        let root = (*service.root).clone();
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }
    let (service, receiver, spec) = dormant_assets_service();
    let analysis = service.jobs.lock().unwrap()[0].cancel.clone();
    let foreign = service.jobs.lock().unwrap()[1].cancel.clone();
    service
        .prepare_window(
            cloned_source(&spec),
            "low",
            SourceWindow {
                start_frame: 0,
                end_frame: 12,
            },
        )
        .unwrap();
    assert!(analysis.load(Ordering::Relaxed));
    assert!(!foreign.load(Ordering::Relaxed));
    assert!(matches!(
        receiver.try_recv().unwrap().1,
        Work::Source(_, _, _, _)
    ));
    let root = (*service.root).clone();
    drop(service);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn accepted_legacy_source_and_program_work_preempt_assets_without_canceling_foreign_work() {
    for program in [false, true] {
        let (service, receiver, mut spec) = dormant_assets_service();
        let analysis = service.jobs.lock().unwrap()[0].cancel.clone();
        let foreign = service.jobs.lock().unwrap()[1].cancel.clone();
        if program {
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
                name: "Assets foreground".into(),
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
            service
                .prepare_program(ProgramTask {
                    snapshot: crate::preview::FrameSnapshot {
                        project,
                        timeline,
                        query: query.frame(),
                        size: (640, 360),
                    },
                    query,
                    preview: crate::preview::Preview::disabled(),
                    export: None,
                })
                .unwrap();
            assert!(matches!(receiver.try_recv().unwrap().1, Work::Program(_)));
        } else {
            spec.meta.duration_frames = 24;
            service.prepare(spec, "low").unwrap();
            assert!(matches!(
                receiver.try_recv().unwrap().1,
                Work::Source(_, _, None, 0)
            ));
        }
        assert!(analysis.load(Ordering::Relaxed));
        assert!(!foreign.load(Ordering::Relaxed));
        let root = (*service.root).clone();
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn selected_source_audio_validates_before_admission_and_cache_keys_separate_only_the_native_stream()
{
    let root = cache_fixture_root("selected-audio");
    let path = root.join("input");
    std::fs::write(&path, b"unchanged source").unwrap();
    let mut spec = SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "audio:1".into(),
        media_id: "1".into(),
        meta: window_fixture_meta(),
    };
    spec.meta.has_audio = true;
    spec.meta.sample_rate = 48_000;
    spec.meta.channels = 1;
    spec.meta.audio_streams = 2;
    let identity = spec.identity().unwrap();
    let window = SourceWindow {
        start_frame: 1000,
        end_frame: 1012,
    };
    let first = source_key(&spec, ProxyQuality::Low, Some(window), &identity, 0);
    let second = source_key(&spec, ProxyQuality::Low, Some(window), &identity, 1);
    assert_ne!(first, second);
    assert!(first.ends_with(":audio:0"));
    assert!(second.ends_with(":audio:1"));
    assert_eq!(spec.identity().unwrap(), identity);
    let metadata = serde_json::to_value(&spec.meta).unwrap();
    let (send, receiver) = mpsc::sync_channel(1);
    let service = MediaJobs {
        root: Arc::new(root.clone()),
        jobs: Arc::new(Mutex::new(VecDeque::new())),
        send,
        exports: None,
        exports_blocked: false,
    };
    assert!(
        service
            .prepare_selected(cloned_source(&spec), "low", Some(window), 2)
            .is_err()
    );
    assert!(
        service
            .prepare_selected(cloned_source(&spec), "low", Some(window), u32::MAX)
            .is_err()
    );
    assert!(service.jobs.lock().unwrap().is_empty());
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    let pending = service
        .prepare_selected(cloned_source(&spec), "low", Some(window), 1)
        .unwrap();
    assert_eq!(pending["source_window"]["audio_stream_index"], 1);
    assert!(matches!(
        receiver.try_recv().unwrap().1,
        Work::Source(_, _, Some(_), 1)
    ));
    {
        let mut jobs = service.jobs.lock().unwrap();
        jobs[0].state = "ready";
    }
    assert_eq!(
        service
            .prepare_selected(cloned_source(&spec), "low", Some(window), 1)
            .unwrap()["id"],
        pending["id"]
    );
    let zero = service
        .prepare_window(cloned_source(&spec), "low", window)
        .unwrap();
    assert_ne!(zero["id"], pending["id"]);
    assert_eq!(zero["source_window"]["audio_stream_index"], 0);
    assert!(matches!(
        receiver.try_recv().unwrap().1,
        Work::Source(_, _, Some(_), 0)
    ));
    assert_eq!(
        service
            .prepare_selected(cloned_source(&spec), "low", Some(window), 0)
            .unwrap()["id"],
        zero["id"]
    );
    assert_eq!(serde_json::to_value(&spec.meta).unwrap(), metadata);
    assert_eq!(spec.identity().unwrap(), identity);
    spec.meta.has_audio = false;
    spec.meta.audio_streams = 0;
    assert!(validate_source_audio(&spec.meta, 0).is_ok());
    assert!(validate_source_audio(&spec.meta, 1).is_err());
    drop(service);
    drop(receiver);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_source_worker_refuses_changed_stream_metadata_before_creating_a_proxy() {
    let root = cache_fixture_root("selected-audio-probe");
    let input = root.join("input.wav");
    let output = root.join("output");
    std::fs::create_dir(&output).unwrap();
    vv_media::audio_file::write_audio_file(
        &input,
        vv_media::audio_file::AudioFileFormat::Wav,
        &vec![0.1; 4800],
        48_000,
        1,
    )
    .unwrap();
    let mut spec = SourceSpec {
        file: File::open(&input).unwrap(),
        epoch: "audio:1".into(),
        media_id: "1".into(),
        meta: vv_media::probe_media(&input).unwrap(),
    };
    spec.meta.audio_streams = 2;
    assert_eq!(
        generate(
            &spec,
            &output,
            ProxyQuality::Low,
            None,
            1,
            &AtomicBool::new(false),
            |_| {}
        )
        .unwrap_err()
        .1,
        "SOURCE_CHANGED"
    );
    assert_eq!(std::fs::read_dir(&output).unwrap().count(), 0);
    spec.meta = vv_media::probe_media(&input).unwrap();
    spec.meta.audio_streams = 0;
    spec.meta.sample_rate = 0;
    spec.meta.channels = 0;
    assert!(validate_source_audio(&spec.meta, 1).is_err());
    generate(
        &spec,
        &output,
        ProxyQuality::Low,
        None,
        0,
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert!(output.join("source.mp4").is_file());
    std::fs::remove_dir_all(root).unwrap();
}
