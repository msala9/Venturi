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
    std::fs::remove_dir_all(root).unwrap();
}
