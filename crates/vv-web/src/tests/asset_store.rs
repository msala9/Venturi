use super::*;

impl Store {
    fn restore_for_test(&self, command: &str, edit: &Edit) -> Result<()> {
        self.restore_previous(edit, restore_receipt(self, command, edit))
    }
}
fn restore_receipt(store: &Store, command: &str, edit: &Edit) -> Completion {
    let Edit::RestorePrevious { id, revision } = edit else {
        panic!("Expected RestorePrevious")
    };
    let mut completion = receipt(store, command);
    completion.receipt["restored_native_asset"] = json!({"id":id,"revision":revision});
    completion
}

#[test]
fn asset_restore_previous_recovers_pair_and_keeps_receipt_until_acknowledged() {
    for cut in [1, 2] {
        let (root, store, asset) = fixture();
        store.create("swap-restart", &asset).unwrap();
        let original = store.export("swap-restart").unwrap();
        store
            .edit(
                "update",
                &Edit::Update {
                    id: "swap-restart".into(),
                    revision: revision(&store, "swap-restart", false),
                    name: "Changed".into(),
                },
            )
            .unwrap();
        let changed = store.export("swap-restart").unwrap();
        let edit = Edit::RestorePrevious {
            id: "swap-restart".into(),
            revision: revision(&store, "swap-restart", false),
        };
        let completion = restore_receipt(&store, "restore-restart", &edit);
        let mut invalid = completion.clone();
        invalid.receipt["restored_native_asset"]["id"] = json!("another");
        assert!(store.restore_previous(&edit, invalid).is_err());
        assert_eq!(store.export("swap-restart").unwrap(), changed);
        {
            let _global = store.lock().unwrap();
            let _catalog = store.catalog_lock(true).unwrap();
            let mut prepared = store
                .prepare_restore_previous(&edit, completion.clone())
                .unwrap();
            prepared.stop_after_targets_for_test(cut);
            assert_eq!(
                prepared
                    .commit(
                        &store.directories().unwrap().directory,
                        &store.directories().unwrap().assets,
                        &AtomicBool::new(false)
                    )
                    .unwrap_err()
                    .1,
                "ASSET_TEST_INTERRUPTED"
            );
        }
        drop(store);
        let store = Store::new(&root).unwrap();
        assert_eq!(store.export("swap-restart").unwrap(), original);
        assert_eq!(
            std::fs::read(root.join("assets/swap-restart.json.bak")).unwrap(),
            changed
        );
        assert_eq!(
            store
                .completion(&completion.command_id, &completion.project_root_binding)
                .unwrap()
                .unwrap(),
            (completion.fingerprint, completion.receipt.clone())
        );
        store.restore_previous(&edit, completion.clone()).unwrap();
        assert_eq!(store.export("swap-restart").unwrap(), original);
        let mut conflict = completion.clone();
        conflict.fingerprint = [8; 32];
        assert_eq!(
            store.restore_previous(&edit, conflict).unwrap_err().1,
            "COMMAND_ID_REUSED"
        );
        store
            .acknowledge_completion(
                &completion.command_id,
                completion.fingerprint,
                &completion.project_root_binding,
            )
            .unwrap();
        assert!(
            store
                .completions(&completion.project_root_binding)
                .unwrap()
                .is_empty()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
use vv_core::{
    Clip, ClipId, ClipSource, Rational, Timeline, Track, TrackKind, clipboard::ClipboardOrigin,
};

#[test]
fn unavailable_asset_store_never_creates_its_root_and_retry_cannot_replace_a_pinned_catalog() {
    let root = std::env::temp_dir().join(format!(
        "vv-unavailable-asset-store-{}",
        crate::asset_jobs::nonce()
    ));
    let store = Store::configured(&root).unwrap();
    let clone = store.clone();
    assert!(!root.exists());
    assert_eq!(store.folders().unwrap_err().1, "LIBRARY_UNAVAILABLE");
    drop(Store::new(&root).unwrap());
    assert_eq!(clone.folders().unwrap_err().1, "LIBRARY_UNAVAILABLE");
    store.retry().unwrap();
    assert_eq!(clone.folders().unwrap()["folders"], json!([]));
    let previous = root.with_extension("previous");
    std::fs::rename(&root, &previous).unwrap();
    drop(Store::new(&root).unwrap());
    assert!(store.retry().is_err());
    assert_eq!(clone.folders().unwrap_err().1, "ASSET_CHANGED");
    drop(clone);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(previous).unwrap();
}

#[test]
fn native_pool_browse_filters_sparse_catalog_before_paging_and_preserves_legacy_queries() {
    let (root, store, mut asset) = fixture();
    apply_folder(
        &store,
        "wanted",
        &Edit::CreateFolder {
            folders_revision: folders_revision(&store),
            name: "Wanted".into(),
            parent: None,
        },
    );
    for index in 0..40 {
        asset.name = format!("Shot {:02}", 39 - index);
        asset.folder = if index >= 34 {
            Some("wanted".into())
        } else {
            None
        };
        store.create(&format!("asset-{index:02}"), &asset).unwrap();
    }
    let query = Query {
        sort: Some(SortKey::Name),
        folder: Some("wanted".into()),
        folders_revision: Some(folders_revision(&store)),
        ..Default::default()
    };
    let rows = store.list(0, &query).unwrap();
    assert_eq!(rows["total"], 6);
    assert_eq!(rows["catalog_total"], 40);
    assert_eq!(rows["pages"], 1);
    assert_eq!(
        rows["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "asset-39", "asset-38", "asset-37", "asset-36", "asset-35", "asset-34"
        ]
    );
    assert!(store.list(1, &query).is_err());
    let search = Query {
        search: " Shot 00 ".into(),
        ..query.clone()
    };
    assert_eq!(
        store.list(0, &search).unwrap()["items"][0]["id"],
        "asset-39"
    );
    assert_eq!(store.list(0, &search).unwrap()["total"], 1);
    let all = Query {
        sort: Some(SortKey::Name),
        ..Default::default()
    };
    let first = store.list(0, &all).unwrap();
    let last = store.list(1, &all).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 32);
    assert_eq!(last["items"].as_array().unwrap().len(), 8);
    assert_eq!(first["items"][0]["id"], "asset-39");
    assert_eq!(last["items"][7]["id"], "asset-00");
    let legacy = store
        .list(
            0,
            &Query {
                folder: Some("wanted".into()),
                folders_revision: Some(folders_revision(&store)),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(legacy["total"], 40);
    assert_eq!(legacy["pages"], 2);
    assert_eq!(legacy["items"], json!([]));
    let stale = Query {
        folders_revision: Some("stale".into()),
        ..query
    };
    assert_eq!(store.list(0, &stale).unwrap_err().1, "FOLDERS_CHANGED");
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

fn native_pool_file_asset(
    store: &Store,
    name: &str,
    frames: i64,
    fps: Rational,
    video: bool,
    audio: bool,
) -> AssetFile {
    let mut session = vv_session::Session::default();
    let media = session.add_media(
        store.root().join("media/0123456789abcdef/offline.mov"),
        vv_core::MediaMeta {
            duration_frames: frames,
            fps,
            width: if video { 1920 } else { 0 },
            height: if video { 1080 } else { 0 },
            has_video: video,
            has_audio: audio,
            sample_rate: if audio { 48000 } else { 0 },
            channels: if audio { 2 } else { 0 },
            audio_streams: 0,
            file: Default::default(),
        },
    );
    asset_payload::capture(
        &session,
        media,
        name,
        ClipboardOrigin {
            instance: 1,
            epoch: 1,
        },
    )
    .unwrap()
}

#[test]
fn native_pool_browse_native_duration_name_ties_root_metadata_invalid_and_archived_rows() {
    let (root, store, timeline) = fixture();
    for (id, name, frames, fps) in [
        ("a", "Beta", 48, 24),
        ("b", "alpha", 60, 30),
        ("c", "Alpha", 25, 25),
        ("d", "alpha", 48, 24),
    ] {
        store
            .create(
                id,
                &native_pool_file_asset(&store, name, frames, Rational::new(fps, 1), true, true),
            )
            .unwrap();
    }
    let query = Query {
        sort: Some(SortKey::Duration),
        ..Default::default()
    };
    let rows = store.list(0, &query).unwrap();
    assert_eq!(
        rows["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["c", "b", "d", "a"]
    );
    let descending = store
        .list(
            0,
            &Query {
                descending: true,
                ..query.clone()
            },
        )
        .unwrap();
    assert_eq!(
        descending["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["a", "b", "d", "c"]
    );
    let first = &rows["items"][0];
    assert_eq!(first["missing_count"], 1);
    assert_eq!(
        first["presentation"],
        json!({"kind":"video","width":1920,"height":1080,"fps":{"num":25,"den":1},"duration_frames":25,
        "is_image":false,"has_video":true,"has_audio":true,"sample_rate":48000,"channels":2,"audio_streams":1})
    );
    assert!(
        !serde_json::to_string(&rows)
            .unwrap()
            .contains(root.to_str().unwrap())
    );
    let mut orphan = timeline;
    orphan.folder = Some("removed-folder".into());
    store.create("orphan", &orphan).unwrap();
    store
        .create(
            "audio",
            &native_pool_file_asset(&store, "Audio", 48, Rational::new(24, 1), false, true),
        )
        .unwrap();
    store
        .create(
            "image",
            &native_pool_file_asset(
                &store,
                "Image",
                vv_core::IMAGE_DURATION_FRAMES,
                Rational::new(24, 1),
                true,
                false,
            ),
        )
        .unwrap();
    std::fs::write(root.join("assets/broken.json"), b"{}").unwrap();
    let roots = store
        .list(
            0,
            &Query {
                sort: Some(SortKey::Name),
                folder: Some(String::new()),
                folders_revision: Some(folders_revision(&store)),
                ..Default::default()
            },
        )
        .unwrap();
    let rows = roots["items"].as_array().unwrap();
    for (id, kind) in [
        ("orphan", "timeline"),
        ("audio", "audio"),
        ("image", "image"),
    ] {
        let row = rows.iter().find(|row| row["id"] == id).unwrap();
        assert_eq!(row["presentation"]["kind"], kind);
    }
    let orphan = rows.iter().find(|row| row["id"] == "orphan").unwrap();
    assert_eq!(orphan["folder"], "removed-folder");
    assert!(orphan["effective_folder"].is_null());
    assert!(
        rows.iter()
            .any(|row| row["id"] == "broken" && row["error"].is_string())
    );
    store
        .edit(
            "archive",
            &Edit::Archive {
                id: "b".into(),
                revision: revision(&store, "b", false),
            },
        )
        .unwrap();
    let archived = store
        .list(
            0,
            &Query {
                archived: true,
                ..query
            },
        )
        .unwrap();
    assert_eq!(archived["total"], 1);
    assert_eq!(archived["items"][0]["id"], "b");
    assert_eq!(archived["items"][0]["presentation"]["kind"], "video");
    assert!(archived["items"][0]["placement"]["error"].is_string());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_pool_browse_strict_query_and_metadata_budget_refuse_partial_catalog_results() {
    let (root, store, asset) = fixture();
    store.create("good", &asset).unwrap();
    for value in [
        json!({"sort":"size"}),
        json!({"sort":"name","descending":"yes"}),
        json!({"sort":"name","unknown":true}),
    ] {
        assert!(serde_json::from_value::<Query>(value).is_err());
    }
    let query = Query {
        sort: Some(SortKey::Name),
        ..Default::default()
    };
    assert!(store.list(usize::MAX, &query).is_err());
    assert!(
        store
            .list(
                0,
                &Query {
                    search: "x".repeat(129),
                    ..query.clone()
                }
            )
            .is_err()
    );
    for index in 0..4 {
        File::create(root.join(format!("assets/budget-{index}.json")))
            .unwrap()
            .set_len(MAX_JSON)
            .unwrap();
    }
    let before = store.export("good").unwrap();
    assert_eq!(store.list(0, &query).unwrap_err().1, "ASSET_CATALOG_BUDGET");
    assert_eq!(store.export("good").unwrap(), before);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn deliberate_relink_default_serialization_preserves_legacy_mutation_identity() {
    for value in [
        json!({"action":"relink","id":"asset","revision":"revision","path_tokens":["take.mp4"]}),
        json!({"action":"relink_folder","id":"asset","revision":"revision","directory_token":"Takes"}),
    ] {
        let edit: Edit = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&edit).unwrap(), value);
        let mut explicit_false = value.clone();
        explicit_false["replace_content"] = json!(false);
        assert_eq!(
            serde_json::to_value(serde_json::from_value::<Edit>(explicit_false).unwrap()).unwrap(),
            value
        );
        let mut replacement = value;
        replacement["replace_content"] = json!(true);
        assert_eq!(
            serde_json::to_value(serde_json::from_value::<Edit>(replacement.clone()).unwrap())
                .unwrap(),
            replacement
        );
        replacement["replace_content"] = json!("true");
        assert!(serde_json::from_value::<Edit>(replacement).is_err());
    }
}

#[test]
fn deliberate_relink_uses_native_fps_crop_adaptation_preserves_ids_and_durable_report() {
    use vv_core::{Command, Id, Interpolation, MediaItem, MediaMeta, TransformParam};
    let (root, store, _) = fixture();
    let old_path = root.join("media/0123456789abcdef/take.mp4");
    let mut session = vv_session::Session::default();
    let media = session.project.media_pool.insert(MediaItem {
        path: old_path.clone(),
        meta: MediaMeta {
            duration_frames: 96,
            fps: Rational::new(48, 1),
            width: 16,
            height: 16,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 0x0123456789abcdef,
        compound: None,
        folder: None,
    });
    let mut clip = Clip::from_source_range(
        ClipId(9007199254740993),
        ClipSource::Media(media),
        4,
        28,
        12,
        Rational::new(1, 2),
    );
    clip.effects
        .transform
        .track_mut(TransformParam::CropLeft)
        .default = 4.0;
    clip.effects.gain_db.upsert(12, -6.0, Interpolation::Linear);
    let mut track = Track::new(TrackKind::Video);
    track.clips.push(clip);
    let child = session.create_timeline(Timeline {
        name: "Replacement child".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 64),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let compound = session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let asset = asset_payload::capture(
        &session,
        compound,
        "Replacement asset",
        ClipboardOrigin {
            instance: 1,
            epoch: 2,
        },
    )
    .unwrap();
    store.create("replacement", &asset).unwrap();
    let before = store.export("replacement").unwrap();
    let old_payload = asset_payload::decode(&asset).unwrap();
    let old_id = old_payload
        .fragment()
        .media_pool
        .iter()
        .find(|(_, item)| item.compound.is_none())
        .unwrap()
        .0;
    let bytes = b"owned replacement fixture bytes";
    let sha = format!("{:x}", Sha256::digest(bytes));
    let directory = directory(store.media().unwrap(), &sha).unwrap();
    drop(directory);
    let new_path = root.join("media").join(&sha).join("take.mp4");
    std::fs::write(&new_path, bytes).unwrap();
    let new_meta = MediaMeta {
        duration_frames: 120,
        fps: Rational::new(30, 1),
        width: 32,
        height: 48,
        has_video: true,
        has_audio: false,
        sample_rate: 0,
        channels: 0,
        audio_streams: 0,
        file: Default::default(),
    };
    let mut expected = old_payload.fragment().clone();
    vv_core::SetMediaPath::new(old_id, new_path.clone(), 77, Some(new_meta.clone()))
        .apply(&mut expected);
    let edit = Edit::Relink {
        id: "replacement".into(),
        revision: revision(&store, "replacement", false),
        path_tokens: vec!["take.mp4".into()],
        replace_content: true,
    };
    let replacements = std::collections::BTreeMap::from([(
        old_path.clone(),
        RelinkedFile {
            path: new_path.clone(),
            content_hash: 77,
            meta: new_meta.clone(),
            source_token: "take.mp4".into(),
        },
    )]);
    let mut prepared = store
        .prepare_relink(
            &edit,
            &replacements,
            &std::collections::HashSet::from([old_path.clone()]),
            receipt(&store, "native-replacement"),
            &AtomicBool::new(false),
        )
        .unwrap();
    let report = prepared.summary();
    assert_eq!(report["replace_content"], true);
    assert_eq!(report["replaced_files"], 1);
    assert_eq!(
        report["replacement_digest"],
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&report["replacements"]).unwrap())
        )
    );
    assert_eq!(
        report["replacements"][0]["media"][0]["media_id"],
        old_id.raw().to_string()
    );
    assert_eq!(report["replacements"][0]["after"]["meta"], json!(new_meta));
    assert_eq!(store.export("replacement").unwrap(), before);
    store
        .commit_edit(&mut prepared, &AtomicBool::new(false))
        .unwrap();
    let after = asset_payload::parse(&store.export("replacement").unwrap()).unwrap();
    let actual = asset_payload::decode(&after).unwrap();
    assert_eq!(json!(actual.origin), json!(old_payload.origin));
    assert_eq!(actual.media_ids(), old_payload.media_ids());
    assert_eq!(
        actual.fragment().media_pool.keys().collect::<Vec<_>>(),
        old_payload.fragment().media_pool.keys().collect::<Vec<_>>()
    );
    assert_eq!(
        json!(actual.fragment().timelines),
        json!(expected.timelines),
        "native SetMediaPath owns key/FPS/crop adaptation"
    );
    assert_eq!(
        json!(actual.fragment().media_pool[old_id]),
        json!(expected.media_pool[old_id])
    );
    for (_, item) in &actual.fragment().media_pool {
        if let Some(timeline) = item.compound {
            assert_eq!(
                json!(item.meta),
                json!(actual.fragment().timelines[timeline].compound_meta())
            );
        }
    }
    let binding = asset_journal::project_binding(&store.directories().unwrap().directory).unwrap();
    drop(prepared);
    drop(store);
    let reopened = Store::new(&root).unwrap();
    let completion = reopened
        .completion("native-replacement", &binding)
        .unwrap()
        .unwrap();
    assert_eq!(
        completion.1["replacement_digest"],
        report["replacement_digest"]
    );
    assert_eq!(completion.1["replaced_files"], 1);
    assert!(completion.1.get("replacements").is_none());
    assert_eq!(
        std::fs::read(root.join("assets/replacement.json.bak")).unwrap(),
        before
    );
    assert!(!old_path.exists());
    assert_eq!(std::fs::read(&new_path).unwrap(), bytes);
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

fn delete_file_asset(store: &Store) -> (PathBuf, AssetFile) {
    let directory = directory(store.media().unwrap(), "0123456789abcdef").unwrap();
    drop(directory);
    let path = store.root().join("media/0123456789abcdef/owned.mp4");
    std::fs::write(&path, b"owned native media bytes").unwrap();
    let mut session = vv_session::Session::default();
    let media = session.add_media(
        path.clone(),
        vv_core::MediaMeta {
            duration_frames: 24,
            fps: Rational::new(24, 1),
            width: 16,
            height: 16,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
    );
    let asset = asset_payload::capture(
        &session,
        media,
        "Native deletion fixture",
        ClipboardOrigin {
            instance: 1,
            epoch: 1,
        },
    )
    .unwrap();
    (path, asset)
}

#[test]
fn delete_assets_uses_current_archive_and_backup_references_and_preserves_project_copies() {
    let (root, store, _) = fixture();
    let (media, asset) = delete_file_asset(&store);
    let copy = root.join("project-copy.mp4");
    std::fs::copy(&media, &copy).unwrap();
    store.create("first", &asset).unwrap();
    store.create("second", &asset).unwrap();
    store
        .edit(
            "archive-second",
            &Edit::Archive {
                id: "second".into(),
                revision: revision(&store, "second", false),
            },
        )
        .unwrap();
    let first = Edit::DeleteAssets {
        items: vec![AssetRef {
            id: "first".into(),
            revision: revision(&store, "first", false),
        }],
        archived: false,
    };
    let mut prepared = store
        .prepare_edit(
            &first,
            receipt(&store, "delete-first"),
            &AtomicBool::new(false),
        )
        .unwrap();
    let backup = serde_json::to_vec(&asset).unwrap();
    std::fs::write(root.join("assets/late.json.bak"), &backup).unwrap();
    store
        .commit_edit(&mut prepared, &AtomicBool::new(false))
        .unwrap();
    assert!(!root.join("assets/first.json").exists());
    assert!(media.exists());
    let archived = Edit::DeleteAssets {
        items: vec![AssetRef {
            id: "second".into(),
            revision: revision(&store, "second", true),
        }],
        archived: true,
    };
    apply_folder(&store, "delete-archive", &archived);
    assert!(!root.join("assets/second.json.deleted").exists());
    assert!(media.exists());
    assert_eq!(
        std::fs::read(root.join("assets/late.json.bak")).unwrap(),
        backup
    );
    std::fs::remove_file(root.join("assets/late.json.bak")).unwrap();
    store.create("third", &asset).unwrap();
    std::fs::write(
        root.join("assets/uncertain.json.deleted"),
        b"unsupported retained metadata",
    )
    .unwrap();
    apply_folder(
        &store,
        "delete-uncertain",
        &Edit::DeleteAssets {
            items: vec![AssetRef {
                id: "third".into(),
                revision: revision(&store, "third", false),
            }],
            archived: false,
        },
    );
    assert!(!root.join("assets/third.json").exists());
    assert!(media.exists());
    std::fs::remove_file(root.join("assets/uncertain.json.deleted")).unwrap();
    let mut unmanaged = asset.clone();
    let mut payload = asset_payload::decode(&unmanaged).unwrap();
    payload.files_mut().next().unwrap().path = root.join("outside/owned.mp4");
    unmanaged.payload = payload.to_text();
    asset_payload::decode(&unmanaged).unwrap();
    std::fs::write(
        root.join("assets/unmanaged.json.bak"),
        serde_json::to_vec(&unmanaged).unwrap(),
    )
    .unwrap();
    store.create("uncertain-path", &asset).unwrap();
    apply_folder(
        &store,
        "delete-unmanaged-reference",
        &Edit::DeleteAssets {
            items: vec![AssetRef {
                id: "uncertain-path".into(),
                revision: revision(&store, "uncertain-path", false),
            }],
            archived: false,
        },
    );
    assert!(!root.join("assets/uncertain-path.json").exists());
    assert!(media.exists());
    std::fs::remove_file(root.join("assets/unmanaged.json.bak")).unwrap();
    store.create("last", &asset).unwrap();
    apply_folder(
        &store,
        "delete-last",
        &Edit::DeleteAssets {
            items: vec![AssetRef {
                id: "last".into(),
                revision: revision(&store, "last", false),
            }],
            archived: false,
        },
    );
    assert!(!media.exists());
    assert_eq!(std::fs::read(copy).unwrap(), b"owned native media bytes");
    drop(prepared);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn delete_assets_revision_cancel_malformed_selected_and_foreign_media_are_fail_closed() {
    let (root, store, solid) = fixture();
    store.create("first", &solid).unwrap();
    store.create("second", &solid).unwrap();
    let first = AssetRef {
        id: "first".into(),
        revision: revision(&store, "first", false),
    };
    for items in [
        vec![],
        vec![first.clone(), first.clone()],
        vec![
            first.clone(),
            AssetRef {
                id: "second".into(),
                revision: "0".repeat(64),
            },
        ],
        vec![first.clone(); 33],
    ] {
        assert!(
            store
                .prepare_edit(
                    &Edit::DeleteAssets {
                        items,
                        archived: false
                    },
                    receipt(&store, "invalid-delete"),
                    &AtomicBool::new(false)
                )
                .is_err()
        );
        assert!(root.join("assets/first.json").exists());
        assert!(root.join("assets/second.json").exists());
    }
    let mut prepared = store
        .prepare_edit(
            &Edit::DeleteAssets {
                items: vec![first],
                archived: false,
            },
            receipt(&store, "canceled-delete"),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(
        store
            .commit_edit(&mut prepared, &AtomicBool::new(true))
            .unwrap_err()
            .1,
        "ASSET_CANCELED"
    );
    assert!(root.join("assets/first.json").exists());
    let invalid = b"not an asset";
    std::fs::write(root.join("assets/invalid.json"), invalid).unwrap();
    let invalid_revision = format!("{:x}", Sha256::digest(invalid));
    assert!(
        store
            .prepare_edit(
                &Edit::DeleteAssets {
                    items: vec![AssetRef {
                        id: "invalid".into(),
                        revision: invalid_revision
                    }],
                    archived: false
                },
                receipt(&store, "malformed-delete"),
                &AtomicBool::new(false)
            )
            .is_err()
    );
    std::fs::remove_file(root.join("assets/invalid.json")).unwrap();
    let (media, asset) = delete_file_asset(&store);
    store.create("file", &asset).unwrap();
    let mut file_delete = store
        .prepare_edit(
            &Edit::DeleteAssets {
                items: vec![AssetRef {
                    id: "file".into(),
                    revision: revision(&store, "file", false),
                }],
                archived: false,
            },
            receipt(&store, "foreign-media-delete"),
            &AtomicBool::new(false),
        )
        .unwrap();
    std::fs::write(&media, b"foreign replacement bytes").unwrap();
    store
        .commit_edit(&mut file_delete, &AtomicBool::new(false))
        .unwrap();
    assert!(!root.join("assets/file.json").exists());
    assert_eq!(std::fs::read(media).unwrap(), b"foreign replacement bytes");
    drop(file_delete);
    drop(prepared);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn delete_assets_maximum_ordered_receipt_survives_reopen_with_native_32_id_budget() {
    let (root, store, asset) = fixture();
    let mut items = Vec::new();
    for index in 0..32 {
        let id = format!("{}{:03}", "a".repeat(77), index);
        store.create(&id, &asset).unwrap();
        items.push(AssetRef {
            revision: revision(&store, &id, false),
            id,
        });
    }
    let ids = items.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
    let command = "d".repeat(80);
    let mut prepared = store
        .prepare_edit(
            &Edit::DeleteAssets {
                items,
                archived: false,
            },
            receipt(&store, &command),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(
        prepared.summary(),
        json!({"deleted_assets":32,"deleted_ids":ids})
    );
    store
        .commit_edit(&mut prepared, &AtomicBool::new(false))
        .unwrap();
    let binding = asset_journal::project_binding(&store.directories().unwrap().directory).unwrap();
    let expected = store.completion(&command, &binding).unwrap().unwrap();
    assert_eq!(expected.1["deleted_ids"], json!(ids));
    assert_eq!(expected.1["deleted_assets"], 32);
    assert!(
        ids.iter()
            .all(|id| !root.join("assets").join(format!("{id}.json")).exists())
    );
    drop(prepared);
    drop(store);
    let store = Store::new(&root).unwrap();
    assert_eq!(
        store.completion(&command, &binding).unwrap().unwrap(),
        expected
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_placement_metadata_describes_only_the_selected_root_without_native_format_changes()
{
    let (root, store, asset) = fixture();
    store.create("placement", &asset).unwrap();
    let encoded = store.export("placement").unwrap();
    let row = store.item("placement", false).unwrap();
    assert_eq!(row["placement"]["error"], Value::Null);
    assert_eq!(row["placement"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        row["placement"]["items"][0],
        json!({"source_in":0,"source_out":24,"fps":{"num":24,"den":1},"has_video":true,"has_audio":false,"audio_streams":0,"is_image":false})
    );
    assert_eq!(store.export("placement").unwrap(), encoded);
    store
        .edit(
            "archive-placement",
            &Edit::Archive {
                id: "placement".into(),
                revision: row["revision"].as_str().unwrap().into(),
            },
        )
        .unwrap();
    let archived = store.item("placement", true).unwrap();
    assert_eq!(archived["placement"]["items"], json!([]));
    assert!(archived["placement"]["error"].is_string());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_pending_marker_blocks_web_reads_and_writes_without_touching_foreign_recovery_data() {
    use std::os::unix::fs::symlink;
    let (root, store, asset) = fixture();
    store.create("native", &asset).unwrap();
    let before = store.export("native").unwrap();
    let marker = root.join(".venturi-native-assets-pending.json");
    std::fs::write(&marker, b"native recovery content").unwrap();
    assert_eq!(store.item("native", false).unwrap_err().1, "LIBRARY_BUSY");
    assert_eq!(store.create("new", &asset).unwrap_err().1, "LIBRARY_BUSY");
    assert_eq!(std::fs::read(&marker).unwrap(), b"native recovery content");
    std::fs::remove_file(&marker).unwrap();
    let foreign = root.join("foreign.json");
    std::fs::write(&foreign, b"foreign").unwrap();
    symlink(&foreign, &marker).unwrap();
    assert_eq!(store.export("native").unwrap_err().1, "LIBRARY_BUSY");
    assert_eq!(store.lock().unwrap_err().1, "LIBRARY_BUSY");
    assert!(
        std::fs::symlink_metadata(&marker)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign");
    std::fs::remove_file(&marker).unwrap();
    assert_eq!(store.export("native").unwrap(), before);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

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
        .restore_for_test(
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

fn receipt(store: &Store, id: &str) -> Completion {
    Completion {
        version: 1,
        command_id: id.into(),
        fingerprint: [3; 32],
        project_root_binding: asset_journal::project_binding(
            &store.directories().unwrap().directory,
        )
        .unwrap(),
        receipt: json!({"command_id":id,"status":"applied","library_durable":true}),
    }
}
fn folders_revision(store: &Store) -> String {
    store.folders().unwrap()["folders_revision"]
        .as_str()
        .unwrap()
        .into()
}
fn apply_folder(store: &Store, id: &str, edit: &Edit) {
    let mut prepared = store
        .prepare_edit(edit, receipt(store, id), &AtomicBool::new(false))
        .unwrap();
    store
        .commit_edit(&mut prepared, &AtomicBool::new(false))
        .unwrap();
}

#[test]
fn remove_folder_reparents_direct_native_children_and_active_assets_preserving_archives_backup_and_payload()
 {
    let (root, store, mut asset) = fixture();
    for (id, parent) in [
        ("parent", None),
        ("removed", Some("parent")),
        ("direct", Some("removed")),
        ("deep", Some("direct")),
    ] {
        apply_folder(
            &store,
            id,
            &Edit::CreateFolder {
                folders_revision: folders_revision(&store),
                name: id.into(),
                parent: parent.map(str::to_owned),
            },
        );
    }
    asset.folder = Some("removed".into());
    store.create("active", &asset).unwrap();
    store.create("archived", &asset).unwrap();
    let archived_rev = revision(&store, "archived", false);
    store
        .edit(
            "archive",
            &Edit::Archive {
                id: "archived".into(),
                revision: archived_rev,
            },
        )
        .unwrap();
    let archived = std::fs::read(root.join("assets/archived.json.deleted")).unwrap();
    let original = store.export("active").unwrap();
    std::fs::write(root.join("assets/active.json.bak"), &original).unwrap();
    apply_folder(
        &store,
        "remove-command",
        &Edit::RemoveFolder {
            id: "removed".into(),
            folders_revision: folders_revision(&store),
        },
    );
    let tree = store.folders().unwrap();
    assert!(
        tree["folders"]
            .as_array()
            .unwrap()
            .iter()
            .all(|folder| folder["id"] != "removed")
    );
    assert_eq!(
        tree["folders"]
            .as_array()
            .unwrap()
            .iter()
            .find(|folder| folder["id"] == "direct")
            .unwrap()["parent"],
        "parent"
    );
    assert_eq!(
        tree["folders"]
            .as_array()
            .unwrap()
            .iter()
            .find(|folder| folder["id"] == "deep")
            .unwrap()["parent"],
        "direct"
    );
    let moved = asset_payload::parse(&store.export("active").unwrap()).unwrap();
    assert_eq!(moved.folder.as_deref(), Some("parent"));
    assert_eq!(moved.payload, asset.payload);
    assert_eq!(
        std::fs::read(root.join("assets/archived.json.deleted")).unwrap(),
        archived
    );
    assert_eq!(
        std::fs::read(root.join("assets/active.json.bak")).unwrap(),
        original
    );
    assert_eq!(store.item("archived", true).unwrap()["folder"], "removed");
    assert!(store.item("archived", true).unwrap()["effective_folder"].is_null());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn batch_moves_guard_unchanged_folder_tree_and_noop_asset_revisions_without_rewriting_native_json()
{
    let (root, store, mut asset) = fixture();
    apply_folder(
        &store,
        "dest",
        &Edit::CreateFolder {
            folders_revision: folders_revision(&store),
            name: "Destination".into(),
            parent: None,
        },
    );
    asset.folder = Some("dest".into());
    store.create("one", &asset).unwrap();
    let edit = Edit::MoveAssets {
        folders_revision: folders_revision(&store),
        items: vec![AssetRef {
            id: "one".into(),
            revision: revision(&store, "one", false),
        }],
        folder: Some("dest".into()),
    };
    let mut prepared = store
        .prepare_edit(&edit, receipt(&store, "old-plan"), &AtomicBool::new(false))
        .unwrap();
    let native_folders = std::fs::read(root.join("folders.json")).unwrap();
    store
        .edit(
            "rename-asset",
            &Edit::Update {
                id: "one".into(),
                revision: revision(&store, "one", false),
                name: "Changed".into(),
            },
        )
        .unwrap();
    assert_eq!(
        store
            .commit_edit(&mut prepared, &AtomicBool::new(false))
            .unwrap_err()
            .1,
        "ASSET_JOURNAL_CONFLICT"
    );
    drop(prepared);
    let edit = Edit::MoveAssets {
        folders_revision: folders_revision(&store),
        items: vec![AssetRef {
            id: "one".into(),
            revision: revision(&store, "one", false),
        }],
        folder: None,
    };
    let mut prepared = store
        .prepare_edit(
            &edit,
            receipt(&store, "stale-tree"),
            &AtomicBool::new(false),
        )
        .unwrap();
    apply_folder(
        &store,
        "rename-dest",
        &Edit::RenameFolder {
            id: "dest".into(),
            folders_revision: folders_revision(&store),
            name: "Renamed".into(),
        },
    );
    assert_eq!(
        store
            .commit_edit(&mut prepared, &AtomicBool::new(false))
            .unwrap_err()
            .1,
        "ASSET_JOURNAL_CONFLICT"
    );
    drop(prepared);
    let bytes = std::fs::read(root.join("folders.json")).unwrap();
    apply_folder(
        &store,
        "move-ok",
        &Edit::MoveAssets {
            folders_revision: folders_revision(&store),
            items: vec![AssetRef {
                id: "one".into(),
                revision: revision(&store, "one", false),
            }],
            folder: None,
        },
    );
    assert_eq!(std::fs::read(root.join("folders.json")).unwrap(), bytes);
    assert_ne!(native_folders, bytes);
    assert!(store.item("one", false).unwrap()["folder"].is_null());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_folder_queries_keep_candidate_paging_and_orphan_metadata_and_revision_guards() {
    let (root, store, asset) = fixture();
    assert_eq!(folders_revision(&store), "absent");
    store.create("orphan", &asset).unwrap();
    let query = Query {
        folder: Some(String::new()),
        folders_revision: Some("absent".into()),
        ..Default::default()
    };
    let listed = store.list(0, &query).unwrap();
    assert_eq!(listed["items"][0]["folder"], "desktop-folder");
    assert!(listed["items"][0]["effective_folder"].is_null());
    apply_folder(
        &store,
        "folder",
        &Edit::CreateFolder {
            folders_revision: "absent".into(),
            name: "Folder".into(),
            parent: None,
        },
    );
    assert!(store.list(0, &query).is_err());
    let bad = Edit::MoveAssets {
        folders_revision: folders_revision(&store),
        items: vec![AssetRef {
            id: "orphan".into(),
            revision: "stale".into(),
        }],
        folder: None,
    };
    assert!(
        store
            .prepare_edit(&bad, receipt(&store, "bad"), &AtomicBool::new(false))
            .is_err()
    );
    assert!(store.raw_limit("orphan.json", 1).is_err());
    let original = store.export("orphan").unwrap();
    assert_eq!(
        asset_payload::parse(&original).unwrap().folder,
        asset.folder
    );
    assert!(
        store
            .completion(
                "bad",
                &asset_journal::project_binding(&store.directories().unwrap().directory).unwrap()
            )
            .unwrap()
            .is_none()
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
