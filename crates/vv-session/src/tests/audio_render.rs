use super::*;
use vv_audio::mixer::ClipInput;
use vv_audio::mixer::{mix_range, timeline_frame_to_sample};
use vv_core::{
    AudioEffect, AudioEffectKind, Clip, ClipId, ClipSource, Equalizer, MediaId, MediaItem,
    MediaMeta, MultibandCompressor, NormalizeMode, Rational, SetLevel, Track, TrackKind,
};

const FPS: u64 = 25;
const FRAME_SAMPLES: u64 = PROJECT_SAMPLE_RATE as u64 / FPS;

fn source(name: &str, args: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join("vv-audio-render-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    vv_media::test_support::ffmpeg(args, &path);
    path
}

fn chirp(name: &str, rate: u32, secs: u32) -> PathBuf {
    let lavfi = format!("aevalsrc=0.8*sin(300*t*t):sample_rate={rate}:duration={secs}");
    source(name, &["-f", "lavfi", "-i", &lavfi])
}

fn media(project: &mut Project, path: PathBuf, sample_rate: u32, audio_streams: u16) -> MediaId {
    project.media_pool.insert(MediaItem {
        path,
        meta: MediaMeta {
            duration_frames: 10_000,
            fps: Rational::new(FPS as i32, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate,
            channels: 1,
            audio_streams,
            file: Default::default(),
        },
        content_hash: 1,
        compound: None,
        folder: None,
    })
}

fn clip(id: u64, media: MediaId, source_in: u64, len: u64, start: u64) -> Clip {
    Clip::from_source_range(
        ClipId(id),
        ClipSource::Media(media),
        source_in as i64,
        (source_in + len) as i64,
        start as i64,
        Rational::one(),
    )
}

fn timeline(tracks: Vec<Track>) -> Timeline {
    Timeline {
        name: "t".into(),
        fps: Rational::new(FPS as i32, 1),
        resolution: (4, 2),
        tracks,
        markers: Vec::new(),
        master: Default::default(),
    }
}

fn audio_track(clips: Vec<Clip>) -> Track {
    Track {
        clips,
        ..Track::new(TrackKind::Audio)
    }
}

fn samples(frames: std::ops::Range<u64>) -> Range<u64> {
    frames.start * FRAME_SAMPLES..frames.end * FRAME_SAMPLES
}

fn decoded_whole(path: &Path, stream: usize) -> Option<SampleBlocks> {
    let mut samples = Vec::new();
    let formats = vv_media::decode_audio_streams_streaming(
        path,
        &[stream],
        Some(PROJECT_SAMPLE_RATE),
        |_, channels, chunk| {
            remix_channels_into(chunk, channels, PROJECT_CHANNELS, &mut samples);
            ControlFlow::Continue(())
        },
    )
    .ok()?;
    formats[0]?;
    Some(SampleBlocks::contiguous(
        Arc::new(samples),
        0,
        PROJECT_CHANNELS,
    ))
}

/// The mix of `range` in one call, every file decoded whole from its start
/// and every level measured whole from them.
fn mixed_whole(project: &Project, tl: &Timeline, range: Range<u64>) -> Vec<f32> {
    let snapshot = MixSnapshot::from_timeline(
        project,
        tl,
        PROJECT_SAMPLE_RATE,
        PROJECT_CHANNELS,
        &mut decoded_whole,
    );
    let mut out = vec![0.0; (range.end - range.start) as usize * PROJECT_CHANNELS as usize];
    mix_range(&snapshot, range.start, &mut out);
    out
}

fn rendered(project: &Project, tl: &Timeline, range: Range<u64>) -> Vec<f32> {
    let mut out = Vec::new();
    render_offline(project, tl, range, &mut LevelCache::default(), |chunk| {
        out.extend_from_slice(chunk);
        ControlFlow::Continue(())
    })
    .unwrap();
    out
}

fn effect(kind: AudioEffectKind) -> AudioEffect {
    AudioEffect::new(kind)
}

fn boosting_eq() -> Equalizer {
    let mut eq = Equalizer::DEFAULT;
    eq.bands[2].gain_db = 6.0;
    eq
}

struct OriginAudioFile(PathBuf);

impl Drop for OriginAudioFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn origin_audio_file() -> OriginAudioFile {
    let frames = PROJECT_SAMPLE_RATE as usize;
    let bytes = (frames * 2) as u32;
    let mut wav = Vec::with_capacity(bytes as usize + 44);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + bytes).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&PROJECT_SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(PROJECT_SAMPLE_RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&bytes.to_le_bytes());
    for frame in 0..frames {
        let gain = if frame % 5000 < 3000 { 0.35 } else { 0.06 };
        let sample = gain * ((frame as f32 * 0.071).sin() + 0.4 * (frame as f32 * 0.317).sin());
        wav.extend_from_slice(&((sample * i16::MAX as f32) as i16).to_le_bytes());
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "vv-origin-audio-{}-{nonce}.wav",
        std::process::id()
    ));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .unwrap()
        .write_all(&wav)
        .unwrap();
    OriginAudioFile(path)
}

fn origin_rendered(project: &Project, tl: &Timeline, range: Range<u64>, origin: u64) -> Vec<f32> {
    let mut out = Vec::new();
    render_offline_from_origin(
        project,
        tl,
        range,
        origin,
        &mut LevelCache {
            threads: 1,
            ..Default::default()
        },
        |chunk| {
            out.extend_from_slice(chunk);
            ControlFlow::Continue(())
        },
    )
    .unwrap();
    out
}

