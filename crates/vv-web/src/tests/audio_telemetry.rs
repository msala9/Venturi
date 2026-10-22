use super::*;
use std::sync::Arc;
use vv_audio::{
    SampleBlocks,
    mixer::{
        Bus, Channel, ClipInput, Insert as NativeInsert, MixClip, MixState, mix_range_from,
        mix_range_metered,
    },
};
use vv_core::{AudioEffect, ClipId, Keyframed, Rational, Track};

struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "vv-audio-telemetry-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn fixture(frames: u64) -> (Timeline, MixSnapshot) {
    let mut track = Track::new(TrackKind::Audio);
    track.mix.effects = vec![
        AudioEffect::new(AudioEffectKind::Equalizer(vv_core::Equalizer::DEFAULT)),
        AudioEffect::new(AudioEffectKind::MultibandCompressor(
            vv_core::MultibandCompressor::DEFAULT,
        )),
    ];
    let timeline = Timeline {
        name: "Native telemetry".into(),
        fps: Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![
            Track::new(TrackKind::Video),
            track,
            Track::new(TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    };
    let samples: Vec<_> = (0..frames)
        .flat_map(|frame| {
            let value = (frame as f32 * std::f32::consts::TAU * 937.5 / 48000.0).sin() * 0.4;
            [value, value * 0.5]
        })
        .collect();
    let clip = MixClip {
        clip: ClipId(1),
        start: 0,
        len: frames,
        source_offset: 0,
        step: 1.0,
        input: ClipInput::Blocks(SampleBlocks::contiguous(Arc::new(samples), 0, 2)),
        gain_db: Keyframed::constant(0.0),
        track: 1,
        clip_fps: 24.0,
        media_offset: 0,
        media_step: 1.0,
        fade_in: 0,
        fade_out: 0,
    };
    let channel = Channel {
        inserts: vec![
            NativeInsert::Eq(vv_core::Equalizer::DEFAULT),
            NativeInsert::Compressor(vv_core::MultibandCompressor::DEFAULT),
        ],
        bus: Bus::UNITY,
    };
    let snapshot = MixSnapshot::new(
        PROJECT_SAMPLE_RATE,
        2,
        vec![clip],
        vec![Channel::UNITY, channel, Channel::UNITY],
        Channel::UNITY,
    );
    (timeline, snapshot)
}

#[test]
fn program_audio_telemetry_records_native_peaks_spectra_and_ordinal_pages_without_changing_pcm() {
    let root = Root::new();
    let end = BIN * 2 + 99;
    let (timeline, snapshot) = fixture(end);
    let mut recorder = Recorder::new(&root.0, &timeline, 1234..end).unwrap();
    let mut state = MixState::new(&snapshot);
    let mut pcm = Vec::new();
    let mut expected = Vec::new();
    for start in (0..end).step_by(BIN as usize) {
        let stop = (start + BIN).min(end);
        let mut samples = vec![0.0; (stop - start) as usize * 2];
        mix_range_metered(&snapshot, &mut state, start, &mut samples);
        let peak = [
            samples
                .as_chunks::<2>()
                .0
                .iter()
                .fold(0.0_f32, |peak, frame| peak.max(frame[0].abs())),
            samples
                .as_chunks::<2>()
                .0
                .iter()
                .fold(0.0_f32, |peak, frame| peak.max(frame[1].abs())),
        ];
        let spectral = compact(&magnitudes_db(
            &snapshot
                .meters
                .spectrum(MixerChannel::Track(1), 1)
                .unwrap()
                .read()
                .1,
        ));
        expected.push((peak, spectral));
        recorder.observe(start..stop, &samples, &snapshot);
        pcm.extend(samples);
    }
    let mut reference = vec![0.0; end as usize * 2];
    mix_range_from(&snapshot, &mut MixState::new(&snapshot), 0, &mut reference);
    assert_eq!(pcm, reference);
    recorder.finish().unwrap();
    let info = descriptor(&root.0).unwrap();
    assert_eq!(info["state"], "available");
    assert_eq!(info["start_sample"], 1234);
    assert_eq!(info["first_bin_sample"], 0);
    assert_eq!(info["bin_count"], 3);
    assert_eq!(info["spectrum_hz"].as_array().unwrap().len(), 128);
    let insert = crate::audition::InsertQuery {
        channel: "1".into(),
        index: 1,
    };
    let first = read(&root.0, 0, 2, Some(&insert)).unwrap();
    assert_eq!(first["next_bin"], 2);
    for (index, bin) in first["bins"].as_array().unwrap().iter().enumerate() {
        assert_eq!(bin["channels"][2]["channel"], "master");
        assert_eq!(bin["channels"][2]["peak"], json!(expected[index].0));
        assert_eq!(bin["channels"][1]["peak"], json!([0.0, 0.0]));
        assert_eq!(bin["insert"]["kind"], "MultibandCompressor");
        assert_eq!(bin["insert"]["after_db"], json!(expected[index].1));
        assert_eq!(bin["insert"]["inactive"], false);
    }
    let last = read(&root.0, 2, 2, None).unwrap();
    assert!(last["next_bin"].is_null());
    assert_eq!(last["bins"][0]["end_sample"], end);
    assert!(read(&root.0, 0, 65, None).is_err());
    assert!(read(&root.0, 4, 1, None).is_err());
    assert!(
        read(
            &root.0,
            0,
            1,
            Some(&crate::audition::InsertQuery {
                channel: "1".into(),
                index: 31
            })
        )
        .is_err()
    );
}

#[test]
fn program_audio_telemetry_warms_master_prefix_without_publishing_it_and_keeps_peaks_when_inserts_exceed_budget()
 {
    let root = Root::new();
    let end = BIN * 2 + 137;
    let (timeline, snapshot) = fixture(end);
    let mut recorder = Recorder::new(&root.0, &timeline, BIN * 2 + 50..end).unwrap();
    let mut state = MixState::new(&snapshot);
    let tap = SpectrumTap::default();
    for start in (0..end).step_by(BIN as usize) {
        let stop = (start + BIN).min(end);
        let mut samples = vec![0.0; (stop - start) as usize * 2];
        mix_range_metered(&snapshot, &mut state, start, &mut samples);
        tap.record_post(&samples, 2);
        recorder.observe(start..stop, &samples, &snapshot);
    }
    recorder.finish().unwrap();
    let output = read(&root.0, 0, 1, None).unwrap();
    assert_eq!(output["bin_count"], 1);
    assert_eq!(output["bins"][0]["start_sample"], BIN * 2);
    assert_eq!(
        output["bins"][0]["master_spectrum_db"],
        json!(compact(&magnitudes_db(&tap.read().1)))
    );
    let root = Root::new();
    let mut many = timeline.clone();
    many.tracks[1].mix.effects = (0..5)
        .map(|_| AudioEffect::new(AudioEffectKind::Equalizer(vv_core::Equalizer::DEFAULT)))
        .collect();
    let mut recorder = Recorder::new(&root.0, &many, 0..BIN).unwrap();
    let mut samples = vec![0.0; BIN as usize * 2];
    mix_range_metered(&snapshot, &mut MixState::new(&snapshot), 0, &mut samples);
    recorder.observe(0..BIN, &samples, &snapshot);
    recorder.finish().unwrap();
    let output = read(
        &root.0,
        0,
        1,
        Some(&crate::audition::InsertQuery {
            channel: "1".into(),
            index: 0,
        }),
    )
    .unwrap();
    assert_eq!(output["state"], "available");
    assert_eq!(output["inserts_available"], false);
    assert!(output["inserts_error"].is_string());
    assert!(output["bins"][0]["insert"].is_null());
    assert!(
        output["bins"][0]["channels"][2]["peak"][0]
            .as_f64()
            .unwrap()
            > 0.01
    );
}

#[test]
fn program_audio_telemetry_absent_insert_taps_remain_explicitly_inactive_and_partial_or_canceled_writers_never_publish_available_data()
 {
    let root = Root::new();
    let (timeline, _) = fixture(BIN);
    let snapshot = MixSnapshot::empty(PROJECT_SAMPLE_RATE, 2);
    let mut recorder = Recorder::new(&root.0, &timeline, 0..BIN).unwrap();
    recorder.observe(0..BIN, &vec![0.0; BIN as usize * 2], &snapshot);
    recorder.finish().unwrap();
    let output = read(
        &root.0,
        0,
        1,
        Some(&crate::audition::InsertQuery {
            channel: "1".into(),
            index: 0,
        }),
    )
    .unwrap();
    assert_eq!(output["state"], "available");
    assert_eq!(output["bins"][0]["insert"]["inactive"], true);
    let root = Root::new();
    {
        let _recorder = Recorder::new(&root.0, &timeline, 0..BIN).unwrap();
    }
    assert!(std::fs::read_dir(&root.0).unwrap().next().is_none());
    let root = Root::new();
    let mut recorder = Recorder::new(&root.0, &timeline, 0..BIN * 2).unwrap();
    recorder.observe(0..BIN, &vec![0.0; BIN as usize * 2], &snapshot);
    recorder.finish().unwrap();
    assert_eq!(descriptor(&root.0).unwrap()["state"], "unavailable");
    assert!(!root.0.join(BINARY).exists());
    assert!(read(&root.0, 0, 1, None).is_err());
}

#[test]
fn program_audio_telemetry_refuses_symlinked_changed_or_locked_files_and_never_overwrites_foreign_sidecars()
 {
    let root = Root::new();
    let (timeline, snapshot) = fixture(BIN);
    let mut recorder = Recorder::new(&root.0, &timeline, 0..BIN).unwrap();
    let mut samples = vec![0.0; BIN as usize * 2];
    mix_range_metered(&snapshot, &mut MixState::new(&snapshot), 0, &mut samples);
    recorder.observe(0..BIN, &samples, &snapshot);
    recorder.finish().unwrap();
    let baseline = std::fs::read(root.0.join(BINARY)).unwrap();
    let dir = directory(&root.0).unwrap();
    let locked = open(&dir, BINARY, false).unwrap();
    rustix::fs::flock(&locked, FlockOperation::NonBlockingLockExclusive).unwrap();
    assert!(read(&root.0, 0, 1, None).is_err());
    drop(locked);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(root.0.join(BINARY))
        .unwrap();
    let identity = crate::source::file_identity(&file).unwrap();
    let modified = file.metadata().unwrap().modified().unwrap();
    file.write_all_at(&0_u64.to_le_bytes(), 0).unwrap();
    file.set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(crate::source::file_identity(&file).unwrap(), identity);
    drop(file);
    assert!(
        read(&root.0, 0, 1, None).is_err(),
        "ctime detects in-place writes even with restored mtime"
    );
    let root = Root::new();
    std::fs::write(root.0.join(BINARY), b"foreign").unwrap();
    let mut recorder = Recorder::new(&root.0, &timeline, 0..BIN).unwrap();
    recorder.observe(0..BIN, &samples, &snapshot);
    assert!(recorder.finish().is_err());
    assert_eq!(std::fs::read(root.0.join(BINARY)).unwrap(), b"foreign");
    let root = Root::new();
    let target = root.0.join("target");
    std::fs::write(&target, baseline).unwrap();
    std::os::unix::fs::symlink(&target, root.0.join(MANIFEST)).unwrap();
    assert!(descriptor(&root.0).is_err());
    assert!(!root.0.join(BINARY_TEMP).exists());
}
