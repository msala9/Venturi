use super::*;

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