#[test]
fn web_audio_origin_windows_match_whole_native_eq_compressor_and_normalization() {
    let file = origin_audio_file();
    let mut project = Project::default();
    let id = media(&mut project, file.0.clone(), PROJECT_SAMPLE_RATE, 1);
    project.media_pool[id].meta.duration_frames = 25;
    for chain in [
        vec![effect(AudioEffectKind::Equalizer(boosting_eq()))],
        vec![effect(AudioEffectKind::MultibandCompressor(
            MultibandCompressor::DEFAULT,
        ))],
        vec![
            effect(AudioEffectKind::Equalizer(boosting_eq())),
            normalize(NormalizeMode::SamplePeak),
        ],
    ] {
        let mut track = audio_track(vec![clip(1, id, 0, 25, 0)]);
        track.mix.effects = chain;
        let tl = timeline(vec![track]);
        let (origin, split, end) = (FRAME_SAMPLES, 7 * FRAME_SAMPLES, 20 * FRAME_SAMPLES);
        let whole = rendered(&project, &tl, origin..end);
        let mut joined = origin_rendered(&project, &tl, origin..split, origin);
        joined.extend(origin_rendered(&project, &tl, split..end, origin));
        assert_eq!(joined, whole);
        let cold = rendered(&project, &tl, split..end);
        assert!(
            cold.iter()
                .zip(&whole[((split - origin) * 2) as usize..])
                .any(|(a, b)| (a - b).abs() > 1e-7)
        );
    }
}

#[test]
fn web_audio_telemetry_observes_the_encoded_origin_pcm_with_continuous_dsp_across_native_source_chunks()
 {
    let file = origin_audio_file();
    let mut project = Project::default();
    let id = media(&mut project, file.0.clone(), PROJECT_SAMPLE_RATE, 1);
    project.media_pool[id].meta.duration_frames = 25;
    for normalize_output in [false, true] {
        let mut active = audio_track(vec![clip(1, id, 0, 25, 0), clip(2, id, 0, 25, 130)]);
        active.mix.effects = vec![
            effect(AudioEffectKind::Equalizer(boosting_eq())),
            effect(AudioEffectKind::MultibandCompressor(
                MultibandCompressor::DEFAULT,
            )),
        ];
        let mut silent = audio_track(vec![clip(3, id, 0, 25, 0)]);
        silent.muted = true;
        let mut tl = timeline(vec![active, silent]);
        if normalize_output {
            tl.master.effects.push(normalize(NormalizeMode::SamplePeak));
        }
        let origin = FRAME_SAMPLES;
        let range = origin + 1234..origin + CHUNK_FRAMES + 25000;
        let expected = origin_rendered(&project, &tl, range.clone(), origin);
        let mut bins = Vec::new();
        let mut observed = Vec::new();
        let mut peak = 0.0_f32;
        let mut observer = |hop: Range<u64>, pcm: &[f32], snapshot: &MixSnapshot| {
            assert!(hop.end <= range.end);
            assert!(hop.end - hop.start <= OBSERVER_FRAMES);
            if let Some(previous) = bins.last() {
                assert_eq!(*previous, hop.start);
            }
            bins.push(hop.end);
            let master = snapshot.meters.master().take();
            let expected_l = pcm
                .as_chunks::<2>()
                .0
                .iter()
                .fold(0.0_f32, |peak, frame| peak.max(frame[0].abs()));
            let expected_r = pcm
                .as_chunks::<2>()
                .0
                .iter()
                .fold(0.0_f32, |peak, frame| peak.max(frame[1].abs()));
            assert_eq!(master, (expected_l, expected_r));
            peak = peak.max(master.0);
            assert_eq!(snapshot.meters.track(1).unwrap().take(), (0.0, 0.0));
            let tap = snapshot
                .meters
                .spectrum(vv_core::MixerChannel::Track(0), 0)
                .unwrap();
            assert!(tap.written() > 0);
            assert_eq!(tap.read().0.len(), vv_audio::spectrum::SPECTRUM_SIZE);
            assert!(
                snapshot
                    .meters
                    .band_meter(vv_core::MixerChannel::Track(0), 1)
                    .is_some()
            );
        };
        render_offline_observed(
            &project,
            &tl,
            range.clone(),
            origin,
            &mut LevelCache::default(),
            &mut observer,
            |pcm| {
                observed.extend_from_slice(pcm);
                ControlFlow::Continue(())
            },
        )
        .unwrap();
        assert_eq!(
            observed, expected,
            "Meter hops must leave every encoded PCM sample unchanged"
        );
        assert!(bins.len() > 64);
        assert!(peak > 0.01);
    }
}

#[test]
fn web_audio_telemetry_prefix_peaks_do_not_leak_into_visible_bins_and_observer_cancellation_is_shared()
 {
    let file = origin_audio_file();
    let mut project = Project::default();
    let id = media(&mut project, file.0.clone(), PROJECT_SAMPLE_RATE, 1);
    let tl = timeline(vec![audio_track(vec![clip(1, id, 0, 1, 0)])]);
    let mut seen = Vec::new();
    let mut output = Vec::new();
    render_offline_observed(
        &project,
        &tl,
        OBSERVER_FRAMES * 2..OBSERVER_FRAMES * 4,
        0,
        &mut LevelCache::default(),
        &mut |range, _, snapshot| {
            let peak = snapshot.meters.master().take();
            if range.end > OBSERVER_FRAMES * 2 {
                assert_eq!(
                    peak,
                    (0.0, 0.0),
                    "A loud prefix is not part of these silent output bins"
                );
                seen.push(range);
            }
        },
        |pcm| {
            output.extend_from_slice(pcm);
            ControlFlow::Continue(())
        },
    )
    .unwrap();
    assert_eq!(
        seen,
        vec![
            OBSERVER_FRAMES * 2..OBSERVER_FRAMES * 3,
            OBSERVER_FRAMES * 3..OBSERVER_FRAMES * 4
        ]
    );
    assert!(output.iter().all(|sample| *sample == 0.0));
    let cancel = Arc::new(AtomicBool::new(false));
    let mut cache = LevelCache::default();
    cache.cancel = Some(cancel.clone());
    let mut published = 0;
    let mut reads = 0;
    let result = render_offline_observed(
        &project,
        &tl,
        0..OBSERVER_FRAMES * 3,
        0,
        &mut cache,
        &mut |_, _, _| {
            reads += 1;
            cancel.store(true, Ordering::Relaxed);
        },
        |pcm| {
            published += pcm.len();
            ControlFlow::Continue(())
        },
    );
    assert_eq!(result, Err(ExportError::Cancelled));
    assert_eq!(reads, 1);
    assert_eq!(published, 0);
}

