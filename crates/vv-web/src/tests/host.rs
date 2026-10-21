use super::*;

#[test]
fn large_import_receipts_retire_the_cache_by_bytes_before_new_preparation() {
    let (root, mut editor, _) = native_asset_fixture("receipt-byte-budget");
    let epoch = editor.command_epoch;
    for index in 0..16 {
        editor.completed.insert(
            format!("large-{index}"),
            (
                [0; 32],
                Ok(json!({"status":"applied","errors":"x".repeat(1024*1024-1024)})),
            ),
        );
    }
    assert!(editor.completed.len() < MAX_RECEIPTS);
    assert_eq!(
        editor.native_command_capacity().unwrap_err().1,
        "COMMAND_EPOCH_EXPIRED"
    );
    assert!(editor.completed.is_empty());
    assert_eq!(editor.command_epoch, epoch + 1);
    editor.native_command_capacity().unwrap();
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn concurrent_legacy_import_owners_return_the_same_applied_or_failed_actor_outcome() {
    for succeeds in [true, false] {
        let (root, mut editor, _) = native_asset_fixture(if succeeds {
            "replay-applied"
        } else {
            "replay-failed"
        });
        if succeeds {
            std::fs::copy(root.join("capture.wav"), root.join("replay.wav")).unwrap();
        } else {
            std::fs::write(root.join("replay.wav"), b"invalid media").unwrap();
        }
        let command = request(
            &editor,
            Operation::ImportMedia {
                path_token: "replay.wav".into(),
            },
            "concurrent-import",
            None,
        );
        let NativeEditPreparation::Pending(mut first) =
            editor.prepare_legacy_media_import(command.clone()).unwrap()
        else {
            panic!("Expected the first preparation");
        };
        let status = first.jobs.status(&first.job, &first.epoch, false).unwrap();
        native_wait(&mut editor, &status);
        let NativeEditPreparation::Pending(second) =
            editor.prepare_legacy_media_import(command.clone()).unwrap()
        else {
            panic!("Expected a shared second preparation");
        };
        assert_eq!(first.job, second.job);
        // Both requests own the job before the first actor commit; the second polls later.
        let original = editor.mutation(None, command.clone());
        if succeeds {
            first.armed = false;
            assert_eq!(
                first.jobs.status(&first.job, &first.epoch, false).unwrap()["state"],
                "applied"
            );
        }
        drop(first);
        let expected = editor.snapshot();
        let host = Host::run(editor).unwrap();
        let replay = host.finish_media_import(command.clone(), second).await;
        match (&original, replay) {
            (Ok(receipt), Ok(replayed)) => assert_eq!(&replayed, receipt),
            (Err(error), Err(replayed)) => {
                assert_eq!(replayed.0, error.0);
                assert_eq!(replayed.1, error.1);
                assert_eq!(replayed.2, error.2);
                assert_eq!(replayed.0, axum::http::StatusCode::UNPROCESSABLE_ENTITY);
            }
            (original, replayed) => {
                panic!("Concurrent import outcome changed: {original:?} -> {replayed:?}")
            }
        }
        let retry = host.project_mutation(command).await;
        match (original, retry) {
            (Ok(receipt), Ok(replayed)) => assert_eq!(replayed, receipt),
            (Err(error), Err(replayed)) => {
                assert_eq!(replayed.0, error.0);
                assert_eq!(replayed.1, error.1);
                assert_eq!(replayed.2, error.2);
            }
            (original, replayed) => {
                panic!("Known import outcome changed: {original:?} -> {replayed:?}")
            }
        }
        let after = host.call(Action::Session).await.unwrap();
        assert_eq!(after["history"], expected["history"]);
        assert_eq!(after["media"], expected["media"]);
        assert_eq!(after["generation"], expected["generation"]);
        drop(host);
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn prepare_import_batch(editor: &mut Editor, tokens: &[&str]) -> Value {
    let job = editor
        .handle(Action::PrepareMediaImport(MediaImportRequest {
            project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            if_generation: editor.session.history.generation().to_string(),
            path_tokens: tokens.iter().map(|token| (*token).to_owned()).collect(),
        }))
        .unwrap();
    native_wait(editor, &job)
}
#[test]
fn prepared_media_import_preserves_order_partial_errors_native_hashes_and_one_undo() {
    use vv_core::Id;
    let (root, mut editor, existing) = native_asset_fixture("batch");
    let wav = std::fs::read(root.join("capture.wav")).unwrap();
    std::fs::write(root.join("first.wav"), &wav).unwrap();
    std::fs::write(root.join("second.wav"), &wav).unwrap();
    std::fs::write(root.join("bad.wav"), b"not media").unwrap();
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let ready = prepare_import_batch(
        &mut editor,
        &[
            "second.wav",
            "bad.wav",
            "capture.wav",
            "first.wav",
            "second.wav",
        ],
    );
    assert_eq!(ready["kind"], "media_import");
    assert_eq!(ready["progress"], json!({"completed":4,"total":4}));
    assert_eq!(
        ready["result"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path_token"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["second.wav", "capture.wav", "first.wav"]
    );
    assert_eq!(ready["result"]["errors"][0]["path_token"], "bad.wav");
    assert_eq!(editor.session.history.generation(), generation);
    let command = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "batch-import",
        None,
    );
    let receipt = editor.mutation(None, command.clone()).unwrap();
    let ids = receipt["media_ids"].as_array().unwrap();
    assert_eq!(ids.len(), 3);
    assert_eq!(ids[1], existing.raw().to_string());
    assert_eq!(receipt["errors"], ready["result"]["errors"]);
    assert_eq!(editor.session.history.position(), position + 1);
    let imported = ids
        .iter()
        .map(|id| vv_core::MediaId::from_raw(id.as_str().unwrap().parse().unwrap()))
        .collect::<Vec<_>>();
    for (id, name) in [(imported[0], "second.wav"), (imported[2], "first.wav")] {
        let item = &editor.session.project.media_pool[id];
        assert_eq!(item.path, root.join(name));
        assert_eq!(
            item.content_hash,
            vv_media::content_fingerprint(&root.join(name)).unwrap()
        );
    }
    assert_eq!(editor.mutation(None, command).unwrap(), receipt);
    assert_eq!(editor.session.history.position(), position + 1);
    let undo = request(&editor, Operation::Undo, "undo-batch", None);
    editor.mutation(None, undo).unwrap();
    assert!(editor.session.project.media_pool.contains_key(existing));
    assert!(!editor.session.project.media_pool.contains_key(imported[0]));
    assert!(!editor.session.project.media_pool.contains_key(imported[2]));
    let redo = request(&editor, Operation::Redo, "redo-batch", None);
    editor.mutation(None, redo).unwrap();
    assert!(
        imported
            .iter()
            .all(|id| editor.session.project.media_pool.contains_key(*id))
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_media_import_refuses_canceled_changed_and_stale_batches_before_native_allocation() {
    let (root, mut editor, _) = native_asset_fixture("batch-guards");
    let wav = std::fs::read(root.join("capture.wav")).unwrap();
    std::fs::write(root.join("guard.wav"), &wav).unwrap();
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let command = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "canceled-batch",
        None,
    );
    let before = ron::to_string(&editor.session.project).unwrap();
    let position = editor.session.history.position();
    editor.lease = Some(("another-browser".into(), Instant::now()));
    assert_eq!(
        editor.mutation(None, command.clone()).unwrap_err().1,
        "READ_ONLY"
    );
    editor.lease = None;
    editor
        .handle(Action::MediaImportStatus(
            ready["id"].as_str().unwrap().into(),
            SourceQuery {
                project_epoch: command.project_epoch.clone(),
            },
            true,
        ))
        .unwrap();
    assert!(editor.mutation(None, command).is_err());
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), before);
    assert_eq!(editor.session.history.position(), position);
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let command = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "changed-batch",
        None,
    );
    let mut changed = wav.clone();
    changed.push(0);
    std::fs::write(root.join("guard.wav"), changed).unwrap();
    assert_eq!(
        editor.mutation(None, command).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), before);
    std::fs::write(root.join("guard.wav"), &wav).unwrap();
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let stale = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "stale-batch",
        None,
    );
    let create = request(
        &editor,
        Operation::NewTimeline {
            name: "Changed".into(),
            fps: Rational::new(24, 1),
            resolution: [640, 360],
        },
        "timeline-before-batch",
        None,
    );
    editor.mutation(None, create).unwrap();
    let changed = ron::to_string(&editor.session.project).unwrap();
    assert_eq!(
        editor.mutation(None, stale).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), changed);
    let save = request(&editor, Operation::Save, "save-before-batch-switch", None);
    editor.mutation(None, save).unwrap();
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let old_epoch = ready["project_epoch"].as_str().unwrap().to_owned();
    let switch = request(
        &editor,
        Operation::NewProject {
            name: "new-batch-project".into(),
        },
        "switch-batch-project",
        None,
    );
    editor.mutation(None, switch).unwrap();
    let canceled = editor
        .handle(Action::MediaImportStatus(
            ready["id"].as_str().unwrap().into(),
            SourceQuery {
                project_epoch: old_epoch,
            },
            true,
        ))
        .unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert!(
        editor
            .session
            .project
            .media_pool
            .values()
            .all(|item| item.compound.is_some())
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

fn folder_editor() -> (std::path::PathBuf, Editor) {
    let root = std::env::temp_dir().join(format!(
        "vv-folder-command-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let editor = Editor::new(&root).unwrap();
    (root, editor)
}
fn folder_request(editor: &Editor, id: &str, name: &str) -> Mutation {
    request(
        editor,
        Operation::EditNativeAssetLibrary {
            edit: crate::asset_store::Edit::CreateFolder {
                folders_revision: editor.assets.folders().unwrap()["folders_revision"]
                    .as_str()
                    .unwrap()
                    .into(),
                name: name.into(),
                parent: None,
            },
        },
        id,
        None,
    )
}
fn folder_prepare(editor: &mut Editor, request: Mutation) -> NativeEditGuard {
    let NativeEditPreparation::Pending(guard) = editor.prepare_native_edit(request).unwrap() else {
        panic!("Expected a new folder preparation");
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let status = guard.jobs.status(&guard.job, &guard.epoch, false).unwrap();
        match status["state"].as_str().unwrap() {
            "ready" => return guard,
            "failed" | "canceled" => panic!("Folder preparation failed: {status}"),
            _ => {
                assert!(Instant::now() < deadline, "Folder preparation timed out");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

#[test]
fn native_folder_commit_has_one_durable_receipt_without_project_or_recovery_mutation() {
    let (root, mut editor) = folder_editor();
    let project = ron::to_string(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let command = folder_request(&editor, "create-folder", "Shared takes");
    let mut guard = folder_prepare(&mut editor, command.clone());
    let pending = editor.lookup("create-folder").unwrap();
    assert_eq!(pending["status"], "preparing");
    assert_eq!(pending["job_id"], guard.job);
    let receipt = editor.mutation(None, command.clone()).unwrap();
    guard.armed = false;
    assert_eq!(receipt["library_durable"], true);
    assert_eq!(receipt["receipt_persisted"], true);
    assert_eq!(
        receipt["durability"],
        json!({"state":"volatile","recovery_revision":null})
    );
    assert_eq!(
        receipt["command_epoch"],
        command.command_epoch.as_deref().unwrap()
    );
    let folders = std::fs::read(root.join(".assets/folders.json")).unwrap();
    let log = std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap();
    assert!(
        matches!(editor.prepare_native_edit(command.clone()).unwrap(),NativeEditPreparation::Complete(value) if value==receipt)
    );
    assert_eq!(editor.mutation(None, command.clone()).unwrap(), receipt);
    assert_eq!(editor.lookup("create-folder").unwrap(), receipt);
    assert_eq!(
        std::fs::read(root.join(".assets/folders.json")).unwrap(),
        folders
    );
    assert_eq!(
        std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap(),
        log
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert!(editor.native_edits.is_empty());
    assert!(
        editor
            .assets
            .completion("create-folder", &editor.asset_binding)
            .unwrap()
            .is_none()
    );
    let mut changed = command;
    changed.client_id = "different-client".into();
    assert_eq!(
        editor.prepare_native_edit(changed).err().unwrap().1,
        "COMMAND_ID_REUSED"
    );
    drop(guard);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_folder_completion_is_harvested_on_restart_before_a_retry_or_unknown_lookup() {
    let (root, mut editor) = folder_editor();
    let command = folder_request(&editor, "crash-folder", "Recovered");
    let mut guard = folder_prepare(&mut editor, command.clone());
    let fingerprint = editor.native_edits["crash-folder"].fingerprint;
    let Operation::EditNativeAssetLibrary { edit } = &command.operation else {
        unreachable!()
    };
    guard
        .jobs
        .commit_edit(
            &command.command_id,
            fingerprint,
            &command.project_epoch,
            &command.if_generation,
            edit,
        )
        .unwrap();
    guard.armed = false;
    assert!(
        editor
            .assets
            .completion("crash-folder", "foreign-root-binding")
            .unwrap()
            .is_none()
    );
    assert!(
        editor
            .assets
            .completion("crash-folder", &editor.asset_binding)
            .unwrap()
            .is_some()
    );
    assert!(
        editor
            .receipts
            .as_ref()
            .unwrap()
            .recorded("crash-folder")
            .is_none()
    );
    let folders = std::fs::read(root.join(".assets/folders.json")).unwrap();
    drop(guard);
    drop(editor);
    let mut restarted = Editor::new(&root).unwrap();
    let receipt = restarted.lookup("crash-folder").unwrap();
    assert_eq!(receipt["status"], "applied");
    assert_eq!(receipt["server_restarted"], true);
    assert_eq!(receipt["receipt_persisted"], true);
    assert_eq!(receipt["durability"]["state"], "volatile");
    assert_eq!(restarted.mutation(None, command.clone()).unwrap(), receipt);
    assert_eq!(
        std::fs::read(root.join(".assets/folders.json")).unwrap(),
        folders
    );
    assert!(
        restarted
            .assets
            .completion("crash-folder", &restarted.asset_binding)
            .unwrap()
            .is_none()
    );
    let log = std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap();
    assert_eq!(log.iter().filter(|byte| **byte == b'\n').count(), 1);
    let mut changed = command;
    changed.operation = Operation::EditNativeAssetLibrary {
        edit: crate::asset_store::Edit::CreateFolder {
            folders_revision: "absent".into(),
            name: "Other".into(),
            parent: None,
        },
    };
    assert_eq!(
        restarted.prepare_native_edit(changed).err().unwrap().1,
        "COMMAND_ID_REUSED"
    );
    drop(restarted);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn canceled_folder_preparations_keep_command_identity_without_exhausting_the_pending_map() {
    let (root, mut editor) = folder_editor();
    let command = folder_request(&editor, "canceled-folder", "Canceled");
    let guard = folder_prepare(&mut editor, command.clone());
    drop(guard);
    editor.prune_native_edits();
    assert!(editor.native_edits.is_empty());
    assert!(!root.join(".assets/folders.json").exists());
    let mut changed = command;
    changed.client_id = "changed-client".into();
    assert_eq!(
        editor.prepare_native_edit(changed).err().unwrap().1,
        "COMMAND_ID_REUSED"
    );
    // Evicted worker records still retain request identity until normal receipt retirement.
    for index in 0..64 {
        editor.native_edits.insert(
            format!("evicted-{index}"),
            PendingNativeEdit {
                fingerprint: [index as u8; 32],
                job: format!("missing-job-{index}"),
                epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            },
        );
    }
    editor.prune_native_edits();
    assert!(editor.native_edits.is_empty());
    assert!(editor.completed.contains_key("evicted-63"));
    let next = folder_request(&editor, "after-cancellation", "Usable");
    let mut guard = folder_prepare(&mut editor, next.clone());
    editor.mutation(None, next).unwrap();
    guard.armed = false;
    assert_eq!(
        editor.assets.folders().unwrap()["folders"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    drop(guard);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_folder_commit_cannot_cross_receipt_epoch_retirement() {
    let (root, mut editor) = folder_editor();
    let command = folder_request(&editor, "retired-folder", "Not committed");
    let guard = folder_prepare(&mut editor, command.clone());
    let original_epoch = editor.command_epoch;
    for index in 0..MAX_RECEIPTS {
        editor.completed.insert(
            format!("older-{index}"),
            ([0; 32], Ok(json!({"status":"applied"}))),
        );
    }
    assert_eq!(
        editor.mutation(None, command).unwrap_err().1,
        "COMMAND_EPOCH_EXPIRED"
    );
    assert_eq!(editor.command_epoch, original_epoch + 1);
    assert!(!root.join(".assets/folders.json").exists());
    drop(guard);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_folder_readers_are_lease_free_cas_bound_and_preserve_unknown_native_membership() {
    let root = std::env::temp_dir().join(format!(
        "vv-native-folder-host-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let epoch = editor.snapshot()["project_epoch"]
        .as_str()
        .unwrap()
        .to_owned();
    editor.lease = Some(("another-browser".into(), Instant::now()));
    let project = ron::to_string(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let receipts = editor.completed.len();
    let folders = editor
        .handle(Action::NativeAssetFolders(SourceQuery {
            project_epoch: epoch.clone(),
        }))
        .unwrap();
    assert_eq!(
        folders,
        json!({"project_epoch":epoch,"version":1,"folders_revision":"absent","folders":[]})
    );
    let tree = json!({"version":1,"folders":[{"id":"parent","name":"Parent","parent":null},{"id":"child","name":"Child","parent":"parent"}]});
    std::fs::write(
        root.join(".assets/folders.json"),
        serde_json::to_vec(&tree).unwrap(),
    )
    .unwrap();
    let folders = editor
        .handle(Action::NativeAssetFolders(SourceQuery {
            project_epoch: epoch.clone(),
        }))
        .unwrap();
    let revision = folders["folders_revision"].as_str().unwrap().to_owned();
    assert_ne!(revision, "absent");
    assert_eq!(folders["folders"], tree["folders"]);
    let mut native = Session::default();
    let id = native.create_timeline(Timeline {
        name: "Native empty compound".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    });
    let media = native
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(id))
        .unwrap()
        .0;
    let mut asset = crate::asset_payload::capture(
        &native,
        media,
        "Unknown native folder",
        vv_core::clipboard::ClipboardOrigin {
            instance: 1,
            epoch: native.epoch(),
        },
    )
    .unwrap();
    asset.folder = Some("imported-orphan".into());
    editor.assets.create("orphan-asset", &asset).unwrap();
    let listed = editor
        .handle(Action::NativeAssetList(
            0,
            crate::asset_store::Query {
                project_epoch: epoch.clone(),
                folder: Some(String::new()),
                folders_revision: Some(revision.clone()),
                ..Default::default()
            },
        ))
        .unwrap();
    assert_eq!(listed["items"][0]["folder"], "imported-orphan");
    assert!(listed["items"][0]["effective_folder"].is_null());
    let loaded = editor.assets.item("orphan-asset", false).unwrap();
    assert_eq!(loaded["folder"], "imported-orphan");
    assert!(loaded["effective_folder"].is_null());
    let child = editor
        .handle(Action::NativeAssetList(
            0,
            crate::asset_store::Query {
                project_epoch: epoch.clone(),
                folder: Some("child".into()),
                folders_revision: Some(revision.clone()),
                ..Default::default()
            },
        ))
        .unwrap();
    assert!(child["items"].as_array().unwrap().is_empty());
    assert_eq!(child["total"], listed["total"]);
    assert_eq!(child["pages"], listed["pages"]);
    for (folder, folders_revision) in [
        (Some(String::new()), None),
        (Some("child".into()), Some("stale".into())),
        (Some("unknown".into()), Some(revision)),
    ] {
        assert!(
            editor
                .handle(Action::NativeAssetList(
                    0,
                    crate::asset_store::Query {
                        project_epoch: epoch.clone(),
                        folder,
                        folders_revision,
                        ..Default::default()
                    }
                ))
                .is_err()
        );
    }
    assert_eq!(
        editor
            .handle(Action::NativeAssetFolders(SourceQuery {
                project_epoch: "stale".into()
            }))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    let malformed = b"not native folders JSON";
    std::fs::write(root.join(".assets/folders.json"), malformed).unwrap();
    assert!(
        editor
            .handle(Action::NativeAssetFolders(SourceQuery {
                project_epoch: epoch.clone()
            }))
            .is_err()
    );
    assert_eq!(
        std::fs::read(root.join(".assets/folders.json")).unwrap(),
        malformed
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.completed.len(), receipts);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

fn native_asset_fixture(label: &str) -> (std::path::PathBuf, Editor, vv_core::MediaId) {
    let root = std::env::temp_dir().join(format!(
        "vv-native-assets-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "assets".into(),
        },
        "asset-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let samples = 800u32;
    let bytes = samples * 2;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + bytes).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&8000u32.to_le_bytes());
    wav.extend_from_slice(&16000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&bytes.to_le_bytes());
    wav.resize(44 + bytes as usize, 0);
    std::fs::write(root.join("capture.wav"), wav).unwrap();
    let (path, meta) = editor.files.probe("capture.wav").unwrap();
    let media = editor.session.add_media(path, meta);
    (root, editor, media)
}
fn native_prepare(editor: &mut Editor, action: NativeAssetAction) -> Value {
    editor
        .handle(Action::PrepareNativeAsset(NativeAssetRequest {
            project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            if_generation: editor.session.history.generation().to_string(),
            action,
        }))
        .unwrap()
}
fn native_wait(editor: &mut Editor, job: &Value) -> Value {
    let id = job["id"].as_str().unwrap().to_owned();
    let epoch = job["project_epoch"].as_str().unwrap().to_owned();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let value = editor
            .handle(Action::NativeAssetStatus(
                id.clone(),
                SourceQuery {
                    project_epoch: epoch.clone(),
                },
                false,
            ))
            .unwrap();
        match value["state"].as_str().unwrap() {
            "ready" => return value,
            "failed" | "canceled" => panic!("Native asset job failed: {value}"),
            _ => {
                assert!(
                    Instant::now() < deadline,
                    "Native asset preparation timed out"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}
fn native_publish(editor: &mut Editor, media: vv_core::MediaId, id: &str) -> String {
    use vv_core::Id;
    let job = native_prepare(
        editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Shared native take".into(),
        },
    );
    native_wait(editor, &job);
    let publish = request(
        editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        id,
        None,
    );
    editor.mutation(None, publish).unwrap();
    editor.assets.item(id, false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .into()
}
fn native_import(editor: &mut Editor, id: &str, revision: &str, command: &str) -> Value {
    let job = native_prepare(
        editor,
        NativeAssetAction::Import {
            asset_id: id.into(),
            revision: revision.into(),
        },
    );
    native_wait(editor, &job);
    let import = request(
        editor,
        Operation::ImportNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
            asset_id: id.into(),
            revision: revision.into(),
        },
        command,
        None,
    );
    editor.mutation(None, import).unwrap()
}

#[test]
fn native_asset_capture_publish_is_lease_free_until_durable_library_write_and_has_no_history_step()
{
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("publication");
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    editor.lease = Some(("another-browser".into(), Instant::now()));
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Native source".into(),
        },
    );
    let ready = native_wait(&mut editor, &job);
    assert!(ready["result"]["asset_id"].is_null());
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    let publish = request(
        &editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        "publish-native",
        None,
    );
    assert_eq!(
        editor.mutation(None, publish.clone()).unwrap_err().1,
        "READ_ONLY"
    );
    editor.lease = None;
    let receipt = editor.mutation(None, publish.clone()).unwrap();
    let bytes = editor.assets.export("publish-native").unwrap();
    assert_eq!(editor.mutation(None, publish.clone()).unwrap(), receipt);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    assert!(receipt.get("media_ids").is_none());
    let asset = crate::asset_payload::parse(&bytes).unwrap();
    let payload = crate::asset_payload::decode(&asset).unwrap();
    assert_eq!(payload.media_ids().len(), 1);
    assert!(
        payload
            .files()
            .all(|item| item.path.starts_with(root.join(".assets/media")))
    );
    drop(editor);
    let mut editor = Editor::new(&root).unwrap();
    let mut restarted_receipt = receipt.clone();
    restarted_receipt["server_restarted"] = json!(true);
    assert_eq!(editor.mutation(None, publish).unwrap(), restarted_receipt);
    assert_eq!(editor.assets.export("publish-native").unwrap(), bytes);
    let old_status = editor.handle(Action::NativeAssetStatus(
        job["id"].as_str().unwrap().into(),
        SourceQuery {
            project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        },
        false,
    ));
    assert!(old_status.is_err());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_import_is_one_undo_and_redo_then_cached_reuse_preserves_an_edited_child() {
    use vv_core::{Clip, ClipId, ClipSource, Id};
    let (root, mut source, media) = native_asset_fixture("compound");
    let child = source.session.create_timeline(Timeline {
        name: "Native nested take".into(),
        fps: Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    source.session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(9007199254740993),
            ClipSource::Media(media),
            0,
            2,
            0,
            Rational::one(),
        ));
    let compound = source
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let revision = native_publish(&mut source, compound, "compound-asset");
    let target = root.join("target");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "destination-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let position = editor.session.history.position();
    let media_before = editor.session.project.media_pool.len();
    let timelines_before = editor.session.project.timelines.len();
    let imported = native_import(&mut editor, "compound-asset", &revision, "import-compound");
    assert_eq!(editor.session.history.position(), position + 1);
    assert_eq!(editor.session.project.media_pool.len(), media_before + 2);
    assert_eq!(editor.session.project.timelines.len(), timelines_before + 1);
    let selected =
        vv_core::MediaId::from_raw(imported["media_ids"][0].as_str().unwrap().parse().unwrap());
    assert!(
        editor.session.project.media_pool[selected]
            .compound
            .is_some()
    );
    assert!(
        editor
            .session
            .project
            .media_pool
            .values()
            .filter(|item| item.compound.is_none())
            .all(|item| item.path.parent() == Some(target.as_path()))
    );
    let undo = request(&editor, Operation::Undo, "undo-native-import", None);
    editor.mutation(None, undo).unwrap();
    assert!(!editor.session.project.media_pool.contains_key(selected));
    assert_eq!(editor.session.project.timelines.len(), timelines_before);
    let redo = request(&editor, Operation::Redo, "redo-native-import", None);
    editor.mutation(None, redo).unwrap();
    assert!(editor.session.project.media_pool.contains_key(selected));
    editor.session.apply(Box::new(vv_core::RenameTimeline::new(
        selected,
        "Edited imported child".into(),
    )));
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let reused = native_import(&mut editor, "compound-asset", &revision, "reuse-compound");
    assert_eq!(reused["media_ids"], imported["media_ids"]);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    let nested = editor.session.project.media_pool[selected]
        .compound
        .unwrap();
    assert_eq!(
        editor.session.project.timelines[nested].name,
        "Edited imported child"
    );
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_cache_invalidates_after_undo_removes_imported_ids() {
    let (root, mut source, media) = native_asset_fixture("cache-undo");
    let revision = native_publish(&mut source, media, "audio-asset");
    let target = root.join("target");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "destination-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let first = native_import(&mut editor, "audio-asset", &revision, "first-import");
    let position = editor.session.history.position();
    let undo = request(&editor, Operation::Undo, "undo-import", None);
    editor.mutation(None, undo).unwrap();
    let imported = native_import(&mut editor, "audio-asset", &revision, "import-again");
    assert_ne!(imported["media_ids"], first["media_ids"]);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.labels().count(), position);
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_preparation_and_import_refuse_stale_context_forged_jobs_and_wrong_routes() {
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("guards");
    let epoch = editor.snapshot()["project_epoch"]
        .as_str()
        .unwrap()
        .to_owned();
    let generation = editor.session.history.generation().to_string();
    let position = editor.session.history.position();
    for (project_epoch, if_generation) in [
        ("stale".to_owned(), generation.clone()),
        (epoch.clone(), "999".into()),
    ] {
        assert!(
            editor
                .handle(Action::PrepareNativeAsset(NativeAssetRequest {
                    project_epoch,
                    if_generation,
                    action: NativeAssetAction::Capture {
                        media_id: media.raw().to_string(),
                        name: "Rejected".into()
                    }
                }))
                .is_err()
        );
    }
    let missing = request(
        &editor,
        Operation::ImportNativeAsset {
            job_id: "forged".into(),
            asset_id: "asset".into(),
            revision: "0".repeat(64),
        },
        "forged-import",
        None,
    );
    assert!(editor.mutation(None, missing).is_err());
    assert_eq!(editor.session.history.position(), position);
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Bound snapshot".into(),
        },
    );
    native_wait(&mut editor, &job);
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let timeline_request = request(
        &editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        "wrong-timeline-route",
        Some(timeline),
    );
    assert!(
        editor
            .mutation(Some(timeline.raw().to_string()), timeline_request)
            .is_err()
    );
    editor.session.create_timeline(Timeline {
        name: "Change generation".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    });
    let publish = request(
        &editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        "stale-publication",
        None,
    );
    assert_eq!(
        editor.mutation(None, publish).unwrap_err().1,
        "ASSET_CONTEXT_CHANGED"
    );
    assert!(editor.assets.item("stale-publication", false).is_err());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_capture_counts_all_dependencies_before_opening_any_source_file() {
    use vv_core::{Clip, ClipId, ClipSource, Id, MediaItem};
    let (root, mut editor, media) = native_asset_fixture("file-count");
    let meta = editor.session.project.media_pool[media].meta.clone();
    let mut track = Track::new(TrackKind::Audio);
    for index in 0..65u64 {
        let file = editor.session.project.media_pool.insert(MediaItem {
            path: root.join(format!("not-created-{index}.wav")),
            meta: meta.clone(),
            content_hash: index + 1,
            compound: None,
            folder: None,
        });
        track.clips.push(Clip::from_source_range(
            ClipId(index + 1),
            ClipSource::Media(file),
            0,
            1,
            index as i64,
            Rational::one(),
        ));
    }
    let timeline = editor.session.create_timeline(Timeline {
        name: "Too many dependencies".into(),
        fps: Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let compound = editor
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(timeline))
        .unwrap()
        .0;
    let generation = editor.session.history.generation();
    let error = editor
        .handle(Action::PrepareNativeAsset(NativeAssetRequest {
            project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
            if_generation: generation.to_string(),
            action: NativeAssetAction::Capture {
                media_id: compound.raw().to_string(),
                name: "Refused before source IO".into(),
            },
        }))
        .unwrap_err();
    assert_eq!(error.1, "INVALID_OPERATION");
    assert!(error.2.contains("64 source files"));
    assert_eq!(editor.session.history.generation(), generation);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_invalid_payload_and_destination_limits_preserve_project_history_and_allocators() {
    use vv_core::{Clip, ClipId, ClipSource};
    let (root, mut source, _) = native_asset_fixture("atomic-import");
    let mut track = Track::new(TrackKind::Video);
    track.clips.push(Clip::from_source_range(
        ClipId(1),
        ClipSource::SolidColor,
        0,
        24,
        0,
        Rational::one(),
    ));
    let child = source.session.create_timeline(Timeline {
        name: "Generated native asset".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let media = source
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let revision = native_publish(&mut source, media, "generated-asset");
    let target = root.join("target");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "destination-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    for index in 1..64 {
        editor.session.create_timeline(Timeline {
            name: format!("Existing {index}"),
            fps: Rational::new(24, 1),
            resolution: (640, 360),
            tracks: vec![],
            markers: vec![],
            master: Default::default(),
        });
    }
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Import {
            asset_id: "generated-asset".into(),
            revision: revision.clone(),
        },
    );
    native_wait(&mut editor, &job);
    let project = ron::to_string(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let import = request(
        &editor,
        Operation::ImportNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
            asset_id: "generated-asset".into(),
            revision,
        },
        "refused-project-size",
        None,
    );
    assert_eq!(
        editor.mutation(None, import).unwrap_err().1,
        "INVALID_OPERATION"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert!(editor.asset_imports.is_empty());
    let bad=br#"{"version":1,"name":"Malformed","folder":null,"payload":"venturi-clipboard/1\nnot a native project"}"#;
    std::fs::write(root.join(".assets/assets/malformed.json"), bad).unwrap();
    let bad_revision = format!("{:x}", Sha256::digest(bad));
    let prepared = editor.handle(Action::PrepareNativeAsset(NativeAssetRequest {
        project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        if_generation: generation.to_string(),
        action: NativeAssetAction::Import {
            asset_id: "malformed".into(),
            revision: bad_revision,
        },
    }));
    assert!(prepared.is_err());
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.position(), position);
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_project_switch_cancels_obsolete_jobs_and_accepts_exact_old_cancel_without_history()
{
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("obsolete-project");
    let revision = native_publish(&mut editor, media, "published-before-switch");
    let published = editor.assets.export("published-before-switch").unwrap();
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Unpublished old project".into(),
        },
    );
    native_wait(&mut editor, &job);
    let old_epoch = job["project_epoch"].as_str().unwrap().to_owned();
    let id = job["id"].as_str().unwrap().to_owned();
    let save = request(&editor, Operation::Save, "save-before-switch", None);
    editor.mutation(None, save).unwrap();
    let switch = request(
        &editor,
        Operation::NewProject {
            name: "next".into(),
        },
        "switch-project",
        None,
    );
    editor.mutation(None, switch).unwrap();
    assert_ne!(editor.snapshot()["project_epoch"], old_epoch);
    let project = ron::to_string(&editor.session.project).unwrap();
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let receipts = editor.completed.len();
    assert_eq!(
        editor
            .handle(Action::NativeAssetStatus(
                id.clone(),
                SourceQuery {
                    project_epoch: old_epoch.clone()
                },
                false
            ))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    let canceled = editor
        .handle(Action::NativeAssetStatus(
            id.clone(),
            SourceQuery {
                project_epoch: old_epoch.clone(),
            },
            true,
        ))
        .unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert_eq!(canceled["project_epoch"], old_epoch);
    assert!(canceled["result"].is_null());
    for (job_id, epoch) in [
        (id.clone(), "wrong-project".into()),
        ("foreign-job".into(), old_epoch.clone()),
        (
            id.clone(),
            editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        ),
    ] {
        assert_eq!(
            editor
                .handle(Action::NativeAssetStatus(
                    job_id,
                    SourceQuery {
                        project_epoch: epoch
                    },
                    true
                ))
                .unwrap_err()
                .1,
            "NOT_FOUND"
        );
    }
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.completed.len(), receipts);
    let publish = request(
        &editor,
        Operation::PublishNativeAsset { job_id: id },
        "refused-old-job",
        None,
    );
    assert!(editor.mutation(None, publish).is_err());
    assert!(editor.assets.item("refused-old-job", false).is_err());
    assert_eq!(
        editor.assets.export("published-before-switch").unwrap(),
        published
    );
    assert_eq!(
        editor
            .assets
            .item("published-before-switch", false)
            .unwrap()["revision"],
        revision
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn compound_navigation_is_a_lease_free_reader_with_raw_frames_and_complete_parent_cas() {
    use crate::compound_navigation::{Ancestor, Navigation, Request as NavigationRequest};
    use vv_core::{Clip, ClipId, ClipSource, Id};
    let root = std::env::temp_dir().join(format!(
        "vv-navigation-host-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let make = |name: &str| Timeline {
        name: name.into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    };
    let parent = editor.session.create_timeline(make("Parent"));
    let child = editor.session.create_timeline(make("Child"));
    editor.session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(1),
            ClipSource::SolidColor,
            0,
            100,
            0,
            Rational::one(),
        ));
    let media = editor
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(child))
        .unwrap()
        .0;
    let clip = ClipId(9007199254740993);
    editor.session.project.timelines[parent].tracks[0]
        .clips
        .push(Clip::from_source_range(
            clip,
            ClipSource::Media(media),
            0,
            60,
            10,
            Rational::one(),
        ));
    editor.session.project.timelines[parent].tracks[0].locked = true;
    editor.lease = Some(("foreign-writer".into(), Instant::now()));
    let query = |editor: &Editor, id: vv_core::TimelineId, frame| FrameQuery {
        timeline_id: id.raw().to_string(),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        revision: editor.session.timeline_revision(id),
        frame,
        width: 320,
    };
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let epoch = editor.command_epoch;
    let receipts = editor.completed.len();
    let source = query(&editor, parent, 10_000);
    assert!(
        editor.handle(Action::CheckFrame(source.clone())).is_err(),
        "Normal frame previews retain their content range restriction"
    );
    let request = NavigationRequest {
        query: source.clone(),
        action: Navigation::Enter {
            clip_ids: vec![clip.0.to_string()],
        },
    };
    let result = editor
        .handle(Action::CompoundNavigation(request.clone()))
        .unwrap();
    assert_eq!(result["frame"], 59);
    assert_eq!(result["source_frame"], 10_000);
    assert_eq!(result["timeline_id"], child.raw().to_string());
    for field in ["epoch", "generation", "revision", "width"] {
        let mut invalid = request.clone();
        match field {
            "epoch" => invalid.query.project_epoch = "stale".into(),
            "generation" => invalid.query.if_generation = "999".into(),
            "revision" => invalid.query.revision = "stale".into(),
            _ => invalid.query.width = 0,
        }
        assert!(
            editor.handle(Action::CompoundNavigation(invalid)).is_err(),
            "{field}"
        );
    }
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.command_epoch, epoch);
    assert_eq!(editor.completed.len(), receipts);
    assert_eq!(editor.lease.as_ref().unwrap().0, "foreign-writer");
    let ancestor = Ancestor {
        timeline_id: parent.raw().to_string(),
        revision: editor.session.timeline_revision(parent),
        clip_id: Some(clip.0.to_string()),
        entry_playhead: 10_000,
    };
    let mut replacement = editor.session.project.timelines[parent].tracks[0].clips[0].clone();
    replacement.timeline_len = 50;
    editor.session.apply(Box::new(vv_core::SetClipValue::new(
        parent,
        0,
        clip,
        vv_core::CommandLabel::ReplaceTake,
        replacement,
        |clip: &mut Clip| clip,
    )));
    let exit = NavigationRequest {
        query: query(&editor, child, 20),
        action: Navigation::Exit {
            ancestors: vec![ancestor],
        },
    };
    let changed = serde_json::to_value(&editor.session.project).unwrap();
    assert_eq!(
        editor
            .handle(Action::CompoundNavigation(exit))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        changed
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn acknowledged_edits_have_a_synchronous_recovery_checkpoint_and_restart_receipt_without_replay() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-durable-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "durable".into(),
        },
        "durable-new",
        None,
    );
    let saved = editor.mutation(None, create).unwrap();
    assert_eq!(saved["durability"]["state"], "saved");
    let original = std::fs::read(root.join("durable.vvproj")).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "durable-add",
        Some(id),
    );
    let ack = editor.mutation(path.clone(), add.clone()).unwrap();
    assert_eq!(ack["durability"]["state"], "recovery");
    assert_eq!(ack["receipt_persisted"], true);
    let revision = ack["durability"]["recovery_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let expected = serde_json::to_value(&editor.session.project).unwrap();
    drop(editor);
    let mut editor = Editor::new(&root).unwrap();
    assert_eq!(editor.autosave.info()["state"], "pending");
    assert_eq!(editor.autosave.info()["revision"], revision);
    let mut recovered_ack = ack;
    recovered_ack["server_restarted"] = json!(true);
    assert_eq!(
        editor.handle(Action::Lookup("durable-add".into())).unwrap(),
        recovered_ack
    );
    assert_eq!(
        editor.mutation(path.clone(), add.clone()).unwrap(),
        recovered_ack
    );
    assert!(
        editor.session.project.timelines[id].tracks[0]
            .clips
            .is_empty()
    );
    let mut changed = add.clone();
    changed.operation = Operation::Undo;
    assert_eq!(
        editor.mutation(path.clone(), changed).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    let mut unknown = add;
    unknown.command_id = "unrecorded-old-command".into();
    assert_eq!(
        editor.mutation(path, unknown).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    editor
        .autosave
        .recover(&editor.files, &mut editor.session, &revision, "Kept", true)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        expected
    );
    assert_eq!(
        std::fs::read(root.join("durable.vvproj")).unwrap(),
        original
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn incomplete_receipts_preserve_recovery_and_report_unavailable_persistence_without_failed_edits() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-torn-receipt-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let bytes = b"{interrupted-write";
    std::fs::write(root.join(".venturi-command-receipts.jsonl"), bytes).unwrap();
    let mut editor = Editor::new(&root).unwrap();
    assert!(editor.persistence_notice.is_some());
    let create = request(
        &editor,
        Operation::NewProject {
            name: "still_usable".into(),
        },
        "unavailable-new",
        None,
    );
    let ack = editor.mutation(None, create).unwrap();
    assert_eq!(ack["status"], "applied");
    assert_eq!(ack["receipt_persisted"], false);
    assert_eq!(
        std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap(),
        bytes
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn receipt_rotation_keeps_editing_state_and_rejects_evicted_commands_even_without_a_history_change()
{
    let root = std::env::temp_dir().join(format!(
        "vv-web-receipts-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let mut create = request(
        &editor,
        Operation::NewProject {
            name: "rotation".into(),
        },
        "rotate-new",
        None,
    );
    create.command_epoch = None;
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "rotate-add",
        Some(id),
    );
    editor.mutation(path.clone(), add).unwrap();
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let project_epoch = editor.snapshot()["project_epoch"].clone();
    let oldest = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec!["0".into()],
        },
        "rotate-oldest",
        Some(id),
    );
    editor.mutation(path.clone(), oldest.clone()).unwrap();
    let mut boundary = None;
    for index in 0..5000 {
        let request = request(
            &editor,
            Operation::CopyClips {
                clip_ids: vec!["0".into()],
            },
            &format!("rotate-copy-{index}"),
            Some(id),
        );
        let epoch = editor.command_epoch;
        let result = editor.mutation(path.clone(), request.clone()).unwrap();
        if epoch != editor.command_epoch {
            boundary = Some((request, result));
        }
        assert!(editor.completed.len() <= MAX_RECEIPTS);
    }
    assert_eq!(editor.command_epoch, 1);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    assert_eq!(editor.snapshot()["project_epoch"], project_epoch);
    assert_eq!(editor.snapshot()["clipboard_count"], 1);
    assert!(editor.session.has_unsaved_changes());
    assert_eq!(
        editor.mutation(path.clone(), oldest).unwrap_err().1,
        "COMMAND_EPOCH_EXPIRED"
    );
    let (record, result) = boundary.unwrap();
    assert_eq!(result["command_epoch"], "1");
    assert_eq!(
        editor.mutation(path.clone(), record.clone()).unwrap(),
        result
    );
    let mut reused = record;
    reused.operation = Operation::Undo;
    assert_eq!(
        editor.mutation(path, reused).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    assert_eq!(editor.session.history.position(), position);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn unsupported_reopen_metadata_does_not_turn_a_successful_native_save_into_a_failed_command() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-resume-metadata-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let future = b"{\"version\":2,\"future\":true}";
    std::fs::write(root.join(".venturi-last-project.json"), future).unwrap();
    let mut editor = Editor::new(&root).unwrap();
    assert!(editor.persistence_notice.is_some());
    let new = request(
        &editor,
        Operation::NewProject {
            name: "preserved".into(),
        },
        "resume-future-new",
        None,
    );
    assert_eq!(editor.mutation(None, new).unwrap()["status"], "applied");
    let save = request(&editor, Operation::Save, "resume-future-save", None);
    assert_eq!(editor.mutation(None, save).unwrap()["status"], "applied");
    assert!(!editor.session.has_unsaved_changes());
    assert!(editor.persistence_notice.is_some());
    assert!(root.join("preserved.vvproj").is_file());
    assert_eq!(
        std::fs::read(root.join(".venturi-last-project.json")).unwrap(),
        future
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn reopening_a_host_restores_only_the_last_saved_native_project_and_preserves_metadata_failures() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-host-resume-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "last_saved".into(),
        },
        "resume-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let edit = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "resume-edit",
        Some(timeline),
    );
    editor
        .mutation(Some(vv_core::Id::raw(timeline).to_string()), edit)
        .unwrap();
    let save = request(&editor, Operation::Save, "resume-save", None);
    editor.mutation(None, save).unwrap();
    let expected = serde_json::to_value(&editor.session.project).unwrap();
    drop(editor);
    let editor = Editor::new(&root).unwrap();
    assert!(!editor.session.has_unsaved_changes());
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        expected
    );
    assert_eq!(editor.snapshot()["project_name"], "last_saved.vvproj");
    assert!(editor.persistence_notice.is_none());
    drop(editor);
    std::fs::write(root.join("last_saved.vvproj"), b"external edit").unwrap();
    let mut editor = Editor::new(&root).unwrap();
    assert!(editor.session.path().is_none());
    assert!(editor.persistence_notice.is_some());
    let new = request(
        &editor,
        Operation::NewProject {
            name: "new_project".into(),
        },
        "resume-new-after-change",
        None,
    );
    editor.mutation(None, new).unwrap();
    assert!(editor.persistence_notice.is_none());
    assert_eq!(
        std::fs::read(root.join("last_saved.vvproj")).unwrap(),
        b"external edit"
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}
fn request(
    editor: &Editor,
    operation: Operation,
    id: &str,
    timeline: Option<vv_core::TimelineId>,
) -> Mutation {
    Mutation {
        command_id: id.into(),
        client_id: "test-client".into(),
        command_epoch: Some(editor.command_epoch.to_string()),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        if_revision: timeline.map(|id| editor.session.timeline_revision(id)),
        operation,
    }
}

#[test]
fn external_save_conflicts_retain_dirty_native_edits_and_allow_a_retry_safe_save_as() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-save-conflict-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "conflict-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let edit = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "conflict-edit",
        Some(timeline),
    );
    editor
        .mutation(Some(vv_core::Id::raw(timeline).to_string()), edit)
        .unwrap();
    let memory = serde_json::to_value(&editor.session.project).unwrap();
    let steps = editor.session.history.position();
    std::fs::write(root.join("original.vvproj"), b"external edit preserved").unwrap();
    let save = request(&editor, Operation::Save, "conflict-save", None);
    assert_eq!(
        editor.mutation(None, save.clone()).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    assert_eq!(editor.mutation(None, save).unwrap_err().1, "SAVE_CONFLICT");
    assert!(editor.session.has_unsaved_changes());
    assert_eq!(editor.session.history.position(), steps);
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        memory
    );
    let copy = request(
        &editor,
        Operation::SaveAs {
            name: "preserved".into(),
        },
        "conflict-copy",
        None,
    );
    let reply = editor.mutation(None, copy.clone()).unwrap();
    assert_eq!(editor.mutation(None, copy).unwrap(), reply);
    assert!(!editor.session.has_unsaved_changes());
    assert_eq!(
        editor.files.load("preserved.vvproj").unwrap().timelines[timeline].tracks[0]
            .clips
            .len(),
        1
    );
    assert_eq!(
        std::fs::read(root.join("original.vvproj")).unwrap(),
        b"external edit preserved"
    );
    assert!(!root.join("original.vvproj.bak").exists());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovering_a_backup_creates_a_retry_safe_copy_and_never_overwrites_the_original() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-recover-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "recover-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "recover-edit",
        Some(timeline),
    );
    editor
        .mutation(Some(vv_core::Id::raw(timeline).to_string()), add)
        .unwrap();
    let dirty = request(
        &editor,
        Operation::RecoverBackup {
            path_token: "original.vvproj.bak".into(),
            name: "recovered".into(),
        },
        "recover-dirty",
        None,
    );
    assert_eq!(
        editor.mutation(None, dirty).unwrap_err().1,
        "UNSAVED_CHANGES"
    );
    assert!(!root.join("recovered.vvproj").exists());
    let save = request(&editor, Operation::Save, "recover-save", None);
    editor.mutation(None, save).unwrap();
    let backup = std::fs::read(root.join("original.vvproj.bak")).unwrap();
    std::fs::write(root.join("original.vvproj"), b"damaged current file").unwrap();
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let epoch = editor.session.epoch();
    let duplicate = request(
        &editor,
        Operation::RecoverBackup {
            path_token: "original.vvproj.bak".into(),
            name: "original".into(),
        },
        "recover-existing",
        None,
    );
    assert_eq!(
        editor.mutation(None, duplicate).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert_eq!(editor.session.epoch(), epoch);
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    let recover = request(
        &editor,
        Operation::RecoverBackup {
            path_token: "original.vvproj.bak".into(),
            name: "recovered".into(),
        },
        "recover-copy",
        None,
    );
    editor.mutation(None, recover.clone()).unwrap();
    let recovered_epoch = editor.session.epoch();
    editor.mutation(None, recover).unwrap();
    assert_eq!(editor.session.epoch(), recovered_epoch);
    assert_ne!(epoch, recovered_epoch);
    assert_eq!(editor.session.project.timelines[timeline].total_frames(), 0);
    assert!(!editor.session.has_unsaved_changes());
    assert_eq!(
        editor.session.path().unwrap().file_name().unwrap(),
        "recovered.vvproj"
    );
    assert_eq!(
        std::fs::read(root.join("original.vvproj")).unwrap(),
        b"damaged current file"
    );
    assert_eq!(
        std::fs::read(root.join("original.vvproj.bak")).unwrap(),
        backup
    );
    assert!(editor.files.load("recovered.vvproj").is_ok());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn review_commands_are_retry_safe_copy_on_save_as_and_refuse_an_old_project_namespace() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-review-host-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "review-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let edit = request(
        &editor,
        Operation::EditReview {
            project_token: "original.vvproj".into(),
            revision: "absent".into(),
            edit: crate::reviewmeta::Edit::NewShot {
                id: "arrival".into(),
                name: "Arrival".into(),
            },
        },
        "review-shot",
        None,
    );
    editor.mutation(None, edit.clone()).unwrap();
    let bytes = std::fs::read(root.join("original.vvproj.review.json")).unwrap();
    editor.mutation(None, edit).unwrap();
    assert_eq!(
        std::fs::read(root.join("original.vvproj.review.json")).unwrap(),
        bytes
    );
    assert_eq!(editor.session.history.position(), 0);
    let copy = request(
        &editor,
        Operation::SaveAs {
            name: "copy".into(),
        },
        "review-copy",
        None,
    );
    editor.mutation(None, copy).unwrap();
    assert_eq!(
        std::fs::read(root.join("copy.vvproj.review.json")).unwrap(),
        bytes
    );
    let current = crate::reviewmeta::read(&editor.files, &editor.session).unwrap();
    let wrong = request(
        &editor,
        Operation::EditReview {
            project_token: "original.vvproj".into(),
            revision: current["revision"].as_str().unwrap().into(),
            edit: crate::reviewmeta::Edit::DeleteShot {
                id: "arrival".into(),
            },
        },
        "review-old-namespace",
        None,
    );
    assert_eq!(
        editor.mutation(None, wrong).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        std::fs::read(root.join("copy.vvproj.review.json")).unwrap(),
        bytes
    );
    let orphan = root.join("orphan.vvproj.review.json");
    std::fs::write(&orphan, &bytes).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "orphan".into(),
        },
        "review-preserve-orphan",
        None,
    );
    assert_eq!(editor.mutation(None, create).unwrap_err().1, "FILE_EXISTS");
    assert!(!root.join("orphan.vvproj").exists());
    assert_eq!(std::fs::read(orphan).unwrap(), bytes);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn otio_import_is_a_new_no_replace_project_with_epoch_and_retry_guards() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-otio-host-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "otio-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let value = vv_core::otio::timeline_to_otio(&editor.session.project, id, None);
    std::fs::write(
        root.join("source.otio"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    let import = request(
        &editor,
        Operation::ImportOtio {
            path_token: "source.otio".into(),
            name: "imported".into(),
        },
        "otio-import",
        None,
    );
    editor.mutation(None, import.clone()).unwrap();
    let epoch = editor.session.epoch();
    editor.mutation(None, import).unwrap();
    assert_eq!(editor.session.epoch(), epoch);
    assert!(root.join("imported.vvproj").is_file());
    assert!(root.join("original.vvproj").is_file());
    let duplicate = request(
        &editor,
        Operation::ImportOtio {
            path_token: "source.otio".into(),
            name: "original".into(),
        },
        "otio-existing",
        None,
    );
    assert_eq!(
        editor.mutation(None, duplicate).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert_eq!(editor.session.epoch(), epoch);
    let id = editor.session.project.timelines.keys().next().unwrap();
    let change = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "otio-dirty",
        Some(id),
    );
    editor
        .mutation(Some(vv_core::Id::raw(id).to_string()), change)
        .unwrap();
    let dirty = request(
        &editor,
        Operation::ImportOtio {
            path_token: "source.otio".into(),
            name: "discard".into(),
        },
        "otio-unsaved",
        None,
    );
    assert_eq!(
        editor.mutation(None, dirty).unwrap_err().1,
        "UNSAVED_CHANGES"
    );
    assert!(!root.join("discard.vvproj").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn clipboard_bridge_is_retry_safe_and_copy_does_not_create_an_undo_step() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-clipboard-host-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "copy".into(),
        },
        "clipboard-new",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let insert = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "clipboard-solid",
        Some(id),
    );
    editor.mutation(path.clone(), insert).unwrap();
    let clip = editor.session.project.timelines[id].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let steps = editor.session.history.position();
    let copy = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec![clip],
        },
        "clipboard-copy",
        Some(id),
    );
    editor.mutation(path.clone(), copy.clone()).unwrap();
    editor.mutation(path.clone(), copy).unwrap();
    assert_eq!(editor.snapshot()["clipboard_count"], 1);
    assert_eq!(editor.session.history.position(), steps);
    let paste = request(
        &editor,
        Operation::PasteClips { frame: 48 },
        "clipboard-paste",
        Some(id),
    );
    editor.mutation(path.clone(), paste.clone()).unwrap();
    editor.mutation(path, paste).unwrap();
    assert_eq!(editor.session.history.position(), steps + 1);
    assert_eq!(
        editor.session.project.timelines[id].tracks[0].clips.len(),
        2
    );
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn retries_epochs_revisions_and_writer_lease() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-host-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "test".into(),
        },
        "new",
        None,
    );
    editor.mutation(None, create.clone()).unwrap();
    editor.mutation(None, create).unwrap();
    assert_eq!(editor.session.epoch(), 1);
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "add",
        Some(id),
    );
    let mut stale = add.clone();
    stale.command_id = "stale".into();
    editor.mutation(path.clone(), add.clone()).unwrap();
    let steps = editor.session.history.position();
    editor.mutation(path.clone(), add.clone()).unwrap();
    assert_eq!(editor.session.history.position(), steps);
    assert_eq!(
        editor.mutation(path.clone(), stale).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    let mut reused = add;
    reused.operation = Operation::Undo;
    assert_eq!(
        editor.mutation(path.clone(), reused).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    let mut other = request(&editor, Operation::Undo, "other", Some(id));
    other.client_id = "other-client".into();
    assert_eq!(
        editor.mutation(path.clone(), other).unwrap_err().1,
        "READ_ONLY"
    );
    let save = request(&editor, Operation::Save, "save", None);
    editor.mutation(None, save).unwrap();
    let reopen = request(
        &editor,
        Operation::OpenProject {
            path_token: "test.vvproj".into(),
        },
        "open",
        None,
    );
    editor.mutation(None, reopen).unwrap();
    assert_eq!(editor.session.epoch(), 2);
    assert_eq!(
        editor.session.project.timelines[id].tracks[0].clips.len(),
        1
    );
    let change = request(
        &editor,
        Operation::AddTrack { audio: false },
        "history-track",
        Some(id),
    );
    editor.mutation(path.clone(), change).unwrap();
    let jump = request(
        &editor,
        Operation::HistoryJump { position: 0 },
        "history-jump",
        None,
    );
    editor.mutation(None, jump.clone()).unwrap();
    editor.mutation(None, jump).unwrap();
    assert_eq!(editor.session.project.timelines[id].tracks.len(), 2);
    let redo = request(&editor, Operation::Redo, "history-redo", None);
    editor.mutation(None, redo).unwrap();
    assert_eq!(editor.session.project.timelines[id].tracks.len(), 3);
    let original = std::fs::read(root.join("test.vvproj")).unwrap();
    let save_as = request(
        &editor,
        Operation::SaveAs {
            name: "copy".into(),
        },
        "save-copy",
        None,
    );
    editor.mutation(None, save_as.clone()).unwrap();
    editor.mutation(None, save_as).unwrap();
    assert!(root.join("copy.vvproj").exists());
    assert_eq!(std::fs::read(root.join("test.vvproj")).unwrap(), original);
    let conflict = request(
        &editor,
        Operation::SaveAs {
            name: "test".into(),
        },
        "save-copy-conflict",
        None,
    );
    assert_eq!(
        editor.mutation(None, conflict).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert_eq!(editor.session.path().unwrap(), root.join("copy.vvproj"));
    let new_timeline = request(
        &editor,
        Operation::NewTimeline {
            name: "Other rate".into(),
            fps: Rational::new(30000, 1001),
            resolution: [1280, 720],
        },
        "new-timeline",
        None,
    );
    editor.mutation(None, new_timeline).unwrap();
    assert_eq!(editor.session.project.timelines.len(), 2);
    let other = editor
        .session
        .project
        .timelines
        .values()
        .find(|t| t.name == "Other rate")
        .unwrap();
    assert_eq!(other.fps, Rational::new(30000, 1001));
    assert_eq!(other.resolution, (1280, 720));
    let invalid = request(
        &editor,
        Operation::NewTimeline {
            name: "Bad".into(),
            fps: Rational { num: 0, den: 1 },
            resolution: [0, 720],
        },
        "bad-timeline",
        None,
    );
    assert!(editor.mutation(None, invalid).is_err());
    assert_eq!(editor.session.project.timelines.len(), 2);
    std::fs::remove_dir_all(root).unwrap();
}
