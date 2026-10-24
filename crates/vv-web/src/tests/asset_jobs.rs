use super::*;
use vv_core::Id;

#[test]
fn shared_media_roots_capture_clipboard_otio_and_explicit_import_keep_approved_originals() {
    use std::os::unix::ffi::OsStrExt;
    let mut fixture = Fixture::new();
    let shared = fixture.root.join("shared");
    std::fs::create_dir(&shared).unwrap();
    let path = shared.join("0123456789abcdef.png");
    std::fs::copy(&fixture.path, &path).unwrap();
    let roots = crate::media_roots::MediaRoots::new(
        &fixture.project,
        File::open(&fixture.project).unwrap(),
    )
    .unwrap()
    .with_shared(&shared)
    .unwrap();
    fixture.jobs = Jobs::new_with_roots(
        fixture.store.clone(),
        &fixture.project,
        File::open(&fixture.project).unwrap(),
        roots,
    )
    .unwrap();
    let mut payload = asset_payload::decode(&fixture.asset).unwrap();
    for item in payload.files_mut() {
        item.path = path.clone();
        item.content_hash = vv_media::content_fingerprint(&path).unwrap();
    }
    let mut asset = fixture.asset.clone();
    asset.payload = payload.to_text();
    let file = File::open(&path).unwrap();
    let queued = fixture
        .jobs
        .prepare_capture(
            "epoch",
            "7",
            asset.clone(),
            vec![PinnedSource {
                path: path.clone(),
                identity: crate::source::file_identity(&file).unwrap(),
                file,
            }],
        )
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    fixture.jobs.status(id, "epoch", true).unwrap();

    let queued = fixture
        .jobs
        .prepare_clipboard("epoch", "7", &asset.payload, None, true)
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    let prepared = fixture.jobs.clipboard_payload(id, "epoch", "7").unwrap();
    assert_eq!(prepared.to_text(), asset.payload);
    fixture
        .jobs
        .mark_clipboard_applied(id, "epoch", "7")
        .unwrap();

    write_otio(&fixture, "shared.otio", std::slice::from_ref(&path));
    let queued = fixture
        .jobs
        .prepare_otio("epoch", "7", "shared.otio")
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(
        fixture
            .jobs
            .otio_payload(id, "epoch", "7")
            .unwrap()
            .project
            .media_pool
            .values()
            .next()
            .unwrap()
            .path,
        path
    );
    fixture.jobs.mark_otio_applied(id, "epoch", "7").unwrap();

    let canonical_token = "library://0123456789abcdef.png";
    let ungranted = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec![canonical_token.into()])
        .unwrap();
    let ungranted_id = ungranted["id"].as_str().unwrap();
    let ungranted_ready = fixture.finish(ungranted_id);
    assert_eq!(ungranted_ready["state"], "ready");
    assert_eq!(ungranted_ready["result"]["items"], json!([]));
    assert_eq!(
        ungranted_ready["result"]["errors"][0]["code"],
        "SOURCE_CHANGED"
    );
    let origin_name = format!(
        ".venturi-library-ref-{:x}.json",
        Sha256::digest(path.as_os_str().as_bytes())
    );
    let identity = asset_store::stable_identity(&File::open(&path).unwrap()).unwrap();
    let token = format!(
        "{canonical_token}?source={:x}",
        Sha256::digest(identity.as_bytes())
    );
    let mut grant = json!({
        "version":1,"provider":"ds4-appliance","mode":"reference",
        "service_origin":"http://127.0.0.1:8787/","source_path":path,
        "source_version":identity,
        "item":{"id":"0123456789abcdef","kind":"image","mime":"image/png","filename":"0123456789abcdef.png",
            "model":"Native fixture","tool":"image","bytes":std::fs::metadata(&path).unwrap().len(),
            "archived":true,"archive_rel":"0123456789abcdef.png"}
    });
    std::fs::write(
        fixture.project.join(&origin_name),
        serde_json::to_vec(&grant).unwrap(),
    )
    .unwrap();
    assert_eq!(
        validate_reference_import(
            &fixture.jobs.0,
            canonical_token,
            &path,
            &File::open(&path).unwrap()
        )
        .unwrap_err()
        .1,
        "SOURCE_CHANGED"
    );
    let queued = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec![token.clone()])
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    let prepared = fixture.jobs.media_import_payload(id, "epoch", "7").unwrap();
    assert_eq!(prepared.items[0].path, path);
    assert_eq!(prepared.items[0].path_token, token);
    std::fs::copy(&fixture.path, &path).unwrap();
    assert_eq!(
        fixture
            .jobs
            .media_import_payload(id, "epoch", "7")
            .err()
            .unwrap()
            .1,
        "SOURCE_CHANGED"
    );
    let identity = asset_store::stable_identity(&File::open(&path).unwrap()).unwrap();
    grant["source_version"] = json!(identity);
    std::fs::write(
        fixture.project.join(&origin_name),
        serde_json::to_vec(&grant).unwrap(),
    )
    .unwrap();
    let stale = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec![token])
        .unwrap();
    let stale = fixture.finish(stale["id"].as_str().unwrap());
    assert_eq!(stale["result"]["items"], json!([]));
    assert_eq!(stale["result"]["errors"][0]["code"], "SOURCE_CHANGED");
    let current_token = format!(
        "{canonical_token}?source={:x}",
        Sha256::digest(identity.as_bytes())
    );
    let current = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec![current_token.clone()])
        .unwrap();
    let current_id = current["id"].as_str().unwrap();
    assert_eq!(fixture.finish(current_id)["state"], "ready");
    let current = fixture
        .jobs
        .media_import_payload(current_id, "epoch", "7")
        .unwrap();
    assert_eq!(current.items[0].path_token, current_token);
    assert!(!fixture.project.join("0123456789abcdef.png").exists());
    fixture.close();
}

#[test]
fn shared_media_roots_project_by_name_skips_reachable_shared_media_without_scanning() {
    let mut fixture = Fixture::new();
    let shared = fixture.root.join("shared");
    std::fs::create_dir(&shared).unwrap();
    let path = shared.join("tiny.png");
    std::fs::copy(&fixture.path, &path).unwrap();
    let roots = crate::media_roots::MediaRoots::new(
        &fixture.project,
        File::open(&fixture.project).unwrap(),
    )
    .unwrap()
    .with_shared(&shared)
    .unwrap();
    fixture.jobs = Jobs::new_with_roots(
        fixture.store.clone(),
        &fixture.project,
        File::open(&fixture.project).unwrap(),
        roots,
    )
    .unwrap();
    let target = crate::project_media::Target {
        id: vv_core::MediaId::from_raw(9),
        item: vv_core::MediaItem {
            path,
            meta: vv_media::probe_image(&fixture.path).unwrap(),
            content_hash: 0,
            compound: None,
            folder: None,
        },
    };
    let queued = fixture
        .jobs
        .prepare_project_media(
            "epoch",
            "7",
            crate::project_media::Work::Relink {
                targets: vec![target],
                chosen: None,
                directory: Some("not-a-listed-folder".into()),
            },
        )
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["skipped"], json!(["9"]));
    fixture
        .jobs
        .project_media_payload(id, "epoch", "7", "project_relink")
        .unwrap();
    fixture.close();
}

#[test]
fn project_media_jobs_share_descriptor_admission_and_release_ready_witnesses_on_cancel() {
    let fixture = Fixture::new();
    let work = crate::project_media::Work::Import {
        tokens: vec!["tiny.png".into()],
        directory: None,
        parent: None,
    };
    let queued = fixture
        .jobs
        .prepare_project_media("epoch", "7", work)
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    let jobs = fixture.jobs.0.jobs.lock().unwrap();
    assert!(reserve_witnesses(&jobs, 256).is_err());
    drop(jobs);
    fixture.jobs.status(id, "epoch", true).unwrap();
    let jobs = fixture.jobs.0.jobs.lock().unwrap();
    reserve_witnesses(&jobs, 256).unwrap();
    drop(jobs);
    assert!(
        fixture
            .jobs
            .project_media_payload(id, "epoch", "7", "project_import")
            .is_err()
    );
    fixture.close();
}

#[test]
fn native_asset_import_set_shares_file_work_and_binds_order_revisions_cancel_and_budget() {
    let fixture = Fixture::new();
    let captured = fixture.capture();
    fixture
        .jobs
        .publish("first", captured["id"].as_str().unwrap(), "epoch", "7")
        .unwrap();
    let first = fixture.store.item("first", false).unwrap();
    let asset = fixture
        .store
        .load("first", first["revision"].as_str().unwrap())
        .unwrap();
    fixture.store.create("second", &asset).unwrap();
    let second = fixture.store.item("second", false).unwrap();
    let refs = vec![
        asset_store::ImportRef {
            asset_id: "second".into(),
            revision: second["revision"].as_str().unwrap().into(),
        },
        asset_store::ImportRef {
            asset_id: "first".into(),
            revision: first["revision"].as_str().unwrap().into(),
        },
    ];
    let queued = fixture
        .jobs
        .prepare_import_set("epoch", "7", &refs)
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["kind"], "import_set");
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["file_count"], 1);
    assert_eq!(ready["result"]["assets"][0]["asset_id"], "second");
    let payloads = fixture
        .jobs
        .import_set_payloads(id, &refs, "epoch", "7")
        .unwrap();
    assert_eq!(payloads.len(), 2);
    assert_eq!(
        payloads[0].files().next().unwrap().path,
        payloads[1].files().next().unwrap().path
    );
    assert_eq!(
        fixture
            .jobs
            .0
            .jobs
            .lock()
            .unwrap()
            .iter()
            .find(|job| job.id == id)
            .unwrap()
            .result
            .as_ref()
            .unwrap()
            .files
            .len(),
        1
    );
    let mut wrong = refs.clone();
    wrong.reverse();
    assert!(
        fixture
            .jobs
            .import_set_payloads(id, &wrong, "epoch", "7")
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .import_set_payloads(id, &refs, "epoch", "8")
            .is_err()
    );
    fixture.jobs.status(id, "epoch", true).unwrap();
    assert!(
        fixture
            .jobs
            .import_set_payloads(id, &refs, "epoch", "7")
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .prepare_import_set("epoch", "7", &vec![refs[0].clone(); 33])
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .prepare_import_set("epoch", "7", &[refs[0].clone(), refs[0].clone()])
            .is_err()
    );
    let queued = fixture
        .jobs
        .prepare_import_set("epoch", "7", &refs)
        .unwrap();
    let ready = fixture.finish(queued["id"].as_str().unwrap());
    assert_eq!(ready["state"], "ready");
    fixture
        .store
        .edit(
            "rename",
            &asset_store::Edit::Update {
                id: "first".into(),
                revision: refs[1].revision.clone(),
                name: "Changed".into(),
            },
        )
        .unwrap();
    assert!(
        fixture
            .jobs
            .import_set_payloads(queued["id"].as_str().unwrap(), &refs, "epoch", "7")
            .is_err()
    );
    let mut padded = asset;
    padded
        .payload
        .push_str(&" ".repeat(7 * 512 * 1024 - padded.payload.len()));
    let mut oversized = Vec::new();
    for index in 0..5 {
        let id = format!("metadata-{index}");
        fixture.store.create(&id, &padded).unwrap();
        oversized.push(asset_store::ImportRef {
            asset_id: id.clone(),
            revision: fixture.store.item(&id, false).unwrap()["revision"]
                .as_str()
                .unwrap()
                .into(),
        });
    }
    let records = fixture.jobs.0.jobs.lock().unwrap().len();
    assert!(
        fixture
            .jobs
            .prepare_import_set("epoch", "7", &oversized)
            .is_err()
    );
    assert_eq!(fixture.jobs.0.jobs.lock().unwrap().len(), records);
}

#[test]
fn asset_copy_closes_writer_before_pinning_readonly_stage_and_refuses_replacement() {
    let root = std::env::temp_dir().join(format!(
        "venturi-stage-reopen-{}-{}",
        std::process::id(),
        nonce()
    ));
    std::fs::create_dir(&root).unwrap();
    let directory = File::open(&root).unwrap();
    let stage = root.join("stage.part");
    let bytes = b"owned copied media bytes";
    let mut writer = File::create(&stage).unwrap();
    writer.write_all(bytes).unwrap();
    let written = writer.metadata().unwrap();
    let mut pinned = reopen_written_stage(writer, &directory, "stage.part").unwrap();
    let meta = pinned.metadata().unwrap();
    assert_eq!(
        (meta.dev(), meta.ino(), meta.len()),
        (written.dev(), written.ino(), written.len())
    );
    let mut actual = Vec::new();
    pinned.read_to_end(&mut actual).unwrap();
    assert_eq!(actual, bytes);
    assert!(pinned.write_all(b"must not write").is_err());
    drop(pinned);

    let writer = File::options().write(true).open(&stage).unwrap();
    std::fs::rename(&stage, root.join("original.part")).unwrap();
    std::fs::write(&stage, bytes).unwrap();
    assert_eq!(
        reopen_written_stage(writer, &directory, "stage.part")
            .err()
            .unwrap()
            .1,
        "SOURCE_CHANGED"
    );
    std::fs::remove_file(&stage).unwrap();
    std::os::unix::fs::symlink(root.join("original.part"), &stage).unwrap();
    let writer = File::options()
        .write(true)
        .open(root.join("original.part"))
        .unwrap();
    assert!(reopen_written_stage(writer, &directory, "stage.part").is_err());
    std::fs::remove_file(&stage).unwrap();
    std::fs::remove_file(root.join("original.part")).unwrap();
    drop(directory);
    std::fs::remove_dir(&root).unwrap();
}

fn tree_edit(fixture: &Fixture, directory: &str) -> asset_store::Edit {
    asset_store::Edit::ImportTree {
        directory_token: directory.into(),
        parent: None,
        folders_revision: fixture.store.folders().unwrap()["folders_revision"]
            .as_str()
            .unwrap()
            .into(),
    }
}