#[test]
fn web_audio_origin_nested_fractional_windows_use_absolute_native_sample_boundaries() {
    let file = origin_audio_file();
    let mut project = Project::default();
    let id = media(&mut project, file.0.clone(), PROJECT_SAMPLE_RATE, 1);
    project.media_pool[id].meta.duration_frames = 25;
    let mut child = audio_track(vec![clip(1, id, 0, 25, 0)]);
    child.mix.effects = vec![effect(AudioEffectKind::MultibandCompressor(
        MultibandCompressor::DEFAULT,
    ))];
    let nested = project.timelines.insert(timeline(vec![child]));
    let compound = project.media_pool.insert(MediaItem {
        compound: Some(nested),
        ..project.media_pool[id].clone()
    });
    let mut tl = timeline(vec![audio_track(vec![clip(2, compound, 0, 25, 0)])]);
    tl.fps = Rational::new(30000, 1001);
    tl.master.effects = vec![
        effect(AudioEffectKind::Equalizer(boosting_eq())),
        normalize(NormalizeMode::SamplePeak),
    ];
    let sample = |frame| timeline_frame_to_sample(frame, tl.fps.as_f64(), PROJECT_SAMPLE_RATE);
    let (origin, split, end) = (sample(3), sample(11), sample(20));
    let whole = rendered(&project, &tl, origin..end);
    let mut joined = origin_rendered(&project, &tl, origin..split, origin);
    joined.extend(origin_rendered(&project, &tl, split..end, origin));
    assert_eq!(joined.len(), ((end - origin) * 2) as usize);
    assert_eq!(joined, whole);
}

#[test]
fn web_audio_origin_prefix_is_cancellable_and_never_sent_to_the_output_sink() {
    let project = Project::default();
    let tl = timeline(vec![]);
    let cancel = Arc::new(AtomicBool::new(true));
    let mut levels = LevelCache {
        cancel: Some(cancel.clone()),
        threads: 1,
        ..Default::default()
    };
    let mut written = 0;
    let result = render_offline_from_origin(
        &project,
        &tl,
        CHUNK_FRAMES..3 * CHUNK_FRAMES,
        0,
        &mut levels,
        |chunk| {
            written += chunk.len();
            ControlFlow::Continue(())
        },
    );
    assert_eq!(result, Err(ExportError::Cancelled));
    assert_eq!(written, 0);
    cancel.store(false, Ordering::Relaxed);
    let result = render_offline_from_origin(
        &project,
        &tl,
        CHUNK_FRAMES + 7..3 * CHUNK_FRAMES,
        0,
        &mut levels,
        |chunk| {
            written += chunk.len();
            cancel.store(true, Ordering::Relaxed);
            ControlFlow::Continue(())
        },
    );
    assert_eq!(result, Err(ExportError::Cancelled));
    assert_eq!(written, ((CHUNK_FRAMES - 7) * 2) as usize);
    assert!(
        render_offline_from_origin(
            &project,
            &tl,
            10..20,
            11,
            &mut LevelCache::default(),
            |_| ControlFlow::Continue(())
        )
        .is_err()
    );
}

/// Several chunks, through a compressor and an equalizer whose state must
/// carry from one chunk to the next, over a seekable file used twice, a
/// resampled one at varispeed and a pitch-corrected clip.
#[test]
fn a_render_in_chunks_equals_one_mix_of_the_whole_timeline() {
    let mut project = Project::default();
    let seekable = media(&mut project, chirp("seekable.wav", 48_000, 20), 48_000, 1);
    let resampled = media(&mut project, chirp("resampled.wav", 44_100, 20), 44_100, 1);
    let mut first = audio_track(vec![
        clip(1, seekable, 10, 300, 0),
        clip(2, seekable, 50, 120, 320),
    ]);
    first.mix.effects = vec![
        effect(AudioEffectKind::MultibandCompressor(
            MultibandCompressor::DEFAULT,
        )),
        effect(AudioEffectKind::Equalizer(boosting_eq())),
    ];
    let varispeed = Clip::new(
        ClipId(3),
        ClipSource::Media(resampled),
        0,
        40,
        200,
        Rational::one(),
        Rational::new(3, 2),
    );
    let mut stretched = clip(4, resampled, 100, 100, 260);
    stretched.set_speed(Rational::new(5, 4), Rational::one());
    stretched.pitch_correction = true;
    let tl = timeline(vec![first, audio_track(vec![varispeed, stretched])]);

    let range = samples(0..480);
    assert!(range.end - range.start > 3 * CHUNK_FRAMES);
    let whole = mixed_whole(&project, &tl, range.clone());
    let chunked = rendered(&project, &tl, range);
    assert_eq!(chunked.len(), whole.len());
    let first_diff = chunked.iter().zip(&whole).position(|(a, b)| a != b);
    assert_eq!(first_diff, None, "the chunked render differs");
    assert!(chunked.iter().any(|s| s.abs() > 0.1));
    let mut metered = Vec::new();
    let mut chunks = 0;
    render_offline_metered(
        &project,
        &tl,
        samples(0..480),
        &mut LevelCache::default(),
        |pcm, snapshot| {
            chunks += 1;
            metered.extend_from_slice(pcm);
            assert!(snapshot.meters.master().take().0 > 0.0);
            assert!(snapshot.meters.track(0).unwrap().take().0 > 0.0);
            assert!(
                snapshot
                    .meters
                    .spectrum(vv_core::MixerChannel::Track(0), 1)
                    .unwrap()
                    .written()
                    > 0
            );
            ControlFlow::Continue(())
        },
    )
    .unwrap();
    assert!(chunks > 3);
    assert_eq!(
        metered, chunked,
        "Meter taps must not alter native PCM or effect continuity"
    );
}

