use crate::error::{ApiError, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, ChildStdout, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OUTPUT: usize = 64 * 1024;
const DEADLINE: Duration = Duration::from_secs(20);
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Output {
    metadata: vv_core::MediaMeta,
}

fn failure() -> ApiError {
    ApiError::conflict(
        "ASSET_PROBE_FAILED",
        "The isolated native media probe failed; no asset was applied",
    )
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Mode {
    image: bool,
    root_import: bool,
}
fn parse_mode(args: &[String]) -> std::result::Result<Mode, &'static str> {
    match args {
        [flag, mode] if flag == "--asset-probe" && mode == "image" => Ok(Mode {
            image: true,
            root_import: false,
        }),
        [flag, mode] if flag == "--asset-probe" && mode == "media" => Ok(Mode {
            image: false,
            root_import: false,
        }),
        [flag, mode] if flag == "--asset-probe" && mode == "root-image" => Ok(Mode {
            image: true,
            root_import: true,
        }),
        [flag, mode] if flag == "--asset-probe" && mode == "root-media" => Ok(Mode {
            image: false,
            root_import: true,
        }),
        _ => Err("Expected --asset-probe image|media"),
    }
}
fn bounded_input(file: &File, root_import: bool) -> Result<()> {
    let metadata = file.metadata().map_err(|_| failure())?;
    if !metadata.is_file() || (!root_import && metadata.len() > MAX_BYTES) {
        return Err(ApiError::invalid(
            "Native asset probes require a regular file within 512 MiB",
        ));
    }
    Ok(())
}
fn native(file: &File, mode: Mode) -> Result<vv_core::MediaMeta> {
    use std::os::fd::AsRawFd;
    bounded_input(file, mode.root_import)?;
    if mode.root_import {
        reject_indirect(file)?;
    }
    let path = std::path::PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()));
    let metadata = if mode.image {
        vv_media::probe_image(&path)
    } else {
        vv_media::probe_media(&path)
    }
    .map_err(|_| failure())?;
    Ok(metadata)
}
fn decode(bytes: &[u8]) -> Result<vv_core::MediaMeta> {
    if bytes.len() > MAX_OUTPUT {
        return Err(failure());
    }
    let output: Output = serde_json::from_slice(bytes).map_err(|_| failure())?;
    let metadata = output.metadata;
    if metadata.duration_frames < 0
        || metadata.duration_frames > crate::commands::MAX_FRAME
        || metadata.fps.num <= 0
        || metadata.fps.den <= 0
    {
        return Err(failure());
    }
    Ok(metadata)
}
struct ProbeChild {
    child: Child,
    reaped: bool,
}
impl Drop for ProbeChild {
    fn drop(&mut self) {
        if !self.reaped {
            if let Ok(raw) = i32::try_from(self.child.id())
                && let Some(pid) = rustix::process::Pid::from_raw(raw)
            {
                let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
fn command(executable: &Path, file: &File, mode: Mode) -> Result<Command> {
    bounded_input(file, mode.root_import)?;
    let mut command = Command::new(executable);
    command
        .args([
            "--asset-probe",
            match (mode.root_import, mode.image) {
                (false, true) => "image",
                (false, false) => "media",
                (true, true) => "root-image",
                (true, false) => "root-media",
            },
        ])
        .stdin(Stdio::from(file.try_clone().map_err(|_| failure())?))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    Ok(command)
}
fn collect(
    child: &mut ProbeChild,
    output: &mut ChildStdout,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<vv_core::MediaMeta> {
    rustix::fs::fcntl_setfl(&*output, rustix::fs::OFlags::NONBLOCK).map_err(|_| failure())?;
    let start = Instant::now();
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(ApiError::conflict(
                "ASSET_CANCELED",
                "Asset preparation was canceled",
            ));
        }
        if start.elapsed() >= timeout {
            return Err(ApiError::conflict(
                "ASSET_PROBE_TIMEOUT",
                "The isolated native media probe exceeded 20 seconds",
            ));
        }
        loop {
            match output.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if bytes.len().saturating_add(count) > MAX_OUTPUT {
                        return Err(failure());
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(failure()),
            }
        }
        if let Some(status) = child.child.try_wait().map_err(|_| failure())? {
            child.reaped = true;
            loop {
                match output.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        if bytes.len().saturating_add(count) > MAX_OUTPUT {
                            return Err(failure());
                        }
                        bytes.extend_from_slice(&buffer[..count]);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => return Err(failure()),
                }
            }
            return if status.success() {
                decode(&bytes)
            } else {
                Err(failure())
            };
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn run_command(
    mut command: Command,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<vv_core::MediaMeta> {
    if cancel.load(Ordering::Acquire) {
        return Err(ApiError::conflict(
            "ASSET_CANCELED",
            "Asset preparation was canceled",
        ));
    }
    let mut child = ProbeChild {
        child: command.spawn().map_err(|_| failure())?,
        reaped: false,
    };
    let mut output = child.child.stdout.take().ok_or_else(failure)?;
    collect(&mut child, &mut output, cancel, timeout)
}
pub fn probe(file: &File, image: bool, cancel: &AtomicBool) -> Result<vv_core::MediaMeta> {
    run_probe(
        file,
        Mode {
            image,
            root_import: false,
        },
        cancel,
    )
}
pub fn probe_root_media(
    file: &File,
    image: bool,
    cancel: &AtomicBool,
    remaining: Duration,
) -> Result<vv_core::MediaMeta> {
    reject_indirect(file)?;
    run_probe_bounded(
        file,
        Mode {
            image,
            root_import: true,
        },
        cancel,
        DEADLINE.min(remaining),
    )
    .map_err(|error| match error.1 {
        "ASSET_PROBE_FAILED" => ApiError::invalid("The native engine could not read this media"),
        "ASSET_PROBE_TIMEOUT" => ApiError::conflict(
            "MEDIA_IMPORT_TIMEOUT",
            "The native media metadata probe exceeded 20 seconds",
        ),
        _ => error,
    })
}
fn reject_indirect(file: &File) -> Result<()> {
    use std::os::unix::fs::FileExt;
    let mut header = [0; 512];
    let count = file.read_at(&mut header, 0).map_err(|_| failure())?;
    let text = String::from_utf8_lossy(&header[..count]);
    let text = text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .to_ascii_lowercase();
    if text.starts_with('#')
        || text.starts_with('<')
        || text.starts_with("[playlist]")
        || text.starts_with("ffconcat")
        || text.starts_with("v=0")
    {
        return Err(ApiError::invalid(
            "Indirect playlists and network manifests cannot be imported as root media",
        ));
    }
    Ok(())
}
fn run_probe(file: &File, mode: Mode, cancel: &AtomicBool) -> Result<vv_core::MediaMeta> {
    run_probe_bounded(file, mode, cancel, DEADLINE)
}
fn run_probe_bounded(
    file: &File,
    mode: Mode,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<vv_core::MediaMeta> {
    #[cfg(test)]
    {
        if cancel.load(Ordering::Acquire) || timeout.is_zero() {
            return Err(ApiError::conflict(
                "ASSET_CANCELED",
                "Asset preparation was canceled",
            ));
        }
        native(file, mode)
    }
    #[cfg(not(test))]
    {
        let executable = std::env::current_exe().map_err(|_| failure())?;
        run_command(command(&executable, file, mode)?, cancel, timeout)
    }
}
fn sandbox() -> std::result::Result<(), Box<dyn std::error::Error>> {
    use rustix::process::{Resource, Rlimit, setrlimit};
    rustix::process::setpriority_process(None, 19)?;
    std::fs::write("/proc/self/oom_score_adj", "1000")?;
    let allowed = rustix::thread::sched_getaffinity(None)?;
    let cpu = (0..rustix::thread::CpuSet::MAX_CPU)
        .find(|&cpu| allowed.is_set(cpu))
        .ok_or("No allowed asset probe CPU")?;
    let mut selected = rustix::thread::CpuSet::new();
    selected.set(cpu);
    rustix::thread::sched_setaffinity(None, &selected)?;
    for (resource, limit) in [
        (Resource::As, MAX_BYTES),
        (Resource::Cpu, 10),
        (Resource::Fsize, MAX_OUTPUT as u64),
        (Resource::Core, 0),
    ] {
        setrlimit(
            resource,
            Rlimit {
                current: Some(limit),
                maximum: Some(limit),
            },
        )?;
    }
    std::thread::Builder::new()
        .name("asset-probe-deadline".into())
        .stack_size(64 * 1024)
        .spawn(|| {
            std::thread::sleep(DEADLINE);
            std::process::abort();
        })?;
    Ok(())
}
pub fn child_main(args: &[String]) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mode = parse_mode(args)?;
    sandbox()?;
    let file = File::open("/proc/self/fd/0")?;
    bounded_input(&file, mode.root_import).map_err(|e| e.2)?;
    let before = crate::asset_store::stable_identity(&file).map_err(|e| e.2)?;
    let metadata = native(&file, mode).map_err(|e| e.2)?;
    if crate::asset_store::stable_identity(&file).map_err(|e| e.2)? != before {
        return Err("Asset probe input changed".into());
    }
    let bytes = serde_json::to_vec(&Output { metadata })?;
    decode(&bytes).map_err(|e| e.2)?;
    std::io::stdout().lock().write_all(&bytes)?;
    Ok(())
}

#[cfg(test)]
#[path = "tests/asset_probe.rs"]
mod tests;
