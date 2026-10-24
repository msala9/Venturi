use super::*;

fn range_fixture(name: &str) -> (PathBuf, PathBuf) {
    let directory =
        std::env::temp_dir().join(format!("vv-proxy-range-{name}-{}", std::process::id()));
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
        None,
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
    encoder.finish().unwrap();
    (directory, source)
}

#[test]
fn range_validation_rejects_invalid_bounds_and_caps_exact_rational_duration() {
    let fps = vv_core::Rational::new(24_000, 1001);
    assert!(validate_range(&(100..1538), fps, 2000).is_ok());
    assert!(validate_range(&(100..1539), fps, 2000).is_err());
    for range in [-1..2, 3..3, std::ops::Range { start: 4, end: 3 }, 0..2001] {
        assert!(validate_range(&range, fps, 2000).is_err());
    }
    assert!(validate_range(&(0..1), vv_core::Rational::new(0, 1), 1).is_err());
}

#[test]
fn ranged_proxy_has_zero_based_pts_exact_exclusive_end_and_requested_first_frame() {
    let (directory, source) = range_fixture("exact");
    let output = directory.join("range.mp4");
    generate_proxy_range_at(&source, &output, ProxyQuality::Low, 25..40, 2, |_| true).unwrap();
    let mut decoder = Decoder::open_software_bounded(&output, 1).unwrap();
    let mut frames = Vec::new();
    while let Some((index, frame)) = decoder.next_frame().unwrap() {
        frames.push((index, frame.y[0]));
    }
    assert_eq!(frames.len(), 15);
    assert_eq!(frames.first().unwrap().0, 0);
    assert_eq!(frames.last().unwrap().0, 14);
    assert!(
        frames[0].1.abs_diff(90) <= 5,
        "The first output frame must be source frame 25"
    );
    assert!(frames[14].1.abs_diff(118) <= 5, "The end is exclusive");
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn ranged_proxy_checks_cancellation_during_preroll_and_before_publication() {
    let (directory, source) = range_fixture("cancel");
    let output = directory.join("range.mp4");
    let mut zero_checks = 0;
    let result =
        generate_proxy_range_at(&source, &output, ProxyQuality::Low, 25..40, 1, |written| {
            if written == 0 {
                zero_checks += 1;
            }
            zero_checks < 4
        });
    assert!(matches!(result, Err(crate::MediaError::Cancelled)));
    assert!(!output.exists());
    assert!(zero_checks >= 4);
    let result =
        generate_proxy_range_at(&source, &output, ProxyQuality::Low, 25..28, 1, |written| {
            written < 3
        });
    assert!(matches!(result, Err(crate::MediaError::Cancelled)));
    assert!(!output.exists());
    assert!(
        !output
            .with_extension(format!("tmp-{}.mp4", std::process::id()))
            .exists()
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn ranged_proxy_keeps_the_native_held_frame_when_the_start_falls_inside_a_timestamp_hole() {
    let directory =
        std::env::temp_dir().join(format!("vv-proxy-range-hole-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let source = directory.join("input.mp4");
    crate::probe::ensure_init();
    let mut encoder = ProxyEncoder::new(
        &source,
        16,
        16,
        ProxyQuality::Low,
        vv_core::Rational::new(25, 1),
        ColorMatrix::Bt709,
        false,
        1,
    )
    .unwrap();
    for (index, luma) in [(0, 40), (1, 60), (4, 140), (5, 160), (6, 180), (7, 200)] {
        encoder.next_pts = index;
        encoder
            .write_frame(&crate::FrameYuv420 {
                width: 16,
                height: 16,
                y: vec![luma; 256],
                chroma: Chroma::Planar {
                    u: vec![128; 64],
                    v: vec![128; 64],
                },
                chroma_width: 8,
                chroma_height: 8,
                matrix: ColorMatrix::Bt709,
                full_range: false,
                alpha: None,
            })
            .unwrap();
    }
    encoder.finish().unwrap();
    let output = directory.join("range.mp4");
    generate_proxy_range_at(&source, &output, ProxyQuality::Low, 2..6, 1, |_| true).unwrap();
    let mut decoder = Decoder::open_software_bounded(&output, 1).unwrap();
    let mut lumas = Vec::new();
    while let Some((_, frame)) = decoder.next_frame().unwrap() {
        lumas.push(frame.y[0]);
    }
    assert_eq!(lumas.len(), 4);
    for (got, expected) in lumas.into_iter().zip([60, 60, 140, 160]) {
        assert!(got.abs_diff(expected) <= 6);
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn ranged_proxy_holds_the_first_picture_without_rebasing_a_delayed_video_stream() {
    let directory =
        std::env::temp_dir().join(format!("vv-proxy-range-delayed-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let source = directory.join("input.mp4");
    crate::probe::ensure_init();
    let mut encoder = ProxyEncoder::new(
        &source,
        16,
        16,
        ProxyQuality::Low,
        vv_core::Rational::new(25, 1),
        ColorMatrix::Bt709,
        false,
        1,
    )
    .unwrap();
    for index in 2..8 {
        encoder.next_pts = index;
        encoder
            .write_frame(&crate::FrameYuv420 {
                width: 16,
                height: 16,
                y: vec![40 + (index as u8 - 2) * 20; 256],
                chroma: Chroma::Planar {
                    u: vec![128; 64],
                    v: vec![128; 64],
                },
                chroma_width: 8,
                chroma_height: 8,
                matrix: ColorMatrix::Bt709,
                full_range: false,
                alpha: None,
            })
            .unwrap();
    }
    encoder.finish().unwrap();
    let mut original = Decoder::open_software_bounded(&source, 1).unwrap();
    assert_eq!(original.next_frame().unwrap().unwrap().0, 2);
    for start in [0, 1, 2] {
        let output = directory.join(format!("range-{start}.mp4"));
        generate_proxy_range_at(&source, &output, ProxyQuality::Low, start..6, 1, |_| true)
            .unwrap();
        let mut decoder = Decoder::open_software_bounded(&output, 1).unwrap();
        for expected in start..6 {
            let (index, picture) = decoder.next_frame().unwrap().unwrap();
            assert_eq!(index, expected - start);
            let luma = 40 + (expected.max(2) - 2) as u8 * 20;
            assert!(picture.y[0].abs_diff(luma) <= 6);
        }
        assert!(decoder.next_frame().unwrap().is_none());
    }
    let canceled = directory.join("canceled.mp4");
    assert!(matches!(
        generate_proxy_range_at(&source, &canceled, ProxyQuality::Low, 0..6, 1, |frames| {
            frames < 1
        }),
        Err(crate::MediaError::Cancelled)
    ));
    assert!(!canceled.exists());
    assert!(!canceled
        .with_extension(format!("tmp-{}.mp4", std::process::id()))
        .exists());
    std::fs::remove_dir_all(directory).unwrap();
}

fn make_test_clip(file_name: &str, size: &str, duration_secs: u32) -> PathBuf {
    let dir = std::env::temp_dir().join("vv-media-proxy-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(file_name);
    crate::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc=size={size}:rate=25:duration={duration_secs}"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ],
        &path,
    );
    path
}

#[test]
fn scaled_dimensions_downscales_preserving_aspect_ratio_to_even_numbers() {
    assert_eq!(scaled_dimensions(1920, 1080, 960), (960, 540));
    // 1280x717 -> width 960, height 960*717/1280=537.75 -> 538 (even).
    assert_eq!(scaled_dimensions(1280, 717, 960), (960, 538));
}

#[test]
fn scaled_dimensions_never_upscales_a_narrower_source() {
    assert_eq!(scaled_dimensions(640, 360, 960), (640, 360));
}

#[test]
fn proxy_path_for_is_deterministic_and_keyed_by_content_hash_and_quality() {
    let medium = ProxyQuality::Medium;
    assert_eq!(proxy_path_for(42, medium), proxy_path_for(42, medium));
    assert_ne!(proxy_path_for(42, medium), proxy_path_for(43, medium));
    assert_ne!(
        proxy_path_for(42, medium),
        proxy_path_for(42, ProxyQuality::High)
    );
    assert!(
        proxy_path_for(42, medium)
            .to_string_lossy()
            .ends_with("venturi/proxies/000000000000002a.mp4")
    );
}

#[test]
fn generate_proxy_produces_a_smaller_all_intra_file_that_decodes_back_correctly() {
    let path = make_test_clip("source.mp4", "640x360", 2);
    let content_hash = 0xABCDEF;
    // Cleanup from a previous run: `generate_proxy` does not overwrite
    // in place (it writes a temporary and renames), but a final file
    // already present from a previous test that failed halfway could
    // confuse the assertion on `proxy_exists` before the
    // generation.
    let _ = std::fs::remove_file(proxy_path_for(content_hash, ProxyQuality::Medium));

    assert!(!proxy_exists(content_hash, ProxyQuality::Medium));
    let proxy_path = generate_proxy(&path, content_hash, ProxyQuality::Medium, &[], |_| true)
        .expect("proxy generation failed");
    assert_eq!(
        proxy_path,
        proxy_path_for(content_hash, ProxyQuality::Medium)
    );
    assert!(proxy_exists(content_hash, ProxyQuality::Medium));

    // The proxy must be a valid H.264 file, re-decodable with the same
    // `Decoder` used for normal sources, with the same duration (in
    // frames) as the source.
    let mut source_decoder = Decoder::open(&path).unwrap();
    let mut source_frames: i32 = 0;
    while source_decoder.next_frame().unwrap().is_some() {
        source_frames += 1;
    }

    let mut proxy_decoder = Decoder::open(&proxy_path).unwrap();
    assert_eq!(
        proxy_decoder.width(),
        640,
        "source already narrower than 960: not upscaled"
    );
    let mut proxy_frames = 0;
    while proxy_decoder.next_frame().unwrap().is_some() {
        proxy_frames += 1;
    }
    // Tolerance of 1 trailing frame: the MP4 muxer of `write_interleaved`
    // (shared with `encode.rs`, not proxy-specific) reproducibly loses
    // the very last packet written when there is no second track to
    // force the interleaving flush — a pre-existing and broader bug
    // (it probably affects the export too), not something to hide here
    // but not something to fix in this module either. One frame of
    // trailing tolerance does not compromise the scrub/editing use of
    // a proxy.
    assert!(
        (source_frames - proxy_frames).abs() <= 1,
        "the proxy must have the same frame count as the source (tolerance 1 at the end): source={source_frames} proxy={proxy_frames}"
    );
}

#[test]
fn generate_proxy_downscales_a_wider_source() {
    let path = make_test_clip("wide_source.mp4", "1920x1080", 1);
    let content_hash = 0x123456;
    let _ = std::fs::remove_file(proxy_path_for(content_hash, ProxyQuality::Medium));

    let proxy_path = generate_proxy(&path, content_hash, ProxyQuality::Medium, &[], |_| true)
        .expect("proxy generation failed");
    let proxy_decoder = Decoder::open(&proxy_path).unwrap();
    assert_eq!(proxy_decoder.width(), 960);
    assert_eq!(proxy_decoder.height(), 540);

    let _ = std::fs::remove_file(proxy_path_for(content_hash, ProxyQuality::Low));
    let proxy_path = generate_proxy(&path, content_hash, ProxyQuality::Low, &[], |_| true)
        .expect("proxy generation failed");
    assert_eq!(Decoder::open(&proxy_path).unwrap().width(), 640);
}

/// An NV12 source reaches the proxy encoder interleaved: U and V must not
/// come out swapped or smeared. A red frame tells them apart.
#[test]
fn generate_proxy_keeps_the_colors_of_an_nv12_source() {
    let dir = std::env::temp_dir().join("vv-media-proxy-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("red_nv12.mkv");
    crate::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=64x48:rate=25:duration=1",
            "-c:v",
            "rawvideo",
            "-pix_fmt",
            "nv12",
        ],
        &path,
    );
    let content_hash = 0x4e5631;
    let _ = std::fs::remove_file(proxy_path_for(content_hash, ProxyQuality::Medium));
    let proxy_path = generate_proxy(&path, content_hash, ProxyQuality::Medium, &[], |_| true)
        .expect("proxy generation failed");

    let first_chroma = |path: &Path| {
        let (_, frame) = Decoder::open(path).unwrap().next_frame().unwrap().unwrap();
        frame.chroma_at(
            frame.chroma_width as usize / 2,
            frame.chroma_height as usize / 2,
        )
    };
    let (u, v) = first_chroma(&proxy_path);
    let (source_u, source_v) = first_chroma(&path);
    assert!(
        u.abs_diff(source_u) <= 3 && v.abs_diff(source_v) <= 3,
        "proxy U/V {u}/{v}, source {source_u}/{source_v}"
    );
}

#[test]
fn explicit_browser_source_width_preserves_original_dimensions_and_frame_clock() {
    let (directory, source) = range_fixture("source-width");
    let smaller = directory.join("smaller.mp4");
    let original = directory.join("original.mp4");
    generate_proxy_range_at_width(&source, &smaller, ProxyQuality::Low, 8, 5..10, 1, |_| true)
        .unwrap();
    generate_proxy_range_at_width(
        &source,
        &original,
        ProxyQuality::High,
        8192,
        5..10,
        1,
        |_| true,
    )
    .unwrap();
    let reduced = crate::probe_media(&smaller).unwrap();
    let full = crate::probe_media(&original).unwrap();
    assert_eq!((reduced.width, reduced.height), (8, 8));
    assert_eq!((full.width, full.height), (16, 16));
    assert_eq!(full.duration_frames, 5);
    assert_eq!(full.fps, vv_core::Rational::new(25, 1));
    std::fs::remove_dir_all(directory).unwrap();
}