#[test]
fn a_range_reads_only_the_windows_near_it() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("near.wav", 48_000, 20), 48_000, 1);
    let tl = timeline(vec![audio_track(vec![clip(1, file, 0, 500, 0)])]);
    let mut wanted = Wanted {
        windows: HashSet::new(),
    };
    let range = samples(100..110);
    MixSnapshot::from_timeline_range(
        &project,
        &tl,
        PROJECT_SAMPLE_RATE,
        PROJECT_CHANNELS,
        &mut wanted,
        range.clone(),
    );
    assert_eq!(wanted.windows.len(), 1);
    let (_, _, frames) = wanted.windows.iter().next().unwrap();
    assert!(
        frames.start >= range.start && frames.end < range.end + PROJECT_SAMPLE_RATE as u64,
        "{frames:?}"
    );
}

/// The point of the render: what it holds does not grow with the timeline.
#[test]
fn the_render_holds_only_the_audio_near_where_it_is() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("long.wav", 48_000, 60), 48_000, 1);
    let tl = timeline(vec![audio_track(vec![clip(1, file, 0, 1500, 0)])]);
    let mut cache = LevelCache::default();
    let mut audio = StreamingAudio::new(&mut cache);
    let end = samples(0..1500).end;
    let bound = (2 * CHUNK_FRAMES + READ_AHEAD_FRAMES) as usize * PROJECT_CHANNELS as usize;
    let mut at = 0;
    while at < end {
        let chunk = at..(at + CHUNK_FRAMES).min(end);
        audio
            .snapshot(&project, Mix::Timeline(&tl), chunk.clone(), false)
            .unwrap();
        // The windows share the readers' blocks.
        let held: usize = audio
            .readers
            .iter()
            .flat_map(|r| &r.kept)
            .map(|kept| kept.blocks.iter().map(|b| b.len()).sum::<usize>() + kept.filling.len())
            .sum();
        assert!(held <= bound, "{held} samples held at {chunk:?}");
        assert!(audio.readers.len() <= 1);
        at = chunk.end;
    }
}

#[test]
fn the_streams_of_a_file_read_at_the_same_place_share_one_decode() {
    let path = source(
        "two_streams.mkv",
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=660:sample_rate=48000:duration=12",
            "-map",
            "0",
            "-map",
            "1",
            "-c:a",
            "pcm_s16le",
        ],
    );
    let mut project = Project::default();
    let file = media(&mut project, path, 48_000, 2);
    let mut second = clip(2, file, 0, 300, 0);
    second.audio_stream_index = 1;
    let tl = timeline(vec![
        audio_track(vec![clip(1, file, 0, 300, 0)]),
        audio_track(vec![second]),
    ]);
    let mut cache = LevelCache::default();
    let mut audio = StreamingAudio::new(&mut cache);
    audio
        .snapshot(&project, Mix::Timeline(&tl), 0..CHUNK_FRAMES, false)
        .unwrap();
    assert_eq!(audio.readers.len(), 1);
    assert_eq!(audio.readers[0].streams, [0, 1]);

    let range = samples(0..300);
    assert_eq!(
        rendered(&project, &tl, range.clone()),
        mixed_whole(&project, &tl, range)
    );
}

#[test]
fn a_stream_the_file_does_not_have_is_silent() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("one_stream.wav", 48_000, 2), 48_000, 1);
    let mut missing = clip(1, file, 0, 50, 0);
    missing.audio_stream_index = 3;
    let tl = timeline(vec![audio_track(vec![missing])]);
    let mixed = rendered(&project, &tl, samples(0..50));
    assert!(mixed.iter().all(|s| *s == 0.0));
}

#[test]
fn a_break_from_the_sink_stops_the_render() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("stop.wav", 48_000, 20), 48_000, 1);
    let tl = timeline(vec![audio_track(vec![clip(1, file, 0, 500, 0)])]);
    let mut chunks = 0;
    render_offline(
        &project,
        &tl,
        samples(0..500),
        &mut LevelCache::default(),
        |_| {
            chunks += 1;
            ControlFlow::Break(())
        },
    )
    .unwrap();
    assert_eq!(chunks, 1);
}

#[test]
fn a_range_starting_inside_the_timeline_is_that_part_of_the_mix() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("part.wav", 48_000, 20), 48_000, 1);
    let mut track = audio_track(vec![clip(1, file, 0, 500, 0)]);
    track.mix.effects = vec![effect(AudioEffectKind::Equalizer(boosting_eq()))];
    let tl = timeline(vec![track]);
    let start = timeline_frame_to_sample(237, FPS as f64, PROJECT_SAMPLE_RATE);
    let range = start..samples(0..480).end;
    assert_eq!(
        rendered(&project, &tl, range.clone()),
        mixed_whole(&project, &tl, range)
    );
}

