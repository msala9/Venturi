use super::*;
use vv_core::{Clip, ClipId, ClipSource, Rational, Timeline, Track, TrackKind};

#[test]
fn initial_cpu_frame_contention_retries_but_shared_gpu_busy_and_cancel_do_not() {
    let cancel = AtomicBool::new(false);
    let mut calls = 0;
    retry_software_render(&cancel, || {
        calls += 1;
        if calls < 3 {
            Err(ApiError::conflict("RENDER_BUSY", "CPU busy"))
        } else {
            Ok(())
        }
    })
    .unwrap();
    assert_eq!(calls, 3);
    calls = 0;
    let error = retry_software_render(&cancel, || {
        calls += 1;
        Err(ApiError::conflict("GPU_BUSY", "GPU reserved"))
    })
    .unwrap_err();
    assert_eq!(error.1, "GPU_BUSY");
    assert_eq!(calls, 1);
    cancel.store(true, Ordering::Relaxed);
    assert!(retry_software_render(&cancel, || panic!("Canceled work must not start")).is_err());
}

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
        export: None,
    }
}
#[test]
fn program_bounds_and_cache_identity_include_native_revision_and_output_range() {
    let mut task = task();
    assert!(task.validate().is_ok());
    assert_eq!(task.descriptor(Path::new("/tmp"))["width"], 960);
    let before = task.query.key();
    let mut inside = task.query.clone();
    inside.start_frame = 12;
    assert!(task.query.contains(&inside));
    inside.end_frame = 49;
    assert!(!task.query.contains(&inside));
    inside.end_frame = 48;
    inside.width = 640;
    assert!(!task.query.contains(&inside));
    inside.width = 960;
    inside.start_frame = 48;
    assert!(!task.query.contains(&inside));
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

#[test]
fn export_settings_are_native_bounded_and_part_of_the_immutable_job_identity() {
    let mut task = task();
    let preview_key = task.key();
    task.export = Some(ExportOptions {
        quality: 23,
        preset: "medium".into(),
        audio: false,
    });
    assert!(task.validate().is_ok());
    assert_ne!(preview_key, task.key());
    let before = task.key();
    let settings = task.settings(Path::new("/tmp"));
    assert_eq!(settings.video.quality, 23);
    assert_eq!(settings.video.preset, "medium");
    assert!(settings.audio.is_none());
    task.export.as_mut().unwrap().audio = true;
    assert_ne!(before, task.key());
    assert!(task.settings(Path::new("/tmp")).audio.is_some());
    task.export.as_mut().unwrap().quality = 52;
    assert!(task.validate().is_err());
    task.export.as_mut().unwrap().quality = 18;
    task.export.as_mut().unwrap().preset = "unverified-hardware".into();
    assert!(task.validate().is_err());
    task.export = None;
    task.query.start_frame = -1;
    assert!(task.validate().is_err());
}
