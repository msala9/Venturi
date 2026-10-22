use super::*;

fn root() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vv-approved-sources-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}
fn query(token: &str, page: usize) -> SourcesQuery {
    SourcesQuery {
        project_epoch: "epoch".into(),
        directory_token: token.into(),
        page,
    }
}
fn browse(root: &Path, dir: &File, token: &str, page: usize) -> Value {
    SourceBrowserTask::new(root, dir, query(token, page))
        .unwrap()
        .run()
        .unwrap()
}

#[test]
fn approved_source_tokens_are_exact_bounded_and_preserve_native_managed_image_names() {
    for token in [
        "clip.mov",
        "approved folder/subfolder/media.wav",
        "Pasted Images/.Native name.png",
    ] {
        assert!(validate_media_token(token).is_ok(), "{token}");
    }
    for token in [
        "",
        "/a.wav",
        "a//b.wav",
        "a/./b.wav",
        "a/../b.wav",
        "../a.wav",
        "a\\b.wav",
        ".secret/a.wav",
        "a/.secret/b.wav",
        "a\n/b.wav",
        "Pasted Images/sub/a.png",
        "Pasted Images/a.mp4",
        "Pasted Images/a.PNG",
    ] {
        assert!(validate_media_token(token).is_err(), "{token:?}");
    }
    assert!(parts("", true).is_ok());
    let deepest = format!("{}/file.wav", vec!["folder"; 16].join("/"));
    assert!(validate_media_token(&deepest).is_ok());
    assert!(validate_media_token(&format!("extra/{deepest}")).is_err());
    assert!(parts(&vec!["a"; 17].join("/"), true).is_err());
    assert!(validate_media_token(&format!("{}.wav", "x".repeat(129))).is_err());
    assert!(
        parts(&vec!["é".repeat(64); 9].join("/"), true).is_err(),
        "Count UTF-8 bytes, not characters"
    );
    assert!(
        serde_json::from_value::<SourcesQuery>(json!({"project_epoch":"e","unexpected":1}))
            .is_err()
    );
    assert!(
        serde_json::from_value::<SourcesQuery>(json!({"project_epoch":"e","page":-1})).is_err()
    );
    let default: SourcesQuery = serde_json::from_value(json!({"project_epoch":"e"})).unwrap();
    assert!(default.directory_token.is_empty());
    assert_eq!(default.page, 0);
}

