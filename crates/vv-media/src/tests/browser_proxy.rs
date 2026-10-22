use super::*;

#[test]
fn browser_proxy_native_audio_callback_remains_cpu_only_and_cancellation_refuses_publication() {
    let root = std::env::temp_dir().join(format!("vv-browser-native-audio-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("input.wav");
    let output = root.join("ready");
    let canceled = root.join("canceled");
    std::fs::create_dir(&output).unwrap();
    std::fs::create_dir(&canceled).unwrap();
    write_audio_file(&input, AudioFileFormat::Wav, &vec![0.1; 4800], 48_000, 1).unwrap();
    let original = std::fs::read(&input).unwrap();
    let stereo: Vec<f32> = (0..4000).flat_map(|_| [0.1, -0.2]).collect();
    let mut calls = 0;
    generate_with_audio(
        &input,
        &output,
        ProxyQuality::Low,
        Some(0..2),
        |_| true,
        |path, keep| {
            calls += 1;
            assert!(keep(0));
            write_audio_file(path, AudioFileFormat::Aac, &stereo, 48_000, 2)
        },
    )
    .unwrap();
    assert_eq!(calls, 1);
    let meta = crate::probe_media(&output.join("source.mp4")).unwrap();
    assert!(!meta.has_video);
    assert!(meta.has_audio);
    assert_eq!(meta.channels, 2);
    let cancel = std::cell::Cell::new(false);
    let result = generate_with_audio(
        &input,
        &canceled,
        ProxyQuality::Low,
        Some(0..2),
        |_| !cancel.get(),
        |path, _| {
            write_audio_file(path, AudioFileFormat::Aac, &stereo, 48_000, 2)?;
            cancel.set(true);
            Ok(())
        },
    );
    assert!(matches!(result, Err(MediaError::Cancelled)));
    assert!(!canceled.join("source.mp4").exists());
    assert!(
        !canceled
            .join(format!("source.tmp-{}.mp4", std::process::id()))
            .exists()
    );
    assert_eq!(std::fs::read(&input).unwrap(), original);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn audio_range_boundaries_use_checked_absolute_rational_samples() {
    let fps = vv_core::Rational::new(30_000, 1001);
    assert_eq!(audio_sample_range(&(1..2), fps).unwrap(), 1602..3203);
    assert_eq!(audio_sample_range(&(2..3), fps).unwrap(), 3203..4805);
    assert_eq!(
        audio_sample_range(&(100..101), vv_core::Rational::new(24_000, 1001)).unwrap(),
        200_200..202_202
    );
    assert!(audio_sample_range(&(0..1801), vv_core::Rational::new(30, 1)).is_err());
    assert!(audio_sample_range(&(0..1), vv_core::Rational::new(0, 1)).is_err());
    assert!(
        audio_sample_range(
            &(i64::MAX - 1..i64::MAX),
            vv_core::Rational::new(1, i32::MAX)
        )
        .is_err()
    );
}

#[test]
fn audio_range_places_interleaved_chunks_by_position_and_retains_silence_in_gaps() {
    let mut samples = Vec::new();
    let range = 10..15;
    copy_audio_window(
        &mut samples,
        2,
        &range,
        8,
        &[1., 2., 3., 4., 5., 6., 7., 8.],
    )
    .unwrap();
    copy_audio_window(&mut samples, 2, &range, 14, &[9., 10., 11., 12.]).unwrap();
    assert_eq!(samples, [5., 6., 7., 8., 0., 0., 0., 0., 9., 10.]);
    copy_audio_window(&mut samples, 2, &range, 11, &[13., 14.]).unwrap();
    assert_eq!(samples, [5., 6., 13., 14., 0., 0., 0., 0., 9., 10.]);
    let before = samples.clone();
    copy_audio_window(&mut samples, 2, &range, 100, &[1., 2.]).unwrap();
    assert_eq!(samples, before);
}

#[test]
fn audio_range_refuses_invalid_shapes_and_sample_budgets_before_allocating() {
    for (channels, range, at, chunk) in [
        (0, 0..1, 0, vec![]),
        (2, 0..1, 0, vec![1.]),
        (u16::MAX, 0..48_000, 0, vec![]),
        (1, 0..2_880_001, 0, vec![]),
        (1, 0..1, u64::MAX, vec![1.]),
    ] {
        let mut samples = Vec::new();
        assert!(copy_audio_window(&mut samples, channels, &range, at, &chunk).is_err());
    }
}

fn ranged_audio_samples() -> Vec<f32> {
    (0..96_000)
        .map(|sample| {
            let frequency = if sample < 48_000 { 440. } else { 880. };
            (sample as f32 / 48_000. * frequency * std::f32::consts::TAU).sin() * 0.4
        })
        .collect()
}

#[test]
fn ranged_browser_proxy_crops_video_and_audio_to_the_same_nonzero_source_window() {
    let directory =
        std::env::temp_dir().join(format!("vv-browser-range-av-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let source = directory.join("input.mp4");
    let settings = crate::VideoSettings {
        preset: "ultrafast".into(),
        ..Default::default()
    };
    let mut encoder = crate::Encoder::new(
        &source,
        16,
        16,
        vv_core::Rational::new(25, 1),
        &settings,
        Some((48_000, 1, &crate::AudioSettings::default())),
    )
    .unwrap();
    for index in 0..50 {
        encoder
            .write_video_frame(&crate::encode::solid_i420(
                16,
                16,
                [40 + index * 2, 128, 128],
            ))
            .unwrap();
    }
    encoder
        .write_audio_samples(&ranged_audio_samples())
        .unwrap();
    encoder.finish().unwrap();
    let ready = directory.join("ready");
    std::fs::create_dir_all(&ready).unwrap();
    generate_range(&source, &ready, ProxyQuality::Low, 25..40, |_| true).unwrap();
    let output = ready.join("source.mp4");
    let mut decoder = crate::Decoder::open_software_bounded(&output, 1).unwrap();
    let (index, first) = decoder.next_frame().unwrap().unwrap();
    assert_eq!(index, 0);
    assert!(first.y[0].abs_diff(90) <= 5);
    let mut frames = 1;
    while decoder.next_frame().unwrap().is_some() {
        frames += 1;
    }
    assert_eq!(frames, 15);
    let audio = crate::decode_audio_track(&output, 0).unwrap().unwrap();
    assert_eq!((audio.sample_rate, audio.channels), (48_000, 1));
    assert!((audio.samples.len() as f64 / 48_000. - 0.6).abs() < 0.05);
    let interior = &audio.samples[4800..19_200];
    let rising = interior
        .windows(2)
        .filter(|samples| samples[0] <= 0. && samples[1] > 0.)
        .count();
    assert!(
        (rising as f64 / 0.3 - 880.).abs() < 50.,
        "The cropped audio must come from the second source second"
    );
    let cancelled = directory.join("cancelled");
    std::fs::create_dir_all(&cancelled).unwrap();
    let staging = cancelled.join(format!("source.tmp-{}.mp4", std::process::id()));
    assert!(matches!(
        generate_range(&source, &cancelled, ProxyQuality::Low, 25..40, |_| !staging
            .exists()),
        Err(MediaError::Cancelled)
    ));
    assert!(!cancelled.join("source.mp4").exists());
    assert!(!staging.exists());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn ranged_audio_only_proxy_has_a_bounded_window_and_distinct_cancellation() {
    let directory =
        std::env::temp_dir().join(format!("vv-browser-range-audio-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let source = directory.join("input.wav");
    write_audio_file(
        &source,
        AudioFileFormat::Wav,
        &ranged_audio_samples(),
        48_000,
        1,
    )
    .unwrap();
    let ready = directory.join("ready");
    std::fs::create_dir_all(&ready).unwrap();
    generate_range(&source, &ready, ProxyQuality::Low, 30..45, |_| true).unwrap();
    let meta = crate::probe_media(&ready.join("source.mp4")).unwrap();
    assert!(!meta.has_video && meta.has_audio);
    let audio = crate::decode_audio_track(&ready.join("source.mp4"), 0)
        .unwrap()
        .unwrap();
    assert!((audio.samples.len() as f64 / 48_000. - 0.5).abs() < 0.05);
    let cancelled = directory.join("cancelled");
    std::fs::create_dir_all(&cancelled).unwrap();
    let mut checks = 0;
    assert!(matches!(
        generate_range(&source, &cancelled, ProxyQuality::Low, 30..45, |_| {
            checks += 1;
            checks < 2
        }),
        Err(MediaError::Cancelled)
    ));
    assert!(!cancelled.join("source.mp4").exists());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn a_real_source_over_ten_minutes_produces_only_its_twelve_frame_late_window_without_changing_the_original()
 {
    let directory =
        std::env::temp_dir().join(format!("vv-browser-long-range-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let source = directory.join("input.mp4");
    let settings = crate::VideoSettings {
        preset: "ultrafast".into(),
        ..Default::default()
    };
    let mut encoder = crate::Encoder::new(
        &source,
        16,
        16,
        vv_core::Rational::new(1, 1),
        &settings,
        None,
    )
    .unwrap();
    let early = crate::encode::solid_i420(16, 16, [40, 128, 128]);
    let late = crate::encode::solid_i420(16, 16, [160, 128, 128]);
    for index in 0..601 {
        encoder
            .write_video_frame(if index < 589 { &early } else { &late })
            .unwrap();
    }
    encoder.finish().unwrap();
    assert!(std::fs::metadata(&source).unwrap().len() <= 512 * 1024);
    let before = std::fs::read(&source).unwrap();
    let fingerprint = crate::content_fingerprint(&source).unwrap();
    let meta = crate::probe_media(&source).unwrap();
    assert_eq!(meta.fps, vv_core::Rational::new(1, 1));
    assert!(meta.duration_frames as f64 / meta.fps.as_f64() > 600.);
    let ready = directory.join("ready");
    std::fs::create_dir(&ready).unwrap();
    generate_range(&source, &ready, ProxyQuality::Low, 589..601, |_| true).unwrap();
    let mut decoder = crate::Decoder::open_software_bounded(&ready.join("source.mp4"), 1).unwrap();
    let mut indices = Vec::new();
    while let Some((index, frame)) = decoder.next_frame().unwrap() {
        indices.push(index);
        assert!(
            frame.y[0].abs_diff(160) <= 5,
            "The output must contain the late source frames"
        );
    }
    assert_eq!(indices, (0..12).collect::<Vec<_>>());
    assert_eq!(std::fs::read(&source).unwrap(), before);
    assert_eq!(crate::content_fingerprint(&source).unwrap(), fingerprint);
    assert!(!ready.join("audio.m4a").exists());
    std::fs::remove_dir_all(directory).unwrap();
}

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

fn selected_audio_fixture(root: &Path) -> std::path::PathBuf {
    let video = root.join("video-only.mp4");
    let settings = crate::VideoSettings {
        preset: "ultrafast".into(),
        ..Default::default()
    };
    let mut encoder = crate::Encoder::new(
        &video,
        16,
        16,
        vv_core::Rational::new(24, 1),
        &settings,
        None,
    )
    .unwrap();
    let mut frame = vec![64; 256];
    frame.extend(vec![128; 128]);
    for _ in 0..6 {
        encoder.write_video_frame(&frame).unwrap();
    }
    encoder.finish().unwrap();
    let mut paths = vec![video];
    for (index, rate, channels, frequency) in [
        (0, 44_100u32, 1u16, 440.0f32),
        (1, 48_000u32, 2u16, 880.0f32),
    ] {
        let samples: Vec<_> = (0..rate / 4)
            .flat_map(|sample| {
                let value =
                    (sample as f32 * frequency * std::f32::consts::TAU / rate as f32).sin() * 0.5;
                std::iter::repeat_n(value, usize::from(channels))
            })
            .collect();
        let path = root.join(format!("stream-{index}.wav"));
        write_audio_file(&path, AudioFileFormat::Wav, &samples, rate, channels).unwrap();
        paths.push(path);
    }
    let source = root.join("selected.mkv");
    let mut inputs: Vec<_> = paths
        .iter()
        .map(|path| ffmpeg::format::input(path).unwrap())
        .collect();
    let mut output = ffmpeg::format::output(&source).unwrap();
    for input in &inputs {
        output
            .add_stream(ffmpeg::encoder::find(ffmpeg::codec::Id::None))
            .unwrap()
            .set_parameters(input.stream(0).unwrap().parameters());
    }
    output.write_header().unwrap();
    for (index, input) in inputs.iter_mut().enumerate() {
        let from = input.stream(0).unwrap().time_base();
        let to = output.stream(index).unwrap().time_base();
        for (_, mut packet) in input.packets() {
            packet.rescale_ts(from, to);
            packet.set_stream(index);
            packet.set_position(-1);
            packet.write_interleaved(&mut output).unwrap();
        }
    }
    output.write_trailer().unwrap();
    source
}

#[test]
fn selected_browser_audio_uses_audio_ordinal_and_its_own_format_for_full_and_ranged_proxies() {
    let root = std::env::temp_dir().join(format!(
        "vv-selected-browser-audio-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let source = selected_audio_fixture(&root);
    let original = std::fs::read(&source).unwrap();
    let metadata = crate::probe_media(&source).unwrap();
    assert_eq!(metadata.audio_streams, 2);
    assert!(metadata.has_video);
    for ranged in [false, true] {
        let directory = root.join(if ranged { "ranged" } else { "full" });
        std::fs::create_dir(&directory).unwrap();
        if ranged {
            generate_range_selected(&source, &directory, ProxyQuality::Low, 1..5, 1, |_| true)
                .unwrap();
        } else {
            generate_selected(&source, &directory, ProxyQuality::Low, 1, |_| true).unwrap();
        }
        let result = crate::decode_audio_track(&directory.join("source.mp4"), 0)
            .unwrap()
            .unwrap();
        assert_eq!(result.channels, 2);
        assert_eq!(result.sample_rate, 48_000);
        let channel: Vec<_> = result
            .samples
            .as_chunks::<2>()
            .0
            .iter()
            .map(|frame| frame[0])
            .collect();
        let from = channel.len() / 4;
        let to = channel.len() * 3 / 4;
        let middle = &channel[from..to];
        let positive_crossings = middle
            .windows(2)
            .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
            .count();
        let frequency = positive_crossings as f64 * 48_000.0 / middle.len() as f64;
        assert!(
            (frequency - 880.0).abs() < 70.0,
            "Unexpected selected tone: {frequency}"
        );
    }
    let refused = root.join("refused");
    std::fs::create_dir(&refused).unwrap();
    assert!(generate_selected(&source, &refused, ProxyQuality::Low, 2, |_| true).is_err());
    assert!(
        generate_range_selected(&source, &refused, ProxyQuality::Low, 1..5, 2, |_| true).is_err()
    );
    assert_eq!(std::fs::read_dir(&refused).unwrap().count(), 0);
    assert_eq!(std::fs::read(&source).unwrap(), original);
    let after = crate::probe_media(&source).unwrap();
    assert_eq!(
        (
            after.fps,
            after.duration_frames,
            after.audio_streams,
            after.sample_rate,
            after.channels
        ),
        (
            metadata.fps,
            metadata.duration_frames,
            metadata.audio_streams,
            metadata.sample_rate,
            metadata.channels
        )
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_audio_validation_preserves_silent_video_zero_and_native_legacy_stream_count() {
    let mut meta = vv_core::MediaMeta {
        duration_frames: 24,
        fps: vv_core::Rational::new(24, 1),
        width: 16,
        height: 16,
        has_video: true,
        has_audio: false,
        sample_rate: 0,
        channels: 0,
        audio_streams: 0,
        file: Default::default(),
    };
    assert!(validate_audio_stream(&meta, 0).is_ok());
    assert!(validate_audio_stream(&meta, 1).is_err());
    meta.has_audio = true;
    meta.sample_rate = 48_000;
    meta.channels = 1;
    assert!(validate_audio_stream(&meta, 0).is_ok());
    assert!(validate_audio_stream(&meta, 1).is_err());
    meta.audio_streams = 2;
    assert!(validate_audio_stream(&meta, 1).is_ok());
    assert!(validate_audio_stream(&meta, usize::MAX).is_err());
}
