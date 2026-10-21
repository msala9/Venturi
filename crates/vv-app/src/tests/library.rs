use super::*;
use vv_core::clipboard::ClipboardOrigin;
use vv_core::{MediaId, MediaMeta, Project};

fn temp_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vv-app-library-test-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn project_with_file(path: &Path, hash: u64) -> (Project, MediaId) {
    std::fs::write(path, b"not really a video").unwrap();
    let mut project = Project::default();
    let id = project.media_pool.insert(MediaItem {
        path: path.to_owned(),
        meta: MediaMeta {
            duration_frames: 10,
            fps: Rational::new(30, 1),
            width: 16,
            height: 16,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: hash,
        compound: None,
        folder: None,
    });
    (project, id)
}

fn payload(project: &Project, id: MediaId) -> ClipboardPayload {
    let origin = ClipboardOrigin {
        instance: 0,
        epoch: 0,
    };
    ClipboardPayload::new(origin, project, &[id], &[])
}

fn asset(id: &str, name: &str, payload: ClipboardPayload) -> Asset {
    Asset {
        id: id.into(),
        name: name.into(),
        folder: None,
        payload,
    }
}

#[test]
fn an_asset_copies_its_file_and_survives_a_reopen() {
    let root = temp_root("asset");
    let original = root.join("clip.mp4");
    let (project, id) = project_with_file(&original, 0xab);

    let asset = store_asset(&root, asset("a", "Intro", payload(&project, id))).unwrap();

    let copied = &asset.item().unwrap().path;
    assert!(copied.starts_with(root.join("media")));
    assert_eq!(
        copied.file_name().unwrap(),
        "clip.mp4",
        "the name stays readable"
    );
    assert_eq!(std::fs::read(copied).unwrap(), b"not really a video");
    std::fs::remove_file(&original).unwrap();
    let library = Library::open(root);
    assert_eq!(library.assets.len(), 1);
    assert_eq!(library.assets[0].name, "Intro");
    assert_eq!(&library.assets[0].item().unwrap().path, copied);
}

#[test]
fn removing_an_asset_keeps_the_files_other_assets_use() {
    let root = temp_root("remove");
    let (project, id) = project_with_file(&root.join("clip.mp4"), 0xcd);
    store_asset(&root, asset("a", "A", payload(&project, id))).unwrap();
    store_asset(&root, asset("b", "B", payload(&project, id))).unwrap();
    let mut library = Library::open(root.clone());
    let copied = library.assets[0].item().unwrap().path.clone();

    library.remove_asset("a").unwrap();
    assert!(copied.exists(), "still used by B");
    library.remove_asset("b").unwrap();
    assert!(!copied.exists());
    assert!(Library::open(root).assets.is_empty());
}

fn preset(name: &str, shortcut: Option<Shortcut>) -> AttributePreset {
    let format = TimelineFormat {
        fps: Rational::new(30, 1),
        resolution: (1920, 1080),
    };
    let mut preset = AttributePreset::new(name.into(), format, None, None);
    preset.attributes = vec![Attribute::Zoom];
    preset.shortcut = shortcut;
    preset
}

#[test]
fn a_shortcut_belongs_to_one_preset_only() {
    let root = temp_root("shortcut");
    let mut library = Library::open(root.clone());
    let key = Shortcut {
        shift: true,
        ..Shortcut::plain(egui::Key::Num1)
    };
    library.add_preset(preset("First", Some(key))).unwrap();
    library.add_preset(preset("Second", Some(key))).unwrap();

    let library = Library::open(root);
    let with_shortcut: Vec<_> = library
        .presets
        .iter()
        .filter(|(_, p)| p.shortcut.is_some())
        .map(|(_, p)| (p.name.as_str(), p.shortcut))
        .collect();
    assert_eq!(library.presets.len(), 2);
    assert_eq!(with_shortcut, vec![("Second", Some(key))]);
}

#[test]
fn entries_of_a_newer_version_are_skipped() {
    let root = temp_root("version");
    let mut library = Library::open(root.clone());
    let id = library.add_preset(preset("Old", None)).unwrap();
    let path = root.join("presets").join(format!("{id}.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap()
        .replace("\"version\": 1", "\"version\": 99");
    std::fs::write(&path, text).unwrap();

    assert!(Library::open(root).presets.is_empty());
}

#[test]
fn removing_a_folder_moves_its_content_up_and_survives_a_reopen() {
    let root = temp_root("folders");
    let (project, id) = project_with_file(&root.join("clip.mp4"), 0xef);
    store_asset(&root, asset("a", "A", payload(&project, id))).unwrap();
    let mut library = Library::open(root.clone());
    let outer = library.add_folder("Outer".into(), None).unwrap();
    let inner = library
        .add_folder("Inner".into(), Some(outer.clone()))
        .unwrap();
    let deepest = library
        .add_folder("Deepest".into(), Some(inner.clone()))
        .unwrap();
    library
        .move_assets(&["a".into()], Some(inner.clone()))
        .unwrap();

    library.remove_folder(&inner).unwrap();

    let library = Library::open(root);
    assert_eq!(library.assets[0].folder, Some(outer.clone()));
    assert_eq!(library.folder(&deepest).unwrap().parent, Some(outer));
    assert!(library.folder(&inner).is_none());
}

#[test]
fn an_asset_with_a_missing_file_is_refused() {
    let root = temp_root("missing");
    let original = root.join("gone.mp4");
    let (project, id) = project_with_file(&original, 0x12);
    std::fs::remove_file(&original).unwrap();

    assert!(store_asset(&root, asset("a", "A", payload(&project, id))).is_err());
    assert!(Library::open(root).assets.is_empty());
}

#[test]
fn relinking_finds_the_missing_files_by_name_and_copies_them_in() {
    let root = temp_root("relink");
    let (project, id) = project_with_file(&root.join("music.mp3"), 0x34);
    store_asset(&root, asset("a", "A", payload(&project, id))).unwrap();
    let mut library = Library::open(root.clone());
    let copied = library.assets[0].item().unwrap().path.clone();
    std::fs::remove_file(&copied).unwrap();
    assert!(library.assets[0].is_offline());
    let found = root.join("elsewhere").join("deep");
    std::fs::create_dir_all(&found).unwrap();
    std::fs::rename(root.join("music.mp3"), found.join("music.mp3")).unwrap();

    assert_eq!(library.relink_asset("a", &root.join("elsewhere")), Ok(0));

    let library = Library::open(root);
    assert!(!library.assets[0].is_offline());
    assert_eq!(library.assets[0].item().unwrap().path, copied);
}

#[test]
fn project_copies_reuse_an_identical_file_and_never_overwrite_another() {
    let root = temp_root("project-copy");
    let src = root.join("0123456789abcdef-logo.png");
    std::fs::write(&src, b"logo").unwrap();
    let dir = root.join("project").join("library");

    let first = copy_for_project(&src, &dir, &|_| true).unwrap();
    assert_eq!(first, dir.join("logo.png"), "without the hash prefix");
    assert_eq!(copy_for_project(&src, &dir, &|_| true).unwrap(), first);

    let other = root.join("logo.png");
    std::fs::write(&other, b"another logo").unwrap();
    assert_eq!(
        copy_for_project(&other, &dir, &|_| true).unwrap(),
        dir.join("logo (2).png")
    );
    assert_eq!(std::fs::read(&first).unwrap(), b"logo");
}

fn wait_for_pending(library: &mut Library) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while library.pending().next().is_some() {
        assert!(library.poll().is_empty());
        assert!(
            std::time::Instant::now() < deadline,
            "copies never finished"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

#[test]
fn a_dropped_folder_becomes_library_folders_with_its_media() {
    let root = temp_root("import-tree");
    let shots = root.join("drop").join("Shots");
    std::fs::create_dir_all(shots.join("Day 1")).unwrap();
    for file in [shots.join("a.png"), shots.join("Day 1").join("b.png")] {
        vv_media::test_support::ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                "color=red:size=16x16",
                "-frames:v",
                "1",
            ],
            &file,
        );
    }
    let origin = ClipboardOrigin {
        instance: 0,
        epoch: 0,
    };
    let mut library = Library::open(root.join("library"));

    let tree = vv_session::MediaTree::scan(std::slice::from_ref(&shots));
    library.import_tree(tree, None, origin).unwrap();
    wait_for_pending(&mut library);

    let folder_name = |library: &Library, asset: &str| {
        let asset = library.assets.iter().find(|a| a.name == asset).unwrap();
        let folder = library.folder(asset.folder.as_deref().unwrap()).unwrap();
        let parent = folder
            .parent
            .as_deref()
            .map(|p| library.folder(p).unwrap().name.clone());
        (folder.name.clone(), parent)
    };
    assert_eq!(folder_name(&library, "a.png"), ("Shots".into(), None));
    assert_eq!(
        folder_name(&library, "b.png"),
        ("Day 1".into(), Some("Shots".into()))
    );

    // Dropped again: same folders, nothing duplicated.
    let tree = vv_session::MediaTree::scan(std::slice::from_ref(&shots));
    library.import_tree(tree, None, origin).unwrap();
    wait_for_pending(&mut library);
    assert_eq!(library.folders.len(), 2);
    assert_eq!(library.assets.len(), 2);
    assert_eq!(Library::open(root.join("library")).assets.len(), 2);
}

#[test]
fn web_exported_preset_imports_through_native_library_and_round_trips() {
    let text = include_str!("fixtures/web-exported-preset.json");
    let exported: serde_json::Value = serde_json::from_str(text).unwrap();
    let imported = parse::<AttributePreset>("web-exported", text).unwrap();
    assert_eq!(imported.name, "Assigned native shortcut");
    assert_eq!(imported.attributes, vec![Attribute::Zoom]);
    assert!(imported.video.is_some());
    assert!(imported.audio.is_none());
    assert_eq!(serde_json::to_value(&imported).unwrap(), exported);
    let roundtrip: AttributePreset = serde_json::from_value(exported.clone()).unwrap();
    assert_eq!(serde_json::to_value(roundtrip).unwrap(), exported);

    let root = std::env::temp_dir().join(format!(
        "vv-app-web-preset-import-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(root.join("presets")).unwrap();
    std::fs::write(root.join("presets/web-exported.json"), text).unwrap();
    let library = Library::open(root.clone());
    assert_eq!(library.presets.len(), 1);
    assert_eq!(library.presets[0].0, "web-exported");
    assert_eq!(
        serde_json::to_value(&library.presets[0].1).unwrap(),
        exported
    );
    let mut unknown = exported.clone();
    unknown["shortcut"] = serde_json::json!("Ctrl+SomeFutureKey");
    assert!(parse::<AttributePreset>("unknown-shortcut", &unknown.to_string()).is_none());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn web_exported_preset_shortcut_catalog_matches_every_native_key_and_modifier() {
    let catalog: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/web-preset-shortcut-catalog.json")).unwrap();
    assert_eq!(catalog["version"], 1);
    assert_eq!(
        catalog["modifiers"],
        serde_json::json!(["Ctrl", "Shift", "Alt"])
    );
    let keys = catalog["keys"].as_array().unwrap();
    let exported: std::collections::BTreeSet<_> =
        keys.iter().map(|key| key.as_str().unwrap()).collect();
    let native: std::collections::BTreeSet<_> =
        egui::Key::ALL.iter().map(|key| key.name()).collect();
    assert_eq!(exported.len(), keys.len());
    assert_eq!(exported, native);
    for key in exported {
        for mask in 0..8 {
            let shortcut = Shortcut {
                key: egui::Key::from_name(key).unwrap(),
                ctrl: mask & 1 != 0,
                shift: mask & 2 != 0,
                alt: mask & 4 != 0,
            };
            let mut expected = String::new();
            for (enabled, modifier) in [
                (shortcut.ctrl, "Ctrl+"),
                (shortcut.shift, "Shift+"),
                (shortcut.alt, "Alt+"),
            ] {
                if enabled {
                    expected.push_str(modifier);
                }
            }
            expected.push_str(key);
            assert_eq!(serde_json::to_value(shortcut).unwrap(), expected);
            let decoded: Shortcut = serde_json::from_value(serde_json::json!(expected)).unwrap();
            assert_eq!(decoded, shortcut);
        }
    }
}

#[test]
fn web_exported_asset_opens_in_the_desktop_library_and_merges_native_nested_entities() {
    use vv_core::{Command, CommandLabel, pool::AddEntities};
    let text = include_str!("fixtures/web-exported-asset.json");
    let exported: serde_json::Value = serde_json::from_str(text).unwrap();
    let wrapper = parse::<AssetFile>("web-exported-asset", text).unwrap();
    assert_eq!(serde_json::to_value(&wrapper).unwrap(), exported);
    assert_eq!(wrapper.name, "Reusable file compound");
    let root = std::env::temp_dir().join(format!(
        "vv-app-web-asset-import-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(root.join("assets")).unwrap();
    std::fs::write(root.join("assets/web-exported-asset.json"), text).unwrap();
    let library = Library::open(root.clone());
    assert_eq!(library.assets.len(), 1);
    let asset = &library.assets[0];
    assert_eq!(asset.id, "web-exported-asset");
    assert_eq!(asset.name, wrapper.name);
    assert_eq!(asset.payload.to_text(), wrapper.payload);
    assert_eq!(asset.payload.files().count(), 1);
    assert!(asset.item().unwrap().compound.is_some());
    assert!(
        asset
            .payload
            .files()
            .next()
            .unwrap()
            .path
            .ends_with("native-source.png")
    );
    let mut project = Project::default();
    let mut additions = AddEntities::new(CommandLabel::ImportMedia);
    let pasted = asset
        .payload
        .clone()
        .merge_into(&mut project, &mut additions);
    assert_eq!(pasted.media.len(), 1);
    assert!(!additions.is_empty());
    additions.apply(&mut project);
    assert_eq!(project.media_pool.len(), 2);
    assert_eq!(project.timelines.len(), 1);
    let child = project.media_pool[pasted.media[0]].compound.unwrap();
    assert_eq!(project.timelines[child].name, "Reusable native compound");
    assert_eq!(project.timelines[child].tracks[0].clips.len(), 1);
    additions.undo(&mut project);
    assert!(project.media_pool.is_empty());
    assert!(project.timelines.is_empty());
    std::fs::remove_dir_all(root).unwrap();
}
