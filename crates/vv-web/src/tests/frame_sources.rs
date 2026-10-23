use super::*;
use std::io::{Read, Seek, SeekFrom, Write};
use vv_core::Id;

struct Fixture {
    files: Files,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("vv-frame-sources-{}", crate::asset_jobs::nonce()));
        Self {
            files: Files::new(&root).unwrap(),
            root,
        }
    }
    fn item(&self, token: &str) -> MediaItem {
        MediaItem {
            path: self.root.join(token),
            meta: vv_core::MediaMeta {
                duration_frames: 24,
                fps: vv_core::Rational::new(24, 1),
                width: 16,
                height: 16,
                has_video: true,
                has_audio: false,
                sample_rate: 0,
                channels: 0,
                audio_streams: 0,
                file: Default::default(),
            },
            content_hash: 1,
            compound: None,
            folder: None,
        }
    }
    fn sources(&self) -> Arc<FrameSources> {
        Arc::new(FrameSources::capture(&self.files).unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
fn bytes(path: &Path) -> Vec<u8> {
    let mut output = Vec::new();
    File::open(path).unwrap().read_to_end(&mut output).unwrap();
    output
}

#[test]
fn only_requested_sources_are_opened_and_cache_manifest_reopens_only_touched_files() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.root.join("nested")).unwrap();
    std::fs::write(f.root.join("nested/used.mp4"), b"original").unwrap();
    let other = Fixture::new();
    std::fs::create_dir(other.root.join("nested")).unwrap();
    std::fs::hard_link(
        f.root.join("nested/used.mp4"),
        other.root.join("nested/used.mp4"),
    )
    .unwrap();
    rustix::fs::mknodat(
        rustix::fs::CWD,
        f.root.join("future.mp4"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
    let sources = f.sources();
    assert_eq!(sources.manifest().unwrap(), Manifest::default());
    let resolver = sources.resolver(&PreviewVideoSources::new());
    let item = f.item("nested/used.mp4");
    let resolved = resolver
        .resolve(MediaId::from_raw(1), &item, &item.path)
        .unwrap();
    assert_eq!(bytes(&resolved.path), b"original");
    assert_eq!(sources.manifest().unwrap().sources.len(), 1);
    let manifest = sources.manifest().unwrap();
    assert!(f.sources().validate_manifest(&manifest).is_ok());
    std::fs::remove_file(f.root.join("future.mp4")).unwrap();
    assert!(sources.validate().is_ok());
    assert!(other.sources().validate_manifest(&manifest).is_err());
    drop(resolved);
    std::fs::rename(&item.path, f.root.join("old.mp4")).unwrap();
    std::fs::write(&item.path, b"original").unwrap();
    assert_eq!(sources.validate().unwrap_err().1, "SOURCE_CHANGED");
    assert!(f.sources().validate_manifest(&manifest).is_err());
    assert!(
        resolver
            .resolve(MediaId::from_raw(1), &item, &item.path)
            .is_err()
    );
}

#[test]
fn decoder_lease_pins_original_but_replacement_cannot_publish_or_reopen() {
    let f = Fixture::new();
    std::fs::create_dir(f.root.join("Pasted Images")).unwrap();
    let mut item = f.item("Pasted Images/.Native image.png");
    item.meta.duration_frames = vv_core::IMAGE_DURATION_FRAMES;
    std::fs::write(&item.path, b"first still").unwrap();
    let sources = f.sources();
    let resolver = sources.resolver(&PreviewVideoSources::new());
    let resolved = resolver
        .resolve(MediaId::from_raw(2), &item, &item.path)
        .unwrap();
    std::fs::rename(&item.path, f.root.join("old.png")).unwrap();
    std::fs::write(&item.path, b"second still").unwrap();
    assert_eq!(bytes(&resolved.path), b"first still");
    assert!(sources.validate().is_err());
    assert!(
        resolver
            .resolve(MediaId::from_raw(2), &item, &item.path)
            .is_err()
    );
    drop(resolver);
    drop(sources);
    assert_eq!(bytes(&resolved.path), b"first still");
}

#[test]
fn parent_lineage_and_in_place_restored_mtime_are_part_of_the_first_witness() {
    let f = Fixture::new();
    for name in ["parent", "replacement"] {
        std::fs::create_dir(f.root.join(name)).unwrap();
    }
    let item = f.item("parent/clip.mp4");
    std::fs::write(&item.path, b"original").unwrap();
    std::fs::hard_link(&item.path, f.root.join("replacement/clip.mp4")).unwrap();
    let sources = f.sources();
    let resolver = sources.resolver(&PreviewVideoSources::new());
    let resolved = resolver
        .resolve(MediaId::from_raw(3), &item, &item.path)
        .unwrap();
    std::fs::rename(f.root.join("parent"), f.root.join("old-parent")).unwrap();
    std::fs::rename(f.root.join("replacement"), f.root.join("parent")).unwrap();
    assert!(
        sources.validate().is_err(),
        "The same inode in a replacement parent is refused"
    );
    drop(resolved);
    let sources = f.sources();
    let resolver = sources.resolver(&PreviewVideoSources::new());
    let resolved = resolver
        .resolve(MediaId::from_raw(3), &item, &item.path)
        .unwrap();
    let mut writer = std::fs::OpenOptions::new()
        .write(true)
        .open(&item.path)
        .unwrap();
    let modified = writer.metadata().unwrap().modified().unwrap();
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"modified").unwrap();
    writer
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(bytes(&resolved.path), b"modified");
    assert!(
        sources.validate().is_err(),
        "Restoring mtime does not restore ctime"
    );
    assert!(
        resolver
            .resolve(MediaId::from_raw(3), &item, &item.path)
            .is_err()
    );
}

#[test]
fn proxy_allowlist_pins_decode_fd_and_still_requires_the_original_witness() {
    let f = Fixture::new();
    let item = f.item("original.mp4");
    std::fs::write(&item.path, b"source").unwrap();
    std::fs::write(f.root.join("proxy.mp4"), b"proxy").unwrap();
    let proxy = File::open(f.root.join("proxy.mp4")).unwrap();
    let proxy_path = PathBuf::from(format!("/proc/self/fd/{}", proxy.as_raw_fd()));
    let id = MediaId::from_raw(4);
    let sources = f.sources();
    assert!(
        sources
            .resolver(&PreviewVideoSources::new())
            .resolve(id, &item, &proxy_path)
            .is_err()
    );
    let resolver = sources.resolver(&PreviewVideoSources::from([(id, proxy_path.clone())]));
    assert!(
        resolver
            .resolve(id, &item, &f.root.join("proxy.mp4"))
            .is_err()
    );
    let resolved = resolver.resolve(id, &item, &proxy_path).unwrap();
    drop(proxy);
    assert_eq!(bytes(&resolved.path), b"proxy");
    std::fs::rename(&item.path, f.root.join("old.mp4")).unwrap();
    std::fs::write(&item.path, b"source").unwrap();
    assert!(sources.validate().is_err());
    assert!(resolver.resolve(id, &item, &proxy_path).is_err());
}

#[test]
fn links_special_files_and_unapproved_paths_fail_without_blocking() {
    let f = Fixture::new();
    let sources = f.sources();
    let resolver = sources.resolver(&PreviewVideoSources::new());
    std::fs::write(f.root.join("real.mp4"), b"source").unwrap();
    std::os::unix::fs::symlink(f.root.join("real.mp4"), f.root.join("link.mp4")).unwrap();
    std::os::unix::fs::symlink(&f.root, f.root.join("linked")).unwrap();
    rustix::fs::mknodat(
        rustix::fs::CWD,
        f.root.join("fifo.mp4"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
    for token in [
        "link.mp4",
        "linked/real.mp4",
        "fifo.mp4",
        "../outside.mp4",
        "missing.mp4",
    ] {
        let item = f.item(token);
        assert!(
            resolver
                .resolve(MediaId::from_raw(5), &item, &item.path)
                .is_err(),
            "{token}"
        );
    }
    assert_eq!(sources.manifest().unwrap(), Manifest::default());
    let item = f.item("real.mp4");
    let _resolved = resolver
        .resolve(MediaId::from_raw(5), &item, &item.path)
        .unwrap();
    let moved = f.root.with_extension("moved");
    std::fs::rename(&f.root, &moved).unwrap();
    std::fs::create_dir(&f.root).unwrap();
    assert!(sources.validate().is_err());
    std::fs::remove_dir_all(moved).unwrap();
}

#[test]
fn audio_resolver_shares_requested_witnesses_without_retaining_idle_decode_leases() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.root.join("nested")).unwrap();
    let path = f.root.join("nested/audio.wav");
    std::fs::write(&path, b"original audio").unwrap();
    let sources = f.sources();
    let resolver = sources.audio_resolver();
    assert_eq!(sources.manifest().unwrap(), Manifest::default());
    let resolved = resolver.resolve(&path).unwrap();
    assert_eq!(bytes(&resolved.path), b"original audio");
    assert_eq!(sources.manifest().unwrap().sources.len(), 1);
    let released = Arc::downgrade(&resolved.lease);
    drop(resolved);
    assert!(
        released.upgrade().is_none(),
        "Only the native decoder owns its resolved file lease"
    );
    sources.validate().unwrap();
    let item = f.item("nested/audio.wav");
    let video = sources.resolver(&PreviewVideoSources::new());
    let resolved = video
        .resolve(MediaId::from_raw(1), &item, &item.path)
        .unwrap();
    let manifest = sources.manifest().unwrap();
    assert_eq!(
        manifest.sources.len(),
        1,
        "Video/audio requests share the same original witness"
    );
    std::fs::rename(&path, f.root.join("old.wav")).unwrap();
    std::fs::write(&path, b"replaced audio").unwrap();
    assert_eq!(bytes(&resolved.path), b"original audio");
    assert!(resolver.resolve(&path).is_err());
    assert!(sources.validate_manifest(&manifest).is_err());
}

#[test]
fn audio_resolver_rejects_links_fifos_and_changed_bytes_with_restored_mtime() {
    let f = Fixture::new();
    let sources = f.sources();
    let resolver = sources.audio_resolver();
    let path = f.root.join("audio.wav");
    std::fs::write(&path, b"original").unwrap();
    std::os::unix::fs::symlink(&path, f.root.join("link.wav")).unwrap();
    std::os::unix::fs::symlink(&f.root, f.root.join("linked")).unwrap();
    rustix::fs::mknodat(
        rustix::fs::CWD,
        f.root.join("fifo.wav"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
    for token in [
        "link.wav",
        "linked/audio.wav",
        "fifo.wav",
        "../audio.wav",
        "missing.wav",
    ] {
        assert!(resolver.resolve(&f.root.join(token)).is_err(), "{token}");
    }
    assert_eq!(sources.manifest().unwrap(), Manifest::default());
    let resolved = resolver.resolve(&path).unwrap();
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut writer = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    writer.write_all(b"modified").unwrap();
    writer
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(bytes(&resolved.path), b"modified");
    assert!(sources.validate().is_err());
    assert!(resolver.resolve(&path).is_err());
}
