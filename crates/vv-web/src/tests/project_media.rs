use super::*;
use std::{
    fs::File,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

struct Fixture {
    root: PathBuf,
    jobs: crate::asset_jobs::Jobs,
    session: Session,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("vv-project-media-{}", crate::asset_jobs::nonce()));
        std::fs::create_dir_all(&root).unwrap();
        let store = crate::asset_store::Store::new(&root.join(".library")).unwrap();
        let jobs = crate::asset_jobs::Jobs::new(store, &root, File::open(&root).unwrap()).unwrap();
        let mut session = Session::default();
        session.set_path(Some(root.join("project.vvproj")));
        Self {
            root,
            jobs,
            session,
        }
    }
    fn prepare(&self, work: Work) -> Value {
        let value = self
            .jobs
            .prepare_project_media(
                "epoch",
                &self.session.history.generation().to_string(),
                work,
            )
            .unwrap();
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            let status = self
                .jobs
                .status(value["id"].as_str().unwrap(), "epoch", false)
                .unwrap();
            if !matches!(status["state"].as_str(), Some("queued" | "running")) {
                assert_eq!(status["state"], "ready", "{status}");
                return status;
            }
            assert!(Instant::now() < end, "{status}");
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    fn apply(&mut self, ready: &Value, kind: &str) -> Result<Value> {
        let generation = self.session.history.generation().to_string();
        commit(
            &mut self.session,
            &self.jobs,
            ready["id"].as_str().unwrap(),
            "epoch",
            &generation,
            kind,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn wave(path: &Path) {
    let mut bytes = Vec::new();
    bytes.extend(b"RIFF");
    bytes.extend(1636u32.to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(8000u32.to_le_bytes());
    bytes.extend(16000u32.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(16u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(1600u32.to_le_bytes());
    bytes.resize(1644, 0);
    std::fs::write(path, bytes).unwrap();
}
fn tree_work(f: &Fixture, token: &str, parent: Option<String>) -> Work {
    import_work(
        &f.session,
        &ImportRequest::Tree {
            project_epoch: "epoch".into(),
            if_generation: f.session.history.generation().to_string(),
            directory_token: token.into(),
            parent,
        },
    )
    .unwrap()
}

#[test]
fn project_tree_import_preserves_native_folder_merge_probe_failure_order_and_one_undo() {
    let mut f = Fixture::new();
    std::fs::create_dir_all(f.root.join("Shots/Sub")).unwrap();
    std::fs::create_dir_all(f.root.join("Shots/Empty")).unwrap();
    wave(&f.root.join("Shots/a.wav"));
    wave(&f.root.join("Shots/Sub/b.wav"));
    std::fs::write(f.root.join("Shots/Sub/bad.wav"), b"invalid").unwrap();
    let before = f.session.history.position();
    let ready = f.prepare(tree_work(&f, "Shots", None));
    assert_eq!(f.session.history.position(), before);
    assert_eq!(ready["result"]["folders"].as_array().unwrap().len(), 2);
    assert_eq!(ready["result"]["errors"].as_array().unwrap().len(), 1);
    let report = f.apply(&ready, "project_import").unwrap();
    assert_eq!(report["media_ids"].as_array().unwrap().len(), 2);
    assert_eq!(report["new_count"], 2);
    assert_eq!(f.session.history.position(), before + 1);
    let after = serde_json::to_value(&f.session.project).unwrap();
    f.session.history.undo(&mut f.session.project);
    assert!(f.session.project.media_pool.is_empty());
    assert!(f.session.project.folders.is_empty());
    f.session.history.redo(&mut f.session.project);
    assert_eq!(serde_json::to_value(&f.session.project).unwrap(), after);
    let ready = f.prepare(tree_work(&f, "Shots", None));
    let position = f.session.history.position();
    let report = f.apply(&ready, "project_import").unwrap();
    assert_eq!(report["new_count"], 0);
    assert_eq!(report["reused_count"], 2);
    assert_eq!(report["changed"], false);
    assert_eq!(f.session.history.position(), position);
    std::fs::create_dir(f.root.join("Failed")).unwrap();
    std::fs::write(f.root.join("Failed/bad.wav"), b"bad").unwrap();
    let ready = f.prepare(tree_work(&f, "Failed", None));
    let report = f.apply(&ready, "project_import").unwrap();
    assert!(report["media_ids"].as_array().unwrap().is_empty());
    assert_eq!(report["folder_ids"].as_array().unwrap().len(), 1);
    assert_eq!(
        report["changed"], true,
        "Native import creates folders before file probe outcomes"
    );
}

#[test]
fn project_import_witnesses_missing_files_cancel_context_and_nested_parent_changes_atomically() {
    let mut f = Fixture::new();
    std::fs::create_dir_all(f.root.join("Nested")).unwrap();
    wave(&f.root.join("Nested/a.wav"));
    let make = |f: &Fixture| {
        import_work(
            &f.session,
            &ImportRequest::Files {
                project_epoch: "epoch".into(),
                if_generation: "0".into(),
                path_tokens: vec!["Nested/a.wav".into(), "Nested/missing.wav".into()],
                parent: None,
            },
        )
        .unwrap()
    };
    let ready = f.prepare(make(&f));
    assert_eq!(ready["result"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(ready["result"]["errors"].as_array().unwrap().len(), 1);
    wave(&f.root.join("Nested/missing.wav"));
    let before = serde_json::to_value(&f.session.project).unwrap();
    assert_eq!(
        f.apply(&ready, "project_import").unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(serde_json::to_value(&f.session.project).unwrap(), before);
    let ready = f.prepare(make(&f));
    f.jobs
        .status(ready["id"].as_str().unwrap(), "epoch", true)
        .unwrap();
    assert!(f.apply(&ready, "project_import").is_err());
    let ready = f.prepare(make(&f));
    assert_eq!(
        f.jobs
            .project_media_payload(
                ready["id"].as_str().unwrap(),
                "epoch",
                "999",
                "project_import"
            )
            .err()
            .unwrap()
            .1,
        "ASSET_CONTEXT_CHANGED"
    );
    std::fs::rename(f.root.join("Nested"), f.root.join("Moved")).unwrap();
    std::os::unix::fs::symlink(f.root.join("Moved"), f.root.join("Nested")).unwrap();
    assert!(f.apply(&ready, "project_import").is_err());
    assert_eq!(serde_json::to_value(&f.session.project).unwrap(), before);
}

#[test]
fn prepared_relink_uses_nearest_exact_basename_skips_online_and_rechecks_absence_and_empty_branches()
 {
    let mut f = Fixture::new();
    for dir in ["Old", "Repair/Deep", "Repair/Empty"] {
        std::fs::create_dir_all(f.root.join(dir)).unwrap();
    }
    wave(&f.root.join("Old/a.wav"));
    wave(&f.root.join("Old/b.wav"));
    let work = import_work(
        &f.session,
        &ImportRequest::Files {
            project_epoch: "epoch".into(),
            if_generation: "0".into(),
            path_tokens: vec!["Old/a.wav".into(), "Old/b.wav".into()],
            parent: None,
        },
    )
    .unwrap();
    let ready = f.prepare(work);
    let imported = f.apply(&ready, "project_import").unwrap();
    let ids: Vec<String> = serde_json::from_value(imported["media_ids"].clone()).unwrap();
    std::fs::rename(f.root.join("Old/a.wav"), f.root.join("Repair/Deep/a.wav")).unwrap();
    let action = RelinkAction::ByName {
        directory_token: "Repair".into(),
        scope: RelinkScope::Selected {
            media_ids: ids.clone(),
        },
    };
    let ready = f.prepare(relink_work(&f.session, &action).unwrap());
    assert_eq!(
        ready["result"]["items"][0]["path_token"],
        "Repair/Deep/a.wav"
    );
    assert_eq!(ready["result"]["skipped"], json!([ids[1]]));
    std::fs::write(f.root.join("Repair/Empty/new.txt"), b"non-media candidate").unwrap();
    let before = serde_json::to_value(&f.session.project).unwrap();
    assert_eq!(
        f.apply(&ready, "project_relink").unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(serde_json::to_value(&f.session.project).unwrap(), before);
    let ready = f.prepare(relink_work(&f.session, &action).unwrap());
    wave(&f.root.join("Old/a.wav"));
    assert_eq!(
        f.apply(&ready, "project_relink").unwrap_err().1,
        "SOURCE_CHANGED"
    );
    std::fs::remove_file(f.root.join("Old/a.wav")).unwrap();
    wave(&f.root.join("Repair/a.wav"));
    let ready = f.prepare(relink_work(&f.session, &action).unwrap());
    assert_eq!(ready["result"]["items"][0]["path_token"], "Repair/a.wav");
    let position = f.session.history.position();
    let report = f.apply(&ready, "project_relink").unwrap();
    assert_eq!(report["relinked_media_ids"], json!([ids[0]]));
    assert_eq!(f.session.history.position(), position + 1);
    f.session.history.undo(&mut f.session.project);
    assert_eq!(serde_json::to_value(&f.session.project).unwrap(), before);
    f.session.history.redo(&mut f.session.project);
    let id = MediaId::from_raw(ids[0].parse().unwrap());
    assert_eq!(
        f.session.project.media_pool[id].path,
        f.root.join("Repair/a.wav")
    );
}

#[test]
fn project_media_dtos_and_preflight_refuse_ambiguous_shapes_paths_duplicate_ids_and_wrong_jobs() {
    for value in [
        json!({"project_epoch":"e","if_generation":"0","path_tokens":["a.wav"],"directory_token":"Tree"}),
        json!({"project_epoch":"e","if_generation":"0","directory_token":"Tree","force":true}),
    ] {
        assert!(serde_json::from_value::<ImportRequest>(value).is_err());
    }
    let mut f = Fixture::new();
    wave(&f.root.join("a.wav"));
    for token in ["", "../a.wav", ".hidden/a.wav"] {
        assert!(
            import_work(
                &f.session,
                &ImportRequest::Tree {
                    project_epoch: "e".into(),
                    if_generation: "0".into(),
                    directory_token: token.into(),
                    parent: None
                }
            )
            .is_err()
        );
    }
    let request = ImportRequest::Files {
        project_epoch: "e".into(),
        if_generation: "0".into(),
        path_tokens: vec!["a.wav".into(), "a.wav".into()],
        parent: None,
    };
    let ready = f.prepare(import_work(&f.session, &request).unwrap());
    assert_eq!(ready["progress"]["total"], 1);
    assert_eq!(
        f.apply(&ready, "project_relink").unwrap_err().1,
        "ASSET_NOT_READY"
    );
    assert!(f.session.project.media_pool.is_empty());
    let imported = f.apply(&ready, "project_import").unwrap();
    let raw = imported["media_ids"][0].as_str().unwrap();
    for ids in [
        vec![raw.to_owned(), raw.to_owned()],
        vec![format!("0{raw}")],
    ] {
        assert!(
            relink_work(
                &f.session,
                &RelinkAction::ByName {
                    directory_token: "Tree".into(),
                    scope: RelinkScope::Selected { media_ids: ids }
                }
            )
            .is_err()
        );
    }
}
