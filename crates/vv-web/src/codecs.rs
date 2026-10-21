use crate::{
    error::{ApiError, Result},
    preview::Preview,
    program::ExportOptions,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::Read,
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt},
        process::CommandExt,
    },
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use vv_media::{HwDevice, VideoCodec};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Encoder {
    #[default]
    X264,
    Nvenc,
    Vulkan,
    Videotoolbox,
}
impl Encoder {
    pub fn is_default(&self) -> bool {
        *self == Self::X264
    }
    pub fn native(self) -> VideoCodec {
        match self {
            Self::X264 => VideoCodec::X264,
            Self::Nvenc => VideoCodec::Nvenc,
            Self::Vulkan => VideoCodec::Vulkan,
            Self::Videotoolbox => VideoCodec::VideoToolbox,
        }
    }
    fn from_native(codec: VideoCodec) -> Self {
        match codec {
            VideoCodec::X264 => Self::X264,
            VideoCodec::Nvenc => Self::Nvenc,
            VideoCodec::Vulkan => Self::Vulkan,
            VideoCodec::VideoToolbox => Self::Videotoolbox,
        }
    }
    fn id(self) -> &'static str {
        match self {
            Self::X264 => "x264",
            Self::Nvenc => "nvenc",
            Self::Vulkan => "vulkan",
            Self::Videotoolbox => "videotoolbox",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::X264 => "x264 (CPU)",
            Self::Nvenc => "NVIDIA NVENC",
            Self::Vulkan => "Vulkan (FFmpeg default device)",
            Self::Videotoolbox => "Apple VideoToolbox",
        }
    }
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Decoder {
    #[default]
    Software,
    Nvdec,
    Vulkan,
}
impl Decoder {
    pub fn is_default(&self) -> bool {
        *self == Self::Software
    }
    pub fn devices(self, preview: &Preview) -> Vec<HwDevice> {
        match self {
            Self::Software => vec![],
            Self::Nvdec => vec![HwDevice::Cuda],
            Self::Vulkan => preview.decoder_device().into_iter().collect(),
        }
    }
    fn id(self) -> &'static str {
        match self {
            Self::Software => "software",
            Self::Nvdec => "nvdec",
            Self::Vulkan => "vulkan",
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Encoder,
    Decoder,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeRequest {
    pub kind: Kind,
    pub id: String,
    #[serde(default)]
    pub force: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProbeResult {
    available: bool,
}
#[derive(Default)]
struct State {
    results: BTreeMap<String, ProbeResult>,
    checking: Option<String>,
}
struct Inner {
    preview: Preview,
    identity: String,
    build: Value,
    state: Mutex<State>,
}
#[derive(Clone)]
pub struct Codecs(Arc<Inner>);
struct Flight(Arc<Inner>);
impl Drop for Flight {
    fn drop(&mut self) {
        self.0
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .checking = None;
    }
}
impl Codecs {
    pub fn new(preview: Preview) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let executable = std::env::current_exe()
            .ok()
            .and_then(|p| p.metadata().ok())
            .map(|m| {
                format!(
                    "{}:{}:{}:{}:{}",
                    m.dev(),
                    m.ino(),
                    m.len(),
                    m.mtime(),
                    m.mtime_nsec()
                )
            })
            .unwrap_or_else(|| "unknown".into());
        let build = json!({"version":env!("CARGO_PKG_VERSION"),"executable_version":executable});
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let scope = format!(
            "{build}:{}:{}:{}:{nonce}",
            preview.diagnostic(),
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let identity = format!("{:x}", Sha256::digest(scope.as_bytes()));
        Self(Arc::new(Inner {
            preview,
            identity,
            build,
            state: Mutex::new(State::default()),
        }))
    }
    pub fn catalog(&self) -> Value {
        let state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
        let status = |kind, id: &str, hardware| {
            if hardware && !self.0.preview.hardware_enabled() {
                return json!({"status":"disabled","reason":"Hardware codecs require an available hardware preview host"});
            }
            let key = key(kind, id);
            if state.checking.as_ref() == Some(&key) {
                return json!({"status":"checking"});
            }
            match state.results.get(&key) {
                Some(result) if result.available => json!({"status":"available"}),
                Some(_) => {
                    json!({"status":"unavailable","reason":"The native codec or decoded color check failed"})
                }
                None if !hardware => json!({"status":"available"}),
                None => json!({"status":"not_checked"}),
            }
        };
        let encoders: Vec<_> = VideoCodec::choices().iter().map(|&codec| {
            let encoder = Encoder::from_native(codec);
            let range = codec.quality_range();
            let mut row = status(Kind::Encoder,encoder.id(),!encoder.is_default());
            row["id"] = json!(encoder.id()); row["label"] = json!(encoder.label());
            row["quality"] = json!({"min":range.start(),"max":range.end(),"rises":codec.quality_rises(),"default":codec.default_quality(),"label":match encoder { Encoder::X264=>"CRF",Encoder::Nvenc=>"CQ",Encoder::Vulkan=>"QP",Encoder::Videotoolbox=>"Quality" }});
            row["presets"] = json!(codec.presets()); row["default_preset"] = json!(codec.default_preset());
            row
        }).collect();
        let decoders: Vec<_> = [Decoder::Software, Decoder::Nvdec, Decoder::Vulkan]
            .into_iter()
            .map(|decoder| {
                let mut row = status(Kind::Decoder, decoder.id(), !decoder.is_default());
                row["id"] = json!(decoder.id());
                row["label"] = json!(match decoder {
                    Decoder::Software => "Software (CPU)".to_owned(),
                    Decoder::Nvdec => "NVIDIA NVDEC".to_owned(),
                    Decoder::Vulkan => format!(
                        "Vulkan ({})",
                        self.0.preview.diagnostic()["name"]
                            .as_str()
                            .unwrap_or("configured adapter")
                    ),
                });
                row
            })
            .collect();
        json!({"identity":self.0.identity,"build":self.0.build,"adapter":self.0.preview.diagnostic(),"encoders":encoders,"decoders":decoders,"audio":crate::program::audio_catalog()})
    }
    pub fn validate_export(&self, options: &ExportOptions) -> Result<()> {
        options.validate()?;
        for (kind, id, hardware) in [
            (
                Kind::Encoder,
                options.encoder.id(),
                !options.encoder.is_default(),
            ),
            (
                Kind::Decoder,
                options.decoder.id(),
                !options.decoder.is_default(),
            ),
        ] {
            if !hardware {
                continue;
            }
            if !self.0.preview.hardware_enabled() {
                return Err(ApiError::invalid(
                    "Hardware codecs are disabled on this preview host",
                ));
            }
            let state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
            if state.checking.is_some() {
                return Err(ApiError::conflict(
                    "CODEC_PROBE_BUSY",
                    "A codec check is active",
                ));
            }
            if !state
                .results
                .get(&key(kind, id))
                .is_some_and(|r| r.available)
            {
                return Err(ApiError::conflict(
                    "CODEC_NOT_CHECKED",
                    "Check the selected hardware codec on this host before exporting",
                ));
            }
        }
        Ok(())
    }
    pub fn probe(&self, request: ProbeRequest) -> Result<Value> {
        self.probe_with(request, |request, hardware| {
            self.0
                .preview
                .with_codec_probe(hardware, |lease| run_child(request, &self.0.preview, lease))
        })
    }
    fn probe_with(
        &self,
        request: ProbeRequest,
        operation: impl FnOnce(&ProbeRequest, bool) -> Result<ProbeResult>,
    ) -> Result<Value> {
        let hardware = validate_request(&request)?;
        if hardware && !self.0.preview.hardware_enabled() {
            return Err(ApiError::invalid(
                "Hardware codec probes are disabled on this preview host",
            ));
        }
        let cache_key = key(request.kind, &request.id);
        {
            let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
            if state.checking.is_some() {
                return Err(ApiError::conflict(
                    "CODEC_PROBE_BUSY",
                    "Another codec check is active",
                ));
            }
            if !request.force && state.results.contains_key(&cache_key) {
                drop(state);
                return Ok(self.catalog());
            }
            state.checking = Some(cache_key.clone());
        }
        let flight = Flight(self.0.clone());
        let result = operation(&request, hardware)?;
        self.0
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .results
            .insert(cache_key, result);
        drop(flight);
        Ok(self.catalog())
    }
}
fn key(kind: Kind, id: &str) -> String {
    format!(
        "{}:{id}",
        match kind {
            Kind::Encoder => "encoder",
            Kind::Decoder => "decoder",
        }
    )
}
fn validate_request(request: &ProbeRequest) -> Result<bool> {
    match request.kind {
        Kind::Encoder => VideoCodec::choices()
            .iter()
            .map(|&c| Encoder::from_native(c))
            .find(|e| e.id() == request.id)
            .map(|e| !e.is_default()),
        Kind::Decoder => [Decoder::Software, Decoder::Nvdec, Decoder::Vulkan]
            .into_iter()
            .find(|d| d.id() == request.id)
            .map(|d| !d.is_default()),
    }
    .ok_or_else(|| ApiError::invalid("Choose a codec from the native platform catalog"))
}
fn transient(code: &'static str, message: &'static str) -> ApiError {
    ApiError(axum::http::StatusCode::SERVICE_UNAVAILABLE, code, message)
}
struct PrivateDirectory(PathBuf);
impl PrivateDirectory {
    fn create() -> Result<Self> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        for _ in 0..8 {
            let path = std::env::temp_dir().join(format!(
                "vv-web-codec-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let mut builder = std::fs::DirBuilder::new();
            use std::os::unix::fs::DirBuilderExt;
            match builder.mode(0o700).create(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(ApiError::io()),
            }
        }
        Err(ApiError::io())
    }
    fn file(&self, name: &str) -> Result<File> {
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(self.0.join(name))
            .map_err(|_| ApiError::io())
    }
}
impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        if let Ok(entries) = std::fs::read_dir(&self.0) {
            for entry in entries.take(8).flatten() {
                if entry.file_type().is_ok_and(|t| t.is_file()) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        let _ = std::fs::remove_dir(&self.0);
    }
}
struct ProbeChild {
    child: Child,
    reaped: bool,
}
impl Drop for ProbeChild {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        if let Ok(raw) = i32::try_from(self.child.id())
            && let Some(pid) = rustix::process::Pid::from_raw(raw)
        {
            let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        }
        let _ = self.child.wait();
    }
}
fn probe_command(
    request: &ProbeRequest,
    preview: &Preview,
    lease: Option<&File>,
    directory: &PrivateDirectory,
) -> Result<Command> {
    let mut command = Command::new(std::env::current_exe().map_err(|_| ApiError::io())?);
    let adapter = if request.kind == Kind::Decoder && request.id == "vulkan" {
        preview.diagnostic()["name"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    } else {
        String::new()
    };
    command.args([
        "--codec-probe",
        match request.kind {
            Kind::Encoder => "encoder",
            Kind::Decoder => "decoder",
        },
        &request.id,
        &adapter,
    ]);
    command
        .current_dir(&directory.0)
        .env("TMPDIR", &directory.0)
        .env_remove("VV_WEB_CODEC_LEASE")
        .stdin(Stdio::null())
        .stdout(Stdio::from(directory.file("result.json")?))
        .stderr(Stdio::from(directory.file("stderr.log")?))
        .process_group(0);
    if let Some(lease) = lease {
        let meta = lease.metadata().map_err(|_| ApiError::io())?;
        command
            .stdin(Stdio::from(lease.try_clone().map_err(|_| ApiError::io())?))
            .env(
                "VV_WEB_CODEC_LEASE",
                format!("{}:{}", meta.dev(), meta.ino()),
            );
    }
    Ok(command)
}
fn wait_child(child: &mut ProbeChild, timeout: Duration) -> Result<()> {
    let started = Instant::now();
    loop {
        match child.child.try_wait().map_err(|_| ApiError::io())? {
            Some(status) => {
                child.reaped = true;
                return if status.success() {
                    Ok(())
                } else {
                    Err(transient(
                        "CODEC_PROBE_FAILED",
                        "The isolated codec check failed; availability was not changed",
                    ))
                };
            }
            None if started.elapsed() >= timeout => {
                return Err(transient(
                    "CODEC_PROBE_TIMEOUT",
                    "The codec check timed out; availability was not changed",
                ));
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}
fn run_child(
    request: &ProbeRequest,
    preview: &Preview,
    lease: Option<&File>,
) -> Result<ProbeResult> {
    let mut memory = String::new();
    let memory_ok = File::open("/proc/meminfo")
        .and_then(|file| file.take(64 * 1024).read_to_string(&mut memory))
        .is_ok()
        && memory_headroom(&memory);
    if !memory_ok {
        return Err(transient(
            "CODEC_PROBE_MEMORY",
            "At least 4 GiB of shared-host available memory is required for a codec check",
        ));
    }
    if !bounded_cgroup() {
        return Err(transient(
            "CODEC_PROBE_RESOURCE_LIMIT",
            "Codec checks require a cgroup memory limit of at most 4 GiB and zero swap",
        ));
    }
    let directory = PrivateDirectory::create()?;
    let mut command = probe_command(request, preview, lease, &directory)?;
    let mut child = ProbeChild {
        child: command.spawn().map_err(|_| {
            transient(
                "CODEC_PROBE_FAILED",
                "The isolated codec check could not start",
            )
        })?,
        reaped: false,
    };
    wait_child(&mut child, Duration::from_secs(20))?;
    let mut bytes = Vec::new();
    File::open(directory.0.join("result.json"))
        .map_err(|_| ApiError::io())?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() > 64 * 1024 {
        return Err(transient(
            "CODEC_PROBE_FAILED",
            "The codec check returned an invalid result",
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| {
        transient(
            "CODEC_PROBE_FAILED",
            "The codec check returned an invalid result",
        )
    })
}
fn memory_headroom(meminfo: &str) -> bool {
    meminfo
        .lines()
        .find_map(|line| {
            let mut words = line.split_whitespace();
            if words.next() != Some("MemAvailable:") {
                return None;
            }
            let kib = words.next()?.parse::<u64>().ok()?;
            (words.next() == Some("kB") && words.next().is_none()).then_some(kib >= 4 * 1024 * 1024)
        })
        .unwrap_or(false)
}
fn cgroup_value(value: &str) -> Option<Option<u64>> {
    let value = value.trim();
    if value == "max" {
        Some(None)
    } else {
        value.parse().ok().map(Some)
    }
}
fn limits_sufficient(limits: &[(Option<u64>, Option<u64>)]) -> bool {
    limits
        .iter()
        .filter_map(|(memory, _)| *memory)
        .min()
        .is_some_and(|bytes| bytes <= 4 * 1024 * 1024 * 1024)
        && limits.iter().filter_map(|(_, swap)| *swap).min() == Some(0)
}
fn bounded_cgroup() -> bool {
    fn small(path: &std::path::Path) -> std::io::Result<String> {
        let mut text = String::new();
        File::open(path)?
            .take(64 * 1024 + 1)
            .read_to_string(&mut text)?;
        if text.len() > 64 * 1024 {
            return Err(std::io::Error::other("Oversized cgroup metadata"));
        }
        Ok(text)
    }
    fn limit(path: &std::path::Path) -> Option<Option<u64>> {
        match small(path) {
            Ok(text) => cgroup_value(&text),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(None),
            Err(_) => None,
        }
    }
    let Ok(groups) = small(std::path::Path::new("/proc/self/cgroup")) else {
        return false;
    };
    let Some(group) = groups.lines().find_map(|line| line.strip_prefix("0::")) else {
        return false;
    };
    if !group.starts_with('/')
        || std::path::Path::new(group).components().any(|part| {
            !matches!(
                part,
                std::path::Component::RootDir | std::path::Component::Normal(_)
            )
        })
    {
        return false;
    }
    let root = PathBuf::from("/sys/fs/cgroup");
    let mut path = root.join(group.trim_start_matches('/'));
    let mut limits = Vec::new();
    for _ in 0..64 {
        let (Some(memory), Some(swap)) = (
            limit(&path.join("memory.max")),
            limit(&path.join("memory.swap.max")),
        ) else {
            return false;
        };
        limits.push((memory, swap));
        if path == root {
            return limits_sufficient(&limits);
        }
        if !path.pop() || !path.starts_with(&root) {
            return false;
        }
    }
    false
}
fn sandbox() -> std::result::Result<(), Box<dyn std::error::Error>> {
    use rustix::process::{Resource, Rlimit, setrlimit};
    rustix::process::setpriority_process(None, 19)?;
    std::fs::write("/proc/self/oom_score_adj", "1000")?;
    if !bounded_cgroup() {
        return Err("Missing bounded codec cgroup memory/swap policy".into());
    }
    let allowed = rustix::thread::sched_getaffinity(None)?;
    let selected = one_cpu(&allowed).ok_or("No allowed probe CPU")?;
    rustix::thread::sched_setaffinity(None, &selected)?;
    for (resource, limit) in [
        (Resource::Cpu, 10),
        (Resource::Fsize, 1024 * 1024),
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
    vv_media::hw::set_budget_bytes(64 * 1024 * 1024);
    // This deadline survives loss of the supervising server process.
    std::thread::Builder::new()
        .name("codec-wall-limit".into())
        .stack_size(64 * 1024)
        .spawn(|| {
            std::thread::sleep(Duration::from_secs(20));
            std::process::abort();
        })?;
    Ok(())
}
fn one_cpu(allowed: &rustix::thread::CpuSet) -> Option<rustix::thread::CpuSet> {
    let mut selected = rustix::thread::CpuSet::new();
    let cpu = (0..rustix::thread::CpuSet::MAX_CPU).find(|&cpu| allowed.is_set(cpu))?;
    selected.set(cpu);
    Some(selected)
}
pub fn child_main(args: &[String]) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (request, adapter) = parse_child(args)?;
    sandbox()?;
    if validate_request(&request).map_err(|e| e.2)? {
        let expected = std::env::var("VV_WEB_CODEC_LEASE")?;
        let stdin = File::open("/proc/self/fd/0")?;
        let meta = stdin.metadata()?;
        if !meta.is_file() || expected != format!("{}:{}", meta.dev(), meta.ino()) {
            return Err("Missing inherited GPU reservation".into());
        }
        // Use fd 0 itself: reopening /proc/self/fd creates a different flock owner.
        rustix::fs::flock(
            std::io::stdin(),
            rustix::fs::FlockOperation::NonBlockingLockExclusive,
        )?;
    }
    struct Devices(Vec<HwDevice>);
    impl Drop for Devices {
        fn drop(&mut self) {
            vv_media::hw::release_cached_devices(&self.0);
        }
    }
    let devices = Devices(if request.kind == Kind::Decoder {
        match request.id.as_str() {
            "nvdec" => vec![HwDevice::Cuda],
            "vulkan" => vec![HwDevice::Vulkan(Some(adapter.clone()))],
            _ => vec![],
        }
    } else {
        vec![]
    });
    let available = match request.kind {
        Kind::Encoder => VideoCodec::choices()
            .iter()
            .copied()
            .find(|&c| Encoder::from_native(c).id() == request.id)
            .ok_or("Invalid encoder")?
            .is_available(),
        Kind::Decoder => check_decoder(&request.id, &adapter).unwrap_or(false),
    };
    drop(devices);
    println!("{}", serde_json::to_string(&ProbeResult { available })?);
    Ok(())
}
fn parse_child(
    args: &[String],
) -> std::result::Result<(ProbeRequest, String), Box<dyn std::error::Error>> {
    if args.len() != 4 || args[0] != "--codec-probe" || args[3].len() > 256 {
        return Err("Invalid isolated codec arguments".into());
    }
    let kind = match args[1].as_str() {
        "encoder" => Kind::Encoder,
        "decoder" => Kind::Decoder,
        _ => return Err("Invalid codec kind".into()),
    };
    let request = ProbeRequest {
        kind,
        id: args[2].clone(),
        force: false,
    };
    validate_request(&request).map_err(|e| e.2)?;
    if (kind != Kind::Decoder || request.id != "vulkan") && !args[3].is_empty() {
        return Err("Unexpected decoder adapter".into());
    }
    if kind == Kind::Decoder && request.id == "vulkan" && args[3].is_empty() {
        return Err("Missing configured decoder adapter".into());
    }
    Ok((request, args[3].clone()))
}
fn check_decoder(id: &str, adapter: &str) -> std::result::Result<bool, Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join("decoder.mp4");
    let video = vv_media::VideoSettings::for_codec(VideoCodec::X264);
    let mut encoder = vv_media::Encoder::new_with_threads(
        &path,
        256,
        256,
        vv_core::Rational::new(25, 1),
        &video,
        None,
        1,
    )?;
    let mut frame = vec![63; 256 * 256];
    frame.extend(std::iter::repeat_n(102, 128 * 128));
    frame.extend(std::iter::repeat_n(240, 128 * 128));
    for _ in 0..5 {
        encoder.write_video_frame(&frame)?;
    }
    encoder.finish()?;
    let hardware = match id {
        "software" => vec![],
        "nvdec" => vec![HwDevice::Cuda],
        "vulkan" => vec![HwDevice::Vulkan(Some(adapter.to_owned()))],
        _ => return Err("Invalid decoder".into()),
    };
    let mut decoder =
        vv_media::Decoder::open_with_bounded(&path, &hardware, vv_media::HwPriority::Normal, 1)?;
    let (_, decoded) = decoder.next_frame()?.ok_or("No decoded frame")?;
    let (u, v) = decoded.chroma_at(64, 64);
    let color = [decoded.y[128 * 256 + 128], u, v];
    Ok(color
        .into_iter()
        .zip([63, 102, 240])
        .all(|(got, want)| got.abs_diff(want) <= 4)
        && if hardware.is_empty() {
            !decoder.is_hw()
        } else {
            decoder.is_hw() && decoder.hw_device() == hardware.first()
        })
}

#[cfg(test)]
#[path = "tests/codecs.rs"]
mod tests;