/// Each chunk is a new snapshot: the compound's own compressor carries on
/// across them like the outer ones.
#[test]
fn a_compound_rendered_in_chunks_equals_one_mix() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("nested.wav", 48_000, 20), 48_000, 1);
    let mut nested_track = audio_track(vec![clip(1, file, 0, 400, 0)]);
    nested_track.mix.effects = vec![effect(AudioEffectKind::MultibandCompressor(
        MultibandCompressor::DEFAULT,
    ))];
    let nested = project.timelines.insert(timeline(vec![nested_track]));
    let compound = project.media_pool.insert(MediaItem {
        compound: Some(nested),
        ..project.media_pool[file].clone()
    });
    let mut varispeed = Clip::new(
        ClipId(2),
        ClipSource::Media(compound),
        0,
        200,
        150,
        Rational::one(),
        Rational::new(3, 2),
    );
    varispeed.pitch_correction = false;
    let tl = timeline(vec![
        audio_track(vec![clip(1, compound, 0, 300, 10)]),
        audio_track(vec![varispeed]),
    ]);
    let range = samples(0..400);
    let whole = mixed_whole(&project, &tl, range.clone());
    assert_eq!(rendered(&project, &tl, range), whole);
    assert!(whole.iter().any(|s| s.abs() > 0.1));
}

/// Every level asked for, measured by segment through `cache` and whole
/// from the decoded files.
struct BothMeasures<'c> {
    cache: &'c mut LevelCache,
    /// By segments, whole.
    levels: Vec<(f32, f32)>,
}

impl AudioSource for BothMeasures<'_> {
    fn file(&mut self, path: &Path, stream: usize) -> ClipAudio {
        decoded_whole(path, stream).map_or(ClipAudio::Missing, ClipAudio::Ready)
    }

    fn level(&mut self, analysis: LevelAnalysis) -> LevelReading {
        let by_segment = measure_level(&analysis, self.cache).unwrap();
        let whole = analysis.measure_with(&mut decoded_whole);
        self.levels.push((by_segment, whole));
        LevelReading::Ready(whole)
    }
}

fn both_measures(project: &Project, tl: &Timeline, cache: &mut LevelCache) -> Vec<(f32, f32)> {
    let mut source = BothMeasures {
        cache,
        levels: Vec::new(),
    };
    MixSnapshot::from_timeline(
        project,
        tl,
        PROJECT_SAMPLE_RATE,
        PROJECT_CHANNELS,
        &mut source,
    );
    source.levels
}

fn normalize(mode: NormalizeMode) -> AudioEffect {
    effect(AudioEffectKind::Normalize {
        target_db: -1.0,
        mode,
        set_level: SetLevel::Relative,
    })
}

/// Two tracks cut in several places, measured on the master.
fn edited_timeline(project: &mut Project, name: &str) -> Timeline {
    let file = media(project, chirp(name, 48_000, 20), 48_000, 1);
    let quiet = media(
        project,
        chirp(&format!("quiet-{name}"), 44_100, 20),
        44_100,
        1,
    );
    let mut voice = audio_track(vec![
        clip(1, file, 0, 60, 0),
        clip(2, file, 100, 45, 70),
        clip(3, file, 200, 80, 130),
    ]);
    voice.mix.gain_db = -3.0;
    let mut music = audio_track(vec![clip(4, quiet, 0, 150, 40)]);
    music.mix.gain_db = -18.0;
    timeline(vec![voice, music])
}

fn db(a: f32, b: f32) -> f32 {
    20.0 * (a / b).log10()
}

#[test]
fn a_level_measured_by_segment_reads_as_the_whole_measure() {
    let mut project = Project::default();
    let mut tl = edited_timeline(&mut project, "segments.wav");
    for mode in NormalizeMode::ALL {
        tl.master.effects = vec![normalize(mode)];
        let levels = both_measures(&project, &tl, &mut LevelCache::default());
        let [(by_segment, whole)] = levels[..] else {
            panic!("{levels:?}");
        };
        assert!(whole > 0.01);
        let tolerance = if mode == NormalizeMode::SamplePeak {
            1e-6
        } else {
            0.1
        };
        assert!(
            db(by_segment, whole).abs() < tolerance,
            "{mode:?}: {by_segment} vs {whole}"
        );
    }
}

#[test]
fn a_level_after_a_compressor_reads_as_the_whole_measure() {
    let mut project = Project::default();
    let mut tl = edited_timeline(&mut project, "compressed.wav");
    tl.tracks[0].mix.effects = vec![effect(AudioEffectKind::MultibandCompressor(
        MultibandCompressor::DEFAULT,
    ))];
    tl.master.effects = vec![
        effect(AudioEffectKind::Equalizer(boosting_eq())),
        normalize(NormalizeMode::Loudness),
    ];
    let levels = both_measures(&project, &tl, &mut LevelCache::default());
    let [(by_segment, whole)] = levels[..] else {
        panic!("{levels:?}");
    };
    assert!(db(by_segment, whole).abs() < 0.1, "{by_segment} vs {whole}");
}

/// The point of the segments: a ripple measures nothing again, an edit
/// only what it touches.
#[test]
fn an_edit_measures_again_only_the_segments_it_touches() {
    let mut project = Project::default();
    let mut tl = edited_timeline(&mut project, "edits.wav");
    tl.tracks.truncate(1);
    tl.master.effects = vec![normalize(NormalizeMode::Loudness)];
    let mut cache = LevelCache::default();
    both_measures(&project, &tl, &mut cache);
    assert_eq!(cache.rendered, 3, "one segment per clip");

    both_measures(&project, &tl, &mut cache);
    assert_eq!(cache.rendered, 3, "measured already");

    for clip in &mut tl.tracks[0].clips[1..] {
        clip.timeline_start -= 10;
    }
    both_measures(&project, &tl, &mut cache);
    assert_eq!(cache.rendered, 3, "a ripple moves the segments, unchanged");

    tl.tracks[0].clips[1].effects.gain_db = vv_core::Keyframed::constant(-6.0);
    both_measures(&project, &tl, &mut cache);
    assert_eq!(cache.rendered, 4, "only the clip edited");
}

