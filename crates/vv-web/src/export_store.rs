use crate::{
    error::{ApiError, Result},
    source::file_identity,
};
use rustix::fs::{
    AtFlags, Mode, OFlags, RenameFlags, mkdirat, openat, renameat, renameat_with, unlinkat,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::AsRawFd,
    path::PathBuf,
};

pub const MAX_JOBS: usize = 64;
pub const MAX_OUTPUT: u64 = 512 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Output {
    pub identity: String,
    pub bytes: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub version: u32,
    pub id: String,
    pub key: String,
    pub epoch: String,
    pub state: String,
    pub previous_state: Option<String>,
    pub cancel_requested: bool,
    pub error: Option<String>,
    pub program: Value,
    pub progress: Option<Value>,
    pub bytes: u64,
    pub output: Option<Output>,
}
impl Record {
    pub fn state_name(&self) -> &'static str {
        match self.state.as_str() {
            "queued" => "queued",
            "running" => "running",
            "ready" => "ready",
            "failed" => "failed",
            "canceled" => "canceled",
            _ => "interrupted",
        }
    }
    pub fn charge(&self) -> u64 {
        if matches!(self.state_name(), "queued" | "running") {
            MAX_OUTPUT
        } else {
            self.bytes
        }
    }
}
pub struct Stored {
    pub record: Record,
    revision: String,
    pub dir: File,
}
impl Stored {
    pub fn directory(&self) -> PathBuf {
        PathBuf::from(format!("/proc/self/fd/{}", self.dir.as_raw_fd()))
    }
}
pub struct Store {
    root: File,
    _lock: File,
}
fn valid_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 40 || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ApiError::invalid("Invalid export job ID"));
    }
    Ok(())
}
fn open_file(dir: &File, name: &str) -> Result<File> {
    let file = File::from(
        openat(
            dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ApiError::io())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::io());
    }
    Ok(file)
}
impl Store {
    pub fn open(projects: &File) -> Result<Self> {
        match mkdirat(projects, ".exports", Mode::RUSR | Mode::WUSR | Mode::XUSR) {
            Ok(()) | Err(rustix::io::Errno::EXIST) => (),
            Err(_) => return Err(ApiError::io()),
        }
        let root = File::from(
            openat(
                projects,
                ".exports",
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        let lock = File::from(
            openat(
                &root,
                ".lock",
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        if !lock.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::io());
        }
        rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive).map_err(
            |_| ApiError::conflict("EXPORT_ROOT_BUSY", "Another editor owns the export history"),
        )?;
        projects.sync_all().map_err(|_| ApiError::io())?;
        Ok(Self { root, _lock: lock })
    }
    fn read(&self, id: &str) -> Result<(Record, String)> {
        valid_id(id)?;
        let file = open_file(&self.root, &format!("{id}.json"))?;
        if file.metadata().map_err(|_| ApiError::io())?.len() > MAX_MANIFEST {
            return Err(ApiError::invalid("Export manifest exceeds its budget"));
        }
        let before = file_identity(&file)?;
        let mut bytes = vec![];
        (&file)
            .take(MAX_MANIFEST + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_MANIFEST || file_identity(&file)? != before {
            return Err(ApiError::io());
        }
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| {
            ApiError::invalid("Export history is unreadable; existing files were preserved")
        })?;
        if record.version != 1
            || record.id != id
            || record.key.len() > 4096
            || record.epoch.len() > 256
            || !matches!(
                record.state.as_str(),
                "queued" | "running" | "ready" | "failed" | "canceled" | "interrupted"
            )
            || record.output.as_ref().is_some_and(|output| {
                output.bytes == 0 || output.bytes > MAX_OUTPUT || output.identity.len() > 256
            })
        {
            return Err(ApiError::invalid(
                "Invalid export history; existing files were preserved",
            ));
        }
        Ok((record, format!("{:x}", Sha256::digest(&bytes))))
    }
    fn write(&self, record: &Record, expected: Option<&str>) -> Result<String> {
        valid_id(&record.id)?;
        let bytes = serde_json::to_vec(record).map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_MANIFEST {
            return Err(ApiError::invalid("Export manifest exceeds its budget"));
        }
        let temp = format!(
            ".{}-{}-{}.tmp",
            record.id,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let result = (|| {
            let mut file = File::from(
                openat(
                    &self.root,
                    temp.as_str(),
                    OFlags::WRONLY
                        | OFlags::CREATE
                        | OFlags::EXCL
                        | OFlags::NOFOLLOW
                        | OFlags::CLOEXEC,
                    Mode::RUSR | Mode::WUSR,
                )
                .map_err(|_| ApiError::io())?,
            );
            file.write_all(&bytes).map_err(|_| ApiError::io())?;
            file.sync_all().map_err(|_| ApiError::io())?;
            let target = format!("{}.json", record.id);
            if let Some(expected) = expected {
                if self.read(&record.id)?.1 != expected {
                    return Err(ApiError::conflict(
                        "EXPORT_CHANGED",
                        "Export history changed; existing files were preserved",
                    ));
                }
                renameat(&self.root, temp.as_str(), &self.root, target.as_str())
                    .map_err(|_| ApiError::io())?;
            } else {
                renameat_with(
                    &self.root,
                    temp.as_str(),
                    &self.root,
                    target.as_str(),
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| ApiError::conflict("FILE_EXISTS", "Existing export was preserved"))?;
            }
            self.root.sync_all().map_err(|_| ApiError::io())?;
            Ok(format!("{:x}", Sha256::digest(&bytes)))
        })();
        let _ = unlinkat(&self.root, temp.as_str(), AtFlags::empty());
        result
    }
    pub fn save(&self, stored: &mut Stored, record: Record) -> Result<()> {
        if record.id != stored.record.id {
            return Err(ApiError::io());
        }
        let revision = self.write(&record, Some(&stored.revision))?;
        stored.record = record;
        stored.revision = revision;
        Ok(())
    }
    fn ids(&self) -> Result<Vec<String>> {
        let mut ids = vec![];
        for (count, entry) in std::fs::read_dir(format!("/proc/self/fd/{}", self.root.as_raw_fd()))
            .map_err(|_| ApiError::io())?
            .enumerate()
        {
            if count >= MAX_JOBS * 4 + 16 {
                return Err(ApiError::invalid(
                    "Export directory exceeds its bounded history budget",
                ));
            }
            let name = entry.map_err(|_| ApiError::io())?.file_name();
            let name = name.to_str().ok_or_else(ApiError::io)?;
            if let Some(id) = name.strip_suffix(".json") {
                valid_id(id)?;
                ids.push(id.to_owned());
                if ids.len() > MAX_JOBS {
                    return Err(ApiError::invalid("Export history exceeds 64 records"));
                }
            }
        }
        ids.sort_by(|left, right| left.len().cmp(&right.len()).then_with(|| left.cmp(right)));
        Ok(ids)
    }
    pub fn admit(&self, record: Record) -> Result<Stored> {
        let ids = self.ids()?;
        let mut charged = 0u64;
        for id in &ids {
            charged = charged.saturating_add(self.read(id)?.0.charge());
        }
        if ids.len() >= MAX_JOBS || charged.saturating_add(MAX_OUTPUT) > MAX_TOTAL {
            return Err(ApiError::conflict(
                "EXPORT_CAPACITY",
                "Export history is full (64 records or 2 GiB including pending reservations); existing exports were preserved",
            ));
        }
        valid_id(&record.id)?;
        mkdirat(
            &self.root,
            record.id.as_str(),
            Mode::RUSR | Mode::WUSR | Mode::XUSR,
        )
        .map_err(|_| {
            ApiError::conflict("FILE_EXISTS", "Existing export directory was preserved")
        })?;
        let dir = self.open_dir(&record.id)?;
        let revision = self.write(&record, None)?;
        Ok(Stored {
            record,
            revision,
            dir,
        })
    }
    fn open_dir(&self, id: &str) -> Result<File> {
        valid_id(id)?;
        Ok(File::from(
            openat(
                &self.root,
                id,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        ))
    }
    pub fn bytes(stored: &Stored) -> u64 {
        ["rendering.mp4", "program.mp4"]
            .into_iter()
            .filter_map(|name| open_file(&stored.dir, name).ok())
            .filter_map(|file| file.metadata().ok())
            .map(|meta| meta.len())
            .fold(0, u64::saturating_add)
    }
    pub fn recover(&self) -> Result<Vec<Stored>> {
        let mut recovered = vec![];
        for id in self.ids()? {
            let (record, revision) = self.read(&id)?;
            let mut stored = Stored {
                dir: self.open_dir(&id)?,
                record,
                revision,
            };
            let mut record = stored.record.clone();
            let interrupted = matches!(record.state_name(), "queued" | "running");
            if interrupted {
                record.previous_state = Some(record.state.clone());
                record.state = if record.cancel_requested {
                    "canceled"
                } else {
                    "interrupted"
                }
                .into();
                record.error = Some("SERVER_RESTARTED".into());
                record.output = None;
            } else if record.state == "ready" && self.output(&stored).is_err() {
                record.state = "failed".into();
                record.error = Some("EXPORT_OUTPUT_CHANGED".into());
                record.output = None;
            }
            let bytes = Self::bytes(&stored);
            if interrupted || record.state != stored.record.state || bytes != record.bytes {
                record.bytes = bytes;
                self.save(&mut stored, record)?;
            }
            recovered.push(stored);
        }
        Ok(recovered)
    }
    pub fn publish_output(&self, stored: &Stored) -> Result<Output> {
        let file = open_file(&stored.dir, "rendering.mp4")?;
        let bytes = file.metadata().map_err(|_| ApiError::io())?.len();
        if bytes == 0 || bytes > MAX_OUTPUT {
            return Err(ApiError::invalid(
                "Export output exceeds its 512 MiB budget",
            ));
        }
        file.sync_all().map_err(|_| ApiError::io())?;
        let identity = file_identity(&file)?;
        renameat_with(
            &stored.dir,
            "rendering.mp4",
            &stored.dir,
            "program.mp4",
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| ApiError::io())?;
        stored.dir.sync_all().map_err(|_| ApiError::io())?;
        Ok(Output { identity, bytes })
    }
    pub fn output(&self, stored: &Stored) -> Result<File> {
        let expected = stored
            .record
            .output
            .as_ref()
            .filter(|_| stored.record.state == "ready")
            .ok_or_else(ApiError::missing)?;
        let file = open_file(&stored.dir, "program.mp4")?;
        if file.metadata().map_err(|_| ApiError::io())?.len() != expected.bytes
            || file_identity(&file)? != expected.identity
        {
            return Err(ApiError::conflict(
                "EXPORT_OUTPUT_CHANGED",
                "Completed export changed; existing file was preserved",
            ));
        }
        Ok(file)
    }
}

#[cfg(test)]
#[path = "tests/export_store.rs"]
mod tests;
