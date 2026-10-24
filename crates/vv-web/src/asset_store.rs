use crate::{
    asset_folders::Tree,
    asset_journal::{self, Before, Completion, PreparedEdit},
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
    os::{fd::AsRawFd, unix::fs::MetadataExt},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use vv_core::Id;

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
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub folders_revision: Option<String>,
    #[serde(default)]
    pub sort: Option<SortKey>,
    #[serde(default)]
    pub descending: bool,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    Name,
    Duration,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AssetRef {
    pub id: String,
    pub revision: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImportRef {
    pub asset_id: String,
    pub revision: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    ImportTree {
        directory_token: String,
        parent: Option<String>,
        folders_revision: String,
    },
    RelinkFolder {
        id: String,
        revision: String,
        directory_token: String,
        #[serde(default, skip_serializing_if = "is_false")]
        replace_content: bool,
    },
    Relink {
        id: String,
        revision: String,
        path_tokens: Vec<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        replace_content: bool,
    },
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
    DeleteAssets {
        items: Vec<AssetRef>,
        #[serde(default)]
        archived: bool,
    },
    CreateFolder {
        folders_revision: String,
        name: String,
        parent: Option<String>,
    },
    RenameFolder {
        id: String,
        folders_revision: String,
        name: String,
    },
    MoveFolder {
        id: String,
        folders_revision: String,
        parent: Option<String>,
    },
    RemoveFolder {
        id: String,
        folders_revision: String,
    },
    MoveAssets {
        folders_revision: String,
        items: Vec<AssetRef>,
        folder: Option<String>,
    },
}
fn is_false(value: &bool) -> bool {
    !value
}
impl Edit {
    pub fn requires_preparation(&self) -> bool {
        matches!(
            self,
            Self::Relink { .. }
                | Self::RelinkFolder { .. }
                | Self::ImportTree { .. }
                | Self::CreateFolder { .. }
                | Self::RenameFolder { .. }
                | Self::MoveFolder { .. }
                | Self::RemoveFolder { .. }
                | Self::MoveAssets { .. }
                | Self::DeleteAssets { .. }
        )
    }
}
pub(crate) struct TreeImportPlan {
    tree: Tree,
    original_revision: String,
    before: Option<Before>,
    roster: Vec<asset_journal::RosterEntry>,
    pub folders: Vec<Option<String>>,
    pub present: std::collections::HashSet<(u64, Option<String>)>,
    pub created_folders: usize,
}
pub(crate) struct RelinkedFile {
    pub path: PathBuf,
    pub content_hash: u64,
    pub meta: vv_core::MediaMeta,
    pub source_token: String,
}
fn browse_budget() -> ApiError {
    ApiError::conflict(
        "ASSET_CATALOG_BUDGET",
        "Native library browsing exceeds its 16 MiB metadata budget",
    )
}
fn presentation(payload: &vv_core::clipboard::ClipboardPayload) -> Value {
    let Some(item) = payload.media_items().next() else {
        return Value::Null;
    };
    let meta = &item.meta;
    let kind = if item.compound.is_some() {
        "timeline"
    } else if meta.is_image() {
        "image"
    } else if meta.has_video {
        "video"
    } else if meta.has_audio {
        "audio"
    } else {
        "media"
    };
    json!({"kind":kind,"width":meta.width,"height":meta.height,"fps":meta.fps,"duration_frames":meta.duration_frames,
        "is_image":meta.is_image(),"has_video":meta.has_video,"has_audio":meta.has_audio,"sample_rate":meta.sample_rate,
        "channels":meta.channels,"audio_streams":meta.audio_stream_count()})
}
fn presentation_seconds(value: &Value) -> f64 {
    let frames = value["duration_frames"].as_i64().unwrap_or(0);
    let num = value["fps"]["num"].as_i64().unwrap_or(0);
    let den = value["fps"]["den"].as_i64().unwrap_or(0);
    if num > 0 && den > 0 {
        frames as f64 / (num as f64 / den as f64).max(1e-9)
    } else {
        0.0
    }
}
fn browse_matches(row: &Value, query: &Query, search: &str) -> bool {
    let folder_matches = query.folder.as_ref().is_none_or(|folder| {
        if folder.is_empty() {
            row["effective_folder"].is_null()
        } else {
            row["effective_folder"].as_str() == Some(folder.as_str())
        }
    });
    folder_matches
        && (search.is_empty()
            || row["id"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(search)
            || row["name"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(search))
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
        let store = Self(Arc::new(Directories {
            root: root.canonicalize()?,
            directory: root_dir,
            assets,
            media,
        }));
        // Reads and mutations retry catalog availability on the pinned directories.
        match store.read_guard() {
            Ok(_guard) => (),
            Err(error) if error.1 == "LIBRARY_BUSY" => (),
            Err(error) => return Err(std::io::Error::other(error.2)),
        }
        Ok(store)
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
        let _catalog = self.catalog_lock(true)?;
        self.no_native_pending()?;
        asset_journal::recover(&self.0.directory, &self.0.assets)?;
        Ok(file)
    }
    fn catalog_lock(&self, exclusive: bool) -> Result<File> {
        let file = File::from(
            openat(
                &self.0.directory,
                ".venturi-assets-catalog.lock",
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
            return Err(changed());
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
                "Asset catalog is busy; retry after the current operation",
            )
        })?;
        Ok(file)
    }
    fn read_guard(&self) -> Result<File> {
        self.validate_root()?;
        let guard = self.catalog_lock(false)?;
        self.no_native_pending()?;
        if !asset_journal::pending(&self.0.directory)? {
            return Ok(guard);
        }
        drop(guard);
        let _global = self.lock()?;
        let guard = self.catalog_lock(false)?;
        self.no_native_pending()?;
        Ok(guard)
    }
    fn no_native_pending(&self) -> Result<()> {
        match rustix::fs::statat(
            &self.0.directory,
            ".venturi-native-assets-pending.json",
            AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Err(rustix::io::Errno::NOENT) => Ok(()),
            _ => Err(ApiError::conflict(
                "LIBRARY_BUSY",
                "Native library recovery is pending; reopen the native library before using it here",
            )),
        }
    }
    pub(crate) fn media_entry(&self, path: &Path) -> Result<Option<File>> {
        let relative = path
            .strip_prefix(self.root().join("media"))
            .map_err(|_| ApiError::invalid("Relink requires managed native library media paths"))?;
        let parts: Vec<_> = relative.components().collect();
        if parts.len() != 2
            || parts
                .iter()
                .any(|p| !matches!(p, std::path::Component::Normal(_)))
        {
            return Err(ApiError::invalid("Invalid native library media path"));
        }
        let hash = parts[0]
            .as_os_str()
            .to_str()
            .ok_or_else(ApiError::missing)?;
        let filename = parts[1]
            .as_os_str()
            .to_str()
            .ok_or_else(ApiError::missing)?;
        if ![16, 64].contains(&hash.len())
            || !hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || filename.is_empty()
            || filename.len() > 128
            || filename.starts_with('.')
            || filename
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
        {
            return Err(ApiError::invalid("Invalid managed native media name"));
        }
        let dir = match openat(
            self.media(),
            hash,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => File::from(fd),
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(changed()),
        };
        let file = match openat(
            &dir,
            filename,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => File::from(fd),
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(changed()),
        };
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(changed());
        }
        Ok(Some(file))
    }
    pub(crate) fn missing_files(&self, asset: &AssetFile) -> Result<Vec<(PathBuf, bool)>> {
        let payload = asset_payload::decode(asset)?;
        let paths: std::collections::BTreeSet<_> =
            payload.files().map(|item| item.path.clone()).collect();
        if paths.len() > 64 {
            return Err(ApiError::invalid(
                "Native assets support at most 64 unique files",
            ));
        }
        paths
            .into_iter()
            .map(|path| {
                let missing = self.media_entry(&path)?.is_none();
                Ok((path, missing))
            })
            .collect()
    }
    fn folders_raw(&self) -> Result<(Tree, String, Option<Before>)> {
        let fd = match openat(
            &self.0.directory,
            "folders.json",
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok((Tree::default(), "absent".into(), None)),
            Err(_) => return Err(changed()),
        };
        let file = File::from(fd);
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(changed());
        }
        let identity = stable_identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(crate::asset_folders::MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() > crate::asset_folders::MAX_BYTES
            || stable_identity(&file)? != identity
            || stable_identity(&regular(&self.0.directory, "folders.json")?)? != identity
        {
            return Err(changed());
        }
        let revision = format!("{:x}", Sha256::digest(&bytes));
        Ok((
            crate::asset_folders::parse(&bytes)?,
            revision.clone(),
            Some(Before {
                identity,
                sha256: revision,
            }),
        ))
    }
    pub fn folders(&self) -> Result<Value> {
        let _guard = self.read_guard()?;
        let (tree, revision, _) = self.folders_raw()?;
        Ok(json!({"version":1,"folders_revision":revision,"folders":tree.folders}))
    }
    pub fn completion(&self, id: &str, binding: &str) -> Result<Option<([u8; 32], Value)>> {
        let _guard = self.read_guard()?;
        Ok(
            asset_journal::completion_for(&self.0.directory, id, binding)?
                .map(|entry| (entry.fingerprint, entry.receipt)),
        )
    }
    pub fn completions(&self, binding: &str) -> Result<Vec<(String, [u8; 32], Value)>> {
        let _guard = self.read_guard()?;
        Ok(asset_journal::completions(&self.0.directory, binding)?
            .into_iter()
            .map(|entry| (entry.command_id, entry.fingerprint, entry.receipt))
            .collect())
    }
    pub fn acknowledge_completion(
        &self,
        id: &str,
        fingerprint: [u8; 32],
        binding: &str,
    ) -> Result<()> {
        let _global = self.lock()?;
        let _catalog = self.catalog_lock(true)?;
        asset_journal::acknowledge(&self.0.directory, id, fingerprint, binding)
    }
    fn raw(&self, file_name: &str) -> Result<Option<Raw>> {
        self.raw_limit(file_name, MAX_JSON)
    }
    fn raw_limit(&self, file_name: &str, limit: u64) -> Result<Option<Raw>> {
        self.raw_budgeted(file_name, limit, None)
    }
    fn raw_budgeted(
        &self,
        file_name: &str,
        limit: u64,
        mut budget: Option<&mut u64>,
    ) -> Result<Option<Raw>> {
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
        if !meta.is_file() || meta.len() > limit {
            return Err(ApiError::invalid(
                "Native assets must be regular files within 4 MiB",
            ));
        }
        let read_limit = if let Some(remaining) = budget.as_deref() {
            if meta.len() > *remaining {
                return Err(browse_budget());
            }
            limit.min(*remaining)
        } else {
            limit
        };
        let identity = stable_identity(&file)?;
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
        if bytes.len() as u64 > limit || stable_identity(&file)? != identity {
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
        let _catalog = self.catalog_lock(true)?;
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
        let _guard = self.read_guard()?;
        asset_payload::parse(&self.checked(&name(id, false)?, revision)?.bytes)
    }
    pub fn export(&self, id: &str) -> Result<Vec<u8>> {
        let _guard = self.read_guard()?;
        Ok(self
            .raw(&name(id, false)?)?
            .ok_or_else(ApiError::missing)?
            .bytes)
    }
    pub fn item(&self, id: &str, archived: bool) -> Result<Value> {
        let _guard = self.read_guard()?;
        let (tree, _, _) = self.folders_raw()?;
        let raw = self
            .raw(&name(id, archived)?)?
            .ok_or_else(ApiError::missing)?;
        Ok(match asset_payload::parse(&raw.bytes) {
            Ok(asset) => {
                let payload = asset_payload::decode(&asset)?;
                let files = self.missing_files(&asset);
                let previous = if archived {
                    false
                } else {
                    self.raw(&format!("{id}.json.bak"))?.is_some()
                };
                let effective = asset.folder.as_deref().filter(|id| tree.contains(id));
                let mut value = json!({"id":id,"revision":raw.revision,"name":asset.name,"folder":asset.folder,"effective_folder":effective,"media_count":payload.media_items().count(),"file_count":payload.files().map(|m|&m.path).collect::<std::collections::HashSet<_>>().len(),"archived":archived,"can_restore_previous":previous});
                value["presentation"] = presentation(&payload);
                let placement = payload.media_ids().iter().map(|id| {
                    let meta = &payload.fragment().media_pool[*id].meta;
                    let out = crate::commands::whole_media_out(meta)?;
                    Ok(json!({"source_in":0,"source_out":out,"fps":meta.fps,"has_video":meta.has_video,"has_audio":meta.has_audio,"audio_streams":meta.audio_stream_count(),"is_image":meta.is_image()}))
                }).collect::<Result<Vec<_>>>();
                value["placement"] = match placement {
                    Ok(items) if !archived => json!({"items":items,"error":null}),
                    Ok(_) => json!({"items":[],"error":"Restore this asset before placing it"}),
                    Err(error) => json!({"items":[],"error":error.2}),
                };
                match files {
                    Ok(files) => {
                        if files.iter().any(|(_, missing)| *missing) {
                            value["placement"] = json!({"items":[],"error":"Relink missing asset files before placing it"});
                        }
                        value["missing_count"] =
                            json!(files.iter().filter(|(_, missing)| *missing).count());
                        value["offline_files"]=json!(files.iter().map(|(path,missing)|json!({"name":path.file_name().and_then(|n|n.to_str()).unwrap_or_default(),"missing":missing})).collect::<Vec<_>>());
                    }
                    Err(error) => {
                        value["placement"] = json!({"items":[],"error":error.2});
                        value["missing_count"] = Value::Null;
                        value["offline_files"] = json!([]);
                        value["relink_error"] = json!(error.2);
                    }
                }
                value
            }
            Err(e) => {
                json!({"id":id,"revision":raw.revision,"name":id,"error":e.2,"archived":archived})
            }
        })
    }
    pub fn list(&self, page: usize, query: &Query) -> Result<Value> {
        let _guard = self.read_guard()?;
        let (tree, folders_revision, _) = self.folders_raw()?;
        if let Some(folder) = &query.folder {
            if query.folders_revision.as_deref() != Some(folders_revision.as_str()) {
                return Err(ApiError::conflict(
                    "FOLDERS_CHANGED",
                    "Native asset folders changed; refresh the library",
                ));
            }
            if !folder.is_empty() && !tree.contains(folder) {
                return Err(ApiError::missing());
            }
        }
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
        if let Some(sort) = query.sort {
            return self.sorted_list(page, query, &tree, &folders_revision, names, sort);
        }
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
            if query.folder.as_ref().is_some_and(|folder| {
                if folder.is_empty() {
                    !item["effective_folder"].is_null()
                } else {
                    item["effective_folder"].as_str() != Some(folder.as_str())
                }
            }) {
                continue;
            }
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
            json!({"project_epoch":query.project_epoch,"page":page,"pages":pages,"page_size":32,"total":total,"archived":query.archived,"folder":query.folder,"folders_revision":folders_revision,"items":items}),
        )
    }
    fn sorted_list(
        &self,
        page: usize,
        query: &Query,
        tree: &Tree,
        folders_revision: &str,
        names: Vec<String>,
        sort: SortKey,
    ) -> Result<Value> {
        let catalog_total = names.len();
        let search = query.search.trim().to_lowercase();
        let mut budget = asset_journal::MAX_METADATA;
        let mut rows = Vec::new();
        for id in names {
            let raw = match self.raw_budgeted(
                &name(&id, query.archived)?,
                MAX_JSON,
                Some(&mut budget),
            ) {
                Ok(Some(raw)) => raw,
                Ok(None) => continue,
                Err(error) if error.1 == "ASSET_CATALOG_BUDGET" => return Err(error),
                Err(error) => {
                    let row = json!({"id":id,"name":id,"error":error.2,"archived":query.archived,"presentation":null});
                    if browse_matches(&row, query, &search) {
                        rows.push(row);
                    }
                    continue;
                }
            };
            let row = match asset_payload::parse(&raw.bytes).and_then(|asset| {
                let payload = asset_payload::decode(&asset)?;
                let effective = asset.folder.as_deref().filter(|id|tree.contains(id));
                Ok(json!({"id":id,"revision":raw.revision,"name":asset.name,"folder":asset.folder,"effective_folder":effective,"presentation":presentation(&payload),"archived":query.archived}))
            }) {
                Ok(row) => row,
                Err(error) => json!({"id":id,"revision":raw.revision,"name":id,"error":error.2,"archived":query.archived,"presentation":null}),
            };
            if browse_matches(&row, query, &search) {
                rows.push(row);
            }
        }
        rows.sort_by(|a, b| {
            let left = a["name"].as_str().unwrap_or("");
            let right = b["name"].as_str().unwrap_or("");
            let by_name = left
                .to_lowercase()
                .cmp(&right.to_lowercase())
                .then_with(|| left.cmp(right));
            let order = match sort {
                SortKey::Name => by_name,
                SortKey::Duration => presentation_seconds(&a["presentation"])
                    .partial_cmp(&presentation_seconds(&b["presentation"]))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(by_name),
            };
            let order = if query.descending {
                order.reverse()
            } else {
                order
            };
            order.then_with(|| {
                a["id"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(b["id"].as_str().unwrap_or(""))
            })
        });
        let total = rows.len();
        let pages = total.div_ceil(32).max(1);
        if page >= pages {
            return Err(ApiError::invalid("Asset page is beyond the last page"));
        }
        let mut items = Vec::new();
        for row in rows.into_iter().skip(page * 32).take(32) {
            if row.get("error").is_some() {
                items.push(row);
                continue;
            }
            let id = row["id"].as_str().ok_or_else(ApiError::missing)?;
            let item = self.item(id, query.archived)?;
            if item["revision"] != row["revision"] {
                return Err(changed());
            }
            items.push(item);
        }
        Ok(
            json!({"project_epoch":query.project_epoch,"page":page,"pages":pages,"page_size":32,"total":total,"catalog_total":catalog_total,"archived":query.archived,"folder":query.folder,"folders_revision":folders_revision,"sort":sort,"descending":query.descending,"items":items}),
        )
    }
    pub fn edit(&self, _command_id: &str, edit: &Edit) -> Result<()> {
        if edit.requires_preparation() {
            return Err(ApiError::conflict(
                "ASSET_PREPARATION_REQUIRED",
                "Prepare native asset folder edits on the bounded worker",
            ));
        }
        let _lock = self.lock()?;
        let _catalog = self.catalog_lock(true)?;
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
            _ => unreachable!("Prepared folder edits are handled separately"),
        }
    }
    pub(crate) fn prepare_edit(
        &self,
        edit: &Edit,
        completion: Completion,
        cancel: &AtomicBool,
    ) -> Result<PreparedEdit> {
        let _global = self.lock()?;
        if let Edit::DeleteAssets { items, archived } = edit {
            return self.prepare_delete(items, *archived, completion, cancel);
        }
        if !edit.requires_preparation()
            || matches!(
                edit,
                Edit::Relink { .. } | Edit::RelinkFolder { .. } | Edit::ImportTree { .. }
            )
        {
            return Err(ApiError::invalid(
                "This native asset edit does not require folder preparation",
            ));
        }
        let (mut tree, revision, before) = self.folders_raw()?;
        let expected = match edit {
            Edit::CreateFolder {
                folders_revision, ..
            }
            | Edit::RenameFolder {
                folders_revision, ..
            }
            | Edit::MoveFolder {
                folders_revision, ..
            }
            | Edit::RemoveFolder {
                folders_revision, ..
            }
            | Edit::MoveAssets {
                folders_revision, ..
            } => folders_revision,
            _ => unreachable!(),
        };
        if expected != &revision {
            return Err(ApiError::conflict(
                "FOLDERS_CHANGED",
                "Native asset folders changed; refresh before editing",
            ));
        }
        let mut prepared = PreparedEdit::new(&self.0.directory, completion.clone(), json!({}))?;
        prepared.guard(false, "folders.json".into(), before.clone());
        let mut affected = 0;
        let mut read_bytes = if before.is_some() {
            regular(&self.0.directory, "folders.json")?
                .metadata()
                .map_err(|_| ApiError::io())?
                .len()
        } else {
            0
        };
        let mut tree_changed = false;
        match edit {
            Edit::CreateFolder { name, parent, .. } => {
                tree_changed = tree.create(&completion.command_id, name, parent.as_deref())?;
            }
            Edit::RenameFolder { id, name, .. } => {
                tree_changed = tree.rename(id, name)?;
            }
            Edit::MoveFolder { id, parent, .. } => {
                tree_changed = tree.move_folder(id, parent.as_deref())?;
            }
            Edit::RemoveFolder { id, .. } => {
                let parent = tree.remove(id)?.parent;
                tree_changed = true;
                let entries = asset_journal::active_roster(&self.0.assets)?;
                for entry in &entries {
                    if cancel.load(Ordering::Acquire) {
                        return Err(ApiError::conflict(
                            "ASSET_CANCELED",
                            "Asset preparation was canceled",
                        ));
                    }
                    let raw = self
                        .raw_limit(
                            &entry.name,
                            MAX_JSON.min(asset_journal::MAX_METADATA.saturating_sub(read_bytes)),
                        )?
                        .ok_or_else(changed)?;
                    read_bytes = read_bytes.saturating_add(raw.bytes.len() as u64);
                    if read_bytes > asset_journal::MAX_METADATA {
                        return Err(ApiError::invalid(
                            "Native folder removal exceeds its 16 MiB metadata read budget",
                        ));
                    }
                    let mut asset = asset_payload::parse(&raw.bytes)?;
                    if asset.folder.as_deref() == Some(id) {
                        affected += 1;
                        if affected > asset_journal::MAX_AFFECTED {
                            return Err(ApiError::invalid(
                                "Native folder removal affects more than 128 assets",
                            ));
                        }
                        asset.folder = parent.clone();
                        prepared.add(
                            true,
                            entry.name.clone(),
                            Some(Before {
                                identity: raw.identity,
                                sha256: raw.revision,
                            }),
                            &serde_json::to_vec_pretty(&asset).map_err(|_| ApiError::io())?,
                        )?;
                    }
                }
                prepared.roster(entries);
            }
            Edit::MoveAssets { items, folder, .. } => {
                if items.is_empty() || items.len() > 64 {
                    return Err(ApiError::invalid(
                        "Choose between 1 and 64 native assets to move",
                    ));
                }
                if let Some(id) = folder {
                    tree.path(id)?;
                }
                let mut ids = std::collections::HashSet::new();
                for item in items {
                    if !ids.insert(&item.id) {
                        return Err(ApiError::invalid("Native asset move IDs must be unique"));
                    }
                    if cancel.load(Ordering::Acquire) {
                        return Err(ApiError::conflict(
                            "ASSET_CANCELED",
                            "Asset preparation was canceled",
                        ));
                    }
                    let file_name = name(&item.id, false)?;
                    let raw = self
                        .raw_limit(
                            &file_name,
                            MAX_JSON.min(asset_journal::MAX_METADATA.saturating_sub(read_bytes)),
                        )?
                        .ok_or_else(ApiError::missing)?;
                    read_bytes = read_bytes.saturating_add(raw.bytes.len() as u64);
                    if raw.revision != item.revision {
                        return Err(changed());
                    }
                    if read_bytes > asset_journal::MAX_METADATA {
                        return Err(ApiError::invalid(
                            "Native asset moves exceed their 16 MiB metadata read budget",
                        ));
                    }
                    prepared.guard(
                        true,
                        file_name.clone(),
                        Some(Before {
                            identity: raw.identity.clone(),
                            sha256: raw.revision.clone(),
                        }),
                    );
                    let mut asset = asset_payload::parse(&raw.bytes)?;
                    if &asset.folder != folder {
                        affected += 1;
                        asset.folder = folder.clone();
                        prepared.add(
                            true,
                            file_name,
                            Some(Before {
                                identity: raw.identity,
                                sha256: raw.revision,
                            }),
                            &serde_json::to_vec_pretty(&asset).map_err(|_| ApiError::io())?,
                        )?;
                    }
                }
            }
            _ => unreachable!(),
        }
        let folder_bytes = tree.serialize()?;
        let folder_revision = if tree_changed {
            format!("{:x}", Sha256::digest(&folder_bytes))
        } else {
            revision.clone()
        };
        prepared
            .set_summary(json!({"affected_assets":affected,"folders_revision":folder_revision}));
        if tree_changed {
            prepared.add(false, "folders.json".into(), before, &folder_bytes)?;
        }
        Ok(prepared)
    }
    pub(crate) fn commit_edit(
        &self,
        prepared: &mut PreparedEdit,
        cancel: &AtomicBool,
    ) -> Result<()> {
        let _global = self.lock()?;
        let _catalog = self.catalog_lock(true)?;
        self.validate_root()?;
        prepared.commit(&self.0.directory, &self.0.assets, cancel)?;
        self.cleanup_deleted_media(prepared.cleanup(), cancel);
        Ok(())
    }
    pub(crate) fn commit_edit_checked(
        &self,
        prepared: &mut PreparedEdit,
        cancel: &AtomicBool,
        check: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
        let _global = self.lock()?;
        let _catalog = self.catalog_lock(true)?;
        self.validate_root()?;
        check()?;
        prepared.commit(&self.0.directory, &self.0.assets, cancel)?;
        self.cleanup_deleted_media(prepared.cleanup(), cancel);
        Ok(())
    }
    fn prepare_delete(
        &self,
        items: &[AssetRef],
        archived: bool,
        mut completion: Completion,
        cancel: &AtomicBool,
    ) -> Result<PreparedEdit> {
        if items.is_empty()
            || items.len() > 32
            || items
                .iter()
                .map(|item| &item.id)
                .collect::<std::collections::HashSet<_>>()
                .len()
                != items.len()
        {
            return Err(ApiError::invalid(
                "Choose 1 to 32 unique native assets to delete",
            ));
        }
        let mut removals = Vec::new();
        let mut paths = std::collections::BTreeSet::new();
        let mut bytes = 0u64;
        for item in items {
            if cancel.load(Ordering::Acquire) {
                return Err(ApiError::conflict(
                    "ASSET_CANCELED",
                    "Asset preparation was canceled",
                ));
            }
            let filename = name(&item.id, archived)?;
            let raw = self
                .raw_limit(
                    &filename,
                    MAX_JSON.min(asset_journal::MAX_METADATA.saturating_sub(bytes)),
                )?
                .ok_or_else(ApiError::missing)?;
            bytes = bytes.saturating_add(raw.bytes.len() as u64);
            if bytes > asset_journal::MAX_METADATA || raw.revision != item.revision {
                return Err(changed());
            }
            let asset = asset_payload::parse(&raw.bytes)?;
            paths.extend(
                asset_payload::decode(&asset)?
                    .files()
                    .map(|file| file.path.clone()),
            );
            removals.push((
                filename,
                Before {
                    identity: raw.identity,
                    sha256: raw.revision,
                },
            ));
        }
        let ids = items.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
        completion.receipt["deleted_assets"] = json!(ids.len());
        completion.receipt["deleted_ids"] = json!(ids);
        let mut prepared = PreparedEdit::new(
            &self.0.directory,
            completion,
            json!({"deleted_assets":ids.len(),"deleted_ids":ids}),
        )?;
        for (name, before) in removals {
            prepared.remove(name, before)?;
        }
        if paths.len() <= 64 {
            let cleanup = paths
                .into_iter()
                .map(|path| {
                    let identity = self
                        .media_entry(&path)?
                        .map(|file| stable_identity(&file))
                        .transpose()?;
                    Ok(identity.map(|identity| (path, identity)))
                })
                .collect::<Result<Vec<_>>>();
            if let Ok(cleanup) = cleanup {
                prepared.set_cleanup(cleanup.into_iter().flatten().collect());
            }
        }
        Ok(prepared)
    }
    fn cleanup_deleted_media(&self, candidates: &[(PathBuf, String)], cancel: &AtomicBool) {
        if candidates.is_empty() {
            return;
        }
        let retained = (|| -> Result<std::collections::HashSet<PathBuf>> {
            let mut retained = std::collections::HashSet::new();
            let mut bytes = 0u64;
            for (index, entry) in
                std::fs::read_dir(format!("/proc/self/fd/{}", self.0.assets.as_raw_fd()))
                    .map_err(|_| ApiError::io())?
                    .enumerate()
            {
                if index >= 10000 || cancel.load(Ordering::Acquire) {
                    return Err(changed());
                }
                let name = entry
                    .map_err(|_| ApiError::io())?
                    .file_name()
                    .into_string()
                    .map_err(|_| changed())?;
                if !name.ends_with(".json")
                    && !name.ends_with(".json.deleted")
                    && !name.ends_with(".json.bak")
                    && !name.ends_with(".json.deleted.bak")
                {
                    continue;
                }
                let raw = self
                    .raw_limit(
                        &name,
                        MAX_JSON.min(asset_journal::MAX_METADATA.saturating_sub(bytes)),
                    )?
                    .ok_or_else(changed)?;
                bytes = bytes.saturating_add(raw.bytes.len() as u64);
                if bytes > asset_journal::MAX_METADATA {
                    return Err(changed());
                }
                let asset = asset_payload::parse(&raw.bytes)?;
                for file in asset_payload::decode(&asset)?.files() {
                    if retained.contains(&file.path) {
                        continue;
                    }
                    if retained.len() >= 4096 {
                        return Err(changed());
                    }
                    self.media_entry(&file.path)?;
                    retained.insert(file.path.clone());
                }
            }
            Ok(retained)
        })();
        let Ok(retained) = retained else {
            return;
        };
        for (path, identity) in candidates {
            if cancel.load(Ordering::Acquire) {
                return;
            }
            if retained.contains(path) {
                continue;
            }
            let _ = (|| -> Result<()> {
                self.validate_root()?;
                let file = self.media_entry(path)?.ok_or_else(changed)?;
                if stable_identity(&file)? != *identity {
                    return Err(changed());
                }
                let parent = path
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    .ok_or_else(changed)?;
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(changed)?;
                let directory = File::from(
                    openat(
                        &self.0.media,
                        parent,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| changed())?,
                );
                let pinned = directory.metadata().map_err(|_| ApiError::io())?;
                let live = File::from(
                    openat(
                        &self.0.media,
                        parent,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| changed())?,
                );
                let current = live.metadata().map_err(|_| ApiError::io())?;
                if (pinned.dev(), pinned.ino()) != (current.dev(), current.ino())
                    || stable_identity(&regular(&directory, name)?)? != *identity
                {
                    return Err(changed());
                }
                unlinkat(&directory, name, AtFlags::empty()).map_err(|_| ApiError::io())?;
                directory.sync_all().map_err(|_| ApiError::io())
            })();
        }
    }
    pub(crate) fn prepare_relink(
        &self,
        edit: &Edit,
        remap: &std::collections::BTreeMap<PathBuf, RelinkedFile>,
        original_missing: &std::collections::HashSet<PathBuf>,
        mut completion: Completion,
        cancel: &AtomicBool,
    ) -> Result<PreparedEdit> {
        let (id, revision, replace_content) = match edit {
            Edit::Relink {
                id,
                revision,
                replace_content,
                ..
            }
            | Edit::RelinkFolder {
                id,
                revision,
                replace_content,
                ..
            } => (id, revision, *replace_content),
            _ => return Err(ApiError::invalid("Choose a native asset relink")),
        };
        if remap.len() > 64 {
            return Err(ApiError::invalid("Replace at most 64 native asset files"));
        }
        let _global = self.lock()?;
        let filename = name(id, false)?;
        let raw = self.checked(&filename, revision)?;
        let mut asset = asset_payload::parse(&raw.bytes)?;
        let paths: std::collections::HashSet<_> = self
            .missing_files(&asset)?
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        if remap
            .keys()
            .any(|path| !original_missing.contains(path) || !paths.contains(path))
        {
            return Err(changed());
        }
        let mut payload = asset_payload::decode(&asset)?;
        let mut rows = Vec::new();
        let mut replacements = Vec::new();
        for (old_path, file) in remap {
            if self.media_entry(&file.path)?.is_none() {
                return Err(changed());
            }
            if replace_content {
                let mut media = Vec::new();
                for (media_id, item) in &payload.fragment().media_pool {
                    if item.compound.is_none() && item.path == *old_path {
                        if replacements.len() >= 4096 {
                            return Err(ApiError::invalid(
                                "Replacement affects more than 4096 native media records",
                            ));
                        }
                        media.push(json!({"media_id":media_id.raw().to_string(),"before":{"content_hash":item.content_hash.to_string(),"meta":item.meta}}));
                        replacements.push((
                            media_id,
                            file.path.clone(),
                            file.content_hash,
                            file.meta.clone(),
                        ));
                    }
                }
                if media.is_empty() {
                    return Err(changed());
                }
                let file_name = old_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(ApiError::missing)?;
                rows.push(json!({"file_name":crate::asset_jobs::original_media_name(file_name),"source_token":file.source_token,
                    "media":media,"after":{"content_hash":file.content_hash.to_string(),"meta":file.meta}}));
            }
        }
        if replace_content && !payload.relink_files(&replacements) {
            return Err(ApiError::invalid("Native replacement targets changed"));
        }
        if !replace_content {
            for item in payload.files_mut() {
                if let Some(file) = remap.get(&item.path) {
                    item.path = file.path.clone();
                }
            }
        }
        asset.payload = payload.to_text();
        asset_payload::decode(&asset)?;
        let remaining = self
            .missing_files(&asset)?
            .iter()
            .filter(|(_, missing)| *missing)
            .count();
        completion.receipt["missing_count"] = json!(remaining);
        completion.receipt["relinked_files"] = json!(remap.len());
        let mut summary = json!({"asset_id":id,"revision":revision,"missing_count":remaining,"relinked_files":remap.len()});
        if replace_content {
            let digest = format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&rows).map_err(|_| ApiError::io())?)
            );
            completion.receipt["replace_content"] = json!(true);
            completion.receipt["replaced_files"] = json!(remap.len());
            completion.receipt["replacement_digest"] = json!(digest);
            summary["replace_content"] = json!(true);
            summary["replaced_files"] = json!(remap.len());
            summary["replacement_digest"] = json!(digest);
            summary["replacements"] = json!(rows);
        }
        if serde_json::to_vec(&summary)
            .map_err(|_| ApiError::io())?
            .len()
            > asset_payload::MAX_ASSET_BYTES
        {
            return Err(ApiError::invalid("Replacement report exceeds 4 MiB"));
        }
        let mut prepared = PreparedEdit::new(&self.0.directory, completion, summary)?;
        let before = Some(Before {
            identity: raw.identity.clone(),
            sha256: raw.revision.clone(),
        });
        if remap.is_empty() {
            prepared.guard(true, filename, before);
        } else {
            let backup_name = format!("{filename}.bak");
            let backup = self.raw(&backup_name)?;
            prepared.add(
                true,
                backup_name,
                backup.map(|raw| Before {
                    identity: raw.identity,
                    sha256: raw.revision,
                }),
                &raw.bytes,
            )?;
            prepared.add(
                true,
                filename,
                before,
                &serde_json::to_vec_pretty(&asset).map_err(|_| ApiError::io())?,
            )?;
        }
        if cancel.load(Ordering::Acquire) {
            return Err(ApiError::conflict(
                "ASSET_CANCELED",
                "Asset preparation was canceled",
            ));
        }
        Ok(prepared)
    }
    pub(crate) fn plan_import_tree(
        &self,
        edit: &Edit,
        source: &vv_session::MediaTree,
        command_id: &str,
        cancel: &AtomicBool,
    ) -> Result<TreeImportPlan> {
        let Edit::ImportTree {
            parent,
            folders_revision,
            ..
        } = edit
        else {
            return Err(ApiError::invalid("Choose a native folder import"));
        };
        let _global = self.lock()?;
        let (mut tree, revision, before) = self.folders_raw()?;
        if folders_revision != &revision {
            return Err(ApiError::conflict(
                "FOLDERS_CHANGED",
                "Native asset folders changed; refresh before importing",
            ));
        }
        if let Some(parent) = parent {
            tree.path(parent)?;
        }
        let roster = asset_journal::active_roster(&self.0.assets)?;
        let mut present = std::collections::HashSet::new();
        let mut bytes = 0_u64;
        for entry in &roster {
            if cancel.load(Ordering::Acquire) {
                return Err(ApiError::conflict(
                    "ASSET_CANCELED",
                    "Asset preparation was canceled",
                ));
            }
            let raw = self
                .raw_limit(
                    &entry.name,
                    MAX_JSON.min(asset_journal::MAX_METADATA.saturating_sub(bytes)),
                )?
                .ok_or_else(changed)?;
            bytes = bytes.saturating_add(raw.bytes.len() as u64);
            let asset = asset_payload::parse(&raw.bytes)?;
            let payload = asset_payload::decode(&asset)?;
            let id = payload
                .media_ids()
                .first()
                .ok_or_else(|| ApiError::invalid("Native asset has no pool item"))?;
            let item = payload.fragment().media_pool.get(*id).ok_or_else(changed)?;
            present.insert((item.content_hash, asset.folder));
        }
        let original_count = tree.folders.len();
        let prefix = format!("tree-{:x}", Sha256::digest(command_id.as_bytes()));
        let mut folders: Vec<Option<String>> = Vec::new();
        for (index, (label, source_parent)) in source.folders.iter().enumerate() {
            let parent = match source_parent {
                Some(parent) => folders
                    .get(*parent)
                    .cloned()
                    .ok_or_else(|| ApiError::invalid("Invalid native import folder order"))?,
                None => parent.clone(),
            };
            let id = if let Some(folder) = tree
                .folders
                .iter()
                .find(|folder| folder.name == *label && folder.parent == parent)
            {
                folder.id.clone()
            } else {
                let id = format!("{prefix}-f{index}");
                tree.folders.push(crate::asset_folders::Folder {
                    id: id.clone(),
                    name: label.clone(),
                    parent,
                });
                tree.validate()?;
                id
            };
            folders.push(Some(id));
        }
        let created_folders = tree.folders.len() - original_count;
        Ok(TreeImportPlan {
            tree,
            original_revision: revision,
            before,
            roster,
            folders,
            present,
            created_folders,
        })
    }
    pub(crate) fn prepare_import_tree(
        &self,
        plan: TreeImportPlan,
        assets: Vec<(String, AssetFile)>,
        skipped: usize,
        errors: Vec<Value>,
        mut completion: Completion,
        cancel: &AtomicBool,
    ) -> Result<PreparedEdit> {
        let _global = self.lock()?;
        if plan.roster.len().saturating_add(assets.len()) > 10000 {
            return Err(ApiError::invalid(
                "Native library import exceeds the 10000-asset catalog limit",
            ));
        }
        let bytes = plan.tree.serialize()?;
        let revision = if plan.created_folders == 0 {
            plan.original_revision.clone()
        } else {
            format!("{:x}", Sha256::digest(&bytes))
        };
        let summary = json!({"imported_assets":assets.len(),"skipped_files":skipped,"error_count":errors.len(),"errors":errors,"root_folder_id":plan.folders.first().cloned().flatten(),"folders_revision":revision,"created_folders":plan.created_folders});
        for key in [
            "imported_assets",
            "skipped_files",
            "error_count",
            "root_folder_id",
            "folders_revision",
            "created_folders",
        ] {
            completion.receipt[key] = summary[key].clone();
        }
        let mut prepared = PreparedEdit::new(&self.0.directory, completion, summary)?;
        prepared.roster(plan.roster);
        prepared.guard(false, "folders.json".into(), plan.before.clone());
        if plan.created_folders != 0 {
            prepared.add(false, "folders.json".into(), plan.before, &bytes)?;
        }
        for (id, asset) in assets {
            if cancel.load(Ordering::Acquire) {
                return Err(ApiError::conflict(
                    "ASSET_CANCELED",
                    "Asset preparation was canceled",
                ));
            }
            asset_payload::decode(&asset)?;
            prepared.add(
                true,
                name(&id, false)?,
                None,
                &serde_json::to_vec_pretty(&asset).map_err(|_| ApiError::io())?,
            )?;
        }
        Ok(prepared)
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
