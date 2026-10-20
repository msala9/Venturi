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
    assert!(old.try_recv().is_err());
    assert_eq!(queue.next().snapshot.query.frame, 2);
}
#[tokio::test]
async fn a_disabled_renderer_reports_actual_capability() {
    let preview = Preview::disabled();
    assert!(!preview.available());
    assert_eq!(preview.diagnostic()["frame_rendered"], false);
}
