use crate::{
    asset_payload::{self, AssetFile},
    error::{ApiError, Result},
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, renameat, renameat_with, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) const MAX_JSON: u64 = 4 * 1024 * 1024;
#[derive(Clone)]
pub struct Store(Arc<Directories>);
struct Directories {
    root: PathBuf,
    directory: File,
    assets: File,
    media: File,
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
    Update {
        id: String,
        revision: String,
        name: String,
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
        return Err(ApiError::invalid("Choose a listed native asset ID"));
    }
    Ok(format!(
        "{id}.json{}",
        if archived { ".deleted" } else { "" }
    ))
}
pub(crate) fn directory(parent: &File, child: &str) -> Result<File> {
    match rustix::fs::mkdirat(parent, child, Mode::RUSR | Mode::WUSR | Mode::XUSR) {
        Ok(()) => parent.sync_all().map_err(|_| ApiError::io())?,
        Err(rustix::io::Errno::EXIST) => (),
        Err(_) => return Err(ApiError::io()),
    }
    openat(
        parent,
        child,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(|_| ApiError::invalid("Asset directories must not be links"))
}
pub(crate) fn regular(parent: &File, child: &str) -> Result<File> {
    let file = File::from(
        openat(
            parent,
            child,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::invalid("Assets must be regular files"));
    }
    Ok(file)
}
impl Store {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        let root_dir = File::from(rustix::fs::open(
            root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )?);
        let assets = directory(&root_dir, "assets").map_err(|e| std::io::Error::other(e.2))?;
        let media = directory(&root_dir, "media").map_err(|e| std::io::Error::other(e.2))?;
        Ok(Self(Arc::new(Directories {
            root: root.canonicalize()?,
            directory: root_dir,
            assets,
            media,
        })))
    }
    pub(crate) fn root(&self) -> &Path {
        &self.0.root
    }
    pub(crate) fn media(&self) -> &File {
        &self.0.media
    }
    pub(crate) fn validate_root(&self) -> Result<()> {
        let live = File::from(
            rustix::fs::open(
                self.root(),
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| changed())?,
        );
        same_directory(&live, &self.0.directory)?;
        for (name, pinned) in [("assets", &self.0.assets), ("media", &self.0.media)] {
            let live = File::from(
                openat(
                    &live,
                    name,
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .map_err(|_| changed())?,
            );
            same_directory(&live, pinned)?;
        }
        Ok(())
    }
    pub(crate) fn lock(&self) -> Result<File> {
        self.validate_root()?;
        let file = File::from(
            openat(
                &self.0.directory,
                ".venturi-assets.lock",
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::invalid("Asset lock must be a regular file"));
        }
        rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive).map_err(
            |_| {
                ApiError::conflict(
                    "LIBRARY_BUSY",
                    "Asset library is busy; retry after the current operation",
                )
            },
        )?;
        Ok(file)
    }
    fn raw(&self, file_name: &str) -> Result<Option<Raw>> {
        self.validate_root()?;
        let fd = match openat(
            &self.0.assets,
            file_name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => {
                return Err(ApiError::invalid(
                    "Asset links and unreadable files are preserved and refused",
                ));
            }
        };
        let file = File::from(fd);
        let meta = file.metadata().map_err(|_| ApiError::io())?;
        if !meta.is_file() || meta.len() > MAX_JSON {
            return Err(ApiError::invalid(
                "Native assets must be regular files within 4 MiB",
            ));
        }
        let identity = stable_identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_JSON + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_JSON || stable_identity(&file)? != identity {
            return Err(changed());
        }
        let live = regular(&self.0.assets, file_name)?;
        if stable_identity(&live)? != identity {
            return Err(changed());
        }
        Ok(Some(Raw {
            revision: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            identity,
        }))
    }
    fn checked(&self, file_name: &str, revision: &str) -> Result<Raw> {
        let raw = self.raw(file_name)?.ok_or_else(ApiError::missing)?;
        if raw.revision != revision {
            return Err(changed());
        }
        Ok(raw)
    }
    fn publish_bytes(&self, file_name: &str, bytes: &[u8], expected: Option<&Raw>) -> Result<()> {
        if bytes.len() as u64 > MAX_JSON {
            return Err(ApiError::invalid("Native asset exceeds 4 MiB"));
        }
        let disk = rustix::fs::fstatvfs(&self.0.assets).map_err(|_| ApiError::io())?;
        if disk.f_bavail.saturating_mul(disk.f_frsize) < 512 * 1024 * 1024 + bytes.len() as u64 {
            return Err(ApiError::conflict(
                "ASSET_DISK_FULL",
                "Native assets require 512 MiB free disk reserve",
            ));
        }
        let temp = format!(
            ".venturi-asset-{}-{}.tmp",
            std::process::id(),
            crate::asset_jobs::nonce()
        );
        let result = (|| {
            let mut file = File::from(
                openat(
                    &self.0.assets,
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
            file.write_all(bytes).map_err(|_| ApiError::io())?;
            file.sync_all().map_err(|_| ApiError::io())?;
            let now = self.raw(file_name)?;
            if now.as_ref().map(|v| (&v.identity, &v.revision))
                != expected.map(|v| (&v.identity, &v.revision))
            {
                return Err(changed());
            }
            if expected.is_some() {
                renameat(&self.0.assets, temp.as_str(), &self.0.assets, file_name)
                    .map_err(|_| ApiError::io())?;
            } else {
                renameat_with(
                    &self.0.assets,
                    temp.as_str(),
                    &self.0.assets,
                    file_name,
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| ApiError::conflict("FILE_EXISTS", "Existing asset was preserved"))?;
            }
            self.0.assets.sync_all().map_err(|_| ApiError::io())
        })();
        let _ = unlinkat(&self.0.assets, temp.as_str(), AtFlags::empty());
        result
    }
    pub fn create(&self, id: &str, asset: &AssetFile) -> Result<()> {
        asset_payload::decode(asset)?;
        let file_name = name(id, false)?;
        let bytes = serde_json::to_vec_pretty(asset).map_err(|_| ApiError::io())?;
        let _lock = self.lock()?;
        if let Some(existing) = self.raw(&file_name)? {
            return if existing.bytes == bytes {
                Ok(())
            } else {
                Err(ApiError::conflict(
                    "FILE_EXISTS",
                    "Existing asset was preserved",
                ))
            };
        }
        self.publish_bytes(&file_name, &bytes, None)
    }
    pub fn load(&self, id: &str, revision: &str) -> Result<AssetFile> {
        asset_payload::parse(&self.checked(&name(id, false)?, revision)?.bytes)
    }
    pub fn export(&self, id: &str) -> Result<Vec<u8>> {
        Ok(self
            .raw(&name(id, false)?)?
            .ok_or_else(ApiError::missing)?
            .bytes)
    }
    pub fn item(&self, id: &str, archived: bool) -> Result<Value> {
        let raw = self
            .raw(&name(id, archived)?)?
            .ok_or_else(ApiError::missing)?;
        Ok(match asset_payload::parse(&raw.bytes) {
            Ok(asset) => {
                let payload = asset_payload::decode(&asset)?;
                let previous = if archived {
                    false
                } else {
                    self.raw(&format!("{id}.json.bak"))?.is_some()
                };
                json!({"id":id,"revision":raw.revision,"name":asset.name,"folder":asset.folder,"media_count":payload.media_items().count(),"file_count":payload.files().map(|m| &m.path).collect::<std::collections::HashSet<_>>().len(),"archived":archived,"can_restore_previous":previous})
            }
            Err(e) => {
                json!({"id":id,"revision":raw.revision,"name":id,"error":e.2,"archived":archived})
            }
        })
    }
    pub fn list(&self, page: usize, query: &Query) -> Result<Value> {
        if query.search.len() > 128 {
            return Err(ApiError::invalid(
                "Asset search is limited to 128 UTF-8 bytes",
            ));
        }
        let suffix = if query.archived {
            ".json.deleted"
        } else {
            ".json"
        };
        let mut names = Vec::new();
        for (count, entry) in
            std::fs::read_dir(format!("/proc/self/fd/{}", self.0.assets.as_raw_fd()))
                .map_err(|_| ApiError::io())?
                .enumerate()
        {
            if count >= 10000 {
                return Err(ApiError::invalid(
                    "Asset library exceeds the 10000-entry browsing budget",
                ));
            }
            let entry = entry.map_err(|_| ApiError::io())?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if let Some(id) = file_name.strip_suffix(suffix)
                && name(id, query.archived).is_ok()
            {
                names.push(id.to_owned());
            }
        }
        names.sort();
        let total = names.len();
        let pages = total.div_ceil(32).max(1);
        if page >= pages {
            return Err(ApiError::invalid("Asset page is beyond the last page"));
        }
        let search = query.search.to_lowercase();
        let mut items = Vec::new();
        for id in names.into_iter().skip(page * 32).take(32) {
            let item = match self.item(&id, query.archived) {
                Ok(item) => item,
                Err(e) if e.1 == "NOT_FOUND" => continue,
                Err(e) => json!({"id":id,"name":id,"error":e.2,"archived":query.archived}),
            };
            if search.is_empty()
                || id.to_lowercase().contains(&search)
                || item["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search)
            {
                items.push(item);
            }
        }
        Ok(
            json!({"project_epoch":query.project_epoch,"page":page,"pages":pages,"page_size":32,"total":total,"archived":query.archived,"items":items}),
        )
    }
    pub fn edit(&self, _command_id: &str, edit: &Edit) -> Result<()> {
        let _lock = self.lock()?;
        match edit {
            Edit::Update {
                id,
                revision,
                name: new_name,
            } => {
                let file_name = name(id, false)?;
                let raw = self.checked(&file_name, revision)?;
                let mut asset = asset_payload::parse(&raw.bytes)?;
                asset.name = new_name.trim().into();
                asset_payload::decode(&asset)?;
                let backup_name = format!("{file_name}.bak");
                let backup = self.raw(&backup_name)?;
                self.publish_bytes(&backup_name, &raw.bytes, backup.as_ref())?;
                self.publish_bytes(
                    &file_name,
                    &serde_json::to_vec_pretty(&asset).map_err(|_| ApiError::io())?,
                    Some(&raw),
                )
            }
            Edit::Archive { id, revision } | Edit::Restore { id, revision } => {
                let restore = matches!(edit, Edit::Restore { .. });
                let from = name(id, restore)?;
                let to = name(id, !restore)?;
                let raw = self.checked(&from, revision)?;
                if self.checked(&from, revision)?.identity != raw.identity {
                    return Err(changed());
                }
                renameat_with(
                    &self.0.assets,
                    from.as_str(),
                    &self.0.assets,
                    to.as_str(),
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| {
                    ApiError::conflict(
                        "FILE_EXISTS",
                        "An existing active or archived asset was preserved",
                    )
                })?;
                self.0.assets.sync_all().map_err(|_| ApiError::io())
            }
            Edit::RestorePrevious { id, revision } => {
                let file_name = name(id, false)?;
                let raw = self.checked(&file_name, revision)?;
                let backup_name = format!("{file_name}.bak");
                let previous = self.raw(&backup_name)?.ok_or_else(ApiError::missing)?;
                asset_payload::parse(&previous.bytes)?;
                if self.checked(&file_name, revision)?.identity != raw.identity
                    || self.checked(&backup_name, &previous.revision)?.identity != previous.identity
                {
                    return Err(changed());
                }
                renameat_with(
                    &self.0.assets,
                    file_name.as_str(),
                    &self.0.assets,
                    backup_name.as_str(),
                    RenameFlags::EXCHANGE,
                )
                .map_err(|_| ApiError::io())?;
                self.0.assets.sync_all().map_err(|_| ApiError::io())
            }
        }
    }
}
pub(crate) fn changed() -> ApiError {
    ApiError::conflict(
        "ASSET_CHANGED",
        "Asset changed; refresh the library and prepare again",
    )
}
pub(crate) fn stable_identity(file: &File) -> Result<String> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata().map_err(|_| ApiError::io())?;
    Ok(format!(
        "{}:{}:{}",
        crate::source::file_identity(file)?,
        meta.ctime(),
        meta.ctime_nsec()
    ))
}
pub(crate) fn same_directory(a: &File, b: &File) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    let a = a.metadata().map_err(|_| ApiError::io())?;
    let b = b.metadata().map_err(|_| ApiError::io())?;
    if !a.is_dir() || !b.is_dir() || (a.dev(), a.ino()) != (b.dev(), b.ino()) {
        return Err(changed());
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/asset_store.rs"]
mod tests;
