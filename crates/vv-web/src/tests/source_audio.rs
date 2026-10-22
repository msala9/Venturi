use super::*;
use vv_audio::mixer::{mix_range, remix_channels_into};

fn meta(count: u16) -> MediaMeta {
    MediaMeta {
        duration_frames: 48,
        fps: Rational::new(24, 1),
        width: 16,
        height: 16,
        has_video: true,
        has_audio: count > 0,
        sample_rate: 48_000,
        channels: 1,
        audio_streams: count,
        file: Default::default(),
    }
}

#[test]
fn source_mix_explicit_modes_match_native_audio_ordinals_and_bound_aggregate_allocations() {
    let metadata = meta(2);
    assert_eq!(
        selection(&metadata, AudioMode::Selected, 1).unwrap(),
        vec![1]
    );
    assert_eq!(selection(&metadata, AudioMode::All, 0).unwrap(), vec![0, 1]);
    assert!(selection(&metadata, AudioMode::All, 1).is_err());
    assert!(selection(&metadata, AudioMode::Selected, 2).is_err());
    assert!(selection(&meta(0), AudioMode::All, 0).unwrap().is_empty());
    let mut legacy = meta(0);
    legacy.has_audio = true;
    assert_eq!(selection(&legacy, AudioMode::All, 0).unwrap(), vec![0]);
    let bounds = sample_bounds(1..2, Rational::new(30000, 1001)).unwrap();
    assert_eq!(bounds, 1602..3203);
    assert!(working_bytes(2, &bounds).unwrap() > working_bytes(1, &bounds).unwrap());
    assert!(working_bytes(usize::MAX, &bounds).is_err());
    assert!(working_bytes(0, &bounds).is_err());
    assert!(working_bytes(2, &(0..600 * 48_000)).is_err());
    assert!(sample_bounds(0..14_401, Rational::new(24, 1)).is_err());
    assert!(sample_bounds(0..1, Rational::new(0, 1)).is_err());
    assert!(sample_bounds(i64::MAX - 1..i64::MAX, Rational::new(1, i32::MAX)).is_err());
}

#[test]
fn source_all_stream_pcm_matches_original_native_source_mixer_with_offsets_and_channel_remap() {
    let bounds = 4..8;
    let mut mono = Vec::new();
    remix_channels_into(&[0.25, 0.5, -0.5, 0.75], 1, 2, &mut mono);
    let mut stereo = vec![0.0; 8];
    place(
        &mut stereo,
        &bounds,
        2,
        &[
            9., 9., 8., 8., 0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4, 7., 7.,
        ],
    )
    .unwrap();
    let mut surround = Vec::new();
    remix_channels_into(
        &[0.3, 0.6, 0.9, 1.2, 1.5, 1.8].repeat(4),
        6,
        2,
        &mut surround,
    );
    let windows = vec![mono.clone(), stereo.clone(), surround.clone()];
    let mut clips = Vec::new();
    for window in &windows {
        let mut whole = vec![0.0; bounds.start as usize * 2];
        whole.extend_from_slice(window);
        clips.push(MixClip {
            clip: ClipId(0),
            start: 0,
            len: bounds.end,
            source_offset: 0,
            step: 1.0,
            input: ClipInput::Blocks(SampleBlocks::contiguous(Arc::new(whole), 0, 2)),
            gain_db: Keyframed::constant(0.0),
            track: 0,
            clip_fps: 24.0,
            media_offset: 0,
            media_step: 1.0,
            fade_in: 0,
            fade_out: 0,
        });
    }
    let snapshot = MixSnapshot::new(48_000, 2, clips, Vec::new(), Channel::UNITY);
    let mut native = vec![0.0; 8];
    mix_range(&snapshot, bounds.start, &mut native);
    let all = mix(windows, bounds.clone(), Rational::new(24, 1), || true).unwrap();
    assert_eq!(all, native);
    assert!(
        all.iter().any(|sample| *sample > 1.0),
        "Native Source does not divide by stream count or add a limiter"
    );
    let selected = mix(vec![mono], bounds.clone(), Rational::new(24, 1), || true).unwrap();
    assert_ne!(selected, all);
    assert!(mix(vec![stereo], bounds, Rational::new(24, 1), || false).is_err());
}

#[test]
fn source_mix_decodes_real_cpu_audio_at_nonzero_absolute_samples_and_cancel_never_publishes_pcm() {
    let root = std::env::temp_dir().join(format!(
        "vv-source-mix-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let input = root.join("mono.wav");
    let samples: Vec<f32> = (0..9600)
        .map(|index| (index as f32 * 0.07).sin() * 0.4)
        .collect();
    vv_media::audio_file::write_audio_file(
        &input,
        vv_media::audio_file::AudioFileFormat::Wav,
        &samples,
        48_000,
        1,
    )
    .unwrap();
    let original = std::fs::read(&input).unwrap();
    let bounds = 2400..7200;
    let mut expected = Vec::new();
    remix_channels_into(&samples[2400..7200], 1, 2, &mut expected);
    let decoded = render(&input, &[0], bounds.clone(), Rational::new(24, 1), || true).unwrap();
    assert_eq!(decoded, expected);
    assert!(
        render(
            &input,
            &[0, 1],
            bounds.clone(),
            Rational::new(24, 1),
            || true
        )
        .is_err()
    );
    assert!(
        render(
            &input,
            &[0, 0],
            bounds.clone(),
            Rational::new(24, 1),
            || true
        )
        .is_err()
    );
    assert!(matches!(
        render(&input, &[0], bounds, Rational::new(24, 1), || false),
        Err(MediaError::Cancelled)
    ));
    assert_eq!(std::fs::read(&input).unwrap(), original);
    std::fs::remove_dir_all(root).unwrap();
}