#[test]
fn native_tree_import_merges_native_hierarchy_skips_same_folder_fingerprints_and_persists_compact_receipts()
 {
    let fixture = Fixture::new();
    let shots = fixture.project.join("Shots");
    std::fs::create_dir_all(shots.join("Nested")).unwrap();
    std::fs::create_dir_all(shots.join("Empty")).unwrap();
    std::fs::copy(&fixture.path, shots.join("first.png")).unwrap();
    std::fs::copy(&fixture.path, shots.join("Nested/second.png")).unwrap();
    std::fs::write(shots.join("Nested/broken.mp4"), b"not media").unwrap();
    let edit = tree_edit(&fixture, "Shots");
    let ready = prepare_relink(&fixture, "tree-first", edit.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    let total = std::fs::metadata(shots.join("first.png")).unwrap().len()
        + std::fs::metadata(shots.join("Nested/second.png"))
            .unwrap()
            .len()
        + std::fs::metadata(shots.join("Nested/broken.mp4"))
            .unwrap()
            .len();
    assert_eq!(ready["total_bytes"], total);
    assert_eq!(ready["bytes"], total);
    assert_eq!(ready["result"]["imported_assets"], 2);
    assert_eq!(ready["result"]["skipped_files"], 0);
    assert_eq!(ready["result"]["created_folders"], 2);
    assert_eq!(ready["result"]["error_count"], 1);
    assert_eq!(
        ready["result"]["errors"][0]["path_token"],
        "Shots/Nested/broken.mp4"
    );
    assert_eq!(fixture.store.folders().unwrap()["folders"], json!([]));
    assert_eq!(
        fixture.store.list(0, &Default::default()).unwrap()["total"],
        0
    );
    let report = fixture
        .jobs
        .commit_edit("tree-first", [7; 32], "epoch", "7", &edit)
        .unwrap();
    assert_eq!(report, ready["result"]);
    let folders = fixture.store.folders().unwrap();
    let root = report["root_folder_id"].as_str().unwrap();
    assert!(
        folders["folders"]
            .as_array()
            .unwrap()
            .iter()
            .any(|folder| folder["id"] == root
                && folder["name"] == "Shots"
                && folder["parent"].is_null())
    );
    assert!(
        folders["folders"]
            .as_array()
            .unwrap()
            .iter()
            .any(|folder| folder["name"] == "Nested" && folder["parent"] == root)
    );
    let list = fixture.store.list(0, &Default::default()).unwrap();
    assert_eq!(list["total"], 2);
    for item in list["items"].as_array().unwrap() {
        let asset = fixture
            .store
            .load(
                item["id"].as_str().unwrap(),
                item["revision"].as_str().unwrap(),
            )
            .unwrap();
        let payload = asset_payload::decode(&asset).unwrap();
        assert_eq!(payload.media_ids().len(), 1);
        assert!(payload.clip_entries().is_empty());
        let media = payload.files().next().unwrap();
        let original = if asset.name == "first.png" {
            shots.join("first.png")
        } else {
            shots.join("Nested/second.png")
        };
        assert_eq!(
            media.content_hash,
            vv_media::content_fingerprint(&original).unwrap()
        );
        assert_eq!(
            std::fs::read(&media.path).unwrap(),
            std::fs::read(original).unwrap()
        );
    }
    let reopened = Store::new(fixture.store.root()).unwrap();
    let binding =
        crate::asset_journal::project_binding(&File::open(&fixture.project).unwrap()).unwrap();
    let receipt = reopened
        .completion("tree-first", &binding)
        .unwrap()
        .unwrap()
        .1;
    assert_eq!(receipt["error_count"], 1);
    assert_eq!(receipt["root_folder_id"], root);
    assert!(receipt.get("errors").is_none());
    assert!(serde_json::to_vec(&receipt).unwrap().len() < 4096);
    let again = tree_edit(&fixture, "Shots");
    let ready = prepare_relink(&fixture, "tree-repeat", again.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["root_folder_id"], root);
    assert_eq!(ready["result"]["imported_assets"], 0);
    assert_eq!(ready["result"]["skipped_files"], 2);
    assert_eq!(ready["result"]["created_folders"], 0);
    fixture
        .jobs
        .commit_edit("tree-repeat", [7; 32], "epoch", "7", &again)
        .unwrap();
    assert_eq!(
        fixture.store.list(0, &Default::default()).unwrap()["total"],
        2
    );
    drop(reopened);
    fixture.close();
}

#[test]
fn native_tree_import_cancel_and_source_folder_catalog_changes_never_publish_metadata() {
    for failure in ["cancel", "source", "folders", "roster"] {
        let fixture = Fixture::new();
        let shots = fixture.project.join("Shots");
        std::fs::create_dir(&shots).unwrap();
        std::fs::copy(&fixture.path, shots.join("one.png")).unwrap();
        let edit = tree_edit(&fixture, "Shots");
        let ready = prepare_relink(&fixture, "tree-guard", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        match failure {
            "cancel" => {
                fixture
                    .jobs
                    .status(ready["id"].as_str().unwrap(), "epoch", true)
                    .unwrap();
            }
            "source" => {
                std::fs::rename(&shots, fixture.project.join("previous")).unwrap();
                std::fs::create_dir(&shots).unwrap();
                std::fs::copy(&fixture.path, shots.join("one.png")).unwrap();
            }
            "folders" => {
                std::fs::write(
                    fixture.store.root().join("folders.json"),
                    br#"{"version":1,"folders":[]}"#,
                )
                .unwrap();
            }
            "roster" => {
                fixture.store.create("foreign", &fixture.asset).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            fixture
                .jobs
                .commit_edit("tree-guard", [7; 32], "epoch", "7", &edit)
                .is_err(),
            "{failure}"
        );
        assert_eq!(fixture.store.folders().unwrap()["folders"], json!([]));
        assert_eq!(
            fixture.store.list(0, &Default::default()).unwrap()["total"],
            usize::from(failure == "roster")
        );
        fixture.close();
    }
}

#[test]
fn native_tree_import_prunes_empty_sources_without_creating_an_invented_folder() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.project.join("Empty")).unwrap();
    std::fs::write(fixture.project.join("Empty/readme.txt"), b"no media").unwrap();
    let edit = tree_edit(&fixture, "Empty");
    let ready = prepare_relink(&fixture, "tree-empty", edit.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["root_folder_id"], Value::Null);
    assert_eq!(ready["result"]["folders_revision"], "absent");
    assert_eq!(ready["result"]["created_folders"], 0);
    fixture
        .jobs
        .commit_edit("tree-empty", [7; 32], "epoch", "7", &edit)
        .unwrap();
    assert!(!fixture.store.root().join("folders.json").exists());
    std::fs::create_dir(fixture.project.join("Broken")).unwrap();
    std::fs::write(fixture.project.join("Broken/bad.mp4"), b"not media").unwrap();
    let edit = tree_edit(&fixture, "Broken");
    let ready = prepare_relink(&fixture, "tree-broken", edit.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["imported_assets"], 0);
    assert_eq!(ready["result"]["error_count"], 1);
    assert_eq!(ready["result"]["created_folders"], 1);
    assert!(ready["result"]["root_folder_id"].is_string());
    fixture
        .jobs
        .commit_edit("tree-broken", [7; 32], "epoch", "7", &edit)
        .unwrap();
    assert_eq!(
        fixture.store.folders().unwrap()["folders"][0]["name"],
        "Broken"
    );
    fixture.close();
}

#[test]
fn deliberate_relink_replacement_publishes_new_content_and_import_never_reuses_old_media() {
    use vv_core::Command;
    for recursive in [false, true] {
        let fixture = Fixture::new();
        let captured = fixture.capture();
        fixture
            .jobs
            .publish("replace", captured["id"].as_str().unwrap(), "epoch", "7")
            .unwrap();
        assert_eq!(
            fixture
                .jobs
                .status(captured["id"].as_str().unwrap(), "epoch", false)
                .unwrap()["state"],
            "applied"
        );
        let revision = fixture.store.item("replace", false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        let old_asset = fixture.store.load("replace", &revision).unwrap();
        fixture.store.create("unselected-peer", &old_asset).unwrap();
        let peer = fixture.store.export("unselected-peer").unwrap();
        let before = fixture.store.export("replace").unwrap();
        let old_payload = asset_payload::decode(&old_asset).unwrap();
        let old_path = old_payload.files().next().unwrap().path.clone();
        let import = fixture
            .jobs
            .prepare_import("epoch", "7", "replace", &revision)
            .unwrap();
        assert_eq!(
            fixture.finish(import["id"].as_str().unwrap())["state"],
            "ready"
        );
        let imported = fixture
            .jobs
            .import_payload(
                import["id"].as_str().unwrap(),
                "replace",
                &revision,
                "epoch",
                "7",
            )
            .unwrap();
        let old_copy = imported.files().next().unwrap().path.clone();
        let old_bytes = std::fs::read(&old_copy).unwrap();
        let mut project = vv_core::Project::default();
        let mut add = vv_core::AddEntities::new(vv_core::CommandLabel::ImportMedia);
        imported.merge_into(&mut project, &mut add);
        add.apply(&mut project);
        fixture
            .jobs
            .accept_import(
                import["id"].as_str().unwrap(),
                "replace",
                &revision,
                "epoch",
                "7",
            )
            .unwrap();
        assert_eq!(
            fixture
                .jobs
                .status(import["id"].as_str().unwrap(), "epoch", false)
                .unwrap()["state"],
            "applied"
        );
        reserve_witnesses(
            &fixture.jobs.0.jobs.lock().unwrap(),
            crate::files::MAX_MEDIA_IMPORTS,
        )
        .unwrap();
        let old_ids = project.media_pool.keys().collect::<HashSet<_>>();
        std::fs::remove_file(&old_path).unwrap();
        let directory = fixture.project.join("Replacement/deep");
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("tiny.png");
        let mut encoder = png::Encoder::new(File::create(&source).unwrap(), 32, 24);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[231; 32 * 24 * 3])
            .unwrap();
        let edit = if recursive {
            asset_store::Edit::RelinkFolder {
                id: "replace".into(),
                revision: revision.clone(),
                directory_token: "Replacement".into(),
                replace_content: true,
            }
        } else {
            asset_store::Edit::Relink {
                id: "replace".into(),
                revision: revision.clone(),
                path_tokens: vec!["Replacement/deep/tiny.png".into()],
                replace_content: true,
            }
        };
        let ready = prepare_relink(&fixture, "replace-content", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        let report = &ready["result"];
        assert_eq!(report["replace_content"], true);
        assert_eq!(report["replaced_files"], 1);
        assert_eq!(
            report["replacement_digest"],
            format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&report["replacements"]).unwrap())
            )
        );
        assert_eq!(report["replacements"][0]["file_name"], "tiny.png");
        assert_eq!(
            report["replacements"][0]["source_token"],
            "Replacement/deep/tiny.png"
        );
        assert_eq!(report["replacements"][0]["after"]["meta"]["width"], 32);
        assert_eq!(fixture.store.export("replace").unwrap(), before);
        let receipt = fixture
            .jobs
            .commit_edit("replace-content", [7; 32], "epoch", "7", &edit)
            .unwrap();
        assert_eq!(receipt, ready["result"]);
        let current = fixture.store.item("replace", false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_ne!(current, revision);
        let changed = fixture.store.load("replace", &current).unwrap();
        let actual = asset_payload::decode(&changed).unwrap();
        let file = actual.files().next().unwrap();
        assert_ne!(file.path, old_path);
        assert_eq!(file.meta.width, 32);
        assert_eq!(file.meta.height, 24);
        assert_eq!(
            json!(file.content_hash.to_string()),
            report["replacements"][0]["after"]["content_hash"]
        );
        assert_eq!(
            file.path
                .parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_str()
                .unwrap(),
            format!("{:x}", Sha256::digest(std::fs::read(&source).unwrap()))
        );
        assert_eq!(
            std::fs::read(&file.path).unwrap(),
            std::fs::read(&source).unwrap()
        );
        assert_eq!(
            actual.fragment().media_pool.keys().collect::<Vec<_>>(),
            old_payload.fragment().media_pool.keys().collect::<Vec<_>>()
        );
        assert_eq!(std::fs::read(&old_copy).unwrap(), old_bytes);
        assert_eq!(fixture.store.export("unselected-peer").unwrap(), peer);
        assert!(
            fixture
                .jobs
                .prepare_import("epoch", "7", "replace", &revision)
                .is_err()
        );
        let queued = fixture
            .jobs
            .prepare_import("epoch", "7", "replace", &current)
            .unwrap();
        assert_eq!(
            fixture.finish(queued["id"].as_str().unwrap())["state"],
            "ready"
        );
        let incoming = fixture
            .jobs
            .import_payload(
                queued["id"].as_str().unwrap(),
                "replace",
                &current,
                "epoch",
                "7",
            )
            .unwrap();
        let mut add = vv_core::AddEntities::new(vv_core::CommandLabel::ImportMedia);
        let pasted = incoming.merge_into(&mut project, &mut add);
        add.apply(&mut project);
        assert!(
            pasted.media.iter().all(|id| !old_ids.contains(id)),
            "new bytes must not reuse an old root"
        );
        let copies = project
            .media_pool
            .iter()
            .filter(|(_, item)| item.compound.is_none())
            .collect::<Vec<_>>();
        assert_eq!(copies.len(), 2);
        assert_ne!(copies[0].1.path, copies[1].1.path);
        assert_ne!(copies[0].1.content_hash, copies[1].1.content_hash);
        let reopened = Store::new(fixture.store.root()).unwrap();
        let binding =
            crate::asset_journal::project_binding(&File::open(&fixture.project).unwrap()).unwrap();
        let completion = reopened
            .completion("replace-content", &binding)
            .unwrap()
            .unwrap();
        assert_eq!(
            completion.1["replacement_digest"],
            report["replacement_digest"]
        );
        assert_eq!(completion.1["replaced_files"], 1);
        assert!(completion.1.get("replacements").is_none());
        assert_eq!(reopened.item("replace", false).unwrap()["missing_count"], 0);
        drop(reopened);
        fixture.close();
    }
}

#[test]
fn deliberate_relink_replacement_source_destination_cancel_and_catalog_changes_refuse_commit() {
    for change in [
        "source",
        "destination",
        "restored_original",
        "cancel",
        "revision",
    ] {
        let fixture = Fixture::new();
        let mut edit = offline_relink(&fixture, "offline");
        let asset_store::Edit::Relink {
            replace_content, ..
        } = &mut edit
        else {
            unreachable!()
        };
        *replace_content = true;
        let before = fixture.store.export("offline").unwrap();
        let ready = prepare_relink(&fixture, "replace-guard", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        let mut expected = before.clone();
        if change == "cancel" {
            fixture
                .jobs
                .status(ready["id"].as_str().unwrap(), "epoch", true)
                .unwrap();
        } else if change == "revision" {
            let asset_store::Edit::Relink { revision, .. } = &edit else {
                unreachable!()
            };
            fixture
                .store
                .edit(
                    "rename",
                    &asset_store::Edit::Update {
                        id: "offline".into(),
                        revision: revision.clone(),
                        name: "New name".into(),
                    },
                )
                .unwrap();
            expected = fixture.store.export("offline").unwrap();
        } else if change == "restored_original" {
            let asset = asset_payload::parse(&before).unwrap();
            let payload = asset_payload::decode(&asset).unwrap();
            let path = &payload.files().next().unwrap().path;
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::copy(&fixture.path, path).unwrap();
        } else {
            let path = if change == "source" {
                fixture.path.clone()
            } else {
                let jobs = fixture.jobs.0.jobs.lock().unwrap();
                let prepared = jobs
                    .iter()
                    .find(|job| job.id == ready["id"].as_str().unwrap())
                    .unwrap()
                    .edit_result
                    .as_ref()
                    .unwrap();
                fixture
                    .store
                    .root()
                    .join("media")
                    .join(prepared.files[0].parent.as_ref().unwrap())
                    .join(&prepared.files[0].name)
            };
            let bytes = std::fs::read(&path).unwrap();
            let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
            std::fs::write(&path, bytes).unwrap();
            File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(modified))
                .unwrap();
        }
        assert!(
            fixture
                .jobs
                .commit_edit("replace-guard", [7; 32], "epoch", "7", &edit)
                .is_err(),
            "{change}"
        );
        assert_eq!(fixture.store.export("offline").unwrap(), expected);
        fixture.close();
    }
}

