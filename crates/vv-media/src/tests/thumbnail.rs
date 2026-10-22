use super::*;

#[test]
fn still_preview_alpha_follows_native_pixel_sampling_without_changing_opaque_thumbnails() {
    let alpha = vec![0, 64, 127, 255, 255, 127, 64, 0];
    let mut frame = FrameYuv420 {
        width: 4,
        height: 2,
        y: vec![90; 8],
        chroma: crate::decode::Chroma::Planar {
            u: vec![128; 2],
            v: vec![128; 2],
        },
        chroma_width: 2,
        chroma_height: 1,
        matrix: ColorMatrix::Bt601,
        full_range: true,
        alpha: Some(alpha.clone()),
    };
    let preview = downscale_to_rgba(&frame, 4, true);
    let thumbnail = downscale_to_rgba(&frame, 4, false);
    assert_eq!((preview.width, preview.height), (4, 2));
    assert_eq!(
        preview
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .map(|pixel| pixel[3])
            .collect::<Vec<_>>(),
        alpha
    );
    for (preview, thumbnail) in preview
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .zip(thumbnail.rgba.as_chunks::<4>().0)
    {
        assert_eq!(&preview[..3], &thumbnail[..3]);
        assert_eq!(thumbnail[3], 255);
    }
    let reduced = downscale_to_rgba(&frame, 2, true);
    assert_eq!((reduced.width, reduced.height), (2, 1));
    assert_eq!(reduced.rgba[3], 0);
    assert_eq!(reduced.rgba[7], 127);
    frame.alpha = None;
    assert!(
        downscale_to_rgba(&frame, 4, true)
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|pixel| pixel[3] == 255)
    );
}

#[test]
fn generate_thumbnail_scales_down_preserving_aspect_ratio() {
    let dir = std::env::temp_dir().join("vv-media-thumbnail-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("red.mp4");
    crate::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=640x360:rate=25:duration=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ],
        &path,
    );

    let thumb = generate_thumbnail(&path, 2.0, 96).unwrap();
    assert_eq!((thumb.width, thumb.height), (96, 54));
    assert_eq!(thumb.rgba.len(), 96 * 54 * 4);
    let center = &thumb.rgba[(27 * 96 + 48) * 4..][..3];
    assert!(
        center[0] > 200 && center[1] < 60 && center[2] < 60,
        "{center:?}"
    );
}

/// A still image passes the `duration_frames`/`fps` sentinel (see
/// `vv_core::IMAGE_DURATION_FRAMES`) as `duration_secs` — huge, but
/// `generate_thumbnail` clamps the seek target to `<= 1.0` anyway, so
/// it works without needing `Decoder::open_image`.
#[test]
fn generate_thumbnail_works_on_a_still_image_despite_the_sentinel_duration() {
    let dir = std::env::temp_dir().join("vv-media-thumbnail-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("red.png");
    crate::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=640x360:rate=1:duration=1",
            "-frames:v",
            "1",
            "-update",
            "1",
        ],
        &path,
    );

    let sentinel_secs = vv_core::IMAGE_DURATION_FRAMES as f64 / crate::probe::IMAGE_FPS.as_f64();
    let thumb = generate_thumbnail(&path, sentinel_secs, 96).unwrap();
    assert_eq!((thumb.width, thumb.height), (96, 54));
    let center = &thumb.rgba[(27 * 96 + 48) * 4..][..3];
    assert!(
        center[0] > 200 && center[1] < 60 && center[2] < 60,
        "{center:?}"
    );
}
