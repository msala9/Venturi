use super::*;
use vv_core::{
    Clip, ClipId, ClipSource, Rational, Timeline, Track, TrackKind, clipboard::ClipboardOrigin,
};

fn fixture() -> (PathBuf, Store, AssetFile) {
    let root = std::env::temp_dir().join(format!(
        "venturi-assets-store-{}-{}",
        std::process::id(),
        crate::asset_jobs::nonce()
    ));
    let store = Store::new(&root).unwrap();
    let mut session = vv_session::Session::default();
    let child = session.create_timeline(Timeline {
        name: "Nested".into(),
        fps: Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(9007199254740993),
            ClipSource::SolidColor,
            0,
            24,
            0,
            Rational::one(),
        ));
    session.sync_timeline_media(child);
    let media = session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(child))
        .unwrap()
        .0;
    let mut asset = asset_payload::capture(
        &session,
        media,
        "Native nested α",
        ClipboardOrigin {
            instance: 1,
            epoch: 2,
        },
    )
    .unwrap();
    asset.folder = Some("desktop-folder".into());
    (root, store, asset)
}
fn revision(store: &Store, id: &str, archived: bool) -> String {
    store.item(id, archived).unwrap()["revision"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn native_json_capture_update_backup_archive_restore_and_restart_preserve_payload_and_folder() {
    let (root, store, asset) = fixture();
    store.create("native-1", &asset).unwrap();
    let original = store.export("native-1").unwrap();
    store.create("native-1", &asset).unwrap();
    assert_eq!(store.export("native-1").unwrap(), original);
    let json: Value = serde_json::from_slice(&original).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 4);
    assert_eq!(json["version"], 1);
    assert_eq!(json["folder"], "desktop-folder");
    assert!(
        json["payload"]
            .as_str()
            .unwrap()
            .starts_with("venturi-clipboard/1\n")
    );
    let first = revision(&store, "native-1", false);
    store
        .edit(
            "rename",
            &Edit::Update {
                id: "native-1".into(),
                revision: first.clone(),
                name: "Renamed β".into(),
            },
        )
        .unwrap();
    let second = revision(&store, "native-1", false);
    assert_ne!(first, second);
    let loaded = store.load("native-1", &second).unwrap();
    assert_eq!(loaded.payload, asset.payload);
    assert_eq!(loaded.folder, asset.folder);
    assert!(store.load("native-1", &first).is_err());
    store
        .edit(
            "previous",
            &Edit::RestorePrevious {
                id: "native-1".into(),
                revision: second,
            },
        )
        .unwrap();
    assert_eq!(store.export("native-1").unwrap(), original);
    store
        .edit(
            "archive",
            &Edit::Archive {
                id: "native-1".into(),
                revision: first.clone(),
            },
        )
        .unwrap();
    assert!(store.item("native-1", false).is_err());
    assert_eq!(revision(&store, "native-1", true), first);
    store
        .edit(
            "restore",
            &Edit::Restore {
                id: "native-1".into(),
                revision: first.clone(),
            },
        )
        .unwrap();
    drop(store);
    let restarted = Store::new(&root).unwrap();
    assert_eq!(
        restarted.load("native-1", &first).unwrap().payload,
        asset.payload
    );
    assert_eq!(
        restarted
            .list(
                0,
                &Query {
                    project_epoch: "epoch".into(),
                    ..Default::default()
                }
            )
            .unwrap()["items"][0]["id"],
        "native-1"
    );
    drop(restarted);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn global_lock_cas_idempotent_create_and_malformed_assets_never_overwrite_native_data() {
    let (root, store, asset) = fixture();
    store.create("one", &asset).unwrap();
    let bytes = store.export("one").unwrap();
    let independent = Store::new(&root).unwrap();
    let lock = store.lock().unwrap();
    assert_eq!(
        independent.create("two", &asset).unwrap_err().1,
        "LIBRARY_BUSY"
    );
    drop(lock);
    let mut other = asset.clone();
    other.name = "different".into();
    assert_eq!(store.create("one", &other).unwrap_err().1, "FILE_EXISTS");
    assert_eq!(
        store
            .edit(
                "stale",
                &Edit::Update {
                    id: "one".into(),
                    revision: "old".into(),
                    name: "bad".into()
                }
            )
            .unwrap_err()
            .1,
        "ASSET_CHANGED"
    );
    for id in ["../one", "/one", "a/b", ".hidden", ""] {
        assert!(store.create(id, &asset).is_err());
    }
    other.version = 2;
    assert!(store.create("malformed", &other).is_err());
    assert_eq!(store.export("one").unwrap(), bytes);
    assert!(!root.join("assets/malformed.json").exists());
    assert!(
        serde_json::from_value::<Edit>(
            json!({"action":"update","id":"one","revision":"x","name":"ok","payload":"forged"})
        )
        .is_err()
    );
    drop(independent);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn nofollow_regular_file_and_pinned_directory_checks_preserve_foreign_links() {
    use std::os::unix::fs::symlink;
    let (root, store, asset) = fixture();
    let outside = root.join("foreign.json");
    std::fs::write(&outside, b"foreign").unwrap();
    symlink(&outside, root.join("assets/link.json")).unwrap();
    assert!(store.item("link", false).is_err());
    assert!(store.create("link", &asset).is_err());
    assert_eq!(std::fs::read(&outside).unwrap(), b"foreign");
    std::fs::rename(root.join("media"), root.join("old-media")).unwrap();
    std::fs::create_dir(root.join("media")).unwrap();
    assert_eq!(
        store.create("replaced", &asset).unwrap_err().1,
        "ASSET_CHANGED"
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn listing_is_shallow_paged_and_reports_bad_native_json_without_importing_it() {
    let (root, store, asset) = fixture();
    for index in 0..33 {
        store.create(&format!("asset-{index:02}"), &asset).unwrap();
    }
    std::fs::write(root.join("assets/invalid.json"), b"{}").unwrap();
    let first = store.list(0, &Query::default()).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 32);
    assert_eq!(first["pages"], 2);
    let second = store.list(1, &Query::default()).unwrap();
    assert_eq!(second["items"].as_array().unwrap().len(), 2);
    assert!(
        second["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["id"] == "invalid" && i["error"].is_string())
    );
    assert!(store.list(usize::MAX, &Query::default()).is_err());
    assert!(
        store
            .list(
                0,
                &Query {
                    search: "x".repeat(129),
                    ..Default::default()
                }
            )
            .is_err()
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
