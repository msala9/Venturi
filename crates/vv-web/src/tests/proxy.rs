use super::*;

struct Fixture {
    root: PathBuf,
    manager: Manager,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "vv-native-proxy-test-{}",
            crate::asset_jobs::nonce()
        ));
        std::fs::create_dir(&root).unwrap();
        let manager = Manager::start(&root).unwrap();
        Self { root, manager }
    }
    fn source(&self) -> SourceSpec {
        let path = self.root.join("source.mp4");
        if !path.exists() {
            std::fs::write(&path, b"unrendered source fixture").unwrap();
        }
        SourceSpec {
            file: File::open(&path).unwrap(),
            epoch: "p:1".into(),
            media_id: "1".into(),
            meta: vv_core::MediaMeta {
                duration_frames: 12,
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
        }
    }
    fn input(&self, spec: SourceSpec) -> Input {
        Input {
            spec,
            original_path: self.root.join("source.mp4"),
        }
    }
    fn native_source(&self) -> SourceSpec {
        let path = self.root.join("source.mp4");
        let settings = vv_media::VideoSettings {
            preset: "ultrafast".into(),
            ..Default::default()
        };
        let mut encoder = vv_media::Encoder::new(
            &path,
            16,
            16,
            vv_core::Rational::new(24, 1),
            &settings,
            None,
        )
        .unwrap();
        let mut frame = vec![64; 256];
        frame.extend(vec![128; 128]);
        for _ in 0..12 {
            encoder.write_video_frame(&frame).unwrap();
        }
        encoder.finish().unwrap();
        let mut source = self.source();
        source.meta = vv_media::probe_media(&path).unwrap();
        source
    }
    fn artifact(&self, charge: u64) -> Arc<Artifact> {
        let source = self.source();
        let name = format!("fixture-{}.mp4", crate::asset_jobs::nonce());
        let path = self.manager.0.cache.path.join(&name);
        std::fs::write(&path, b"identity-only artifact fixture").unwrap();
        let file = open_regular(&self.manager.0.cache.directory, &name).unwrap();
        Arc::new(Artifact {
            cache: self.manager.0.cache.clone(),
            name,
            file: file.try_clone().unwrap(),
            original: source.file.try_clone().unwrap(),
            original_path: self.root.join("source.mp4"),
            source_version: identity(&source.file).unwrap(),
            artifact_version: identity(&file).unwrap(),
            bytes: charge,
        })
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn finish(manager: &Manager, id: &str) -> Value {
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        let state = manager.status("p:1").unwrap();
        let job = state["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|job| job["id"] == id)
            .unwrap()
            .clone();
        if !matches!(job["state"].as_str(), Some("queued" | "generating")) {
            return job;
        }
        assert!(Instant::now() < end, "{state}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn native_proxy_settings_are_strict_persisted_cas_guarded_and_retain_the_pinned_root() {
    let f = Fixture::new();
    assert_eq!(
        f.manager.settings().unwrap(),
        json!({"enabled":false,"quality":"medium","paused":false})
    );
    let directory = File::open(&f.root).unwrap();
    let other = Manager::start(&fd_path(&directory)).unwrap();
    drop(directory);
    f.manager.configure(true, "low", true).unwrap();
    let bytes = std::fs::read(f.root.join(SETTINGS)).unwrap();
    assert_eq!(
        serde_json::from_slice::<Settings>(&bytes).unwrap().quality,
        "low"
    );
    assert_eq!(
        other.configure(true, "high", false).unwrap_err().1,
        "PROXY_SETTINGS_CHANGED"
    );
    other.settings().unwrap();
    other.configure(true, "high", true).unwrap();
    assert_eq!(f.manager.settings().unwrap()["quality"], "high");
    let before = std::fs::read(f.root.join(SETTINGS)).unwrap();
    assert!(f.manager.configure(true, "invalid", false).is_err());
    assert_eq!(std::fs::read(f.root.join(SETTINGS)).unwrap(), before);
    for malformed in [
        br#"{"version":1,"enabled":true,"quality":"medium","paused":false,"extra":1}"#.as_slice(),
        br#"{"version":2,"enabled":false,"quality":"medium","paused":false}"#.as_slice(),
    ] {
        std::fs::write(f.root.join(SETTINGS), malformed).unwrap();
        assert!(Manager::start(&f.root).is_err());
        assert_eq!(std::fs::read(f.root.join(SETTINGS)).unwrap(), malformed);
    }
}

#[test]
fn native_proxy_queue_is_bounded_deduplicated_and_quality_changes_cancel_without_losing_user_pause()
{
    let f = Fixture::new();
    f.manager.configure(true, "medium", true).unwrap();
    let first = f.manager.enqueue(f.input(f.source())).unwrap();
    assert_eq!(f.manager.enqueue(f.input(f.source())).unwrap(), first);
    for index in 2..=MAX_JOBS {
        let mut source = f.source();
        source.media_id = index.to_string();
        f.manager.enqueue(f.input(source)).unwrap();
    }
    let mut excess = f.source();
    excess.media_id = "1000".into();
    assert_eq!(
        f.manager.enqueue(f.input(excess)).unwrap_err().1,
        "PROXY_QUEUE_FULL"
    );
    assert!(
        f.manager
            .resolve(&f.source(), &f.root.join("source.mp4"))
            .unwrap()
            .is_none()
    );
    let guard = f.manager.suspend().unwrap();
    assert!(
        f.manager.status("p:1").unwrap()["suspended"]
            .as_bool()
            .unwrap()
    );
    drop(guard);
    assert_eq!(f.manager.settings().unwrap()["paused"], true);
    f.manager.configure(true, "low", true).unwrap();
    assert!(
        f.manager.status("p:1").unwrap()["jobs"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let next = f.manager.enqueue(f.input(f.source())).unwrap();
    assert_eq!(next["quality"], "low");
    assert_eq!(next["state"], "queued");
    assert_eq!(
        f.manager.status("p:1").unwrap()["jobs"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.manager.configure(false, "low", true).unwrap();
    assert_eq!(
        f.manager.status("p:1").unwrap()["jobs"][0]["state"],
        "canceled"
    );
    assert_eq!(
        f.manager.enqueue(f.input(f.source())).unwrap_err().1,
        "PROXY_DISABLED"
    );
}

#[test]
fn native_proxy_callback_really_parks_and_foreground_guards_preserve_the_user_pause() {
    let f = Fixture::new();
    f.manager.configure(true, "medium", true).unwrap();
    let (settings, tag) = f.manager.0.root.read().unwrap();
    let shared = Arc::new(Shared {
        state: Mutex::new(State {
            settings,
            settings_identity: tag,
            jobs: VecDeque::new(),
            artifacts: vec![],
            suspended: 0,
            active: Some("callback".into()),
            parked: false,
            shutdown: false,
        }),
        wake: Condvar::new(),
    });
    let manager = Manager(Arc::new(Owner {
        root: f.manager.0.root.clone(),
        cache: f.manager.0.cache.clone(),
        shared: shared.clone(),
    }));
    let (tx, rx) = std::sync::mpsc::channel();
    let waiting = shared.clone();
    let thread = std::thread::spawn(move || {
        tx.send(wait_callback(&waiting, &AtomicBool::new(false)).is_ok())
            .unwrap();
    });
    let end = Instant::now() + Duration::from_secs(2);
    let mut state = shared.state.lock().unwrap();
    while !state.parked {
        let (next, _) = shared
            .wake
            .wait_timeout(state, Duration::from_millis(10))
            .unwrap();
        state = next;
        assert!(Instant::now() < end);
    }
    drop(state);
    let guard = manager.suspend().unwrap();
    manager.configure(true, "medium", false).unwrap();
    assert!(
        rx.recv_timeout(Duration::from_millis(20)).is_err(),
        "A foreground lease must keep native generation parked"
    );
    drop(guard);
    assert!(rx.recv_timeout(Duration::from_secs(2)).unwrap());
    thread.join().unwrap();
    shared.state.lock().unwrap().active = None;
    manager.configure(true, "medium", true).unwrap();
    let guard = manager.suspend().unwrap();
    drop(guard);
    assert_eq!(manager.settings().unwrap()["paused"], true);
}

#[test]
fn native_proxy_leases_bind_original_and_artifact_ctime_and_prevent_cache_undercharging() {
    let f = Fixture::new();
    let artifact = f.artifact(MAX_FILE);
    let lease = Lease {
        artifact: artifact.clone(),
        root: f.manager.0.root.clone(),
    };
    lease.validate().unwrap();
    let mut state = f.manager.0.shared.state.lock().unwrap();
    state.artifacts.push(Arc::downgrade(&artifact));
    assert_eq!(charge(&state), MAX_FILE);
    drop(state);
    let original = f.root.join("source.mp4");
    let modified = std::fs::metadata(&original).unwrap().modified().unwrap();
    let mut bytes = std::fs::read(&original).unwrap();
    bytes[0] ^= 1;
    std::fs::write(&original, bytes).unwrap();
    File::options()
        .write(true)
        .open(&original)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(lease.validate().unwrap_err().1, "SOURCE_CHANGED");
    drop(lease);
    drop(artifact);
    let mut state = f.manager.0.shared.state.lock().unwrap();
    assert_eq!(charge(&state), 0);
    state.active = Some("reserved".into());
    assert_eq!(charge(&state), MAX_FILE);
    state.active = None;
    drop(state);
    let artifact = f.artifact(1);
    let lease = Lease {
        artifact: artifact.clone(),
        root: f.manager.0.root.clone(),
    };
    let path = artifact.cache.path.join(&artifact.name);
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    std::fs::write(&path, b"identity-only ARTIFACT fixture").unwrap();
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(lease.validate().unwrap_err().1, "SOURCE_CHANGED");
}

#[test]
fn native_proxy_full_range_cpu_output_is_leaseable_reusable_and_separate_from_original_bytes() {
    let f = Fixture::new();
    let source = f.native_source();
    let meta = source.meta.clone();
    let spec = || SourceSpec {
        meta: meta.clone(),
        ..f.source()
    };
    let original = std::fs::read(f.root.join("source.mp4")).unwrap();
    f.manager.configure(true, "low", false).unwrap();
    let queued = f.manager.enqueue(f.input(source)).unwrap();
    let ready = finish(&f.manager, queued["id"].as_str().unwrap());
    assert_eq!(ready["state"], "ready", "{ready}");
    let source = spec();
    let lease = f
        .manager
        .resolve(&source, &f.root.join("source.mp4"))
        .unwrap()
        .unwrap();
    assert_eq!(lease.source_version(), identity(&source.file).unwrap());
    lease.validate().unwrap();
    let mut decoder = vv_media::Decoder::open_software_bounded(&lease.path(), 1).unwrap();
    let mut frames = 0;
    while decoder.next_frame().unwrap().is_some() {
        frames += 1;
    }
    assert_eq!(frames, 12);
    assert_eq!(std::fs::read(f.root.join("source.mp4")).unwrap(), original);
    let again = f.manager.enqueue(f.input(spec())).unwrap();
    assert_eq!(again["id"], ready["id"]);
    f.manager.configure(false, "low", false).unwrap();
    assert!(
        f.manager
            .resolve(&spec(), &f.root.join("source.mp4"))
            .unwrap()
            .is_none()
    );
    lease.validate().unwrap();
    f.manager.configure(true, "medium", true).unwrap();
    assert!(
        f.manager
            .resolve(&spec(), &f.root.join("source.mp4"))
            .unwrap()
            .is_none()
    );
    f.manager.configure(true, "low", true).unwrap();
    assert!(
        f.manager
            .resolve(&spec(), &f.root.join("source.mp4"))
            .unwrap()
            .is_some()
    );
}

#[test]
fn native_proxy_refuses_images_audio_links_replaced_originals_and_invalid_metadata_before_queueing()
{
    let f = Fixture::new();
    f.manager.configure(true, "medium", true).unwrap();
    let mut audio = f.source();
    audio.meta.has_video = false;
    assert!(f.manager.enqueue(f.input(audio)).is_err());
    let mut still = f.source();
    still.meta.duration_frames = vv_core::IMAGE_DURATION_FRAMES;
    assert!(f.manager.enqueue(f.input(still)).is_err());
    let mut too_large = f.source();
    too_large.meta.width = 8193;
    assert!(f.manager.enqueue(f.input(too_large)).is_err());
    let source = f.source();
    std::fs::rename(f.root.join("source.mp4"), f.root.join("moved.mp4")).unwrap();
    std::os::unix::fs::symlink(f.root.join("moved.mp4"), f.root.join("source.mp4")).unwrap();
    assert!(f.manager.enqueue(f.input(source)).is_err());
    assert!(
        f.manager.status("p:1").unwrap()["jobs"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
