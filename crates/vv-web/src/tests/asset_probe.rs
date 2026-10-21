use super::*;

#[test]
fn root_import_input_has_no_asset_byte_cap_and_only_fixed_child_arguments() {
    let path =
        std::env::temp_dir().join(format!("venturi-root-probe-{}", crate::asset_jobs::nonce()));
    let file = File::create(&path).unwrap();
    file.set_len(MAX_BYTES + 1).unwrap();
    drop(file);
    let file = File::open(&path).unwrap();
    assert!(bounded_input(&file, false).is_err());
    bounded_input(&file, true).unwrap();
    let child = command(
        Path::new("/safe/executable"),
        &file,
        Mode {
            image: false,
            root_import: true,
        },
    )
    .unwrap();
    assert_eq!(
        child.get_args().collect::<Vec<_>>(),
        vec!["--asset-probe", "root-media"]
    );
    drop(child);
    drop(file);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn root_import_rejects_indirect_text_without_restricting_native_binary_formats() {
    let path = std::env::temp_dir().join(format!(
        "venturi-root-header-{}",
        crate::asset_jobs::nonce()
    ));
    for bytes in [
        b"#EXTM3U\nhttps://example.invalid/live".as_slice(),
        b"ffconcat version 1.0",
        b"[playlist]",
        b"<MPD>",
        b"v=0\n",
    ] {
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(
            reject_indirect(&File::open(&path).unwrap())
                .unwrap_err()
                .0
                .as_u16(),
            422
        );
    }
    for bytes in [
        b"RIFF\0\0\0\0AVI ".as_slice(),
        b"BM\0\0",
        b"II*\0",
        b"MM\0*",
        b"\xff\xf1",
    ] {
        std::fs::write(&path, bytes).unwrap();
        reject_indirect(&File::open(&path).unwrap()).unwrap();
    }
    std::fs::remove_file(path).unwrap();
}

fn metadata() -> vv_core::MediaMeta {
    vv_core::MediaMeta {
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
    }
}
fn fake(script: &str) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    command
}

#[test]
fn child_argument_parser_is_closed_and_output_is_strict_and_bounded() {
    let parse =
        |parts: &[&str]| parse_mode(&parts.iter().map(|v| v.to_string()).collect::<Vec<_>>());
    assert_eq!(
        parse(&["--asset-probe", "image"]).unwrap(),
        Mode {
            image: true,
            root_import: false
        }
    );
    assert_eq!(
        parse(&["--asset-probe", "media"]).unwrap(),
        Mode {
            image: false,
            root_import: false
        }
    );
    assert_eq!(
        parse(&["--asset-probe", "root-image"]).unwrap(),
        Mode {
            image: true,
            root_import: true
        }
    );
    assert_eq!(
        parse(&["--asset-probe", "root-media"]).unwrap(),
        Mode {
            image: false,
            root_import: true
        }
    );
    for args in [
        vec![],
        vec!["--asset-probe"],
        vec!["--asset-probe", "../../file"],
        vec!["--asset-probe", "image", "path"],
        vec!["--other", "media"],
    ] {
        assert!(parse(&args).is_err(), "{args:?}");
    }
    let bytes = serde_json::to_vec(&Output {
        metadata: metadata(),
    })
    .unwrap();
    assert_eq!(decode(&bytes).unwrap().width, 16);
    assert!(decode(&vec![b' '; MAX_OUTPUT + 1]).is_err());
    assert!(decode(b"{}").is_err());
    let mut invalid: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    invalid["extra"] = true.into();
    assert!(decode(&serde_json::to_vec(&invalid).unwrap()).is_err());
    invalid.as_object_mut().unwrap().remove("extra");
    invalid["metadata"]["duration_frames"] = (-1).into();
    assert!(decode(&serde_json::to_vec(&invalid).unwrap()).is_err());
}

#[test]
fn command_inherits_only_pinned_input_and_fixed_mode_and_has_no_user_path_arguments() {
    let file = File::open("/dev/null").unwrap();
    assert!(bounded_input(&file, false).is_err());
    let path = std::env::temp_dir().join(format!(
        "venturi-asset-probe-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::write(&path, b"tiny").unwrap();
    let file = File::open(&path).unwrap();
    let command = command(
        Path::new("/safe/executable"),
        &file,
        Mode {
            image: true,
            root_import: false,
        },
    )
    .unwrap();
    assert_eq!(command.get_program(), "/safe/executable");
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        vec!["--asset-probe", "image"]
    );
    assert!(command.get_envs().next().is_none());
    drop(command);
    drop(file);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn finite_fake_child_success_nonzero_exit_and_output_overflow_are_verified_without_native_work() {
    let bytes = serde_json::to_string(&Output {
        metadata: metadata(),
    })
    .unwrap();
    let script = format!("printf '%s' '{bytes}'");
    let result = run_command(
        fake(&script),
        &AtomicBool::new(false),
        Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(result.width, 16);
    assert_eq!(
        run_command(
            fake("exit 3"),
            &AtomicBool::new(false),
            Duration::from_secs(1)
        )
        .unwrap_err()
        .1,
        "ASSET_PROBE_FAILED"
    );
    assert_eq!(
        run_command(
            fake("head -c 65537 /dev/zero"),
            &AtomicBool::new(false),
            Duration::from_secs(1)
        )
        .unwrap_err()
        .1,
        "ASSET_PROBE_FAILED"
    );
}

#[test]
fn timeout_and_cancel_kill_and_reap_before_inherited_descriptor_is_released() {
    let root = std::env::temp_dir().join(format!(
        "venturi-asset-probe-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir(&root).unwrap();
    let lock_path = root.join("lease");
    for cancel in [false, true] {
        let lease = crate::preview::gpu_lock(&lock_path).unwrap();
        let mut command = Command::new("/bin/sleep");
        command
            .arg("2")
            .stdin(Stdio::from(lease.try_clone().unwrap()))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = ProbeChild {
            child: command.spawn().unwrap(),
            reaped: false,
        };
        drop(command);
        drop(lease);
        let mut stdout = child.child.stdout.take().unwrap();
        assert_eq!(
            crate::preview::gpu_lock(&lock_path).unwrap_err().1,
            "GPU_BUSY"
        );
        let result = collect(
            &mut child,
            &mut stdout,
            &AtomicBool::new(cancel),
            Duration::from_millis(10),
        );
        assert_eq!(
            result.unwrap_err().1,
            if cancel {
                "ASSET_CANCELED"
            } else {
                "ASSET_PROBE_TIMEOUT"
            }
        );
        assert!(!child.reaped);
        drop(child);
        drop(stdout);
        drop(crate::preview::gpu_lock(&lock_path).unwrap());
    }
    std::fs::remove_dir_all(root).unwrap();
}
