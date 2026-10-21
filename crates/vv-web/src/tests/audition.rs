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
    project.timelines[timeline].tracks[0].muted = true;
    let silence = pin(snapshot(project), &files)
        .unwrap()
        .run(Arc::new(AtomicBool::new(false)))
        .unwrap();
    assert!(silence[44..].iter().all(|b| *b == 0));
    assert!(task.run(Arc::new(AtomicBool::new(true))).is_err());
    std::fs::write(&path, b"changed").unwrap();
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
