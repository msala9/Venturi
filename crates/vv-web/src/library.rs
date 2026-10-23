use crate::error::{ApiError, Result};
use reqwest::{Url, blocking::Client, redirect::Policy};
use rustix::fs::{Mode, OFlags, RenameFlags, openat, renameat_with, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    fs::File,
    io::{Read, Write},
    os::fd::AsRawFd,
    os::unix::fs::FileExt,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};

const MAX_ITEM: u64 = 512 * 1024 * 1024;
const MAX_INDEX: u64 = 4 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub tool: String,
    pub model: String,
    pub mime: String,
    pub filename: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default, deserialize_with = "seed")]
    pub seed: Option<String>,
    pub bytes: u64,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub steps: u32,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub keep: bool,
}
fn seed<'de, D: serde::Deserializer<'de>>(
    input: D,
) -> std::result::Result<Option<String>, D::Error> {
    let value = Option::<Value>::deserialize(input)?;
    let value = match value {
        None => return Ok(None),
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(n)) => n.parse::<u64>().ok(),
        _ => None,
    }
    .ok_or_else(|| serde::de::Error::custom("Invalid library seed"))?;
    Ok((value != 0).then(|| value.to_string()))
}
impl Item {
    fn extension(&self) -> Result<&'static str> {
        match (self.kind.as_str(), self.mime.as_str()) {
            ("image", "image/png") => Ok("png"),
            ("image", "image/jpeg") => Ok("jpg"),
            ("image", "image/webp") => Ok("webp"),
            ("video", "video/mp4") => Ok("mp4"),
            ("video", "video/webm") | ("audio", "audio/webm") => Ok("webm"),
            ("audio", "audio/mpeg") => Ok("mp3"),
            ("audio", "audio/wav") => Ok("wav"),
            _ => Err(ApiError::invalid("Unsupported shared-library media type")),
        }
    }
    fn validate(&self) -> Result<()> {
        valid_id(&self.id)?;
        let extension = self.extension()?;
        if self.filename != format!("{}.{}", self.id, extension)
            || self.bytes == 0
            || self.model.is_empty()
            || self.model.len() > 72
            || self.tool.len() > 16
            || self.prompt.len() > 512
            || self.created.len() > 24
        {
            return Err(ApiError::invalid(
                "Shared-library item has invalid catalog metadata",
            ));
        }
        Ok(())
    }
    fn validate_copy(&self) -> Result<()> {
        self.validate()?;
        if self.bytes > MAX_ITEM {
            return Err(ApiError::conflict(
                "LIBRARY_COPY_LIMIT",
                "Project copies support shared assets up to 512 MiB",
            ));
        }
        Ok(())
    }
}
fn valid_id(id: &str) -> Result<()> {
    if id.len() != 16
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ApiError::invalid("Invalid shared-library item ID"));
    }
    Ok(())
}
#[derive(Deserialize, Serialize)]
struct Archive {
    configured: bool,
    reachable: bool,
    retention_days: u32,
}
#[derive(Deserialize, Serialize)]
struct Catalog {
    archive: Archive,
    sequence: u64,
    items: Vec<Item>,
}
fn parse_catalog(bytes: &[u8]) -> Result<Catalog> {
    if bytes.len() as u64 > MAX_INDEX {
        return Err(ApiError::invalid("Shared-library index exceeds 4 MiB"));
    }
    let catalog: Catalog = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::invalid("Shared library returned an invalid catalog"))?;
    if catalog.items.len() > 5000 {
        return Err(ApiError::invalid("Shared library exceeds 5000 items"));
    }
    let mut ids = HashSet::new();
    for item in &catalog.items {
        item.validate()?;
        if !ids.insert(&item.id) {
            return Err(ApiError::invalid(
                "Shared library contains duplicate item IDs",
            ));
        }
    }
    Ok(catalog)
}
fn endpoint(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| ApiError::invalid("Invalid library service URL"))?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(ApiError::invalid(
            "Library URL must be an HTTP(S) origin without credentials, query or path",
        ));
    }
    Ok(url)
}
fn client() -> Result<Client> {
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| unavailable())
}
fn unavailable() -> ApiError {
    ApiError(
        axum::http::StatusCode::BAD_GATEWAY,
        "LIBRARY_UNAVAILABLE",
        "The configured shared library is unavailable",
    )
}
fn validate_header(file: &File, item: &Item) -> Result<()> {
    let mut header = [0; 12];
    let count = file.read_at(&mut header, 0).map_err(|_| ApiError::io())?;
    // Reject playlists before native probing can resolve external files.
    let valid = match item.mime.as_str() {
        "image/png" => count >= 8 && header[..8] == *b"\x89PNG\r\n\x1a\n",
        "image/jpeg" => count >= 3 && header[..3] == [0xff, 0xd8, 0xff],
        "image/webp" => count == 12 && &header[..4] == b"RIFF" && &header[8..] == b"WEBP",
        "audio/wav" => {
            count == 12
                && [&b"RIFF"[..], &b"RF64"[..]].contains(&&header[..4])
                && &header[8..] == b"WAVE"
        }
        "video/mp4" => count >= 8 && &header[4..8] == b"ftyp",
        "video/webm" | "audio/webm" => count >= 4 && header[..4] == [0x1a, 0x45, 0xdf, 0xa3],
        "audio/mpeg" => {
            count >= 3
                && (&header[..3] == b"ID3" || (header[0] == 0xff && header[1] & 0xe0 == 0xe0))
        }
        _ => false,
    };
    if !valid {
        return Err(ApiError::invalid(
            "Shared asset bytes do not match their declared media type",
        ));
    }
    Ok(())
}
struct Job {
    id: String,
    epoch: String,
    item: Item,
    state: &'static str,
    bytes: u64,
    result: Option<Value>,
    error: Option<&'static str>,
    cancel: Arc<AtomicBool>,
}
impl Job {
    fn value(&self) -> Value {
        json!({"id":self.id,"item_id":self.item.id,"state":self.state,"bytes":self.bytes,"total_bytes":self.item.bytes,"result":self.result,"error":self.error})
    }
}
struct State {
    url: Url,
    dir: File,
    jobs: Mutex<VecDeque<Job>>,
    catalog_slots: Arc<tokio::sync::Semaphore>,
    send: mpsc::SyncSender<(String, Item)>,
}
#[derive(Clone, Default)]
pub struct Library(Option<Arc<State>>);
impl Library {
    pub fn start(url: Option<&str>, dir: File) -> Result<Self> {
        let Some(url) = url else {
            return Ok(Self::default());
        };
        let (send, receive) = mpsc::sync_channel::<(String, Item)>(1);
        let state = Arc::new(State {
            url: endpoint(url)?,
            dir,
            jobs: Mutex::new(VecDeque::new()),
            catalog_slots: Arc::new(tokio::sync::Semaphore::new(2)),
            send,
        });
        let worker = Arc::downgrade(&state);
        std::thread::spawn(move || {
            while let Ok((id, item)) = receive.recv() {
                let Some(state) = worker.upgrade() else {
                    break;
                };
                let cancel = {
                    let mut jobs = state.jobs.lock().unwrap();
                    let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
                        continue;
                    };
                    job.state = "running";
                    job.cancel.clone()
                };
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    state.download(&item, &id, &cancel, |bytes| {
                        if let Some(job) = state
                            .jobs
                            .lock()
                            .unwrap()
                            .iter_mut()
                            .find(|job| job.id == id)
                        {
                            job.bytes = bytes;
                        }
                    })
                }))
                .unwrap_or_else(|_| Err(ApiError::invalid("Shared-library import failed")));
                for name in [
                    format!(".venturi-library-{id}.tmp"),
                    format!(".venturi-origin-{id}.tmp"),
                ] {
                    let _ = unlinkat(&state.dir, name.as_str(), rustix::fs::AtFlags::empty());
                }
                if let Some(job) = state
                    .jobs
                    .lock()
                    .unwrap()
                    .iter_mut()
                    .find(|job| job.id == id)
                {
                    match result {
                        Ok(result) => {
                            job.result = Some(result);
                            job.state = "ready";
                        }
                        Err(error) => {
                            job.error = Some(error.2);
                            job.state = if cancel.load(Ordering::Relaxed) {
                                "canceled"
                            } else {
                                "failed"
                            };
                        }
                    }
                }
            }
        });
        Ok(Self(Some(state)))
    }
    fn state(&self) -> Result<Arc<State>> {
        self.0.clone().ok_or_else(|| {
            ApiError::conflict(
                "LIBRARY_NOT_CONFIGURED",
                "Start Venturi with --library-url pointing to ds4-appliance",
            )
        })
    }
    async fn index(&self) -> Result<Catalog> {
        let state = self.state()?;
        let permit = state
            .catalog_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                ApiError::conflict(
                    "LIBRARY_BUSY",
                    "Two shared-library catalog requests are already running",
                )
            })?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            state.catalog()
        })
        .await
        .map_err(|_| unavailable())?
    }
    pub async fn catalog(&self) -> Result<Value> {
        if self.0.is_none() {
            return Ok(json!({"configured":false,"items":[]}));
        }
        let mut value = serde_json::to_value(self.index().await?).map_err(|_| ApiError::io())?;
        value["configured"] = json!(true);
        value["max_copy_bytes"] = json!(MAX_ITEM);
        Ok(value)
    }
    pub async fn prepare(&self, id: &str, epoch: &str) -> Result<Value> {
        valid_id(id)?;
        let catalog = self.index().await?;
        let item = catalog
            .items
            .into_iter()
            .find(|item| item.id == id)
            .ok_or_else(ApiError::missing)?;
        item.validate_copy()?;
        let state = self.state()?;
        let mut jobs = state.jobs.lock().unwrap();
        if let Some(job) = jobs.iter().find(|job| {
            job.epoch == epoch
                && job.item.id == id
                && job.item.bytes == item.bytes
                && !job.cancel.load(Ordering::Relaxed)
                && ["queued", "running", "ready"].contains(&job.state)
                && (job.state != "ready"
                    || job
                        .result
                        .as_ref()
                        .is_some_and(|result| state.current(result)))
        }) {
            return Ok(job.value());
        }
        if jobs
            .iter()
            .filter(|job| ["queued", "running"].contains(&job.state))
            .count()
            >= 2
        {
            return Err(ApiError::conflict(
                "LIBRARY_BUSY",
                "One library transfer runs with one queued",
            ));
        }
        while jobs.len() >= 8 {
            let index = jobs
                .iter()
                .position(|job| !["queued", "running"].contains(&job.state))
                .ok_or_else(ApiError::io)?;
            jobs.remove(index);
        }
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        jobs.push_back(Job {
            id: id.clone(),
            epoch: epoch.into(),
            item: item.clone(),
            state: "queued",
            bytes: 0,
            result: None,
            error: None,
            cancel: Arc::new(AtomicBool::new(false)),
        });
        if state.send.try_send((id.clone(), item)).is_err() {
            jobs.retain(|job| job.id != id);
            return Err(ApiError::conflict(
                "LIBRARY_BUSY",
                "Library transfer queue is full",
            ));
        }
        Ok(jobs.back().unwrap().value())
    }
    pub fn status(&self, id: &str, epoch: &str, cancel: bool) -> Result<Value> {
        let state = self.state()?;
        let jobs = state.jobs.lock().unwrap();
        let job = jobs
            .iter()
            .find(|job| job.id == id && job.epoch == epoch)
            .ok_or_else(ApiError::missing)?;
        if cancel && ["queued", "running"].contains(&job.state) {
            job.cancel.store(true, Ordering::Relaxed);
        }
        if !cancel
            && job.state == "ready"
            && !job
                .result
                .as_ref()
                .is_some_and(|result| state.current(result))
        {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "The prepared local shared asset changed; prepare it again",
            ));
        }
        Ok(job.value())
    }
}
impl State {
    fn current(&self, result: &Value) -> bool {
        let Some(name) = result["path_token"].as_str() else {
            return false;
        };
        if name.contains(['/', '\\']) {
            return false;
        }
        let Ok(fd) = openat(
            &self.dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        ) else {
            return false;
        };
        crate::source::file_identity(&File::from(fd))
            .ok()
            .is_some_and(|identity| result["source_version"] == identity)
    }
    fn catalog(&self) -> Result<Catalog> {
        let response = client()?
            .get(self.url.join("api/v1/library").map_err(|_| unavailable())?)
            .send()
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_INDEX + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| unavailable())?;
        parse_catalog(&bytes)
    }
    fn download(
        &self,
        item: &Item,
        id: &str,
        cancel: &AtomicBool,
        mut progress: impl FnMut(u64),
    ) -> Result<Value> {
        item.validate_copy()?;
        if cancel.load(Ordering::Relaxed) {
            return Err(ApiError::invalid("Library transfer canceled"));
        }
        let temp = format!(".venturi-library-{id}.tmp");
        let result = (|| {
            let output = openat(
                &self.dir,
                temp.as_str(),
                OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?;
            let mut output = File::from(output);
            let mut response = client()?
                .get(
                    self.url
                        .join(&format!("api/v1/library/items/{}/file", item.id))
                        .map_err(|_| unavailable())?,
                )
                .timeout(Duration::from_secs(180))
                .send()
                .map_err(|_| unavailable())?;
            if !response.status().is_success()
                || response
                    .content_length()
                    .is_some_and(|bytes| bytes != item.bytes)
            {
                return Err(unavailable());
            }
            let mut bytes = 0;
            let mut hash = Sha256::new();
            let mut buffer = [0; 64 * 1024];
            loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err(ApiError::invalid("Library transfer canceled"));
                }
                let count = response.read(&mut buffer).map_err(|_| unavailable())?;
                if count == 0 {
                    break;
                }
                bytes += count as u64;
                if bytes > item.bytes || bytes > MAX_ITEM {
                    return Err(ApiError::invalid(
                        "Library transfer exceeded its declared size",
                    ));
                }
                output
                    .write_all(&buffer[..count])
                    .map_err(|_| ApiError::io())?;
                hash.update(&buffer[..count]);
                progress(bytes);
            }
            if bytes != item.bytes {
                return Err(ApiError::invalid("Library transfer was truncated"));
            }
            let digest = format!("{:x}", hash.finalize());
            validate_header(&output, item)?;
            let path = PathBuf::from(format!("/proc/self/fd/{}", output.as_raw_fd()));
            let meta = if item.kind == "image" {
                vv_media::probe_image(&path)
            } else {
                vv_media::probe_media(&path)
            }
            .map_err(|_| ApiError::invalid("The native engine could not read the shared asset"))?;
            if (item.kind == "audio" && (!meta.has_audio || meta.has_video))
                || (item.kind == "video" && !meta.has_video)
            {
                return Err(ApiError::invalid(
                    "Shared asset streams do not match their declared kind",
                ));
            }
            if meta.width > 8192
                || meta.height > 8192
                || meta.fps.num <= 0
                || meta.fps.den <= 0
                || meta.duration_frames <= 0
                || meta.duration_frames > 1_000_000_000
            {
                return Err(ApiError::invalid(
                    "Shared asset exceeds native timing or dimension limits",
                ));
            }
            let current = self
                .catalog()?
                .items
                .into_iter()
                .find(|entry| entry.id == item.id)
                .ok_or_else(ApiError::missing)?;
            if current.bytes != item.bytes
                || current.filename != item.filename
                || current.mime != item.mime
            {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Shared item changed during transfer",
                ));
            }
            if cancel.load(Ordering::Relaxed) {
                return Err(ApiError::invalid("Library transfer canceled"));
            }
            output.sync_all().map_err(|_| ApiError::io())?;
            let name = format!("ds4-{}-{}.{}", item.id, &digest[..16], item.extension()?);
            let origin = json!({"version":1,"provider":"ds4-appliance","service_origin":self.url.as_str(),"sha256":digest,"item":current});
            publish_origin(&self.dir, &format!("{name}.origin.json"), &origin, id)?;
            match renameat_with(
                &self.dir,
                temp.as_str(),
                &self.dir,
                name.as_str(),
                RenameFlags::NOREPLACE,
            ) {
                Ok(()) => {}
                Err(rustix::io::Errno::EXIST) => {
                    let existing = openat(
                        &self.dir,
                        name.as_str(),
                        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
                        Mode::empty(),
                    )
                    .map_err(|_| ApiError::io())?;
                    let mut file = File::from(existing);
                    if !file.metadata().map_err(|_| ApiError::io())?.is_file()
                        || file.metadata().map_err(|_| ApiError::io())?.len() != bytes
                    {
                        return Err(ApiError::conflict(
                            "FILE_EXISTS",
                            "A different local file already has the shared asset name",
                        ));
                    }
                    let mut hash = Sha256::new();
                    loop {
                        let count = file.read(&mut buffer).map_err(|_| ApiError::io())?;
                        if count == 0 {
                            break;
                        }
                        hash.update(&buffer[..count]);
                    }
                    if format!("{:x}", hash.finalize()) != digest {
                        return Err(ApiError::conflict(
                            "FILE_EXISTS",
                            "A changed local shared asset was preserved; choose a new project root",
                        ));
                    }
                }
                Err(_) => return Err(ApiError::io()),
            }
            self.dir.sync_all().map_err(|_| ApiError::io())?;
            let file = File::from(
                openat(
                    &self.dir,
                    name.as_str(),
                    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
                    Mode::empty(),
                )
                .map_err(|_| ApiError::io())?,
            );
            Ok(
                json!({"path_token":name,"origin":origin,"source_version":crate::source::file_identity(&file)?}),
            )
        })();
        let _ = unlinkat(&self.dir, temp.as_str(), rustix::fs::AtFlags::empty());
        result
    }
}
fn publish_origin(dir: &File, name: &str, value: &Value, id: &str) -> Result<()> {
    if let Ok(file) = openat(
        dir,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    ) {
        let file = File::from(file);
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::io());
        }
        let old: Value =
            serde_json::from_reader(file.take(16 * 1024)).map_err(|_| ApiError::io())?;
        if old["provider"] != value["provider"]
            || old["sha256"] != value["sha256"]
            || old["item"]["id"] != value["item"]["id"]
            || old["service_origin"] != value["service_origin"]
        {
            return Err(ApiError::conflict(
                "FILE_EXISTS",
                "Existing shared provenance was preserved",
            ));
        }
        return Ok(());
    }
    let temp = format!(".venturi-origin-{id}.tmp");
    let result = (|| {
        let file = openat(
            dir,
            temp.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ApiError::io())?;
        let mut file = File::from(file);
        file.write_all(&serde_json::to_vec(value).map_err(|_| ApiError::io())?)
            .map_err(|_| ApiError::io())?;
        file.sync_all().map_err(|_| ApiError::io())?;
        renameat_with(dir, temp.as_str(), dir, name, RenameFlags::NOREPLACE)
            .map_err(|_| ApiError::io())?;
        Ok(())
    })();
    let _ = unlinkat(dir, temp.as_str(), rustix::fs::AtFlags::empty());
    result
}
pub fn provenance(dir: &File, name: &str) -> Option<Value> {
    if !name.starts_with("ds4-") || name.contains(['/', '\\']) {
        return None;
    }
    let fd = openat(
        dir,
        format!("{name}.origin.json"),
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .ok()?;
    let file = File::from(fd);
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.len() > 16 * 1024 {
        return None;
    }
    let value: Value = serde_json::from_reader(file.take(16 * 1024 + 1)).ok()?;
    let item: Item = serde_json::from_value(value["item"].clone()).ok()?;
    item.validate().ok()?;
    let digest = value["sha256"].as_str()?;
    if value["version"] != 1
        || value["provider"] != "ds4-appliance"
        || digest.len() != 64
        || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        || name
            != format!(
                "ds4-{}-{}.{}",
                item.id,
                &digest[..16],
                item.extension().ok()?
            )
    {
        return None;
    }
    endpoint(value["service_origin"].as_str()?).ok()?;
    Some(value)
}

#[cfg(test)]
#[path = "tests/library.rs"]
mod tests;
