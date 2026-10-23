use super::*;
#[test]
fn proxy_lookup_is_nonblocking_ready_only_and_keeps_missing_future_media_for_native_rendering() {
    let root =
        std::env::temp_dir().join(format!("vv-proxy-selection-{}", crate::asset_jobs::nonce()));
    std::fs::create_dir(&root).unwrap();
    let manager = Manager::start(&root).unwrap();
    manager.configure(true, "low", true).unwrap();
    let mut project = vv_core::Project::default();
    let mut track = vv_core::Track::new(vv_core::TrackKind::Video);
    for (index, name) in ["missing.mp4", "fifo.mp4"].into_iter().enumerate() {
        let path = root.join(name);
        if index == 1 {
            rustix::fs::mknodat(
                rustix::fs::CWD,
                &path,
                rustix::fs::FileType::Fifo,
                rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
                0,
            )
            .unwrap();
        }
        let media = project.media_pool.insert(vv_core::MediaItem {
            path,
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
        });
        track.insert_sorted(vv_core::Clip::from_source_range(
            vv_core::ClipId(index as u64),
            ClipSource::Media(media),
            100,
            24,
            0,
            vv_core::Rational::one(),
        ));
    }
    let timeline = project.timelines.insert(vv_core::Timeline {
        name: "future".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let snapshot = FrameSnapshot {
        originals: None,
        video: Default::default(),
        project,
        timeline,
        query: crate::preview::FrameQuery {
            timeline_id: timeline.raw().to_string(),
            project_epoch: "p:1".into(),
            if_generation: "0".into(),
            revision: "r".into(),
            frame: 0,
            width: 16,
        },
        size: (16, 16),
    };
    let before = serde_json::to_value(&snapshot.project).unwrap();
    let low = Selection::capture(&manager, &snapshot).unwrap();
    assert!(low.sources.is_empty());
    assert_ne!(low.tag, "originals");
    manager.configure(true, "high", true).unwrap();
    assert_ne!(
        low.tag,
        Selection::capture(&manager, &snapshot).unwrap().tag
    );
    manager.configure(false, "high", true).unwrap();
    assert_eq!(
        Selection::capture(&manager, &snapshot).unwrap().tag,
        "originals"
    );
    assert_eq!(serde_json::to_value(&snapshot.project).unwrap(), before);
    std::fs::remove_file(root.join("fifo.mp4")).unwrap();
}
