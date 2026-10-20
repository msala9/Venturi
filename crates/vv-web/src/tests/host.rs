use super::*;
fn request(
    editor: &Editor,
    operation: Operation,
    id: &str,
    timeline: Option<vv_core::TimelineId>,
) -> Mutation {
    Mutation {
        command_id: id.into(),
        client_id: "test-client".into(),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        if_revision: timeline.map(|id| editor.session.timeline_revision(id)),
        operation,
    }
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
