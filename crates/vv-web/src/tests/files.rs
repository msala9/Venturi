use super::*;

#[test]
fn approved_nested_sources_open_and_reopen_offline_without_broadening_project_file_names() {
    let root = root();
    let files = Files::new(&root).unwrap();
    std::fs::create_dir_all(root.join("approved/nested")).unwrap();
    let source = root.join("approved/nested/clip.mp4");
    std::fs::write(&source, b"not probed").unwrap();
    assert_eq!(
        root_media_token(&root, &source).unwrap(),
        "approved/nested/clip.mp4"
    );
    assert!(files.media_file(&source).is_ok());
    let query = SourcesQuery {
        project_epoch: "e".into(),
        directory_token: "approved".into(),
        page: 0,
    };
    let response = files.source_browser(&query).unwrap();
    assert_eq!(
        response["entries"],
        json!([{"kind":"directory","name":"nested","path_token":"approved/nested"}])
    );
    let mut project = Project::default();
    let media = project.media_pool.insert(vv_core::MediaItem {
        path: PathBuf::from("approved/nested/clip.mp4"),
        meta: vv_core::MediaMeta {
            duration_frames: 48,
            fps: vv_core::Rational::new(24, 1),
            width: 16,
            height: 16,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 123,
        compound: None,
        folder: None,
    });
    assert!(
        files
            .save(&project, "approved/project.vvproj", true)
            .is_err()
    );
    assert!(files.load("approved/project.vvproj").is_err());
    assert!(
        files
            .media_import_tokens(&["approved/nested/clip.mp4".into()])
            .is_err(),
        "Legacy flat import DTO is unchanged"
    );
    files.save(&project, "nested-sources.vvproj", true).unwrap();
    assert_eq!(
        files.load("nested-sources.vvproj").unwrap().media_pool[media].path,
        source
    );
    std::fs::remove_dir_all(root.join("approved")).unwrap();
    assert_eq!(
        files.load("nested-sources.vvproj").unwrap().media_pool[media].path,
        source
    );
    let outside = root.with_extension("outside");
    std::fs::create_dir_all(outside.join("nested")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("approved")).unwrap();
    assert!(files.load("nested-sources.vvproj").is_err());
    assert!(files.media_file(&source).is_err());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(outside).unwrap();
}

#[test]
fn pasted_image_paths_open_only_the_exact_native_managed_directory_and_regular_file() {
    let root = root();
    let files = Files::new(&root).unwrap();
    std::fs::create_dir(root.join("Pasted Images")).unwrap();
    let path = root.join("Pasted Images/.Native name.png");
    std::fs::write(&path, b"native bytes").unwrap();
    let mut bytes = Vec::new();
    files
        .media_file(&path)
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    assert_eq!(bytes, b"native bytes");
    assert_eq!(
        root_media_token(&root, &path).unwrap(),
        "Pasted Images/.Native name.png"
    );
    for token in [
        "other/file.png",
        "Pasted Images/sub/file.png",
        "Pasted Images/../file.png",
        "Pasted Images/file.mp4",
        "Pasted Images/file.PNG",
        "Pasted Images/..png",
        "Pasted Images/a\\b.png",
    ] {
        assert!(files.media_file(&root.join(token)).is_err(), "{token}");
    }
    let link = root.join("Pasted Images/link.png");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert!(files.media_file(&link).is_err());
    std::fs::create_dir(root.join("Pasted Images/directory.png")).unwrap();
    assert!(
        files
            .media_file(&root.join("Pasted Images/directory.png"))
            .is_err()
    );
    assert!(
        files.list().unwrap()["importable_media"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pasted_image_saved_projects_reopen_and_preserve_missing_managed_images_offline() {
    let root = root();
    let files = Files::new(&root).unwrap();
    std::fs::create_dir(root.join("Pasted Images")).unwrap();
    let path = root.join("Pasted Images/Image 001.png");
    std::fs::write(&path, b"native bytes").unwrap();
    let mut project = Project::default();
    let media = project.media_pool.insert(vv_core::MediaItem {
        path: PathBuf::from("Pasted Images/Image 001.png"),
        meta: vv_core::MediaMeta {
            duration_frames: vv_core::IMAGE_DURATION_FRAMES,
            fps: vv_core::Rational::new(25, 1),
            width: 1,
            height: 1,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 123,
        compound: None,
        folder: None,
    });
    files.save(&project, "images.vvproj", true).unwrap();
    assert_eq!(
        files.load("images.vvproj").unwrap().media_pool[media].path,
        path
    );
    std::fs::remove_dir_all(root.join("Pasted Images")).unwrap();
    let offline = files.load("images.vvproj").unwrap();
    assert_eq!(offline.media_pool[media].path, path);
    assert_eq!(offline.media_pool[media].content_hash, 123);
    assert!(files.media_file(&path).is_err());
    let outside = root.with_extension("outside");
    std::fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("Pasted Images")).unwrap();
    assert!(files.load("images.vvproj").is_err());
    assert!(files.media_file(&path).is_err());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir(outside).unwrap();
}

#[test]
fn reusable_otio_parser_rejects_input_and_url_limits_before_any_native_probe() {
    let root = root();
    std::fs::create_dir_all(&root).unwrap();
    let mut probes = 0;
    let mut probe = |_: &Path| {
        probes += 1;
        Err("Not expected".to_owned())
    };
    assert!(
        parse_otio(
            &vec![b' '; MAX_PROJECT as usize + 1],
            &root,
            &mut probe,
            &mut |_| {}
        )
        .is_err()
    );
    let value = json!({"references":(0..65).map(|n|json!({"target_url":format!("clip-{n}.mp4")})).collect::<Vec<_>>()});
    let error = parse_otio(
        &serde_json::to_vec(&value).unwrap(),
        &root,
        &mut probe,
        &mut |_| {},
    )
    .unwrap_err();
    assert!(error.2.contains("64 distinct"));
    assert!(parse_otio(b"not JSON", &root, &mut probe, &mut |_| {}).is_err());
    assert_eq!(probes, 0);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn media_import_tokens_preserve_full_native_domain_order_and_explicit_batch_bounds() {
    let tokens: Vec<String> = [
        "clip.AVI",
        "clip.m4v",
        "sound.aac",
        "picture.bmp",
        "picture.tif",
        "picture.TIFF",
        "clip.AVI",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(media_import_tokens(&tokens).unwrap(), tokens[..6]);
    let batch: Vec<_> = (0..256).map(|n| format!("clip-{n}.mp4")).collect();
    assert_eq!(media_import_tokens(&batch).unwrap().len(), 256);
    let mut excessive = batch;
    excessive.push("extra.mp4".into());
    assert!(media_import_tokens(&excessive).is_err());
    assert!(media_import_tokens(&[]).is_err());
    assert!(media_import_tokens(&vec!["clip.mp4".into(); 4097]).is_err());
    for token in [
        "../clip.mp4",
        "sub/clip.mp4",
        "sub\\clip.mp4",
        ".clip.mp4",
        "clip\n.mp4",
        "clip.m3u8",
        "clip.txt",
    ] {
        assert!(media_import_tokens(&[token.into()]).is_err(), "{token:?}");
    }
}

#[test]
fn root_listing_includes_all_native_media_types_without_probing_or_following_links() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let names = [
        "clip.avi",
        "clip.m4v",
        "sound.aac",
        "picture.bmp",
        "picture.tif",
        "picture.tiff",
        "still.PNG",
    ];
    for name in names {
        std::fs::write(root.join(name), b"unprobed").unwrap();
    }
    std::fs::create_dir(root.join("directory.mp4")).unwrap();
    std::os::unix::fs::symlink(root.join(names[0]), root.join("link.mp4")).unwrap();
    let value = files.list().unwrap();
    let tokens: std::collections::HashSet<_> = value["importable_media"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["path_token"].as_str().unwrap())
        .collect();
    assert_eq!(tokens, names.into_iter().collect());
    assert_eq!(
        files.media_import_tokens(&["clip.avi".into()]).unwrap(),
        ["clip.avi"]
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
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
fn external_project_changes_preserve_the_file_and_backup_until_an_explicit_reopen() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let project = Project::default();
    files.save(&project, "current.vvproj", true).unwrap();
    files.save(&project, "current.vvproj", false).unwrap();
    let backup = std::fs::read(root.join("current.vvproj.bak")).unwrap();
    let external = b"external file content";
    std::fs::write(root.join("current.vvproj"), external).unwrap();
    assert_eq!(
        files.save(&project, "current.vvproj", false).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    assert_eq!(
        std::fs::read(root.join("current.vvproj")).unwrap(),
        external
    );
    assert_eq!(
        std::fs::read(root.join("current.vvproj.bak")).unwrap(),
        backup
    );
    files.save(&project, "memory_copy.vvproj", true).unwrap();
    assert!(files.load("memory_copy.vvproj").is_ok());
    let original = ron::ser::to_string(&project).unwrap();
    std::fs::write(root.join("current.vvproj"), original).unwrap();
    let reopened = files.load("current.vvproj").unwrap();
    files.save(&reopened, "current.vvproj", false).unwrap();
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn save_detects_equal_size_writes_with_restored_mtime_and_missing_or_replaced_files() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let project = Project::default();
    files.save(&project, "current.vvproj", true).unwrap();
    let path = root.join("current.vvproj");
    let bytes = std::fs::read(&path).unwrap();
    let timestamp = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut changed = bytes.clone();
    changed[0] = b'#';
    std::fs::write(&path, &changed).unwrap();
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(timestamp))
        .unwrap();
    assert_eq!(
        files.save(&project, "current.vvproj", false).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    assert_eq!(std::fs::read(&path).unwrap(), changed);
    std::fs::remove_file(&path).unwrap();
    assert_eq!(
        files.save(&project, "current.vvproj", false).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    std::fs::write(&path, &bytes).unwrap();
    assert_eq!(
        files.save(&project, "current.vvproj", false).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    assert!(!root.join("current.vvproj.bak").exists());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn a_project_root_has_one_nonblocking_process_owner_and_releases_on_drop() {
    let root = root();
    let owner = Files::new(&root).unwrap();
    let started = std::time::Instant::now();
    assert!(Files::new(&root).is_err());
    assert!(Files::new(&root.join(".")).is_err());
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    owner
        .save(&Project::default(), "preserved.vvproj", true)
        .unwrap();
    drop(owner);
    let reopened = Files::new(&root).unwrap();
    assert!(reopened.load("preserved.vvproj").is_ok());
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn project_folder_validation_refuses_cycles_before_a_tree_can_be_opened() {
    let mut project = Project::default();
    let a = project.folders.insert(vv_core::MediaFolder {
        name: "A".into(),
        parent: None,
    });
    let b = project.folders.insert(vv_core::MediaFolder {
        name: "B".into(),
        parent: Some(a),
    });
    assert!(validate_project(&project).is_ok());
    project.folders[a].parent = Some(b);
    assert!(validate_project(&project).is_err());
    project.folders[a].parent = None;
    project.folders[b].parent = Some(b);
    assert!(validate_project(&project).is_err());
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
    assert!(files.load_backup("test.vvproj.bak").is_ok());
    assert_eq!(
        files.list().unwrap()["backups"].as_array().unwrap().len(),
        1
    );
    assert!(files.load_backup("../test.vvproj.bak").is_err());
    assert!(files.load_backup("test.vvproj").is_err());
    assert!(files.load("test.vvproj").is_ok());
    assert!(files.load("../test.vvproj").is_err());
    let external = root.with_extension("outside");
    std::fs::write(&external, b"sentinel").unwrap();
    std::os::unix::fs::symlink(&external, root.join("link.vvproj")).unwrap();
    assert!(files.load("link.vvproj").is_err());
    std::os::unix::fs::symlink(&external, root.join("link.vvproj.bak")).unwrap();
    assert!(files.load_backup("link.vvproj.bak").is_err());
    assert_eq!(
        files.list().unwrap()["backups"].as_array().unwrap().len(),
        1
    );
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

#[test]
fn otio_foreign_auto_background_import_uses_native_cpu_title_metrics() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let mut session = vv_session::Session::default();
    let timeline = session.create_timeline(vv_core::Timeline {
        name: "Foreign text".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let mut clip = vv_core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        vv_core::ClipSource::Text,
        0,
        24,
        0,
        vv_core::Rational::one(),
    );
    let mut title = vv_core::TitleParams::default();
    title.content.default = "Native title".into();
    title.size = 32.0;
    title.background.enabled = true;
    clip.effects.title = Some(title);
    session.project.timelines[timeline].tracks[0].insert_sorted(clip);
    let measure = |title: &vv_core::TitleParams| vv_render::text::title_metrics(title);
    let mut foreign = vv_core::otio::timeline_to_otio(&session.project, timeline, Some(&measure));
    let clip = &mut foreign["tracks"]["children"][0]["children"][0];
    clip["metadata"] = json!({});
    let blocks = clip["media_references"]["DEFAULT_MEDIA"]["parameters"]["Resolve_OTIO"]
        .as_array_mut()
        .unwrap();
    let background = blocks
        .iter_mut()
        .find(|block| block["Effect Name"] == "Background")
        .unwrap();
    for parameter in background["Parameters"].as_array_mut().unwrap() {
        match parameter["Parameter ID"].as_str() {
            Some("backgroundWidth" | "backgroundHeight") => {
                parameter["Parameter Value"] = json!(0.0)
            }
            Some("backgroundCornerRadius") => parameter["Parameter Value"] = json!(0.015),
            _ => {}
        }
    }
    let expected = vv_core::project_from_otio(
        &foreign,
        &root,
        &mut |_| panic!("Text must not probe media"),
        Some(&measure),
    )
    .unwrap();
    let fallback = vv_core::project_from_otio(
        &foreign,
        &root,
        &mut |_| panic!("Text must not probe media"),
        None,
    )
    .unwrap();
    std::fs::write(
        root.join("foreign-title.otio"),
        serde_json::to_vec(&foreign).unwrap(),
    )
    .unwrap();
    let (actual, warnings) = files.import_otio("foreign-title.otio").unwrap();
    assert!(warnings.is_empty());
    let title = |project: &vv_core::Project| {
        project
            .timelines
            .values()
            .flat_map(|timeline| &timeline.tracks)
            .flat_map(|track| &track.clips)
            .find_map(|clip| clip.effects.title.clone())
            .unwrap()
    };
    let actual = title(&actual);
    let expected = title(&expected.project);
    assert_eq!(
        serde_json::to_value(&actual).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    assert!(
        (actual.background.corner_radius - title(&fallback.project).background.corner_radius).abs()
            > 0.0001
    );
    std::fs::remove_dir_all(root).unwrap();
}
