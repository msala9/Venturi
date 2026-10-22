use super::*;
use vv_core::{Clip, ClipId, ClipSource, Rational, Timeline, Track, TrackKind};

fn export_options() -> ExportOptions {
    serde_json::from_value(json!({"quality":18,"preset":"veryfast","audio":true})).unwrap()
}

#[test]
fn native_export_scale_metadata_and_settings_use_original_size_and_native_rounding() {
    for resolution in [
        (1920, 1080),
        (4096, 2160),
        (7680, 4320),
        (8192, 8192),
        (1919, 1079),
    ] {
        let choices = export_scales(resolution);
        let mut task = task();
        task.snapshot.project.timelines[task.snapshot.timeline].resolution = resolution;
        task.export = Some(export_options());
        for (index, percent) in ExportSettings::SCALE_CHOICES.into_iter().enumerate() {
            task.export.as_mut().unwrap().scale_percent = Some(percent);
            let settings = task.settings(Path::new("/tmp"));
            let mut native = ExportSettings::new(PathBuf::new());
            native.scale_percent = percent;
            let size = native.output_size(resolution);
            assert_eq!(settings.output_size(resolution), size);
            assert_eq!(
                choices[index],
                json!({"percent":percent,"width":size.0,"height":size.1})
            );
            assert_eq!(task.descriptor(Path::new("/tmp"))["width"], size.0);
            assert_eq!(task.descriptor(Path::new("/tmp"))["height"], size.1);
            validate_export_size(resolution, size).unwrap();
            if percent == 100 {
                assert_eq!(size, resolution);
            }
        }
    }
    assert!(
        crate::preview::frame_size((8192, 8192), 8192).is_err(),
        "Export scales must not broaden preview frame sizes"
    );
    for size in [(0, 1080), (1920, 0), (8193, 1080), (1920, 8193)] {
        assert!(validate_export_size(size, size).is_err());
    }
}

#[test]
fn audio_settings_forward_native_codec_bitrate_coder_and_track_presence_without_fallback() {
    let catalog = audio_catalog();
    assert_eq!(catalog["bitrates"], json!([96, 128, 160, 192, 256, 320]));
    assert_eq!(catalog["coders"][0]["fast_coder"], false);
    assert_eq!(catalog["coders"][1]["fast_coder"], true);
    for (index, codec, id) in [
        (0, AudioEncoder::Aac, "aac"),
        (1, AudioEncoder::FdkAac, "fdk_aac"),
    ] {
        assert_eq!(catalog["codecs"][index]["id"], id);
        assert_eq!(
            catalog["codecs"][index]["status"],
            if codec.native().is_available() {
                "available"
            } else {
                "unavailable"
            }
        );
        let mut task = task();
        task.export = Some(export_options());
        task.export.as_mut().unwrap().audio_codec = Some(codec);
        assert_eq!(
            task.export.as_ref().unwrap().validate().is_ok(),
            codec.native().is_available()
        );
        for bitrate in AUDIO_BITRATES {
            for fast in [false, true] {
                let options = task.export.as_mut().unwrap();
                options.audio_bitrate_kbps = Some(bitrate);
                options.audio_fast_coder = Some(fast);
                let settings = task.settings(Path::new("/tmp"));
                let actual = settings.audio.as_ref().unwrap();
                assert_eq!(actual.codec, codec.native());
                assert_eq!(actual.bitrate_kbps, bitrate);
                assert_eq!(actual.fast_coder, fast);
                assert!(
                    !task.descriptor(Path::new("/tmp"))["audio_present"]
                        .as_bool()
                        .unwrap()
                );
            }
        }
        let mut audio = task.snapshot.project.timelines[task.snapshot.timeline].tracks[0].clone();
        audio.kind = TrackKind::Audio;
        task.snapshot.project.timelines[task.snapshot.timeline]
            .tracks
            .push(audio);
        assert_eq!(task.descriptor(Path::new("/tmp"))["audio_present"], true);
        task.export.as_mut().unwrap().audio = false;
        assert!(task.settings(Path::new("/tmp")).audio.is_none());
        assert_eq!(task.descriptor(Path::new("/tmp"))["audio_present"], false);
    }
}

