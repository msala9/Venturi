use super::*;
use vv_core::{
    Clip, ClipId, ClipSource, Rational,
    attributes::{Attribute, KeyframeAnchor},
};

fn fixture() -> (std::path::PathBuf, Store, Preset) {
    let root = std::env::temp_dir().join(format!(
        "venturi-presets-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let store = Store::new(&root).unwrap();
    let preset = Preset {
        version: 1,
        name: "Shared look α".into(),
        attributes: vec![Attribute::Zoom],
        anchor: KeyframeAnchor::Start,
        append_filters: false,
        shortcut: None,
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        video: Some(Box::new(Clip::from_source_range(
            ClipId(9007199254740993),
            ClipSource::SolidColor,
            0,
            48,
            0,
            Rational::one(),
        ))),
        audio: None,
    };
    (root, store, preset)
}
fn revision(store: &Store, id: &str, archived: bool) -> String {
    store.item(id, archived).unwrap()["revision"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn native_library_create_export_update_backup_archive_and_restore_preserve_source_data() {
    let (root, store, preset) = fixture();
    store.create("native-1", &preset).unwrap();
    let bytes = store.export("native-1").unwrap();
    store.create("native-1", &preset).unwrap();
    assert_eq!(store.export("native-1").unwrap(), bytes);
    assert_eq!(
        serde_json::from_slice::<Preset>(&bytes)
            .unwrap()
            .video
            .unwrap()
            .id
            .0,
        9007199254740993
    );
    let old = revision(&store, "native-1", false);
    let options = Options {
        name: "Renamed α".into(),
        attributes: vec![Attribute::Zoom],
        anchor: KeyframeAnchor::End,
        append_filters: true,
    };
    store
        .edit(
            "edit",
            &Edit::Update {
                id: "native-1".into(),
                revision: old.clone(),
                options: options.clone(),
            },
        )
        .unwrap();
    let changed = revision(&store, "native-1", false);
    assert_ne!(old, changed);
    let loaded = store.load("native-1", &changed).unwrap();
    assert_eq!(loaded.name, "Renamed α");
    assert_eq!(loaded.anchor, KeyframeAnchor::End);
    assert_eq!(loaded.video.unwrap().id.0, 9007199254740993);
    assert_eq!(
        store
            .edit(
                "stale",
                &Edit::Update {
                    id: "native-1".into(),
                    revision: old.clone(),
                    options
                }
            )
            .unwrap_err()
            .1,
        "PRESET_CHANGED"
    );
    assert_eq!(revision(&store, "native-1", false), changed);
    store
        .edit(
            "previous",
            &Edit::RestorePrevious {
                id: "native-1".into(),
                revision: changed,
            },
        )
        .unwrap();
    assert_eq!(store.export("native-1").unwrap(), bytes);
    store
        .edit(
            "archive",
            &Edit::Archive {
                id: "native-1".into(),
                revision: old.clone(),
            },
        )
        .unwrap();
    assert!(store.export("native-1").is_err());
    assert_eq!(revision(&store, "native-1", true), old);
    store
        .edit(
            "restore",
            &Edit::Restore {
                id: "native-1".into(),
                revision: old,
            },
        )
        .unwrap();
    assert_eq!(store.export("native-1").unwrap(), bytes);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn independent_library_handles_share_files_and_refuse_concurrent_writes() {
    let (root, first, preset) = fixture();
    let second = Store::new(&root).unwrap();
    first.create("shared", &preset).unwrap();
    let expected = revision(&first, "shared", false);
    assert_eq!(second.load("shared", &expected).unwrap().name, preset.name);
    let lock = first.lock().unwrap();
    assert_eq!(
        second.create("other", &preset).unwrap_err().1,
        "LIBRARY_BUSY"
    );
    drop(lock);
    second.create("other", &preset).unwrap();
    assert_eq!(first.list(0, &Query::default()).unwrap()["total"], 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn preset_pages_bound_reads_and_preserve_corrupt_entries_links_and_collisions() {
    let (root, store, preset) = fixture();
    for index in 0..33 {
        store.create(&format!("id-{index:02}"), &preset).unwrap();
    }
    assert_eq!(
        store.list(0, &Query::default()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        32
    );
    assert_eq!(
        store.list(1, &Query::default()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(store.list(usize::MAX, &Query::default()).is_err());
    let query = Query {
        search: "missing".into(),
        ..Default::default()
    };
    assert_eq!(store.list(0, &query).unwrap()["items"], json!([]));
    assert_eq!(store.list(0, &query).unwrap()["pages"], 2);
    std::fs::write(root.join("broken.json"), b"not JSON").unwrap();
    assert!(store.item("broken", false).unwrap()["error"].is_string());
    let outside = root.with_extension("outside");
    std::fs::write(&outside, b"preserve").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("link.json")).unwrap();
    assert!(store.export("link").is_err());
    assert!(store.create("link", &preset).is_err());
    assert_eq!(std::fs::read(&outside).unwrap(), b"preserve");
    assert!(store.export("../outside").is_err());
    assert!(
        store
            .edit("bad", &Edit::Import { json: "{}".into() })
            .is_err()
    );
    let mut changed = preset.clone();
    changed.name = "Different".into();
    assert_eq!(
        store.create("id-00", &changed).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert!(std::fs::read_dir(&root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    std::fs::remove_dir_all(&root).unwrap();
    std::fs::remove_file(outside).unwrap();
}

#[test]
fn raw_json_import_keeps_native_identifiers_and_rejects_unsupported_versions() {
    let (root, store, preset) = fixture();
    let text = serde_json::to_string(&preset).unwrap();
    store
        .edit("imported", &Edit::Import { json: text.clone() })
        .unwrap();
    let exported = store.export("imported").unwrap();
    assert_eq!(
        serde_json::from_slice::<Preset>(&exported)
            .unwrap()
            .video
            .unwrap()
            .id
            .0,
        9007199254740993
    );
    let mut invalid = preset.clone();
    invalid.version = 2;
    assert!(
        store
            .edit(
                "unsupported",
                &Edit::Import {
                    json: serde_json::to_string(&invalid).unwrap()
                }
            )
            .is_err()
    );
    assert!(!root.join("unsupported.json").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn restoring_previous_atomically_exchanges_both_native_versions_repeatedly() {
    let (root, store, mut preset) = fixture();
    preset.shortcut = Some(json!("Ctrl+Shift+P"));
    store.create("swap", &preset).unwrap();
    assert_eq!(
        store.item("swap", false).unwrap()["shortcut"],
        "Ctrl+Shift+P"
    );
    let original = store.export("swap").unwrap();
    let original_revision = revision(&store, "swap", false);
    store
        .edit(
            "update",
            &Edit::Update {
                id: "swap".into(),
                revision: original_revision.clone(),
                options: Options {
                    name: "Changed settings".into(),
                    attributes: vec![Attribute::Zoom],
                    anchor: KeyframeAnchor::Stretch,
                    append_filters: true,
                },
            },
        )
        .unwrap();
    let changed = store.export("swap").unwrap();
    let backup_path = root.join("swap.json.bak");
    assert_eq!(std::fs::read(&backup_path).unwrap(), original);
    assert_eq!(
        store
            .edit(
                "stale-restore",
                &Edit::RestorePrevious {
                    id: "swap".into(),
                    revision: original_revision,
                },
            )
            .unwrap_err()
            .1,
        "PRESET_CHANGED"
    );
    assert_eq!(store.export("swap").unwrap(), changed);
    assert_eq!(std::fs::read(&backup_path).unwrap(), original);
    for turn in 0..4 {
        store
            .edit(
                &format!("restore-{turn}"),
                &Edit::RestorePrevious {
                    id: "swap".into(),
                    revision: revision(&store, "swap", false),
                },
            )
            .unwrap();
        let (active, backup) = if turn % 2 == 0 {
            (&original, &changed)
        } else {
            (&changed, &original)
        };
        assert_eq!(&store.export("swap").unwrap(), active);
        assert_eq!(&std::fs::read(&backup_path).unwrap(), backup);
        assert!(
            store.item("swap", false).unwrap()["can_restore_previous"]
                .as_bool()
                .unwrap()
        );
        assert_eq!(
            store.item("swap", false).unwrap()["shortcut"],
            "Ctrl+Shift+P"
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn restoring_missing_or_corrupt_previous_settings_preserves_all_existing_bytes() {
    let (root, store, preset) = fixture();
    store.create("preserve", &preset).unwrap();
    let original = store.export("preserve").unwrap();
    let operation = Edit::RestorePrevious {
        id: "preserve".into(),
        revision: revision(&store, "preserve", false),
    };
    let backup_path = root.join("preserve.json.bak");
    assert_eq!(
        store.edit("missing", &operation).unwrap_err().1,
        "NOT_FOUND"
    );
    assert_eq!(store.export("preserve").unwrap(), original);
    assert!(!backup_path.exists());
    let corrupt = b"not a native preset";
    std::fs::write(&backup_path, corrupt).unwrap();
    assert!(store.edit("corrupt", &operation).is_err());
    assert_eq!(store.export("preserve").unwrap(), original);
    assert_eq!(std::fs::read(&backup_path).unwrap(), corrupt);
    std::fs::remove_dir_all(root).unwrap();
}
