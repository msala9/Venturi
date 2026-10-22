use super::*;
use vv_core::{Clip, ClipSource, MediaMeta, Rational, Timeline, Track, TrackKind};

fn timeline(name: &str) -> Timeline {
    Timeline {
        name: name.into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    }
}
fn file(session: &mut Session, path: &str) -> MediaId {
    session.add_media(
        path.into(),
        MediaMeta {
            duration_frames: 48,
            fps: Rational::new(24, 1),
            width: 640,
            height: 360,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
    )
}
fn entities(project: &Project) -> serde_json::Value {
    serde_json::json!({"timelines":project.timelines.iter().collect::<Vec<_>>(),"media":project.media_pool.iter().collect::<Vec<_>>(),"folders":project.folders.iter().collect::<Vec<_>>()})
}
fn imported() -> (Project, TimelineId, TimelineId) {
    let mut session = Session::default();
    let media = file(&mut session, "/incoming/shared.mp4");
    let child = session.create_timeline(timeline("Nested"));
    let clip = session.project.alloc_clip_id();
    session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            clip,
            ClipSource::Media(media),
            0,
            24,
            0,
            Rational::one(),
        ));
    session.sync_timeline_media(child);
    let wrapper = session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let parent = session.project.timelines.insert(timeline("Original top"));
    let clip = session.project.alloc_clip_id();
    session.project.timelines[parent].tracks[0]
        .clips
        .push(Clip::from_source_range(
            clip,
            ClipSource::Media(wrapper),
            0,
            24,
            0,
            Rational::one(),
        ));
    assert!(
        session
            .project
            .media_pool
            .values()
            .all(|item| item.compound != Some(parent))
    );
    assert!(
        session
            .project
            .media_pool
            .values()
            .any(|item| item.compound == Some(child))
    );
    (session.project, parent, child)
}

#[test]
fn merge_otio_untitled_dirty_project_preserves_nested_names_and_native_reuse_one_undo() {
    for reuse in [false, true] {
        let mut session = Session::default();
        let existing = file(&mut session, "/existing/shared.mp4");
        let old = session.create_timeline(timeline("Existing dirty"));
        let before = session.project.clone();
        let generation = session.history.generation();
        let (project, _, _) = imported();
        let report = prepare(&session.project, project, "Imported", reuse)
            .unwrap()
            .apply(&mut session);
        assert_eq!(session.history.generation(), generation + 1);
        assert!(session.path().is_none());
        assert_eq!(report.timelines.len(), 1);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[old]).unwrap(),
            serde_json::to_value(&before.timelines[old]).unwrap()
        );
        assert_eq!(
            session.project.timelines[report.timelines[0]].name,
            "Imported"
        );
        let nested = session
            .project
            .timelines
            .iter()
            .find(|(_, timeline)| timeline.name == "Nested")
            .unwrap()
            .0;
        let source = &session.project.timelines[nested].tracks[0].clips[0].source;
        assert_eq!(
            matches!(source,ClipSource::Media(id) if *id==existing),
            reuse
        );
        let folder = report.folder.unwrap();
        assert_eq!(session.project.folders[folder].name, "Imported");
        assert!(
            report
                .media
                .iter()
                .all(|id| session.project.media_pool.contains_key(*id))
        );
        let after = session.project.clone();
        session.history.undo(&mut session.project);
        assert_eq!(entities(&session.project), entities(&before));
        session.history.redo(&mut session.project);
        assert_eq!(entities(&session.project), entities(&after));
    }
}

#[test]
fn merge_otio_multiple_top_levels_rename_only_roots_and_do_not_reuse_compounds() {
    let mut current = Session::default();
    current.create_timeline(timeline("Nested"));
    let (mut project, _, _) = imported();
    project.timelines.insert(timeline("Second"));
    let report = prepare(&current.project, project, "Batch", true)
        .unwrap()
        .apply(&mut current);
    assert_eq!(report.timelines.len(), 2);
    let names: Vec<_> = report
        .timelines
        .iter()
        .map(|id| current.project.timelines[*id].name.as_str())
        .collect();
    assert_eq!(names, vec!["Batch - Original top", "Batch - Second"]);
    assert_eq!(
        current
            .project
            .timelines
            .values()
            .filter(|timeline| timeline.name == "Nested")
            .count(),
        2
    );
}

#[test]
fn merge_otio_rejected_trial_preserves_real_ids_and_dirty_data() {
    let mut current = Session::default();
    current.create_timeline(timeline("Existing"));
    let before = ron::to_string(&current.project).unwrap();
    let (mut project, _, child) = imported();
    project.timelines[child].tracks[0].clips[0].timeline_len = 0;
    assert!(prepare(&current.project, project, "Imported", false).is_err());
    assert_eq!(ron::to_string(&current.project).unwrap(), before);
    let (mut project, _, _) = imported();
    for _ in 0..62 {
        project.timelines.insert(timeline("More"));
    }
    assert!(prepare(&current.project, project, "Imported", false).is_err());
    assert_eq!(ron::to_string(&current.project).unwrap(), before);
    assert!(prepare(&current.project, Project::default(), "Imported", false).is_err());
    let (project, _, _) = imported();
    assert!(prepare(&current.project, project, "bad\nname", false).is_err());
    assert_eq!(ron::to_string(&current.project).unwrap(), before);
}
