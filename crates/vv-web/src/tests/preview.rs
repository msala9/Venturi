use super::*;
use vv_core::Id;
#[test]
fn frame_resolution_has_a_fixed_pixel_budget() {
    assert_eq!(frame_size((1920, 1080), 960).unwrap(), (960, 540));
    assert!(frame_size((1, 8192), 1920).is_err());
    assert!(frame_size((1920, 1080), 1921).is_err());
}
#[test]
fn newest_pending_seek_replaces_the_old_one() {
    let queue = Queue::default();
    let job = |frame, reply| Job {
        snapshot: FrameSnapshot {
            project: Project::default(),
            timeline: TimelineId::from_raw(0),
            query: FrameQuery {
                timeline_id: "0".into(),
                project_epoch: "test".into(),
                if_generation: "0".into(),
                revision: "test".into(),
                frame,
                width: 64,
            },
            size: (64, 64),
        },
        reply,
    };
    let (first, mut old) = oneshot::channel();
    queue.replace(job(1, first));
    let (second, _current) = oneshot::channel();
    queue.replace(job(2, second));
    assert!(matches!(
        old.try_recv(),
        Err(oneshot::error::TryRecvError::Closed)
    ));
    assert_eq!(
        queue
            .next(std::time::Duration::from_millis(1))
            .unwrap()
            .snapshot
            .query
            .frame,
        2
    );
    assert!(queue.next(std::time::Duration::from_millis(1)).is_none());
}
#[tokio::test]
async fn a_disabled_renderer_reports_actual_capability() {
    let preview = Preview::disabled();
    assert!(!preview.available());
    assert_eq!(preview.diagnostic()["frame_rendered"], false);
}

#[test]
fn occupied_laboratory_lock_refuses_immediately_and_is_never_removed() {
    let path = std::env::temp_dir().join(format!(
        "vv-web-lock-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let owner = gpu_lock(&path).unwrap();
    let started = std::time::Instant::now();
    assert_eq!(gpu_lock(&path).unwrap_err().1, "GPU_BUSY");
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    assert!(path.exists());
    drop(owner);
    drop(gpu_lock(&path).unwrap());
    std::fs::remove_file(path).unwrap();
}

#[test]
fn program_stage_descriptors_keep_the_same_global_reservation_until_all_are_dropped() {
    let path = std::env::temp_dir().join(format!(
        "vv-program-lease-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let job = gpu_lock(&path).unwrap();
    let stage = job.try_clone().unwrap();
    drop(stage);
    assert_eq!(gpu_lock(&path).unwrap_err().1, "GPU_BUSY");
    let finishing_stage = job.try_clone().unwrap();
    drop(job);
    assert_eq!(gpu_lock(&path).unwrap_err().1, "GPU_BUSY");
    drop(finishing_stage);
    drop(gpu_lock(&path).unwrap());
    std::fs::remove_file(path).unwrap();
}

#[test]
fn software_preview_refuses_ambiguous_drivers_privileges_and_unbounded_threads() {
    let driver = Path::new("/usr/share/vulkan/icd.d/lvp_icd.json");
    let manifest = json!({"ICD":{"library_path":"libvulkan_lvp.so"}});
    let normal =
        "Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nCapEff:\t0000000000000000\n";
    assert!(software_settings(driver, &manifest, 2, normal).is_ok());
    for threads in [0, 3, 256] {
        assert!(software_settings(driver, &manifest, threads, normal).is_err());
    }
    assert!(
        software_settings(
            Path::new("/usr/share/vulkan/icd.d/radeon_icd.json"),
            &manifest,
            2,
            normal
        )
        .is_err()
    );
    assert!(software_settings(Path::new("/tmp/lvp_icd.json"), &manifest, 2, normal).is_err());
    assert!(
        software_settings(
            driver,
            &json!({"ICD":{"library_path":"libvulkan_radeon.so"}}),
            2,
            normal
        )
        .is_err()
    );
    for privileged in [
        normal.replace("1000", "0"),
        normal.replace("1000\t1000\t1000\t1000", "1000\t0\t1000\t1000"),
        normal.replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001"),
    ] {
        assert!(software_settings(driver, &manifest, 2, &privileged).is_err());
    }
}

#[test]
fn software_jobs_use_private_cache_locks_instead_of_the_hardware_reservation() {
    let media = crate::source::MediaJobs::start().unwrap();
    let path = media.software_lock_path();
    assert!(path.starts_with(std::env::temp_dir()));
    assert_eq!(path.file_name().unwrap(), "software.lock");
    let owner = render_lock(&path, AdapterChoice::Software).unwrap();
    assert_eq!(
        render_lock(&path, AdapterChoice::Software).unwrap_err().1,
        "RENDER_BUSY"
    );
    drop(owner);
    drop(render_lock(&path, AdapterChoice::Software).unwrap());
}