#[test]
fn measured_parts_survive_the_disk() {
    let parts = [
        LevelParts::Peak(0.25),
        LevelParts::Loudness {
            segment_frames: 4800,
            segments: vec![0.5, 1.5, 3.0],
            tail: (0.75, 1200),
        },
    ];
    let sources = [Stamp {
        path: PathBuf::from("/media/voice.wav"),
        len: 1234,
        modified_nanos: 5678,
    }];
    for part in parts {
        let bytes = encode_parts(&sources, &part);
        assert_eq!(decode_parts(&bytes), Some((sources.to_vec(), part)));
        assert_eq!(decode_parts(&bytes[..bytes.len() - 1]), None);
    }
}

/// A normalizing timeline was collected whole until its levels were
/// measured apart.
#[test]
fn a_normalizing_timeline_renders_in_chunks() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("normalized.wav", 48_000, 60), 48_000, 1);
    let mut tl = timeline(vec![audio_track(vec![clip(1, file, 0, 1500, 0)])]);
    tl.master.effects = vec![normalize(NormalizeMode::Loudness)];
    let mut cache = LevelCache::default();
    let mut audio = StreamingAudio::new(&mut cache);
    let snapshot = audio
        .snapshot(&project, Mix::Timeline(&tl), 0..CHUNK_FRAMES, false)
        .unwrap();
    let ClipInput::Blocks(window) = &snapshot.clips[0].input else {
        panic!("a file clip");
    };
    assert!(window.end() < 2 * CHUNK_FRAMES, "{}", window.end());
    assert_eq!(snapshot.master.inserts.len(), 1);
}

/// Reopening a project: the levels measured the last time come from disk.
#[test]
fn a_new_cache_reads_the_measures_from_disk() {
    let dir = std::env::temp_dir().join("vv-audio-render-test-levels");
    let _ = std::fs::remove_dir_all(&dir);
    let on_disk = || LevelCache {
        dir: Some(dir.clone()),
        ..LevelCache::default()
    };
    let mut project = Project::default();
    let mut tl = edited_timeline(&mut project, "reopened.wav");
    tl.master.effects = vec![normalize(NormalizeMode::Loudness)];
    let mut first = on_disk();
    let measured = both_measures(&project, &tl, &mut first);
    assert!(first.rendered > 0);

    let mut reopened = on_disk();
    assert_eq!(both_measures(&project, &tl, &mut reopened), measured);
    assert_eq!(reopened.rendered, 0);
}

/// The project keeps the fingerprint taken at import: the file is checked
/// again when its measure comes from disk.
#[test]
fn a_file_changed_on_disk_is_measured_again() {
    let dir = std::env::temp_dir().join("vv-audio-render-test-changed");
    let _ = std::fs::remove_dir_all(&dir);
    let on_disk = || LevelCache {
        dir: Some(dir.clone()),
        ..LevelCache::default()
    };
    let path = chirp("changed.wav", 48_000, 10);
    let mut project = Project::default();
    let file = media(&mut project, path.clone(), 48_000, 1);
    let mut tl = timeline(vec![audio_track(vec![clip(1, file, 0, 200, 0)])]);
    tl.master.effects = vec![normalize(NormalizeMode::Loudness)];
    let before = both_measures(&project, &tl, &mut on_disk());

    let quieter = "aevalsrc=0.1*sin(300*t*t):sample_rate=48000:duration=10";
    vv_media::test_support::ffmpeg(&["-f", "lavfi", "-i", quieter], &path);
    let mut reopened = on_disk();
    let after = both_measures(&project, &tl, &mut reopened);
    assert!(reopened.rendered > 0);
    assert_eq!(
        after,
        both_measures(&project, &tl, &mut LevelCache::default())
    );
    assert_ne!(after, before);
}

fn segment(frames: Range<u64>) -> LevelSegment {
    LevelSegment {
        frames,
        preroll: 0,
        key: 0,
    }
}

#[test]
fn neighbouring_segments_render_as_one_run_split_between_the_threads() {
    let sec = PROJECT_SAMPLE_RATE as u64;
    let segments = [
        segment(0..10 * sec),
        segment(10 * sec..20 * sec),
        segment(21 * sec..30 * sec),
        segment(30 * sec..40 * sec),
        segment(100 * sec..110 * sec),
    ];
    let refs: Vec<&LevelSegment> = segments.iter().collect();
    let lengths = |threads| -> Vec<usize> { runs(&refs, threads).iter().map(Vec::len).collect() };
    assert_eq!(lengths(1), [4, 1], "a short gap is rendered through");
    assert_eq!(lengths(2), [3, 1, 1], "about half each");
}

#[test]
fn a_level_measured_on_several_threads_reads_as_on_one() {
    let mut project = Project::default();
    let mut tl = edited_timeline(&mut project, "threads.wav");
    tl.master.effects = vec![normalize(NormalizeMode::Loudness)];
    let measure = |threads| {
        let mut cache = LevelCache {
            threads,
            ..LevelCache::default()
        };
        both_measures(&project, &tl, &mut cache)[0].0
    };
    let (one, several) = (measure(1), measure(4));
    assert!(db(one, several).abs() < 0.1, "{one} vs {several}");
}

/// Rendered from the files in chunks and stretched as it goes, it equals the
/// whole input stretched at once, a compound clip with an effect inside
/// included.
#[test]
fn a_pitch_corrected_clip_rendered_in_chunks_equals_its_whole_stretch() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("stretch.wav", 48_000, 20), 48_000, 1);
    let mut nested_track = audio_track(vec![clip(1, file, 0, 300, 0)]);
    nested_track.mix.effects = vec![effect(AudioEffectKind::MultibandCompressor(
        MultibandCompressor::DEFAULT,
    ))];
    let nested = project.timelines.insert(timeline(vec![nested_track]));
    let compound = project.media_pool.insert(MediaItem {
        compound: Some(nested),
        ..project.media_pool[file].clone()
    });
    let stretched = |id, media| {
        let mut clip = Clip::new(
            ClipId(id),
            ClipSource::Media(media),
            0,
            10,
            200,
            Rational::one(),
            Rational::new(5, 4),
        );
        clip.pitch_correction = true;
        clip
    };
    let tl = timeline(vec![
        audio_track(vec![stretched(2, file)]),
        audio_track(vec![stretched(3, compound)]),
    ]);
    let range = samples(0..220);
    assert!(samples(0..250).end > CHUNK_FRAMES, "the input spans chunks");
    let whole = mixed_whole(&project, &tl, range.clone());
    assert_eq!(rendered(&project, &tl, range), whole);
    assert!(whole.iter().any(|s| s.abs() > 0.1));
}

