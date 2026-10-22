use super::*;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\noriginal encoded clipboard bytes";

#[test]
fn clipboard_image_automatic_names_continue_past_512_existing_images() {
    let root = Root::new();
    let folder = root.0.join(DIRECTORY);
    std::fs::create_dir(&folder).unwrap();
    for number in 1..=512 {
        std::fs::write(folder.join(format!("Image {number:03}.png")), []).unwrap();
    }
    let stage = root.stage("image/png", PNG);
    assert_eq!(stage.suggested_name().unwrap(), "Image 513");
}

struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("vv-clipboard-image-{}", crate::asset_jobs::nonce()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn stage(&self, mime: &str, bytes: &[u8]) -> Stage {
        Stage::new(
            &self.0,
            File::open(&self.0).unwrap(),
            mime,
            bytes,
            &AtomicBool::new(false),
        )
        .unwrap()
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn clipboard_image_native_formats_reject_mismatched_or_unknown_signatures() {
    for (mime, bytes, extension) in [
        ("image/png", PNG, "png"),
        ("image/jpeg", &b"\xff\xd8\xffnative"[..], "jpg"),
        ("image/webp", &b"RIFF\x10\0\0\0WEBPencoded"[..], "webp"),
        ("image/gif", &b"GIF89anative"[..], "gif"),
        ("image/bmp", &b"BMnative"[..], "bmp"),
        ("image/tiff", &b"II\x2a\0native"[..], "tif"),
    ] {
        assert_eq!(validate(mime, bytes).unwrap().extension, extension);
        assert!(validate(mime, b"different bytes").is_err());
        let root = Root::new();
        let stage = root.stage(mime, bytes);
        assert_eq!(stage.is_image(), extension != "gif");
        assert_eq!(stage.mime(), mime);
    }
    assert!(validate("image/svg+xml", b"<svg/>").is_err());
    assert!(validate("image/png", &[]).is_err());
    assert!(validate("image/webp", b"RIFFshort").is_err());
    assert!(validate("image/tiff", b"MM\0\x2anative").is_ok());
}

#[test]
fn clipboard_image_stage_preview_cancel_and_drop_never_publish() {
    let root = Root::new();
    let stage = root.stage("image/png", PNG);
    let temporary = root.0.join(STAGING_DIRECTORY).join(&stage.temporary);
    assert_eq!(std::fs::read(&temporary).unwrap(), PNG);
    stage.verify_content().unwrap();
    assert_eq!(stage.suggested_name().unwrap(), "Image 001");
    let target = stage.preview("  A pasted image  ").unwrap();
    assert_eq!(target.path_token, "Pasted Images/A pasted image.png");
    assert!(!root.0.join(DIRECTORY).exists());
    drop(stage);
    assert!(!temporary.exists());
    assert!(
        Stage::new(
            &root.0,
            File::open(&root.0).unwrap(),
            "image/png",
            PNG,
            &AtomicBool::new(true)
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read_dir(root.0.join(STAGING_DIRECTORY))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn clipboard_image_publish_preserves_bytes_native_path_fingerprint_and_collision_retry() {
    let root = Root::new();
    let mut stage = root.stage("image/png", PNG);
    std::fs::create_dir(root.0.join(DIRECTORY)).unwrap();
    let existing = root.0.join(DIRECTORY).join("Image 001.gif");
    std::fs::write(&existing, b"foreign image").unwrap();
    std::fs::write(
        root.0.join(DIRECTORY).join("Image 002.jpg"),
        b"foreign image",
    )
    .unwrap();
    assert_eq!(stage.suggested_name().unwrap(), "Image 003");
    let collision = root.0.join(DIRECTORY).join("Taken.png");
    std::fs::write(&collision, b"preserved").unwrap();
    assert_eq!(
        stage
            .publish("Taken", &AtomicBool::new(false))
            .err()
            .unwrap()
            .1,
        "IMAGE_NAME_TAKEN"
    );
    stage.validate().unwrap();
    let result = stage
        .publish("  .Native name  ", &AtomicBool::new(false))
        .unwrap();
    assert_eq!(result.path_token, "Pasted Images/.Native name.png");
    assert_eq!(std::fs::read(&result.path).unwrap(), PNG);
    assert_eq!(
        result.content_hash,
        vv_media::content_fingerprint(&result.path).unwrap()
    );
    drop(stage);
    assert_eq!(std::fs::read(&result.path).unwrap(), PNG);
    assert_eq!(std::fs::read(collision).unwrap(), b"preserved");
}

#[test]
fn clipboard_image_witness_detects_equal_size_restored_mtime_and_drop_preserves_foreign_inode() {
    let root = Root::new();
    let mut stage = root.stage("image/png", PNG);
    let path = root.0.join(STAGING_DIRECTORY).join(&stage.temporary);
    let modified = stage.file.metadata().unwrap().modified().unwrap();
    let mut changed = PNG.to_vec();
    *changed.last_mut().unwrap() = b'!';
    std::fs::write(&path, changed).unwrap();
    stage
        .file
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(stage.validate().unwrap_err().1, "SOURCE_CHANGED");
    stage.identity = crate::asset_store::stable_identity(&stage.file).unwrap();
    stage.validate().unwrap();
    assert_eq!(stage.verify_content().unwrap_err().1, "SOURCE_CHANGED");
    std::fs::remove_file(&path).unwrap();
    std::fs::write(&path, b"foreign replacement").unwrap();
    drop(stage);
    assert_eq!(std::fs::read(path).unwrap(), b"foreign replacement");
}

#[test]
fn clipboard_image_names_and_managed_directory_are_strict_without_following_links() {
    let root = Root::new();
    let mut stage = root.stage("image/png", PNG);
    for name in [
        "",
        " ",
        ".",
        "..",
        "../escape",
        "a/b",
        "a\\b",
        "a\0b",
        "line\nfeed",
    ] {
        assert!(stage.preview(name).is_err(), "{name:?}");
    }
    assert!(stage.preview(&"é".repeat(60)).is_ok());
    assert!(stage.preview(&"é".repeat(61)).is_err());
    let outside = Root::new();
    std::os::unix::fs::symlink(&outside.0, root.0.join(DIRECTORY)).unwrap();
    assert!(stage.publish("Safe", &AtomicBool::new(false)).is_err());
    assert_eq!(std::fs::read_dir(&outside.0).unwrap().count(), 0);
    stage.validate().unwrap();
}

#[test]
fn clipboard_image_replaced_project_root_is_refused_and_cancel_keeps_no_final_file() {
    let root = Root::new();
    let mut stage = root.stage("image/png", PNG);
    assert!(stage.publish("Canceled", &AtomicBool::new(true)).is_err());
    assert!(!root.0.join(DIRECTORY).exists());
    let moved = root.0.with_extension("moved");
    std::fs::rename(&root.0, &moved).unwrap();
    std::fs::create_dir(&root.0).unwrap();
    assert!(
        stage
            .publish("Wrong root", &AtomicBool::new(false))
            .is_err()
    );
    drop(stage);
    assert_eq!(
        std::fs::read_dir(moved.join(STAGING_DIRECTORY))
            .unwrap()
            .count(),
        0
    );
    std::fs::remove_dir_all(moved).unwrap();
}

#[test]
fn clipboard_image_staging_bounds_crash_orphans_and_preserves_unknown_entries() {
    let root = Root::new();
    let mut stages: Vec<_> = (0..MAX_STAGES)
        .map(|_| root.stage("image/png", PNG))
        .collect();
    assert_eq!(
        Stage::new(
            &root.0,
            File::open(&root.0).unwrap(),
            "image/png",
            PNG,
            &AtomicBool::new(false)
        )
        .err()
        .unwrap()
        .1,
        "IMAGE_CACHE_FULL"
    );
    let orphan = root.0.join(STAGING_DIRECTORY).join(&stages[0].temporary);
    std::fs::rename(&orphan, orphan.with_extension("orphan")).unwrap();
    drop(stages.remove(0));
    assert_eq!(
        Stage::new(
            &root.0,
            File::open(&root.0).unwrap(),
            "image/png",
            PNG,
            &AtomicBool::new(false)
        )
        .err()
        .unwrap()
        .1,
        "IMAGE_CACHE_FULL"
    );
    drop(stages);
    let mut replacement = root.stage("image/png", PNG);
    replacement
        .publish("Accepted", &AtomicBool::new(false))
        .unwrap();
    drop(replacement);
    let foreign = root.0.join(STAGING_DIRECTORY).join("foreign-file");
    std::fs::write(&foreign, b"preserve me").unwrap();
    assert_eq!(
        Stage::new(
            &root.0,
            File::open(&root.0).unwrap(),
            "image/png",
            PNG,
            &AtomicBool::new(false)
        )
        .err()
        .unwrap()
        .1,
        "IMAGE_CACHE_FULL"
    );
    assert_eq!(std::fs::read(foreign).unwrap(), b"preserve me");
    let orphan = orphan.with_extension("orphan");
    assert_eq!(std::fs::read(&orphan).unwrap(), PNG);
    std::fs::remove_file(root.0.join(STAGING_DIRECTORY).join("foreign-file")).unwrap();
    File::options()
        .write(true)
        .open(&orphan)
        .unwrap()
        .set_len(MAX_BYTES as u64 + 1)
        .unwrap();
    assert_eq!(
        Stage::new(
            &root.0,
            File::open(&root.0).unwrap(),
            "image/png",
            PNG,
            &AtomicBool::new(false)
        )
        .err()
        .unwrap()
        .1,
        "IMAGE_CACHE_FULL"
    );
}
