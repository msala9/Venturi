use super::*;

fn request(kind: Kind, id: &str, force: bool) -> ProbeRequest {
    ProbeRequest {
        kind,
        id: id.into(),
        force,
    }
}
fn options(encoder: Encoder, decoder: Decoder) -> ExportOptions {
    let native = encoder.native();
    ExportOptions {
        quality: native.default_quality(),
        preset: native.default_preset().into(),
        audio: true,
        encoder,
        decoder,
        scale_percent: None,
        audio_codec: None,
        audio_bitrate_kbps: None,
        audio_fast_coder: None,
    }
}
fn row<'a>(catalog: &'a Value, kind: &str, id: &str) -> &'a Value {
    catalog[kind]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap()
}
#[test]
fn catalog_is_stable_pure_and_cpu_hosts_disable_every_hardware_path() {
    let preview = Preview::disabled();
    let codecs = Codecs::new(preview.clone());
    let before = codecs.catalog();
    assert_eq!(
        before["audio"]["bitrates"],
        serde_json::json!([96, 128, 160, 192, 256, 320])
    );
    assert_eq!(
        before["audio"]["coders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["fast_coder"].as_bool().unwrap())
            .collect::<Vec<_>>(),
        [false, true]
    );
    for (index, codec) in [vv_media::AudioCodec::Aac, vv_media::AudioCodec::FdkAac]
        .into_iter()
        .enumerate()
    {
        assert_eq!(
            before["audio"]["codecs"][index]["status"],
            if codec.is_available() {
                "available"
            } else {
                "unavailable"
            }
        );
    }
    for _ in 0..3 {
        assert_eq!(before, codecs.catalog());
    }
    assert_eq!(row(&before, "encoders", "x264")["status"], "available");
    assert_eq!(row(&before, "decoders", "software")["status"], "available");
    for kind in ["encoders", "decoders"] {
        for entry in before[kind].as_array().unwrap() {
            if entry["id"] != "x264" && entry["id"] != "software" {
                assert_eq!(entry["status"], "disabled");
            }
        }
    }
    assert_eq!(
        before["encoders"].as_array().unwrap().len(),
        VideoCodec::choices().len()
    );
    assert!(!preview.hardware_enabled());
    assert_eq!(preview.diagnostic()["resident"], false);
    assert_ne!(
        before["identity"],
        Codecs::new(Preview::disabled()).catalog()["identity"]
    );
    for kind in [Kind::Encoder, Kind::Decoder] {
        assert!(
            codecs
                .probe_with(request(kind, "vulkan", false), |_, _| panic!(
                    "CPU hosts must never start hardware probes"
                ))
                .is_err()
        );
    }
    assert!(
        codecs
            .validate_export(&options(Encoder::X264, Decoder::Software))
            .is_ok()
    );
    assert!(
        codecs
            .validate_export(&options(Encoder::X264, Decoder::Vulkan))
            .is_err()
    );
}
#[test]
fn native_codec_metadata_and_parameter_validation_are_exact() {
    let catalog = Codecs::new(Preview::codec_test_host()).catalog();
    for &codec in VideoCodec::choices() {
        let encoder = Encoder::from_native(codec);
        let entry = row(&catalog, "encoders", encoder.id());
        assert_eq!(entry["quality"]["min"], *codec.quality_range().start());
        assert_eq!(entry["quality"]["max"], *codec.quality_range().end());
        assert_eq!(entry["quality"]["default"], codec.default_quality());
        assert_eq!(entry["quality"]["rises"], codec.quality_rises());
        assert_eq!(entry["presets"], json!(codec.presets()));
        assert!(options(encoder, Decoder::Software).validate().is_ok());
        let mut bad = options(encoder, Decoder::Software);
        bad.quality = 255;
        assert!(bad.validate().is_err());
        bad.quality = codec.default_quality();
        bad.preset = "unsupported".into();
        assert!(bad.validate().is_err());
    }
    if VideoCodec::choices().contains(&VideoCodec::Vulkan) {
        assert!(
            row(&catalog, "encoders", "vulkan")["label"]
                .as_str()
                .unwrap()
                .contains("FFmpeg default")
        );
    }
    assert!(
        row(&catalog, "decoders", "vulkan")["label"]
            .as_str()
            .unwrap()
            .contains("test adapter")
    );
}
#[test]
fn singleflight_cached_native_results_and_transient_failure_preserve_scope() {
    let codecs = Codecs::new(Preview::codec_test_host());
    let initial = codecs.catalog();
    assert_eq!(row(&initial, "decoders", "vulkan")["status"], "not_checked");
    assert!(
        codecs
            .validate_export(&options(Encoder::X264, Decoder::Vulkan))
            .is_err()
    );
    let checked = codecs
        .probe_with(request(Kind::Decoder, "vulkan", false), |_, hardware| {
            assert!(hardware);
            assert_eq!(
                row(&codecs.catalog(), "decoders", "vulkan")["status"],
                "checking"
            );
            assert_eq!(
                codecs
                    .probe_with(request(Kind::Encoder, "x264", false), |_, _| panic!(
                        "single flight"
                    ))
                    .unwrap_err()
                    .1,
                "CODEC_PROBE_BUSY"
            );
            Ok(ProbeResult { available: true })
        })
        .unwrap();
    assert_eq!(checked["identity"], initial["identity"]);
    assert!(
        codecs
            .validate_export(&options(Encoder::X264, Decoder::Vulkan))
            .is_ok()
    );
    assert!(
        codecs
            .validate_export(&options(Encoder::Vulkan, Decoder::Software))
            .is_err()
    );
    assert_eq!(
        checked,
        codecs
            .probe_with(request(Kind::Decoder, "vulkan", false), |_, _| panic!(
                "cached result must be reused"
            ))
            .unwrap()
    );
    for code in ["GPU_BUSY", "CODEC_PROBE_TIMEOUT", "CODEC_PROBE_FAILED"] {
        assert_eq!(
            codecs
                .probe_with(request(Kind::Decoder, "vulkan", true), |_, _| Err(
                    transient(code, "Transient check failure")
                ))
                .unwrap_err()
                .1,
            code
        );
        assert_eq!(checked, codecs.catalog());
    }
    let unavailable = codecs
        .probe_with(request(Kind::Decoder, "vulkan", true), |_, _| {
            Ok(ProbeResult { available: false })
        })
        .unwrap();
    assert_eq!(
        row(&unavailable, "decoders", "vulkan")["status"],
        "unavailable"
    );
    assert!(
        codecs
            .validate_export(&options(Encoder::X264, Decoder::Vulkan))
            .is_err()
    );
}
#[test]
fn explicit_cpu_checks_work_without_preview_and_panics_release_singleflight() {
    let codecs = Codecs::new(Preview::disabled());
    let cpu = codecs
        .probe_with(request(Kind::Encoder, "x264", false), |_, hardware| {
            assert!(!hardware);
            Ok(ProbeResult { available: true })
        })
        .unwrap();
    assert_eq!(row(&cpu, "encoders", "x264")["status"], "available");
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = codecs.probe_with(request(Kind::Encoder, "x264", true), |_, _| {
            panic!("fake child panic")
        });
    }));
    assert!(panic.is_err());
    assert_eq!(cpu, codecs.catalog());
    assert!(
        codecs
            .probe_with(request(Kind::Decoder, "software", false), |_, hardware| {
                assert!(!hardware);
                Ok(ProbeResult { available: true })
            })
            .is_ok()
    );
}
#[test]
fn public_and_hidden_probe_inputs_are_strict_allowlists() {
    for value in [
        json!({"kind":"encoder","id":"x264","extra":1}),
        json!({"kind":"decoder","id":"vulkan","force":1}),
        json!({"kind":"auto","id":"vulkan"}),
        json!({"kind":"encoder","id":3}),
    ] {
        assert!(
            serde_json::from_value::<ProbeRequest>(value.clone()).is_err(),
            "{value}"
        );
    }
    let decode =
        |parts: &[&str]| parse_child(&parts.iter().map(|v| v.to_string()).collect::<Vec<_>>());
    assert!(decode(&["--codec-probe", "encoder", "x264", ""]).is_ok());
    assert!(decode(&["--codec-probe", "decoder", "vulkan", "test adapter"]).is_ok());
    for args in [
        vec!["--codec-probe", "encoder", "../../command", ""],
        vec!["--codec-probe", "decoder", "vulkan", ""],
        vec!["--codec-probe", "encoder", "x264", "unexpected"],
        vec!["--codec-probe", "decoder", "software", "", "extra"],
    ] {
        assert!(decode(&args).is_err(), "{args:?}");
    }
    assert!(validate_request(&request(Kind::Decoder, "videotoolbox", false)).is_err());
}