#[test]
fn a_compound_measuring_a_segment_its_parent_claimed_does_not_wait_on_itself() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("self_wait.wav", 48_000, 70), 48_000, 1);
    let chain = || {
        vec![
            effect(AudioEffectKind::MultibandCompressor(
                MultibandCompressor::DEFAULT,
            )),
            normalize(NormalizeMode::Loudness),
        ]
    };
    // The same first clip bare and inside the compound: one segment key.
    let mut nested = timeline(vec![audio_track(vec![
        clip(1, file, 0, 150, 0),
        clip(2, file, 200, 1200, 150),
    ])]);
    nested.master.effects = chain();
    let nested = project.timelines.insert(nested);
    let compound = project.media_pool.insert(MediaItem {
        compound: Some(nested),
        ..project.media_pool[file].clone()
    });
    let mut tl = timeline(vec![audio_track(vec![
        clip(1, file, 0, 150, 0),
        clip(2, compound, 0, 1350, 150),
    ])]);
    tl.master.effects = chain();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cache = LevelCache {
            threads: 8,
            ..LevelCache::default()
        };
        let rendered = render_offline(&project, &tl, samples(0..1500), &mut cache, |_| {
            ControlFlow::Continue(())
        });
        let _ = tx.send(rendered.is_ok());
    });
    let rendered = rx.recv_timeout(std::time::Duration::from_secs(60));
    assert_eq!(rendered, Ok(true), "the render hung or failed");
}

#[test]
fn a_cancelled_render_stops_at_the_next_chunk() {
    let mut project = Project::default();
    let file = media(&mut project, chirp("cancelled.wav", 48_000, 20), 48_000, 1);
    let tl = timeline(vec![audio_track(vec![clip(1, file, 0, 500, 0)])]);
    let cancel = Arc::new(AtomicBool::new(false));
    let mut cache = LevelCache {
        cancel: Some(cancel.clone()),
        ..LevelCache::default()
    };
    let mut chunks = 0;
    let rendered = render_offline(&project, &tl, samples(0..500), &mut cache, |_| {
        chunks += 1;
        cancel.store(true, Ordering::Relaxed);
        ControlFlow::Continue(())
    });
    assert!(matches!(rendered, Err(ExportError::Cancelled)));
    assert_eq!(chunks, 1);
}

#[test]
fn a_decode_thread_gone_without_an_end_fails_the_render() {
    let (tx, decoded) = sync_channel(1);
    drop(tx);
    let mut reader = Reader {
        path: PathBuf::from("gone.wav"),
        streams: vec![0],
        decoded,
        kept: vec![KeptStream {
            first: 0,
            blocks: VecDeque::new(),
            filling: new_block(),
        }],
        ended: false,
        read_from: vec![None],
        used: false,
    };
    assert!(matches!(
        reader.read(0, 0..100),
        Err(ExportError::Failed(_))
    ));
}

#[cfg(target_os = "linux")]
struct PinnedAudioResolver {
    paths: HashMap<PathBuf, PathBuf>,
    reads: std::sync::Mutex<Vec<PathBuf>>,
}

#[cfg(target_os = "linux")]
impl AudioSourceResolver for PinnedAudioResolver {
    fn resolve(&self, original: &Path) -> Result<ResolvedAudioSource, ExportError> {
        use std::os::fd::AsRawFd;
        self.reads.lock().unwrap().push(original.to_path_buf());
        let path = self
            .paths
            .get(original)
            .ok_or_else(|| ExportError::Failed("AUDIO_SOURCE_REFUSED".into()))?;
        let lease = Arc::new(std::fs::File::open(path).map_err(ExportError::failed)?);
        Ok(ResolvedAudioSource {
            path: PathBuf::from(format!("/proc/self/fd/{}", lease.as_raw_fd())),
            lease,
        })
    }
}

#[cfg(target_os = "linux")]
#[test]
fn web_audio_resolver_requested_files_match_native_nested_normalized_and_stretched_pcm() {
    let file = origin_audio_file();
    let approved = PathBuf::from("/approved/virtual-audio.wav");
    let unused = PathBuf::from("/denied/unused.wav");
    for variant in 0..3 {
        let mut project = Project::default();
        let id = media(&mut project, file.0.clone(), PROJECT_SAMPLE_RATE, 1);
        project.media_pool[id].meta.duration_frames = 25;
        media(&mut project, unused.clone(), PROJECT_SAMPLE_RATE, 1);
        let input = if variant == 1 {
            let mut child = audio_track(vec![clip(1, id, 0, 25, 0)]);
            child.mix.effects = vec![effect(AudioEffectKind::Equalizer(boosting_eq()))];
            let mut child = timeline(vec![child]);
            child.master.effects = vec![normalize(NormalizeMode::SamplePeak)];
            let nested = project.timelines.insert(child);
            project.media_pool.insert(MediaItem {
                compound: Some(nested),
                ..project.media_pool[id].clone()
            })
        } else {
            id
        };
        let mut input_clip = clip(2, input, 0, 25, 0);
        if variant == 2 {
            input_clip.set_speed(Rational::new(5, 4), Rational::one());
            input_clip.pitch_correction = true;
        }
        let tl = timeline(vec![audio_track(vec![input_clip])]);
        let expected = rendered(&project, &tl, samples(0..18));
        assert!(expected.iter().any(|sample| sample.abs() > 0.1));
        project.media_pool[id].path = approved.clone();
        let before = serde_json::to_value(&project).unwrap();
        let resolver = Arc::new(PinnedAudioResolver {
            paths: HashMap::from([(approved.clone(), file.0.clone())]),
            reads: Default::default(),
        });
        let mut cache = LevelCache {
            threads: 2,
            ..Default::default()
        };
        cache.set_source_resolver(Some(resolver.clone()));
        let mut actual = Vec::new();
        render_offline(&project, &tl, samples(0..18), &mut cache, |chunk| {
            actual.extend_from_slice(chunk);
            ControlFlow::Continue(())
        })
        .unwrap();
        assert_eq!(actual.len(), expected.len());
        let error = actual
            .iter()
            .zip(&expected)
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0, f32::max);
        assert!(error <= 1e-6, "variant {variant}: {error}");
        let reads = resolver.reads.lock().unwrap();
        assert!(!reads.is_empty());
        assert!(reads.iter().all(|path| path == &approved));
        assert_eq!(serde_json::to_value(&project).unwrap(), before);
    }
}

