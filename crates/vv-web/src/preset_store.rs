use crate::{
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
    os::fd::AsRawFd,
    path::Path,
};

const MAX_BYTES: u64 = 4 * 1024 * 1024;
pub struct Store {
    dir: File,
}
struct Raw {
    bytes: Vec<u8>,
    revision: String,
    identity: String,
}
#[derive(Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub project_epoch: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub archived: bool,
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
        let fd = rustix::fs::open(
            root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )?;
        Ok(Self {
            dir: File::from(fd),
        })
    }
    fn lock(&self) -> Result<File> {
        self.catalog_lock(true)
    }
    fn catalog_lock(&self, exclusive: bool) -> Result<File> {
        let fd = openat(
            &self.dir,
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
        match rustix::fs::statat(
            &self.dir,
            ".venturi-native-presets-pending.json",
            AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Err(rustix::io::Errno::NOENT) => (),
            Ok(_) => {
                return Err(ApiError::conflict(
                    "LIBRARY_RECOVERY_REQUIRED",
                    "A desktop preset transaction is pending; reopen the desktop library to recover it",
                ));
            }
            Err(_) => return Err(ApiError::io()),
        }
        Ok(file)
    }
    fn raw(&self, file_name: &str) -> Result<Option<Raw>> {
        let fd = match openat(
            &self.dir,
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
        let identity = crate::source::file_identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
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
                &self.dir,
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
                    &self.dir,
                    temp.as_str(),
                    &self.dir,
                    file_name,
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| ApiError::conflict("FILE_EXISTS", "Existing preset was preserved"))?;
            } else {
                renameat(&self.dir, temp.as_str(), &self.dir, file_name)
                    .map_err(|_| ApiError::io())?;
            }
            self.dir.sync_all().map_err(|_| ApiError::io())?;
            Ok(())
        })();
        let _ = unlinkat(&self.dir, temp.as_str(), AtFlags::empty());
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
                let backup_name = format!("{id}.json.bak");
                let previous = if archived {
                    false
                } else {
                    openat(
                        &self.dir,
                        backup_name.as_str(),
                        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .ok()
                    .map(File::from)
                    .and_then(|file| file.metadata().ok())
                    .is_some_and(|meta| meta.is_file() && meta.len() <= MAX_BYTES)
                };
                json!({"id":id,"revision":raw.revision,"name":preset.name,"attributes":preset.attributes,"anchor":preset.anchor,"append_filters":preset.append_filters,"shortcut":preset.shortcut,"fps":preset.fps,"resolution":preset.resolution,"video":preset.video.is_some(),"audio":preset.audio.is_some(),"archived":archived,"can_restore_previous":previous})
            }
            Err(error) => {
                json!({"id":id,"revision":raw.revision,"name":id,"error":error.2,"archived":archived})
            }
        })
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
        for entry in std::fs::read_dir(format!("/proc/self/fd/{}", self.dir.as_raw_fd()))
            .map_err(|_| ApiError::io())?
        {
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
    pub fn edit(&self, command_id: &str, edit: &Edit) -> Result<()> {
        if let Edit::Import { json } = edit {
            return self.create(command_id, &parse(json.as_bytes())?);
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
                    &self.dir,
                    from.as_str(),
                    &self.dir,
                    to.as_str(),
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| {
                    ApiError::conflict(
                        "FILE_EXISTS",
                        "An existing active or archived preset was preserved",
                    )
                })?;
                self.dir.sync_all().map_err(|_| ApiError::io())?;
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
                    &self.dir,
                    file_name.as_str(),
                    &self.dir,
                    backup_name.as_str(),
                    RenameFlags::EXCHANGE,
                )
                .map_err(|_| ApiError::io())?;
                self.dir.sync_all().map_err(|_| ApiError::io())
            }
            Edit::Import { .. } => unreachable!(),
        }
    }
}

#[cfg(test)]
#[path = "tests/preset_store.rs"]
mod tests;
