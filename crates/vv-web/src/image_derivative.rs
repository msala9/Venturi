use crate::error::{ApiError, Result};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    os::{
        fd::AsRawFd,
        unix::{
            fs::{FileExt, MetadataExt},
            process::CommandExt,
        },
    },
    path::Path,
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DIAGNOSTIC: usize = 4096;
const DEADLINE: Duration = Duration::from_secs(20);
const FLAG: &str = "--image-derivative";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Full,
    Thumbnail,
}
impl Mode {
    fn name(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Thumbnail => "thumbnail",
        }
    }
}

fn failure(message: &'static str) -> ApiError {
    ApiError::conflict("IMAGE_DERIVATIVE_FAILED", message)
}
fn canceled() -> ApiError {
    ApiError::conflict("SOURCE_CANCELED", "Image preparation was canceled")
}
fn dimensions(size: (u32, u32)) -> Result<()> {
    if size.0 == 0 || size.1 == 0 || size.0 > 8192 || size.1 > 8192 {
        return Err(ApiError::invalid(
            "Image dimensions must be within 8192 pixels",
        ));
    }
    Ok(())
}
fn parse_args(args: &[String]) -> Result<(Mode, (u32, u32), u32)> {
    let [flag, mode, width, height, thumb] = args else {
        return Err(ApiError::invalid(
            "Expected an image derivative size and descriptor",
        ));
    };
    let mode = match mode.as_str() {
        "full" => Mode::Full,
        "thumbnail" => Mode::Thumbnail,
        _ => return Err(ApiError::invalid("Invalid image derivative mode")),
    };
    if flag != FLAG
        || [width, height, thumb]
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err(ApiError::invalid("Invalid image derivative arguments"));
    }
    let size = (
        width
            .parse()
            .map_err(|_| ApiError::invalid("Invalid image width"))?,
        height
            .parse()
            .map_err(|_| ApiError::invalid("Invalid image height"))?,
    );
    dimensions(size)?;
    let thumb = thumb
        .parse::<u32>()
        .map_err(|_| ApiError::invalid("Invalid image thumbnail descriptor"))?;
    if !(3..=1_048_576).contains(&thumb) {
        return Err(ApiError::invalid("Invalid image thumbnail descriptor"));
    }
    Ok((mode, size, thumb))
}
fn input(file: &File, mode: Mode) -> Result<()> {
    let meta = file.metadata().map_err(|_| ApiError::io())?;
    let mut header = [0; 12];
    let count = file.read_at(&mut header, 0).map_err(|_| ApiError::io())?;
    if !meta.is_file()
        || meta.len() > MAX_BYTES
        || !(count >= 2 && &header[..2] == b"BM"
            || count >= 4 && (&header[..4] == b"II\x2a\0" || &header[..4] == b"MM\0\x2a")
            || mode == Mode::Thumbnail
                && (count >= 8 && &header[..8] == b"\x89PNG\r\n\x1a\n"
                    || count >= 3 && header[..3] == [0xff, 0xd8, 0xff]
                    || count == 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP"))
    {
        return Err(ApiError::invalid(
            "The image derivative requires a bounded native still format",
        ));
    }
    Ok(())
}
fn output(file: &File, size: (u32, u32), limit: u64) -> Result<()> {
    let meta = file.metadata().map_err(|_| ApiError::io())?;
    let mut header = [0; 24];
    if !meta.is_file()
        || meta.len() > limit
        || file.read_at(&mut header, 0).map_err(|_| ApiError::io())? != header.len()
        || &header[..8] != b"\x89PNG\r\n\x1a\n"
        || &header[12..16] != b"IHDR"
        || u32::from_be_bytes(header[16..20].try_into().unwrap()) != size.0
        || u32::from_be_bytes(header[20..24].try_into().unwrap()) != size.1
    {
        return Err(failure("The isolated image helper produced an invalid PNG"));
    }
    Ok(())
}
struct Guard {
    child: Child,
    reaped: bool,
}
impl Drop for Guard {
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
fn command(
    executable: &Path,
    source: &File,
    destination: Option<&File>,
    thumbnail: &File,
    size: (u32, u32),
    mode: Mode,
) -> Result<Command> {
    let mut command = Command::new(executable);
    let thumbnail = thumbnail.try_clone().map_err(|_| ApiError::io())?;
    let descriptor = thumbnail.as_raw_fd().to_string();
    #[cfg(not(test))]
    command.args([
        FLAG,
        mode.name(),
        &size.0.to_string(),
        &size.1.to_string(),
        &descriptor,
    ]);
    #[cfg(test)]
    command
        .args([
            "--exact",
            "image_derivative::tests::isolated_child_entry",
            "--nocapture",
            "--quiet",
            "--test-threads=1",
        ])
        .env("VV_WEB_IMAGE_DERIVATIVE_CHILD", "1")
        .env("VV_WEB_IMAGE_MODE", mode.name())
        .env("VV_WEB_IMAGE_WIDTH", size.0.to_string())
        .env("VV_WEB_IMAGE_HEIGHT", size.1.to_string())
        .env("VV_WEB_IMAGE_THUMB_FD", descriptor);
    // Only this owned output clone survives exec in addition to stdio.
    unsafe {
        command.pre_exec(move || {
            rustix::io::fcntl_setfd(&thumbnail, rustix::io::FdFlags::empty())
                .map_err(std::io::Error::from)
        });
    }
    command
        .stdin(Stdio::from(source.try_clone().map_err(|_| ApiError::io())?))
        .stdout(match destination {
            Some(file) => Stdio::from(file.try_clone().map_err(|_| ApiError::io())?),
            None => Stdio::null(),
        })
        .stderr(Stdio::piped())
        .process_group(0);
    Ok(command)
}
fn run_command(
    mut command: Command,
    cancel: &AtomicBool,
    timeout: Duration,
    mut keep_running: impl FnMut() -> bool,
) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    if !keep_running() {
        return Err(failure("Image preparation exceeded its disk budget"));
    }
    let mut guard = Guard {
        child: command
            .spawn()
            .map_err(|_| failure("The isolated image helper could not start"))?,
        reaped: false,
    };
    let mut stderr = guard
        .child
        .stderr
        .take()
        .ok_or_else(|| failure("Missing image helper diagnostics"))?;
    rustix::fs::fcntl_setfl(&stderr, rustix::fs::OFlags::NONBLOCK).map_err(|_| ApiError::io())?;
    let start = Instant::now();
    let mut diagnostic = Vec::new();
    let mut buffer = [0; 1024];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(canceled());
        }
        if start.elapsed() >= timeout {
            return Err(ApiError::conflict(
                "IMAGE_DERIVATIVE_TIMEOUT",
                "The isolated image helper exceeded 20 seconds",
            ));
        }
        if !keep_running() {
            return Err(failure("Image preparation exceeded its disk budget"));
        }
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if diagnostic.len().saturating_add(count) > MAX_DIAGNOSTIC {
                        return Err(failure("The image helper exceeded its diagnostic budget"));
                    }
                    diagnostic.extend_from_slice(&buffer[..count]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(ApiError::io()),
            }
        }
        if let Some(status) = guard.child.try_wait().map_err(|_| ApiError::io())? {
            guard.reaped = true;
            if cancel.load(Ordering::Acquire) {
                return Err(canceled());
            }
            return if status.success() {
                Ok(())
            } else {
                let text: String = String::from_utf8_lossy(&diagnostic)
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(256)
                    .collect();
                eprintln!("The isolated image helper failed ({status}): {text}");
                Err(failure(
                    "The isolated image helper failed; inspect its bounded exit diagnostic",
                ))
            };
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
pub fn generate(
    source: &File,
    destination: &File,
    thumbnail: &File,
    size: (u32, u32),
    cancel: &AtomicBool,
    keep_running: impl FnMut() -> bool,
) -> Result<()> {
    dimensions(size)?;
    input(source, Mode::Full)?;
    let before = crate::asset_store::stable_identity(source)?;
    let original = source.metadata().map_err(|_| ApiError::io())?;
    let target = destination.metadata().map_err(|_| ApiError::io())?;
    let thumb = thumbnail.metadata().map_err(|_| ApiError::io())?;
    if !target.is_file()
        || target.len() != 0
        || (target.dev(), target.ino()) == (original.dev(), original.ino())
    {
        return Err(ApiError::invalid(
            "Image output must be a separate empty owned file",
        ));
    }
    if !thumb.is_file()
        || thumb.len() != 0
        || [
            (original.dev(), original.ino()),
            (target.dev(), target.ino()),
        ]
        .contains(&(thumb.dev(), thumb.ino()))
    {
        return Err(ApiError::invalid(
            "Image thumbnail must be a separate empty owned file",
        ));
    }
    let executable = std::env::current_exe().map_err(|_| ApiError::io())?;
    run_command(
        command(
            &executable,
            source,
            Some(destination),
            thumbnail,
            size,
            Mode::Full,
        )?,
        cancel,
        DEADLINE,
        keep_running,
    )?;
    if crate::asset_store::stable_identity(source)? != before {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Image changed during isolated decoding",
        ));
    }
    output(destination, size, MAX_BYTES)?;
    let width = size.0.min(256);
    output(
        thumbnail,
        (
            width,
            (u64::from(size.1) * u64::from(width) / u64::from(size.0)).max(1) as u32,
        ),
        1024 * 1024,
    )
}
pub fn generate_thumbnail(
    source: &File,
    thumbnail: &File,
    size: (u32, u32),
    cancel: &AtomicBool,
    keep_running: impl FnMut() -> bool,
) -> Result<()> {
    dimensions(size)?;
    input(source, Mode::Thumbnail)?;
    let before = crate::asset_store::stable_identity(source)?;
    let original = source.metadata().map_err(|_| ApiError::io())?;
    let thumb = thumbnail.metadata().map_err(|_| ApiError::io())?;
    if !thumb.is_file()
        || thumb.len() != 0
        || (thumb.dev(), thumb.ino()) == (original.dev(), original.ino())
    {
        return Err(ApiError::invalid(
            "Image thumbnail must be a separate empty owned file",
        ));
    }
    let executable = std::env::current_exe().map_err(|_| ApiError::io())?;
    run_command(
        command(&executable, source, None, thumbnail, size, Mode::Thumbnail)?,
        cancel,
        DEADLINE,
        keep_running,
    )?;
    if crate::asset_store::stable_identity(source)? != before {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Image changed during isolated decoding",
        ));
    }
    let width = size.0.min(256);
    output(
        thumbnail,
        (
            width,
            (u64::from(size.1) * u64::from(width) / u64::from(size.0)).max(1) as u32,
        ),
        1024 * 1024,
    )
}
fn sandbox(mode: Mode) -> std::result::Result<(), Box<dyn std::error::Error>> {
    use rustix::process::{Resource, Rlimit, setrlimit};
    rustix::process::setpriority_process(None, 19)?;
    std::fs::write("/proc/self/oom_score_adj", "1000")?;
    let allowed = rustix::thread::sched_getaffinity(None)?;
    let cpu = (0..rustix::thread::CpuSet::MAX_CPU)
        .find(|&cpu| allowed.is_set(cpu))
        .ok_or("No image helper CPU")?;
    let mut selected = rustix::thread::CpuSet::new();
    selected.set(cpu);
    rustix::thread::sched_setaffinity(None, &selected)?;
    for (resource, limit) in [
        (Resource::As, MAX_BYTES),
        (Resource::Cpu, 10),
        (
            Resource::Fsize,
            if mode == Mode::Full {
                MAX_BYTES
            } else {
                1024 * 1024
            },
        ),
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
        .name("image-derivative-deadline".into())
        .stack_size(64 * 1024)
        .spawn(|| {
            std::thread::sleep(DEADLINE);
            std::process::abort();
        })?;
    Ok(())
}
fn close_inherited(thumbnail: u32) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut descriptors = Vec::new();
    for entry in std::fs::read_dir("/proc/self/fd")? {
        if descriptors.len() >= 4096 {
            return Err("Too many inherited image helper descriptors".into());
        }
        if let Ok(fd) = entry?.file_name().to_string_lossy().parse::<i32>()
            && fd > 2
            && fd as u32 != thumbnail
        {
            descriptors.push(fd);
        }
    }
    unsafe extern "C" {
        fn close(fd: i32) -> i32;
    }
    for fd in descriptors {
        // This freshly exec'd helper owns every descriptor; the enumeration FD may already be closed.
        unsafe {
            close(fd);
        }
    }
    Ok(())
}
pub fn child_main(args: &[String]) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (mode, size, thumbnail_fd) = parse_args(args).map_err(|error| error.2)?;
    close_inherited(thumbnail_fd)?;
    sandbox(mode)?;
    let source = File::open("/proc/self/fd/0")?;
    let mut destination = if mode == Mode::Full {
        Some(
            std::fs::OpenOptions::new()
                .write(true)
                .open("/proc/self/fd/1")?,
        )
    } else {
        None
    };
    let mut thumbnail = std::fs::OpenOptions::new()
        .write(true)
        .open(format!("/proc/self/fd/{thumbnail_fd}"))?;
    input(&source, mode).map_err(|error| error.2)?;
    let before = crate::asset_store::stable_identity(&source).map_err(|error| error.2)?;
    let source_path = Path::new("/proc/self/fd/0");
    let meta = vv_media::probe_image(source_path)?;
    if (meta.width, meta.height) != size {
        return Err("Image dimensions changed".into());
    }
    if let Some(destination) = &mut destination {
        let image = vv_media::thumbnail::generate_still_preview_bounded(source_path, size.0)?;
        if (image.width, image.height) != size {
            return Err("Image dimensions changed during decode".into());
        }
        destination.set_len(0)?;
        destination.seek(SeekFrom::Start(0))?;
        {
            let mut encoder = png::Encoder::new(&mut *destination, size.0, size.1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header()?.write_image_data(&image.rgba)?;
        }
        destination.flush()?;
        destination.sync_all()?;
        drop(image);
    }
    let image = vv_media::thumbnail::generate_thumbnail_bounded(source_path, 0.0, 256)?;
    thumbnail.set_len(0)?;
    thumbnail.seek(SeekFrom::Start(0))?;
    {
        let mut encoder = png::Encoder::new(&mut thumbnail, image.width, image.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header()?.write_image_data(&image.rgba)?;
    }
    thumbnail.flush()?;
    thumbnail.sync_all()?;
    if crate::asset_store::stable_identity(&source).map_err(|error| error.2)? != before {
        return Err("Image source changed".into());
    }
    if destination
        .as_ref()
        .map(|file| file.metadata().map(|meta| meta.len()))
        .transpose()?
        .is_some_and(|bytes| bytes > MAX_BYTES)
        || thumbnail.metadata()?.len() > 1024 * 1024
    {
        return Err("Image output exceeded its budget".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/image_derivative.rs"]
mod tests;
