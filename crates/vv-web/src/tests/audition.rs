use super::*;
use crate::preview::FrameQuery;
use vv_core::{Clip, ClipSource, Id, MediaItem, Rational, Timeline, Track, TrackKind};

#[test]
fn audition_uses_native_mute_gain_and_detects_changed_sources_without_editing_the_project() {
    let root = std::env::temp_dir().join(format!(
        "vv-audition-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    let path = root.join("tone.wav");
    let samples: Vec<_> = (0..48000)
        .map(|i| (i as f32 * std::f32::consts::TAU * 440.0 / 48000.0).sin() * 0.5)
        .collect();
    vv_media::audio_file::write_audio_file(
        &path,
        vv_media::audio_file::AudioFileFormat::Wav,
        &samples,
        48000,
        1,
    )
    .unwrap();
    let (_, meta) = files.probe("tone.wav").unwrap();
    let rate = Rational::conform_rate(Rational::new(24, 1), meta.fps);
    let end = meta.duration_frames;
    let mut project = vv_core::Project::default();
    let media = project.media_pool.insert(MediaItem {
        path: path.clone(),
        meta,
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let mut track = Track::new(TrackKind::Audio);
    let mut clip = Clip::from_source_range(
        project.alloc_clip_id(),
        ClipSource::Media(media),
        0,
        end,
        0,
        rate,
    );
    clip.effects.gain_db.default = -6.0;
    track.insert_sorted(clip);
    let timeline = project.timelines.insert(Timeline {
        name: "Audio".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let snapshot = |project| FrameSnapshot {
        project,
        timeline,
        query: FrameQuery {
            timeline_id: timeline.raw().to_string(),
            project_epoch: "test".into(),
            if_generation: "0".into(),
            revision: "test".into(),
            frame: 3,
            width: 640,
        },
        size: (640, 360),
    };
    let before = serde_json::to_value(&project).unwrap();
    let task = pin(snapshot(project.clone()), &files).unwrap();
    let bytes = task.run(Arc::new(AtomicBool::new(false))).unwrap();
    assert_eq!(bytes.len(), 44 + FRAMES * 4);
    std::fs::write(root.join("audition.wav"), bytes).unwrap();
    let decoded = vv_media::decode_audio_track(&root.join("audition.wav"), 0)
        .unwrap()
        .unwrap();
    assert_eq!(decoded.samples.len(), FRAMES * 2);
    let peak = decoded
        .samples
        .iter()
        .map(|s| s.abs())
        .fold(0.0_f32, f32::max);
    assert!((peak - 0.5 * 10.0_f32.powf(-6.0 / 20.0)).abs() < 0.002);
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
    let readings = task.meters(None, Arc::new(AtomicBool::new(false))).unwrap();
    assert_eq!(readings["samples"], 4096);
    assert_eq!(readings["channels"].as_array().unwrap().len(), 2);
    assert!((readings["channels"][0]["peak"][0].as_f64().unwrap() - f64::from(peak)).abs() < 0.002);
    assert_eq!(
        readings["master_spectrum_db"].as_array().unwrap().len(),
        2049
    );
    assert_eq!(readings["insert"], Value::Null);
    assert_eq!(
        task.meters(None, Arc::new(AtomicBool::new(true)))
            .unwrap_err()
            .1,
        "INVALID_OPERATION"
    );
    assert!(
        task.meters(
            Some(InsertQuery {
                channel: "0".into(),
                index: 0
            }),
            Arc::new(AtomicBool::new(false))
        )
        .is_err()
    );
    let mut with_eq = project.clone();
    let mut eq = vv_core::Equalizer::DEFAULT;
    eq.bands[2].freq_hz = 440.0;
    eq.bands[2].gain_db = -12.0;
    eq.bands[2].enabled = true;
    with_eq.timelines[timeline].tracks[0].mix.effects = vec![
        vv_core::AudioEffect::new(vv_core::AudioEffectKind::Equalizer(eq)),
        vv_core::AudioEffect::new(vv_core::AudioEffectKind::MultibandCompressor(
            vv_core::MultibandCompressor::DEFAULT,
        )),
    ];
    let eq_task = pin(snapshot(with_eq), &files).unwrap();
    let eq_reading = eq_task
        .meters(
            Some(InsertQuery {
                channel: "0".into(),
                index: 0,
            }),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
    let pre = eq_reading["insert"]["before_db"].as_array().unwrap();
    let post = eq_reading["insert"]["after_db"].as_array().unwrap();
    assert_eq!(pre.len(), 2049);
    assert_eq!(post.len(), 2049);
    assert!(
        pre.iter()
            .zip(post)
            .any(|(a, b)| (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() > 1.0)
    );
    let compressor = eq_task
        .meters(
            Some(InsertQuery {
                channel: "0".into(),
                index: 1,
            }),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
    assert_eq!(
        compressor["insert"]["band_level"].as_array().unwrap().len(),
        3
    );
    assert_eq!(
        compressor["insert"]["reduction_db"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
    let source_spec = || crate::source::SourceSpec {
        file: File::open(&path).unwrap(),
        epoch: "test".into(),
        media_id: "1".into(),
        meta: files.probe("tone.wav").unwrap().1,
    };
    assert!(Task::source(source_spec(), -1).is_err());
    let source = Task::source(source_spec(), 3).unwrap();
    let original = source.run(Arc::new(AtomicBool::new(false))).unwrap();
    let peak = original[44..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
        .max()
        .unwrap();
    assert!((i32::from(peak) - 16384).abs() < 3);
    let start = timeline_frame_to_sample(
        3,
        source.snapshot.project.timelines[source.snapshot.timeline]
            .fps
            .as_f64(),
        PROJECT_SAMPLE_RATE,
    );
    for tempo in [2, 4, 8] {
        let window = source
            .window(
                WindowParams {
                    start_sample: start,
                    seconds: 2,
                    tempo,
                    source_version: None,
                    end_sample: None,
                },
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        assert_eq!(window.start, start);
        assert!(window.last);
        let frames = (window.end - start) / u64::from(tempo);
        assert_eq!(window.bytes.len(), 44 + frames as usize * 4);
        let left: Vec<_> = window.bytes[44..]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        let crossings: Vec<_> = (left.len() / 4 + 1..left.len() * 3 / 4)
            .filter(|&i| left[i - 1] <= 0 && left[i] > 0)
            .collect();
        assert!(crossings.len() > 5);
        let frequency = 48000.0 * (crossings.len() - 1) as f64
            / (crossings.last().unwrap() - crossings[0]) as f64;
        assert!(
            (frequency - 440.0).abs() < 8.0,
            "tempo {tempo}: {frequency} Hz"
        );
    }
    let stale = source
        .window(
            WindowParams {
                start_sample: start,
                seconds: 2,
                tempo: 2,
                source_version: Some("0".repeat(64)),
                end_sample: None,
            },
            Arc::new(AtomicBool::new(false)),
        )
        .err()
        .unwrap();
    assert_eq!(stale.1, "SOURCE_CHANGED");
    let limited = source
        .window(
            WindowParams {
                start_sample: start,
                seconds: 2,
                tempo: 2,
                source_version: None,
                end_sample: Some(start + 2400),
            },
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
    assert_eq!(limited.end, start + 2400);
    assert!(limited.last);
    assert_eq!(limited.bytes.len(), 44 + 1200 * 4);
    for end_sample in [start, u64::MAX] {
        assert!(
            source
                .window(
                    WindowParams {
                        start_sample: start,
                        seconds: 2,
                        tempo: 2,
                        source_version: None,
                        end_sample: Some(end_sample)
                    },
                    Arc::new(AtomicBool::new(false))
                )
                .is_err()
        );
    }
    for (start_sample, seconds, tempo) in
        [(0, 2, 2), (start, 1, 2), (start, 2, 1), (u64::MAX, 8, 8)]
    {
        assert!(
            source
                .window(
                    WindowParams {
                        start_sample,
                        seconds,
                        tempo,
                        source_version: None,
                        end_sample: None
                    },
                    Arc::new(AtomicBool::new(false))
                )
                .is_err()
        );
    }
    project.timelines[timeline].tracks[0].muted = true;
    let muted_task = pin(snapshot(project), &files).unwrap();
    let silent_meters = muted_task
        .meters(None, Arc::new(AtomicBool::new(false)))
        .unwrap();
    assert_eq!(silent_meters["channels"][0]["peak"], json!([0.0, 0.0]));
    assert_eq!(silent_meters["channels"][1]["db"], json!([null, null]));
    let silence = muted_task.run(Arc::new(AtomicBool::new(false))).unwrap();
    assert!(silence[44..].iter().all(|b| *b == 0));
    assert!(task.run(Arc::new(AtomicBool::new(true))).is_err());
    std::fs::write(&path, b"changed").unwrap();
    assert_eq!(
        task.meters(None, Arc::new(AtomicBool::new(false)))
            .unwrap_err()
            .1,
        "SOURCE_CHANGED"
    );
    assert_eq!(
        task.run(Arc::new(AtomicBool::new(false))).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(
        source.run(Arc::new(AtomicBool::new(false))).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    drop(source);
    drop(task);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
