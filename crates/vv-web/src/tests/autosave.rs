use super::*;
use crate::commands::{self, Operation};
use std::path::PathBuf;
fn setup() -> (Files, Session, vv_core::TimelineId, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "vv-web-autosave-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    let mut session = Session::default();
    let timeline = session.create_timeline(vv_core::Timeline {
        name: "Recovery".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            vv_core::Track::new(vv_core::TrackKind::Video),
            vv_core::Track::new(vv_core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    files
        .save(&session.project, "original.vvproj", true)
        .unwrap();
    session.set_path(Some(files.path("original.vvproj").unwrap()));
    session.mark_saved();
    (files, session, timeline, root)
}
fn add(session: &mut Session, timeline: vv_core::TimelineId, start: i64) {
    commands::apply(
        session,
        timeline,
        &Operation::AddSolid {
            track: "0".into(),
            start_frame: start,
            length_frames: 24,
        },
    )
    .unwrap();
}
fn reopen(files: &Files, session: &mut Session) {
    session.install_project(
        files.load("original.vvproj").unwrap(),
        Some(files.path("original.vvproj").unwrap()),
    );
}

#[test]
fn native_snapshot_preserves_dirty_state_and_recovers_a_new_saved_copy_with_annotations() {
    let (files, mut session, timeline, root) = setup();
    let original = std::fs::read(root.join("original.vvproj")).unwrap();
    crate::reviewmeta::edit(
        &files,
        &session,
        "original.vvproj",
        "absent",
        &crate::reviewmeta::Edit::NewShot {
            id: "shot".into(),
            name: "Recovery shot".into(),
        },
    )
    .unwrap();
    let mut store = Store::new(&files);
    add(&mut session, timeline, 0);
    let before = serde_json::to_value(&session.project).unwrap();
    let steps = session.history.position();
    store.tick(&files, &session);
    assert_eq!(store.info()["state"], "ready");
    assert!(session.has_unsaved_changes());
    assert_eq!(session.history.position(), steps);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(
        std::fs::read(root.join("original.vvproj")).unwrap(),
        original
    );
    let revision = store.info()["revision"].as_str().unwrap().to_owned();
    let mut crashed = Store::new(&files);
    assert!(crashed.pending);
    assert_eq!(
        crashed
            .recover(&files, &mut session, &revision, "recovered", true)
            .unwrap_err()
            .1,
        "UNSAVED_CHANGES"
    );
    reopen(&files, &mut session);
    crashed
        .recover(&files, &mut session, &revision, "recovered", true)
        .unwrap();
    assert!(!session.has_unsaved_changes());
    assert_eq!(session.project.timelines[timeline].tracks[0].clips.len(), 1);
    assert_eq!(
        std::fs::read(root.join("original.vvproj")).unwrap(),
        original
    );
    assert_eq!(
        std::fs::read(root.join("recovered.vvproj.review.json")).unwrap(),
        std::fs::read(root.join("original.vvproj.review.json")).unwrap()
    );
    files
        .save(&session.project, "recovered.vvproj", false)
        .unwrap();
    assert!(!Store::new(&files).pending);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pending_recovery_freezes_old_data_until_a_copy_is_kept_without_switching_dirty_projects() {
    let (files, mut session, timeline, root) = setup();
    let mut store = Store::new(&files);
    add(&mut session, timeline, 0);
    store.tick(&files, &session);
    let old = raw(&files).unwrap().unwrap();
    let revision = digest(&old);
    let mut crashed = Store::new(&files);
    reopen(&files, &mut session);
    add(&mut session, timeline, 48);
    let current = serde_json::to_value(&session.project).unwrap();
    let steps = session.history.position();
    crashed.tick(&files, &session);
    assert_eq!(raw(&files).unwrap().unwrap(), old);
    crashed
        .recover(&files, &mut session, &revision, "kept", false)
        .unwrap();
    assert_eq!(serde_json::to_value(&session.project).unwrap(), current);
    assert_eq!(session.history.position(), steps);
    assert!(session.has_unsaved_changes());
    assert!(files.saved_fingerprint("original.vvproj").is_some());
    let kept = files.load_detached("kept.vvproj").unwrap();
    assert_eq!(
        kept.timelines[timeline].tracks[0].clips[0].timeline_start,
        0
    );
    crashed.tick(&files, &session);
    assert_eq!(crashed.info()["state"], "ready");
    let record = parse(&files, &raw(&files).unwrap().unwrap()).unwrap();
    assert_eq!(
        snapshot(&record).unwrap().timelines[timeline].tracks[0].clips[0].timeline_start,
        48
    );
    files
        .save(&session.project, "original.vvproj", false)
        .unwrap();
    session.mark_saved();
    crashed.saved(&files, &session);
    assert!(!Store::new(&files).pending);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn save_as_resolves_the_owned_snapshot_against_the_new_saved_file() {
    let (files, mut session, timeline, root) = setup();
    let mut store = Store::new(&files);
    add(&mut session, timeline, 0);
    store.tick(&files, &session);
    files
        .save(&session.project, "saved_copy.vvproj", true)
        .unwrap();
    session.set_path(Some(files.path("saved_copy.vvproj").unwrap()));
    session.mark_saved();
    store.saved(&files, &session);
    assert_eq!(store.info()["state"], "saved");
    assert!(!Store::new(&files).pending);
    assert!(
        files.load_detached("original.vvproj").unwrap().timelines[timeline].tracks[0]
            .clips
            .is_empty()
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn saving_new_edits_immediately_after_recovery_keeps_the_snapshot_resolved() {
    let (files, mut session, timeline, root) = setup();
    let mut store = Store::new(&files);
    add(&mut session, timeline, 0);
    store.tick(&files, &session);
    let revision = store.info()["revision"].as_str().unwrap().to_owned();
    reopen(&files, &mut session);
    store
        .recover(&files, &mut session, &revision, "recovered", true)
        .unwrap();
    add(&mut session, timeline, 48);
    files
        .save(&session.project, "recovered.vvproj", false)
        .unwrap();
    session.mark_saved();
    store.saved(&files, &session);
    assert!(!Store::new(&files).pending);
    assert_eq!(session.project.timelines[timeline].tracks[0].clips.len(), 2);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn saving_a_different_current_state_keeps_the_retained_recovery_copy_as_its_resolution() {
    let (files, mut session, timeline, root) = setup();
    let mut store = Store::new(&files);
    add(&mut session, timeline, 0);
    store.tick(&files, &session);
    let revision = store.info()["revision"].as_str().unwrap().to_owned();
    let mut crashed = Store::new(&files);
    reopen(&files, &mut session);
    add(&mut session, timeline, 48);
    crashed
        .recover(&files, &mut session, &revision, "kept", false)
        .unwrap();
    files
        .save(&session.project, "original.vvproj", false)
        .unwrap();
    session.mark_saved();
    crashed.saved(&files, &session);
    assert_eq!(crashed.info()["resolved_to"], "kept.vvproj");
    assert!(!Store::new(&files).pending);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_existing_and_corrupt_recovery_requests_preserve_native_state_and_files() {
    let (files, mut session, timeline, root) = setup();
    let mut store = Store::new(&files);
    add(&mut session, timeline, 0);
    store.tick(&files, &session);
    reopen(&files, &mut session);
    let current = serde_json::to_value(&session.project).unwrap();
    let revision = store.info()["revision"].as_str().unwrap().to_owned();
    assert_eq!(
        store
            .recover(&files, &mut session, "old", "new", true)
            .unwrap_err()
            .1,
        "RECOVERY_CHANGED"
    );
    assert!(!root.join("new.vvproj").exists());
    files
        .save_detached(&session.project, "occupied.vvproj")
        .unwrap();
    let occupied = std::fs::read(root.join("occupied.vvproj")).unwrap();
    assert_eq!(
        store
            .recover(&files, &mut session, &revision, "occupied", true)
            .unwrap_err()
            .1,
        "FILE_EXISTS"
    );
    assert_eq!(
        std::fs::read(root.join("occupied.vvproj")).unwrap(),
        occupied
    );
    let mut data: Value = serde_json::from_slice(&raw(&files).unwrap().unwrap()).unwrap();
    data["project_sha256"] = json!("invalid");
    let corrupt = serde_json::to_vec(&data).unwrap();
    std::fs::write(root.join(NAME), &corrupt).unwrap();
    assert!(
        store
            .recover(&files, &mut session, &digest(&corrupt), "new", true)
            .is_err()
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), current);
    assert!(!root.join("new.vvproj").exists());
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), corrupt);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn future_and_symlink_snapshots_are_preserved_without_changing_native_saves() {
    let (files, mut session, timeline, root) = setup();
    let future = b"{\"version\":2,\"future\":true}";
    std::fs::write(root.join(NAME), future).unwrap();
    let mut store = Store::new(&files);
    assert!(store.blocked);
    add(&mut session, timeline, 0);
    store.tick(&files, &session);
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), future);
    files
        .save(&session.project, "original.vvproj", false)
        .unwrap();
    std::fs::remove_file(root.join(NAME)).unwrap();
    std::fs::write(root.join("foreign"), b"preserved").unwrap();
    std::os::unix::fs::symlink(root.join("foreign"), root.join(NAME)).unwrap();
    let mut store = Store::new(&files);
    store.tick(&files, &session);
    assert!(store.blocked);
    assert_eq!(std::fs::read(root.join("foreign")).unwrap(), b"preserved");
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
