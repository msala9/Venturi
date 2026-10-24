use super::*;
use vv_core::ClipSource;
use vv_core::{Clip, Keyframed, Rgba, Track, TrackKind};

fn preview_video_source_item() -> vv_core::MediaItem {
    vv_core::MediaItem {
        path: "original.mov".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 1000,
            fps: vv_core::Rational::new(30000, 1001),
            width: 3840,
            height: 2160,
            has_video: true,
            has_audio: true,
            sample_rate: 48_000,
            channels: 2,
            audio_streams: 2,
            file: Default::default(),
        },
        content_hash: 42,
        compound: None,
        folder: None,
    }
}

#[test]
fn preview_video_sources_override_only_regular_moving_video() {
    let mut project = Project::default();
    let media = project.media_pool.insert(preview_video_source_item());
    let item = &project.media_pool[media];
    let sources = PreviewVideoSources::from([(media, PathBuf::from("proxy.mp4"))]);
    assert_eq!(
        video_decode_path(media, item, &sources),
        Path::new("proxy.mp4")
    );
    assert_eq!(
        video_decode_path(media, item, &PreviewVideoSources::new()),
        item.path.as_path()
    );
    assert!(StreamingFrameProvider::default().video_sources.is_empty());
    let mut still = item.clone();
    still.meta.has_audio = false;
    still.meta.duration_frames = vv_core::IMAGE_DURATION_FRAMES;
    let mut audio = item.clone();
    audio.meta.has_video = false;
    audio.meta.width = 0;
    audio.meta.height = 0;
    let mut compound = item.clone();
    compound.compound = Some(project.timelines.insert(timeline_with(Vec::new())));
    for excluded in [still, audio, compound] {
        assert_eq!(
            video_decode_path(media, &excluded, &sources),
            excluded.path.as_path()
        );
    }
}

#[test]
fn preview_video_sources_preserve_original_audio_paths_metadata_and_native_clocks() {
    let mut project = Project::default();
    let media = project.media_pool.insert(preview_video_source_item());
    let mut audio = preview_video_source_item();
    audio.path = "original.wav".into();
    audio.meta.has_video = false;
    audio.meta.width = 0;
    audio.meta.height = 0;
    let audio = project.media_pool.insert(audio);
    let mut clip = Clip::from_source_range(
        ClipId(9),
        ClipSource::Media(media),
        100,
        200,
        24,
        vv_core::Rational::new(5, 4),
    );
    clip.freeze = Some(135);
    let before = serde_json::to_value(&project).unwrap();
    let before_clip = serde_json::to_value(&clip).unwrap();
    let clock = clip.source_frame_at(26);
    let sources = PreviewVideoSources::from([
        (media, PathBuf::from("proxy-960.mp4")),
        (audio, PathBuf::from("must-not-be-used.mp4")),
    ]);
    assert_eq!(
        video_decode_path(media, &project.media_pool[media], &sources),
        Path::new("proxy-960.mp4")
    );
    assert_eq!(
        video_decode_path(audio, &project.media_pool[audio], &sources),
        Path::new("original.wav")
    );
    assert_eq!(project.media_pool[media].path, Path::new("original.mov"));
    assert_eq!(project.media_pool[audio].path, Path::new("original.wav"));
    assert_eq!(media_source_frame(&clip, 26), Some((media, 135)));
    assert_eq!(clip.source_frame_at(26), clock);
    assert_ne!(clock, 135);
    assert_eq!(
        crate::frame_provider::clip_source_size(&project, &clip, (1920, 1080)),
        (3840, 2160)
    );
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
    assert_eq!(serde_json::to_value(&clip).unwrap(), before_clip);
}

#[cfg(target_os = "linux")]
struct ResolverFixture {
    root: PathBuf,
}
#[cfg(target_os = "linux")]
impl ResolverFixture {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "vv-session-video-resolver-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        Self { root }
    }
    fn moving(&self) -> PathBuf {
        let path = self.root.join("moving.mp4");
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
        let mut frame = vec![81; 256];
        frame.extend(vec![128; 128]);
        for _ in 0..4 {
            encoder.write_video_frame(&frame).unwrap();
        }
        encoder.finish().unwrap();
        path
    }
    fn still(&self) -> PathBuf {
        let path = self.root.join("still.bmp");
        let mut bytes = Vec::new();
        bytes.extend(b"BM");
        bytes.extend(78u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(54u32.to_le_bytes());
        bytes.extend(40u32.to_le_bytes());
        bytes.extend(4i32.to_le_bytes());
        bytes.extend(2i32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(24u16.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(24u32.to_le_bytes());
        bytes.extend([0; 16]);
        for _ in 0..8 {
            bytes.extend([0, 0, 255]);
        }
        std::fs::write(&path, bytes).unwrap();
        path
    }
    fn audio(&self) -> PathBuf {
        let path = self.root.join("source.wav");
        let frames = PROJECT_SAMPLE_RATE as usize;
        let bytes = (frames * 4) as u32;
        let mut wav = Vec::with_capacity(bytes as usize + 44);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + bytes).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&PROJECT_SAMPLE_RATE.to_le_bytes());
        wav.extend_from_slice(&(PROJECT_SAMPLE_RATE * 4).to_le_bytes());
        wav.extend_from_slice(&4_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&bytes.to_le_bytes());
        for frame in 0..frames {
            for frequency in [0.071_f32, 0.113_f32] {
                let sample = 0.25 * (frame as f32 * frequency).sin();
                wav.extend_from_slice(&((sample * i16::MAX as f32) as i16).to_le_bytes());
            }
        }
        std::fs::write(&path, wav).unwrap();
        path
    }
}
#[cfg(target_os = "linux")]
impl Drop for ResolverFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct TestVideoResolver {
    paths: HashMap<MediaId, PathBuf>,
    calls: Mutex<Vec<(MediaId, PathBuf, PathBuf)>>,
    leases: Mutex<Vec<std::sync::Weak<std::fs::File>>>,
}
#[cfg(target_os = "linux")]
impl VideoSourceResolver for TestVideoResolver {
    fn resolve(
        &self,
        media: MediaId,
        item: &vv_core::MediaItem,
        decode_path: &Path,
    ) -> Result<ResolvedVideoSource, ExportError> {
        use std::os::fd::AsRawFd;
        self.calls
            .lock()
            .unwrap()
            .push((media, item.path.clone(), decode_path.to_owned()));
        let path = self
            .paths
            .get(&media)
            .ok_or_else(|| ExportError::Failed("resolver refused source".into()))?;
        let lease = Arc::new(std::fs::File::open(path).map_err(ExportError::failed)?);
        self.leases.lock().unwrap().push(Arc::downgrade(&lease));
        Ok(ResolvedVideoSource {
            path: PathBuf::from(format!("/proc/self/fd/{}", lease.as_raw_fd())),
            lease,
        })
    }
}

#[cfg(target_os = "linux")]
struct TestAudioResolver {
    paths: HashMap<PathBuf, PathBuf>,
    calls: Mutex<Vec<PathBuf>>,
    dropped: std::sync::mpsc::Sender<()>,
}

#[cfg(target_os = "linux")]
impl AudioSourceResolver for TestAudioResolver {
    fn resolve(
        &self,
        original: &Path,
    ) -> Result<crate::audio_render::ResolvedAudioSource, ExportError> {
        use std::os::fd::AsRawFd;
        struct Lease {
            file: std::fs::File,
            dropped: std::sync::mpsc::Sender<()>,
        }
        impl Drop for Lease {
            fn drop(&mut self) {
                let _ = self.dropped.send(());
            }
        }
        self.calls.lock().unwrap().push(original.to_owned());
        let path = self
            .paths
            .get(original)
            .ok_or_else(|| ExportError::Failed("export audio resolver refused source".into()))?;
        let lease = Arc::new(Lease {
            file: std::fs::File::open(path).map_err(ExportError::failed)?,
            dropped: self.dropped.clone(),
        });
        Ok(crate::audio_render::ResolvedAudioSource {
            path: PathBuf::from(format!("/proc/self/fd/{}", lease.file.as_raw_fd())),
            lease,
        })
    }
}

