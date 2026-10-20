use super::*;
fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "vv-web-test-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
#[test]
fn atomic_persistence_and_path_boundary() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let project = Project::default();
    files.save(&project, "test.vvproj", true).unwrap();
    assert!(files.save(&project, "test.vvproj", true).is_err());
    files.save(&project, "test.vvproj", false).unwrap();
    assert!(root.join("test.vvproj.bak").exists());
    assert!(files.load("test.vvproj").is_ok());
    assert!(files.load("../test.vvproj").is_err());
    let external = root.with_extension("outside");
    std::fs::write(&external, b"sentinel").unwrap();
    std::os::unix::fs::symlink(&external, root.join("link.vvproj")).unwrap();
    assert!(files.load("link.vvproj").is_err());
    assert!(files.save(&project, "link.vvproj", false).is_err());
    assert_eq!(std::fs::read(&external).unwrap(), b"sentinel");
    std::fs::remove_file(external).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_probe_accepts_media_without_reading_symlink_targets() {
    let root = root();
    let files = Files::new(&root).unwrap();
    let media = root.join("sample clip.mp4");
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x64:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-c:a",
            "aac",
        ])
        .arg(&media)
        .status()
        .unwrap();
    assert!(status.success());
    let (_, meta) = files.probe("sample clip.mp4").unwrap();
    assert!(meta.has_video && meta.has_audio);
    assert_eq!(meta.fps, vv_core::Rational::new(24, 1));
    std::os::unix::fs::symlink(&media, root.join("link.mp4")).unwrap();
    assert!(files.probe("link.mp4").is_err());
    std::fs::remove_dir_all(root).unwrap();
}
