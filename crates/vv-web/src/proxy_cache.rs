use crate::error::{ApiError, Result};
use rustix::fs::{AtFlags, FlockOperation, Mode, OFlags, RenameFlags, openat, unlinkat};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{DirBuilderExt, MetadataExt},
    },
    path::{Path, PathBuf},
    sync::Arc,
};

const CATALOG: &str = ".catalog.lock";
const LOCK: &str = ".lock";
const INTENT: &str = "intent.json";
const RECORD_TEMP: &str = "ready.tmp";
const READY: &str = "ready.json";
const MOVIE: &str = "proxy.mp4";
const MAX_RECORD: u64 = 4096;
const MAX_KEY: usize = 70 * 1024;
#[derive(Clone, Copy)]
struct Limits {
    entries: usize,
    bytes: u64,
    file: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            entries: 32,
            bytes: 2 * 1024 * 1024 * 1024,
            file: 512 * 1024 * 1024,
        }
    }
}
fn busy() -> ApiError {
    ApiError::conflict(
        "PROXY_CACHE_BUSY",
        "Native proxy cache is in use; use the original or retry later",
    )
}
fn invalid() -> ApiError {
    ApiError::conflict(
        "PROXY_CACHE_RECOVERY_REQUIRED",
        "Native proxy cache contains changed or unsupported files; they were preserved",
    )
}
fn full() -> ApiError {
    ApiError::conflict(
        "PROXY_CACHE_FULL",
        "Native proxy cache is full and its remaining entries are leased or unavailable",
    )
}
fn changed() -> ApiError {
    ApiError::conflict("SOURCE_CHANGED", "The captured native proxy entry changed")
}
fn path(file: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()))
}
fn version(file: &File) -> Result<String> {
    crate::asset_store::stable_identity(file)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileId {
    device: u64,
    inode: u64,
}
fn id(file: &File) -> Result<FileId> {
    let meta = file.metadata().map_err(|_| ApiError::io())?;
    Ok(FileId {
        device: meta.dev(),
        inode: meta.ino(),
    })
}
fn regular(directory: &File, name: &str, flags: OFlags) -> Result<File> {
    let file = File::from(
        openat(
            directory,
            name,
            flags | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| invalid())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(invalid());
    }
    Ok(file)
}
fn directory(parent: &File, name: &str) -> Result<File> {
    Ok(File::from(
        openat(
            parent,
            name,
            OFlags::RDONLY
                | OFlags::DIRECTORY
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| invalid())?,
    ))
}
fn new_file(directory: &File, name: &str) -> Result<File> {
    let file = File::from(
        openat(
            directory,
            name,
            OFlags::RDWR
                | OFlags::CREATE
                | OFlags::EXCL
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| invalid())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(invalid());
    }
    Ok(file)
}
fn logical_key(key: &str) -> Result<String> {
    if key.is_empty() || key.len() > MAX_KEY {
        return Err(ApiError::invalid(
            "A native proxy cache key must contain 1 to 70 KiB",
        ));
    }
    Ok(format!("{:x}", Sha256::digest(key.as_bytes())))
}
fn key_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    version: u32,
    key: String,
    owner: String,
    temporary: String,
    movie_id: FileId,
    record_id: FileId,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    key: String,
    bytes: u64,
    artifact_version: String,
    intent_version: String,
}
struct Captured<T> {
    value: T,
    version: String,
    id: FileId,
    bytes: u64,
}
fn read<T: DeserializeOwned>(directory: &File, name: &str) -> Result<Option<Captured<T>>> {
    let fd = match openat(
        directory,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => return Err(invalid()),
    };
    let file = File::from(fd);
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD {
        return Err(invalid());
    }
    let before = version(&file)?;
    let mut bytes = Vec::new();
    (&file)
        .take(MAX_RECORD + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() as u64 > MAX_RECORD
        || version(&file)? != before
        || version(&regular(directory, name, OFlags::RDONLY)?)? != before
    {
        return Err(invalid());
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    Ok(Some(Captured {
        value,
        version: before,
        id: id(&file)?,
        bytes: metadata.len(),
    }))
}
fn write(file: &mut File, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| invalid())?;
    if bytes.len() as u64 > MAX_RECORD {
        return Err(invalid());
    }
    file.write_all(&bytes).map_err(|_| ApiError::io())?;
    file.sync_all().map_err(|_| ApiError::io())
}

pub struct Store {
    pub path: PathBuf,
    pub directory: File,
    identity: FileId,
    limits: Limits,
}
impl Store {
    pub fn open(path: &Path) -> Result<Arc<Self>> {
        Self::open_limits(path, Limits::default())
    }
    fn open_limits(path: &Path, limits: Limits) -> Result<Arc<Self>> {
        if !path.is_absolute()
            || limits.entries == 0
            || limits.entries > 32
            || limits.file == 0
            || limits.bytes < limits.file + 2 * MAX_RECORD
        {
            return Err(invalid());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| ApiError::io())?;
        }
        match std::fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(ApiError::io()),
        }
        let file = File::from(
            rustix::fs::open(
                path,
                OFlags::RDONLY
                    | OFlags::DIRECTORY
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| invalid())?,
        );
        let store = Arc::new(Self {
            path: path.to_owned(),
            identity: id(&file)?,
            directory: file,
            limits,
        });
        store.check()?;
        Ok(store)
    }
    pub fn check(&self) -> Result<()> {
        let live = File::from(
            rustix::fs::open(
                &self.path,
                OFlags::RDONLY
                    | OFlags::DIRECTORY
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| changed())?,
        );
        if id(&self.directory)? != self.identity || id(&live)? != self.identity {
            return Err(changed());
        }
        Ok(())
    }
    fn catalog(&self, exclusive: bool) -> Result<File> {
        self.check()?;
        let file = File::from(
            openat(
                &self.directory,
                CATALOG,
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| invalid())?,
        );
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(invalid());
        }
        rustix::fs::flock(
            &file,
            if exclusive {
                FlockOperation::NonBlockingLockExclusive
            } else {
                FlockOperation::NonBlockingLockShared
            },
        )
        .map_err(|_| busy())?;
        if id(&regular(&self.directory, CATALOG, OFlags::RDONLY)?)? != id(&file)? {
            return Err(changed());
        }
        Ok(file)
    }
    fn names(&self) -> Result<Vec<String>> {
        let mut names = Vec::new();
        for (count, entry) in std::fs::read_dir(path(&self.directory))
            .map_err(|_| invalid())?
            .enumerate()
        {
            if count > self.limits.entries {
                return Err(full());
            }
            let entry = entry.map_err(|_| invalid())?;
            let name = entry.file_name().into_string().map_err(|_| invalid())?;
            let kind = entry.file_type().map_err(|_| invalid())?;
            if name == CATALOG && kind.is_file() {
                continue;
            }
            if !key_name(&name) || !kind.is_dir() || kind.is_symlink() {
                return Err(invalid());
            }
            names.push(name);
        }
        if names.len() > self.limits.entries {
            return Err(full());
        }
        names.sort();
        Ok(names)
    }
    fn entry(self: &Arc<Self>, name: &str) -> Result<Entry> {
        let directory = directory(&self.directory, name)?;
        let lock = regular(&directory, LOCK, OFlags::RDWR)?;
        let entry = Entry {
            store: self.clone(),
            name: name.into(),
            identity: id(&directory)?,
            lock_identity: id(&lock)?,
            directory,
            lock,
        };
        entry.validate()?;
        Ok(entry)
    }
    fn usage_locked(self: &Arc<Self>) -> Result<(u64, usize)> {
        let names = self.names()?;
        let mut bytes = 0u64;
        for name in &names {
            let entry = self.entry(name)?;
            match entry.flock(false) {
                Ok(()) => {}
                Err(error) if error.1 == "PROXY_CACHE_BUSY" => {
                    bytes = bytes.saturating_add(self.reservation_charge());
                    continue;
                }
                Err(error) => return Err(error),
            }
            let intent = entry.intent()?;
            let charge = if let Some(record) = entry.record(&intent)? {
                entry.roster(&intent.value, true)?;
                record
                    .value
                    .bytes
                    .saturating_add(intent.bytes)
                    .saturating_add(record.bytes)
            } else {
                entry.roster(&intent.value, false)?;
                self.reservation_charge()
            };
            bytes = bytes.saturating_add(charge);
        }
        if bytes > self.limits.bytes {
            return Err(full());
        }
        Ok((bytes, names.len()))
    }
    fn reservation_charge(&self) -> u64 {
        self.limits.file + 2 * MAX_RECORD
    }
    pub fn usage(self: &Arc<Self>) -> Result<(u64, usize)> {
        let _catalog = self.catalog(false)?;
        self.usage_locked()
    }
    pub fn lookup(self: &Arc<Self>, key: &str) -> Result<Option<Stored>> {
        match self.lookup_ready(key) {
            Err(error) if error.1 == "PROXY_CACHE_BUSY" => Ok(None),
            result => result,
        }
    }
    pub fn is_ready(self: &Arc<Self>, key: &str) -> Result<bool> {
        self.lookup_ready(key).map(|stored| stored.is_some())
    }
    fn lookup_ready(self: &Arc<Self>, key: &str) -> Result<Option<Stored>> {
        let name = logical_key(key)?;
        let catalog = self.catalog(false)?;
        if !self.names()?.contains(&name) {
            return Ok(None);
        }
        let entry = self.entry(&name)?;
        match entry.flock(false) {
            Ok(()) => {}
            Err(error) if error.1 == "PROXY_CACHE_BUSY" => return Ok(None),
            Err(error) => return Err(error),
        }
        drop(catalog);
        let intent = entry.intent()?;
        let Some(record) = entry.record(&intent)? else {
            return Ok(None);
        };
        entry.stored(intent, record).map(Some)
    }
    pub fn acquire(self: &Arc<Self>, key: &str) -> Result<Acquisition> {
        // Every entry lease is acquired under the catalog lock so eviction cannot split lock inodes.
        let name = logical_key(key)?;
        let _catalog = self.catalog(true)?;
        let names = self.names()?;
        let entry = if names.contains(&name) {
            let entry = self.entry(&name)?;
            entry.flock(false)?;
            let intent = entry.intent()?;
            if let Some(record) = entry.record(&intent)? {
                return Ok(Acquisition::Ready(entry.stored(intent, record)?));
            }
            entry.flock(true)?;
            entry.recover(&intent)?;
            entry
        } else {
            loop {
                let (bytes, count) = self.usage_locked()?;
                if count < self.limits.entries
                    && bytes.saturating_add(self.reservation_charge()) <= self.limits.bytes
                {
                    break;
                }
                let mut evicted = false;
                for candidate in self.names()? {
                    let entry = self.entry(&candidate)?;
                    match entry.flock(true) {
                        Ok(()) => {}
                        Err(error) if error.1 == "PROXY_CACHE_BUSY" => continue,
                        Err(error) => return Err(error),
                    }
                    let intent = entry.intent()?;
                    if let Some(record) = entry.record(&intent)? {
                        entry.validate_record(&intent, &record)?;
                    }
                    entry.remove(&intent)?;
                    evicted = true;
                    break;
                }
                if !evicted {
                    return Err(full());
                }
            }
            rustix::fs::mkdirat(
                &self.directory,
                name.as_str(),
                Mode::RUSR | Mode::WUSR | Mode::XUSR,
            )
            .map_err(|_| invalid())?;
            let directory = directory(&self.directory, &name)?;
            let lock = new_file(&directory, LOCK)?;
            lock.sync_all().map_err(|_| ApiError::io())?;
            let entry = Entry {
                store: self.clone(),
                name: name.clone(),
                identity: id(&directory)?,
                lock_identity: id(&lock)?,
                directory,
                lock,
            };
            entry.flock(true)?;
            entry
        };
        match entry.initialize() {
            Ok(intent) => Ok(Acquisition::Write(Reservation { entry, intent })),
            Err(error) => {
                let _ = entry.remove_empty();
                Err(error)
            }
        }
    }
}
struct Entry {
    store: Arc<Store>,
    name: String,
    directory: File,
    lock: File,
    identity: FileId,
    lock_identity: FileId,
}
impl Entry {
    fn validate(&self) -> Result<()> {
        self.store.check()?;
        let live = directory(&self.store.directory, &self.name)?;
        if id(&live)? != self.identity
            || id(&self.directory)? != self.identity
            || id(&self.lock)? != self.lock_identity
            || id(&regular(&live, LOCK, OFlags::RDONLY)?)? != self.lock_identity
        {
            return Err(changed());
        }
        Ok(())
    }
    fn flock(&self, exclusive: bool) -> Result<()> {
        self.validate()?;
        rustix::fs::flock(
            &self.lock,
            if exclusive {
                FlockOperation::NonBlockingLockExclusive
            } else {
                FlockOperation::NonBlockingLockShared
            },
        )
        .map_err(|_| busy())?;
        self.validate()
    }
    fn intent(&self) -> Result<Captured<Intent>> {
        self.validate()?;
        let intent = read::<Intent>(&self.directory, INTENT)?.ok_or_else(invalid)?;
        let value = &intent.value;
        if value.version != 1
            || value.key != self.name
            || value.owner.is_empty()
            || value.owner.len() > 64
            || !value.owner.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !temporary_name(&value.temporary)
        {
            return Err(invalid());
        }
        Ok(intent)
    }
    fn record(&self, intent: &Captured<Intent>) -> Result<Option<Captured<Record>>> {
        let Some(record) = read::<Record>(&self.directory, READY)? else {
            return Ok(None);
        };
        self.validate_record(intent, &record)?;
        Ok(Some(record))
    }
    fn validate_record(&self, intent: &Captured<Intent>, record: &Captured<Record>) -> Result<()> {
        let value = &record.value;
        if value.version != 1
            || value.key != self.name
            || record.id != intent.value.record_id
            || value.intent_version != intent.version
            || value.bytes == 0
            || value.bytes > self.store.limits.file
        {
            return Err(invalid());
        }
        let file = regular(&self.directory, MOVIE, OFlags::RDONLY)?;
        if id(&file)? != intent.value.movie_id
            || version(&file)? != value.artifact_version
            || file.metadata().map_err(|_| ApiError::io())?.len() != value.bytes
        {
            return Err(changed());
        }
        Ok(())
    }
    fn roster(&self, intent: &Intent, ready: bool) -> Result<()> {
        self.validate()?;
        for (count, entry) in std::fs::read_dir(path(&self.directory))
            .map_err(|_| invalid())?
            .enumerate()
        {
            if count >= 6 {
                return Err(invalid());
            }
            let entry = entry.map_err(|_| invalid())?;
            let name = entry.file_name().into_string().map_err(|_| invalid())?;
            let file = regular(&self.directory, &name, OFlags::RDONLY)?;
            match name.as_str() {
                LOCK => {
                    if id(&file)? != self.lock_identity
                        || file.metadata().map_err(|_| ApiError::io())?.len() != 0
                    {
                        return Err(invalid());
                    }
                }
                INTENT => {
                    if file.metadata().map_err(|_| ApiError::io())?.len() > MAX_RECORD {
                        return Err(invalid());
                    }
                }
                READY if ready => {
                    if id(&file)? != intent.record_id
                        || file.metadata().map_err(|_| ApiError::io())?.len() > MAX_RECORD
                    {
                        return Err(invalid());
                    }
                }
                MOVIE => {
                    if id(&file)? != intent.movie_id
                        || file.metadata().map_err(|_| ApiError::io())?.len()
                            > self.store.limits.file
                    {
                        return Err(invalid());
                    }
                }
                RECORD_TEMP if !ready => {
                    if id(&file)? != intent.record_id
                        || file.metadata().map_err(|_| ApiError::io())?.len() > MAX_RECORD
                    {
                        return Err(invalid());
                    }
                }
                other if !ready && other == intent.temporary => {
                    if id(&file)? != intent.movie_id
                        || file.metadata().map_err(|_| ApiError::io())?.len()
                            > self.store.limits.file
                    {
                        return Err(invalid());
                    }
                }
                _ => return Err(invalid()),
            }
        }
        Ok(())
    }
    fn unlink(&self, name: &str, expected: FileId) -> Result<()> {
        match openat(
            &self.directory,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(file) => {
                let file = File::from(file);
                if !file.metadata().map_err(|_| ApiError::io())?.is_file() || id(&file)? != expected
                {
                    return Err(invalid());
                }
                unlinkat(&self.directory, name, AtFlags::empty()).map_err(|_| ApiError::io())
            }
            Err(rustix::io::Errno::NOENT) => Ok(()),
            Err(_) => Err(invalid()),
        }
    }
    fn recover(&self, intent: &Captured<Intent>) -> Result<()> {
        self.roster(&intent.value, false)?;
        if self.intent()?.version != intent.version {
            return Err(changed());
        }
        self.unlink(&intent.value.temporary, intent.value.movie_id)?;
        self.unlink(MOVIE, intent.value.movie_id)?;
        self.unlink(RECORD_TEMP, intent.value.record_id)?;
        self.unlink(INTENT, intent.id)?;
        self.directory.sync_all().map_err(|_| ApiError::io())
    }
    fn remove(&self, intent: &Captured<Intent>) -> Result<()> {
        let ready = self.record(intent)?;
        self.roster(&intent.value, ready.is_some())?;
        if let Some(record) = ready {
            self.unlink(READY, record.id)?;
            self.unlink(MOVIE, intent.value.movie_id)?;
            self.unlink(INTENT, intent.id)?;
        } else {
            self.recover(intent)?;
        }
        self.remove_empty()
    }
    fn remove_empty(&self) -> Result<()> {
        self.validate()?;
        let mut entries = std::fs::read_dir(path(&self.directory)).map_err(|_| invalid())?;
        if entries.any(|entry| entry.map_or(true, |entry| entry.file_name() != LOCK)) {
            return Err(invalid());
        }
        self.unlink(LOCK, self.lock_identity)?;
        if id(&directory(&self.store.directory, &self.name)?)? != self.identity {
            return Err(changed());
        }
        unlinkat(
            &self.store.directory,
            self.name.as_str(),
            AtFlags::REMOVEDIR,
        )
        .map_err(|_| ApiError::io())?;
        self.store.directory.sync_all().map_err(|_| ApiError::io())
    }
    fn initialize(&self) -> Result<Captured<Intent>> {
        let temporary = format!("proxy.tmp-{}.mp4", std::process::id());
        let mut owned = Vec::new();
        let result = (|| {
            // Native encoding truncates this inode and renames it; recovery never trusts a basename alone.
            let movie = new_file(&self.directory, &temporary)?;
            let movie_id = id(&movie)?;
            owned.push((temporary.as_str(), movie_id));
            movie.sync_all().map_err(|_| ApiError::io())?;
            drop(movie);
            let record = new_file(&self.directory, RECORD_TEMP)?;
            let record_id = id(&record)?;
            owned.push((RECORD_TEMP, record_id));
            record.sync_all().map_err(|_| ApiError::io())?;
            drop(record);
            let intent = Intent {
                version: 1,
                key: self.name.clone(),
                owner: logical_key(&crate::asset_jobs::nonce())?,
                temporary: temporary.clone(),
                movie_id,
                record_id,
            };
            let mut file = new_file(&self.directory, INTENT)?;
            owned.push((INTENT, id(&file)?));
            write(&mut file, &intent)?;
            drop(file);
            self.directory.sync_all().map_err(|_| ApiError::io())?;
            self.store
                .directory
                .sync_all()
                .map_err(|_| ApiError::io())?;
            self.intent()
        })();
        if result.is_err() {
            for (name, identity) in owned.into_iter().rev() {
                let _ = self.unlink(name, identity);
            }
        }
        result
    }
    fn stored(self, intent: Captured<Intent>, record: Captured<Record>) -> Result<Stored> {
        self.validate_record(&intent, &record)?;
        self.roster(&intent.value, true)?;
        let file = regular(&self.directory, MOVIE, OFlags::RDONLY)?;
        let stored = Stored {
            version: record.value.artifact_version.clone(),
            bytes: record.value.bytes,
            file,
            entry: self,
            intent_version: intent.version,
            record_version: record.version,
        };
        stored.validate()?;
        Ok(stored)
    }
}
fn temporary_name(name: &str) -> bool {
    name.strip_prefix("proxy.tmp-")
        .and_then(|name| name.strip_suffix(".mp4"))
        .is_some_and(|pid| {
            !pid.is_empty() && pid.len() <= 20 && pid.bytes().all(|byte| byte.is_ascii_digit())
        })
}