#[cfg(target_os = "linux")]
#[test]
fn web_audio_resolver_refusal_is_fatal_in_normalize_and_pitch_fallbacks_before_pcm() {
    let file = origin_audio_file();
    let approved = PathBuf::from("/approved/current.wav");
    let denied = PathBuf::from("/denied/later.wav");
    for pitch in [false, true] {
        let mut project = Project::default();
        let first = media(&mut project, approved.clone(), PROJECT_SAMPLE_RATE, 1);
        let later = media(&mut project, denied.clone(), PROJECT_SAMPLE_RATE, 1);
        let mut tl = if pitch {
            let mut input = clip(1, later, 0, 20, 0);
            input.set_speed(Rational::new(5, 4), Rational::one());
            input.pitch_correction = true;
            timeline(vec![audio_track(vec![input])])
        } else {
            let mut tl = timeline(vec![audio_track(vec![
                clip(1, first, 0, 10, 0),
                clip(2, later, 15, 10, 15),
            ])]);
            tl.master.effects = vec![normalize(NormalizeMode::SamplePeak)];
            tl
        };
        tl.name = format!("resolver refusal pitch={pitch}");
        let resolver = Arc::new(PinnedAudioResolver {
            paths: HashMap::from([(approved.clone(), file.0.clone())]),
            reads: Default::default(),
        });
        let mut cache = LevelCache {
            threads: 2,
            ..Default::default()
        };
        cache.set_source_resolver(Some(resolver.clone()));
        let mut published = 0;
        let result = render_offline(&project, &tl, samples(0..8), &mut cache, |chunk| {
            published += chunk.len();
            ControlFlow::Continue(())
        });
        assert_eq!(
            result,
            Err(ExportError::Failed("AUDIO_SOURCE_REFUSED".into()))
        );
        assert_eq!(published, 0, "pitch={pitch}");
        assert!(resolver.reads.lock().unwrap().contains(&denied));
    }
}

#[cfg(target_os = "linux")]
#[test]
fn web_audio_resolver_discards_weak_level_cache_and_shares_failures_with_measure_threads() {
    let file = origin_audio_file();
    let directory = file.0.with_extension("levels");
    std::fs::create_dir(&directory).unwrap();
    let mut cache = LevelCache {
        dir: Some(directory.clone()),
        ..Default::default()
    };
    let weak = cache.path(7).unwrap();
    let bytes = encode_parts(&[], &LevelParts::Peak(0.25));
    std::fs::write(&weak, &bytes).unwrap();
    assert!(matches!(cache.get(7), Some(LevelParts::Peak(0.25))));
    let resolver = Arc::new(PinnedAudioResolver {
        paths: HashMap::new(),
        reads: Default::default(),
    });
    cache.set_source_resolver(Some(resolver));
    assert!(cache.get(7).is_none());
    assert!(cache.path(7).is_none());
    cache.put(9, &LevelParts::Peak(0.5), Some(&[]));
    assert!(matches!(cache.get(9), Some(LevelParts::Peak(0.5))));
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
    assert_eq!(std::fs::read(&weak).unwrap(), bytes);
    let worker = cache.for_thread();
    let result = worker.resolve_source(Path::new("/denied/measure.wav"));
    assert!(
        matches!(result, Err(ExportError::Failed(ref error)) if error == "AUDIO_SOURCE_REFUSED")
    );
    assert_eq!(
        cache.check_sources(),
        Err(ExportError::Failed("AUDIO_SOURCE_REFUSED".into()))
    );
    std::fs::remove_file(weak).unwrap();
    std::fs::remove_dir(directory).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn web_audio_resolver_lease_is_released_by_decoder_thread_after_its_file_use() {
    use std::os::fd::AsRawFd;
    struct Lease {
        file: std::fs::File,
        dropped: std::sync::mpsc::Sender<std::thread::ThreadId>,
    }
    impl Drop for Lease {
        fn drop(&mut self) {
            let _ = self.dropped.send(std::thread::current().id());
        }
    }
    let file = origin_audio_file();
    let (dropped, receiver) = std::sync::mpsc::channel();
    let lease = Arc::new(Lease {
        file: std::fs::File::open(&file.0).unwrap(),
        dropped,
    });
    let source = ResolvedAudioSource {
        path: PathBuf::from(format!("/proc/self/fd/{}", lease.file.as_raw_fd())),
        lease,
    };
    let mut reader = Reader::open(
        PathBuf::from("/virtual/thread.wav"),
        vec![0],
        0,
        Some(source),
    );
    let decoded = reader.read(0, 0..4096).unwrap();
    assert_eq!((decoded.start(), decoded.end()), (0, 4096));
    drop(reader);
    let thread = receiver
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    assert_ne!(thread, std::thread::current().id());
}
