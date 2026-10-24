use crate::{
    asset_journal::Completion,
    error::{ApiError, Result},
    presets::{Options, Preset},
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, renameat, renameat_with, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::{fd::AsRawFd, unix::fs::MetadataExt},
    path::{Path, PathBuf},
    sync::OnceLock,
};

const MAX_BYTES: u64 = 4 * 1024 * 1024;
const DELETE_PENDING: &str = ".venturi-native-presets-pending.json";
const DELETE_OWNER: &str = "vv-web-preset-delete";
const COMPLETIONS: &str = ".venturi-preset-completions";
const MAX_INTENT: u64 = 16 * 1024;
pub struct Store {
    root: PathBuf,
    dir: OnceLock<File>,
    #[cfg(test)]
    fail_after_intent: std::sync::atomic::AtomicBool,
}
struct Raw {
    bytes: Vec<u8>,
    revision: String,
    identity: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteIntent {
    version: u32,
    owner: String,
    id: String,
    revision: String,
    archived: bool,
    before_identity: String,
    completion: Completion,
}
struct CompletionCatalog {
    records: Vec<Completion>,
    entries: usize,
    bytes: u64,
}
#[derive(Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub project_epoch: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub sort: Option<SortKey>,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    Name,
}
fn browse_budget() -> ApiError {
    ApiError::conflict(
        "PRESET_CATALOG_BUDGET",
        "Preset browsing exceeds its 16 MiB metadata budget",
    )
}
fn item_value(id: &str, archived: bool, revision: &str, preset: &Preset) -> Value {
    json!({"id":id,"revision":revision,"name":preset.name,"attributes":preset.attributes,"anchor":preset.anchor,
        "append_filters":preset.append_filters,"shortcut":preset.shortcut,"fps":preset.fps,"resolution":preset.resolution,
        "video":preset.video.is_some(),"audio":preset.audio.is_some(),"archived":archived,"can_restore_previous":false})
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Import {
        json: String,
    },
    Update {
        id: String,
        revision: String,
        options: Options,
    },
    Archive {
        id: String,
        revision: String,
    },
    Restore {
        id: String,
        revision: String,
    },
    RestorePrevious {
        id: String,
        revision: String,
    },
    Delete {
        id: String,
        revision: String,
        archived: bool,
    },
}
fn recovery_required() -> ApiError {
    ApiError::conflict(
        "LIBRARY_RECOVERY_REQUIRED",
        "A desktop or unrecognized preset transaction is pending; reopen its library to recover it",
    )
}
fn journal_changed() -> ApiError {
    ApiError::conflict(
        "PRESET_JOURNAL_CONFLICT",
        "Preset library changed outside its transaction; existing data and recovery intent were preserved",
    )
}
fn strong_raw(directory: &File, name: &str, limit: u64) -> Result<Option<Raw>> {
    let file = match openat(
        directory,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(file) => File::from(file),
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => return Err(journal_changed()),
    };
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(journal_changed());
    }
    let identity = crate::asset_store::stable_identity(&file)?;
    let mut bytes = Vec::new();
    (&file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() as u64 > limit
        || crate::asset_store::stable_identity(&file)? != identity
        || crate::asset_store::stable_identity(&crate::asset_store::regular(directory, name)?)?
            != identity
    {
        return Err(journal_changed());
    }
    Ok(Some(Raw {
        revision: format!("{:x}", Sha256::digest(&bytes)),
        bytes,
        identity,
    }))
}
fn atomic_record(directory: &File, name: &str, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 > MAX_INTENT {
        return Err(journal_changed());
    }
    let temp = format!(".preset-delete-{}.tmp", crate::asset_jobs::nonce());
    let mut owned = None;
    let result = (|| {
        let mut file = File::from(
            openat(
                directory,
                temp.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        let metadata = file.metadata().map_err(|_| ApiError::io())?;
        owned = Some((metadata.dev(), metadata.ino()));
        file.write_all(bytes).map_err(|_| ApiError::io())?;
        file.sync_all().map_err(|_| ApiError::io())?;
        drop(file);
        let metadata = crate::asset_store::regular(directory, &temp)?
            .metadata()
            .map_err(|_| ApiError::io())?;
        if Some((metadata.dev(), metadata.ino())) != owned {
            return Err(journal_changed());
        }
        if strong_raw(directory, &temp, MAX_INTENT)?
            .ok_or_else(journal_changed)?
            .bytes
            != bytes
        {
            return Err(journal_changed());
        }
        renameat_with(
            directory,
            temp.as_str(),
            directory,
            name,
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| journal_changed())?;
        directory.sync_all().map_err(|_| ApiError::io())?;
        if strong_raw(directory, name, MAX_INTENT)?
            .ok_or_else(journal_changed)?
            .bytes
            != bytes
        {
            return Err(journal_changed());
        }
        Ok(())
    })();
    if let Ok(file) = crate::asset_store::regular(directory, &temp)
        && let Ok(metadata) = file.metadata()
        && Some((metadata.dev(), metadata.ino())) == owned
    {
        let _ = unlinkat(directory, temp.as_str(), AtFlags::empty());
    }
    result
}
fn validate_completion(completion: &Completion) -> Result<()> {
    let deleted = &completion.receipt["deleted_preset"];
    if completion.version != 1
        || !crate::asset_journal::safe_id(&completion.command_id)
        || completion.project_root_binding.is_empty()
        || completion.project_root_binding.len() > 128
        || completion.receipt["command_id"] != completion.command_id
        || completion.receipt["status"] != "applied"
        || completion.receipt["library_durable"] != true
        || completion.receipt["preset_library_durable"] != true
        || deleted.as_object().is_none_or(|object| object.len() != 3)
        || deleted["id"]
            .as_str()
            .is_none_or(|id| !crate::asset_journal::safe_id(id))
        || deleted["revision"].as_str().is_none_or(|revision| {
            revision.len() != 64
                || !revision
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        || deleted["archived"].as_bool().is_none()
        || serde_json::to_vec(completion)
            .map_err(|_| journal_changed())?
            .len()
            > 4096
    {
        return Err(ApiError::invalid(
            "Invalid durable native preset command receipt",
        ));
    }
    Ok(())
}
fn validate_intent(intent: &DeleteIntent) -> Result<()> {
    validate_completion(&intent.completion)?;
    name(&intent.id, intent.archived)?;
    if intent.version != 2
        || intent.owner != DELETE_OWNER
        || intent.before_identity.is_empty()
        || intent.before_identity.len() > 256
        || intent.revision.len() != 64
        || !intent
            .revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || intent.completion.receipt["deleted_preset"]
            != json!({"id":intent.id,"revision":intent.revision,"archived":intent.archived})
    {
        return Err(journal_changed());
    }
    Ok(())
}
fn name(id: &str, archived: bool) -> Result<String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(ApiError::invalid("Choose a listed native preset ID"));
    }
    Ok(format!(
        "{id}.json{}",
        if archived { ".deleted" } else { "" }
    ))
}
fn parse(bytes: &[u8]) -> Result<Preset> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ApiError::invalid("Native preset exceeds 4 MiB"));
    }
    let preset: Preset = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::invalid("Invalid native preset JSON"))?;
    preset.validate()?;
    Ok(preset)
}
impl Store {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        let path = crate::media_roots::configured_path(root)?;
        let dir = crate::media_roots::open_configured(&path)?;
        Ok(Self {
            root: path,
            dir: OnceLock::from(dir),
            #[cfg(test)]
            fail_after_intent: std::sync::atomic::AtomicBool::new(false),
        })
    }
    pub(crate) fn configured(root: &Path) -> std::io::Result<Self> {
        let store = Self {
            root: crate::media_roots::configured_path(root)?,
            dir: OnceLock::new(),
            #[cfg(test)]
            fail_after_intent: std::sync::atomic::AtomicBool::new(false),
        };
        match store.retry() {
            Ok(()) => (),
            Err(error) if crate::media_roots::transient(&error) => (),
            Err(error) => return Err(error),
        }
        Ok(store)
    }
    pub(crate) fn retry(&self) -> std::io::Result<()> {
        let live = crate::media_roots::open_configured(&self.root)?;
        if let Some(pinned) = self.dir.get() {
            crate::asset_store::same_directory(pinned, &live)
                .map_err(|_| std::io::Error::other("The configured preset root changed"))?;
        } else {
            let _ = self.dir.set(live);
        }
        Ok(())
    }
    pub(crate) fn is_available(&self) -> bool {
        self.dir.get().is_some()
    }
    fn directory(&self) -> Result<&File> {
        self.dir.get().ok_or_else(crate::media_roots::unavailable)
    }
    fn lock(&self) -> Result<File> {
        self.catalog_lock(true)
    }
    fn catalog_lock(&self, exclusive: bool) -> Result<File> {
        let pinned = self.directory()?;
        let live = crate::media_roots::open_configured(&self.root).map_err(|_| {
            ApiError::conflict(
                "PRESET_CHANGED",
                "The configured preset root changed; existing data was preserved",
            )
        })?;
        crate::asset_store::same_directory(pinned, &live).map_err(|_| {
            ApiError::conflict(
                "PRESET_CHANGED",
                "The configured preset root changed; existing data was preserved",
            )
        })?;
        let fd = openat(
            self.directory()?,
            ".venturi-presets.lock",
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ApiError::io())?;
        let file = File::from(fd);
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::invalid("Preset lock must be a regular file"));
        }
        rustix::fs::flock(
            &file,
            if exclusive {
                rustix::fs::FlockOperation::NonBlockingLockExclusive
            } else {
                rustix::fs::FlockOperation::NonBlockingLockShared
            },
        )
        .map_err(|_| {
            ApiError::conflict(
                "LIBRARY_BUSY",
                "Preset library is busy; retain the draft and retry",
            )
        })?;
        match rustix::fs::statat(self.directory()?, DELETE_PENDING, AtFlags::SYMLINK_NOFOLLOW) {
            Err(rustix::io::Errno::NOENT) => (),
            Ok(_) => {
                if !exclusive {
                    drop(file);
                    return self.catalog_lock(true);
                }
                self.recover_delete()?;
            }
            Err(_) => return Err(ApiError::io()),
        }
        Ok(file)
    }
    fn completion_catalog(&self) -> Result<CompletionCatalog> {
        let directory = crate::asset_store::directory(self.directory()?, COMPLETIONS)?;
        let mut records = Vec::new();
        let mut bytes = 0u64;
        let mut entries = 0;
        for (index, entry) in std::fs::read_dir(format!("/proc/self/fd/{}", directory.as_raw_fd()))
            .map_err(|_| ApiError::io())?
            .enumerate()
        {
            if index >= 4096 {
                return Err(ApiError::invalid(
                    "Unconfirmed preset receipts exceed 4096 entries",
                ));
            }
            entries += 1;
            let filename = entry
                .map_err(|_| ApiError::io())?
                .file_name()
                .into_string()
                .map_err(|_| journal_changed())?;
            let raw = strong_raw(&directory, &filename, 4096)?.ok_or_else(journal_changed)?;
            bytes = bytes.saturating_add(raw.bytes.len() as u64);
            if bytes > 8 * 1024 * 1024 {
                return Err(ApiError::invalid(
                    "Unconfirmed preset receipts exceed 8 MiB",
                ));
            }
            if filename.starts_with(".preset-delete-") && filename.ends_with(".tmp") {
                continue;
            }
            let id = filename
                .strip_suffix(".json")
                .filter(|id| crate::asset_journal::safe_id(id))
                .ok_or_else(journal_changed)?;
            let completion: Completion =
                serde_json::from_slice(&raw.bytes).map_err(|_| journal_changed())?;
            validate_completion(&completion)?;
            if completion.command_id != id {
                return Err(journal_changed());
            }
            records.push(completion);
        }
        Ok(CompletionCatalog {
            records,
            entries,
            bytes,
        })
    }
    fn completion_records(&self) -> Result<Vec<Completion>> {
        Ok(self.completion_catalog()?.records)
    }
    fn receipt_capacity(&self, completion: &Completion) -> Result<()> {
        validate_completion(completion)?;
        let catalog = self.completion_catalog()?;
        if let Some(existing) = catalog
            .records
            .iter()
            .find(|record| record.command_id == completion.command_id)
        {
            if existing.fingerprint != completion.fingerprint
                || existing.project_root_binding != completion.project_root_binding
                || existing.receipt != completion.receipt
            {
                return Err(journal_changed());
            }
            return Ok(());
        }
        if catalog.entries >= 4096 || catalog.bytes.saturating_add(4096) > 8 * 1024 * 1024 {
            return Err(ApiError::invalid(
                "Unconfirmed preset receipts exceed their 4096-entry or 8 MiB budget",
            ));
        }
        Ok(())
    }
    fn persist_completion(&self, completion: &Completion) -> Result<()> {
        self.receipt_capacity(completion)?;
        let directory = crate::asset_store::directory(self.directory()?, COMPLETIONS)?;
        let filename = format!("{}.json", completion.command_id);
        if strong_raw(&directory, &filename, 4096)?.is_none() {
            atomic_record(
                &directory,
                &filename,
                &serde_json::to_vec(completion).map_err(|_| ApiError::io())?,
            )?;
        }
        Ok(())
    }
    fn recover_delete(&self) -> Result<()> {
        let raw = strong_raw(self.directory()?, DELETE_PENDING, MAX_INTENT)
            .map_err(|_| recovery_required())?
            .ok_or_else(recovery_required)?;
        let intent: DeleteIntent =
            serde_json::from_slice(&raw.bytes).map_err(|_| recovery_required())?;
        if intent.version != 2 || intent.owner != DELETE_OWNER {
            return Err(recovery_required());
        }
        validate_intent(&intent)?;
        self.receipt_capacity(&intent.completion)?;
        let filename = name(&intent.id, intent.archived)?;
        if let Some(current) = strong_raw(self.directory()?, &filename, MAX_BYTES)? {
            if current.identity != intent.before_identity || current.revision != intent.revision {
                return Err(journal_changed());
            }
            let pending = strong_raw(self.directory()?, DELETE_PENDING, MAX_INTENT)?
                .ok_or_else(journal_changed)?;
            if pending.identity != raw.identity || pending.bytes != raw.bytes {
                return Err(journal_changed());
            }
            unlinkat(self.directory()?, filename.as_str(), AtFlags::empty())
                .map_err(|_| ApiError::io())?;
            self.directory()?.sync_all().map_err(|_| ApiError::io())?;
        }
        self.persist_completion(&intent.completion)?;
        let pending = strong_raw(self.directory()?, DELETE_PENDING, MAX_INTENT)?
            .ok_or_else(journal_changed)?;
        if pending.identity != raw.identity || pending.bytes != raw.bytes {
            return Err(journal_changed());
        }
        unlinkat(self.directory()?, DELETE_PENDING, AtFlags::empty())
            .map_err(|_| ApiError::io())?;
        self.directory()?.sync_all().map_err(|_| ApiError::io())
    }
    pub fn delete(&self, edit: &Edit, mut completion: Completion) -> Result<()> {
        let Edit::Delete {
            id,
            revision,
            archived,
        } = edit
        else {
            return Err(ApiError::invalid("Choose one saved preset to delete"));
        };
        name(id, *archived)?;
        completion.receipt["deleted_preset"] =
            json!({"id":id,"revision":revision,"archived":archived});
        validate_completion(&completion)?;
        let _guard = self.lock()?;
        if let Some(existing) = self
            .completion_records()?
            .into_iter()
            .find(|record| record.command_id == completion.command_id)
        {
            return if existing.fingerprint == completion.fingerprint
                && existing.project_root_binding == completion.project_root_binding
                && existing.receipt["deleted_preset"] == completion.receipt["deleted_preset"]
            {
                Ok(())
            } else {
                Err(ApiError::conflict(
                    "COMMAND_ID_REUSED",
                    "Native preset command ID was reused",
                ))
            };
        }
        self.receipt_capacity(&completion)?;
        let raw = strong_raw(self.directory()?, &name(id, *archived)?, MAX_BYTES)?
            .ok_or_else(ApiError::missing)?;
        if raw.revision != *revision {
            return Err(ApiError::conflict(
                "PRESET_CHANGED",
                "Preset changed; retain the draft and refresh the library",
            ));
        }
        parse(&raw.bytes)?;
        let intent = DeleteIntent {
            version: 2,
            owner: DELETE_OWNER.into(),
            id: id.clone(),
            revision: revision.clone(),
            archived: *archived,
            before_identity: raw.identity,
            completion,
        };
        validate_intent(&intent)?;
        atomic_record(
            self.directory()?,
            DELETE_PENDING,
            &serde_json::to_vec(&intent).map_err(|_| ApiError::io())?,
        )?;
        #[cfg(test)]
        if self
            .fail_after_intent
            .swap(false, std::sync::atomic::Ordering::AcqRel)
        {
            return Err(ApiError::conflict(
                "PRESET_TEST_INTERRUPTED",
                "Interrupted after the durable preset deletion intent (test)",
            ));
        }
        self.recover_delete()
    }
    pub fn completion(&self, id: &str, binding: &str) -> Result<Option<([u8; 32], Value)>> {
        if !crate::asset_journal::safe_id(id) {
            return Err(ApiError::invalid("Invalid native preset command ID"));
        }
        let _guard = self.catalog_lock(false)?;
        Ok(self
            .completion_records()?
            .into_iter()
            .find(|record| record.command_id == id && record.project_root_binding == binding)
            .map(|record| (record.fingerprint, record.receipt)))
    }
    pub fn completions(&self, binding: &str) -> Result<Vec<(String, [u8; 32], Value)>> {
        let _guard = self.catalog_lock(false)?;
        Ok(self
            .completion_records()?
            .into_iter()
            .filter(|record| record.project_root_binding == binding)
            .map(|record| (record.command_id, record.fingerprint, record.receipt))
            .collect())
    }
    pub fn acknowledge(&self, id: &str, fingerprint: [u8; 32], binding: &str) -> Result<()> {
        if !crate::asset_journal::safe_id(id) {
            return Err(ApiError::invalid("Invalid native preset command ID"));
        }
        let _guard = self.lock()?;
        if let Some(record) = self
            .completion_records()?
            .into_iter()
            .find(|record| record.command_id == id && record.project_root_binding == binding)
        {
            if record.fingerprint != fingerprint {
                return Err(journal_changed());
            }
            let directory = crate::asset_store::directory(self.directory()?, COMPLETIONS)?;
            unlinkat(&directory, format!("{id}.json").as_str(), AtFlags::empty())
                .map_err(|_| ApiError::io())?;
            directory.sync_all().map_err(|_| ApiError::io())?;
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn fail_after_intent_for_test(&self) {
        self.fail_after_intent
            .store(true, std::sync::atomic::Ordering::Release);
    }
    fn raw(&self, file_name: &str) -> Result<Option<Raw>> {
        self.raw_budgeted(file_name, None)
    }
    fn raw_budgeted(&self, file_name: &str, mut budget: Option<&mut u64>) -> Result<Option<Raw>> {
        let fd = match openat(
            self.directory()?,
            file_name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => {
                return Err(ApiError::invalid(
                    "Preset links and unreadable files are preserved and refused",
                ));
            }
        };
        let file = File::from(fd);
        let meta = file.metadata().map_err(|_| ApiError::io())?;
        if !meta.is_file() || meta.len() > MAX_BYTES {
            return Err(ApiError::invalid(
                "Presets must be regular files within 4 MiB",
            ));
        }
        let read_limit = if let Some(remaining) = budget.as_deref() {
            if meta.len() > *remaining {
                return Err(browse_budget());
            }
            MAX_BYTES.min(*remaining)
        } else {
            MAX_BYTES
        };
        let identity = crate::source::file_identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(read_limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if let Some(remaining) = budget.as_mut() {
            if bytes.len() as u64 > **remaining {
                return Err(browse_budget());
            }
            **remaining -= bytes.len() as u64;
        }
        if bytes.len() as u64 > MAX_BYTES || crate::source::file_identity(&file)? != identity {
            return Err(ApiError::conflict(
                "PRESET_CHANGED",
                "Preset changed while reading; refresh the library",
            ));
        }
        Ok(Some(Raw {
            revision: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            identity,
        }))
    }
    fn checked(&self, file_name: &str, expected: &str) -> Result<Raw> {
        let raw = self.raw(file_name)?.ok_or_else(ApiError::missing)?;
        if raw.revision != expected {
            return Err(ApiError::conflict(
                "PRESET_CHANGED",
                "Preset changed; retain the draft and refresh the library",
            ));
        }
        Ok(raw)
    }
    fn publish(&self, file_name: &str, bytes: &[u8], expected: Option<&Raw>) -> Result<()> {
        if bytes.len() as u64 > MAX_BYTES {
            return Err(ApiError::invalid("Native preset exceeds 4 MiB"));
        }
        let temp = format!(
            ".venturi-preset-{}-{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let result = (|| {
            let fd = openat(
                self.directory()?,
                temp.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?;
            let mut file = File::from(fd);
            file.write_all(bytes).map_err(|_| ApiError::io())?;
            file.sync_all().map_err(|_| ApiError::io())?;
            let now = self.raw(file_name)?;
            if now.as_ref().map(|raw| (&raw.identity, &raw.revision))
                != expected.map(|raw| (&raw.identity, &raw.revision))
            {
                return Err(ApiError::conflict(
                    "PRESET_CHANGED",
                    "Preset changed before publication; refresh the library",
                ));
            }
            if expected.is_none() {
                renameat_with(
                    self.directory()?,
                    temp.as_str(),
                    self.directory()?,
                    file_name,
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| ApiError::conflict("FILE_EXISTS", "Existing preset was preserved"))?;
            } else {
                renameat(
                    self.directory()?,
                    temp.as_str(),
                    self.directory()?,
                    file_name,
                )
                .map_err(|_| ApiError::io())?;
            }
            self.directory()?.sync_all().map_err(|_| ApiError::io())?;
            Ok(())
        })();
        let _ = unlinkat(self.directory()?, temp.as_str(), AtFlags::empty());
        result
    }
    pub fn create(&self, id: &str, preset: &Preset) -> Result<()> {
        preset.validate()?;
        let file_name = name(id, false)?;
        let bytes = serde_json::to_vec_pretty(preset).map_err(|_| ApiError::io())?;
        let _lock = self.lock()?;
        if let Some(existing) = self.raw(&file_name)? {
            return if existing.bytes == bytes {
                Ok(())
            } else {
                Err(ApiError::conflict(
                    "FILE_EXISTS",
                    "Existing preset was preserved",
                ))
            };
        }
        self.publish(&file_name, &bytes, None)
    }
    pub fn load(&self, id: &str, expected: &str) -> Result<Preset> {
        let _guard = self.catalog_lock(false)?;
        parse(&self.checked(&name(id, false)?, expected)?.bytes)
    }
    pub fn export(&self, id: &str) -> Result<Vec<u8>> {
        let _guard = self.catalog_lock(false)?;
        Ok(self
            .raw(&name(id, false)?)?
            .ok_or_else(ApiError::missing)?
            .bytes)
    }
    pub fn item(&self, id: &str, archived: bool) -> Result<Value> {
        let _guard = self.catalog_lock(false)?;
        self.item_locked(id, archived)
    }
    fn item_locked(&self, id: &str, archived: bool) -> Result<Value> {
        let raw = self
            .raw(&name(id, archived)?)?
            .ok_or_else(ApiError::missing)?;
        Ok(match parse(&raw.bytes) {
            Ok(preset) => {
                let mut value = item_value(id, archived, &raw.revision, &preset);
                value["can_restore_previous"] = json!(self.has_previous(id, archived));
                value
            }
            Err(error) => {
                json!({"id":id,"revision":raw.revision,"name":id,"error":error.2,"archived":archived})
            }
        })
    }
    fn has_previous(&self, id: &str, archived: bool) -> bool {
        let Ok(directory) = self.directory() else {
            return false;
        };
        !archived
            && openat(
                directory,
                format!("{id}.json.bak").as_str(),
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .ok()
            .map(File::from)
            .and_then(|file| file.metadata().ok())
            .is_some_and(|meta| meta.is_file() && meta.len() <= MAX_BYTES)
    }
    pub fn list(&self, page: usize, query: &Query) -> Result<Value> {
        let _guard = self.catalog_lock(false)?;
        if query.search.len() > 128 {
            return Err(ApiError::invalid(
                "Preset search is limited to 128 UTF-8 bytes",
            ));
        }
        let suffix = if query.archived {
            ".json.deleted"
        } else {
            ".json"
        };
        let mut names = Vec::new();
        for (index, entry) in
            std::fs::read_dir(format!("/proc/self/fd/{}", self.directory()?.as_raw_fd()))
                .map_err(|_| ApiError::io())?
                .enumerate()
        {
            if query.sort.is_some() && index >= 10000 {
                return Err(ApiError::invalid(
                    "Preset library exceeds the 10000-entry browsing budget",
                ));
            }
            let entry = entry.map_err(|_| ApiError::io())?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if let Some(id) = file_name.strip_suffix(suffix)
                && name(id, query.archived).is_ok()
            {
                names.push(id.to_owned());
            }
            if names.len() > 10000 {
                return Err(ApiError::invalid(
                    "Preset library exceeds the 10000-file browsing budget",
                ));
            }
        }
        names.sort();
        if query.sort.is_some() {
            return self.sorted_list(page, query, names);
        }
        let total = names.len();
        let pages = total.div_ceil(32).max(1);
        let start = page
            .checked_mul(32)
            .ok_or_else(|| ApiError::invalid("Preset page is too large"))?;
        if page >= pages {
            return Err(ApiError::invalid("Preset page is beyond the last page"));
        }
        let search = query.search.to_lowercase();
        let mut items = Vec::new();
        for id in names.into_iter().skip(start).take(32) {
            let item = match self.item_locked(&id, query.archived) {
                Ok(item) => item,
                Err(error) if error.1 == "NOT_FOUND" => continue,
                Err(error) => json!({"id":id,"name":id,"error":error.2,"archived":query.archived}),
            };
            if !search.is_empty()
                && !item["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search)
                && !id.to_lowercase().contains(&search)
            {
                continue;
            }
            items.push(item);
        }
        Ok(
            json!({"project_epoch":query.project_epoch,"page":page,"pages":pages,"page_size":32,"total":total,"archived":query.archived,"items":items}),
        )
    }
    fn sorted_list(&self, page: usize, query: &Query, names: Vec<String>) -> Result<Value> {
        let catalog_total = names.len();
        let search = query.search.trim().to_lowercase();
        let mut budget = crate::asset_journal::MAX_METADATA;
        let mut rows = Vec::new();
        for id in names {
            let row = match self.raw_budgeted(&name(&id, query.archived)?, Some(&mut budget)) {
                Ok(Some(raw)) => match parse(&raw.bytes) {
                    Ok(preset) => item_value(&id, query.archived, &raw.revision, &preset),
                    Err(error) => {
                        json!({"id":id,"revision":raw.revision,"name":id,"error":error.2,"archived":query.archived})
                    }
                },
                Ok(None) => continue,
                Err(error) if error.1 == "PRESET_CATALOG_BUDGET" => return Err(error),
                Err(error) => json!({"id":id,"name":id,"error":error.2,"archived":query.archived}),
            };
            if search.is_empty()
                || id.to_lowercase().contains(&search)
                || row["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search)
            {
                rows.push(row);
            }
        }
        // The desktop preserves catalog ID order for case-equivalent names.
        rows.sort_by_cached_key(|row| row["name"].as_str().unwrap_or("").to_lowercase());
        let total = rows.len();
        let pages = total.div_ceil(32).max(1);
        if page >= pages {
            return Err(ApiError::invalid("Preset page is beyond the last page"));
        }
        let mut items = rows
            .into_iter()
            .skip(page * 32)
            .take(32)
            .collect::<Vec<_>>();
        for row in &mut items {
            if row.get("error").is_none() {
                let id = row["id"].as_str().ok_or_else(ApiError::missing)?;
                let previous = self.has_previous(id, query.archived);
                row["can_restore_previous"] = json!(previous);
            }
        }
        Ok(
            json!({"project_epoch":query.project_epoch,"page":page,"pages":pages,"page_size":32,"total":total,
            "catalog_total":catalog_total,"archived":query.archived,"sort":query.sort,"items":items}),
        )
    }
    pub fn edit(&self, command_id: &str, edit: &Edit) -> Result<()> {
        if let Edit::Import { json } = edit {
            return self.create(command_id, &parse(json.as_bytes())?);
        }
        if matches!(edit, Edit::Delete { .. }) {
            return Err(ApiError::conflict(
                "PRESET_PREPARATION_REQUIRED",
                "Use the bound durable command to permanently delete a saved preset",
            ));
        }
        let _lock = self.lock()?;
        match edit {
            Edit::Update {
                id,
                revision,
                options,
            } => {
                let file_name = name(id, false)?;
                let raw = self.checked(&file_name, revision)?;
                let mut preset = parse(&raw.bytes)?;
                preset.name = options.name.trim().into();
                preset.attributes = options.attributes.clone();
                preset.anchor = options.anchor;
                preset.append_filters = options.append_filters;
                preset.shortcut = options.shortcut_value(preset.shortcut.as_ref())?;
                preset.validate()?;
                let backup_name = format!("{file_name}.bak");
                let backup = self.raw(&backup_name)?;
                self.publish(&backup_name, &raw.bytes, backup.as_ref())?;
                self.publish(
                    &file_name,
                    &serde_json::to_vec_pretty(&preset).map_err(|_| ApiError::io())?,
                    Some(&raw),
                )
            }
            Edit::Archive { id, revision } | Edit::Restore { id, revision } => {
                let restore = matches!(edit, Edit::Restore { .. });
                let from = name(id, restore)?;
                let to = name(id, !restore)?;
                let raw = self.checked(&from, revision)?;
                let now = self.checked(&from, revision)?;
                if now.identity != raw.identity {
                    return Err(ApiError::conflict(
                        "PRESET_CHANGED",
                        "Preset changed before moving; refresh the library",
                    ));
                }
                renameat_with(
                    self.directory()?,
                    from.as_str(),
                    self.directory()?,
                    to.as_str(),
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| {
                    ApiError::conflict(
                        "FILE_EXISTS",
                        "An existing active or archived preset was preserved",
                    )
                })?;
                self.directory()?.sync_all().map_err(|_| ApiError::io())?;
                Ok(())
            }
            Edit::RestorePrevious { id, revision } => {
                let file_name = name(id, false)?;
                let raw = self.checked(&file_name, revision)?;
                let backup_name = format!("{file_name}.bak");
                let previous = self.raw(&backup_name)?.ok_or_else(ApiError::missing)?;
                parse(&previous.bytes)?;
                let current = self.checked(&file_name, revision)?;
                let backup = self.checked(&backup_name, &previous.revision)?;
                if current.identity != raw.identity || backup.identity != previous.identity {
                    return Err(ApiError::conflict(
                        "PRESET_CHANGED",
                        "Preset changed before restoring; refresh the library",
                    ));
                }
                renameat_with(
                    self.directory()?,
                    file_name.as_str(),
                    self.directory()?,
                    backup_name.as_str(),
                    RenameFlags::EXCHANGE,
                )
                .map_err(|_| ApiError::io())?;
                self.directory()?.sync_all().map_err(|_| ApiError::io())
            }
            Edit::Import { .. } | Edit::Delete { .. } => unreachable!(),
        }
    }
}

#[cfg(test)]
#[path = "tests/preset_store.rs"]
mod tests;
