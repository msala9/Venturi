use super::*;

fn hierarchy() -> Tree {
    let mut tree = Tree::default();
    tree.create("outer", "Outer", None).unwrap();
    tree.create("inner", "Inner", Some("outer")).unwrap();
    tree.create("deep", "Deep", Some("inner")).unwrap();
    tree.create("leaf", "Leaf", Some("deep")).unwrap();
    tree
}

#[test]
fn native_v1_folder_json_roundtrips_opaque_ids_names_and_nullable_parents() {
    let bytes = br#"{"version":1,"folders":[{"id":"root_1-abc","name":"Root","parent":null},{"id":"child","name":"Child","parent":"root_1-abc"}]}"#;
    let tree = parse(bytes).unwrap();
    assert!(tree.contains("child"));
    assert!(!tree.contains("missing"));
    assert_eq!(
        tree.path("child")
            .unwrap()
            .iter()
            .map(|folder| folder.id.as_str())
            .collect::<Vec<_>>(),
        ["root_1-abc", "child"]
    );
    assert_eq!(parse(&tree.serialize().unwrap()).unwrap(), tree);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&tree.serialize().unwrap()).unwrap(),
        serde_json::from_slice::<serde_json::Value>(bytes).unwrap()
    );
    assert_eq!(
        parse(br#"{"version":1,"folders":[]}"#).unwrap(),
        Tree::default()
    );
}

#[test]
fn create_and_rename_trim_names_allow_duplicate_names_and_report_noops() {
    let mut tree = Tree::default();
    assert!(tree.create("a", "  Shared α  ", None).unwrap());
    assert_eq!(tree.folders[0].name, "Shared α");
    assert!(!tree.create("a", "Shared α", None).unwrap());
    assert!(tree.create("b", "Shared α", None).unwrap());
    assert!(tree.create("c", "Child", Some("a")).unwrap());
    assert!(!tree.rename("c", " Child ").unwrap());
    assert!(tree.rename("c", "Shared α").unwrap());
    let before = tree.clone();
    assert_eq!(
        tree.create("a", "Different", None).unwrap_err().1,
        "FOLDER_EXISTS"
    );
    assert_eq!(tree, before);
}

#[test]
fn move_rejects_self_descendant_missing_parents_and_invalid_ids_without_mutation() {
    let mut tree = hierarchy();
    let before = tree.clone();
    for parent in [
        Some("outer"),
        Some("inner"),
        Some("leaf"),
        Some("missing"),
        Some("../bad"),
    ] {
        assert!(tree.move_folder("outer", parent).is_err());
        assert_eq!(tree, before);
    }
    assert!(!tree.move_folder("inner", Some("outer")).unwrap());
    assert!(tree.move_folder("inner", None).unwrap());
    assert_eq!(
        tree.path("leaf")
            .unwrap()
            .iter()
            .map(|folder| folder.id.as_str())
            .collect::<Vec<_>>(),
        ["inner", "deep", "leaf"]
    );
    for error in [
        tree.rename("missing", "Name").unwrap_err(),
        tree.move_folder("missing", None).unwrap_err(),
        tree.remove("missing").unwrap_err(),
        tree.path("missing").unwrap_err(),
    ] {
        assert_eq!(error.0, axum::http::StatusCode::NOT_FOUND);
    }
}

#[test]
fn removing_a_folder_reparents_only_direct_children_and_returns_the_native_asset_destination() {
    let mut tree = hierarchy();
    let removed = tree.remove("inner").unwrap();
    assert_eq!(removed.parent.as_deref(), Some("outer"));
    assert!(!tree.contains("inner"));
    assert_eq!(
        tree.folders
            .iter()
            .find(|folder| folder.id == "deep")
            .unwrap()
            .parent
            .as_deref(),
        Some("outer")
    );
    assert_eq!(
        tree.folders
            .iter()
            .find(|folder| folder.id == "leaf")
            .unwrap()
            .parent
            .as_deref(),
        Some("deep")
    );
    assert_eq!(parse(&tree.serialize().unwrap()).unwrap(), tree);
    assert_eq!(tree.remove("outer").unwrap().parent, None);
    assert_eq!(
        tree.folders
            .iter()
            .find(|folder| folder.id == "deep")
            .unwrap()
            .parent,
        None
    );
}

