use super::*;

#[test]
fn isolated_child_entry() {
    if std::env::var("VV_WEB_IMAGE_DERIVATIVE_CHILD").as_deref() != Ok("1") {
        return;
    }
    let args = vec![
        FLAG.into(),
        std::env::var("VV_WEB_IMAGE_MODE").unwrap(),
        std::env::var("VV_WEB_IMAGE_WIDTH").unwrap(),
        std::env::var("VV_WEB_IMAGE_HEIGHT").unwrap(),
        std::env::var("VV_WEB_IMAGE_THUMB_FD").unwrap(),
    ];
    match child_main(&args) {
        Ok(()) => std::process::exit(0),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn root() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vv-image-derivative-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir(&path).unwrap();
    path
}
fn fake(script: &str) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0);
    command
}

#[test]
fn derivative_arguments_and_pinned_output_headers_are_strict_and_bounded() {
    let parse =
        |args: &[&str]| parse_args(&args.iter().map(|part| part.to_string()).collect::<Vec<_>>());
    assert_eq!(
        parse(&[FLAG, "full", "8192", "2160", "7"]).unwrap(),
        (Mode::Full, (8192, 2160), 7)
    );
    assert_eq!(
        parse(&[FLAG, "thumbnail", "16", "16", "7"]).unwrap().0,
        Mode::Thumbnail
    );
    for args in [
        vec![],
        vec![FLAG, "full", "16", "16"],
        vec![FLAG, "full", "0", "16", "7"],
        vec![FLAG, "full", "8193", "16", "7"],
        vec![FLAG, "full", "16", "16", "1"],
        vec![FLAG, "full", "16", "16", "../output"],
        vec![FLAG, "full", "16", "16", "7", "path"],
        vec![FLAG, "other", "16", "16", "7"],
    ] {
        assert!(parse(&args).is_err());
    }
    let root = root();
    let path = root.join("output");
    let mut header = [0; 24];
    header[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    header[12..16].copy_from_slice(b"IHDR");
    header[16..20].copy_from_slice(&16_u32.to_be_bytes());
    header[20..24].copy_from_slice(&12_u32.to_be_bytes());
    std::fs::write(&path, header).unwrap();
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    output(&file, (16, 12), MAX_BYTES).unwrap();
    assert!(output(&file, (12, 16), MAX_BYTES).is_err());
    file.set_len(MAX_BYTES + 1).unwrap();
    assert!(output(&file, (16, 12), MAX_BYTES).is_err());
    drop(file);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn derivative_command_has_only_pinned_stdio_and_owned_thumbnail_descriptor() {
    let root = root();
    let source = root.join("source.bmp");
    std::fs::write(&source, b"BMtiny").unwrap();
    let source = File::open(source).unwrap();
    input(&source, Mode::Full).unwrap();
    let destination = File::create(root.join("source.png")).unwrap();
    let thumbnail = File::create(root.join("thumb.png")).unwrap();
    let command = command(
        Path::new("/safe/executable"),
        &source,
        Some(&destination),
        &thumbnail,
        (16, 16),
        Mode::Full,
    )
    .unwrap();
    assert_eq!(command.get_program(), "/safe/executable");
    assert!(
        command
            .get_args()
            .all(|arg| !arg.to_string_lossy().contains(root.to_str().unwrap()))
    );
    assert!(
        command
            .get_args()
            .any(|arg| arg == "image_derivative::tests::isolated_child_entry")
    );
    assert!(
        command
            .get_envs()
            .any(|(name, value)| name == "VV_WEB_IMAGE_THUMB_FD"
                && value.unwrap().to_string_lossy().parse::<u32>().unwrap() >= 3)
    );
    drop(command);
    drop((source, destination, thumbnail));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn thumbnail_mode_accepts_only_native_stills_and_cannot_reencode_original_formats() {
    let root = root();
    let path = root.join("input");
    for bytes in [
        b"\x89PNG\r\n\x1a\n".as_slice(),
        b"\xff\xd8\xff",
        b"RIFF\0\0\0\0WEBP",
    ] {
        std::fs::write(&path, bytes).unwrap();
        let file = File::open(&path).unwrap();
        input(&file, Mode::Thumbnail).unwrap();
        assert!(input(&file, Mode::Full).is_err());
    }
    for bytes in [b"GIF89a".as_slice(), b"not an image"] {
        std::fs::write(&path, bytes).unwrap();
        assert!(input(&File::open(&path).unwrap(), Mode::Thumbnail).is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn derivative_timeout_cancel_diagnostic_overflow_and_disk_refusal_kill_and_reap() {
    let root = root();
    for cancel_now in [false, true] {
        let pid_path = root.join(if cancel_now {
            "cancel.pid"
        } else {
            "timeout.pid"
        });
        let mut command = fake("printf '%s' \"$$\" > \"$1\"; exec sleep 10");
        command.arg("image-child").arg(&pid_path);
        let cancel = AtomicBool::new(false);
        let start = Instant::now();
        let error = run_command(command, &cancel, Duration::from_millis(100), || {
            if cancel_now && pid_path.exists() {
                cancel.store(true, Ordering::Release);
            }
            true
        })
        .unwrap_err();
        assert_eq!(
            error.1,
            if cancel_now {
                "SOURCE_CANCELED"
            } else {
                "IMAGE_DERIVATIVE_TIMEOUT"
            }
        );
        assert!(start.elapsed() < Duration::from_secs(2));
        let pid = std::fs::read_to_string(pid_path).unwrap();
        assert!(
            !Path::new("/proc").join(pid).exists(),
            "Child was not reaped"
        );
    }
    assert!(
        run_command(
            fake("head -c 4097 /dev/zero >&2"),
            &AtomicBool::new(false),
            Duration::from_secs(1),
            || true
        )
        .is_err()
    );
    assert_eq!(
        run_command(
            fake("exit 7"),
            &AtomicBool::new(false),
            Duration::from_secs(1),
            || true
        )
        .unwrap_err()
        .1,
        "IMAGE_DERIVATIVE_FAILED"
    );
    assert!(
        run_command(
            fake("exec sleep 10"),
            &AtomicBool::new(false),
            Duration::from_secs(1),
            || false
        )
        .is_err()
    );
    std::fs::remove_dir_all(root).unwrap();
}
