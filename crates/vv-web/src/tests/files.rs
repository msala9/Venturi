use super::*;
fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "vv-web-test-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
#[test]
fn atomic_persistence_and_path_boundary() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let project = Project::default();
    files.save(&project, "test.vvproj", true).unwrap();
    assert!(files.save(&project, "test.vvproj", true).is_err());
    files.save(&project, "test.vvproj", false).unwrap();
    assert!(root.join("test.vvproj.bak").exists());
    assert!(files.load("test.vvproj").is_ok());
    assert!(files.load("../test.vvproj").is_err());
    let external = root.with_extension("outside");
    std::fs::write(&external, b"sentinel").unwrap();
    std::os::unix::fs::symlink(&external, root.join("link.vvproj")).unwrap();
    assert!(files.load("link.vvproj").is_err());
    assert!(files.save(&project, "link.vvproj", false).is_err());
    assert_eq!(std::fs::read(&external).unwrap(), b"sentinel");
    std::fs::remove_file(external).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_probe_accepts_media_without_reading_symlink_targets() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let media = root.join("sample clip.mp4");
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x64:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-c:a",
            "aac",
        ])
        .arg(&media)
        .status()
        .unwrap();
    assert!(status.success());
    let (_, meta) = files.probe("sample clip.mp4").unwrap();
    assert!(meta.has_video && meta.has_audio);
    assert_eq!(meta.fps, vv_core::Rational::new(24, 1));
    std::os::unix::fs::symlink(&media, root.join("link.mp4")).unwrap();
    assert!(files.probe("link.mp4").is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn project_validation_refuses_compound_cycles_and_missing_nested_timelines() {
    let mut session = vv_session::Session::default();
    let id = session.create_timeline(vv_core::Timeline {
        name: "Cycle".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let media = session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(id))
        .unwrap()
        .0;
    assert!(validate_project(&session.project).is_ok());
    let clip = vv_core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        vv_core::ClipSource::Media(media),
        0,
        24,
        0,
        vv_core::Rational::one(),
    );
    session.project.timelines[id].tracks[0].insert_sorted(clip);
    assert!(validate_project(&session.project).is_err());
    session.project.timelines.remove(id);
    assert!(validate_project(&session.project).is_err());
}

#[test]
fn compound_nesting_stops_at_the_native_render_limit() {
    let mut session = vv_session::Session::default();
    let mut previous = None;
    for depth in 1..=vv_core::MAX_COMPOUND_DEPTH + 1 {
        let id = session.create_timeline(vv_core::Timeline {
            name: format!("Depth {depth}"),
            fps: vv_core::Rational::new(24, 1),
            resolution: (640, 360),
            tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        });
        if let Some(parent) = previous {
            let media = session
                .project
                .media_pool
                .iter()
                .find(|(_, m)| m.compound == Some(id))
                .unwrap()
                .0;
            let clip = vv_core::Clip::from_source_range(
                session.project.alloc_clip_id(),
                vv_core::ClipSource::Media(media),
                0,
                24,
                0,
                vv_core::Rational::one(),
            );
            session.project.timelines[parent].tracks[0].insert_sorted(clip);
        }
        assert_eq!(
            validate_project(&session.project).is_ok(),
            depth <= vv_core::MAX_COMPOUND_DEPTH
        );
        previous = Some(id);
    }
}

#[test]
fn otio_roundtrip_keeps_native_effects_rates_and_refuses_file_escapes() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let mut session = vv_session::Session::default();
    let id = session.create_timeline(vv_core::Timeline {
        name: "OTIO exact".into(),
        fps: vv_core::Rational::new(24000, 1001),
        resolution: (640, 360),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let clip = session.project.alloc_clip_id();
    let mut source = vv_core::Clip::from_source_range(
        clip,
        vv_core::ClipSource::SolidColor,
        0,
        48,
        12,
        vv_core::Rational::one(),
    );
    source.effects.masks.push(vv_core::ClipMask::new(
        vv_core::MaskShape::Ellipse,
        (640, 360),
    ));
    source
        .effects
        .filters
        .push(vv_core::ClipFilter::new(vv_core::FilterKind::Exposure));
    source.effects.filters[0].amount.default = 1.25;
    source.effects.color = Some(vv_core::Keyframed::constant(vv_core::Rgba::BLACK));
    session.project.timelines[id].tracks[0].insert_sorted(source.clone());
    let value = vv_core::otio::timeline_to_otio(&session.project, id, None);
    std::fs::write(
        root.join("roundtrip.otio"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert_eq!(
        files.list().unwrap()["importable_otio"][0]["path_token"],
        "roundtrip.otio"
    );
    let (project, warnings) = files.import_otio("roundtrip.otio").unwrap();
    assert!(warnings.is_empty());
    let timeline = project
        .timelines
        .values()
        .find(|t| t.name == "OTIO exact")
        .unwrap();
    assert_eq!(timeline.fps, vv_core::Rational::new(24000, 1001));
    let restored = &timeline.tracks[0].clips[0];
    assert_eq!((restored.timeline_start, restored.timeline_len), (12, 48));
    assert_eq!(
        serde_json::to_value(&restored.effects).unwrap(),
        serde_json::to_value(&source.effects).unwrap()
    );
    assert!(files.import_otio("../roundtrip.otio").is_err());
    std::os::unix::fs::symlink(root.join("roundtrip.otio"), root.join("link.otio")).unwrap();
    assert!(files.import_otio("link.otio").is_err());
    let mut hostile = value;
    hostile["tracks"]["children"][0]["children"][1]["media_references"]["DEFAULT_MEDIA"] = json!({"OTIO_SCHEMA":"ExternalReference.1","target_url":"file:///etc/shadow","available_range":{"start_time":{"OTIO_SCHEMA":"RationalTime.1","value":0,"rate":24},"duration":{"OTIO_SCHEMA":"RationalTime.1","value":48,"rate":24}}});
    hostile["tracks"]["children"][0]["children"][1]["metadata"] = json!({});
    std::fs::write(
        root.join("escape.otio"),
        serde_json::to_vec(&hostile).unwrap(),
    )
    .unwrap();
    assert!(files.import_otio("escape.otio").is_err());
    std::fs::remove_dir_all(root).unwrap();
}