#[test]
fn deliberate_relink_import_acceptance_rechecks_cancel_revision_and_copied_bytes_before_release() {
    for change in ["cancel", "revision", "bytes"] {
        let fixture = Fixture::new();
        let captured = fixture.capture();
        let capture_id = captured["id"].as_str().unwrap();
        fixture
            .jobs
            .publish("accept-source", capture_id, "epoch", "7")
            .unwrap();
        fixture
            .jobs
            .publish("accept-source", capture_id, "epoch", "7")
            .unwrap();
        assert_eq!(
            fixture
                .jobs
                .publish("other-command", capture_id, "epoch", "7")
                .unwrap_err()
                .1,
            "ASSET_PUBLISHED"
        );
        let revision = fixture.store.item("accept-source", false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        let queued = fixture
            .jobs
            .prepare_import("epoch", "7", "accept-source", &revision)
            .unwrap();
        let id = queued["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "ready");
        let payload = fixture
            .jobs
            .import_payload(id, "accept-source", &revision, "epoch", "7")
            .unwrap();
        match change {
            "cancel" => {
                fixture.jobs.status(id, "epoch", true).unwrap();
            }
            "revision" => {
                fixture
                    .store
                    .edit(
                        "rename-before-accept",
                        &asset_store::Edit::Update {
                            id: "accept-source".into(),
                            revision: revision.clone(),
                            name: "Changed before acceptance".into(),
                        },
                    )
                    .unwrap();
            }
            _ => {
                std::fs::write(
                    &payload.files().next().unwrap().path,
                    b"foreign copied bytes",
                )
                .unwrap();
            }
        }
        assert!(
            fixture
                .jobs
                .accept_import(id, "accept-source", &revision, "epoch", "7")
                .is_err(),
            "{change}"
        );
        assert_ne!(
            fixture.jobs.status(id, "epoch", false).unwrap()["state"],
            "applied"
        );
        fixture.close();
    }
}

#[test]
fn deliberate_relink_identical_sha_replacement_accepts_only_its_own_verified_restored_original() {
    for changed in [false, true] {
        let fixture = Fixture::new();
        let bytes = std::fs::read(&fixture.path).unwrap();
        let sha = format!("{:x}", Sha256::digest(&bytes));
        let path = fixture
            .store
            .root()
            .join("media")
            .join(sha)
            .join("tiny.png");
        let mut asset = fixture.asset.clone();
        let mut payload = asset_payload::decode(&asset).unwrap();
        for item in payload.files_mut() {
            item.path = path.clone();
        }
        asset.payload = payload.to_text();
        fixture
            .store
            .create("same-sha-replacement", &asset)
            .unwrap();
        let before = fixture.store.export("same-sha-replacement").unwrap();
        let edit = asset_store::Edit::Relink {
            id: "same-sha-replacement".into(),
            revision: fixture.store.item("same-sha-replacement", false).unwrap()["revision"]
                .as_str()
                .unwrap()
                .into(),
            path_tokens: vec!["tiny.png".into()],
            replace_content: true,
        };
        let ready = prepare_relink(&fixture, "same-sha-replacement-command", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        assert_eq!(ready["result"]["replaced_files"], 1);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(
            fixture.store.export("same-sha-replacement").unwrap(),
            before
        );
        if changed {
            let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
            std::fs::write(&path, &bytes).unwrap();
            File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(modified))
                .unwrap();
        }
        let result =
            fixture
                .jobs
                .commit_edit("same-sha-replacement-command", [7; 32], "epoch", "7", &edit);
        if changed {
            assert_eq!(result.unwrap_err().1, "SOURCE_CHANGED");
            assert_eq!(
                fixture.store.export("same-sha-replacement").unwrap(),
                before
            );
        } else {
            assert_eq!(result.unwrap()["missing_count"], 0);
            let actual =
                asset_payload::parse(&fixture.store.export("same-sha-replacement").unwrap())
                    .unwrap();
            let actual = asset_payload::decode(&actual).unwrap();
            assert_eq!(actual.files().next().unwrap().path, path);
            assert_eq!(
                actual.fragment().media_pool.keys().collect::<Vec<_>>(),
                payload.fragment().media_pool.keys().collect::<Vec<_>>()
            );
        }
        fixture.close();
    }
}

#[test]
fn native_asset_relink_normalizes_legacy_uppercase_hash_names_for_selected_and_recursive_sources() {
    for (recursive, literal) in [(false, false), (true, false), (false, true)] {
        let fixture = Fixture::new();
        let mut asset = fixture.asset.clone();
        let mut payload = asset_payload::decode(&asset).unwrap();
        let mut missing_path = None;
        for item in payload.files_mut() {
            item.path = fixture
                .store
                .root()
                .join("media")
                .join(format!("{:016x}", item.content_hash))
                .join("0123456789ABCDEF-Camera take.png");
            missing_path = Some(item.path.clone());
        }
        let missing_path = missing_path.unwrap();
        asset.payload = payload.to_text();
        fixture.store.create("legacy-offline", &asset).unwrap();
        let revision = fixture.store.item("legacy-offline", false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        let replacement_name = if literal {
            "0123456789ABCDEF-Camera take.png"
        } else {
            "Camera take.png"
        };
        let replacement = if recursive {
            let directory = fixture.project.join("Replacements/deep");
            std::fs::create_dir_all(&directory).unwrap();
            directory.join(replacement_name)
        } else {
            fixture.project.join(replacement_name)
        };
        std::fs::copy(&fixture.path, &replacement).unwrap();
        let edit = if recursive {
            asset_store::Edit::RelinkFolder {
                id: "legacy-offline".into(),
                revision,
                directory_token: "Replacements".into(),
                replace_content: false,
            }
        } else {
            asset_store::Edit::Relink {
                id: "legacy-offline".into(),
                revision,
                path_tokens: vec![replacement_name.into()],
                replace_content: false,
            }
        };
        let before = fixture.store.export("legacy-offline").unwrap();
        let ready = prepare_relink(&fixture, "legacy-repair", edit.clone());
        assert_eq!(
            ready["state"], "ready",
            "recursive={recursive}, literal={literal}: {ready}"
        );
        assert_eq!(ready["result"]["missing_count"], 0);
        assert_eq!(ready["result"]["relinked_files"], 1);
        assert_eq!(
            fixture.store.export("legacy-offline").unwrap(),
            before,
            "preparation does not publish asset metadata"
        );
        let report = fixture
            .jobs
            .commit_edit("legacy-repair", [7; 32], "epoch", "7", &edit)
            .unwrap();
        assert_eq!(report["relinked_files"], 1);
        assert_eq!(
            std::fs::read(&missing_path).unwrap(),
            std::fs::read(&fixture.path).unwrap()
        );
        let reopened = Store::new(fixture.store.root()).unwrap();
        assert_eq!(
            reopened.item("legacy-offline", false).unwrap()["missing_count"],
            0
        );
        let restored = asset_payload::parse(&reopened.export("legacy-offline").unwrap()).unwrap();
        assert_eq!(
            asset_payload::decode(&restored).unwrap().to_text(),
            payload.to_text(),
            "only the missing managed file is restored; IDs, metadata, hashes and compound references stay exact"
        );
        drop(reopened);
        fixture.close();
    }
}

#[test]
fn native_recursive_relink_uses_approved_nested_files_preserves_payload_and_guards_tree_changes() {
    for changed in [false, true] {
        let fixture = Fixture::new();
        let original_edit = offline_relink(&fixture, "offline");
        let asset_store::Edit::Relink { id, revision, .. } = original_edit else {
            unreachable!()
        };
        let directory = fixture.project.join("Replacements/deep");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::copy(&fixture.path, directory.join("tiny.png")).unwrap();
        let edit = asset_store::Edit::RelinkFolder {
            id,
            revision,
            directory_token: "Replacements".into(),
            replace_content: false,
        };
        let original = fixture.store.export("offline").unwrap();
        let ready = prepare_relink(&fixture, "tree-relink", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        assert_eq!(ready["result"]["missing_count"], 0);
        assert_eq!(ready["result"]["relinked_files"], 1);
        assert_eq!(fixture.store.export("offline").unwrap(), original);
        if changed {
            std::fs::write(directory.join("new.txt"), b"tree changed").unwrap();
            assert!(
                fixture
                    .jobs
                    .commit_edit("tree-relink", [7; 32], "epoch", "7", &edit)
                    .is_err()
            );
            assert_eq!(fixture.store.export("offline").unwrap(), original);
        } else {
            fixture
                .jobs
                .commit_edit("tree-relink", [7; 32], "epoch", "7", &edit)
                .unwrap();
            let after = asset_payload::parse(&fixture.store.export("offline").unwrap()).unwrap();
            let before = asset_payload::parse(&original).unwrap();
            assert_eq!(after.name, before.name);
            assert_eq!(after.folder, before.folder);
            let mut expected = asset_payload::decode(&before).unwrap();
            let actual = asset_payload::decode(&after).unwrap();
            let path = actual.files().next().unwrap().path.clone();
            for item in expected.files_mut() {
                item.path = path.clone();
            }
            assert_eq!(actual.to_text(), expected.to_text());
            assert_eq!(
                Store::new(fixture.store.root())
                    .unwrap()
                    .item("offline", false)
                    .unwrap()["missing_count"],
                0
            );
        }
        fixture.close();
    }
}

fn offline_relink(fixture: &Fixture, id: &str) -> asset_store::Edit {
    let mut asset = fixture.asset.clone();
    let mut payload = asset_payload::decode(&asset).unwrap();
    for item in payload.files_mut() {
        item.path = fixture
            .store
            .root()
            .join("media")
            .join(format!("{:016x}", item.content_hash))
            .join("tiny.png");
    }
    asset.payload = payload.to_text();
    fixture.store.create(id, &asset).unwrap();
    asset_store::Edit::Relink {
        id: id.into(),
        revision: fixture.store.item(id, false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .into(),
        path_tokens: vec!["tiny.png".into()],
        replace_content: false,
    }
}
fn prepare_relink(fixture: &Fixture, id: &str, edit: asset_store::Edit) -> Value {
    let job = fixture
        .jobs
        .prepare_edit("epoch", "7", id, [7; 32], edit_receipt(id), edit)
        .unwrap();
    fixture.finish(job["id"].as_str().unwrap())
}
#[test]
fn native_asset_relink_preserves_compound_ids_metadata_hashes_and_durable_counts_across_reopen() {
    let fixture = Fixture::new();
    let edit = offline_relink(&fixture, "offline");
    let original = fixture.store.export("offline").unwrap();
    assert_eq!(
        fixture.store.item("offline", false).unwrap()["missing_count"],
        1
    );
    let ready = prepare_relink(&fixture, "repair", edit.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["missing_count"], 0);
    assert_eq!(ready["result"]["relinked_files"], 1);
    assert_eq!(ready["result"]["asset_id"], "offline");
    assert_eq!(fixture.store.export("offline").unwrap(), original);
    let report = fixture
        .jobs
        .commit_edit("repair", [7; 32], "epoch", "7", &edit)
        .unwrap();
    assert_eq!(report["missing_count"], 0);
    assert_eq!(report["relinked_files"], 1);
    let restored = fixture.store.export("offline").unwrap();
    let after = asset_payload::parse(&restored).unwrap();
    let mut before = asset_payload::parse(&original).unwrap();
    let mut expected = asset_payload::decode(&before).unwrap();
    let actual = asset_payload::decode(&after).unwrap();
    let paths: Vec<_> = actual.files().map(|file| file.path.clone()).collect();
    for item in expected.files_mut() {
        item.path = paths[0].clone();
    }
    before.payload = expected.to_text();
    assert_eq!(
        serde_json::to_value(&before).unwrap(),
        serde_json::to_value(&after).unwrap()
    );
    assert_eq!(
        std::fs::read(&paths[0]).unwrap(),
        std::fs::read(&fixture.path).unwrap()
    );
    assert_eq!(
        std::fs::read(fixture.store.root().join("assets/offline.json.bak")).unwrap(),
        original
    );
    let reopened = Store::new(fixture.store.root()).unwrap();
    assert_eq!(reopened.export("offline").unwrap(), restored);
    assert_eq!(reopened.item("offline", false).unwrap()["missing_count"], 0);
    let completion = reopened
        .completion(
            "repair",
            &crate::asset_journal::project_binding(&File::open(&fixture.project).unwrap()).unwrap(),
        )
        .unwrap()
        .unwrap();
    assert_eq!(completion.1["missing_count"], 0);
    assert_eq!(completion.1["relinked_files"], 1);
    drop(reopened);
    fixture.close();
}
#[test]
fn native_asset_relink_last_cas_rejects_restored_mtime_source_and_destination_replacement() {
    for destination in [false, true] {
        let fixture = Fixture::new();
        let edit = offline_relink(&fixture, "offline");
        let before = fixture.store.export("offline").unwrap();
        let ready = prepare_relink(&fixture, "repair", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        let path = if destination {
            let jobs = fixture.jobs.0.jobs.lock().unwrap();
            let prepared = jobs
                .iter()
                .find(|job| job.id == ready["id"].as_str().unwrap())
                .unwrap()
                .edit_result
                .as_ref()
                .unwrap();
            fixture
                .store
                .root()
                .join("media")
                .join(prepared.files[0].parent.as_ref().unwrap())
                .join(&prepared.files[0].name)
        } else {
            fixture.path.clone()
        };
        let bytes = std::fs::read(&path).unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, &bytes).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert!(
            fixture
                .jobs
                .commit_edit("repair", [7; 32], "epoch", "7", &edit)
                .is_err()
        );
        assert_eq!(fixture.store.export("offline").unwrap(), before);
        fixture.close();
    }
}
#[test]
fn native_asset_relink_cancel_stale_revision_and_unsafe_tokens_never_commit_metadata() {
    for cancel in [false, true] {
        let fixture = Fixture::new();
        let edit = offline_relink(&fixture, "offline");
        let ready = prepare_relink(&fixture, "repair", edit.clone());
        assert_eq!(ready["state"], "ready", "{ready}");
        if cancel {
            fixture
                .jobs
                .status(ready["id"].as_str().unwrap(), "epoch", true)
                .unwrap();
        } else {
            let asset_store::Edit::Relink { revision, .. } = &edit else {
                unreachable!()
            };
            fixture
                .store
                .edit(
                    "rename",
                    &asset_store::Edit::Update {
                        id: "offline".into(),
                        revision: revision.clone(),
                        name: "Newer user name".into(),
                    },
                )
                .unwrap();
        }
        let expected = fixture.store.export("offline").unwrap();
        assert!(
            fixture
                .jobs
                .commit_edit("repair", [7; 32], "epoch", "7", &edit)
                .is_err()
        );
        assert_eq!(fixture.store.export("offline").unwrap(), expected);
        fixture.close();
    }
    let fixture = Fixture::new();
    let mut edit = offline_relink(&fixture, "offline");
    if let asset_store::Edit::Relink { path_tokens, .. } = &mut edit {
        *path_tokens = vec!["../outside.png".into()];
    }
    assert!(
        fixture
            .jobs
            .prepare_edit(
                "epoch",
                "7",
                "unsafe",
                [7; 32],
                edit_receipt("unsafe"),
                edit
            )
            .is_err()
    );
    fixture.close();
}
#[test]
fn native_asset_relink_unmatched_selection_reports_remaining_missing_without_rewriting_asset() {
    let fixture = Fixture::new();
    let mut edit = offline_relink(&fixture, "offline");
    if let asset_store::Edit::Relink { path_tokens, .. } = &mut edit {
        *path_tokens = vec!["other.png".into()];
    }
    std::fs::copy(&fixture.path, fixture.project.join("other.png")).unwrap();
    let before = fixture.store.export("offline").unwrap();
    let ready = prepare_relink(&fixture, "unmatched", edit.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["result"]["missing_count"], 1);
    assert_eq!(ready["result"]["relinked_files"], 0);
    let report = fixture
        .jobs
        .commit_edit("unmatched", [7; 32], "epoch", "7", &edit)
        .unwrap();
    assert_eq!(report["missing_count"], 1);
    assert_eq!(fixture.store.export("offline").unwrap(), before);
    fixture.close();
}
#[test]
fn native_asset_relink_repairs_original_sha_path_without_treating_its_own_verified_copy_as_stale() {
    let fixture = Fixture::new();
    let digest = format!(
        "{:x}",
        Sha256::digest(std::fs::read(&fixture.path).unwrap())
    );
    let mut asset = fixture.asset.clone();
    let mut payload = asset_payload::decode(&asset).unwrap();
    let path = fixture
        .store
        .root()
        .join("media")
        .join(digest)
        .join("tiny.png");
    for item in payload.files_mut() {
        item.path = path.clone();
    }
    asset.payload = payload.to_text();
    fixture.store.create("same-path", &asset).unwrap();
    let before = fixture.store.export("same-path").unwrap();
    let edit = asset_store::Edit::Relink {
        id: "same-path".into(),
        revision: fixture.store.item("same-path", false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .into(),
        path_tokens: vec!["tiny.png".into()],
        replace_content: false,
    };
    let ready = prepare_relink(&fixture, "same-path-repair", edit.clone());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert!(path.is_file());
    assert_eq!(fixture.store.export("same-path").unwrap(), before);
    assert_eq!(
        fixture
            .jobs
            .commit_edit("same-path-repair", [7; 32], "epoch", "7", &edit)
            .unwrap()["missing_count"],
        0
    );
    assert_eq!(fixture.store.export("same-path").unwrap(), before);
    let revision = fixture.store.item("same-path", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let imported = fixture
        .jobs
        .prepare_import("epoch", "7", "same-path", &revision)
        .unwrap();
    let imported = fixture.finish(imported["id"].as_str().unwrap());
    assert_eq!(
        imported["state"], "ready",
        "Restored SHA media must remain importable: {imported}"
    );
    fixture.close();
}
#[test]
fn native_asset_relink_mismatched_replacement_is_refused_before_publishing_any_media_cache_file() {
    let fixture = Fixture::new();
    let mut asset = fixture.asset.clone();
    let mut payload = asset_payload::decode(&asset).unwrap();
    let sha = format!(
        "{:x}",
        Sha256::digest(std::fs::read(&fixture.path).unwrap())
    );
    for item in payload.files_mut() {
        item.path = fixture
            .store
            .root()
            .join("media")
            .join(&sha)
            .join("tiny.png");
    }
    asset.payload = payload.to_text();
    fixture.store.create("offline", &asset).unwrap();
    let edit = asset_store::Edit::Relink {
        id: "offline".into(),
        revision: fixture.store.item("offline", false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .into(),
        path_tokens: vec!["tiny.png".into()],
        replace_content: false,
    };
    let before = fixture.store.export("offline").unwrap();
    let mut encoder = png::Encoder::new(File::create(&fixture.path).unwrap(), 16, 16);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&[255; 16 * 16 * 3])
        .unwrap();
    let ready = prepare_relink(&fixture, "mismatch", edit);
    assert_eq!(ready["state"], "failed", "{ready}");
    assert_eq!(ready["error"], "SOURCE_CHANGED");
    assert_eq!(fixture.store.export("offline").unwrap(), before);
    assert_eq!(
        std::fs::read_dir(fixture.store.root().join("media"))
            .unwrap()
            .count(),
        0
    );
    fixture.close();
}

#[test]
fn clipboard_image_prepares_original_bytes_then_publishes_once_after_native_trial() {
    let fixture = Fixture::new();
    let bytes = std::fs::read(&fixture.path).unwrap();
    let job = fixture
        .jobs
        .prepare_clipboard_image("epoch", "7", "image/png", bytes.clone())
        .unwrap();
    let id = job["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    assert_eq!(ready["kind"], "clipboard_image");
    assert_eq!(ready["result"]["mime"], "image/png");
    assert_eq!(ready["result"]["extension"], "png");
    assert_eq!(ready["result"]["bytes"], bytes.len());
    assert_eq!(ready["result"]["width"], 16);
    assert_eq!(ready["result"]["height"], 16);
    assert!(
        !ready["result"]["suggested_name"]
            .as_str()
            .unwrap()
            .is_empty()
    );
    let trial = fixture
        .jobs
        .clipboard_image_payload(id, "epoch", "7", "Original image")
        .unwrap();
    assert_eq!(trial.content_hash, 0);
    assert!(!trial.path.exists());
    assert_eq!(
        trial.path,
        fixture.project.join("Pasted Images/Original image.png")
    );
    assert_eq!(trial.path_token, "Pasted Images/Original image.png");
    assert!(
        fixture
            .jobs
            .clipboard_image_payload(id, "epoch", "8", "Original image")
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .accept_clipboard_image(id, "other-epoch", "7", "Original image")
            .is_err()
    );
    {
        let jobs = fixture.jobs.0.jobs.lock().unwrap();
        reserve_witnesses(&jobs, 248).unwrap();
        assert_eq!(reserve_witnesses(&jobs, 249).unwrap_err().1, "ASSET_BUSY");
    }
    let published = fixture
        .jobs
        .accept_clipboard_image(id, "epoch", "7", "Original image")
        .unwrap();
    assert_eq!(published.path, trial.path);
    assert_eq!(
        serde_json::to_value(&published.meta).unwrap(),
        serde_json::to_value(&trial.meta).unwrap()
    );
    assert_eq!(std::fs::read(&published.path).unwrap(), bytes);
    assert_eq!(
        published.content_hash,
        vv_media::content_fingerprint(&published.path).unwrap()
    );
    let retry = fixture
        .jobs
        .accept_clipboard_image(id, "epoch", "7", "Original image")
        .unwrap();
    assert_eq!(retry.path, published.path);
    assert_eq!(retry.content_hash, published.content_hash);
    assert!(
        fixture
            .jobs
            .accept_clipboard_image(id, "epoch", "7", "Different image")
            .is_err()
    );
    assert_eq!(
        fixture.jobs.status(id, "epoch", true).unwrap()["state"],
        "applied"
    );
    fixture.jobs.cancel_obsolete("new-epoch");
    assert!(published.path.exists());
    reserve_witnesses(&fixture.jobs.0.jobs.lock().unwrap(), 256).unwrap();
    assert_eq!(
        std::fs::read_dir(published.path.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
    fixture.close();
}

#[test]
fn clipboard_image_collision_is_editable_and_cancel_or_epoch_change_cleans_staging() {
    for obsolete in [false, true] {
        let fixture = Fixture::new();
        let bytes = std::fs::read(&fixture.path).unwrap();
        let job = fixture
            .jobs
            .prepare_clipboard_image("epoch", "7", "image/png", bytes)
            .unwrap();
        let id = job["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "ready");
        let folder = fixture.project.join("Pasted Images");
        std::fs::create_dir_all(&folder).unwrap();
        let foreign = folder.join("Collision.png");
        std::fs::write(&foreign, b"foreign existing file").unwrap();
        let error = fixture
            .jobs
            .accept_clipboard_image(id, "epoch", "7", "Collision")
            .err()
            .unwrap();
        assert_eq!(error.1, "IMAGE_NAME_TAKEN");
        assert_eq!(
            fixture.jobs.status(id, "epoch", false).unwrap()["state"],
            "ready"
        );
        assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign existing file");
        assert!(
            fixture
                .jobs
                .clipboard_image_payload(id, "epoch", "7", "Another name")
                .is_ok()
        );
        if obsolete {
            fixture.jobs.cancel_obsolete("new-epoch");
        } else {
            fixture.jobs.status(id, "epoch", true).unwrap();
        }
        assert_eq!(
            fixture.jobs.status(id, "epoch", false).unwrap()["state"],
            "canceled"
        );
        assert!(
            fixture
                .jobs
                .accept_clipboard_image(id, "epoch", "7", "Another name")
                .is_err()
        );
        assert_eq!(
            std::fs::read_dir(&fixture.project).unwrap().count(),
            3,
            "Only the original media, empty stage directory and foreign directory remain"
        );
        assert_eq!(
            std::fs::read_dir(
                fixture
                    .project
                    .join(crate::clipboard_image::STAGING_DIRECTORY)
            )
            .unwrap()
            .count(),
            0
        );
        assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign existing file");
        fixture.close();
    }
}

#[test]
fn clipboard_image_checks_stage_identity_before_publication_and_preserves_probe_failure() {
    let fixture = Fixture::new();
    let bytes = std::fs::read(&fixture.path).unwrap();
    assert!(
        fixture
            .jobs
            .prepare_clipboard_image("epoch", "7", "image/jpeg", bytes.clone())
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .prepare_clipboard_image("epoch", "7", "image/png", vec![])
            .is_err()
    );
    let job = fixture
        .jobs
        .prepare_clipboard_image("epoch", "7", "image/png", bytes)
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    let staged_path = {
        let jobs = fixture.jobs.0.jobs.lock().unwrap();
        let job = jobs.iter().find(|job| job.id == id).unwrap();
        let file = job.clipboard_image.as_ref().unwrap().stage.file();
        std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).unwrap()
    };
    std::fs::write(&staged_path, b"changed after native probe").unwrap();
    assert!(
        fixture
            .jobs
            .clipboard_image_payload(id, "epoch", "7", "Changed")
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .accept_clipboard_image(id, "epoch", "7", "Changed")
            .is_err()
    );
    assert!(!fixture.project.join("Pasted Images/Changed.png").exists());
    fixture.jobs.status(id, "epoch", true).unwrap();
    let malformed = b"\x89PNG\r\n\x1a\ninvalid image body".to_vec();
    let job = fixture
        .jobs
        .prepare_clipboard_image("epoch", "7", "image/png", malformed)
        .unwrap();
    let id = job["id"].as_str().unwrap();
    let failed = fixture.finish(id);
    assert_eq!(failed["state"], "failed");
    let failure = fixture.jobs.read_failure(id, "epoch").unwrap().unwrap();
    assert_eq!(failed["error"], failure.1);
    assert!(!fixture.project.join("Pasted Images/Changed.png").exists());
    fixture.close();
}

#[test]
fn clipboard_image_ready_record_eviction_releases_only_owned_stages() {
    let fixture = Fixture::new();
    let bytes = std::fs::read(&fixture.path).unwrap();
    let mut ids = Vec::new();
    for _ in 0..=MAX_RECORDS {
        let job = fixture
            .jobs
            .prepare_clipboard_image("epoch", "7", "image/png", bytes.clone())
            .unwrap();
        let id = job["id"].as_str().unwrap().to_owned();
        assert_eq!(fixture.finish(&id)["state"], "ready");
        ids.push(id);
    }
    assert!(fixture.jobs.status(&ids[0], "epoch", false).is_err());
    assert_eq!(fixture.jobs.0.jobs.lock().unwrap().len(), MAX_RECORDS);
    assert_eq!(std::fs::read_dir(&fixture.project).unwrap().count(), 2);
    assert_eq!(
        std::fs::read_dir(
            fixture
                .project
                .join(crate::clipboard_image::STAGING_DIRECTORY)
        )
        .unwrap()
        .count(),
        MAX_RECORDS
    );
    for id in &ids[1..] {
        fixture.jobs.status(id, "epoch", true).unwrap();
    }
    assert_eq!(std::fs::read_dir(&fixture.project).unwrap().count(), 2);
    assert_eq!(
        std::fs::read_dir(
            fixture
                .project
                .join(crate::clipboard_image::STAGING_DIRECTORY)
        )
        .unwrap()
        .count(),
        0
    );
    assert!(fixture.path.exists());
    fixture.close();
}

#[test]
fn pasted_images_remain_native_clipboard_dependencies_and_capturable_library_assets() {
    for name in ["Copied image", ".Hidden image"] {
        let fixture = Fixture::new();
        let bytes = std::fs::read(&fixture.path).unwrap();
        let queued = fixture
            .jobs
            .prepare_clipboard_image("epoch", "7", "image/png", bytes.clone())
            .unwrap();
        let id = queued["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "ready");
        let image = fixture
            .jobs
            .accept_clipboard_image(id, "epoch", "7", name)
            .unwrap();
        let mut session = vv_session::Session::default();
        let media = session.project.media_pool.insert(MediaItem {
            path: image.path.clone(),
            meta: image.meta.clone(),
            content_hash: image.content_hash,
            compound: None,
            folder: None,
        });
        let entry = vv_core::clipboard::ClipboardEntry {
            track_kind: TrackKind::Video,
            track_number: 1,
            relative_start: 0,
            clip: Clip::from_source_range(
                session.project.alloc_clip_id(),
                ClipSource::Media(media),
                0,
                24,
                0,
                Rational::one(),
            ),
            timeline_fps: Rational::new(24, 1),
            link_tag: None,
        };
        for to_pool in [true, false] {
            let entries = if to_pool { vec![] } else { vec![entry.clone()] };
            let selected = if to_pool { vec![media] } else { vec![] };
            let payload = ClipboardPayload::new(
                ClipboardOrigin {
                    instance: 1,
                    epoch: 1,
                },
                &session.project,
                &selected,
                &entries,
            );
            let queued = fixture
                .jobs
                .prepare_clipboard("epoch", "7", &payload.to_text(), None, to_pool)
                .unwrap();
            let id = queued["id"].as_str().unwrap();
            assert_eq!(fixture.finish(id)["state"], "ready");
            let prepared = fixture.jobs.clipboard_payload(id, "epoch", "7").unwrap();
            assert_eq!(prepared.files().next().unwrap().path, image.path);
            assert_eq!(
                prepared.files().next().unwrap().content_hash,
                image.content_hash
            );
            assert_eq!(prepared.clip_entries().len(), if to_pool { 0 } else { 1 });
            fixture
                .jobs
                .mark_clipboard_applied(id, "epoch", "7")
                .unwrap();
        }
        let asset = asset_payload::capture(
            &session,
            media,
            "Pasted image",
            ClipboardOrigin {
                instance: 1,
                epoch: 1,
            },
        )
        .unwrap();
        let file =
            crate::files::open_root_media(&fixture.project, &fixture.jobs.0.directory, &image.path)
                .unwrap();
        let identity = crate::source::file_identity(&file).unwrap();
        let queued = fixture
            .jobs
            .prepare_capture(
                "epoch",
                "7",
                asset,
                vec![PinnedSource {
                    path: image.path.clone(),
                    file,
                    identity,
                }],
            )
            .unwrap();
        let id = queued["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "ready");
        fixture
            .jobs
            .publish("pasted-image", id, "epoch", "7")
            .unwrap();
        let item = fixture.store.item("pasted-image", false).unwrap();
        let stored = fixture
            .store
            .load("pasted-image", item["revision"].as_str().unwrap())
            .unwrap();
        let payload = asset_payload::decode(&stored).unwrap();
        let stored = payload.files().next().unwrap();
        assert_eq!(std::fs::read(&stored.path).unwrap(), bytes);
        assert_eq!(
            stored.path.file_name().unwrap(),
            if name.starts_with('.') {
                "image.png"
            } else {
                "Copied image.png"
            }
        );
        assert!(image.path.exists());
        fixture.close();
    }
}

#[test]
fn otio_pasted_image_dependencies_keep_offline_witnesses_and_refuse_late_changes() {
    let fixture = Fixture::new();
    let folder = fixture.project.join("Pasted Images");
    std::fs::create_dir(&folder).unwrap();
    let image = folder.join("Image.png");
    let missing = folder.join("Missing.png");
    std::fs::copy(&fixture.path, &image).unwrap();
    write_otio(&fixture, "pasted.otio", &[image.clone(), missing.clone()]);
    let queued = fixture
        .jobs
        .prepare_otio("epoch", "7", "pasted.otio")
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    let payload = fixture.jobs.otio_payload(id, "epoch", "7").unwrap();
    assert_eq!(payload.warnings.len(), 1);
    assert_eq!(
        payload
            .project
            .media_pool
            .values()
            .find(|item| item.path == image)
            .unwrap()
            .content_hash,
        vv_media::content_fingerprint(&image).unwrap()
    );
    std::fs::copy(&fixture.path, &missing).unwrap();
    assert_eq!(
        fixture
            .jobs
            .mark_otio_applied(id, "epoch", "7")
            .unwrap_err()
            .1,
        "SOURCE_CHANGED"
    );
    fixture.close();
    for existing_parent in [false, true] {
        let fixture = Fixture::new();
        let folder = fixture.project.join("Pasted Images");
        if existing_parent {
            std::fs::create_dir(&folder).unwrap();
        }
        let witness = otio_witness(&fixture.jobs.0, "Pasted Images/Offline.png").unwrap();
        assert!(witness.file.is_none());
        if existing_parent {
            std::fs::rename(&folder, fixture.project.join("Old images")).unwrap();
        }
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(
            witness.validate(&fixture.jobs.0).unwrap_err().1,
            "SOURCE_CHANGED"
        );
        fixture.close();
    }
}

#[test]
fn managed_image_parent_links_fail_all_preparations_instead_of_becoming_offline() {
    for kind in ["clipboard", "otio", "asset"] {
        let fixture = Fixture::new();
        let outside = fixture.root.join("foreign");
        std::fs::create_dir(&outside).unwrap();
        std::fs::copy(&fixture.path, outside.join("Image.png")).unwrap();
        std::os::unix::fs::symlink(&outside, fixture.project.join("Pasted Images")).unwrap();
        let path = fixture.project.join("Pasted Images/Image.png");
        let mut asset = fixture.asset.clone();
        let mut payload = asset_payload::decode(&asset).unwrap();
        for file in payload.files_mut() {
            file.path = path.clone();
            file.content_hash = 0;
        }
        asset.payload = payload.to_text();
        let queued = match kind {
            "clipboard" => fixture
                .jobs
                .prepare_clipboard("epoch", "7", &asset.payload, None, true)
                .unwrap(),
            "otio" => {
                write_otio(&fixture, "linked.otio", std::slice::from_ref(&path));
                fixture
                    .jobs
                    .prepare_otio("epoch", "7", "linked.otio")
                    .unwrap()
            }
            _ => {
                let file = File::open(outside.join("Image.png")).unwrap();
                let identity = crate::source::file_identity(&file).unwrap();
                fixture
                    .jobs
                    .prepare_capture(
                        "epoch",
                        "7",
                        asset,
                        vec![PinnedSource {
                            path,
                            file,
                            identity,
                        }],
                    )
                    .unwrap()
            }
        };
        let failed = fixture.finish(queued["id"].as_str().unwrap());
        assert_eq!(failed["state"], "failed", "{kind}: {failed}");
        assert!(failed["result"].is_null());
        fixture.close();
    }
}

#[test]
fn clipboard_worker_preserves_verified_native_payload_and_replaces_untrusted_reuse_hashes() {
    let fixture = Fixture::new();
    let text = fixture.asset.payload.clone();
    let job = fixture
        .jobs
        .prepare_clipboard("epoch", "7", &text, None, false)
        .unwrap();
    let id = job["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready");
    assert_eq!(ready["kind"], "clipboard_import");
    assert_eq!(ready["result"]["media_count"], 1);
    assert_eq!(ready["result"]["clip_count"], 0);
    assert_eq!(ready["progress"], json!({"completed":1,"total":1}));
    assert_eq!(
        fixture
            .jobs
            .clipboard_payload(id, "epoch", "7")
            .unwrap()
            .to_text(),
        text
    );
    assert!(fixture.jobs.clipboard_payload(id, "epoch", "8").is_err());
    fixture
        .jobs
        .mark_clipboard_applied(id, "epoch", "7")
        .unwrap();
    assert_eq!(
        fixture.jobs.status(id, "epoch", true).unwrap()["state"],
        "applied"
    );
    assert!(
        fixture
            .jobs
            .mark_clipboard_applied(id, "epoch", "7")
            .is_err()
    );
    let mut forged = ClipboardPayload::from_text(&text).unwrap().unwrap();
    forged.files_mut().next().unwrap().content_hash = 1;
    let job = fixture
        .jobs
        .prepare_clipboard("epoch", "7", &forged.to_text(), None, false)
        .unwrap();
    let id = job["id"].as_str().unwrap();
    fixture.finish(id);
    let prepared = fixture.jobs.clipboard_payload(id, "epoch", "7").unwrap();
    assert_eq!(
        prepared.files().next().unwrap().content_hash,
        vv_media::content_fingerprint(&fixture.path).unwrap()
    );
    {
        let jobs = fixture.jobs.0.jobs.lock().unwrap();
        reserve_witnesses(&jobs, 255).unwrap();
        assert_eq!(reserve_witnesses(&jobs, 256).unwrap_err().1, "ASSET_BUSY");
    }
    fixture.jobs.cancel_obsolete("next-epoch");
    assert!(fixture.jobs.clipboard_payload(id, "epoch", "7").is_err());
    assert_eq!(
        std::fs::read_dir(&fixture.project).unwrap().count(),
        1,
        "Text clipboard references its files in place"
    );
    fixture.close();
}

#[test]
fn clipboard_worker_keeps_offline_hashes_untrusted_and_refuses_changes_before_commit() {
    for state in ["missing", "unreadable", "readable"] {
        let fixture = Fixture::new();
        let mut payload = ClipboardPayload::from_text(&fixture.asset.payload)
            .unwrap()
            .unwrap();
        let path = if state == "readable" {
            fixture.path.clone()
        } else {
            fixture.project.join("offline.png")
        };
        if state == "unreadable" {
            std::fs::write(&path, b"not an image").unwrap();
        }
        for file in payload.files_mut() {
            file.path = path.clone();
            file.content_hash = 123;
        }
        let job = fixture
            .jobs
            .prepare_clipboard("epoch", "7", &payload.to_text(), None, false)
            .unwrap();
        let id = job["id"].as_str().unwrap();
        let ready = fixture.finish(id);
        assert_eq!(ready["state"], "ready", "{state}");
        let prepared = fixture.jobs.clipboard_payload(id, "epoch", "7").unwrap();
        if state != "readable" {
            assert_eq!(prepared.files().next().unwrap().content_hash, 0);
            assert_eq!(ready["result"]["warnings"].as_array().unwrap().len(), 1);
        }
        std::fs::write(&path, b"changed after preparation").unwrap();
        assert_eq!(
            fixture
                .jobs
                .mark_clipboard_applied(id, "epoch", "7")
                .unwrap_err()
                .1,
            "SOURCE_CHANGED",
            "{state}"
        );
        fixture.close();
    }
}

#[test]
fn clipboard_worker_refuses_forged_metadata_escapes_links_and_indirect_manifests() {
    for case in ["metadata", "outside", "symlink", "manifest"] {
        let fixture = Fixture::new();
        let mut payload = ClipboardPayload::from_text(&fixture.asset.payload)
            .unwrap()
            .unwrap();
        let item = payload.files_mut().next().unwrap();
        match case {
            "metadata" => item.meta.width += 1,
            "outside" => item.path = fixture.root.join("outside.png"),
            "symlink" => {
                item.path = fixture.project.join("alias.png");
                std::os::unix::fs::symlink(&fixture.path, &item.path).unwrap();
            }
            _ => {
                item.path = fixture.project.join("manifest.mp4");
                std::fs::write(&item.path, b"#EXTM3U\nhttps://example.invalid/live").unwrap();
            }
        }
        let job = fixture
            .jobs
            .prepare_clipboard("epoch", "7", &payload.to_text(), None, false)
            .unwrap();
        let id = job["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "failed", "{case}");
        assert!(fixture.jobs.clipboard_payload(id, "epoch", "7").is_err());
        fixture.close();
    }
}

#[test]
fn clipboard_worker_resolves_ordinary_text_fallback_and_pool_noop_without_parsing_in_actor() {
    let fixture = Fixture::new();
    let fallback = &fixture.asset.payload;
    let job = fixture
        .jobs
        .prepare_clipboard("epoch", "7", "ordinary OS text", Some(fallback), false)
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    assert!(
        fixture
            .jobs
            .clipboard_payload(id, "epoch", "7")
            .unwrap()
            .has_media()
    );
    fixture.jobs.status(id, "epoch", true).unwrap();
    assert!(
        fixture
            .jobs
            .mark_clipboard_applied(id, "epoch", "7")
            .is_err()
    );
    let job = fixture
        .jobs
        .prepare_clipboard("epoch", "7", "ordinary OS text", Some(fallback), true)
        .unwrap();
    let id = job["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["result"]["clip_count"], 0);
    assert_eq!(ready["result"]["media_count"], 0);
    assert_eq!(ready["progress"], json!({"completed":0,"total":0}));
    let jobs = fixture.jobs.0.jobs.lock().unwrap();
    reserve_witnesses(&jobs, 256).unwrap();
    drop(jobs);
    for text in [
        "ordinary text",
        "venturi-clipboard/2\n()",
        "venturi-clipboard/1\nmalformed",
        "",
    ] {
        let job = fixture
            .jobs
            .prepare_clipboard("epoch", "7", text, None, false)
            .unwrap();
        let id = job["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "failed", "{text:?}");
    }
    let oversized = "x".repeat(asset_payload::MAX_ASSET_BYTES + 1);
    assert!(
        fixture
            .jobs
            .prepare_clipboard("epoch", "7", &oversized, None, false)
            .is_err()
    );
    let source = ClipboardWork {
        text: fixture.asset.payload.clone(),
        fallback: None,
        to_pool: false,
    };
    let work = Work {
        id: "clipboard-budget".into(),
        asset: None,
        sources: vec![],
        cancel: Arc::new(AtomicBool::new(false)),
        import: None,
        import_set: Vec::new(),
        edit: None,
        media_import: None,
        otio: None,
        clipboard: None,
        clipboard_image: None,
    };
    assert_eq!(
        run_clipboard(&fixture.jobs.0, &work, &source, Duration::ZERO)
            .err()
            .unwrap()
            .1,
        "CLIPBOARD_IMPORT_BUDGET"
    );
    work.cancel.store(true, Ordering::Release);
    assert_eq!(
        run_clipboard(&fixture.jobs.0, &work, &source, MEDIA_IMPORT_BUDGET)
            .err()
            .unwrap()
            .1,
        "ASSET_CANCELED"
    );
    fixture.close();
}

fn write_otio(fixture: &Fixture, token: &str, paths: &[PathBuf]) {
    let mut project = vv_core::Project::default();
    let timeline = project.timelines.insert(vv_core::Timeline {
        name: "Worker OTIO".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let meta = vv_media::probe_image(&fixture.path).unwrap();
    for (index, path) in paths.iter().enumerate() {
        let media = project.media_pool.insert(vv_core::MediaItem {
            path: path.clone(),
            meta: meta.clone(),
            content_hash: 0,
            compound: None,
            folder: None,
        });
        let clip = vv_core::Clip::from_source_range(
            project.alloc_clip_id(),
            vv_core::ClipSource::Media(media),
            0,
            24,
            index as i64 * 24,
            vv_core::Rational::one(),
        );
        project.timelines[timeline].tracks[0].insert_sorted(clip);
    }
    let value = vv_core::otio::timeline_to_otio(&project, timeline, None);
    std::fs::write(
        fixture.project.join(token),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
}

#[test]
fn otio_worker_keeps_native_offline_warnings_fingerprints_and_last_cas_acceptance() {
    let fixture = Fixture::new();
    std::fs::write(fixture.project.join("bad.wav"), b"unreadable media").unwrap();
    write_otio(
        &fixture,
        "batch.otio",
        &[
            fixture.path.clone(),
            fixture.project.join("bad.wav"),
            fixture.project.join("missing.mp4"),
        ],
    );
    let queued = fixture
        .jobs
        .prepare_otio("epoch", "7", "batch.otio")
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["kind"], "otio_import");
    assert_eq!(ready["state"], "ready");
    assert_eq!(
        ready["progress"],
        json!({"completed":3,"total":3}),
        "Native callbacks include readable, unreadable and missing sources; FDreservation65 is not media progress"
    );
    assert_eq!(ready["result"]["path_token"], "batch.otio");
    let payload = fixture.jobs.otio_payload(id, "epoch", "7").unwrap();
    assert_eq!(payload.project.timelines.len(), 1);
    assert_eq!(payload.warnings.len(), 2);
    assert!(
        payload
            .warnings
            .iter()
            .all(|warning| warning.contains("imported offline"))
    );
    let readable = payload
        .project
        .media_pool
        .values()
        .find(|media| media.path == fixture.path)
        .unwrap();
    assert_eq!(
        readable.content_hash,
        vv_media::content_fingerprint(&fixture.path).unwrap()
    );
    assert!(fixture.jobs.otio_payload(id, "wrong", "7").is_err());
    assert!(fixture.jobs.otio_payload(id, "epoch", "8").is_err());
    assert_eq!(
        std::fs::read_dir(&fixture.project).unwrap().count(),
        3,
        "Preparation does not copy sources or write a project"
    );
    fixture.jobs.mark_otio_applied(id, "epoch", "7").unwrap();
    assert!(fixture.jobs.otio_payload(id, "epoch", "7").is_err());
    assert!(fixture.jobs.mark_otio_applied(id, "epoch", "7").is_err());
    assert_eq!(
        fixture.jobs.status(id, "epoch", true).unwrap()["state"],
        "applied"
    );
    fixture.jobs.cancel_obsolete("new-project");
    assert_eq!(
        fixture.jobs.status(id, "epoch", false).unwrap()["state"],
        "applied"
    );
    fixture.close();
}

#[test]
fn otio_worker_rejects_changed_descriptor_readable_unreadable_and_newly_created_missing_files() {
    for changed in ["descriptor", "readable", "unreadable", "missing"] {
        let fixture = Fixture::new();
        let bad = fixture.project.join("bad.wav");
        let missing = fixture.project.join("missing.mp4");
        std::fs::write(&bad, b"offline").unwrap();
        write_otio(
            &fixture,
            "batch.otio",
            &[fixture.path.clone(), bad.clone(), missing.clone()],
        );
        let job = fixture
            .jobs
            .prepare_otio("epoch", "7", "batch.otio")
            .unwrap();
        let id = job["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "ready");
        fixture.jobs.otio_payload(id, "epoch", "7").unwrap();
        match changed {
            "descriptor" => std::fs::write(fixture.project.join("batch.otio"), b"{}").unwrap(),
            "readable" => std::fs::write(&fixture.path, b"changed PNG").unwrap(),
            "unreadable" => std::fs::write(&bad, b"different offline media").unwrap(),
            _ => std::fs::write(&missing, b"created later").unwrap(),
        }
        assert_eq!(
            fixture
                .jobs
                .mark_otio_applied(id, "epoch", "7")
                .unwrap_err()
                .1,
            "SOURCE_CHANGED",
            "{changed}"
        );
        assert!(fixture.jobs.otio_payload(id, "epoch", "7").is_err());
        fixture.close();
    }
}

#[test]
fn otio_policy_errors_and_processing_budget_cannot_be_downgraded_to_offline_ready() {
    for source in ["outside", "symlink", "directory", "playlist"] {
        let fixture = Fixture::new();
        let path = match source {
            "outside" => fixture.root.join("outside.png"),
            "symlink" => {
                let path = fixture.project.join("alias.png");
                std::os::unix::fs::symlink(&fixture.path, &path).unwrap();
                path
            }
            "directory" => {
                let path = fixture.project.join("directory.mp4");
                std::fs::create_dir(&path).unwrap();
                path
            }
            _ => {
                let path = fixture.project.join("playlist.mp4");
                std::fs::write(&path, b"#EXTM3U\nhttps://example.invalid/live").unwrap();
                path
            }
        };
        write_otio(&fixture, "policy.otio", &[path]);
        let job = fixture
            .jobs
            .prepare_otio("epoch", "7", "policy.otio")
            .unwrap();
        let id = job["id"].as_str().unwrap();
        assert_eq!(fixture.finish(id)["state"], "failed", "{source}");
        assert_eq!(
            fixture
                .jobs
                .read_failure(id, "epoch")
                .unwrap()
                .unwrap()
                .0
                .as_u16(),
            422
        );
        assert!(fixture.jobs.otio_payload(id, "epoch", "7").is_err());
        fixture.close();
    }
    let fixture = Fixture::new();
    write_otio(&fixture, "budget.otio", &[]);
    let work = Work {
        id: "otio-budget".into(),
        asset: None,
        sources: vec![],
        cancel: Arc::new(AtomicBool::new(false)),
        import: None,
        import_set: Vec::new(),
        edit: None,
        media_import: None,
        otio: Some("budget.otio".into()),
        clipboard: None,
        clipboard_image: None,
    };
    assert_eq!(
        run_otio(&fixture.jobs.0, &work, "budget.otio", Duration::ZERO)
            .err()
            .unwrap()
            .1,
        "OTIO_IMPORT_BUDGET"
    );
    work.cancel.store(true, Ordering::Release);
    assert_eq!(
        run_otio(&fixture.jobs.0, &work, "budget.otio", MEDIA_IMPORT_BUDGET)
            .err()
            .unwrap()
            .1,
        "ASSET_CANCELED"
    );
    fixture.close();
}

#[test]
fn otio_cancel_and_legacy_save_failure_release_payload_without_false_applied_status() {
    let fixture = Fixture::new();
    write_otio(&fixture, "batch.otio", std::slice::from_ref(&fixture.path));
    let job = fixture
        .jobs
        .prepare_otio("epoch", "7", "batch.otio")
        .unwrap();
    let id = job["id"].as_str().unwrap();
    fixture.finish(id);
    fixture.jobs.status(id, "epoch", true).unwrap();
    assert!(fixture.jobs.otio_payload(id, "epoch", "7").is_err());
    assert!(fixture.jobs.mark_otio_applied(id, "epoch", "7").is_err());
    let next = fixture
        .jobs
        .prepare_otio("epoch", "7", "batch.otio")
        .unwrap();
    let id = next["id"].as_str().unwrap();
    fixture.finish(id);
    fixture.jobs.mark_otio_applied(id, "epoch", "7").unwrap();
    let error = ApiError::conflict("FILE_EXISTS", "A project with that name already exists");
    fixture
        .jobs
        .mark_otio_failed(id, "epoch", error.clone())
        .unwrap();
    assert_eq!(
        fixture.jobs.status(id, "epoch", false).unwrap()["state"],
        "failed"
    );
    assert_eq!(
        fixture.jobs.read_failure(id, "epoch").unwrap().unwrap().1,
        error.1
    );
    assert!(fixture.jobs.otio_payload(id, "epoch", "7").is_err());
    fixture.close();
}

#[test]
fn otio_descriptor_and_asset_copy_witnesses_share_the_root_import_descriptor_budget() {
    let fixture = Fixture::new();
    let capture = fixture.capture();
    assert_eq!(capture["state"], "ready");
    write_otio(&fixture, "batch.otio", std::slice::from_ref(&fixture.path));
    let job = fixture
        .jobs
        .prepare_otio("epoch", "7", "batch.otio")
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    {
        let jobs = fixture.jobs.0.jobs.lock().unwrap();
        // A captured file keeps its file/base/directory; OTIO keeps its descriptor
        // and this regular source. All five belong to the same admission budget.
        reserve_witnesses(&jobs, 251).unwrap();
        assert_eq!(reserve_witnesses(&jobs, 252).unwrap_err().1, "ASSET_BUSY");
    }
    fixture.jobs.status(id, "epoch", true).unwrap();
    {
        let jobs = fixture.jobs.0.jobs.lock().unwrap();
        reserve_witnesses(&jobs, 253).unwrap();
        assert_eq!(reserve_witnesses(&jobs, 254).unwrap_err().1, "ASSET_BUSY");
    }
    fixture.close();
}

#[test]
fn media_import_preserves_order_native_fingerprints_and_original_per_file_failures() {
    let fixture = Fixture::new();
    std::fs::write(fixture.project.join("bad.wav"), b"not native media").unwrap();
    let queued = fixture
        .jobs
        .prepare_media_import(
            "epoch",
            "7",
            vec![
                "tiny.png".into(),
                "bad.wav".into(),
                "tiny.png".into(),
                "missing.mp4".into(),
            ],
        )
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready");
    assert_eq!(ready["progress"], json!({"completed":3,"total":3}));
    assert_eq!(
        ready["result"]["items"],
        json!([{"path_token":"tiny.png","name":"tiny.png","state":"ready"}])
    );
    assert_eq!(ready["result"]["errors"][0]["path_token"], "bad.wav");
    assert_eq!(ready["result"]["errors"][0]["status"], 422);
    assert_eq!(ready["result"]["errors"][1]["status"], 404);
    let payload = fixture.jobs.media_import_payload(id, "epoch", "7").unwrap();
    assert_eq!(payload.items.len(), 1);
    assert_eq!(payload.errors.len(), 2);
    assert_eq!(payload.first_error.unwrap().0.as_u16(), 422);
    assert_eq!(
        payload.items[0].content_hash,
        vv_media::content_fingerprint(&fixture.path).unwrap()
    );
    assert_eq!(payload.items[0].meta.width, 16);
    assert_eq!(std::fs::read_dir(&fixture.project).unwrap().count(), 2);
    assert!(fixture.jobs.media_import_payload(id, "wrong", "7").is_err());
    assert!(fixture.jobs.media_import_payload(id, "epoch", "8").is_err());
    fixture.close();
}

#[test]
fn twenty_media_files_prepare_on_one_worker_and_acceptance_releases_witnesses_once() {
    let fixture = Fixture::new();
    let bytes = std::fs::read(&fixture.path).unwrap();
    let tokens: Vec<_> = (0..20).map(|n| format!("clip-{n}.png")).collect();
    for token in &tokens {
        std::fs::write(fixture.project.join(token), &bytes).unwrap();
    }
    let job = fixture
        .jobs
        .prepare_media_import("epoch", "7", tokens.clone())
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    let payload = fixture.jobs.media_import_payload(id, "epoch", "7").unwrap();
    assert_eq!(
        payload
            .items
            .iter()
            .map(|item| item.path_token.clone())
            .collect::<Vec<_>>(),
        tokens
    );
    assert!(payload.errors.is_empty());
    fixture.jobs.accept_media_import(id, "epoch", "7").unwrap();
    assert!(fixture.jobs.media_import_payload(id, "epoch", "7").is_err());
    assert!(fixture.jobs.accept_media_import(id, "epoch", "7").is_err());
    assert_eq!(
        fixture.jobs.status(id, "epoch", true).unwrap()["state"],
        "applied"
    );
    fixture.jobs.cancel_obsolete("other");
    assert_eq!(
        fixture.jobs.status(id, "epoch", false).unwrap()["state"],
        "applied"
    );
    assert!(
        fixture
            .jobs
            .0
            .jobs
            .lock()
            .unwrap()
            .iter()
            .find(|j| j.id == id)
            .unwrap()
            .media_import
            .is_none()
    );
    fixture.close();
}

#[test]
fn prepared_media_final_cas_rejects_replacement_and_cancellation_before_acceptance() {
    let fixture = Fixture::new();
    let job = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec!["tiny.png".into()])
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    fixture.jobs.media_import_payload(id, "epoch", "7").unwrap();
    let replacement = fixture.project.join("replacement.png");
    std::fs::copy(&fixture.path, &replacement).unwrap();
    std::fs::rename(replacement, &fixture.path).unwrap();
    assert_eq!(
        fixture
            .jobs
            .accept_media_import(id, "epoch", "7")
            .unwrap_err()
            .1,
        "SOURCE_CHANGED"
    );
    assert!(fixture.jobs.media_import_payload(id, "epoch", "7").is_err());
    assert_eq!(
        fixture.jobs.status(id, "epoch", true).unwrap()["state"],
        "canceled"
    );
    assert!(fixture.jobs.accept_media_import(id, "epoch", "7").is_err());
    let next = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec!["tiny.png".into()])
        .unwrap();
    let next = next["id"].as_str().unwrap();
    fixture.finish(next);
    fixture.jobs.cancel_obsolete("new-epoch");
    assert!(
        fixture
            .jobs
            .media_import_payload(next, "epoch", "7")
            .is_err()
    );
    fixture.close();
}

#[test]
fn media_import_budget_records_every_unprocessed_file_and_zero_success_cannot_commit() {
    let fixture = Fixture::new();
    let tokens = vec!["tiny.png".into(), "missing.mp4".into()];
    let work = Work {
        id: "unit-budget".into(),
        asset: None,
        sources: vec![],
        cancel: Arc::new(AtomicBool::new(false)),
        import: None,
        import_set: Vec::new(),
        edit: None,
        media_import: Some(ImportWork::Legacy(tokens.clone())),
        otio: None,
        clipboard: None,
        clipboard_image: None,
    };
    let result = run_media_import(&fixture.jobs.0, &work, &tokens, Duration::ZERO).unwrap();
    assert!(result.items.is_empty());
    assert_eq!(result.errors.len(), 2);
    assert!(
        result
            .errors
            .iter()
            .all(|error| error["code"] == "MEDIA_IMPORT_BUDGET")
    );
    assert_eq!(result.errors[0]["path_token"], "tiny.png");
    work.cancel.store(true, Ordering::Release);
    assert_eq!(
        run_media_import(&fixture.jobs.0, &work, &tokens, MEDIA_IMPORT_BUDGET)
            .err()
            .unwrap()
            .1,
        "ASSET_CANCELED"
    );
    let job = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec!["missing.mp4".into()])
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    assert_eq!(
        fixture
            .jobs
            .accept_media_import(id, "epoch", "7")
            .unwrap_err()
            .0
            .as_u16(),
        404
    );
    fixture.close();
}

#[test]
fn media_import_refuses_symlink_and_root_replacement_without_committing_any_item() {
    let fixture = Fixture::new();
    std::os::unix::fs::symlink(&fixture.path, fixture.project.join("alias.png")).unwrap();
    std::fs::create_dir(fixture.project.join("directory.mp4")).unwrap();
    let job = fixture
        .jobs
        .prepare_media_import(
            "epoch",
            "7",
            vec![
                "tiny.png".into(),
                "alias.png".into(),
                "directory.mp4".into(),
            ],
        )
        .unwrap();
    let id = job["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["result"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(ready["result"]["errors"].as_array().unwrap().len(), 2);
    let old_root = fixture.root.join("old-project");
    std::fs::rename(&fixture.project, &old_root).unwrap();
    std::fs::create_dir(&fixture.project).unwrap();
    std::fs::copy(old_root.join("tiny.png"), &fixture.path).unwrap();
    assert_eq!(
        fixture
            .jobs
            .accept_media_import(id, "epoch", "7")
            .unwrap_err()
            .1,
        "ASSET_CHANGED"
    );
    assert!(fixture.jobs.media_import_payload(id, "epoch", "7").is_err());
    fixture.close();
}

#[test]
fn media_import_witness_reservation_includes_ready_records_and_cancellation_releases_them() {
    let fixture = Fixture::new();
    let job = fixture
        .jobs
        .prepare_media_import("epoch", "7", vec!["tiny.png".into()])
        .unwrap();
    let id = job["id"].as_str().unwrap();
    assert_eq!(fixture.finish(id)["state"], "ready");
    let full: Vec<_> = (0..256).map(|n| format!("unopened-{n}.mp4")).collect();
    assert_eq!(
        fixture
            .jobs
            .prepare_media_import("epoch", "7", full.clone())
            .unwrap_err()
            .1,
        "ASSET_BUSY"
    );
    fixture.jobs.status(id, "epoch", true).unwrap();
    let next = fixture
        .jobs
        .prepare_media_import("epoch", "7", full)
        .unwrap();
    let next = next["id"].as_str().unwrap();
    fixture.jobs.status(next, "epoch", true).unwrap();
    assert_eq!(fixture.finish(next)["state"], "canceled");
    assert!(
        fixture
            .jobs
            .media_import_payload(next, "epoch", "7")
            .is_err()
    );
    fixture.close();
}
use vv_core::{
    Clip, ClipId, ClipSource, MediaItem, Rational, Timeline, Track, TrackKind,
    clipboard::ClipboardOrigin,
};

struct Fixture {
    root: PathBuf,
    project: PathBuf,
    store: Store,
    jobs: Jobs,
    asset: AssetFile,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "venturi-assets-jobs-{}-{}",
            std::process::id(),
            nonce()
        ));
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let path = project.join("tiny.png");
        let file = File::create(&path).unwrap();
        let mut encoder = png::Encoder::new(file, 16, 16);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[127; 16 * 16 * 3])
            .unwrap();
        let meta = vv_media::probe_image(&path).unwrap();
        let hash = vv_media::content_fingerprint(&path).unwrap();
        let mut session = vv_session::Session::default();
        let media = session.project.media_pool.insert(MediaItem {
            path: path.clone(),
            meta,
            content_hash: hash,
            compound: None,
            folder: None,
        });
        let child = session.create_timeline(Timeline {
            name: "Nested file".into(),
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
                ClipSource::Media(media),
                0,
                24,
                0,
                Rational::one(),
            ));
        session.sync_timeline_media(child);
        let compound = session
            .project
            .media_pool
            .iter()
            .find(|(_, m)| m.compound == Some(child))
            .unwrap()
            .0;
        let asset = asset_payload::capture(
            &session,
            compound,
            "File-dependent compound",
            ClipboardOrigin {
                instance: 1,
                epoch: 1,
            },
        )
        .unwrap();
        let store = Store::new(&root.join("library")).unwrap();
        let jobs = Jobs::new(store.clone(), &project, File::open(&project).unwrap()).unwrap();
        Self {
            root,
            project,
            store,
            jobs,
            asset,
            path,
        }
    }
    fn sources(&self) -> Vec<PinnedSource> {
        let file = File::open(&self.path).unwrap();
        vec![PinnedSource {
            path: self.path.clone(),
            identity: crate::source::file_identity(&file).unwrap(),
            file,
        }]
    }
    fn finish(&self, id: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let job = self.jobs.status(id, "epoch", false).unwrap();
            if !matches!(job["state"].as_str(), Some("queued" | "running")) {
                return job;
            }
            assert!(Instant::now() < deadline, "worker did not settle: {job}");
            std::thread::yield_now();
        }
    }
    fn capture(&self) -> Value {
        let value = self
            .jobs
            .prepare_capture("epoch", "7", self.asset.clone(), self.sources())
            .unwrap();
        self.finish(value["id"].as_str().unwrap())
    }
    fn close(self) {
        drop(self.jobs);
        drop(self.store);
        std::fs::remove_dir_all(self.root).unwrap();
    }
}

#[test]
fn capture_nested_file_asset_is_ephemeral_until_publish_then_import_owns_independent_readable_project_bytes()
 {
    let fixture = Fixture::new();
    let original = fixture.asset.payload.clone();
    let ready = fixture.capture();
    assert_eq!(ready["state"], "ready", "{ready}");
    let id = ready["id"].as_str().unwrap();
    assert!(fixture.store.item("capture", false).is_err());
    assert_eq!(ready["result"]["file_count"], 1);
    assert!(ready["result"]["asset_id"].is_null());
    fixture.jobs.publish("capture", id, "epoch", "7").unwrap();
    fixture.jobs.publish("capture", id, "epoch", "7").unwrap();
    assert!(fixture.jobs.publish("different", id, "epoch", "7").is_err());
    let row = fixture.store.item("capture", false).unwrap();
    let revision = row["revision"].as_str().unwrap();
    let stored = fixture.store.load("capture", revision).unwrap();
    let payload = asset_payload::decode(&stored).unwrap();
    let media = payload.files().next().unwrap();
    assert!(media.path.starts_with(fixture.store.root().join("media")));
    assert_eq!(media.path.file_name().unwrap(), "tiny.png");
    assert_eq!(fixture.asset.payload, original);
    assert_eq!(
        media.content_hash,
        vv_media::content_fingerprint(&media.path).unwrap()
    );
    let another = fixture.root.join("another");
    std::fs::create_dir(&another).unwrap();
    let imported = Jobs::new(
        fixture.store.clone(),
        &another,
        File::open(&another).unwrap(),
    )
    .unwrap();
    let pending = imported
        .prepare_import("epoch", "8", "capture", revision)
        .unwrap();
    let import_id = pending["id"].as_str().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let state = imported.status(import_id, "epoch", false).unwrap();
        if state["state"] == "ready" {
            break;
        }
        assert_ne!(state["state"], "failed", "{state}");
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    let imported_payload = imported
        .import_payload(import_id, "capture", revision, "epoch", "8")
        .unwrap();
    let copied = imported_payload.files().next().unwrap();
    assert_eq!(copied.path, another.join("library/tiny.png"));
    assert_eq!(
        copied.content_hash,
        vv_media::content_fingerprint(&copied.path).unwrap()
    );
    assert_eq!(
        std::fs::read(&copied.path).unwrap(),
        std::fs::read(&fixture.path).unwrap()
    );
    std::fs::remove_file(&media.path).unwrap();
    assert!(copied.path.exists());
    assert_eq!(imported_payload.fragment().timelines.len(), 1);
    assert_eq!(imported_payload.media_ids().len(), 1);
    drop(imported);
    fixture.close();
}

#[test]
fn native_project_copy_collisions_compare_full_bytes_reuse_identical_files_and_keep_old_flat_copies()
 {
    let fixture = Fixture::new();
    let ready = fixture.capture();
    assert_eq!(ready["state"], "ready", "{ready}");
    fixture
        .jobs
        .publish("capture", ready["id"].as_str().unwrap(), "epoch", "7")
        .unwrap();
    let revision = fixture.store.item("capture", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let bytes = std::fs::read(&fixture.path).unwrap();
    let old_flat = fixture
        .project
        .join(format!("asset-{:x}-tiny.png", Sha256::digest(&bytes)));
    std::fs::write(&old_flat, &bytes).unwrap();
    let library = fixture.project.join("library");
    std::fs::create_dir(&library).unwrap();
    let mut foreign = bytes.clone();
    foreign[0] ^= 1;
    std::fs::write(library.join("tiny.png"), &foreign).unwrap();
    let import = || {
        let queued = fixture
            .jobs
            .prepare_import("epoch", "7", "capture", &revision)
            .unwrap();
        let id = queued["id"].as_str().unwrap().to_owned();
        let ready = fixture.finish(&id);
        assert_eq!(ready["state"], "ready", "{ready}");
        let payload = fixture
            .jobs
            .import_payload(&id, "capture", &revision, "epoch", "7")
            .unwrap();
        let path = payload.files().next().unwrap().path.clone();
        (id, path)
    };
    let (first_id, first) = import();
    assert_eq!(first, library.join("tiny (2).png"));
    assert_eq!(std::fs::read(&first).unwrap(), bytes);
    let identity = asset_store::stable_identity(&File::open(&first).unwrap()).unwrap();
    let (_, second) = import();
    assert_eq!(second, first);
    assert_eq!(
        asset_store::stable_identity(&File::open(&second).unwrap()).unwrap(),
        identity
    );
    std::fs::write(&first, &foreign).unwrap();
    assert!(
        fixture
            .jobs
            .import_payload(&first_id, "capture", &revision, "epoch", "7")
            .is_err()
    );
    let (_, third) = import();
    assert_eq!(third, library.join("tiny (3).png"));
    assert_eq!(std::fs::read(&third).unwrap(), bytes);
    assert_eq!(std::fs::read(&first).unwrap(), foreign);
    assert_eq!(std::fs::read(library.join("tiny.png")).unwrap(), foreign);
    assert_eq!(std::fs::read(old_flat).unwrap(), bytes);
    fixture.close();
}

#[test]
fn native_project_copy_preserves_legacy_names_unicode_bounds_and_rejects_canceled_or_replaced_directories()
 {
    use std::os::unix::fs::symlink;
    assert_eq!(
        project_copy_name("0123456789AbCdEf-Camera take.mp4", 1).unwrap(),
        "Camera take.mp4"
    );
    assert_eq!(
        project_copy_name("0123456789abcdef0123456789abcdef-Camera.mp4", 1).unwrap(),
        "0123456789abcdef0123456789abcdef-Camera.mp4"
    );
    let unicode = format!("{}.png", "é".repeat(62));
    assert_eq!(unicode.len(), 128);
    assert_eq!(project_copy_name(&unicode, 1).unwrap(), unicode);
    let collision = project_copy_name(&unicode, 4096).unwrap();
    assert!(collision.len() <= 128 && collision.ends_with(" (4096).png"));
    assert!(
        project_copy_name("ééééééééé.png", 2)
            .unwrap()
            .ends_with(" (2).png")
    );
    let fixture = Fixture::new();
    let ready = fixture.capture();
    assert_eq!(ready["state"], "ready", "{ready}");
    fixture
        .jobs
        .publish("capture", ready["id"].as_str().unwrap(), "epoch", "7")
        .unwrap();
    let revision = fixture.store.item("capture", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let asset = fixture.store.load("capture", &revision).unwrap();
    let payload = asset_payload::decode(&asset).unwrap();
    let path = payload.files().next().unwrap().path.clone();
    let canceled_copy = |cancel: Arc<AtomicBool>| {
        let file = File::open(&path).unwrap();
        let source = PinnedSource {
            path: path.clone(),
            identity: crate::source::file_identity(&file).unwrap(),
            file,
        };
        let work = Work {
            id: "canceled-copy".into(),
            asset: None,
            sources: vec![],
            cancel: cancel.clone(),
            import: Some(("capture".into(), revision.clone())),
            import_set: vec![],
            edit: None,
            media_import: None,
            otio: None,
            clipboard: None,
            clipboard_image: None,
        };
        copy(
            &fixture.jobs.0,
            &source,
            &work,
            &Budget {
                start: Instant::now(),
                cancel,
            },
        )
    };
    assert_eq!(
        canceled_copy(Arc::new(AtomicBool::new(true)))
            .err()
            .unwrap()
            .1,
        "ASSET_CANCELED"
    );
    assert!(!fixture.project.join("library").exists());
    let legacy_dir = asset_store::directory(fixture.store.media(), "0123456789abcdef").unwrap();
    let legacy_path = fixture
        .store
        .root()
        .join("media/0123456789abcdef/0123456789ABCDEF-Camera take.png");
    std::fs::copy(&fixture.path, &legacy_path).unwrap();
    let mut legacy_asset = asset.clone();
    let mut legacy_payload = asset_payload::decode(&legacy_asset).unwrap();
    let legacy_media = legacy_payload.files_mut().next().unwrap();
    legacy_media.path = legacy_path;
    legacy_media.content_hash = 0x0123456789abcdef;
    legacy_asset.payload = legacy_payload.to_text();
    fixture
        .store
        .create("native-prefix", &legacy_asset)
        .unwrap();
    let legacy_revision = fixture.store.item("native-prefix", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let queued = fixture
        .jobs
        .prepare_import("epoch", "7", "native-prefix", &legacy_revision)
        .unwrap();
    let legacy_id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(legacy_id);
    assert_eq!(ready["state"], "ready", "{ready}");
    let legacy_import = fixture
        .jobs
        .import_payload(legacy_id, "native-prefix", &legacy_revision, "epoch", "7")
        .unwrap();
    assert_eq!(
        legacy_import.files().next().unwrap().path,
        fixture.project.join("library/Camera take.png")
    );
    drop(legacy_dir);
    let queued = fixture
        .jobs
        .prepare_import("epoch", "7", "capture", &revision)
        .unwrap();
    let id = queued["id"].as_str().unwrap();
    let ready = fixture.finish(id);
    assert_eq!(ready["state"], "ready", "{ready}");
    let owned = fixture.project.join("library");
    let moved = fixture.project.join("moved-library");
    std::fs::rename(&owned, &moved).unwrap();
    std::fs::create_dir(&owned).unwrap();
    std::fs::copy(moved.join("tiny.png"), owned.join("tiny.png")).unwrap();
    assert!(
        fixture
            .jobs
            .import_payload(id, "capture", &revision, "epoch", "7")
            .is_err()
    );
    std::fs::remove_file(owned.join("tiny.png")).unwrap();
    std::fs::remove_dir(&owned).unwrap();
    symlink(&moved, &owned).unwrap();
    assert!(canceled_copy(Arc::new(AtomicBool::new(false))).is_err());
    assert_eq!(
        std::fs::read(moved.join("tiny.png")).unwrap(),
        std::fs::read(&fixture.path).unwrap()
    );
    std::fs::remove_file(&owned).unwrap();
    fixture.close();
}

#[test]
fn strict_ready_kind_epoch_generation_revision_and_target_identity_guards_refuse_stale_commits() {
    let fixture = Fixture::new();
    let ready = fixture.capture();
    assert_eq!(ready["state"], "ready", "{ready}");
    let id = ready["id"].as_str().unwrap();
    assert!(fixture.jobs.status(id, "other", false).is_err());
    assert_eq!(
        fixture
            .jobs
            .publish("capture", id, "epoch", "8")
            .unwrap_err()
            .1,
        "ASSET_CONTEXT_CHANGED"
    );
    assert!(
        fixture
            .jobs
            .import_payload(id, "capture", "bad", "epoch", "7")
            .is_err()
    );
    fixture.jobs.publish("capture", id, "epoch", "7").unwrap();
    let revision = fixture.store.item("capture", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let pending = fixture
        .jobs
        .prepare_import("epoch", "7", "capture", &revision)
        .unwrap();
    let ready = fixture.finish(pending["id"].as_str().unwrap());
    assert_eq!(ready["state"], "ready", "{ready}");
    let import_id = ready["id"].as_str().unwrap();
    assert!(
        fixture
            .jobs
            .publish("capture2", import_id, "epoch", "7")
            .is_err()
    );
    assert!(
        fixture
            .jobs
            .import_payload(import_id, "capture", "other", "epoch", "7")
            .is_err()
    );
    let payload = fixture
        .jobs
        .import_payload(import_id, "capture", &revision, "epoch", "7")
        .unwrap();
    let path = payload.files().next().unwrap().path.clone();
    std::fs::remove_file(&path).unwrap();
    std::fs::write(&path, b"replacement").unwrap();
    assert!(
        fixture
            .jobs
            .import_payload(import_id, "capture", &revision, "epoch", "7")
            .is_err()
    );
    fixture.close();
}

#[test]
fn native_metadata_and_nonzero_content_hash_must_match_but_legacy_zero_is_filled_without_changing_source()
 {
    let fixture = Fixture::new();
    for mismatch in ["duration", "hash"] {
        let mut asset = fixture.asset.clone();
        let mut payload = asset_payload::decode(&asset).unwrap();
        let media = payload.files_mut().next().unwrap();
        if mismatch == "duration" {
            media.meta.width += 1;
        } else {
            media.content_hash ^= 1;
        }
        asset.payload = payload.to_text();
        let queued = fixture
            .jobs
            .prepare_capture("epoch", "7", asset, fixture.sources())
            .unwrap();
        let result = fixture.finish(queued["id"].as_str().unwrap());
        assert_eq!(result["error"], "SOURCE_CHANGED", "{result}");
    }
    let mut asset = fixture.asset.clone();
    let mut payload = asset_payload::decode(&asset).unwrap();
    payload.files_mut().next().unwrap().content_hash = 0;
    asset.payload = payload.to_text();
    let queued = fixture
        .jobs
        .prepare_capture("epoch", "7", asset.clone(), fixture.sources())
        .unwrap();
    let result = fixture.finish(queued["id"].as_str().unwrap());
    assert_eq!(result["state"], "ready", "{result}");
    fixture
        .jobs
        .publish("legacy", result["id"].as_str().unwrap(), "epoch", "7")
        .unwrap();
    let revision = fixture.store.item("legacy", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(
        asset_payload::decode(&fixture.store.load("legacy", &revision).unwrap())
            .unwrap()
            .files()
            .next()
            .unwrap()
            .content_hash,
        0
    );
    assert_eq!(
        asset_payload::decode(&asset)
            .unwrap()
            .files()
            .next()
            .unwrap()
            .content_hash,
        0
    );
    fixture.close();
}

#[test]
fn source_descriptor_and_live_path_swaps_cancel_and_shared_lock_preserve_unrelated_files() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let sources = fixture.sources();
    let backup = fixture.project.join("original.png");
    std::fs::rename(&fixture.path, &backup).unwrap();
    symlink(&backup, &fixture.path).unwrap();
    let pending = fixture
        .jobs
        .prepare_capture("epoch", "7", fixture.asset.clone(), sources)
        .unwrap();
    let failed = fixture.finish(pending["id"].as_str().unwrap());
    assert_eq!(failed["state"], "failed");
    std::fs::remove_file(&fixture.path).unwrap();
    std::fs::rename(&backup, &fixture.path).unwrap();
    let lock = fixture.store.lock().unwrap();
    let pending = fixture
        .jobs
        .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
        .unwrap();
    let failed = fixture.finish(pending["id"].as_str().unwrap());
    assert_eq!(failed["error"], "LIBRARY_BUSY");
    drop(lock);
    let ready = fixture.capture();
    let id = ready["id"].as_str().unwrap();
    fixture.jobs.status(id, "epoch", true).unwrap();
    assert_eq!(
        fixture
            .jobs
            .publish("canceled", id, "epoch", "7")
            .unwrap_err()
            .1,
        "ASSET_NOT_READY"
    );
    assert!(fixture.path.exists());
    assert!(fixture.store.item("canceled", false).is_err());
    assert!(
        std::fs::read_dir(fixture.store.root().join("media"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".part"))
    );
    fixture.close();
}

#[test]
fn forged_store_paths_and_binary_playlists_are_rejected_before_native_probe_and_nooverwrite_is_preserved()
 {
    let fixture = Fixture::new();
    let mut forged = fixture.asset.clone();
    let mut payload = asset_payload::decode(&forged).unwrap();
    payload.files_mut().next().unwrap().path = fixture.path.clone();
    forged.payload = payload.to_text();
    fixture.store.create("forged", &forged).unwrap();
    let revision = fixture.store.item("forged", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        fixture
            .jobs
            .prepare_import("epoch", "7", "forged", &revision)
            .is_err()
    );
    let playlist = fixture.project.join("playlist.mp4");
    std::fs::write(&playlist, b"#EXTM3U\nhttp://example.invalid/file\n").unwrap();
    let file = File::open(&playlist).unwrap();
    assert!(header(&file, &playlist).is_err());
    let ready = fixture.capture();
    assert_eq!(ready["state"], "ready", "{ready}");
    let job_id = ready["id"].as_str().unwrap();
    let guard = fixture.jobs.0.jobs.lock().unwrap();
    let prepared = guard
        .iter()
        .find(|j| j.id == job_id)
        .unwrap()
        .result
        .as_ref()
        .unwrap();
    let stored_path = asset_payload::decode(&prepared.asset)
        .unwrap()
        .files()
        .next()
        .unwrap()
        .path
        .clone();
    drop(guard);
    std::fs::write(&stored_path, b"foreign changed destination").unwrap();
    let failed = fixture.capture();
    assert_eq!(failed["error"], "FILE_EXISTS", "{failed}");
    assert_eq!(
        std::fs::read(&stored_path).unwrap(),
        b"foreign changed destination"
    );
    fixture.close();
}

#[test]
fn quota_checks_are_metadata_only_and_cancel_budget_never_removes_completed_or_foreign_files() {
    let fixture = Fixture::new();
    assert!(
        fixture
            .jobs
            .prepare_capture("epoch", "7", fixture.asset.clone(), vec![])
            .is_err()
    );
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&fixture.path)
        .unwrap();
    file.set_len(MAX_FILE + 1).unwrap();
    assert!(
        fixture
            .jobs
            .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
            .is_err()
    );
    let cancel = Arc::new(AtomicBool::new(true));
    let budget = Budget {
        start: Instant::now(),
        cancel,
    };
    assert_eq!(
        budget.check(fixture.store.media()).unwrap_err().1,
        "ASSET_CANCELED"
    );
    let expired = Budget {
        start: Instant::now() - Duration::from_secs(601),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    assert_eq!(
        expired.check(fixture.store.media()).unwrap_err().1,
        "ASSET_TIMEOUT"
    );
    assert!(fixture.path.exists());
    fixture.close();
}

#[test]
fn queue_admission_is_one_running_one_pending_and_records_are_bounded_without_restarting_old_jobs()
{
    let fixture = Fixture::new();
    let (sender, receiver) = mpsc::sync_channel(1);
    let isolated = Jobs(Arc::new(Inner {
        store: fixture.store.clone(),
        root: fixture.project.clone(),
        directory: File::open(&fixture.project).unwrap(),
        media_roots: fixture.jobs.0.media_roots.clone(),
        jobs: Mutex::new(VecDeque::new()),
        sender,
    }));
    let first = isolated
        .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
        .unwrap();
    let first_work = receiver.try_recv().unwrap();
    isolated.0.jobs.lock().unwrap().front_mut().unwrap().state = "running";
    let second = isolated
        .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
        .unwrap();
    assert_eq!(
        isolated
            .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
            .unwrap_err()
            .1,
        "ASSET_BUSY"
    );
    isolated
        .status(second["id"].as_str().unwrap(), "epoch", true)
        .unwrap();
    assert!(receiver.try_recv().unwrap().cancel.load(Ordering::Acquire));
    drop(first_work);
    for job in isolated.0.jobs.lock().unwrap().iter_mut() {
        job.state = "canceled";
    }
    for _ in 0..12 {
        let queued = isolated
            .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
            .unwrap();
        receiver.try_recv().unwrap();
        isolated
            .0
            .jobs
            .lock()
            .unwrap()
            .iter_mut()
            .find(|j| j.id == queued["id"].as_str().unwrap())
            .unwrap()
            .state = "canceled";
    }
    assert_eq!(isolated.0.jobs.lock().unwrap().len(), MAX_RECORDS);
    assert!(
        isolated
            .status(first["id"].as_str().unwrap(), "epoch", false)
            .is_err()
    );
    let ready = fixture.capture();
    fixture
        .jobs
        .publish("persistent", ready["id"].as_str().unwrap(), "epoch", "7")
        .unwrap();
    let restarted = Jobs::new(
        fixture.store.clone(),
        &fixture.project,
        File::open(&fixture.project).unwrap(),
    )
    .unwrap();
    assert!(
        restarted
            .status(ready["id"].as_str().unwrap(), "epoch", false)
            .is_err()
    );
    assert!(fixture.store.item("persistent", false).is_ok());
    drop(restarted);
    drop(isolated);
    fixture.close();
}

#[test]
fn original_desktop_fingerprint_directories_import_with_stale_path_fingerprint_but_not_wrong_folder_or_metadata()
 {
    let fixture = Fixture::new();
    for hash in [0_u64, 0x0123456789abcdef] {
        let directory = fixture
            .store
            .root()
            .join("media")
            .join(format!("{hash:016x}"));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("desktop.png");
        std::fs::write(&path, std::fs::read(&fixture.path).unwrap()).unwrap();
        let mut asset = fixture.asset.clone();
        let mut payload = asset_payload::decode(&asset).unwrap();
        let item = payload.files_mut().next().unwrap();
        item.path = path.clone();
        item.content_hash = hash;
        asset.payload = payload.to_text();
        assert_ne!(hash, vv_media::content_fingerprint(&path).unwrap());
        let id = format!("desktop-{hash}");
        fixture.store.create(&id, &asset).unwrap();
        let revision = fixture.store.item(&id, false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        let pending = fixture
            .jobs
            .prepare_import("epoch", "7", &id, &revision)
            .unwrap();
        let ready = fixture.finish(pending["id"].as_str().unwrap());
        assert_eq!(ready["state"], "ready", "{ready}");
        let payload = fixture
            .jobs
            .import_payload(ready["id"].as_str().unwrap(), &id, &revision, "epoch", "7")
            .unwrap();
        let copied = payload.files().next().unwrap();
        assert_eq!(copied.path, fixture.project.join("library/desktop.png"));
        assert_eq!(
            copied.content_hash,
            vv_media::content_fingerprint(&copied.path).unwrap()
        );
        let mut wrong = asset.clone();
        let mut payload = asset_payload::decode(&wrong).unwrap();
        payload.files_mut().next().unwrap().content_hash = hash ^ 1;
        wrong.payload = payload.to_text();
        let bad_id = format!("wrong-{hash}");
        fixture.store.create(&bad_id, &wrong).unwrap();
        let revision = fixture.store.item(&bad_id, false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(
            fixture
                .jobs
                .prepare_import("epoch", "7", &bad_id, &revision)
                .is_err()
        );
        let mut wrong = asset;
        let mut payload = asset_payload::decode(&wrong).unwrap();
        payload.files_mut().next().unwrap().meta.width += 1;
        wrong.payload = payload.to_text();
        let bad_id = format!("metadata-{hash}");
        fixture.store.create(&bad_id, &wrong).unwrap();
        let revision = fixture.store.item(&bad_id, false).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned();
        let pending = fixture
            .jobs
            .prepare_import("epoch", "7", &bad_id, &revision)
            .unwrap();
        let failed = fixture.finish(pending["id"].as_str().unwrap());
        assert_eq!(failed["error"], "SOURCE_CHANGED", "{failed}");
    }
    fixture.close();
}

#[test]
fn obsolete_project_cancellation_marks_only_old_queue_and_ready_records_and_preserves_published_files()
 {
    let fixture = Fixture::new();
    let published = fixture.capture();
    assert_eq!(published["state"], "ready", "{published}");
    let published_id = published["id"].as_str().unwrap();
    fixture
        .jobs
        .publish("preserved", published_id, "epoch", "7")
        .unwrap();
    let applied = fixture.jobs.status(published_id, "epoch", false).unwrap();
    assert_eq!(applied["state"], "applied");
    let exported = fixture.store.export("preserved").unwrap();
    let ready = fixture.capture();
    assert_eq!(ready["state"], "ready", "{ready}");
    let ready_id = ready["id"].as_str().unwrap();
    assert_ne!(ready_id, published_id);
    let (sender, receiver) = mpsc::sync_channel(1);
    let isolated = Jobs(Arc::new(Inner {
        store: fixture.store.clone(),
        root: fixture.project.clone(),
        directory: File::open(&fixture.project).unwrap(),
        media_roots: fixture.jobs.0.media_roots.clone(),
        jobs: Mutex::new(VecDeque::new()),
        sender,
    }));
    let old = isolated
        .prepare_capture("epoch", "7", fixture.asset.clone(), fixture.sources())
        .unwrap();
    let running = receiver.try_recv().unwrap();
    isolated.0.jobs.lock().unwrap().front_mut().unwrap().state = "running";
    let current = isolated
        .prepare_capture("current", "1", fixture.asset.clone(), fixture.sources())
        .unwrap();
    isolated.cancel_obsolete("current");
    fixture.jobs.cancel_obsolete("current");
    assert!(running.cancel.load(Ordering::Acquire));
    assert!(!receiver.try_recv().unwrap().cancel.load(Ordering::Acquire));
    assert_eq!(
        isolated
            .status(old["id"].as_str().unwrap(), "epoch", false)
            .unwrap()["state"],
        "running"
    );
    assert_eq!(
        isolated
            .status(current["id"].as_str().unwrap(), "current", false)
            .unwrap()["state"],
        "queued"
    );
    let canceled = fixture.jobs.status(ready_id, "epoch", false).unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert!(canceled["result"].is_null());
    assert_eq!(
        fixture.jobs.status(published_id, "epoch", false).unwrap(),
        applied
    );
    fixture
        .jobs
        .publish("preserved", published_id, "epoch", "7")
        .unwrap();
    assert_eq!(fixture.store.export("preserved").unwrap(), exported);
    let loaded = asset_payload::parse(&exported).unwrap();
    for media in asset_payload::decode(&loaded).unwrap().files() {
        assert!(media.path.exists());
    }
    assert!(fixture.path.exists());
    drop(running);
    drop(isolated);
    fixture.close();
}

fn edit_receipt(id: &str) -> Value {
    json!({"command_id":id,"status":"applied","project_epoch":"epoch","generation":"7","library_durable":true})
}

#[test]
fn folder_worker_retains_original_validation_missing_and_conflict_failures_without_changing_job_wire()
 {
    let fixture = Fixture::new();
    std::fs::write(
        fixture.store.root().join("folders.json"),
        serde_json::to_vec(
            &json!({"version":1,"folders":[{"id":"root","name":"Root","parent":null}]}),
        )
        .unwrap(),
    )
    .unwrap();
    let revision = fixture.store.folders().unwrap()["folders_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    for (id, edit, status, code) in [
        (
            "cycle",
            asset_store::Edit::MoveFolder {
                id: "root".into(),
                folders_revision: revision.clone(),
                parent: Some("root".into()),
            },
            422,
            "INVALID_OPERATION",
        ),
        (
            "missing",
            asset_store::Edit::RenameFolder {
                id: "missing".into(),
                folders_revision: revision.clone(),
                name: "Name".into(),
            },
            404,
            "NOT_FOUND",
        ),
        (
            "stale",
            asset_store::Edit::RenameFolder {
                id: "root".into(),
                folders_revision: "stale".into(),
                name: "Name".into(),
            },
            409,
            "FOLDERS_CHANGED",
        ),
    ] {
        let queued = fixture
            .jobs
            .prepare_edit("epoch", "7", id, [1; 32], edit_receipt(id), edit)
            .unwrap();
        let job = fixture.finish(queued["id"].as_str().unwrap());
        assert_eq!(job["state"], "failed", "{job}");
        assert_eq!(job["error"], code);
        assert!(job.get("failure").is_none());
        let error = fixture
            .jobs
            .read_failure(job["id"].as_str().unwrap(), "epoch")
            .unwrap()
            .unwrap();
        assert_eq!(error.0.as_u16(), status);
        assert_eq!(error.1, code);
        assert!(!error.2.is_empty());
        assert!(
            fixture
                .jobs
                .read_failure(job["id"].as_str().unwrap(), "other")
                .is_err()
        );
    }
    assert!(fixture.jobs.read_failure("unknown", "epoch").is_err());
    fixture.close();
}

#[test]
fn folder_preparation_uses_shared_worker_dedup_binds_full_request_and_durable_completion_before_applied_status()
 {
    let fixture = Fixture::new();
    let edit = asset_store::Edit::CreateFolder {
        folders_revision: "absent".into(),
        name: "Original folder".into(),
        parent: None,
    };
    let queued = fixture
        .jobs
        .prepare_edit(
            "epoch",
            "7",
            "folder-command",
            [9; 32],
            edit_receipt("folder-command"),
            edit.clone(),
        )
        .unwrap();
    let duplicate = fixture
        .jobs
        .prepare_edit(
            "epoch",
            "7",
            "folder-command",
            [9; 32],
            edit_receipt("folder-command"),
            edit.clone(),
        )
        .unwrap();
    assert_eq!(queued["id"], duplicate["id"]);
    assert_eq!(queued["kind"], "library_edit");
    assert_eq!(
        fixture
            .jobs
            .prepare_edit(
                "epoch",
                "7",
                "folder-command",
                [8; 32],
                edit_receipt("folder-command"),
                edit.clone()
            )
            .unwrap_err()
            .1,
        "COMMAND_ID_REUSED"
    );
    let ready = fixture.finish(queued["id"].as_str().unwrap());
    assert_eq!(ready["state"], "ready", "{ready}");
    assert!(
        fixture.store.folders().unwrap()["folders"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        fixture
            .jobs
            .commit_edit("folder-command", [9; 32], "epoch", "8", &edit)
            .unwrap_err()
            .1,
        "ASSET_CONTEXT_CHANGED"
    );
    fixture
        .jobs
        .commit_edit("folder-command", [9; 32], "epoch", "7", &edit)
        .unwrap();
    let status = fixture
        .jobs
        .status(queued["id"].as_str().unwrap(), "epoch", true)
        .unwrap();
    assert_eq!(status["state"], "applied");
    let binding = crate::asset_journal::project_binding(&fixture.jobs.0.directory).unwrap();
    let completion = fixture
        .store
        .completion("folder-command", &binding)
        .unwrap()
        .unwrap();
    assert_eq!(completion.0, [9; 32]);
    assert_eq!(completion.1, edit_receipt("folder-command"));
    fixture
        .store
        .acknowledge_completion("folder-command", [9; 32], &binding)
        .unwrap();
    assert!(
        fixture
            .store
            .completion("folder-command", &binding)
            .unwrap()
            .is_none()
    );
    fixture.close();
}

#[test]
fn canceled_or_obsolete_folder_preparations_never_publish_native_files_or_command_receipts() {
    let fixture = Fixture::new();
    let edit = asset_store::Edit::CreateFolder {
        folders_revision: "absent".into(),
        name: "Canceled".into(),
        parent: None,
    };
    for (id, obsolete) in [("cancel", false), ("obsolete", true)] {
        let queued = fixture
            .jobs
            .prepare_edit("epoch", "7", id, [2; 32], edit_receipt(id), edit.clone())
            .unwrap();
        let ready = fixture.finish(queued["id"].as_str().unwrap());
        assert_eq!(ready["state"], "ready", "{ready}");
        if obsolete {
            fixture.jobs.cancel_obsolete("another");
        } else {
            fixture
                .jobs
                .status(queued["id"].as_str().unwrap(), "epoch", true)
                .unwrap();
        }
        assert_eq!(
            fixture
                .jobs
                .commit_edit(id, [2; 32], "epoch", "7", &edit)
                .unwrap_err()
                .1,
            "ASSET_NOT_READY"
        );
    }
    assert!(!fixture.store.root().join("folders.json").exists());
    let binding = crate::asset_journal::project_binding(&fixture.jobs.0.directory).unwrap();
    assert!(fixture.store.completions(&binding).unwrap().is_empty());
    assert!(
        std::fs::read_dir(fixture.store.root())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".venturi-asset-stage-"))
    );
    fixture.close();
}