#[cfg(target_os = "linux")]
fn export_audio_fixture(fixture: &ResolverFixture) -> (Project, TimelineId, MediaId) {
    let audio_path = fixture.audio();
    let meta = vv_media::probe_media(&audio_path).unwrap();
    let mut project = Project::default();
    let audio = project.media_pool.insert(vv_core::MediaItem {
        path: audio_path,
        meta: meta.clone(),
        content_hash: 83,
        compound: None,
        folder: None,
    });
    let mut video_track = Track::new(TrackKind::Video);
    video_track.insert_sorted(solid_color_clip(1501, 0, 4, red()));
    let mut audio_track = Track::new(TrackKind::Audio);
    audio_track.insert_sorted(Clip::from_source_range(
        ClipId(1502),
        ClipSource::Media(audio),
        0,
        meta.duration_frames,
        0,
        vv_core::Rational::conform_rate(vv_core::Rational::new(24, 1), meta.fps),
    ));
    let mut timeline = timeline_with(vec![video_track, audio_track]);
    timeline.fps = vv_core::Rational::new(24, 1);
    timeline.resolution = (16, 16);
    timeline.master.effects.push(vv_core::AudioEffect::new(
        vv_core::AudioEffectKind::Normalize {
            target_db: -1.0,
            mode: vv_core::NormalizeMode::SamplePeak,
            set_level: vv_core::SetLevel::Relative,
        },
    ));
    let timeline = project.timelines.insert(timeline);
    (project, timeline, audio)
}

#[cfg(target_os = "linux")]
#[test]
fn export_source_resolvers_preserve_native_pcm_encoded_output_and_project_with_pinned_inputs() {
    let fixture = ResolverFixture::new();
    let (mut project, timeline, audio) = export_audio_fixture(&fixture);
    let moving = fixture.moving();
    let video = project.media_pool.insert(vv_core::MediaItem {
        path: moving.clone(),
        meta: vv_media::probe_media(&moving).unwrap(),
        content_hash: 84,
        compound: None,
        folder: None,
    });
    project.timelines[timeline].tracks[0].clips[0].source = ClipSource::Media(video);
    let expected_path = fixture.root.join("native.mp4");
    let settings = ExportSettings::new(expected_path.clone());
    let cancel = Arc::new(AtomicBool::new(false));
    let mut expected_pcm = Vec::new();
    export_timeline_with_gpu_observed(
        &project,
        timeline,
        &settings,
        0..4,
        &Mutex::new(ExportProgress::default()),
        &cancel,
        || Ok(vv_render::Compositor::new_headless()),
        |_| Ok(()),
        2,
        &mut |_, pcm, _| expected_pcm.extend_from_slice(pcm),
    )
    .unwrap();
    assert!(expected_pcm.iter().any(|sample| sample.abs() > 0.1));
    let audio_path = project.media_pool[audio].path.clone();
    project.media_pool[audio].path = fixture.root.join("virtual-original.wav");
    project.media_pool[video].path = fixture.root.join("virtual-original.mp4");
    let original = serde_json::to_value(&project).unwrap();
    let (dropped, receiver) = std::sync::mpsc::channel();
    let audio_resolver = Arc::new(TestAudioResolver {
        paths: HashMap::from([(project.media_pool[audio].path.clone(), audio_path)]),
        calls: Default::default(),
        dropped,
    });
    let video_resolver = Arc::new(TestVideoResolver {
        paths: HashMap::from([(video, moving)]),
        ..Default::default()
    });
    let actual_path = fixture.root.join("resolved.mp4");
    let settings = ExportSettings::new(actual_path.clone());
    let progress = Mutex::new(ExportProgress::default());
    let mut actual_pcm = Vec::new();
    export_timeline_preview_with_gpu_with_resolvers(
        &project,
        timeline,
        &settings,
        0..4,
        &progress,
        &cancel,
        || Ok(vv_render::Compositor::new_headless()),
        |_| Ok(()),
        2,
        Some(&mut |_, pcm, _| actual_pcm.extend_from_slice(pcm)),
        &PreviewVideoSources::new(),
        Some(video_resolver.clone()),
        Some(audio_resolver.clone()),
    )
    .unwrap();
    assert_eq!(actual_pcm, expected_pcm);
    assert_eq!(
        std::fs::read(actual_path).unwrap(),
        std::fs::read(expected_path).unwrap()
    );
    assert!(progress.lock().unwrap().done);
    let calls = audio_resolver.calls.lock().unwrap();
    assert!(!calls.is_empty());
    assert!(
        calls
            .iter()
            .all(|path| path == &project.media_pool[audio].path)
    );
    for _ in 0..calls.len() {
        receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
    }
    assert_eq!(video_resolver.calls.lock().unwrap().len(), 1);
    assert_eq!(serde_json::to_value(&project).unwrap(), original);
}

#[cfg(target_os = "linux")]
#[test]
fn export_source_resolvers_refuse_native_audio_before_normalize_fallback_can_publish_a_movie() {
    let fixture = ResolverFixture::new();
    let (project, timeline, audio) = export_audio_fixture(&fixture);
    assert!(project.media_pool[audio].path.is_file());
    let before = serde_json::to_value(&project).unwrap();
    let (dropped, _) = std::sync::mpsc::channel();
    let resolver = Arc::new(TestAudioResolver {
        paths: HashMap::new(),
        calls: Default::default(),
        dropped,
    });
    let mut settings = ExportSettings::new(fixture.root.join("refused.mp4"));
    settings.audio_render_origin = Some(0);
    let progress = Mutex::new(ExportProgress::default());
    let result = export_timeline_preview_with_gpu_with_resolvers(
        &project,
        timeline,
        &settings,
        0..4,
        &progress,
        &Arc::new(AtomicBool::new(false)),
        || Ok(vv_render::Compositor::new_headless()),
        |_| Ok(()),
        2,
        None,
        &PreviewVideoSources::new(),
        None,
        Some(resolver.clone()),
    );
    assert_eq!(
        result.unwrap_err(),
        ExportError::Failed("export audio resolver refused source".into())
    );
    assert!(!progress.lock().unwrap().done);
    let calls = resolver.calls.lock().unwrap();
    assert!(!calls.is_empty());
    assert!(
        calls
            .iter()
            .all(|path| path == &project.media_pool[audio].path)
    );
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
}

