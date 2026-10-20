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
