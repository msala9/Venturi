use super::*;
use serde_json::json;
fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "vv-web-journal-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
#[test]
fn persisted_receipts_survive_restart_with_exact_request_identity_and_single_root_owner() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let (mut store, entries) = Store::open(&files).unwrap();
    assert!(entries.is_empty());
    assert_eq!(Store::open(&files).err().unwrap().1, "ROOT_BUSY");
    let result = json!({"status":"applied","command_id":"one","receipt_persisted":true,"durability":{"state":"recovery","recovery_revision":"checkpoint"}});
    store.append(&files, "one", [42; 32], &result).unwrap();
    drop(store);
    let (store, entries) = Store::open(&files).unwrap();
    assert_eq!(entries["one"].0, [42; 32]);
    let mut expected = result;
    expected["server_restarted"] = json!(true);
    assert_eq!(entries["one"].1, expected);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn durable_completion_harvest_is_idempotent_and_cannot_replace_the_original_receipt() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let (mut store, _) = Store::open(&files).unwrap();
    let original = json!({"status":"applied","command_id":"folder-command","library_durable":true,"receipt_persisted":true});
    store
        .append(&files, "folder-command", [19; 32], &original)
        .unwrap();
    let before = std::fs::read(root.join(NAME)).unwrap();
    store.append(&files,"folder-command",[19;32],&json!({"status":"applied","command_id":"folder-command","different":"conservative recovery seed"})).unwrap();
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), before);
    assert_eq!(
        store.recorded("folder-command"),
        Some(([19; 32], original.clone()))
    );
    assert_eq!(
        store
            .append(&files, "folder-command", [20; 32], &original)
            .unwrap_err()
            .1,
        "COMMAND_ID_REUSED"
    );
    drop(store);
    let (store, entries) = Store::open(&files).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries["folder-command"].0, [19; 32]);
    assert_eq!(entries["folder-command"].1["server_restarted"], true);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn receipt_window_rotates_atomically_and_torn_or_changed_logs_are_preserved() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let (mut store, _) = Store::open(&files).unwrap();
    for index in 0..=MAX_ENTRIES {
        store
            .append(
                &files,
                &index.to_string(),
                [0; 32],
                &json!({"status":"applied","command_id":index.to_string()}),
            )
            .unwrap();
    }
    drop(store);
    let (store, entries) = Store::open(&files).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries.contains_key(&MAX_ENTRIES.to_string()));
    drop(store);
    let path = root.join(NAME);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes.extend_from_slice(b"{partial");
    std::fs::write(&path, &bytes).unwrap();
    assert!(Store::open(&files).is_err());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn replacing_the_open_journal_cannot_redirect_a_durable_ack_to_an_unlinked_file() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let (mut store, _) = Store::open(&files).unwrap();
    std::fs::rename(root.join(NAME), root.join("preserved.jsonl")).unwrap();
    let bytes = b"external replacement";
    std::fs::write(root.join(NAME), bytes).unwrap();
    assert!(
        store
            .append(&files, "one", [0; 32], &json!({"status":"applied"}))
            .is_err()
    );
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), bytes);
    assert!(
        std::fs::read(root.join("preserved.jsonl"))
            .unwrap()
            .is_empty()
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
