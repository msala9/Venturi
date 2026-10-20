use super::*;
use std::path::PathBuf;

fn setup() -> (Files, Session, String, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "vv-web-reviewmeta-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    let mut session = Session::default();
    session.create_timeline(core::Timeline {
        name: "Review".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    vv_media::audio_file::write_audio_file(
        &root.join("take.wav"),
        vv_media::audio_file::AudioFileFormat::Wav,
        &vec![0.125; 4800],
        48000,
        1,
    )
    .unwrap();
    let (path, meta) = files.probe("take.wav").unwrap();
    let id = session.add_media(path, meta).raw().to_string();
    session.save_to(&root.join("review.vvproj")).unwrap();
    (files, session, id, root)
}
fn change(files: &Files, session: &Session, edit: Edit) -> Value {
    let state = read(files, session).unwrap();
    crate::reviewmeta::edit(
        files,
        session,
        state["project_token"].as_str().unwrap(),
        state["revision"].as_str().unwrap(),
        &edit,
    )
    .unwrap();
    read(files, session).unwrap()
}
fn take(id: &str) -> Edit {
    Edit::SetTake {
        media_id: id.into(),
        shot_id: Some("shot-1".into()),
        label: "Take B".into(),
        rating: Rating::Favorite,
        metadata: Some(Known {
            model: Some("Known model".into()),
            prompt: Some("<tag>source text</tag>\nsecond line".into()),
            seed: Some(u64::MAX.to_string()),
        }),
        rebind_source: false,
    }
}

#[test]
fn review_annotations_persist_exact_seed_and_restore_without_changing_project_history_or_sources() {
    let (files, session, id, root) = setup();
    let project = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let bytes = std::fs::read(root.join("take.wav")).unwrap();
    let empty = read(&files, &session).unwrap();
    assert_eq!(empty["revision"], "absent");
    change(
        &files,
        &session,
        Edit::NewShot {
            id: "shot-1".into(),
            name: "Arrival".into(),
        },
    );
    let saved = change(&files, &session, take(&id));
    assert_eq!(saved["items"][0]["metadata"]["seed"], u64::MAX.to_string());
    assert_eq!(saved["items"][0]["rating"], "favorite");
    assert!(saved["can_restore_previous"].as_bool().unwrap());
    let old = change(&files, &session, Edit::RestorePrevious);
    assert_eq!(old["items"][0]["rating"], "unrated");
    let restored = change(&files, &session, Edit::RestorePrevious);
    assert_eq!(restored["items"], saved["items"]);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), project);
    assert_eq!(session.history.position(), position);
    assert!(!session.has_unsaved_changes());
    assert_eq!(std::fs::read(root.join("take.wav")).unwrap(), bytes);
    drop(files);
    let files = Files::new(&root).unwrap();
    assert_eq!(read(&files, &session).unwrap()["items"], saved["items"]);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_revision_changed_sources_invalid_seed_and_unknown_schema_are_preserved_without_partial_writes()
 {
    let (files, session, id, root) = setup();
    change(
        &files,
        &session,
        Edit::NewShot {
            id: "shot-1".into(),
            name: "Arrival".into(),
        },
    );
    let state = change(&files, &session, take(&id));
    let path = root.join("review.vvproj.review.json");
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(
        edit(&files, &session, "review.vvproj", "absent", &take(&id))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let mut invalid = take(&id);
    if let Edit::SetTake {
        metadata: Some(meta),
        ..
    } = &mut invalid
    {
        meta.seed = Some("18446744073709551616".into());
    }
    assert!(
        edit(
            &files,
            &session,
            "review.vvproj",
            state["revision"].as_str().unwrap(),
            &invalid
        )
        .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(root.join("take.wav"))
        .unwrap()
        .write_all(&[0])
        .unwrap();
    let state = read(&files, &session).unwrap();
    assert_eq!(state["items"][0]["stale_source"], true);
    assert_eq!(
        edit(
            &files,
            &session,
            "review.vvproj",
            state["revision"].as_str().unwrap(),
            &take(&id)
        )
        .unwrap_err()
        .1,
        "SOURCE_CHANGED"
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let mut rebound = take(&id);
    if let Edit::SetTake { rebind_source, .. } = &mut rebound {
        *rebind_source = true;
    }
    let state = change(&files, &session, rebound);
    assert_eq!(state["items"][0]["stale_source"], false);
    std::fs::write(&path, b"{\"version\":2,\"future\":true}").unwrap();
    assert!(read(&files, &session).is_err());
    assert!(
        edit(
            &files,
            &session,
            "review.vvproj",
            "absent",
            &Edit::NewShot {
                id: "new".into(),
                name: "New".into()
            }
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        b"{\"version\":2,\"future\":true}"
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn save_as_copy_is_independent_and_rolls_back_only_its_own_reserved_sidecar() {
    let (files, mut session, id, root) = setup();
    change(
        &files,
        &session,
        Edit::NewShot {
            id: "shot-1".into(),
            name: "Arrival".into(),
        },
    );
    let original = change(&files, &session, take(&id));
    {
        let _reserved = reserve_copy(&files, Some("review.vvproj"), "failed.vvproj").unwrap();
        assert!(root.join("failed.vvproj.review.json").is_file());
    }
    assert!(!root.join("failed.vvproj.review.json").exists());
    let reserved = reserve_copy(&files, Some("review.vvproj"), "copy.vvproj").unwrap();
    files.save(&session.project, "copy.vvproj", true).unwrap();
    reserved.commit();
    session.set_path(Some(files.path("copy.vvproj").unwrap()));
    assert_eq!(read(&files, &session).unwrap()["items"], original["items"]);
    change(
        &files,
        &session,
        Edit::RenameShot {
            id: "shot-1".into(),
            name: "Copy only".into(),
        },
    );
    session.set_path(Some(files.path("review.vvproj").unwrap()));
    assert_eq!(
        read(&files, &session).unwrap()["shots"]["shot-1"],
        "Arrival"
    );
    assert!(reserve_copy(&files, None, "copy.vvproj").is_err());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn sidecar_symlinks_are_refused_and_removed_native_media_leave_visible_orphaned_annotations() {
    let (files, mut session, id, root) = setup();
    std::fs::write(root.join("foreign.txt"), b"preserve").unwrap();
    std::os::unix::fs::symlink(
        root.join("foreign.txt"),
        root.join("review.vvproj.review.json"),
    )
    .unwrap();
    assert!(read(&files, &session).is_err());
    assert!(reserve_copy(&files, None, "review.vvproj").is_err());
    assert_eq!(
        std::fs::read(root.join("foreign.txt")).unwrap(),
        b"preserve"
    );
    std::fs::remove_file(root.join("review.vvproj.review.json")).unwrap();
    change(
        &files,
        &session,
        Edit::NewShot {
            id: "shot-1".into(),
            name: "Arrival".into(),
        },
    );
    change(&files, &session, take(&id));
    session
        .project
        .media_pool
        .remove(core::MediaId::from_raw(id.parse().unwrap()));
    let state = read(&files, &session).unwrap();
    assert!(state["items"].as_array().unwrap().is_empty());
    assert_eq!(state["orphans"][0]["media_id"], id);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