pub enum Acquisition {
    Ready(Stored),
    Write(Reservation),
}
pub struct Stored {
    pub file: File,
    pub version: String,
    pub bytes: u64,
    entry: Entry,
    intent_version: String,
    record_version: String,
}
impl Stored {
    pub fn validate(&self) -> Result<()> {
        self.entry.validate()?;
        let intent = self.entry.intent()?;
        let record = self.entry.record(&intent)?.ok_or_else(changed)?;
        if intent.version != self.intent_version
            || record.version != self.record_version
            || version(&self.file)? != self.version
            || id(&self.file)? != intent.value.movie_id
            || self.file.metadata().map_err(|_| ApiError::io())?.len() != self.bytes
        {
            return Err(changed());
        }
        self.entry.roster(&intent.value, true)
    }
}
pub struct Reservation {
    entry: Entry,
    intent: Captured<Intent>,
}
impl Reservation {
    pub fn output(&self) -> PathBuf {
        path(&self.entry.directory).join(MOVIE)
    }
    pub fn directory(&self) -> &File {
        &self.entry.directory
    }
    pub fn validate(&self) -> Result<()> {
        self.entry.validate()?;
        if self.entry.intent()?.version != self.intent.version {
            return Err(changed());
        }
        self.entry.roster(&self.intent.value, false)
    }
    pub fn publish(self) -> Result<Stored> {
        self.validate()?;
        if read::<Record>(&self.entry.directory, READY)?.is_some() {
            return Err(invalid());
        }
        let file = regular(&self.entry.directory, MOVIE, OFlags::RDONLY)?;
        let metadata = file.metadata().map_err(|_| ApiError::io())?;
        if id(&file)? != self.intent.value.movie_id
            || metadata.len() == 0
            || metadata.len() > self.entry.store.limits.file
        {
            return Err(invalid());
        }
        file.sync_all().map_err(|_| ApiError::io())?;
        let record = Record {
            version: 1,
            key: self.entry.name.clone(),
            bytes: metadata.len(),
            artifact_version: version(&file)?,
            intent_version: self.intent.version.clone(),
        };
        let mut temporary = regular(&self.entry.directory, RECORD_TEMP, OFlags::RDWR)?;
        if id(&temporary)? != self.intent.value.record_id {
            return Err(invalid());
        }
        temporary.set_len(0).map_err(|_| ApiError::io())?;
        write(&mut temporary, &record)?;
        drop(temporary);
        self.validate()?;
        if version(&file)? != record.artifact_version {
            return Err(changed());
        }
        rustix::fs::renameat_with(
            &self.entry.directory,
            RECORD_TEMP,
            &self.entry.directory,
            READY,
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| invalid())?;
        self.entry
            .directory
            .sync_all()
            .map_err(|_| ApiError::io())?;
        let catalog = self.entry.store.catalog(false)?;
        self.entry.flock(false)?;
        let ready = self.entry.record(&self.intent)?.ok_or_else(invalid)?;
        drop(catalog);
        self.entry.stored(self.intent, ready)
    }
}

#[cfg(test)]
#[path = "tests/proxy_cache.rs"]
mod tests;