#[test]
fn approved_source_browser_pages_exact_sorted_entries_without_exposing_hidden_links_or_special_files()
 {
    let root = root();
    let dir = File::open(&root).unwrap();
    std::fs::create_dir(root.join("Folder")).unwrap();
    std::fs::create_dir(root.join(".private")).unwrap();
    for n in (0..35).rev() {
        std::fs::write(root.join(format!("clip-{n:02}.wav")), b"not probed").unwrap();
    }
    std::fs::write(root.join("project.vvproj"), b"not media").unwrap();
    std::fs::write(root.join(".hidden.wav"), b"private").unwrap();
    std::os::unix::fs::symlink(root.join("clip-00.wav"), root.join("link.wav")).unwrap();
    let _socket = std::os::unix::net::UnixListener::bind(root.join("special.wav")).unwrap();
    let page = browse(&root, &dir, "", 0);
    assert_eq!(page["project_epoch"], "epoch");
    assert_eq!(page["directory_token"], "");
    assert!(page["parent_token"].is_null());
    assert_eq!(page["pages"], 2);
    assert_eq!(page["entries"].as_array().unwrap().len(), 32);
    assert_eq!(
        page["entries"][0],
        json!({"kind":"directory","name":"Folder","path_token":"Folder"})
    );
    let last = browse(&root, &dir, "", 1);
    assert_eq!(last["entries"].as_array().unwrap().len(), 4);
    assert_eq!(last["entries"][3]["path_token"], "clip-34.wav");
    let child = browse(&root, &dir, "Folder", 0);
    assert_eq!(child["parent_token"], "");
    assert_eq!(child["pages"], 1);
    assert!(child["entries"].as_array().unwrap().is_empty());
    assert!(
        SourceBrowserTask::new(&root, &dir, query("", 2))
            .unwrap()
            .run()
            .is_err()
    );
    assert!(
        SourceBrowserTask::new(&root, &dir, query("missing", 0))
            .unwrap()
            .run()
            .is_err()
    );
    assert!(SourceBrowserTask::new(&root, &dir, query("Folder/../", 0)).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn approved_source_resolver_pins_every_parent_and_tracks_missing_parent_creation_without_following_links()
 {
    let root = root();
    let dir = File::open(&root).unwrap();
    let token = "approved/nested/clip.wav";
    let (missing, before_parent) = source_entry(&root, &dir, token).unwrap();
    assert!(missing.is_none());
    std::fs::create_dir_all(root.join("approved/nested")).unwrap();
    let (missing, parent) = source_entry(&root, &dir, token).unwrap();
    assert!(missing.is_none());
    assert_ne!(parent, before_parent);
    std::fs::write(root.join(token), b"native source").unwrap();
    let file = open_approved_media(&root, &dir, token).unwrap();
    validate_approved_file(&root, &dir, token, &file).unwrap();
    std::fs::rename(root.join("approved"), root.join("old")).unwrap();
    std::os::unix::fs::symlink(root.join("old"), root.join("approved")).unwrap();
    assert!(open_approved_media(&root, &dir, token).is_err());
    assert!(source_entry(&root, &dir, token).is_err());
    assert!(validate_approved_file(&root, &dir, token, &file).is_err());
    std::fs::remove_file(root.join("approved")).unwrap();
    std::fs::rename(root.join("old"), root.join("approved")).unwrap();
    std::fs::remove_file(root.join(token)).unwrap();
    std::os::unix::fs::symlink(root.join("approved"), root.join(token)).unwrap();
    assert!(source_entry(&root, &dir, token).is_err());
    assert!(open_approved_media(&root, &dir, token).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn approved_source_tree_matches_native_sorted_pruning_and_witnesses_pruned_directories_and_media_versions()
 {
    let root = root();
    let dir = File::open(&root).unwrap();
    for folder in ["Shots/empty", "Shots/group/deep", "Shots/.hidden"] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
    }
    for token in ["Shots/a.wav", "Shots/group/deep/a.mov", "Shots/z.avi"] {
        std::fs::write(root.join(token), b"unprobed").unwrap();
    }
    std::fs::write(root.join("Shots/empty/readme.txt"), b"ignored").unwrap();
    std::fs::write(root.join("Shots/.hidden/private.wav"), b"ignored").unwrap();
    let cancel = AtomicBool::new(false);
    let scanned = scan_media_tree(&root, &dir, "Shots", &cancel).unwrap();
    assert_eq!(
        scanned.tree,
        vv_session::MediaTree::scan(&[root.join("Shots")])
    );
    assert_eq!(
        scanned.tree.folders,
        vec![
            ("Shots".into(), None),
            ("group".into(), Some(0)),
            ("deep".into(), Some(1))
        ]
    );
    // Unrelated project receipts must not invalidate the chosen subtree.
    std::fs::write(root.join("receipt.json"), b"unrelated").unwrap();
    scanned.witness.validate(&root, &dir, &cancel).unwrap();
    std::fs::write(root.join("Shots/empty/now.wav"), b"new source").unwrap();
    assert!(scanned.witness.validate(&root, &dir, &cancel).is_err());
    let fresh = scan_media_tree(&root, &dir, "Shots", &cancel).unwrap();
    let path = root.join("Shots/a.wav");
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    std::fs::write(&path, b"replaced").unwrap();
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(fresh.witness.validate(&root, &dir, &cancel).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn approved_source_scan_limits_cancel_and_refuses_links_instead_of_returning_a_partial_tree() {
    for scenario in 0..5 {
        let root = root();
        let dir = File::open(&root).unwrap();
        std::fs::create_dir(root.join("Sources")).unwrap();
        let cancel = AtomicBool::new(false);
        match scenario {
            0 => {
                for n in 0..65 {
                    std::fs::write(root.join(format!("Sources/{n}.wav")), b"x").unwrap();
                }
            }
            1 => {
                for n in 0..128 {
                    std::fs::create_dir(root.join(format!("Sources/{n}"))).unwrap();
                }
            }
            2 => {
                std::fs::create_dir_all(
                    root.join(format!("Sources/{}", vec!["deep"; 16].join("/"))),
                )
                .unwrap();
            }
            3 => {
                cancel.store(true, Ordering::Relaxed);
            }
            _ => {
                std::os::unix::fs::symlink(&root, root.join("Sources/link")).unwrap();
            }
        }
        assert!(
            scan_media_tree(&root, &dir, "Sources", &cancel).is_err(),
            "scenario {scenario}"
        );
        assert!(scan_media_tree(&root, &dir, "", &cancel).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn source_browser_and_scanner_count_hidden_raw_entries_toward_the_directory_budget() {
    let root = root();
    let dir = File::open(&root).unwrap();
    std::fs::create_dir(root.join("Sources")).unwrap();
    for n in 0..4097 {
        std::fs::write(root.join(format!("Sources/.entry-{n}")), b"").unwrap();
    }
    assert!(
        SourceBrowserTask::new(&root, &dir, query("Sources", 0))
            .unwrap()
            .run()
            .is_err()
    );
    assert!(scan_media_tree(&root, &dir, "Sources", &AtomicBool::new(false)).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