#[test]
fn explicit_audio_and_scale_dtos_are_strict_and_invalid_native_choices_are_refused() {
    for (field, value) in [
        ("scale_percent", json!(-1)),
        ("scale_percent", json!(25.5)),
        ("scale_percent", json!("100")),
        ("scale_percent", json!(4294967296u64)),
        ("audio_codec", json!("libfdk_aac")),
        ("audio_codec", json!("auto")),
        ("audio_codec", json!(false)),
        ("audio_bitrate_kbps", json!(-128)),
        ("audio_bitrate_kbps", json!(128.5)),
        ("audio_bitrate_kbps", json!("128")),
        ("audio_fast_coder", json!("fast")),
        ("audio_fast_coder", json!(1)),
        ("audio_coder", json!("fast")),
    ] {
        let mut value_with_field = serde_json::to_value(export_options()).unwrap();
        value_with_field[field] = value;
        assert!(
            serde_json::from_value::<ExportOptions>(value_with_field.clone()).is_err(),
            "{value_with_field}"
        );
    }
    for percent in [0, 1, 24, 26, 49, 51, 74, 76, 99, 101, u32::MAX] {
        let mut settings = export_options();
        settings.scale_percent = Some(percent);
        assert!(settings.validate().is_err(), "scale {percent}");
    }
    for bitrate in [0, 95, 97, 127, 129, 161, 255, 321, u32::MAX] {
        let mut settings = export_options();
        settings.audio_bitrate_kbps = Some(bitrate);
        assert!(settings.validate().is_err(), "bitrate {bitrate}");
    }
    for percent in ExportSettings::SCALE_CHOICES {
        let mut settings = export_options();
        settings.scale_percent = Some(percent);
        settings.validate().unwrap();
    }
}

#[test]
fn omitted_export_fields_preserve_legacy_canonical_bytes_output_and_cache_identity() {
    let legacy = r#"{"quality":18,"preset":"veryfast","audio":true}"#;
    let mut task = task();
    let preview_key = task.key();
    task.export = Some(serde_json::from_str(legacy).unwrap());
    assert_eq!(
        serde_json::to_string(task.export.as_ref().unwrap()).unwrap(),
        legacy
    );
    assert_eq!(task.key(), format!("export:{preview_key}:{legacy}"));
    assert_eq!(
        task.settings(Path::new("/tmp")).output_size((1920, 1080)),
        (960, 540)
    );
    let default_audio = vv_media::AudioSettings::default();
    assert_eq!(task.settings(Path::new("/tmp")).audio, Some(default_audio));
    let original = task.key();
    for field in [
        "scale_percent",
        "audio_codec",
        "audio_bitrate_kbps",
        "audio_fast_coder",
    ] {
        let mut value: Value = serde_json::from_str(legacy).unwrap();
        value[field] = match field {
            "scale_percent" => json!(100),
            "audio_codec" => json!("aac"),
            "audio_bitrate_kbps" => json!(128),
            _ => json!(false),
        };
        task.export = Some(serde_json::from_value(value).unwrap());
        assert_ne!(task.key(), original, "{field}");
    }
    task.export = None;
    assert_eq!(task.key(), preview_key);
    assert_eq!(task.descriptor(Path::new("/tmp"))["width"], 960);
}

