use super::*;

#[test]
fn audio_only_source_becomes_a_browser_audio_container() {
    let dir = std::env::temp_dir().join(format!("vv-browser-audio-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let source = dir.join("input.wav");
    crate::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "1",
        ],
        &source,
    );
    generate(&source, &dir, ProxyQuality::Low, |_| true).unwrap();
    let info = crate::probe_media(&dir.join("source.mp4")).unwrap();
    assert!(info.has_audio && !info.has_video);
    assert_eq!(info.sample_rate, 48_000);
    let decoded = crate::decode_audio_track(&dir.join("source.mp4"), 0)
        .unwrap()
        .unwrap();
    assert!(decoded.samples.iter().any(|x| x.abs() > 0.01));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn browser_proxy_keeps_audio_video_timing_and_cancels_without_publishing() {
    let dir = std::env::temp_dir().join(format!("vv-browser-proxy-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let source = dir.join("input.mp4");
    crate::test_support::ffmpeg(
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
        &source,
    );
    let ready = dir.join("ready");
    std::fs::create_dir(&ready).unwrap();
    generate(&source, &ready, ProxyQuality::Low, |_| true).unwrap();
    let info = crate::probe_media(&ready.join("source.mp4")).unwrap();
    assert!(info.has_video && info.has_audio);
    assert_eq!(info.fps, vv_core::Rational::new(24, 1));
    assert_eq!(info.duration_frames, 48);
    let decoded = crate::decode_audio_track(&ready.join("source.mp4"), 0)
        .unwrap()
        .unwrap();
    assert!(
        (decoded.samples.len() as f64
            / f64::from(decoded.channels)
            / f64::from(decoded.sample_rate)
            - 2.0)
            .abs()
            < 0.05
    );
    assert!(decoded.samples.iter().any(|x| x.abs() > 0.01));
    let canceled = dir.join("canceled");
    std::fs::create_dir(&canceled).unwrap();
    assert!(matches!(
        generate(&source, &canceled, ProxyQuality::Low, |_| false),
        Err(MediaError::Cancelled)
    ));
    assert!(!canceled.join("source.mp4").exists());
    std::fs::remove_dir_all(dir).unwrap();
}