#[cfg(target_os = "linux")]
#[test]
fn video_source_resolver_opens_only_requested_decoders_keeps_leases_and_releases_them_on_sweep() {
    let fixture = ResolverFixture::new();
    let moving = fixture.moving();
    let still = fixture.still();
    let mut project = Project::default();
    let mut item = preview_video_source_item();
    item.path = fixture.root.join("not-opened-original.mov");
    item.meta = vv_media::probe_media(&moving).unwrap();
    let video = project.media_pool.insert(item.clone());
    item.path = fixture.root.join("not-opened-still.bmp");
    item.meta = vv_media::probe_image(&still).unwrap();
    let image = project.media_pool.insert(item.clone());
    item.path = fixture.root.join("unused-missing.mov");
    let unused = project.media_pool.insert(item);
    let resolver = Arc::new(TestVideoResolver {
        paths: HashMap::from([(video, moving.clone()), (image, still)]),
        ..Default::default()
    });
    let selected_proxy = fixture.root.join("captured-proxy.mp4");
    let mut provider = StreamingFrameProvider {
        cpu_threads: 2,
        video_sources: HashMap::from([
            (video, selected_proxy.clone()),
            (image, fixture.root.join("ignored-still-proxy.mp4")),
        ]),
        resolver: Some(resolver.clone()),
        ..Default::default()
    };
    let clip = Clip::from_source_range(
        ClipId(1101),
        ClipSource::Media(video),
        0,
        4,
        0,
        vv_core::Rational::one(),
    );
    let image_clip = Clip::from_source_range(
        ClipId(1102),
        ClipSource::Media(image),
        0,
        4,
        0,
        vv_core::Rational::one(),
    );
    let original = serde_json::to_value(&project).unwrap();
    let first = provider.frame_for(&project, &clip, 0).unwrap().unwrap();
    assert_eq!((first.width, first.height), (16, 16));
    provider.sweep();
    std::fs::rename(&moving, fixture.root.join("renamed-moving.mp4")).unwrap();
    let next = provider.frame_for(&project, &clip, 1).unwrap().unwrap();
    assert_eq!((next.width, next.height), (16, 16));
    let image_frame = provider
        .frame_for(&project, &image_clip, 0)
        .unwrap()
        .unwrap();
    assert_eq!((image_frame.width, image_frame.height), (4, 2));
    provider.sweep();
    let calls = resolver.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[0],
        (
            video,
            project.media_pool[video].path.clone(),
            selected_proxy
        )
    );
    assert_eq!(calls[1].2, project.media_pool[image].path);
    assert!(calls.iter().all(|call| call.0 != unused));
    drop(calls);
    assert!(
        resolver
            .leases
            .lock()
            .unwrap()
            .iter()
            .all(|lease| lease.upgrade().is_some())
    );
    provider.frame_for(&project, &image_clip, 1).unwrap();
    provider.sweep();
    let leases = resolver.leases.lock().unwrap();
    assert!(leases[0].upgrade().is_none());
    assert!(leases[1].upgrade().is_some());
    drop(leases);
    provider.sweep();
    assert!(provider.active.is_empty());
    assert!(
        resolver
            .leases
            .lock()
            .unwrap()
            .iter()
            .all(|lease| lease.upgrade().is_none())
    );
    assert_eq!(serde_json::to_value(&project).unwrap(), original);
}

#[cfg(target_os = "linux")]
#[test]
fn video_source_resolver_refusal_prevents_native_open_and_compound_entries_do_not_resolve() {
    let mut project = Project::default();
    let media = project.media_pool.insert(preview_video_source_item());
    let nested = project.timelines.insert(timeline_with(Vec::new()));
    let mut compound = project.media_pool[media].clone();
    compound.compound = Some(nested);
    let compound = project.media_pool.insert(compound);
    let resolver = Arc::new(TestVideoResolver::default());
    let mut provider = StreamingFrameProvider {
        resolver: Some(resolver.clone()),
        ..Default::default()
    };
    let clip = Clip::from_source_range(
        ClipId(1201),
        ClipSource::Media(compound),
        0,
        4,
        0,
        vv_core::Rational::one(),
    );
    assert!(provider.frame_for(&project, &clip, 0).unwrap().is_none());
    assert!(resolver.calls.lock().unwrap().is_empty());
    let clip = Clip::from_source_range(
        ClipId(1202),
        ClipSource::Media(media),
        0,
        4,
        0,
        vv_core::Rational::one(),
    );
    assert_eq!(
        provider.frame_for(&project, &clip, 0).err().unwrap(),
        ExportError::Failed("resolver refused source".into())
    );
    assert!(provider.active.is_empty());
    assert_eq!(resolver.calls.lock().unwrap().len(), 1);
    assert!(resolver.leases.lock().unwrap().is_empty());
    let fixture = ResolverFixture::new();
    let invalid = fixture.root.join("invalid.mp4");
    std::fs::write(&invalid, b"not a movie").unwrap();
    let resolver = Arc::new(TestVideoResolver {
        paths: HashMap::from([(media, invalid)]),
        ..Default::default()
    });
    provider.resolver = Some(resolver.clone());
    assert!(provider.frame_for(&project, &clip, 0).is_err());
    assert!(provider.active.is_empty());
    assert!(resolver.leases.lock().unwrap()[0].upgrade().is_none());
}

#[cfg(target_os = "linux")]
#[test]
fn video_source_resolver_preview_invalid_origin_is_rejected_without_opening_any_media() {
    let mut project = Project::default();
    let mut track = Track::new(TrackKind::Video);
    track.insert_sorted(solid_color_clip(1, 0, 10, red()));
    let timeline = project.timelines.insert(timeline_with(vec![track]));
    let before = serde_json::to_value(&project).unwrap();
    let mut settings = ExportSettings::new(PathBuf::from("unused-resolver-preview.mp4"));
    settings.audio_render_origin = Some(6);
    let resolver = Arc::new(TestVideoResolver::default());
    let progress = Mutex::new(ExportProgress::default());
    let cancel = Arc::new(AtomicBool::new(false));
    assert!(
        export_timeline_preview_with_gpu_with_resolver(
            &project,
            timeline,
            &settings,
            5..10,
            &progress,
            &cancel,
            || panic!("Invalid origin must not create a compositor"),
            |_| Ok(()),
            2,
            None,
            &PreviewVideoSources::new(),
            Some(resolver.clone())
        )
        .is_err()
    );
    assert!(resolver.calls.lock().unwrap().is_empty());
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
}

#[test]
fn web_audio_origin_invalid_lineage_is_rejected_before_encoder_or_compositor_creation() {
    let mut project = Project::default();
    let mut track = Track::new(TrackKind::Video);
    track.insert_sorted(solid_color_clip(1, 0, 10, red()));
    let id = project.timelines.insert(timeline_with(vec![track]));
    let mut settings =
        ExportSettings::new(std::env::temp_dir().join("vv-audio-origin-invalid.mp4"));
    assert_eq!(settings.audio_render_origin, None);
    let progress = Mutex::new(ExportProgress::default());
    let cancel = Arc::new(AtomicBool::new(false));
    for origin in [-1, 6] {
        settings.audio_render_origin = Some(origin);
        assert!(
            export_timeline_preview_with_gpu(
                &project,
                id,
                &settings,
                5..10,
                &progress,
                &cancel,
                || panic!("invalid preview origin must not create a compositor"),
                |_| Ok(()),
                1,
                None,
                &PreviewVideoSources::new(),
            )
            .is_err()
        );
        assert!(
            export_timeline_with_gpu_cancellable(
                &project,
                id,
                &settings,
                5..10,
                &progress,
                &cancel,
                || panic!("invalid audio origin must not create a compositor"),
                |_| Ok(()),
                1,
            )
            .is_err()
        );
        assert!(
            export_timeline_with_gpu_observed(
                &project,
                id,
                &settings,
                5..10,
                &progress,
                &cancel,
                || panic!("invalid observed origin must not create a compositor"),
                |_| Ok(()),
                1,
                &mut |_, _, _| panic!("invalid observed origin must not publish telemetry")
            )
            .is_err()
        );
    }
    settings.audio_render_origin = Some(0);
    assert!(
        export_timeline_with_gpu(
            &project,
            id,
            &settings,
            5..10,
            &progress,
            &cancel,
            || panic!("origin replay requires shared cancellation before any GPU work"),
            |_| Ok(()),
            1,
        )
        .is_err()
    );
}

