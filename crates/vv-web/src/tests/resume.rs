use super::*;
use std::path::PathBuf;
fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "vv-web-resume-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn last_saved_project_reopens_after_restart_with_a_fresh_validated_file_baseline() {
    let root = root();
    let files = Files::new(&root).unwrap();
    assert!(restore(&files).unwrap().is_none());
    files
        .save(&vv_core::Project::default(), "last.vvproj", true)
        .unwrap();
    remember(&files, "last.vvproj").unwrap();
    let bytes = std::fs::read(root.join(NAME)).unwrap();
    remember(&files, "last.vvproj").unwrap();
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), bytes);
    drop(files);
    let files = Files::new(&root).unwrap();
    let (project, name) = restore(&files).unwrap().unwrap();
    assert_eq!(name, "last.vvproj");
    files.save(&project, &name, false).unwrap();
    remember(&files, &name).unwrap();
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_or_missing_previous_projects_require_an_explicit_open_without_touching_metadata() {
    let root = root();
    let files = Files::new(&root).unwrap();
    files
        .save(&vv_core::Project::default(), "last.vvproj", true)
        .unwrap();
    remember(&files, "last.vvproj").unwrap();
    let journal = std::fs::read(root.join(NAME)).unwrap();
    let mut external = std::fs::read(root.join("last.vvproj")).unwrap();
    external.extend_from_slice(b"\n// external save\n");
    std::fs::write(root.join("last.vvproj"), &external).unwrap();
    assert_eq!(restore(&files).unwrap_err().1, "SAVE_CONFLICT");
    assert_eq!(std::fs::read(root.join("last.vvproj")).unwrap(), external);
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), journal);
    files.load("last.vvproj").unwrap();
    remember(&files, "last.vvproj").unwrap();
    assert!(restore(&files).unwrap().is_some());
    std::fs::remove_file(root.join("last.vvproj")).unwrap();
    assert!(restore(&files).is_err());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn unknown_or_linked_resume_metadata_is_preserved_and_never_blocks_project_saves() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let future = b"{\"version\":2,\"future\":true}";
    std::fs::write(root.join(NAME), future).unwrap();
    assert!(restore(&files).is_err());
    files
        .save(&vv_core::Project::default(), "new.vvproj", true)
        .unwrap();
    assert!(remember(&files, "new.vvproj").is_err());
    assert_eq!(std::fs::read(root.join(NAME)).unwrap(), future);
    std::fs::remove_file(root.join(NAME)).unwrap();
    std::fs::write(root.join("foreign"), b"preserved").unwrap();
    std::os::unix::fs::symlink(root.join("foreign"), root.join(NAME)).unwrap();
    assert!(restore(&files).is_err());
    assert!(remember(&files, "new.vvproj").is_err());
    assert_eq!(std::fs::read(root.join("foreign")).unwrap(), b"preserved");
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