#[test]
fn explicit_scale_memory_admission_reserves_host_and_process_headroom_without_resolution_clamp() {
    let required = export_working_bytes((8192, 8192), (8192, 8192));
    assert!(required > 4 * 1024 * 1024 * 1024);
    assert!(memory_fits(
        required,
        16 * 1024 * 1024 * 1024,
        8 * 1024 * 1024 * 1024,
        256 * 1024 * 1024
    ));
    assert!(!memory_fits(
        required,
        8 * 1024 * 1024 * 1024,
        u64::MAX,
        256 * 1024 * 1024
    ));
    assert!(!memory_fits(
        required,
        u64::MAX,
        2 * 1024 * 1024 * 1024,
        256 * 1024 * 1024
    ));
    assert!(
        export_working_bytes((4096, 2160), (2048, 1080))
            < export_working_bytes((4096, 2160), (4096, 2160))
    );
    assert_eq!(
        available_host_memory("MemTotal: 99 kB\nMemAvailable: 8192 kB\n"),
        Some(8 * 1024 * 1024)
    );
    assert_eq!(available_host_memory("MemAvailable: 8192 bytes"), None);
    assert_eq!(available_host_memory("MemAvailable: nope kB"), None);
    assert_eq!(memory_pressure().1, "EXPORT_MEMORY_PRESSURE");
    assert_eq!(memory_pressure().0.as_u16(), 409);
    let root = std::env::temp_dir().join(format!(
        "venturi-export-cgroup-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir_all(root.join("child")).unwrap();
    std::fs::write(root.join("memory.max"), "10000").unwrap();
    std::fs::write(root.join("memory.current"), "2000").unwrap();
    std::fs::write(root.join("child/memory.max"), "5000").unwrap();
    std::fs::write(root.join("child/memory.current"), "1000").unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/child\n"), Some(4000));
    std::fs::write(root.join("child/memory.max"), "max").unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/child\n"), Some(8000));
    std::fs::write(root.join("child/memory.current"), "10001").unwrap();
    std::fs::write(root.join("child/memory.max"), "5000").unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/child\n"), Some(0));
    assert_eq!(cgroup_headroom(&root, "0::/../outside\n"), None);
    assert_eq!(cgroup_headroom(&root, "1:memory:/child\n"), None);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cgroup_root_without_controller_files_preserves_leaf_limits_but_missing_intermediate_is_refused()
{
    let root = std::env::temp_dir().join(format!(
        "venturi-export-root-cgroup-{}",
        crate::asset_jobs::nonce()
    ));
    let middle = root.join("session");
    let leaf = middle.join("worker");
    std::fs::create_dir_all(&leaf).unwrap();
    for directory in [&middle, &leaf] {
        std::fs::write(directory.join("memory.max"), "10000").unwrap();
        std::fs::write(directory.join("memory.current"), "2000").unwrap();
    }
    std::fs::write(leaf.join("memory.current"), "3000").unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/session/worker\n"), Some(7000));
    assert_eq!(cgroup_headroom(&root, "0::/\n"), Some(u64::MAX));
    std::fs::remove_file(middle.join("memory.max")).unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/session/worker\n"), None);
    std::fs::write(middle.join("memory.max"), "max").unwrap();
    std::fs::remove_file(leaf.join("memory.max")).unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/session/worker\n"), None);
    std::fs::write(root.join("memory.max"), "malformed").unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/\n"), None);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn initial_cpu_frame_contention_retries_but_shared_gpu_busy_and_cancel_do_not() {
    let cancel = AtomicBool::new(false);
    let mut calls = 0;
    retry_software_render(&cancel, || {
        calls += 1;
        if calls < 3 {
            Err(ApiError::conflict("RENDER_BUSY", "CPU busy"))
        } else {
            Ok(())
        }
    })
    .unwrap();
    assert_eq!(calls, 3);
    calls = 0;
    let error = retry_software_render(&cancel, || {
        calls += 1;
        Err(ApiError::conflict("GPU_BUSY", "GPU reserved"))
    })
    .unwrap_err();
    assert_eq!(error.1, "GPU_BUSY");
    assert_eq!(calls, 1);
    cancel.store(true, Ordering::Relaxed);
    assert!(retry_software_render(&cancel, || panic!("Canceled work must not start")).is_err());
}

fn task() -> ProgramTask {
    let mut project = vv_core::Project::default();
    let mut track = Track::new(TrackKind::Video);
    track.insert_sorted(Clip::from_source_range(
        ClipId(1),
        ClipSource::SolidColor,
        0,
        48,
        0,
        Rational::one(),
    ));
    let timeline = project.timelines.insert(Timeline {
        name: "test".into(),
        fps: Rational::new(24, 1),
        resolution: (1920, 1080),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let query = ProgramQuery {
        project_epoch: "p:1".into(),
        if_generation: "0".into(),
        timeline_id: "1".into(),
        revision: "r".into(),
        start_frame: 0,
        end_frame: 48,
        audio_origin_frame: None,
        width: 960,
    };
    ProgramTask {
        snapshot: FrameSnapshot {
            project,
            timeline,
            query: query.frame(),
            size: (960, 540),
        },
        query,
        preview: Preview::disabled(),
        export: None,
    }
}
#[test]
fn program_bounds_and_cache_identity_include_native_revision_and_output_range() {
    let mut task = task();
    assert!(task.validate().is_ok());
    assert_eq!(task.descriptor(Path::new("/tmp"))["width"], 960);
    let before = task.query.key();
    let mut inside = task.query.clone();
    inside.start_frame = 12;
    assert!(task.query.contains(&inside));
    inside.end_frame = 49;
    assert!(!task.query.contains(&inside));
    inside.end_frame = 48;
    inside.width = 640;
    assert!(!task.query.contains(&inside));
    inside.width = 960;
    inside.start_frame = 48;
    assert!(!task.query.contains(&inside));
    task.query.revision = "next".into();
    assert_ne!(before, task.query.key());
    task.query.end_frame = 49;
    assert!(task.validate().is_err());
    task.query.end_frame = i64::MIN;
    assert!(task.validate().is_err());
    task.query.end_frame = 0;
    assert!(task.validate().is_err());
}
#[test]
fn program_audio_origin_is_explicit_in_native_settings_and_covering_cache_identity() {
    let mut task = task();
    let legacy = task.query.key();
    assert_eq!(legacy, "program:p:1:0:1:r:0:48:960:v1");
    assert!(
        task.settings(Path::new("/tmp"))
            .audio_render_origin
            .is_none()
    );
    assert!(
        task.descriptor(Path::new("/tmp"))
            .get("audio_origin_frame")
            .is_none()
    );
    task.query.audio_origin_frame = Some(0);
    assert!(task.validate().is_ok());
    assert_ne!(task.query.key(), legacy);
    assert_eq!(
        task.settings(Path::new("/tmp")).audio_render_origin,
        Some(0)
    );
    assert_eq!(task.descriptor(Path::new("/tmp"))["audio_origin_frame"], 0);
    let mut inside = task.query.clone();
    inside.start_frame = 12;
    assert!(task.query.contains(&inside));
    inside.audio_origin_frame = Some(12);
    assert!(!task.query.contains(&inside));
    inside.audio_origin_frame = None;
    assert!(!task.query.contains(&inside));
    task.query.start_frame = 12;
    for origin in [-1, 13, i64::MAX] {
        task.query.audio_origin_frame = Some(origin);
        assert!(task.validate().is_err());
    }
    task.query.audio_origin_frame = Some(0);
    task.export = Some(export_options());
    assert!(task.validate().is_err());
    assert!(
        task.settings(Path::new("/tmp"))
            .audio_render_origin
            .is_none()
    );
    for value in [json!("0"), json!(0.5), json!(true)] {
        assert!(serde_json::from_value::<ProgramQuery>(json!({"project_epoch":"p:1","if_generation":"0","timeline_id":"1","revision":"r","start_frame":0,"end_frame":48,"audio_origin_frame":value})).is_err());
    }
}

#[test]
fn composition_memory_counts_native_sources_crossings_nested_layers_and_existing_reserves() {
    let mut task = task();
    let id = task.snapshot.timeline;
    let initial = program_working_bytes(&task.snapshot, (960, 540));
    let media = task.snapshot.project.media_pool.insert(vv_core::MediaItem {
        path: "memory-only.mp4".into(),
        meta: vv_core::MediaMeta {
            width: 4096,
            height: 2160,
            duration_frames: 480,
            fps: Rational::new(24, 1),
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
    task.snapshot.project.timelines[id].tracks[0].clips[0].source = ClipSource::Media(media);
    let source = program_working_bytes(&task.snapshot, (960, 540));
    assert!(source > initial);
    let mut later = task.snapshot.project.timelines[id].tracks[0].clips[0].clone();
    later.id = ClipId(2);
    later.timeline_start = 48;
    task.snapshot.project.timelines[id].tracks[0].insert_sorted(later);
    assert_eq!(
        program_working_bytes(&task.snapshot, (960, 540)),
        source,
        "Sequential clips do not retain one decode queue each"
    );
    task.snapshot.project.timelines[id].tracks[0]
        .crossings
        .push(vv_core::CrossTransition {
            left_clip: ClipId(1),
            right_clip: ClipId(2),
            transition: vv_core::Transition {
                kind: vv_core::TransitionKind::CrossDissolve,
                duration: 8,
                direction: vv_core::PushDirection::Left,
                ease: vv_core::Ease::InOut,
                curve: 0.5,
            },
        });
    let crossing = program_working_bytes(&task.snapshot, (960, 540));
    assert!(crossing > source);
    let child_track = task.snapshot.project.timelines[id].tracks[0].clone();
    let child = task.snapshot.project.timelines.insert(Timeline {
        name: "Native child".into(),
        fps: Rational::new(24, 1),
        resolution: (1920, 1080),
        tracks: vec![child_track],
        markers: vec![],
        master: Default::default(),
    });
    let compound = task.snapshot.project.media_pool.insert(vv_core::MediaItem {
        path: "Nested memory".into(),
        meta: vv_core::MediaMeta {
            width: 1920,
            height: 1080,
            duration_frames: 96,
            fps: Rational::new(24, 1),
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 2,
        compound: Some(child),
        folder: None,
    });
    let mut nested_track = Track::new(TrackKind::Video);
    nested_track.insert_sorted(Clip::from_source_range(
        ClipId(3),
        ClipSource::Media(compound),
        0,
        96,
        0,
        Rational::one(),
    ));
    task.snapshot.project.timelines[id]
        .tracks
        .push(nested_track);
    let nested = program_working_bytes(&task.snapshot, (960, 540));
    assert!(nested > crossing);
    let reserve = 64 * 1024 * 1024;
    assert!(memory_fits(
        nested,
        nested + 4 * 1024 * 1024 * 1024,
        nested + reserve,
        reserve
    ));
    assert!(!memory_fits(
        nested,
        nested + 4 * 1024 * 1024 * 1024,
        nested + reserve - 1,
        reserve
    ));
    assert!(!memory_fits(
        nested,
        nested + 4 * 1024 * 1024 * 1024 - 1,
        u64::MAX,
        reserve
    ));
    task.snapshot.project.timelines[id].tracks[1].muted = true;
    assert_eq!(program_working_bytes(&task.snapshot, (960, 540)), crossing);
    task.snapshot.project.timelines[id].tracks[1].muted = false;
    task.snapshot.project.timelines[child].tracks[0].clips[0].source = ClipSource::Media(compound);
    assert_eq!(
        program_working_bytes(&task.snapshot, (960, 540)),
        u64::MAX,
        "Invalid recursive media fails closed within the native depth bound"
    );
}

#[test]
fn composition_memory_accounts_for_native_whole_clip_pitch_correction_results() {
    let mut task = task();
    let id = task.snapshot.timeline;
    let media = task.snapshot.project.media_pool.insert(vv_core::MediaItem {
        path: "pitch-memory.wav".into(),
        meta: vv_core::MediaMeta {
            width: 0,
            height: 0,
            duration_frames: 48_000,
            fps: Rational::new(24, 1),
            has_video: false,
            has_audio: true,
            sample_rate: 48_000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 1,
        compound: None,
        folder: None,
    });
    let mut track = Track::new(TrackKind::Audio);
    let mut clip = Clip::from_source_range(
        ClipId(2),
        ClipSource::Media(media),
        0,
        24_000,
        0,
        Rational::one(),
    );
    clip.set_speed(Rational::new(2, 1), Rational::one());
    clip.pitch_correction = true;
    track.insert_sorted(clip);
    task.snapshot.project.timelines[id].tracks.push(track);
    let corrected = program_working_bytes(&task.snapshot, (960, 540));
    task.snapshot.project.timelines[id].tracks[1].clips[0].pitch_correction = false;
    let plain = program_working_bytes(&task.snapshot, (960, 540));
    assert!(corrected > plain + 512 * 1024 * 1024);
    task.snapshot.project.timelines[id].tracks[1].clips[0].pitch_correction = true;
    task.snapshot.project.timelines[id].tracks[1].clips[0].freeze = Some(0);
    assert_eq!(program_working_bytes(&task.snapshot, (960, 540)), plain);
    assert!(!memory_fits(u64::MAX, u64::MAX, u64::MAX, 0));
}
#[test]
fn generated_preview_identity_detects_source_replacement_without_timeline_edits() {
    let path = std::env::temp_dir().join(format!("vv-program-input-{}", std::process::id()));
    std::fs::write(&path, b"first").unwrap();
    let inputs = vec![(path.clone(), identity(&path).unwrap())];
    assert!(unchanged(&inputs));
    std::fs::write(&path, b"second version").unwrap();
    assert!(!unchanged(&inputs));
    std::fs::remove_file(path).unwrap();
}

#[test]
fn export_settings_are_native_bounded_and_part_of_the_immutable_job_identity() {
    let mut task = task();
    let preview_key = task.key();
    task.export = Some(ExportOptions {
        quality: 23,
        preset: "medium".into(),
        audio: false,
        encoder: crate::codecs::Encoder::X264,
        decoder: crate::codecs::Decoder::Software,
        scale_percent: None,
        audio_codec: None,
        audio_bitrate_kbps: None,
        audio_fast_coder: None,
    });
    assert!(task.validate().is_ok());
    assert_ne!(preview_key, task.key());
    let before = task.key();
    let settings = task.settings(Path::new("/tmp"));
    assert_eq!(settings.video.quality, 23);
    assert_eq!(settings.video.preset, "medium");
    assert!(settings.audio.is_none());
    task.export.as_mut().unwrap().audio = true;
    assert_ne!(before, task.key());
    assert!(task.settings(Path::new("/tmp")).audio.is_some());
    assert_eq!(
        task.descriptor(Path::new("/tmp"))["audio_present"],
        false,
        "An audio checkbox alone does not create a native audio stream"
    );
    task.export.as_mut().unwrap().quality = 52;
    assert!(task.validate().is_err());
    task.export.as_mut().unwrap().quality = 18;
    task.export.as_mut().unwrap().preset = "unverified-hardware".into();
    assert!(task.validate().is_err());
    task.export = None;
    task.query.start_frame = -1;
    assert!(task.validate().is_err());
}

#[test]
fn legacy_export_settings_keep_canonical_bytes_and_selected_codecs_change_identity() {
    let legacy = r#"{"quality":23,"preset":"medium","audio":true}"#;
    let settings: ExportOptions = serde_json::from_str(legacy).unwrap();
    assert!(settings.encoder.is_default());
    assert!(settings.decoder.is_default());
    assert_eq!(serde_json::to_string(&settings).unwrap(), legacy);
    let explicit: ExportOptions = serde_json::from_str(
        r#"{"quality":23,"preset":"medium","audio":true,"encoder":"x264","decoder":"software"}"#,
    )
    .unwrap();
    assert_eq!(serde_json::to_string(&explicit).unwrap(), legacy);
    for value in [
        json!({"quality":23,"preset":"medium","audio":true,"encoder":"auto"}),
        json!({"quality":23,"preset":"medium","audio":true,"decoder":"cpu"}),
        json!({"quality":23,"preset":"medium","audio":true,"extra":1}),
    ] {
        assert!(serde_json::from_value::<ExportOptions>(value).is_err());
    }
    let mut task = task();
    task.export = Some(settings);
    let before = task.key();
    task.export.as_mut().unwrap().decoder = crate::codecs::Decoder::Nvdec;
    assert_ne!(before, task.key());
    assert!(
        task.validate().is_err(),
        "CPU-only hosts must refuse selected hardware before native work"
    );
    task.export.as_mut().unwrap().decoder = crate::codecs::Decoder::Software;
    task.export.as_mut().unwrap().encoder = crate::codecs::Encoder::Vulkan;
    task.export.as_mut().unwrap().preset.clear();
    assert_ne!(before, task.key());
    assert_eq!(
        task.settings(Path::new("/tmp")).video.codec,
        vv_media::VideoCodec::Vulkan
    );
    assert!(task.validate().is_err());
}

#[test]
fn decoder_progress_reports_actual_paths_and_cpu_fallback_independently_of_compositor() {
    let mut progress = ExportProgress::default();
    assert_eq!(
        progress_value_for(&progress, crate::codecs::Decoder::Vulkan)["decoder_fallback"],
        false
    );
    progress.encoder = Some(vv_media::VideoCodec::X264);
    progress.decoders = vec![
        Some(vv_media::HwDevice::Vulkan(Some("selected adapter".into()))),
        None,
        Some(vv_media::HwDevice::Cuda),
    ];
    let value = progress_value_for(&progress, crate::codecs::Decoder::Vulkan);
    assert!(value["compositor"].is_null());
    assert_eq!(value["encoder"], "X264");
    assert_eq!(value["decoders"][0]["id"], "vulkan");
    assert_eq!(value["decoders"][1]["id"], "software");
    assert_eq!(value["decoders"][2]["id"], "nvdec");
    assert_eq!(value["decoder_fallback"], true);
    assert_eq!(progress_value(&progress)["decoder_fallback"], false);
    progress.decoders = vec![None];
    assert_eq!(
        progress_value_for(&progress, crate::codecs::Decoder::Nvdec)["decoder_fallback"],
        true
    );
}

#[test]
fn export_accepts_full_long_timelines_while_preview_keeps_its_duration_budget() {
    let mut task = task();
    task.snapshot.project.timelines[task.snapshot.timeline].tracks[0].clips[0] =
        Clip::from_source_range(
            ClipId(1),
            ClipSource::SolidColor,
            0,
            8640,
            0,
            Rational::one(),
        );
    task.query.end_frame = 8640;
    assert!(task.validate().is_err());
    task.export = Some(ExportOptions {
        quality: 23,
        preset: "ultrafast".into(),
        audio: true,
        encoder: crate::codecs::Encoder::X264,
        decoder: crate::codecs::Decoder::Software,
        scale_percent: None,
        audio_codec: None,
        audio_bitrate_kbps: None,
        audio_fast_coder: None,
    });
    assert!(task.validate().is_ok());
    task.query.end_frame = 8641;
    assert!(task.validate().is_err());
    task.query.end_frame = 8640;
    task.query.start_frame = -1;
    assert!(task.validate().is_err());
}

#[test]
fn cgroup_admission_counts_only_clean_unmapped_inactive_file_cache_as_reclaimable() {
    let stat = "file 5000\ninactive_file 4000\nfile_dirty 200\nfile_writeback 100\nfile_mapped 300\nshmem 400\nunevictable 500\n";
    assert_eq!(clean_inactive_file(stat), 2500);
    assert_eq!(
        clean_inactive_file(&stat.replace("inactive_file 4000", "inactive_file 9000")),
        3500
    );
    assert_eq!(
        clean_inactive_file(&stat.replace("file_dirty 200", "file_dirty 9000")),
        0
    );
    for broken in [
        String::new(),
        stat.replace("shmem 400\n", ""),
        format!("{stat}file 1\n"),
        stat.replace("file_mapped 300", "file_mapped nope"),
    ] {
        assert_eq!(clean_inactive_file(&broken), 0);
    }
    let root = std::env::temp_dir().join(format!(
        "venturi-clean-cgroup-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir_all(root.join("worker")).unwrap();
    for path in [&root, &root.join("worker")] {
        std::fs::write(path.join("memory.max"), "10000").unwrap();
        std::fs::write(path.join("memory.current"), "9500").unwrap();
        std::fs::write(path.join("memory.stat"), stat).unwrap();
    }
    assert_eq!(cgroup_headroom(&root, "0::/worker\n"), Some(3000));
    std::fs::write(root.join("memory.stat"), "invalid").unwrap();
    assert_eq!(cgroup_headroom(&root, "0::/worker\n"), Some(500));
    std::fs::remove_dir_all(root).unwrap();
}