#[test]
fn scope_isolation_ignores_covering_tracks_and_keeps_adjustment_inputs() {
    let mut project = Project::default();
    let mut lower = Track::new(TrackKind::Video);
    lower.insert_sorted(solid_color_clip(1, 0, 4, red()));
    let mut upper = Track::new(TrackKind::Video);
    upper.insert_sorted(solid_color_clip(2, 0, 4, blue()));
    let mut adjustment = solid_color_clip(3, 0, 4, red());
    adjustment.source = ClipSource::Adjustment;
    let mut top = Track::new(TrackKind::Video);
    top.insert_sorted(adjustment);
    let mut timeline = timeline_with(vec![lower, upper, top]);
    timeline.resolution = (64, 36);
    assert_eq!(
        scope_isolation(&timeline, vv_core::ClipId(1), 0).unwrap(),
        (0, false)
    );
    assert_eq!(
        scope_isolation(&timeline, vv_core::ClipId(3), 0).unwrap(),
        (2, true)
    );
    assert!(scope_isolation(&timeline, vv_core::ClipId(1), 4).is_err());
    assert!(scope_isolation(&timeline, vv_core::ClipId(99), 0).is_err());
    let id = project.timelines.insert(timeline);
    let mut compositor = vv_render::Compositor::new_headless();
    compositor.set_precision(vv_core::ProcessingPrecision::Standard);
    for (clip, expected) in [(1, [255u8, 0, 0, 255]), (3, [0, 0, 255, 255])] {
        let texture = render_scope_source(
            &project,
            id,
            vv_core::ClipId(clip),
            0,
            (64, 36),
            &compositor,
        )
        .unwrap();
        let pixels = compositor.read_rgba_texture(&texture, 64, 36);
        let balanced_input = render_balance_frame_rgba(
            &project,
            id,
            vv_core::ClipId(clip),
            0,
            (64, 36),
            &compositor,
        )
        .unwrap();
        assert_eq!(balanced_input, pixels);
        assert!(
            pixels
                .as_chunks::<4>()
                .0
                .iter()
                .all(|p| p.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1)),
            "scope target {clip}"
        );
    }
}

#[test]
fn headless_host_gpu_hooks_guard_both_native_stages_without_changing_output() {
    use std::sync::atomic::AtomicUsize;
    let mut project = Project::default();
    let mut track = Track::new(TrackKind::Video);
    track.insert_sorted(solid_color_clip(1, 0, 4, red()));
    let mut timeline = timeline_with(vec![track]);
    timeline.resolution = (64, 36);
    let id = project.timelines.insert(timeline);
    let path = std::env::temp_dir().join(format!("vv-export-guard-{}.mp4", std::process::id()));
    let settings = ExportSettings::new(path.clone());
    let progress = Mutex::new(ExportProgress::default());
    let gate = Mutex::new(());
    let entries = AtomicUsize::new(0);
    let completions = AtomicUsize::new(0);
    struct Permit<'a> {
        _guard: std::sync::MutexGuard<'a, ()>,
        completions: &'a AtomicUsize,
    }
    impl Drop for Permit<'_> {
        fn drop(&mut self) {
            self.completions.fetch_add(1, Ordering::Relaxed);
        }
    }
    export_timeline_with_gpu(
        &project,
        id,
        &settings,
        0..4,
        &progress,
        &AtomicBool::new(false),
        || Ok(vv_render::Compositor::new_headless()),
        |_| {
            let guard = gate.lock().unwrap();
            entries.fetch_add(1, Ordering::Relaxed);
            Ok(Permit {
                _guard: guard,
                completions: &completions,
            })
        },
        2,
    )
    .unwrap();
    assert_eq!(entries.load(Ordering::Relaxed), 8);
    assert_eq!(completions.load(Ordering::Relaxed), 8);
    assert_eq!(progress.lock().unwrap().current_frame, 4);
    assert!(progress.lock().unwrap().done);
    let meta = vv_media::probe_media(&path).unwrap();
    assert_eq!((meta.width, meta.height), (64, 36));
    std::fs::remove_file(path).unwrap();
}

fn solid_color_clip(id: u64, start: FrameIdx, len: FrameIdx, color: Rgba) -> Clip {
    let mut clip = Clip::from_source_range(
        ClipId(id),
        ClipSource::SolidColor,
        0,
        len,
        start,
        vv_core::Rational::one(),
    );
    clip.effects.color = Some(Keyframed::constant(color));
    clip
}

fn timeline_with(tracks: Vec<Track>) -> Timeline {
    Timeline {
        name: "t".into(),
        fps: vv_core::Rational::new(25, 1),
        resolution: (4, 2),
        tracks,
        markers: Vec::new(),
        master: Default::default(),
    }
}

// BT.709 limited range, like `Compositor::render_layers_i420`.
const BLACK_I420: [u8; 3] = [16, 128, 128];
const RED_I420: [u8; 3] = [63, 102, 240];
const BLUE_I420: [u8; 3] = [32, 240, 118];

fn solid_i420(width: usize, height: usize, [y, u, v]: [u8; 3]) -> Vec<u8> {
    let chroma = width.div_ceil(2) * height.div_ceil(2);
    let mut data = vec![y; width * height];
    data.extend(std::iter::repeat_n(u, chroma));
    data.extend(std::iter::repeat_n(v, chroma));
    data
}

/// The I420 conversion dithers: a solid color off an 8-bit level comes out
/// one level up or down.
fn assert_i420_near(got: &[u8], expected: &[u8], context: &str) {
    assert_eq!(got.len(), expected.len(), "{context}");
    assert!(
        got.iter().zip(expected).all(|(a, b)| a.abs_diff(*b) <= 1),
        "{context}: {got:?} vs {expected:?}"
    );
}

fn red() -> Rgba {
    Rgba {
        r: 1.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    }
}

fn blue() -> Rgba {
    Rgba {
        r: 0.0,
        g: 0.0,
        b: 1.0,
        a: 1.0,
    }
}

#[test]
fn render_video_frame_returns_black_in_a_gap() {
    let project = Project::default();
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Video,
        clips: vec![solid_color_clip(1, 10, 5, red())],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);
    let compositor = vv_render::Compositor::new_headless();
    let mut active = StreamingFrameProvider::default();
    let frame = render_video_frame(&project, &tl, &compositor, &mut active, 0, (2, 2)).unwrap();
    assert_i420_near(&frame, &solid_i420(2, 2, BLACK_I420), "frame");
}

#[test]
fn render_video_frame_reads_solid_color_at_the_clips_source_frame() {
    let project = Project::default();
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Video,
        clips: vec![solid_color_clip(1, 10, 5, red())],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);
    let compositor = vv_render::Compositor::new_headless();
    let mut active = StreamingFrameProvider::default();
    let frame = render_video_frame(&project, &tl, &compositor, &mut active, 12, (2, 2)).unwrap();
    assert_i420_near(&frame, &solid_i420(2, 2, RED_I420), "frame");
}

/// A video clip inside the nested timeline of a compound clip must
/// show up in the exported frame, at the position of the compound clip
/// in the outer timeline — not before/after, and not at the one it
/// would have in its nested timeline.
#[test]
fn render_video_frame_recurses_into_a_compound_clips_nested_timeline() {
    let mut project = Project::default();
    let nested_id = project.timelines.insert(Timeline {
        name: "Nested".into(),
        fps: vv_core::Rational::new(25, 1),
        resolution: (2, 2),
        tracks: vec![Track {
            kind: TrackKind::Video,
            clips: vec![solid_color_clip(1, 0, 10, red())],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        }],
        markers: Vec::new(),
        master: Default::default(),
    });
    let compound_media = project.media_pool.insert(vv_core::MediaItem {
        path: "Compound Clip 1".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 10,
            fps: vv_core::Rational::new(25, 1),
            width: 2,
            height: 2,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 1,
        compound: Some(nested_id),
        folder: None,
    });
    let compound_clip = Clip::from_source_range(
        ClipId(2),
        ClipSource::Media(compound_media),
        0,
        10,
        5,
        vv_core::Rational::one(),
    );
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Video,
        clips: vec![compound_clip],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);
    let compositor = vv_render::Compositor::new_headless();
    let mut provider = StreamingFrameProvider::default();

    let before = render_video_frame(&project, &tl, &compositor, &mut provider, 0, (2, 2)).unwrap();
    assert_i420_near(
        &before,
        &solid_i420(2, 2, BLACK_I420),
        "before the compound clip: empty",
    );

    let during = render_video_frame(&project, &tl, &compositor, &mut provider, 7, (2, 2)).unwrap();
    assert_i420_near(
        &during,
        &solid_i420(2, 2, RED_I420),
        "inside: the content of the nested timeline",
    );
}

