use super::*;
use serde_json::json;

fn fixture() -> (std::path::PathBuf, File, File) {
    let path = std::env::temp_dir().join(format!(
        "venturi-asset-journal-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir(&path).unwrap();
    let root = File::open(&path).unwrap();
    let assets = asset_store::directory(&root, "assets").unwrap();
    (path, root, assets)
}
fn completion(id: &str, root: &File) -> Completion {
    Completion {
        version: 1,
        command_id: id.into(),
        fingerprint: [7; 32],
        project_root_binding: project_binding(root).unwrap(),
        receipt: json!({"command_id":id,"status":"applied","library_durable":true}),
    }
}
fn before(directory: &File, name: &str) -> Before {
    let (file, bytes) = read(directory, name, 1024).unwrap().unwrap();
    Before {
        identity: stable_identity(&file).unwrap(),
        sha256: digest(&bytes),
    }
}
fn intent(prepared: &mut PreparedEdit, root: &File) {
    prepared.stage.sync_all().unwrap();
    atomic(
        root,
        PENDING,
        &serde_json::to_vec(&prepared.manifest).unwrap(),
        false,
    )
    .unwrap();
    prepared.durable = true;
}

#[test]
fn durable_multi_json_commit_and_completion_are_recoverable_and_acknowledged_separately() {
    let (path, root, assets) = fixture();
    std::fs::write(path.join("assets/a.json"), b"before-a").unwrap();
    std::fs::write(path.join("folders.json"), b"before-folders").unwrap();
    let entry = completion("command", &root);
    let binding = entry.project_root_binding.clone();
    let mut prepared = PreparedEdit::new(&root, entry, json!({})).unwrap();
    prepared
        .add(
            true,
            "a.json".into(),
            Some(before(&assets, "a.json")),
            b"after-a",
        )
        .unwrap();
    prepared
        .add(
            false,
            "folders.json".into(),
            Some(before(&root, "folders.json")),
            b"after-folders",
        )
        .unwrap();
    prepared
        .commit(&root, &assets, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(
        std::fs::read(path.join("assets/a.json")).unwrap(),
        b"after-a"
    );
    assert_eq!(
        std::fs::read(path.join("folders.json")).unwrap(),
        b"after-folders"
    );
    assert!(!pending(&root).unwrap());
    assert!(completion_for(&root, "command", "other").unwrap().is_none());
    assert_eq!(completions(&root, &binding).unwrap().len(), 1);
    recover(&root, &assets).unwrap();
    acknowledge(&root, "command", [7; 32], &binding).unwrap();
    assert!(
        completion_for(&root, "command", &binding)
            .unwrap()
            .is_none()
    );
    drop(prepared);
    drop(assets);
    drop(root);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn restart_rolls_forward_after_one_installed_image_and_records_original_full_request_receipt() {
    let (path, root, assets) = fixture();
    std::fs::write(path.join("assets/a.json"), b"old-a").unwrap();
    std::fs::write(path.join("assets/b.json"), b"old-b").unwrap();
    let entry = completion("recovered", &root);
    let binding = entry.project_root_binding.clone();
    let mut prepared = PreparedEdit::new(&root, entry, json!({})).unwrap();
    prepared
        .add(
            true,
            "a.json".into(),
            Some(before(&assets, "a.json")),
            b"new-a",
        )
        .unwrap();
    prepared
        .add(
            true,
            "b.json".into(),
            Some(before(&assets, "b.json")),
            b"new-b",
        )
        .unwrap();
    intent(&mut prepared, &root);
    renameat(&prepared.stage, "after-0.json", &assets, "a.json").unwrap();
    assets.sync_all().unwrap();
    drop(prepared);
    recover(&root, &assets).unwrap();
    assert_eq!(std::fs::read(path.join("assets/a.json")).unwrap(), b"new-a");
    assert_eq!(std::fs::read(path.join("assets/b.json")).unwrap(), b"new-b");
    assert_eq!(
        completion_for(&root, "recovered", &binding)
            .unwrap()
            .unwrap()
            .fingerprint,
        [7; 32]
    );
    assert!(!pending(&root).unwrap());
    drop(assets);
    drop(root);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn foreign_change_after_intent_blocks_all_rollforward_and_preserves_recovery_inputs() {
    let (path, root, assets) = fixture();
    std::fs::write(path.join("assets/a.json"), b"old-a").unwrap();
    std::fs::write(path.join("assets/b.json"), b"old-b").unwrap();
    let mut prepared = PreparedEdit::new(&root, completion("blocked", &root), json!({})).unwrap();
    prepared
        .add(
            true,
            "a.json".into(),
            Some(before(&assets, "a.json")),
            b"new-a",
        )
        .unwrap();
    prepared
        .add(
            true,
            "b.json".into(),
            Some(before(&assets, "b.json")),
            b"new-b",
        )
        .unwrap();
    intent(&mut prepared, &root);
    let stage = prepared.manifest.directory.clone();
    drop(prepared);
    std::fs::write(path.join("assets/b.json"), b"foreign").unwrap();
    assert_eq!(
        recover(&root, &assets).unwrap_err().1,
        "ASSET_JOURNAL_CONFLICT"
    );
    assert_eq!(std::fs::read(path.join("assets/a.json")).unwrap(), b"old-a");
    assert_eq!(
        std::fs::read(path.join("assets/b.json")).unwrap(),
        b"foreign"
    );
    assert!(path.join(stage).join("after-0.json").exists());
    assert!(pending(&root).unwrap());
    drop(assets);
    drop(root);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn cancel_and_noop_read_guards_refuse_stale_state_before_intent_and_release_own_stages() {
    let (path, root, assets) = fixture();
    std::fs::write(path.join("assets/a.json"), b"original").unwrap();
    let mut prepared = PreparedEdit::new(&root, completion("canceled", &root), json!({})).unwrap();
    prepared
        .add(
            true,
            "a.json".into(),
            Some(before(&assets, "a.json")),
            b"new",
        )
        .unwrap();
    let stage = prepared.manifest.directory.clone();
    assert_eq!(
        prepared
            .commit(&root, &assets, &AtomicBool::new(true))
            .unwrap_err()
            .1,
        "ASSET_CANCELED"
    );
    drop(prepared);
    assert!(!path.join(stage).exists());
    assert!(!pending(&root).unwrap());
    let mut prepared = PreparedEdit::new(&root, completion("noop", &root), json!({})).unwrap();
    prepared.guard(true, "a.json".into(), Some(before(&assets, "a.json")));
    std::fs::write(path.join("assets/a.json"), b"changed").unwrap();
    assert_eq!(
        prepared
            .commit(&root, &assets, &AtomicBool::new(false))
            .unwrap_err()
            .1,
        "ASSET_JOURNAL_CONFLICT"
    );
    assert!(!pending(&root).unwrap());
    drop(prepared);
    drop(assets);
    drop(root);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn manifest_path_budget_and_orphan_stage_admission_fail_closed_without_foreign_cleanup() {
    let (path, root, assets) = fixture();
    let mut prepared = PreparedEdit::new(&root, completion("safe", &root), json!({})).unwrap();
    prepared.add(true, "a.json".into(), None, b"new").unwrap();
    prepared.manifest.targets[0].bytes = MAX_METADATA + 1;
    assert!(validate_manifest(&prepared.manifest).is_err());
    prepared.manifest.targets[0].bytes = 3;
    prepared.manifest.targets[0].name = "../foreign.json".into();
    assert!(validate_manifest(&prepared.manifest).is_err());
    drop(prepared);
    for index in 0..16 {
        std::fs::create_dir(path.join(format!(".venturi-asset-stage-foreign-{index}"))).unwrap();
    }
    assert!(
        matches!(PreparedEdit::new(&root,completion("limit",&root),json!({})),Err(error)if error.1=="ASSET_STAGE_LIMIT")
    );
    assert!(path.join(".venturi-asset-stage-foreign-0").exists());
    drop(assets);
    drop(root);
    std::fs::remove_dir_all(path).unwrap();
}
