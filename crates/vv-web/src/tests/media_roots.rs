use super::*;
use std::io::{Read, Seek, SeekFrom, Write};

struct Fixture {
    base: PathBuf,
    project: PathBuf,
    shared: PathBuf,
    roots: MediaRoots,
}
impl Fixture {
    fn new() -> Self {
        let base =
            std::env::temp_dir().join(format!("vv-media-roots-{}", crate::asset_jobs::nonce()));
        let project = base.join("project");
        let shared = base.join("archive");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir(&shared).unwrap();
        let roots = MediaRoots::new(&project, File::open(&project).unwrap()).unwrap();
        Self {
            base,
            project,
            shared,
            roots,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.base).unwrap();
    }
}
fn bytes(mut file: File) -> Vec<u8> {
    let mut value = Vec::new();
    file.read_to_end(&mut value).unwrap();
    value
}

#[test]
fn media_roots_shared_tokens_are_exact_read_only_and_do_not_change_project_authority() {
    let f = Fixture::new();
    std::fs::create_dir(f.shared.join("2026-10")).unwrap();
    let path = f.shared.join("2026-10/item.mp4");
    std::fs::write(&path, b"shared bytes").unwrap();
    std::fs::write(f.project.join("item.mp4"), b"project bytes").unwrap();
    assert!(f.roots.open(&path).is_err());
    assert!(f.roots.path("library://2026-10/item.mp4").is_err());
    let roots = f.roots.with_shared(&f.shared).unwrap();
    assert_eq!(roots.shared_path(), Some(f.shared.as_path()));
    assert_eq!(roots.token(&path).unwrap(), "library://2026-10/item.mp4");
    assert_eq!(roots.path("library://2026-10/item.mp4").unwrap(), path);
    let versioned = format!("library://2026-10/item.mp4?source={}", "a1".repeat(32));
    assert_eq!(roots.path(&versioned).unwrap(), path);
    assert_eq!(
        roots.token(&roots.path(&versioned).unwrap()).unwrap(),
        "library://2026-10/item.mp4"
    );
    for suffix in [
        String::new(),
        "abc".into(),
        "A".repeat(64),
        "g".repeat(64),
        format!("{}?source={}", "a".repeat(64), "b".repeat(64)),
    ] {
        assert!(
            roots
                .path(&format!("library://2026-10/item.mp4?source={suffix}"))
                .is_err()
        );
    }
    assert_eq!(
        roots.token(&f.project.join("item.mp4")).unwrap(),
        "item.mp4"
    );
    assert_eq!(roots.path("item.mp4").unwrap(), f.project.join("item.mp4"));
    assert_eq!(bytes(roots.clone().open(&path).unwrap()), b"shared bytes");
    assert_eq!(
        bytes(roots.open(&f.project.join("item.mp4")).unwrap()),
        b"project bytes"
    );
    let read_only = roots.open(&path).unwrap();
    assert!((&read_only).write_all(b"refused").is_err());
    assert_eq!(std::fs::read_dir(&f.shared).unwrap().count(), 1);
    assert!(roots.with_shared(&f.base.join("absent")).is_err());
    assert!(!f.base.join("absent").exists());
    assert!(roots.with_shared(Path::new("relative")).is_err());
    assert!(MediaRoots::new(&f.project, File::open(&f.shared).unwrap()).is_err());
    let overlapping = roots.with_shared(&f.project).unwrap();
    assert_eq!(
        overlapping.token(&f.project.join("item.mp4")).unwrap(),
        "item.mp4"
    );
}

#[test]
fn media_roots_refuse_traversal_aliases_links_and_special_sources_without_scanning() {
    let f = Fixture::new();
    std::fs::write(f.shared.join("real.mp4"), b"original").unwrap();
    std::os::unix::fs::symlink(f.shared.join("real.mp4"), f.shared.join("link.mp4")).unwrap();
    std::os::unix::fs::symlink(&f.shared, f.shared.join("linked")).unwrap();
    std::os::unix::fs::symlink(&f.shared, f.base.join("root-link")).unwrap();
    rustix::fs::mknodat(
        rustix::fs::CWD,
        f.shared.join("fifo.mp4"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
    let roots = f.roots.with_shared(&f.shared).unwrap();
    for token in [
        "library://",
        "library:///real.mp4",
        "library://../real.mp4",
        "library://sub/../real.mp4",
        "library://sub//real.mp4",
        "library://.private/real.mp4",
        "library://sub\\real.mp4",
        "../archive/real.mp4",
    ] {
        assert!(roots.path(token).is_err(), "{token}");
    }
    for token in [
        "library://link.mp4",
        "library://linked/real.mp4",
        "library://fifo.mp4",
    ] {
        let path = roots.path(token).unwrap();
        assert!(roots.open(&path).is_err(), "{token}");
        assert!(roots.entry(&path).is_err(), "{token}");
    }
    assert!(roots.with_shared(&f.base.join("root-link")).is_err());
    assert!(roots.token(&f.base.join("unapproved.mp4")).is_err());
}

#[test]
fn media_roots_witness_missing_entries_parent_replacement_and_restored_mtime_changes() {
    let f = Fixture::new();
    let roots = f.roots.with_shared(&f.shared).unwrap();
    let path = f.shared.join("month/item.wav");
    let missing = roots.entry(&path).unwrap();
    assert!(missing.0.is_none());
    std::fs::create_dir(f.shared.join("month")).unwrap();
    std::fs::write(&path, b"original").unwrap();
    let before = roots.entry(&path).unwrap();
    assert!(before.0.is_some());
    assert_ne!(missing.1, before.1);
    let file = roots.open(&path).unwrap();
    roots.validate_file(&path, &file).unwrap();
    std::fs::create_dir(f.shared.join("replacement")).unwrap();
    std::fs::hard_link(&path, f.shared.join("replacement/item.wav")).unwrap();
    let lineage = roots.entry(&path).unwrap().1;
    std::fs::rename(f.shared.join("month"), f.shared.join("old-month")).unwrap();
    std::fs::rename(f.shared.join("replacement"), f.shared.join("month")).unwrap();
    assert_ne!(roots.entry(&path).unwrap().1, lineage);
    let mut writer = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    let stamp = writer.metadata().unwrap().modified().unwrap();
    let identity = crate::asset_store::stable_identity(&file).unwrap();
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"modified").unwrap();
    writer
        .set_times(std::fs::FileTimes::new().set_modified(stamp))
        .unwrap();
    drop(writer);
    assert_ne!(
        crate::asset_store::stable_identity(&file).unwrap(),
        identity
    );
    std::fs::rename(&path, f.shared.join("old.wav")).unwrap();
    std::fs::write(&path, b"modified").unwrap();
    assert!(roots.validate_file(&path, &file).is_err());
    std::fs::rename(&f.shared, f.base.join("old-archive")).unwrap();
    std::fs::create_dir(&f.shared).unwrap();
    assert!(roots.entry(&f.shared.join("another.wav")).is_err());
}
