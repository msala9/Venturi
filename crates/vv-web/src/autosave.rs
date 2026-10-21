use crate::{
    error::{ApiError, Result},
    files::Files,
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    time::{Duration, Instant},
};
use vv_session::Session;

const NAME: &str = ".venturi-autosave.json";
const MAX_BYTES: usize = 16 * 1024 * 1024;
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Resolution {
    project_token: String,
    sha256: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    project_token: String,
    base_sha256: String,
    project_sha256: String,
    created_unix_ms: u64,
    project_ron: String,
    resolved_to: Option<Resolution>,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn canonical(value: Value) -> Value {
    match value {
        Value::Object(items) => Value::Object(
            items
                .into_iter()
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .map(|(key, value)| (key, canonical(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(canonical).collect()),
        other => other,
    }
}
fn project_digest(project: &vv_core::Project) -> Result<String> {
    Ok(digest(
        &serde_json::to_vec(&canonical(
            serde_json::to_value(project).map_err(|_| ApiError::io())?,
        ))
        .map_err(|_| ApiError::io())?,
    ))
}
fn raw(files: &Files) -> Result<Option<Vec<u8>>> {
    let dir = files.root_file()?;
    let fd = match openat(
        &dir,
        NAME,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => {
            return Err(ApiError::invalid(
                "Recovery snapshot links or unreadable files were preserved",
            ));
        }
    };
    let file = File::from(fd);
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES as u64 {
        return Err(ApiError::invalid(
            "Recovery snapshot exceeds its regular-file budget; it was preserved",
        ));
    }
    let mut bytes = vec![];
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() > MAX_BYTES {
        return Err(ApiError::invalid(
            "Recovery snapshot exceeds 16 MiB; it was preserved",
        ));
    }
    Ok(Some(bytes))
}
fn parse(files: &Files, bytes: &[u8]) -> Result<Record> {
    let record: Record = serde_json::from_slice(bytes).map_err(|_| {
        ApiError::invalid("Recovery snapshot is unreadable or unsupported; it was preserved")
    })?;
    files.path(&record.project_token)?;
    if record.version != 1
        || !record.project_token.ends_with(".vvproj")
        || record.base_sha256.len() != 64
        || record.project_ron.len() > 8 * 1024 * 1024
        || digest(record.project_ron.as_bytes()) != record.project_sha256
    {
        return Err(ApiError::invalid(
            "Recovery snapshot version or checksum is invalid; it was preserved",
        ));
    }
    Ok(record)
}
fn snapshot(record: &Record) -> Result<vv_core::Project> {
    ron::from_str(&record.project_ron).map_err(|_| {
        ApiError::invalid("Recovery snapshot has invalid native project data; it was preserved")
    })
}
fn publish(files: &Files, record: &Record, expected: Option<&str>) -> Result<String> {
    let bytes = serde_json::to_vec(record).map_err(|_| ApiError::io())?;
    if bytes.len() > MAX_BYTES {
        return Err(ApiError::invalid(
            "Recovery snapshot exceeds 16 MiB; save the project manually",
        ));
    }
    let dir = files.root_file()?;
    let temp = format!(
        ".venturi-autosave-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let fd = openat(
        &dir,
        temp.as_str(),
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )
    .map_err(|_| ApiError::io())?;
    let result = (|| {
        let mut file = File::from(fd);
        file.write_all(&bytes).map_err(|_| ApiError::io())?;
        file.sync_all().map_err(|_| ApiError::io())?;
        if raw(files)?.as_deref().map(digest).as_deref() != expected {
            return Err(ApiError::conflict(
                "RECOVERY_CHANGED",
                "Recovery snapshot changed; existing data was preserved",
            ));
        }
        if expected.is_none() {
            rustix::fs::renameat_with(&dir, temp.as_str(), &dir, NAME, RenameFlags::NOREPLACE)
                .map_err(|_| ApiError::io())?;
        } else {
            rustix::fs::renameat(&dir, temp.as_str(), &dir, NAME).map_err(|_| ApiError::io())?;
        }
        dir.sync_all().map_err(|_| ApiError::io())?;
        Ok(digest(&bytes))
    })();
    let _ = unlinkat(&dir, temp.as_str(), AtFlags::empty());
    result
}
pub struct Store {
    receipt: Option<String>,
    pending: bool,
    blocked: bool,
    owned_epoch: Option<u64>,
    generation: Option<(u64, u64)>,
    next: Instant,
    info: Value,
}
impl Store {
    pub fn new(files: &Files) -> Self {
        let mut store = Self {
            receipt: None,
            pending: false,
            blocked: false,
            owned_epoch: None,
            generation: None,
            next: Instant::now(),
            info: json!({"state":"empty","pending":false}),
        };
        match raw(files).and_then(|bytes| {
            bytes
                .map(|bytes| parse(files, &bytes).map(|record| (record, digest(&bytes))))
                .transpose()
        }) {
            Ok(Some((record, receipt))) => {
                let snapshot = match snapshot(&record).and_then(|project| project_digest(&project))
                {
                    Ok(digest) => digest,
                    Err(error) => {
                        store.fail(error);
                        return store;
                    }
                };
                let saved = record.resolved_to.as_ref().is_some_and(|saved| {
                    files
                        .project_fingerprint(&saved.project_token)
                        .ok()
                        .as_ref()
                        == Some(&saved.sha256)
                }) || files
                    .load_detached(&record.project_token)
                    .ok()
                    .and_then(|project| project_digest(&project).ok())
                    .as_ref()
                    == Some(&snapshot);
                store.receipt = Some(receipt);
                store.pending = !saved;
                store.describe(files, &record, if saved { "saved" } else { "pending" });
            }
            Ok(None) => {}
            Err(error) => store.fail(error),
        }
        store
    }
    fn fail(&mut self, error: ApiError) {
        self.blocked = true;
        self.info = json!({"state":"blocked","pending":self.pending,"error":error.2});
    }
    fn describe(&mut self, files: &Files, record: &Record, state: &str) {
        self.info = json!({"state":state,"pending":self.pending,"revision":self.receipt,"project_token":record.project_token,"created_unix_ms":record.created_unix_ms,"base_changed":files.project_fingerprint(&record.project_token).ok().as_ref()!=Some(&record.base_sha256),"resolved_to":record.resolved_to.as_ref().map(|saved|&saved.project_token)});
    }
    pub fn info(&self) -> Value {
        self.info.clone()
    }
    pub fn tick(&mut self, files: &Files, session: &Session) {
        if self.pending || self.blocked || self.next > Instant::now() {
            return;
        }
        self.next = Instant::now() + Duration::from_secs(2);
        self.checkpoint(files, session);
    }
    pub fn checkpoint(&mut self, files: &Files, session: &Session) -> Option<String> {
        if self.pending || self.blocked {
            return None;
        }
        let generation = (session.epoch(), session.history.generation());
        if !session.has_unsaved_changes() || self.generation == Some(generation) {
            return (self.generation == Some(generation))
                .then(|| self.receipt.clone())
                .flatten();
        }
        let name = session
            .path()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())?;
        let result = (|| {
            let base_sha256 = files.saved_fingerprint(name).ok_or_else(|| {
                ApiError::invalid("Save the project before creating a recovery snapshot")
            })?;
            let project_ron =
                ron::ser::to_string_pretty(&session.project, ron::ser::PrettyConfig::default())
                    .map_err(|_| ApiError::io())?;
            if project_ron.len() > 8 * 1024 * 1024 {
                return Err(ApiError::invalid(
                    "Native recovery project exceeds 8 MiB; save the project manually",
                ));
            }
            let record = Record {
                version: 1,
                project_token: name.into(),
                base_sha256,
                project_sha256: digest(project_ron.as_bytes()),
                created_unix_ms: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                project_ron,
                resolved_to: None,
            };
            self.receipt = Some(publish(files, &record, self.receipt.as_deref())?);
            self.generation = Some(generation);
            self.owned_epoch = Some(session.epoch());
            self.describe(files, &record, "ready");
            Ok(())
        })();
        if let Err(error) = result {
            self.fail(error);
            return None;
        }
        self.receipt.clone()
    }
    fn resolve(&mut self, files: &Files, name: &str, sha256: String) -> Result<()> {
        let bytes = raw(files)?.ok_or_else(ApiError::missing)?;
        if self.receipt.as_deref() != Some(digest(&bytes).as_str()) {
            return Err(ApiError::conflict(
                "RECOVERY_CHANGED",
                "Recovery snapshot changed; it was preserved",
            ));
        }
        let mut record = parse(files, &bytes)?;
        let resolution = Resolution {
            project_token: name.into(),
            sha256,
        };
        if record.resolved_to.as_ref() != Some(&resolution) {
            record.resolved_to = Some(resolution);
            self.receipt = Some(publish(files, &record, self.receipt.as_deref())?);
        }
        self.pending = false;
        self.blocked = false;
        self.owned_epoch = None;
        self.next = Instant::now();
        self.describe(files, &record, "saved");
        Ok(())
    }
    pub fn saved(&mut self, files: &Files, session: &Session) {
        if self.pending || self.receipt.is_none() || session.has_unsaved_changes() {
            return;
        }
        if self.owned_epoch != Some(session.epoch()) {
            let belongs = raw(files)
                .ok()
                .flatten()
                .and_then(|bytes| parse(files, &bytes).ok())
                .is_some_and(|record| {
                    session
                        .path()
                        .and_then(|path| path.file_name())
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            (record.resolved_to.is_none() && name == record.project_token)
                                || record
                                    .resolved_to
                                    .is_some_and(|saved| saved.project_token == name)
                        })
                });
            if !belongs {
                return;
            }
        }
        if let Some(name) = session
            .path()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            && let Some(sha256) = files.saved_fingerprint(name)
            && let Err(error) = self.resolve(files, name, sha256)
        {
            self.fail(error);
        }
    }
    pub fn recover(
        &mut self,
        files: &Files,
        session: &mut Session,
        revision: &str,
        name: &str,
        open: bool,
    ) -> Result<()> {
        if open && session.has_unsaved_changes() {
            return Err(ApiError::conflict(
                "UNSAVED_CHANGES",
                "Save current edits first, or keep the recovery copy without opening it",
            ));
        }
        if name.is_empty()
            || name.len() > 64
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err(ApiError::invalid(
                "Choose letters, digits, underscores or hyphens for the recovery copy name",
            ));
        }
        let bytes = raw(files)?.ok_or_else(ApiError::missing)?;
        if digest(&bytes) != revision {
            if self.receipt.as_deref() != Some(digest(&bytes).as_str()) {
                *self = Self::new(files);
            }
            return Err(ApiError::conflict(
                "RECOVERY_CHANGED",
                "Refresh the recovery snapshot before creating a copy",
            ));
        }
        let record = parse(files, &bytes)?;
        let project = files.validate_recovery(snapshot(&record)?)?;
        let token = format!("{name}.vvproj");
        let annotations =
            crate::reviewmeta::reserve_copy(files, Some(&record.project_token), &token)?;
        let sha256 = files.save_detached(&project, &token)?;
        annotations.commit();
        if open {
            let project = files.load(&token)?;
            session.install_project(project, Some(files.path(&token)?));
        }
        self.receipt = Some(revision.into());
        if let Err(error) = self.resolve(files, &token, sha256) {
            self.fail(error);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/autosave.rs"]
mod tests;
