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

fn deletion_completion(store: &Store, command: &str) -> Completion {
    Completion {
        version: 1,
        command_id: command.into(),
        fingerprint: [7; 32],
        project_root_binding: crate::asset_journal::project_binding(&store.dir).unwrap(),
        receipt: json!({"command_id":command,"status":"applied","project_epoch":"epoch:1","generation":"7","command_epoch":"0","library_durable":true,"preset_library_durable":true,"durability":{"state":"volatile","recovery_revision":null}}),
    }
}

#[test]
fn permanent_delete_preserves_opposite_state_backups_and_recreated_files_during_bound_retry() {
    let (root, store, preset) = fixture();
    store.create("saved", &preset).unwrap();
    let archived_revision = revision(&store, "saved", false);
    store
        .edit(
            "archive",
            &Edit::Archive {
                id: "saved".into(),
                revision: archived_revision.clone(),
            },
        )
        .unwrap();
    let archived_bytes = std::fs::read(root.join("saved.json.deleted")).unwrap();
    let mut active = preset.clone();
    active.name = "Active saved look".into();
    store.create("saved", &active).unwrap();
    let options = Options {
        name: "Updated saved look".into(),
        attributes: active.attributes.clone(),
        anchor: active.anchor,
        append_filters: active.append_filters,
        shortcut: None,
    };
    store
        .edit(
            "update",
            &Edit::Update {
                id: "saved".into(),
                revision: revision(&store, "saved", false),
                options,
            },
        )
        .unwrap();
    let backup = std::fs::read(root.join("saved.json.bak")).unwrap();
    let active_revision = revision(&store, "saved", false);
    let edit = Edit::Delete {
        id: "saved".into(),
        revision: active_revision.clone(),
        archived: false,
    };
    let completion = deletion_completion(&store, "delete-active");
    let binding = completion.project_root_binding.clone();
    store.delete(&edit, completion.clone()).unwrap();
    assert!(!root.join("saved.json").exists());
    assert_eq!(
        std::fs::read(root.join("saved.json.deleted")).unwrap(),
        archived_bytes
    );
    assert_eq!(std::fs::read(root.join("saved.json.bak")).unwrap(), backup);
    let recorded = store
        .completion("delete-active", &binding)
        .unwrap()
        .unwrap();
    assert_eq!(
        recorded.1["deleted_preset"],
        json!({"id":"saved","revision":active_revision,"archived":false})
    );
    assert!(
        store
            .completion("delete-active", "other-project")
            .unwrap()
            .is_none()
    );
    store.create("saved", &preset).unwrap();
    let replacement = store.export("saved").unwrap();
    store.delete(&edit, completion.clone()).unwrap();
    assert_eq!(store.export("saved").unwrap(), replacement);
    let mut reused = completion.clone();
    reused.fingerprint = [8; 32];
    assert_eq!(
        store.delete(&edit, reused).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    assert_eq!(
        store
            .acknowledge("delete-active", [8; 32], &binding)
            .unwrap_err()
            .1,
        "PRESET_JOURNAL_CONFLICT"
    );
    assert_eq!(store.completions(&binding).unwrap().len(), 1);
    drop(store);
    let store = Store::new(&root).unwrap();
    assert_eq!(
        store
            .completion("delete-active", &binding)
            .unwrap()
            .unwrap(),
        recorded
    );
    let archived = Edit::Delete {
        id: "saved".into(),
        revision: archived_revision,
        archived: true,
    };
    store
        .delete(&archived, deletion_completion(&store, "delete-archive"))
        .unwrap();
    assert!(!root.join("saved.json.deleted").exists());
    assert_eq!(store.export("saved").unwrap(), replacement);
    assert_eq!(std::fs::read(root.join("saved.json.bak")).unwrap(), backup);
    store
        .acknowledge("delete-active", completion.fingerprint, &binding)
        .unwrap();
    assert!(
        store
            .completion("delete-active", &binding)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store.delete(&edit, completion).unwrap_err().1,
        "PRESET_CHANGED"
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn permanent_delete_recovers_durable_intent_before_or_after_unlink_and_refuses_foreign_replacements()
 {
    let (root, store, preset) = fixture();
    for partial in [false, true] {
        let id = if partial { "partial" } else { "before" };
        let command = format!("delete-{id}");
        store.create(id, &preset).unwrap();
        let edit = Edit::Delete {
            id: id.into(),
            revision: revision(&store, id, false),
            archived: false,
        };
        let completion = deletion_completion(&store, &command);
        store.fail_after_intent_for_test();
        assert_eq!(
            store.delete(&edit, completion.clone()).unwrap_err().1,
            "PRESET_TEST_INTERRUPTED"
        );
        assert!(root.join(format!("{id}.json")).exists());
        let pending: Value =
            serde_json::from_slice(&std::fs::read(root.join(DELETE_PENDING)).unwrap()).unwrap();
        assert_eq!(pending["version"], 2);
        assert_eq!(pending["owner"], DELETE_OWNER);
        if partial {
            std::fs::remove_file(root.join(format!("{id}.json"))).unwrap();
            std::fs::write(
                root.join(COMPLETIONS)
                    .join(".preset-delete-interrupted.tmp"),
                b"partial owned receipt stage",
            )
            .unwrap();
        }
        let reopened = Store::new(&root).unwrap();
        let recorded = reopened
            .completion(&command, &completion.project_root_binding)
            .unwrap()
            .unwrap();
        assert_eq!(recorded.1["deleted_preset"]["id"], id);
        assert!(!root.join(format!("{id}.json")).exists());
        assert!(!root.join(DELETE_PENDING).exists());
        if partial {
            assert_eq!(
                std::fs::read(
                    root.join(COMPLETIONS)
                        .join(".preset-delete-interrupted.tmp")
                )
                .unwrap(),
                b"partial owned receipt stage"
            );
        }
    }
    store.create("foreign", &preset).unwrap();
    let edit = Edit::Delete {
        id: "foreign".into(),
        revision: revision(&store, "foreign", false),
        archived: false,
    };
    let completion = deletion_completion(&store, "delete-foreign");
    store.fail_after_intent_for_test();
    assert!(store.delete(&edit, completion.clone()).is_err());
    let pending = std::fs::read(root.join(DELETE_PENDING)).unwrap();
    let original = std::fs::read(root.join("foreign.json")).unwrap();
    std::fs::rename(
        root.join("foreign.json"),
        root.join("owned-original.json.bak"),
    )
    .unwrap();
    std::fs::write(root.join("foreign.json"), &original).unwrap();
    assert_eq!(
        store
            .completion("delete-foreign", &completion.project_root_binding)
            .unwrap_err()
            .1,
        "PRESET_JOURNAL_CONFLICT"
    );
    assert_eq!(std::fs::read(root.join(DELETE_PENDING)).unwrap(), pending);
    assert_eq!(std::fs::read(root.join("foreign.json")).unwrap(), original);
    std::fs::remove_file(root.join("foreign.json")).unwrap();
    assert!(
        store
            .completion("delete-foreign", &completion.project_root_binding)
            .unwrap()
            .is_some()
    );
    assert_eq!(
        std::fs::read(root.join("owned-original.json.bak")).unwrap(),
        original
    );
    assert!(!root.join(DELETE_PENDING).exists());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn permanent_delete_preflight_is_strict_locked_bounded_and_preserves_foreign_pending_data() {
    let (root, store, preset) = fixture();
    store.create("saved", &preset).unwrap();
    let bytes = store.export("saved").unwrap();
    let edit = Edit::Delete {
        id: "saved".into(),
        revision: revision(&store, "saved", false),
        archived: false,
    };
    assert_eq!(
        store.edit("unbound", &edit).unwrap_err().1,
        "PRESET_PREPARATION_REQUIRED"
    );
    let stale = Edit::Delete {
        id: "saved".into(),
        revision: "0".repeat(64),
        archived: false,
    };
    assert_eq!(
        store
            .delete(&stale, deletion_completion(&store, "stale"))
            .unwrap_err()
            .1,
        "PRESET_CHANGED"
    );
    for exclusive in [false, true] {
        let guard = store.catalog_lock(exclusive).unwrap();
        assert_eq!(
            store
                .delete(&edit, deletion_completion(&store, "busy"))
                .unwrap_err()
                .1,
            "LIBRARY_BUSY"
        );
        drop(guard);
        assert_eq!(store.export("saved").unwrap(), bytes);
    }
    let mut oversized = deletion_completion(&store, "oversized");
    oversized.receipt["oversized"] = json!("x".repeat(4096));
    assert!(store.delete(&edit, oversized).is_err());
    assert!(!root.join(DELETE_PENDING).exists());
    assert!(
        serde_json::from_value::<Edit>(
            json!({"action":"delete","id":"saved","revision":"0".repeat(64)})
        )
        .is_err()
    );
    assert!(serde_json::from_value::<Edit>(json!({"action":"delete","id":"saved","revision":"0".repeat(64),"archived":false,"extra":true})).is_err());
    for pending in [
        json!({"version":1,"targets":[]}),
        json!({"version":2,"owner":"foreign","targets":[]}),
    ] {
        let pending = serde_json::to_vec(&pending).unwrap();
        std::fs::write(root.join(DELETE_PENDING), &pending).unwrap();
        assert_eq!(
            store
                .delete(&edit, deletion_completion(&store, "foreign-pending"))
                .unwrap_err()
                .1,
            "LIBRARY_RECOVERY_REQUIRED"
        );
        assert_eq!(std::fs::read(root.join(DELETE_PENDING)).unwrap(), pending);
        assert_eq!(std::fs::read(root.join("saved.json")).unwrap(), bytes);
        std::fs::remove_file(root.join(DELETE_PENDING)).unwrap();
    }
    std::fs::write(root.join("broken.json"), b"not a preset").unwrap();
    let broken = Edit::Delete {
        id: "broken".into(),
        revision: format!("{:x}", Sha256::digest(b"not a preset")),
        archived: false,
    };
    assert!(
        store
            .delete(&broken, deletion_completion(&store, "broken"))
            .is_err()
    );
    assert_eq!(
        std::fs::read(root.join("broken.json")).unwrap(),
        b"not a preset"
    );
    assert!(!root.join(DELETE_PENDING).exists());
    let receipt_dir = crate::asset_store::directory(&store.dir, COMPLETIONS).unwrap();
    std::fs::write(
        root.join(COMPLETIONS).join("foreign.json"),
        b"foreign receipt",
    )
    .unwrap();
    assert!(
        store
            .delete(&edit, deletion_completion(&store, "bad-receipt"))
            .is_err()
    );
    assert!(!root.join(DELETE_PENDING).exists());
    assert_eq!(store.export("saved").unwrap(), bytes);
    assert_eq!(
        std::fs::read(root.join(COMPLETIONS).join("foreign.json")).unwrap(),
        b"foreign receipt"
    );
    drop(receipt_dir);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
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
        shortcut: None,
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
    let desktop = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.join(".venturi-presets.lock"))
        .unwrap();
    desktop.try_lock().unwrap();
    assert_eq!(
        second.list(0, &Query::default()).unwrap_err().1,
        "LIBRARY_BUSY"
    );
    assert_eq!(
        second.create("native-busy", &preset).unwrap_err().1,
        "LIBRARY_BUSY"
    );
    drop(desktop);
    assert_eq!(second.list(0, &Query::default()).unwrap()["total"], 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn preset_readers_refuse_an_inflight_catalog_writer_and_allow_parallel_readers() {
    let (root, first, preset) = fixture();
    let second = Store::new(&root).unwrap();
    first.create("shared", &preset).unwrap();
    let expected = revision(&first, "shared", false);
    let bytes = first.export("shared").unwrap();
    let writer = first.lock().unwrap();
    assert_eq!(
        second.load("shared", &expected).err().unwrap().1,
        "LIBRARY_BUSY"
    );
    assert_eq!(second.export("shared").unwrap_err().1, "LIBRARY_BUSY");
    assert_eq!(second.item("shared", false).unwrap_err().1, "LIBRARY_BUSY");
    assert_eq!(
        second.list(0, &Query::default()).unwrap_err().1,
        "LIBRARY_BUSY"
    );
    drop(writer);

    let reader = first.catalog_lock(false).unwrap();
    assert_eq!(second.load("shared", &expected).unwrap().name, preset.name);
    assert_eq!(second.export("shared").unwrap(), bytes);
    assert_eq!(second.item("shared", false).unwrap()["revision"], expected);
    assert_eq!(second.list(0, &Query::default()).unwrap()["total"], 1);
    assert_eq!(
        second.create("other", &preset).unwrap_err().1,
        "LIBRARY_BUSY"
    );
    drop(reader);
    second.create("other", &preset).unwrap();
    assert_eq!(first.list(0, &Query::default()).unwrap()["total"], 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pending_desktop_preset_transaction_blocks_reads_and_writes_without_removing_its_marker() {
    let (root, store, preset) = fixture();
    store.create("shared", &preset).unwrap();
    let expected = revision(&store, "shared", false);
    let original = store.export("shared").unwrap();
    let pending = root.join(".venturi-native-presets-pending.json");
    std::fs::write(&pending, b"incomplete desktop intent").unwrap();
    assert_eq!(
        store.load("shared", &expected).err().unwrap().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(
        store.export("shared").unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(
        store.item("shared", false).unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(
        store.list(0, &Query::default()).unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(
        store.create("other", &preset).unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(std::fs::read(root.join("shared.json")).unwrap(), original);
    assert_eq!(
        std::fs::read(&pending).unwrap(),
        b"incomplete desktop intent"
    );

    std::fs::remove_file(&pending).unwrap();
    std::os::unix::fs::symlink(root.join("absent-intent"), &pending).unwrap();
    assert_eq!(
        store.list(0, &Query::default()).unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(
        store.create("other", &preset).unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert!(pending.symlink_metadata().unwrap().is_symlink());
    std::fs::remove_file(&pending).unwrap();
    assert_eq!(store.export("shared").unwrap(), original);
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
                    shortcut: None,
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

fn shortcut_options(preset: &Preset, shortcut: Option<crate::presets::ShortcutEdit>) -> Options {
    Options {
        name: preset.name.clone(),
        attributes: preset.attributes.clone(),
        anchor: preset.anchor,
        append_filters: preset.append_filters,
        shortcut,
    }
}

#[test]
fn shortcut_update_clear_restore_and_restart_keep_native_payload_and_unrelated_bindings() {
    use crate::presets::ShortcutEdit;
    let (root, store, mut preset) = fixture();
    preset.shortcut = Some(json!("Vendor+FutureKey"));
    store.create("look", &preset).unwrap();
    let mut peer = preset.clone();
    peer.shortcut = Some(json!("Ctrl+Shift+Alt+P"));
    store.create("peer", &peer).unwrap();
    let peer_bytes = store.export("peer").unwrap();
    let original = store.export("look").unwrap();
    let mut keep = shortcut_options(&preset, None);
    keep.name = "Renamed look".into();
    store
        .edit(
            "keep",
            &Edit::Update {
                id: "look".into(),
                revision: revision(&store, "look", false),
                options: keep,
            },
        )
        .unwrap();
    assert_eq!(
        store.item("look", false).unwrap()["shortcut"],
        "Vendor+FutureKey"
    );
    assert_eq!(std::fs::read(root.join("look.json.bak")).unwrap(), original);
    let before_set = store.export("look").unwrap();
    let current = store
        .load("look", &revision(&store, "look", false))
        .unwrap();
    store
        .edit(
            "assign",
            &Edit::Update {
                id: "look".into(),
                revision: revision(&store, "look", false),
                options: shortcut_options(
                    &current,
                    Some(ShortcutEdit::Set {
                        value: "Alt+Ctrl+Shift+KeyP".into(),
                    }),
                ),
            },
        )
        .unwrap();
    let assigned = store.export("look").unwrap();
    assert_eq!(
        store.item("look", false).unwrap()["shortcut"],
        "Ctrl+Shift+Alt+P"
    );
    assert_eq!(
        std::fs::read(root.join("look.json.bak")).unwrap(),
        before_set
    );
    let mut expected: Value = serde_json::from_slice(&before_set).unwrap();
    expected["shortcut"] = json!("Ctrl+Shift+Alt+P");
    assert_eq!(
        serde_json::from_slice::<Value>(&assigned).unwrap(),
        expected
    );
    assert_eq!(
        store.export("peer").unwrap(),
        peer_bytes,
        "Assignment must not steal another preset's shortcut"
    );
    let current = store
        .load("look", &revision(&store, "look", false))
        .unwrap();
    store
        .edit(
            "clear",
            &Edit::Update {
                id: "look".into(),
                revision: revision(&store, "look", false),
                options: shortcut_options(&current, Some(ShortcutEdit::Clear)),
            },
        )
        .unwrap();
    let cleared = store.export("look").unwrap();
    assert!(store.item("look", false).unwrap()["shortcut"].is_null());
    assert_eq!(std::fs::read(root.join("look.json.bak")).unwrap(), assigned);
    expected["shortcut"] = Value::Null;
    assert_eq!(serde_json::from_slice::<Value>(&cleared).unwrap(), expected);
    store
        .edit(
            "restore",
            &Edit::RestorePrevious {
                id: "look".into(),
                revision: revision(&store, "look", false),
            },
        )
        .unwrap();
    assert_eq!(store.export("look").unwrap(), assigned);
    assert_eq!(std::fs::read(root.join("look.json.bak")).unwrap(), cleared);
    drop(store);
    let store = Store::new(&root).unwrap();
    assert_eq!(store.export("look").unwrap(), assigned);
    assert_eq!(
        store.item("look", false).unwrap()["shortcut"],
        "Ctrl+Shift+Alt+P"
    );
    store
        .edit(
            "restore-clear",
            &Edit::RestorePrevious {
                id: "look".into(),
                revision: revision(&store, "look", false),
            },
        )
        .unwrap();
    assert_eq!(store.export("look").unwrap(), cleared);
    store
        .edit(
            "archive",
            &Edit::Archive {
                id: "look".into(),
                revision: revision(&store, "look", false),
            },
        )
        .unwrap();
    assert!(store.item("look", true).unwrap()["shortcut"].is_null());
    store
        .edit(
            "unarchive",
            &Edit::Restore {
                id: "look".into(),
                revision: revision(&store, "look", true),
            },
        )
        .unwrap();
    assert_eq!(store.export("look").unwrap(), cleared);
    assert_eq!(store.export("peer").unwrap(), peer_bytes);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_shortcut_or_stale_update_preserves_active_and_backup_bytes() {
    use crate::presets::ShortcutEdit;
    let (root, store, preset) = fixture();
    store.create("look", &preset).unwrap();
    let old_revision = revision(&store, "look", false);
    store
        .edit(
            "assign",
            &Edit::Update {
                id: "look".into(),
                revision: old_revision.clone(),
                options: shortcut_options(
                    &preset,
                    Some(ShortcutEdit::Set {
                        value: "Ctrl++".into(),
                    }),
                ),
            },
        )
        .unwrap();
    assert_eq!(store.item("look", false).unwrap()["shortcut"], "Ctrl+Plus");
    let active = store.export("look").unwrap();
    let backup = std::fs::read(root.join("look.json.bak")).unwrap();
    for value in ["Ctrl+Ctrl+P", "UnknownKey", "Ctrl+P+Q", "Ctrl+", "Ctrl+\nP"] {
        assert!(
            store
                .edit(
                    "invalid",
                    &Edit::Update {
                        id: "look".into(),
                        revision: revision(&store, "look", false),
                        options: shortcut_options(
                            &preset,
                            Some(ShortcutEdit::Set {
                                value: value.into()
                            })
                        )
                    }
                )
                .is_err(),
            "{value:?}"
        );
        assert_eq!(store.export("look").unwrap(), active);
        assert_eq!(std::fs::read(root.join("look.json.bak")).unwrap(), backup);
    }
    assert_eq!(
        store
            .edit(
                "stale-clear",
                &Edit::Update {
                    id: "look".into(),
                    revision: old_revision,
                    options: shortcut_options(&preset, Some(ShortcutEdit::Clear))
                }
            )
            .unwrap_err()
            .1,
        "PRESET_CHANGED"
    );
    assert_eq!(store.export("look").unwrap(), active);
    assert_eq!(std::fs::read(root.join("look.json.bak")).unwrap(), backup);
    assert!(std::fs::read_dir(&root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn omitted_shortcut_keeps_legacy_library_command_receipt_serialization() {
    let legacy = r#"{"action":"update","id":"look","revision":"revision","options":{"name":"Look","attributes":["zoom"],"anchor":"start","append_filters":false}}"#;
    let edit: Edit = serde_json::from_str(legacy).unwrap();
    assert_eq!(serde_json::to_string(&edit).unwrap(), legacy);
}
