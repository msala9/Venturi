use crate::{
    error::{ApiError, Result},
    files::Files,
};
use rustix::fs::{Mode, OFlags, openat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
};

const NAME: &str = ".venturi-command-receipts.jsonl";
const MAX_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
pub type Entries = HashMap<String, ([u8; 32], Value)>;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    version: u32,
    id: String,
    fingerprint: [u8; 32],
    result: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    sha256: String,
    payload: String,
}
pub struct Store {
    file: File,
    length: u64,
    count: usize,
    _lock: File,
}
impl Store {
    pub fn open(files: &Files) -> Result<(Self, Entries)> {
        let dir = files.root_file()?;
        let flags =
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
        let lock = File::from(
            openat(
                &dir,
                ".venturi-command-receipts.lock",
                flags,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        if !lock.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::io());
        }
        rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive).map_err(
            |_| ApiError::conflict("ROOT_BUSY", "Another editor owns this projects root"),
        )?;
        let mut file = File::from(
            openat(&dir, NAME, flags | OFlags::APPEND, Mode::RUSR | Mode::WUSR)
                .map_err(|_| ApiError::io())?,
        );
        let metadata = file.metadata().map_err(|_| ApiError::io())?;
        if !metadata.is_file() || metadata.len() > MAX_BYTES {
            return Err(ApiError::invalid(
                "Command receipts exceed their regular-file budget; existing data was preserved",
            ));
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_BYTES || (!bytes.is_empty() && bytes.last() != Some(&b'\n')) {
            return Err(ApiError::invalid(
                "Command receipts are incomplete; existing data was preserved",
            ));
        }
        let mut entries = Entries::new();
        let mut count = 0;
        for line in bytes
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
        {
            let line: Line = serde_json::from_slice(line).map_err(|_| ApiError::io())?;
            if format!("{:x}", Sha256::digest(line.payload.as_bytes())) != line.sha256 {
                return Err(ApiError::io());
            }
            let mut entry: Entry =
                serde_json::from_str(&line.payload).map_err(|_| ApiError::io())?;
            count += 1;
            if entry.version != 1
                || count > MAX_ENTRIES
                || entry.id.len() > 80
                || entry.result["status"] != "applied"
                || entries.contains_key(&entry.id)
            {
                return Err(ApiError::io());
            }
            entry.result["server_restarted"] = Value::Bool(true);
            entries.insert(entry.id, (entry.fingerprint, entry.result));
        }
        dir.sync_all().map_err(|_| ApiError::io())?;
        Ok((
            Self {
                file,
                length: metadata.len(),
                count,
                _lock: lock,
            },
            entries,
        ))
    }
    pub fn append(
        &mut self,
        files: &Files,
        id: &str,
        fingerprint: [u8; 32],
        result: &Value,
    ) -> Result<()> {
        let payload = serde_json::to_string(&Entry {
            version: 1,
            id: id.into(),
            fingerprint,
            result: result.clone(),
        })
        .map_err(|_| ApiError::io())?;
        let mut bytes = serde_json::to_vec(&Line {
            sha256: format!("{:x}", Sha256::digest(payload.as_bytes())),
            payload,
        })
        .map_err(|_| ApiError::io())?;
        bytes.push(b'\n');
        let dir = files.root_file()?;
        let current = File::from(
            openat(
                &dir,
                NAME,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        let identity = self.file.metadata().map_err(|_| ApiError::io())?;
        let current = current.metadata().map_err(|_| ApiError::io())?;
        if bytes.len() > 4096
            || identity.len() != self.length
            || current.ino() != identity.ino()
            || current.dev() != identity.dev()
        {
            return Err(ApiError::io());
        }
        if self.count >= MAX_ENTRIES || self.length + bytes.len() as u64 > MAX_BYTES {
            let dir = files.root_file()?;
            let temp = format!(".venturi-receipts-{}.tmp", std::process::id());
            let mut file = File::from(
                openat(
                    &dir,
                    temp.as_str(),
                    OFlags::WRONLY
                        | OFlags::APPEND
                        | OFlags::CREATE
                        | OFlags::EXCL
                        | OFlags::NOFOLLOW
                        | OFlags::CLOEXEC,
                    Mode::RUSR | Mode::WUSR,
                )
                .map_err(|_| ApiError::io())?,
            );
            let outcome = (|| {
                file.write_all(&bytes).map_err(|_| ApiError::io())?;
                file.sync_all().map_err(|_| ApiError::io())?;
                rustix::fs::renameat(&dir, temp.as_str(), &dir, NAME)
                    .map_err(|_| ApiError::io())?;
                dir.sync_all().map_err(|_| ApiError::io())
            })();
            let _ = rustix::fs::unlinkat(&dir, temp.as_str(), rustix::fs::AtFlags::empty());
            outcome?;
            self.file = file;
            self.length = bytes.len() as u64;
            self.count = 1;
        } else {
            self.file.write_all(&bytes).map_err(|_| ApiError::io())?;
            self.file.sync_all().map_err(|_| ApiError::io())?;
            self.length += bytes.len() as u64;
            self.count += 1;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/receipts.rs"]
mod tests;
