use super::*;

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
        inputs: vec![],
        source_asset: Some("source.mp4"),
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
