use super::*;
use serde_json::json;

fn fixture() -> (PathBuf, File, Store) {
    let path = std::env::temp_dir().join(format!(
        "venturi-export-store-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    let root = File::open(&path).unwrap();
    let store = Store::open(&root).unwrap();
    (path, root, store)
}
fn record(id: &str) -> Record {
    Record {
        version: 1,
        id: id.into(),
        key: format!("export:old:{id}"),
        epoch: "old-process:1".into(),
        state: "queued".into(),
        previous_state: None,
        cancel_requested: false,
        error: None,
        program: json!({"start_frame":0,"end_frame":48,"width":640,"height":360}),
        progress: Some(json!({"current_frame":0,"total_frames":48})),
        bytes: 0,
        output: None,
        discard: None,
    }
}
fn terminal(store: &Store, stored: &mut Stored, state: &str) {
    let mut changed = stored.record.clone();
    changed.state = state.into();
    changed.bytes = Store::bytes(stored);
    store.save(stored, changed).unwrap();
}
fn discard_request(stored: &Stored) -> DiscardRequest {
    DiscardRequest {
        project_epoch: stored.record.epoch.clone(),
        revision: stored.revision.clone(),
        command_id: "5c9f22b0-3b24-4f11-85d7-77ad9a164b13".into(),
    }
}
fn ready(store: &Store, id: &str) -> Stored {
    let mut stored = store.admit(record(id)).unwrap();
    std::fs::write(
        stored.directory().join("rendering.mp4"),
        b"completed export",
    )
    .unwrap();
    let output = store.publish_output(&stored).unwrap();
    let mut record = stored.record.clone();
    record.state = "ready".into();
    record.bytes = output.bytes;
    record.output = Some(output);
    store.save(&mut stored, record).unwrap();
    stored
}

#[test]
fn completed_exports_reopen_exact_outputs_and_changed_outputs_are_refused() {
    let (path, root, store) = fixture();
    let mut stored = store.admit(record("1")).unwrap();
    assert!(store.output(&stored).is_err());
    let bytes = b"completed immutable output";
    std::fs::write(stored.directory().join("rendering.mp4"), bytes).unwrap();
    let output = store.publish_output(&stored).unwrap();
    assert!(store.output(&stored).is_err());
    let mut ready = stored.record.clone();
    ready.state = "ready".into();
    ready.bytes = output.bytes;
    ready.output = Some(output);
    ready.progress = Some(json!({"current_frame":48,"total_frames":48}));
    store.save(&mut stored, ready).unwrap();
    drop(stored);
    drop(store);
    let store = Store::open(&root).unwrap();
    let recovered = store.recover().unwrap();
    assert_eq!(recovered[0].record.state, "ready");
    assert_eq!(recovered[0].record.epoch, "old-process:1");
    let mut downloaded = vec![];
    store
        .output(&recovered[0])
        .unwrap()
        .read_to_end(&mut downloaded)
        .unwrap();
    assert_eq!(downloaded, bytes);
    std::fs::write(
        recovered[0].directory().join("program.mp4"),
        b"changed output",
    )
    .unwrap();
    assert_eq!(
        store.output(&recovered[0]).unwrap_err().1,
        "EXPORT_OUTPUT_CHANGED"
    );
    let recovered = store.recover().unwrap();
    assert_eq!(recovered[0].record.state, "failed");
    assert_eq!(
        recovered[0].record.error.as_deref(),
        Some("EXPORT_OUTPUT_CHANGED")
    );
    assert_eq!(
        std::fs::read(recovered[0].directory().join("program.mp4")).unwrap(),
        b"changed output"
    );
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn restart_interrupts_active_jobs_preserves_cancel_intent_and_never_promotes_orphan_output() {
    let (path, root, store) = fixture();
    let queued = store.admit(record("1")).unwrap();
    let mut running = store.admit(record("2")).unwrap();
    terminal(&store, &mut running, "running");
    std::fs::write(
        running.directory().join("rendering.mp4"),
        b"uncommitted completed file",
    )
    .unwrap();
    store.publish_output(&running).unwrap();
    let mut canceled = store.admit(record("3")).unwrap();
    let mut intent = canceled.record.clone();
    intent.cancel_requested = true;
    store.save(&mut canceled, intent).unwrap();
    drop((queued, running, canceled));
    drop(store);
    let store = Store::open(&root).unwrap();
    let recovered = store.recover().unwrap();
    assert_eq!(recovered[0].record.state, "interrupted");
    assert_eq!(
        recovered[0].record.previous_state.as_deref(),
        Some("queued")
    );
    assert_eq!(recovered[1].record.state, "interrupted");
    assert_eq!(
        recovered[1].record.previous_state.as_deref(),
        Some("running")
    );
    assert_eq!(
        recovered[1].record.charge(),
        b"uncommitted completed file".len() as u64
    );
    assert!(store.output(&recovered[1]).is_err());
    assert_eq!(
        std::fs::read(recovered[1].directory().join("program.mp4")).unwrap(),
        b"uncommitted completed file"
    );
    assert_eq!(recovered[2].record.state, "canceled");
    assert!(recovered[2].record.cancel_requested);
    assert_eq!(store.recover().unwrap()[1].record.state, "interrupted");
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn admission_reserves_output_budget_and_refuses_full_history_without_evicting() {
    let (path, _, store) = fixture();
    let mut pending = vec![];
    for id in 1..=4 {
        pending.push(store.admit(record(&id.to_string())).unwrap());
    }
    assert_eq!(store.admit(record("5")).err().unwrap().1, "EXPORT_CAPACITY");
    assert!(!path.join(".exports/5").exists());
    assert_eq!(store.ids().unwrap().len(), 4);
    for stored in &mut pending {
        terminal(&store, stored, "failed");
    }
    for id in 5..=MAX_JOBS {
        let mut stored = store.admit(record(&id.to_string())).unwrap();
        terminal(&store, &mut stored, "failed");
    }
    assert_eq!(store.ids().unwrap().len(), MAX_JOBS);
    assert_eq!(
        store.admit(record("65")).err().unwrap().1,
        "EXPORT_CAPACITY"
    );
    assert!(path.join(".exports/1.json").is_file());
    let request = discard_request(&pending[0]);
    store.discard(&mut pending[0], &request).unwrap();
    assert_eq!(store.ids().unwrap().len(), MAX_JOBS - 1);
    assert!(!path.join(".exports/1.json").exists());
    assert_eq!(
        store.admit(record("1")).err().unwrap().1,
        "EXPORT_ID_EXPIRED"
    );
    store.admit(record("65")).unwrap();
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn discard_refuses_active_downloads_stale_revisions_and_active_jobs_before_any_write() {
    let (path, _, store) = fixture();
    let mut stored = ready(&store, "1");
    let request = discard_request(&stored);
    let manifest = std::fs::read(path.join(".exports/1.json")).unwrap();
    let download = store.output(&stored).unwrap();
    assert_eq!(
        store.discard(&mut stored, &request).unwrap_err().1,
        "EXPORT_DOWNLOAD_ACTIVE"
    );
    assert_eq!(
        std::fs::read(path.join(".exports/1.json")).unwrap(),
        manifest
    );
    assert_eq!(
        std::fs::read(stored.directory().join("program.mp4")).unwrap(),
        b"completed export"
    );
    drop(download);
    let mut stale = request.clone();
    stale.revision = "0".repeat(64);
    assert_eq!(
        store.discard(&mut stored, &stale).unwrap_err().1,
        "EXPORT_CHANGED"
    );
    let mut invalid = request.clone();
    invalid.command_id = "not-a-uuid".into();
    assert!(store.discard(&mut stored, &invalid).is_err());
    let mut active = store.admit(record("2")).unwrap();
    let active_request = discard_request(&active);
    assert_eq!(
        store.discard(&mut active, &active_request).unwrap_err().1,
        "EXPORT_ACTIVE"
    );
    assert_eq!(
        std::fs::read(path.join(".exports/1.json")).unwrap(),
        manifest
    );
    store.discard(&mut stored, &request).unwrap();
    assert!(!path.join(".exports/1").exists());
    assert!(!path.join(".exports/1.json").exists());
    assert!(path.join(".exports/2.json").is_file());
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn restart_finishes_committed_discard_at_each_unlink_boundary_and_preserves_unrequested_jobs() {
    for phase in 0..4 {
        let (path, root, store) = fixture();
        let mut stored = store.admit(record("1")).unwrap();
        for name in ["program.mp4", "rendering.mp4"] {
            std::fs::write(stored.directory().join(name), b"owned").unwrap();
        }
        terminal(&store, &mut stored, "failed");
        let mut other = store.admit(record("2")).unwrap();
        std::fs::write(other.directory().join("rendering.mp4"), b"unrequested").unwrap();
        terminal(&store, &mut other, "failed");
        let request = discard_request(&stored);
        let guards = store.begin_discard(&mut stored, &request).unwrap();
        assert_eq!(stored.record.state, "discarding");
        let count = if phase == 0 {
            0
        } else if phase == 1 {
            1
        } else {
            2
        };
        for guard in guards.iter().take(count) {
            unlinkat(&stored.dir, guard.snapshot.name.as_str(), AtFlags::empty()).unwrap();
        }
        stored.dir.sync_all().unwrap();
        if phase == 3 {
            unlinkat(&store.root, "1", AtFlags::REMOVEDIR).unwrap();
            store.root.sync_all().unwrap();
        }
        drop((guards, stored, other));
        drop(store);
        let store = Store::open(&root).unwrap();
        let remaining = store.recover().unwrap();
        assert_eq!(remaining.len(), 1, "Crash phase {phase}");
        assert_eq!(remaining[0].record.id, "2");
        assert_eq!(
            std::fs::read(remaining[0].directory().join("rendering.mp4")).unwrap(),
            b"unrequested"
        );
        assert!(!path.join(".exports/1").exists());
        assert!(!path.join(".exports/1.json").exists());
        assert_eq!(
            store.admit(record("1")).err().unwrap().1,
            "EXPORT_ID_EXPIRED"
        );
        std::fs::remove_dir_all(path).unwrap();
    }
}

#[test]
fn committed_discard_preserves_new_changed_and_linked_files_and_keeps_capacity_charged() {
    for case in 0..3 {
        let (path, root, store) = fixture();
        let mut stored = store.admit(record("1")).unwrap();
        std::fs::write(stored.directory().join("rendering.mp4"), b"owned").unwrap();
        terminal(&store, &mut stored, "failed");
        let request = discard_request(&stored);
        drop(store.begin_discard(&mut stored, &request).unwrap());
        let outside = path.join("outside");
        std::fs::write(&outside, b"foreign outside").unwrap();
        match case {
            0 => std::fs::write(stored.directory().join("foreign.txt"), b"foreign entry").unwrap(),
            1 => std::fs::write(
                stored.directory().join("rendering.mp4"),
                b"changed foreign entry",
            )
            .unwrap(),
            _ => {
                std::fs::remove_file(stored.directory().join("rendering.mp4")).unwrap();
                std::os::unix::fs::symlink(&outside, stored.directory().join("rendering.mp4"))
                    .unwrap();
            }
        }
        drop(stored);
        drop(store);
        let store = Store::open(&root).unwrap();
        let preserved = store.recover().unwrap();
        assert_eq!(preserved.len(), 1);
        assert_eq!(preserved[0].record.state, "discarding");
        assert_eq!(
            preserved[0].record.error.as_deref(),
            Some("EXPORT_DISCARD_BLOCKED")
        );
        assert_eq!(preserved[0].record.charge(), MAX_TOTAL);
        assert_eq!(store.admit(record("2")).err().unwrap().1, "EXPORT_CAPACITY");
        assert_eq!(std::fs::read(&outside).unwrap(), b"foreign outside");
        if case == 0 {
            assert_eq!(
                std::fs::read(preserved[0].directory().join("foreign.txt")).unwrap(),
                b"foreign entry"
            );
        }
        if case == 1 {
            assert_eq!(
                std::fs::read(preserved[0].directory().join("rendering.mp4")).unwrap(),
                b"changed foreign entry"
            );
        }
        if case == 2 {
            assert!(
                std::fs::symlink_metadata(preserved[0].directory().join("rendering.mp4"))
                    .unwrap()
                    .file_type()
                    .is_symlink()
            );
        }
        std::fs::remove_dir_all(path).unwrap();
    }
}

#[test]
fn discard_replay_requires_original_uuid_and_revision_and_malformed_floor_is_preserved() {
    let (path, root, store) = fixture();
    let mut stored = ready(&store, "1");
    let request = discard_request(&stored);
    drop(store.begin_discard(&mut stored, &request).unwrap());
    let mut another = request.clone();
    another.command_id = "5c9f22b0-3b24-4f11-85d7-77ad9a164b14".into();
    assert_eq!(
        store.discard(&mut stored, &another).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    store.discard(&mut stored, &request).unwrap();
    assert_eq!(
        std::fs::read(path.join(".exports/.discarded-through")).unwrap(),
        b"1"
    );
    std::fs::write(
        path.join(".exports/.discarded-through"),
        b"preserve invalid floor",
    )
    .unwrap();
    drop(stored);
    drop(store);
    let store = Store::open(&root).unwrap();
    assert!(store.recover().is_err());
    assert!(store.admit(record("2")).is_err());
    assert_eq!(
        std::fs::read(path.join(".exports/.discarded-through")).unwrap(),
        b"preserve invalid floor"
    );
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn failed_and_interrupted_partial_files_keep_their_output_capacity_charge() {
    let (path, _, store) = fixture();
    let mut failed = store.admit(record("1")).unwrap();
    let file = File::create(failed.directory().join("rendering.mp4")).unwrap();
    file.set_len(MAX_OUTPUT).unwrap();
    terminal(&store, &mut failed, "failed");
    assert_eq!(failed.record.charge(), MAX_OUTPUT);
    let pending = store.admit(record("2")).unwrap();
    let file = File::create(pending.directory().join("rendering.mp4")).unwrap();
    file.set_len(MAX_OUTPUT).unwrap();
    let recovered = store.recover().unwrap();
    assert_eq!(recovered[1].record.state, "interrupted");
    assert_eq!(recovered[1].record.charge(), MAX_OUTPUT);
    let third = store.admit(record("3")).unwrap();
    let fourth = store.admit(record("4")).unwrap();
    assert_eq!(store.admit(record("5")).err().unwrap().1, "EXPORT_CAPACITY");
    assert_eq!(Store::bytes(&recovered[0]), MAX_OUTPUT);
    assert_eq!(Store::bytes(&recovered[1]), MAX_OUTPUT);
    drop((third, fourth));
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn root_links_output_collisions_and_manifest_changes_preserve_foreign_files() {
    let (path, root, store) = fixture();
    assert_eq!(Store::open(&root).err().unwrap().1, "EXPORT_ROOT_BUSY");
    assert!(store.admit(record("../outside")).is_err());
    let mut stored = store.admit(record("1")).unwrap();
    std::fs::write(stored.directory().join("rendering.mp4"), b"new").unwrap();
    std::fs::write(stored.directory().join("program.mp4"), b"existing").unwrap();
    assert!(store.publish_output(&stored).is_err());
    assert_eq!(
        std::fs::read(stored.directory().join("program.mp4")).unwrap(),
        b"existing"
    );
    assert_eq!(
        std::fs::read(stored.directory().join("rendering.mp4")).unwrap(),
        b"new"
    );
    let mut foreign = stored.record.clone();
    foreign.error = Some("foreign edit".into());
    let foreign_bytes = serde_json::to_vec(&foreign).unwrap();
    std::fs::write(path.join(".exports/1.json"), &foreign_bytes).unwrap();
    let mut changed = stored.record.clone();
    changed.state = "running".into();
    assert_eq!(
        store.save(&mut stored, changed).unwrap_err().1,
        "EXPORT_CHANGED"
    );
    assert_eq!(
        std::fs::read(path.join(".exports/1.json")).unwrap(),
        foreign_bytes
    );
    std::fs::remove_file(stored.directory().join("program.mp4")).unwrap();
    let outside = path.join("outside.mp4");
    std::fs::write(&outside, b"preserved outside").unwrap();
    std::os::unix::fs::symlink(&outside, stored.directory().join("program.mp4")).unwrap();
    stored.record.state = "ready".into();
    stored.record.output = Some(Output {
        identity: file_identity(&File::open(&outside).unwrap()).unwrap(),
        bytes: b"preserved outside".len() as u64,
    });
    assert!(store.output(&stored).is_err());
    assert_eq!(std::fs::read(outside).unwrap(), b"preserved outside");
    std::fs::remove_dir_all(path).unwrap();
}