#[test]
fn names_and_ids_are_bounded_utf8_and_control_free_with_atomic_failures() {
    let mut tree = hierarchy();
    let before = tree.clone();
    for name in [
        "".to_owned(),
        "   ".to_owned(),
        "bad\nname".to_owned(),
        "\ttrimmed".to_owned(),
        "é".repeat(65),
    ] {
        assert!(tree.rename("outer", &name).is_err());
        assert!(tree.create("new", &name, None).is_err());
        assert_eq!(tree, before);
    }
    for id in [
        "".to_owned(),
        "a".repeat(81),
        "a/b".to_owned(),
        "native α".to_owned(),
    ] {
        assert!(tree.create(&id, "Name", None).is_err());
        assert_eq!(tree, before);
    }
    assert!(tree.rename("outer", &"é".repeat(64)).unwrap());
    assert!(
        tree.create(&"a".repeat(80), "Valid ID boundary", None)
            .unwrap()
    );
}

#[test]
fn parsed_graph_rejects_duplicates_orphans_cycles_and_unknown_json_without_repair() {
    for text in [
        r#"{"version":2,"folders":[]}"#,
        r#"{"version":1,"folders":[],"extra":true}"#,
        r#"{"version":1,"folders":[{"id":"a","name":"A","parent":null,"extra":true}]}"#,
        r#"{"version":1,"folders":[{"id":"a","name":"A","parent":"missing"}]}"#,
        r#"{"version":1,"folders":[{"id":"a","name":"A","parent":"a"}]}"#,
        r#"{"version":1,"folders":[{"id":"a","name":"A","parent":"b"},{"id":"b","name":"B","parent":"a"}]}"#,
        r#"{"version":1,"folders":[{"id":"a","name":"A","parent":null},{"id":"a","name":"Other","parent":null}]}"#,
        r#"{"version":1,"folders":[{"id":1,"name":"A","parent":null}]}"#,
    ] {
        assert!(parse(text.as_bytes()).is_err(), "{text}");
    }
    assert!(parse(&vec![b' '; MAX_BYTES + 1]).is_err());
    let mut malformed = Tree {
        version: 1,
        folders: vec![Folder {
            id: "a".into(),
            name: "A".into(),
            parent: Some("missing".into()),
        }],
    };
    let before = malformed.clone();
    assert!(malformed.rename("a", "Renamed").is_err());
    assert_eq!(malformed, before);
}

#[test]
fn depth_limit_is_checked_for_entire_moved_subtrees_before_commit() {
    let mut tree = Tree::default();
    let mut parent = None;
    for level in 1..=MAX_DEPTH {
        let id = format!("level{level}");
        tree.create(&id, "Level", parent.as_deref()).unwrap();
        parent = Some(id);
    }
    assert_eq!(
        tree.path(parent.as_deref().unwrap()).unwrap().len(),
        MAX_DEPTH
    );
    let before = tree.clone();
    assert!(
        tree.create("too-deep", "Too deep", parent.as_deref())
            .is_err()
    );
    assert_eq!(tree, before);
    tree.create("subtree", "Subtree", None).unwrap();
    tree.create("subchild", "Subchild", Some("subtree"))
        .unwrap();
    let before = tree.clone();
    assert!(tree.move_folder("subtree", parent.as_deref()).is_err());
    assert_eq!(tree, before);
    assert!(tree.move_folder("subtree", Some("level14")).unwrap());
    assert_eq!(tree.path("subchild").unwrap().len(), MAX_DEPTH);
}

#[test]
fn folder_count_boundary_preserves_last_good_tree_and_serialized_native_format() {
    let mut tree = Tree::default();
    for index in 0..MAX_FOLDERS {
        tree.create(&format!("folder{index}"), "Same name", None)
            .unwrap();
    }
    let before = tree.clone();
    assert!(tree.create("overflow", "One too many", None).is_err());
    assert_eq!(tree, before);
    let bytes = tree.serialize().unwrap();
    assert!(bytes.len() <= MAX_BYTES);
    assert_eq!(parse(&bytes).unwrap(), before);
}