/// The decoder of a clip inside a compound clip stays open from one frame to
/// the next: reopening and seeking it cost about 90 ms a frame.
#[test]
fn the_decoders_of_nested_clips_stay_open_between_frames() {
    let dir = std::env::temp_dir().join("vv-app-export-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("nested_decoder_source.mkv");
    vv_media::test_support::ffmpeg(
        &["-f", "lavfi", "-i", "color=c=red:size=4x2:rate=25:d=1"],
        &path,
    );
    let mut project = Project::default();
    let media = project.media_pool.insert(vv_core::MediaItem {
        path: path.clone(),
        meta: vv_media::probe::probe(&path).unwrap(),
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let nested_clip = Clip::from_source_range(
        ClipId(1),
        ClipSource::Media(media),
        0,
        20,
        0,
        vv_core::Rational::one(),
    );
    let nested_id = project.timelines.insert(Timeline {
        name: "Nested".into(),
        fps: vv_core::Rational::new(25, 1),
        resolution: (4, 2),
        tracks: vec![Track {
            kind: TrackKind::Video,
            clips: vec![nested_clip],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        }],
        markers: Vec::new(),
        master: Default::default(),
    });
    let compound_media = project.media_pool.insert(vv_core::MediaItem {
        path: "Compound Clip 1".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 20,
            fps: vv_core::Rational::new(25, 1),
            width: 4,
            height: 2,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 2,
        compound: Some(nested_id),
        folder: None,
    });
    let compound_clip = Clip::from_source_range(
        ClipId(2),
        ClipSource::Media(compound_media),
        0,
        10,
        0,
        vv_core::Rational::one(),
    );
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Video,
        clips: vec![compound_clip],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);
    let compositor = vv_render::Compositor::new_headless();
    let mut provider = StreamingFrameProvider::default();
    for frame in [3, 4] {
        render_video_frame(&project, &tl, &compositor, &mut provider, frame, (4, 2)).unwrap();
        assert!(provider.active.contains_key(&ClipId(1)), "frame {frame}");
    }
    render_video_frame(&project, &tl, &compositor, &mut provider, 15, (4, 2)).unwrap();
    assert!(provider.active.is_empty(), "past the compound clip: closed");
}

/// Bug reported by the user: a compound clip is a timeline like any
/// other, so where its nested timeline has nothing to show it must
/// stay transparent and let the track below show through —
/// not cover it with black.
#[test]
fn render_video_frame_lets_the_track_below_show_through_the_compound_clips_empty_area() {
    let mut project = Project::default();
    let mut nested_clip = solid_color_clip(1, 0, 10, red());
    // Cuts away the right half (crop in timeline pixels, nested 4x2).
    nested_clip.effects.transform = vv_core::TransformTracks::constant(vv_core::Transform {
        crop: [0.0, 0.0, 2.0, 0.0],
        ..Default::default()
    });
    let nested_id = project.timelines.insert(Timeline {
        name: "Nested".into(),
        fps: vv_core::Rational::new(25, 1),
        resolution: (4, 2),
        tracks: vec![Track {
            kind: TrackKind::Video,
            clips: vec![nested_clip],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        }],
        markers: Vec::new(),
        master: Default::default(),
    });
    let compound_media = project.media_pool.insert(vv_core::MediaItem {
        path: "Compound Clip 1".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 10,
            fps: vv_core::Rational::new(25, 1),
            width: 4,
            height: 2,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 1,
        compound: Some(nested_id),
        folder: None,
    });
    let compound_clip = Clip::from_source_range(
        ClipId(2),
        ClipSource::Media(compound_media),
        0,
        10,
        0,
        vv_core::Rational::one(),
    );
    let tl = timeline_with(vec![
        Track {
            kind: TrackKind::Video,
            clips: vec![solid_color_clip(3, 0, 10, blue())],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
        Track {
            kind: TrackKind::Video,
            clips: vec![compound_clip],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
    ]);
    let compositor = vv_render::Compositor::new_headless();
    let mut provider = StreamingFrameProvider::default();

    let frame = render_video_frame(&project, &tl, &compositor, &mut provider, 0, (4, 2)).unwrap();
    // Y plane, one byte per pixel: left covered by the red of the
    // compound clip, right uncovered (the blue below must show).
    assert_i420_near(
        &frame[0..1],
        &RED_I420[..1],
        "left: the red of the compound clip",
    );
    assert_i420_near(
        &frame[3..4],
        &BLUE_I420[..1],
        "right: the blue of the track below, not black",
    );
}

/// A PNG with transparency imported into the pool must let the track
/// below show through where it is transparent, not cover it: its alpha must
/// be preserved from decode all the way to compositing.
#[test]
fn render_video_frame_lets_the_track_below_show_through_a_transparent_png() {
    let dir = std::env::temp_dir().join("vv-app-export-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("half_transparent.png");
    // Left half opaque red, right half fully transparent.
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=4x2:d=1",
            "-vf",
            "format=rgba,geq=r='255':g='0':b='0':a='if(lt(X,2),255,0)'",
            "-frames:v",
            "1",
            "-update",
            "1",
        ],
        &path,
    );

    let mut project = Project::default();
    let meta = vv_media::probe::probe_image(&path).expect("PNG probe failed");
    let png_media = project.media_pool.insert(vv_core::MediaItem {
        path: path.clone(),
        meta,
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let png_clip = Clip::from_source_range(
        ClipId(2),
        ClipSource::Media(png_media),
        0,
        10,
        0,
        vv_core::Rational::one(),
    );
    let tl = timeline_with(vec![
        Track {
            kind: TrackKind::Video,
            clips: vec![solid_color_clip(3, 0, 10, blue())],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
        Track {
            kind: TrackKind::Video,
            clips: vec![png_clip],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
    ]);
    let compositor = vv_render::Compositor::new_headless();
    let mut provider = StreamingFrameProvider::default();

    let frame = render_video_frame(&project, &tl, &compositor, &mut provider, 0, (4, 2)).unwrap();
    assert!(
        (frame[0] as i16 - RED_I420[0] as i16).abs() <= 4,
        "left: the opaque red of the PNG, not the blue ({})",
        frame[0]
    );
    assert!(
        (frame[3] as i16 - BLUE_I420[0] as i16).abs() <= 4,
        "right: transparent, the blue below must show ({})",
        frame[3]
    );
}

#[test]
fn render_video_frame_applies_the_transform_to_a_solid_color_clip() {
    let project = Project::default();
    let mut clip = solid_color_clip(1, 0, 5, red());
    // Crop in timeline pixels (4x2): away with the right half.
    clip.effects.transform = vv_core::TransformTracks::constant(vv_core::Transform {
        crop: [0.0, 0.0, 2.0, 0.0],
        ..Default::default()
    });
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Video,
        clips: vec![clip],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);
    let compositor = vv_render::Compositor::new_headless();
    let mut active = StreamingFrameProvider::default();
    let frame = render_video_frame(&project, &tl, &compositor, &mut active, 0, (4, 2)).unwrap();
    // First row of the Y plane.
    assert_i420_near(&frame[0..=0], &RED_I420[..1], "pixel 0");
    assert_i420_near(&frame[3..=3], &BLACK_I420[..1], "pixel 3");
}

/// A media missing from the pool is an `Err`, not a black frame.
#[test]
fn render_video_frame_fails_loudly_when_the_clip_references_a_missing_media() {
    let missing_media_id = {
        let mut other_project = Project::default();
        other_project.media_pool.insert(vv_core::MediaItem {
            path: "dummy.mp4".into(),
            meta: vv_core::MediaMeta {
                duration_frames: 0,
                fps: vv_core::Rational::new(25, 1),
                width: 0,
                height: 0,
                has_video: true,
                has_audio: false,
                sample_rate: 0,
                channels: 0,
                audio_streams: 0,
                file: Default::default(),
            },
            content_hash: 0,
            compound: None,
            folder: None,
        })
    };
    let project = Project::default();
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Video,
        clips: vec![Clip::from_source_range(
            ClipId(1),
            ClipSource::Media(missing_media_id),
            0,
            10,
            0,
            vv_core::Rational::one(),
        )],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);
    let compositor = vv_render::Compositor::new_headless();
    let mut provider = StreamingFrameProvider::default();
    let err = render_video_frame(&project, &tl, &compositor, &mut provider, 0, (2, 2))
        .expect_err("a media missing from the pool must fail, not produce a black frame");
    assert_eq!(err, ExportError::MediaNotFound);
}

/// Where the top track has no clip, the one below shows.
#[test]
fn render_video_frame_prefers_the_topmost_video_track() {
    let project = Project::default();
    let tl = timeline_with(vec![
        Track {
            kind: TrackKind::Video,
            clips: vec![solid_color_clip(1, 0, 30, red())],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
        Track {
            kind: TrackKind::Video,
            clips: vec![solid_color_clip(2, 10, 10, blue())],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
    ]);
    let compositor = vv_render::Compositor::new_headless();
    let mut provider = StreamingFrameProvider::default();

    let below = render_video_frame(&project, &tl, &compositor, &mut provider, 5, (2, 2)).unwrap();
    assert_i420_near(
        &below,
        &solid_i420(2, 2, RED_I420),
        "below the top track: the bottom one shows",
    );

    let above = render_video_frame(&project, &tl, &compositor, &mut provider, 15, (2, 2)).unwrap();
    assert_i420_near(
        &above,
        &solid_i420(2, 2, BLUE_I420),
        "the top track has a clip here: it wins",
    );
}

#[test]
fn mix_audio_track_is_silence_when_no_audio_track_has_clips() {
    let project = Project::default();
    let tl = timeline_with(vec![
        Track {
            kind: TrackKind::Video,
            clips: vec![solid_color_clip(1, 0, 25, red())],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
        Track {
            kind: TrackKind::Audio,
            clips: vec![],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        },
    ]);
    let mixed = mix_audio_track(&project, &tl, 0..25).unwrap();
    assert_eq!(
        mixed.len(),
        (PROJECT_SAMPLE_RATE as usize) * PROJECT_CHANNELS as usize
    );
    assert!(mixed.iter().all(|&s| s == 0.0));
}

/// A real audio file inside the nested timeline of a compound clip
/// must reach the export mix, at the position of the compound
/// clip in the outer timeline — not at the one it would have in its
/// nested timeline.
#[test]
fn mix_audio_track_recurses_into_a_compound_clips_nested_timeline() {
    let dir = std::env::temp_dir().join("vv-app-export-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("compound_audio_source.wav");
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=1",
        ],
        &path,
    );

    let mut project = Project::default();
    let real_media = project.media_pool.insert(vv_core::MediaItem {
        path: path.clone(),
        meta: vv_core::MediaMeta {
            duration_frames: 25,
            fps: vv_core::Rational::new(25, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48_000,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let real_clip = Clip::from_source_range(
        ClipId(100),
        ClipSource::Media(real_media),
        0,
        25,
        0,
        vv_core::Rational::one(),
    );
    let nested_id = project.timelines.insert(Timeline {
        name: "Nested".into(),
        fps: vv_core::Rational::new(25, 1),
        resolution: (1, 1),
        tracks: vec![Track {
            kind: TrackKind::Audio,
            clips: vec![real_clip],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        }],
        markers: Vec::new(),
        master: Default::default(),
    });
    let compound_media = project.media_pool.insert(vv_core::MediaItem {
        path: "Compound Clip 1".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 25,
            fps: vv_core::Rational::new(25, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48_000,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 2,
        compound: Some(nested_id),
        folder: None,
    });
    // At 25 (1s after the start): silence before, sine wave during.
    let compound_clip = Clip::from_source_range(
        ClipId(1),
        ClipSource::Media(compound_media),
        0,
        25,
        25,
        vv_core::Rational::one(),
    );
    let tl = timeline_with(vec![Track {
        kind: TrackKind::Audio,
        clips: vec![compound_clip],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    }]);

    let mixed = mix_audio_track(&project, &tl, 0..50).unwrap();
    let per_second = PROJECT_SAMPLE_RATE as usize * PROJECT_CHANNELS as usize;
    assert!(
        mixed[..per_second].iter().all(|&s| s == 0.0),
        "silence before the compound clip"
    );
    assert!(
        mixed[per_second..].iter().any(|&s| s.abs() > 0.01),
        "the nested timeline content reaches the mix at the compound clip position"
    );
}

/// Regression for a user report of audio running ahead of the
/// video on export (perceived with mpv, 2-3 frames): a black->white
/// flash (`ClipSource::SolidColor`, no video encode/decode
/// involved in its position) and a beep (a real audio clip) that
/// start at the same timeline frame, at a fractional NTSC fps
/// (30000/1001) on purpose so that `PROJECT_SAMPLE_RATE / fps` is not an
/// integer (at 24fps it is exactly 2000, which would hide a
/// rounding bug) — the real case isolated from the report
/// was already at an integer fps, and here it comes out perfectly in
/// sync anyway: if this test breaks, the bug is in the
/// frame<->sample rounding of `export.rs`/`encode.rs`/`vv_audio::mixer`, not
/// in the original cause of the report (probably on the
/// player side, not in this export).
#[test]
fn export_keeps_video_and_audio_frame_accurate_at_a_fractional_ntsc_fps() {
    let dir = std::env::temp_dir().join("vv-app-diag-avsync-frac");
    std::fs::create_dir_all(&dir).unwrap();
    let beep_path = dir.join("beep.wav");
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=1",
        ],
        &beep_path,
    );

    let mut project = Project::default();
    let beep_media = project.media_pool.insert(vv_core::MediaItem {
        path: beep_path,
        meta: vv_core::MediaMeta {
            duration_frames: 30,
            fps: vv_core::Rational::new(30000, 1001),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48_000,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 1,
        compound: None,
        folder: None,
    });
    const FLASH_FRAME: FrameIdx = 20;
    let beep_clip = Clip::from_source_range(
        ClipId(1),
        ClipSource::Media(beep_media),
        0,
        25,
        FLASH_FRAME,
        vv_core::Rational::one(),
    );
    let tl = Timeline {
        name: "diag".into(),
        fps: vv_core::Rational::new(30000, 1001),
        resolution: (64, 48),
        tracks: vec![
            Track {
                kind: TrackKind::Video,
                clips: vec![
                    solid_color_clip(10, 0, FLASH_FRAME, black()),
                    solid_color_clip(11, FLASH_FRAME, 15, white()),
                ],
                muted: false,
                solo: false,
                locked: false,
                crossings: Vec::new(),
                mix: Default::default(),
                armed: Default::default(),
            },
            Track {
                kind: TrackKind::Audio,
                clips: vec![beep_clip],
                muted: false,
                solo: false,
                locked: false,
                crossings: Vec::new(),
                mix: Default::default(),
                armed: Default::default(),
            },
        ],
        markers: Vec::new(),
        master: Default::default(),
    };
    let timeline_id = project.timelines.insert(tl);

    let output_path = dir.join("out.mp4");
    let progress = Mutex::new(ExportProgress::default());
    let cancel = AtomicBool::new(false);
    let total = project.timelines[timeline_id].total_frames();
    let settings = ExportSettings::new(output_path.clone());
    export_timeline(
        &project,
        timeline_id,
        &settings,
        0..total,
        &progress,
        &cancel,
    )
    .expect("export failed");

    let fps = 30000.0_f64 / 1001.0;

    let mut decoder = vv_media::Decoder::open(&output_path).unwrap();
    let mut white_frame_idx = None;
    let mut idx = 0i64;
    while let Some((_, frame)) = decoder.next_frame().unwrap() {
        let avg_y = frame.y.iter().map(|&b| b as u64).sum::<u64>() / frame.y.len() as u64;
        if avg_y > 128 && white_frame_idx.is_none() {
            white_frame_idx = Some(idx);
        }
        idx += 1;
    }
    let white_frame_idx = white_frame_idx.expect("no white frame found in the export");

    let audio = vv_media::decode_audio_track(&output_path, 0)
        .unwrap()
        .expect("audio expected");
    let mut onset_sample = None;
    for (i, &s) in audio.samples.iter().enumerate() {
        if s.abs() > 0.05 {
            onset_sample = Some(i as u64 / audio.channels as u64);
            break;
        }
    }
    let onset_sample = onset_sample.expect("no audio onset found in the export");
    let onset_secs = onset_sample as f64 / audio.sample_rate as f64;
    let onset_frame = (onset_secs * fps).floor() as i64;

    assert_eq!(
        white_frame_idx, FLASH_FRAME,
        "the video flash is not at the expected frame"
    );
    assert_eq!(
        onset_frame,
        FLASH_FRAME,
        "the audio onset ({onset_secs:.6}s) falls in frame {onset_frame} instead of the video flash frame {FLASH_FRAME}: {} frame offset",
        FLASH_FRAME - onset_frame
    );
}

fn black() -> Rgba {
    Rgba {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    }
}

fn white() -> Rgba {
    Rgba {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    }
}

#[test]
fn preferred_settings_pick_the_faster_encoders_only_when_available() {
    let settings = ExportSettings::preferred(PathBuf::from("out.mp4"));
    let nvenc = vv_media::VideoCodec::Nvenc.is_available();
    assert_eq!(settings.video.codec == vv_media::VideoCodec::Nvenc, nvenc);
    assert_eq!(settings.video.preset, settings.video.codec.default_preset());
    let fdk = vv_media::AudioCodec::FdkAac.is_available();
    let audio = settings.audio.expect("audio included by default");
    assert_eq!(audio.codec == vv_media::AudioCodec::FdkAac, fdk);
}

/// 2 s of a 440 Hz sine at 200%: 1 s on the timeline, at 440 Hz with pitch
/// correction and at 880 Hz without.
#[test]
fn mix_audio_track_plays_a_faster_clip_with_or_without_its_pitch() {
    let dir = std::env::temp_dir().join("vv-app-export-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("speed_source.wav");
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
        ],
        &path,
    );
    let mut project = Project::default();
    let media = project.media_pool.insert(vv_core::MediaItem {
        path,
        meta: vv_core::MediaMeta {
            duration_frames: 50,
            fps: vv_core::Rational::new(25, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48_000,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let frequency = |pitch_correction: bool| {
        let mut clip = Clip::new(
            ClipId(1),
            ClipSource::Media(media),
            0,
            0,
            25,
            vv_core::Rational::one(),
            vv_core::Rational::new(2, 1),
        );
        clip.pitch_correction = pitch_correction;
        let tl = timeline_with(vec![Track {
            kind: TrackKind::Audio,
            clips: vec![clip],
            muted: false,
            solo: false,
            locked: false,
            crossings: Vec::new(),
            mix: Default::default(),
            armed: Default::default(),
        }]);
        let mixed = mix_audio_track(&project, &tl, 0..25).unwrap();
        // First channel, the middle half second: away from the stretch's edges.
        let mono: Vec<f32> = mixed
            .iter()
            .step_by(PROJECT_CHANNELS as usize)
            .copied()
            .collect();
        let window = &mono[12_000..36_000];
        let crossings = window
            .windows(2)
            .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
            .count();
        crossings as f64 / 2.0 / 0.5
    };
    let corrected = frequency(true);
    let varispeed = frequency(false);
    assert!(
        (corrected - 440.0).abs() < 20.0,
        "pitch kept: {corrected} Hz"
    );
    assert!(
        (varispeed - 880.0).abs() < 20.0,
        "pitch follows: {varispeed} Hz"
    );
}

/// A range is resampled like the whole file.
#[test]
fn mix_audio_track_of_a_range_is_the_same_part_of_the_whole_mix() {
    let dir = std::env::temp_dir().join("vv-app-export-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("range_source.wav");
    vv_media::test_support::ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=sin(40*t*t):sample_rate=44100:duration=4",
        ],
        &path,
    );
    let mut project = Project::default();
    let media = project.media_pool.insert(vv_core::MediaItem {
        path,
        meta: vv_core::MediaMeta {
            duration_frames: 100,
            fps: vv_core::Rational::new(25, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 44_100,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let clip = |id, source_in, start| {
        Clip::from_source_range(
            ClipId(id),
            ClipSource::Media(media),
            source_in,
            source_in + 40,
            start,
            vv_core::Rational::one(),
        )
    };
    let faster = Clip::new(
        ClipId(2),
        ClipSource::Media(media),
        10,
        20,
        30,
        vv_core::Rational::one(),
        vv_core::Rational::new(3, 2),
    );
    let track = |clips| Track {
        kind: TrackKind::Audio,
        clips,
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    };
    let tl = timeline_with(vec![track(vec![clip(1, 30, 5)]), track(vec![faster])]);

    let whole = mix_audio_track(&project, &tl, 0..75).unwrap();
    let part = mix_audio_track(&project, &tl, 30..40).unwrap();
    let per_frame = (PROJECT_SAMPLE_RATE / 25) as usize * PROJECT_CHANNELS as usize;
    assert_eq!(part, whole[30 * per_frame..40 * per_frame]);
    assert!(part.iter().any(|&s| s.abs() > 0.1));
}

const PRECISION_BENCH_SCENES: [&str; 4] = ["plain", "blur", "chain", "compound"];

fn bench_filter(kind: vv_core::FilterKind, radius: f32, amount: f32) -> vv_core::ClipFilter {
    vv_core::ClipFilter {
        radius: Keyframed::constant(radius),
        amount: Keyframed::constant(amount),
        ..vv_core::ClipFilter::new(kind)
    }
}

fn bench_video_track(clips: Vec<Clip>) -> Track {
    Track {
        clips,
        ..Track::new(TrackKind::Video)
    }
}

/// The scenes of plans/FLOAT_INTERMEDIATES.md §4, `frames` long, on `clips`
/// (the second one only for the blur picture-in-picture).
fn precision_bench_project(
    scene: &str,
    clips: &[std::path::PathBuf],
    resolution: (u32, u32),
    frames: FrameIdx,
) -> (Project, TimelineId) {
    use vv_core::FilterKind::{BoxBlur, Exposure, GaussianBlur};
    let mut project = Project::default();
    let media: Vec<_> = clips
        .iter()
        .map(|path| {
            let meta = vv_media::probe::probe_media(path).expect("probe failed");
            project.media_pool.insert(vv_core::MediaItem {
                path: path.clone(),
                meta,
                content_hash: 1,
                compound: None,
                folder: None,
            })
        })
        .collect();
    let fps = project.media_pool[media[0]].meta.fps;
    let clip = |id, source| {
        Clip::from_source_range(ClipId(id), source, 0, frames, 0, vv_core::Rational::one())
    };
    let adjustment = |id, stops| {
        let mut adjustment = clip(id, ClipSource::Adjustment);
        adjustment
            .effects
            .filters
            .push(bench_filter(Exposure, 0.0, stops));
        adjustment
    };
    let timeline = |name: &str, tracks| Timeline {
        name: name.into(),
        fps,
        resolution,
        tracks,
        markers: Vec::new(),
        master: Default::default(),
    };
    let chain = || {
        let mut graded = clip(1, ClipSource::Media(media[0]));
        graded.effects.filters.extend([
            bench_filter(Exposure, 0.0, -3.0),
            bench_filter(GaussianBlur, 20.0, 0.0),
        ]);
        vec![
            bench_video_track(vec![graded]),
            bench_video_track(vec![adjustment(2, 3.0)]),
        ]
    };
    let tracks = match scene {
        "plain" => vec![bench_video_track(vec![clip(
            1,
            ClipSource::Media(media[0]),
        )])],
        "blur" => {
            let mut full = clip(1, ClipSource::Media(media[0]));
            full.effects
                .filters
                .push(bench_filter(GaussianBlur, 250.0, 0.0));
            let mut inset = clip(2, ClipSource::Media(*media.last().unwrap()));
            inset.effects.filters.push(bench_filter(BoxBlur, 40.0, 0.0));
            inset.effects.transform = vv_core::TransformTracks::constant(vv_core::Transform {
                zoom: [0.5, 0.5],
                ..Default::default()
            });
            vec![
                bench_video_track(vec![full]),
                bench_video_track(vec![inset]),
            ]
        }
        "chain" => chain(),
        "compound" => {
            let nested = project.timelines.insert(timeline("Nested", chain()));
            let meta = vv_core::MediaMeta {
                duration_frames: frames,
                fps,
                width: resolution.0,
                height: resolution.1,
                has_video: true,
                has_audio: false,
                sample_rate: 0,
                channels: 0,
                audio_streams: 0,
                file: Default::default(),
            };
            let compound = project.media_pool.insert(vv_core::MediaItem {
                path: "Compound Clip 1".into(),
                meta,
                content_hash: 2,
                compound: Some(nested),
                folder: None,
            });
            vec![
                bench_video_track(vec![clip(3, ClipSource::Media(compound))]),
                bench_video_track(vec![adjustment(4, 0.5)]),
            ]
        }
        other => panic!("unknown scene {other}"),
    };
    let id = project.timelines.insert(timeline("Bench", tracks));
    (project, id)
}

/// Peak of `VmHWM`-like fields of /proc/self/status, in MiB.
fn proc_status_mib(field: &str) -> Option<f64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with(field))?;
    let kib: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kib / 1024.0)
}

/// This process's GPU memory and the GPU's memory-controller load, from
/// `nvidia-smi` (absent elsewhere): `(MiB, percent)`.
fn nvidia_sample() -> Option<(Option<f64>, f64)> {
    let pid = std::process::id().to_string();
    let run = |args: &[&str]| {
        let out = std::process::Command::new("nvidia-smi")
            .args(args)
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    };
    let util: f64 = run(&[
        "--query-gpu=utilization.memory",
        "--format=csv,noheader,nounits",
    ])?
    .trim()
    .lines()
    .next()?
    .trim()
    .parse()
    .ok()?;
    let table = run(&[])?;
    let vram = table
        .lines()
        .find(|l| l.split_whitespace().any(|w| w == pid))
        .and_then(|l| {
            l.split_whitespace()
                .find_map(|w| w.strip_suffix("MiB"))?
                .parse()
                .ok()
        });
    Some((vram, util))
}

/// One scene at one precision and resolution, in this process: decode and
/// compose `VV_BENCH_FRAMES` frames as the export does, then print a
/// `RESULT` line for `bench_processing_precision`.
fn run_precision_bench(scene: &str, precision: vv_core::ProcessingPrecision, height: u32) {
    let frames: FrameIdx = std::env::var("VV_BENCH_FRAMES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(120);
    let clips: Vec<std::path::PathBuf> = std::env::var("VV_BENCH_CLIPS")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    let clips = if clips.is_empty() {
        let path = std::env::temp_dir().join("vv-precision-bench-1080p.mkv");
        if !path.exists() {
            vv_media::test_support::ffmpeg(
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=1920x1080:rate=30:duration=10",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                ],
                &path,
            );
        }
        vec![path]
    } else {
        clips
    };
    let resolution = (height * 16 / 9, height);
    let (project, timeline_id) = precision_bench_project(scene, &clips, resolution, frames);
    let timeline = &project.timelines[timeline_id];

    let compositor = vv_render::Compositor::new_headless_with_precision(precision);
    let baseline = nvidia_sample().and_then(|(vram, _)| vram);
    let stop = std::sync::atomic::AtomicBool::new(false);
    let composing = std::sync::atomic::AtomicBool::new(false);
    let (decode, compose, samples) = std::thread::scope(|scope| {
        let sampler = scope.spawn(|| {
            let mut samples = Vec::new();
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                if let Some(sample) = nvidia_sample() {
                    samples.push((sample, composing.load(std::sync::atomic::Ordering::Relaxed)));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            samples
        });
        let output = vv_render::OutputFrame::exact(resolution.0, resolution.1);
        let mut provider = StreamingFrameProvider::default();
        let (mut decode, mut compose) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
        // The first frames allocate the pools and the decoders.
        const WARMUP: FrameIdx = 5;
        for frame in 0..frames {
            let start = std::time::Instant::now();
            let layers = decode_video_frame(
                &project,
                timeline,
                &mut provider,
                &compositor,
                frame,
                resolution,
            )
            .unwrap();
            let decoded = std::time::Instant::now();
            composing.store(true, std::sync::atomic::Ordering::Relaxed);
            compose_video_frame(&compositor, &layers, output);
            composing.store(false, std::sync::atomic::Ordering::Relaxed);
            if frame >= WARMUP {
                decode += decoded - start;
                compose += decoded.elapsed();
            }
        }
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        (decode, compose, sampler.join().unwrap())
    });
    let timed = (frames - 5).max(1) as f64;
    let peak_vram = samples
        .iter()
        .filter_map(|((v, _), _)| *v)
        .fold(None, |a: Option<f64>, v| Some(a.map_or(v, |a| a.max(v))));
    let utils: Vec<f64> = samples.iter().map(|((_, u), _)| *u).collect();
    let mean_util = (!utils.is_empty()).then(|| utils.iter().sum::<f64>() / utils.len() as f64);
    let fmt = |v: Option<f64>| v.map_or("-".to_owned(), |v| format!("{v:.0}"));
    println!(
        "RESULT {scene} {precision:?} {height}p | decode {:.1} ms | compose {:.1} ms | pools {:.0} MiB | VRAM {} MiB (+{}) | RSS peak {} MiB | mem ctrl {}% | {}",
        decode.as_secs_f64() * 1000.0 / timed,
        compose.as_secs_f64() * 1000.0 / timed,
        compositor.pooled_texture_bytes() as f64 / (1024.0 * 1024.0),
        fmt(peak_vram),
        fmt(peak_vram.zip(baseline).map(|(p, b)| p - b)),
        fmt(proc_status_mib("VmHWM")),
        fmt(mean_util),
        compositor.adapter_name(),
    );
}

/// Processing precision cost, one child process per scene x precision x
/// resolution so the peaks do not mix. Clips: `VV_BENCH_CLIPS` (a PATH-style
/// list; a synthetic 1080p clip without it), frames: `VV_BENCH_FRAMES`.
/// `cargo test --release -p vv-session bench_processing_precision -- --ignored --nocapture`.
#[test]
#[ignore = "manual measurement, not a correctness assertion"]
fn bench_processing_precision() {
    if let Ok(config) = std::env::var("VV_BENCH_CONFIG") {
        let mut parts = config.split(',');
        let (scene, precision, height) = (
            parts.next().unwrap(),
            parts.next().unwrap(),
            parts.next().unwrap().parse().unwrap(),
        );
        let precision = match precision {
            "High" => vv_core::ProcessingPrecision::High,
            _ => vv_core::ProcessingPrecision::Standard,
        };
        run_precision_bench(scene, precision, height);
        return;
    }
    let exe = std::env::current_exe().unwrap();
    for height in [1080, 2160] {
        for scene in PRECISION_BENCH_SCENES {
            for precision in ["Standard", "High"] {
                let out = std::process::Command::new(&exe)
                    .args([
                        "--exact",
                        "export::tests::bench_processing_precision",
                        "--ignored",
                        "--nocapture",
                    ])
                    .env("VV_BENCH_CONFIG", format!("{scene},{precision},{height}"))
                    .output()
                    .unwrap();
                let stdout = String::from_utf8_lossy(&out.stdout);
                // libtest prints it on the line of the test name.
                match stdout.lines().find_map(|l| l.split_once("RESULT ")) {
                    Some((_, result)) => println!("{result}"),
                    None => println!(
                        "{scene} {precision} {height}p failed:\n{}",
                        String::from_utf8_lossy(&out.stderr)
                    ),
                }
            }
        }
    }
}
