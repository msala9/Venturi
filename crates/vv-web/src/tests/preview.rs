use super::*;
use vv_core::Id;
#[test]
fn guarded_frame_cache_reopens_touched_sources_and_rejects_legacy_or_changed_lineage() {
    let root = std::env::temp_dir().join(format!("vv-frame-cache-{}", crate::asset_jobs::nonce()));
    let files = crate::files::Files::new(&root).unwrap();
    for name in ["used", "other"] {
        std::fs::create_dir(root.join(name)).unwrap();
    }
    let path = root.join("used/clip.mp4");
    std::fs::write(&path, b"cache source").unwrap();
    std::fs::hard_link(&path, root.join("other/clip.mp4")).unwrap();
    let item = vv_core::MediaItem {
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
    };
    let sources = Arc::new(crate::frame_sources::FrameSources::capture(&files).unwrap());
    let lease = sources
        .resolver(&Default::default())
        .resolve(vv_core::MediaId::from_raw(1), &item, &item.path)
        .unwrap();
    let manifest = sources.manifest().unwrap();
    drop(lease);
    let snapshot = FrameSnapshot {
        originals: Some(Arc::new(
            crate::frame_sources::FrameSources::capture(&files).unwrap(),
        )),
        video: Default::default(),
        project: Project::default(),
        timeline: TimelineId::from_raw(0),
        query: FrameQuery {
            timeline_id: "0".into(),
            project_epoch: "p:1".into(),
            if_generation: "0".into(),
            revision: "r".into(),
            frame: 7,
            width: 64,
        },
        size: (64, 64),
    };
    let mut cache = FrameCache::default();
    cache.insert(CachedFrame {
        key: "legacy".into(),
        query: snapshot.query.clone(),
        inputs: vec![],
        originals: None,
        program: true,
        render_tag: "originals".into(),
        data: vec![1],
    });
    assert!(cache.lookup(&snapshot, "legacy").unwrap().is_none());
    cache.insert(CachedFrame {
        key: "guarded".into(),
        query: snapshot.query.clone(),
        inputs: vec![],
        originals: Some(manifest),
        program: true,
        render_tag: "originals".into(),
        data: vec![2],
    });
    assert_eq!(cache.lookup(&snapshot, "guarded").unwrap(), Some(vec![2]));
    assert_eq!(cache.validated_frames(&snapshot), vec![7]);
    std::fs::rename(root.join("used"), root.join("old")).unwrap();
    std::fs::rename(root.join("other"), root.join("used")).unwrap();
    assert!(cache.lookup(&snapshot, "guarded").unwrap().is_none());
    assert!(cache.validated_frames(&snapshot).is_empty());
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn balance_reads_bypassed_native_grade_at_its_source_clock_without_mutation() {
    let mut session = vv_session::Session::default();
    let timeline = session.create_timeline(vv_core::Timeline {
        name: "Bypassed balance".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (64, 64),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let clip_id = session.project.alloc_clip_id();
    let mut clip = vv_core::Clip::from_source_range(
        clip_id,
        vv_core::ClipSource::SolidColor,
        7,
        31,
        10,
        vv_core::Rational::one(),
    );
    let mut grade = vv_core::ClipFilter::new(vv_core::FilterKind::ColorCorrection);
    grade.enabled = false;
    grade
        .grade
        .track_mut(vv_core::GradeParam::Saturation)
        .upsert(13, 1.3, vv_core::Interpolation::Hold);
    clip.effects.filters.push(grade);
    session.project.timelines[timeline].tracks[0].insert_sorted(clip);
    let mut snapshot = FrameSnapshot {
        originals: None,
        video: Default::default(),
        project: session.project.clone(),
        timeline,
        query: FrameQuery {
            timeline_id: timeline.raw().to_string(),
            project_epoch: "test".into(),
            if_generation: "0".into(),
            revision: "test".into(),
            frame: 16,
            width: 64,
        },
        size: (64, 64),
    };
    let before = serde_json::to_value(&snapshot.project).unwrap();
    assert_eq!(
        balance_grade(&snapshot, clip_id)
            .unwrap()
            .get(vv_core::GradeParam::Saturation),
        1.3
    );
    assert_eq!(serde_json::to_value(&snapshot.project).unwrap(), before);
    snapshot.query.frame = 9;
    assert!(balance_grade(&snapshot, clip_id).is_err());
    snapshot.query.frame = 16;
    snapshot.project.timelines[timeline].tracks[0].clips[0]
        .effects
        .filters
        .clear();
    assert!(balance_grade(&snapshot, clip_id).is_err());
}
#[test]
fn cache_eviction_and_telemetry_follow_inputs_composition_and_frame_mode() {
    let query = FrameQuery {
        timeline_id: "1".into(),
        project_epoch: "p:1".into(),
        if_generation: "0".into(),
        revision: "r".into(),
        frame: 0,
        width: 960,
    };
    let inputs = vec![(PathBuf::from("source"), "version1".into())];
    let mut cache = FrameCache::default();
    for frame in 0..10 {
        cache.insert(CachedFrame {
            key: frame.to_string(),
            query: FrameQuery {
                frame,
                ..query.clone()
            },
            inputs: inputs.clone(),
            originals: None,
            program: frame != 9,
            render_tag: "originals".into(),
            data: vec![0; 16],
        });
    }
    assert!(cache.frames(&query, &inputs, "proxy:low").is_empty());
    assert_eq!(cache.entries.len(), 8);
    assert_eq!(cache.bytes, 128);
    assert_eq!(
        cache.frames(&query, &inputs, "originals"),
        vec![2, 3, 4, 5, 6, 7, 8]
    );
    assert!(
        cache
            .frames(
                &query,
                &vec![(PathBuf::from("source"), "version2".into())],
                "originals"
            )
            .is_empty()
    );
    for field in ["epoch", "generation", "timeline", "revision", "width"] {
        let mut changed = query.clone();
        match field {
            "epoch" => changed.project_epoch = "new".into(),
            "generation" => changed.if_generation = "1".into(),
            "timeline" => changed.timeline_id = "2".into(),
            "revision" => changed.revision = "new".into(),
            _ => changed.width = 640,
        }
        assert!(
            cache.frames(&changed, &inputs, "originals").is_empty(),
            "{field}"
        );
    }
    cache.insert(CachedFrame {
        key: "large".into(),
        query: query.clone(),
        inputs: inputs.clone(),
        originals: None,
        program: true,
        render_tag: "originals".into(),
        data: vec![0; 16 * 1024 * 1024],
    });
    assert_eq!(cache.entries.len(), 1);
    assert_eq!(cache.bytes, 16 * 1024 * 1024);
    cache.insert(CachedFrame {
        key: "too-large".into(),
        query,
        inputs,
        originals: None,
        program: true,
        render_tag: "originals".into(),
        data: vec![0; 16 * 1024 * 1024 + 1],
    });
    assert_eq!(cache.entries.len(), 1);
}
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
        mode: FrameMode::Program,
        snapshot: FrameSnapshot {
            originals: None,
            video: Default::default(),
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
    let (program, _program_reply) = oneshot::channel();
    queue.replace(job(3, program));
    let (analysis, mut analysis_reply) = oneshot::channel();
    let mut analysis = job(3, analysis);
    analysis.mode = FrameMode::Scopes(
        vv_core::ClipId(1),
        [
            vv_render::ScopeKind::Waveform,
            vv_render::ScopeKind::Histogram,
        ],
    );
    queue.replace(analysis);
    assert!(matches!(
        analysis_reply.try_recv(),
        Err(oneshot::error::TryRecvError::Closed)
    ));
    assert!(matches!(
        queue
            .next(std::time::Duration::from_millis(1))
            .unwrap()
            .mode,
        FrameMode::Program
    ));
}
#[tokio::test]
async fn a_disabled_renderer_reports_actual_capability() {
    let preview = Preview::disabled();
    assert!(!preview.available());
    assert_eq!(preview.diagnostic()["frame_rendered"], false);
}

#[test]
fn resident_context_yields_before_immediate_probe_and_cannot_reenter_during_handover() {
    let path = std::env::temp_dir().join(format!(
        "vv-context-yield-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let queue = Arc::new(Queue::default());
    let worker = queue.clone();
    let worker_path = path.clone();
    let (ready, started) = std::sync::mpsc::sync_channel(1);
    let (done, finished) = std::sync::mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        let resident_lock = gpu_lock(&worker_path).unwrap();
        ready.send(()).unwrap();
        assert!(worker.next(std::time::Duration::from_secs(1)).is_none());
        drop(resident_lock);
        worker.acknowledge_release();
        let job = worker.next(std::time::Duration::from_secs(1)).unwrap();
        assert_eq!(job.snapshot.query.frame, 7);
        done.send(()).unwrap();
    });
    started.recv().unwrap();
    let mut preview = Preview::codec_test_host();
    preview.config = Some((AdapterChoice::Amd(0x7551), path.clone()));
    preview.queue = Some(queue.clone());
    preview
        .with_codec_probe(true, |lease| {
            assert!(lease.is_some());
            assert_eq!(gpu_lock(&path).unwrap_err().1, "GPU_BUSY");
            let (reply, _receiver) = oneshot::channel();
            queue.replace(Job {
                snapshot: FrameSnapshot {
                    originals: None,
                    video: Default::default(),
                    project: Project::default(),
                    timeline: TimelineId::from_raw(0),
                    query: FrameQuery {
                        timeline_id: "0".into(),
                        project_epoch: "test".into(),
                        if_generation: "0".into(),
                        revision: "test".into(),
                        frame: 7,
                        width: 64,
                    },
                    size: (64, 64),
                },
                mode: FrameMode::Program,
                reply,
            });
            assert!(
                finished
                    .recv_timeout(std::time::Duration::from_millis(20))
                    .is_err(),
                "A pending frame must not reenter while the external job owns the reservation"
            );
            Ok(())
        })
        .unwrap();
    finished
        .recv_timeout(std::time::Duration::from_secs(1))
        .unwrap();
    thread.join().unwrap();
    drop(gpu_lock(&path).unwrap());
    std::fs::remove_file(path).unwrap();
}

#[test]
fn yielding_own_context_never_retries_a_foreign_gpu_reservation() {
    let path = std::env::temp_dir().join(format!(
        "vv-context-foreign-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let foreign = gpu_lock(&path).unwrap();
    let mut preview = Preview::codec_test_host();
    preview.config = Some((AdapterChoice::Amd(0x7551), path.clone()));
    let queue = preview.queue.as_ref().unwrap().clone();
    let thread = std::thread::spawn(move || {
        assert!(queue.next(std::time::Duration::from_secs(1)).is_none());
        queue.acknowledge_release();
    });
    let started = std::time::Instant::now();
    assert_eq!(
        preview
            .with_codec_probe::<()>(true, |_| panic!(
                "Foreign ownership must prevent native work"
            ))
            .unwrap_err()
            .1,
        "GPU_BUSY"
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    thread.join().unwrap();
    drop(foreign);
    std::fs::remove_file(path).unwrap();
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