#[test]
fn child_command_scopes_private_temp_and_lease_without_mutating_parent_environment() {
    use std::os::unix::fs::PermissionsExt;
    let before = std::env::var_os("TMPDIR");
    let directory = PrivateDirectory::create().unwrap();
    assert_eq!(
        directory.0.metadata().unwrap().permissions().mode() & 0o777,
        0o700
    );
    let command = probe_command(
        &request(Kind::Encoder, "x264", false),
        &Preview::disabled(),
        None,
        &directory,
    )
    .unwrap();
    assert_eq!(
        command
            .get_args()
            .map(|v| v.to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
        vec!["--codec-probe", "encoder", "x264", ""]
    );
    assert_eq!(command.get_current_dir(), Some(directory.0.as_path()));
    let env = command.get_envs().collect::<BTreeMap<_, _>>();
    assert_eq!(
        env.get(std::ffi::OsStr::new("TMPDIR")).copied().flatten(),
        Some(directory.0.as_os_str())
    );
    assert_eq!(
        env.get(std::ffi::OsStr::new("VV_WEB_CODEC_LEASE")),
        Some(&None)
    );
    assert_eq!(std::env::var_os("TMPDIR"), before);
    drop(command);
    let path = directory.0.clone();
    drop(directory);
    assert!(!path.exists());
}

#[test]
fn probe_affinity_uses_exactly_one_effectively_allowed_cpu() {
    let mut allowed = rustix::thread::CpuSet::new();
    assert!(one_cpu(&allowed).is_none());
    allowed.set(7);
    allowed.set(31);
    let selected = one_cpu(&allowed).unwrap();
    assert!(selected.is_set(7));
    assert_eq!(
        (0..rustix::thread::CpuSet::MAX_CPU)
            .filter(|&c| selected.is_set(c))
            .count(),
        1
    );
    assert!(!selected.is_set(0));
}

#[test]
fn probe_memory_admission_requires_verified_shared_host_headroom() {
    assert!(memory_headroom(
        "MemTotal: 9999999 kB\nMemAvailable: 4194304 kB\n"
    ));
    for meminfo in [
        "MemAvailable: 4194303 kB",
        "MemFree: 9999999 kB",
        "MemAvailable: bad kB",
        "MemAvailable: 9999999 bytes",
        "",
    ] {
        assert!(!memory_headroom(meminfo), "{meminfo}");
    }
}

#[test]
fn probe_cgroup_policy_uses_effective_ancestor_memory_and_swap_limits() {
    let gib = 1024 * 1024 * 1024;
    assert_eq!(cgroup_value("max\n"), Some(None));
    assert_eq!(cgroup_value("0\n"), Some(Some(0)));
    assert_eq!(cgroup_value("invalid"), None);
    assert!(!limits_sufficient(&[]));
    assert!(!limits_sufficient(&[(None, None)]));
    assert!(!limits_sufficient(&[(Some(5 * gib), Some(0))]));
    assert!(!limits_sufficient(&[(Some(gib), None)]));
    assert!(!limits_sufficient(&[(Some(gib), Some(gib))]));
    assert!(limits_sufficient(&[(None, None), (Some(2 * gib), Some(0))]));
    assert!(limits_sufficient(&[
        (Some(8 * gib), Some(gib)),
        (Some(4 * gib), Some(0))
    ]));
}

#[test]
fn timed_out_child_is_killed_and_reaped_before_its_inherited_lease_can_unlock() {
    let directory = PrivateDirectory::create().unwrap();
    let path = directory.0.join("lease");
    let lease = crate::preview::gpu_lock(&path).unwrap();
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", "exec sleep 10"])
        .process_group(0)
        .stdin(Stdio::from(lease.try_clone().unwrap()))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = ProbeChild {
        child: command.spawn().unwrap(),
        reaped: false,
    };
    drop(command);
    drop(lease);
    assert_eq!(crate::preview::gpu_lock(&path).unwrap_err().1, "GPU_BUSY");
    assert_eq!(
        wait_child(&mut child, Duration::from_millis(10))
            .unwrap_err()
            .1,
        "CODEC_PROBE_TIMEOUT"
    );
    assert!(!child.reaped);
    drop(child);
    drop(crate::preview::gpu_lock(&path).unwrap());
}
