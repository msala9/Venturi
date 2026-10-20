use super::*;
use vv_core::{Clip, ClipId, ClipSource, Rational, Timeline, Track, TrackKind};

fn task() -> ProgramTask {
    let mut project = vv_core::Project::default();
    let mut track = Track::new(TrackKind::Video);
    track.insert_sorted(Clip::from_source_range(
        ClipId(1),
        ClipSource::SolidColor,
        0,
        48,
        0,
        Rational::one(),
    ));
    let timeline = project.timelines.insert(Timeline {
        name: "test".into(),
        fps: Rational::new(24, 1),
        resolution: (1920, 1080),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let query = ProgramQuery {
        project_epoch: "p:1".into(),
        if_generation: "0".into(),
        timeline_id: "1".into(),
        revision: "r".into(),
        start_frame: 0,
        end_frame: 48,
        width: 960,
    };
    ProgramTask {
        snapshot: FrameSnapshot {
            project,
            timeline,
            query: query.frame(),
            size: (960, 540),
        },
        query,
        preview: Preview::disabled(),
    }
}
#[test]
fn program_bounds_and_cache_identity_include_native_revision_and_output_range() {
    let mut task = task();
    assert!(task.validate().is_ok());
    assert_eq!(task.descriptor(Path::new("/tmp"))["width"], 960);
    let before = task.query.key();
    task.query.revision = "next".into();
    assert_ne!(before, task.query.key());
    task.query.end_frame = 49;
    assert!(task.validate().is_err());
    task.query.end_frame = i64::MIN;
    assert!(task.validate().is_err());
    task.query.end_frame = 0;
    assert!(task.validate().is_err());
}
#[test]
fn generated_preview_identity_detects_source_replacement_without_timeline_edits() {
    let path = std::env::temp_dir().join(format!("vv-program-input-{}", std::process::id()));
    std::fs::write(&path, b"first").unwrap();
    let inputs = vec![(path.clone(), identity(&path).unwrap())];
    assert!(unchanged(&inputs));
    std::fs::write(&path, b"second version").unwrap();
    assert!(!unchanged(&inputs));
    std::fs::remove_file(path).unwrap();
}
