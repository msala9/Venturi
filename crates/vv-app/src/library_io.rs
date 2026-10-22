use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_METADATA: usize = 16 * 1024 * 1024;
const MAX_JOURNAL: usize = 32 * 1024 * 1024;
pub(super) const ASSET_PENDING: &str = ".venturi-native-assets-pending.json";
pub(super) const PRESET_PENDING: &str = ".venturi-native-presets-pending.json";
pub(crate) const AUDIO_PRESET_FILE: &str = ".venturi-audio-presets.json";
pub(crate) const AUDIO_PRESET_PENDING: &str = ".venturi-native-audio-presets-pending.json";
pub(crate) const MAX_AUDIO_PRESET_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Assets,
    Presets,
    AudioPresets,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Record {
    identity: String,
    pub bytes: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    pub path: String,
    pub before: Option<Record>,
    pub after: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    targets: Vec<Target>,
}

pub(super) struct Directory {
    file: File,
    path: PathBuf,
}

fn changed() -> String {
    "Library changed; refresh it before editing again".into()
}
fn busy() -> String {
    "Library is busy or needs transaction recovery; refresh and retry".into()
}
fn error(error: std::io::Error) -> String {
    format!("Library I/O: {error}")
}

fn options(directory: bool) -> OpenOptions {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(
            libc::O_NOFOLLOW
                | libc::O_NONBLOCK
                | libc::O_CLOEXEC
                | if directory { libc::O_DIRECTORY } else { 0 },
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000 | if directory { 0x0200_0000 } else { 0 });
    }
    options
}

fn identity(file: &File) -> Result<String, String> {
    let meta = file.metadata().map_err(error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(format!(
            "{}:{}:{}:{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        ))
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(format!(
            "{:?}:{:?}:{}:{}:{}",
            meta.volume_serial_number(),
            meta.file_index(),
            meta.file_size(),
            meta.last_write_time(),
            meta.creation_time()
        ))
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("Library coordination is unavailable on this platform".into())
    }
}

fn same_directory(left: &File, right: &File) -> Result<(), String> {
    let a = left.metadata().map_err(error)?;
    let b = right.metadata().map_err(error)?;
    if !a.is_dir() || !b.is_dir() {
        return Err(changed());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if (a.dev(), a.ino()) != (b.dev(), b.ino()) {
            return Err(changed());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if (a.volume_serial_number(), a.file_index()) != (b.volume_serial_number(), b.file_index())
        {
            return Err(changed());
        }
    }
    Ok(())
}

impl Directory {
    fn open(path: &Path, create: bool) -> Result<Self, String> {
        if create {
            std::fs::create_dir_all(path).map_err(error)?;
        }
        if std::fs::symlink_metadata(path)
            .map_err(error)?
            .file_type()
            .is_symlink()
        {
            return Err(changed());
        }
        let file = options(true).open(path).map_err(error)?;
        let path = path.canonicalize().map_err(error)?;
        let result = Self { file, path };
        result.validate()?;
        Ok(result)
    }
    fn descriptor_path(&self) -> PathBuf {
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;
            PathBuf::from(format!("/proc/self/fd/{}", self.file.as_raw_fd()))
        }
        #[cfg(not(target_os = "linux"))]
        {
            self.path.clone()
        }
    }
    fn validate(&self) -> Result<(), String> {
        let live = options(true).open(&self.path).map_err(error)?;
        same_directory(&self.file, &live)
    }
    fn child(&self, name: &str, create: bool) -> Result<Self, String> {
        self.validate()?;
        if !matches!(
            name,
            "assets" | "presets" | "media" | ".venturi-native-library-staging"
        ) {
            return Err(changed());
        }
        Self::open(&self.descriptor_path().join(name), create)
    }
    fn duplicate(&self) -> Result<Self, String> {
        self.validate()?;
        Ok(Self {
            file: self.file.try_clone().map_err(error)?,
            path: self.path.clone(),
        })
    }
    fn read(&self, name: &str, limit: usize) -> Result<Option<Record>, String> {
        self.validate()?;
        let path = self.descriptor_path().join(name);
        let mut file = match options(false).open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(error(e)),
        };
        if !file.metadata().map_err(error)?.is_file() {
            return Err(changed());
        }
        let before = identity(&file)?;
        if file.metadata().map_err(error)?.len() > limit as u64 {
            return Err("Library metadata exceeds its bounded read budget".into());
        }
        let mut bytes = String::new();
        (&mut file)
            .take(limit as u64 + 1)
            .read_to_string(&mut bytes)
            .map_err(error)?;
        if bytes.len() > limit
            || identity(&file)? != before
            || identity(&options(false).open(path).map_err(error)?)? != before
        {
            return Err(changed());
        }
        Ok(Some(Record {
            identity: before,
            bytes,
        }))
    }
    fn marker(&self, name: &str) -> Result<bool, String> {
        match std::fs::symlink_metadata(self.descriptor_path().join(name)) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(error(e)),
        }
    }
    fn lock(&self, name: &str, shared: bool) -> Result<File, String> {
        self.validate()?;
        let file = options(false)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.descriptor_path().join(name))
            .map_err(error)?;
        if !file.metadata().map_err(error)?.is_file() {
            return Err(changed());
        }
        if shared {
            file.try_lock_shared().map_err(|_| busy())?;
        } else {
            file.try_lock().map_err(|_| busy())?;
        }
        Ok(file)
    }
    fn sync(&self) -> Result<(), String> {
        self.file.sync_all().map_err(error)
    }
    fn reserve(&self, bytes: u64) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
            // The pinned directory descriptor stays alive across the native filesystem query.
            if unsafe { libc::fstatvfs(self.file.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
                return Err(error(std::io::Error::last_os_error()));
            }
            let stat = unsafe { stat.assume_init() };
            if (stat.f_bavail as u128).saturating_mul(stat.f_frsize as u128)
                < (512 * 1024 * 1024_u128).saturating_add(bytes as u128)
            {
                return Err("Native library writes require a 512 MiB free disk reserve".into());
            }
        }
        #[cfg(not(unix))]
        {
            let _ = bytes;
        }
        Ok(())
    }
    fn atomic(&self, name: &str, bytes: &[u8], replace: bool) -> Result<(), String> {
        self.validate()?;
        self.reserve(bytes.len() as u64)?;
        let stage = self.child(".venturi-native-library-staging", true)?;
        for (index, entry) in std::fs::read_dir(stage.descriptor_path())
            .map_err(error)?
            .enumerate()
        {
            let entry = entry.map_err(error)?;
            let meta = entry.metadata().map_err(error)?;
            if index >= 7
                || !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".venturi-native-")
                || !entry.file_type().map_err(error)?.is_file()
                || meta.len() > MAX_JOURNAL as u64
            {
                return Err("Native library staging is full or contains unknown files; preserve and inspect it".into());
            }
        }
        let temp = format!(
            ".venturi-native-{}-{}.tmp",
            std::process::id(),
            super::new_id()
        );
        let temp_path = stage.descriptor_path().join(&temp);
        let mut owned = false;
        let result = (|| {
            let mut file = options(false)
                .write(true)
                .create_new(true)
                .open(&temp_path)
                .map_err(error)?;
            owned = true;
            file.write_all(bytes).map_err(error)?;
            file.sync_all().map_err(error)?;
            stage.sync()?;
            self.validate()?;
            let target = self.descriptor_path().join(name);
            if replace {
                std::fs::rename(&temp_path, target).map_err(error)?;
            } else {
                std::fs::hard_link(&temp_path, target).map_err(error)?;
            }
            self.sync()
        })();
        if owned {
            let _ = std::fs::remove_file(temp_path);
        }
        result
    }
    fn remove(&self, name: &str) -> Result<(), String> {
        self.validate()?;
        std::fs::remove_file(self.descriptor_path().join(name)).map_err(error)?;
        self.sync()
    }
}

pub(crate) struct Guard {
    directory: Directory,
    kind: Kind,
    _locks: Vec<File>,
}

impl Guard {
    pub fn snapshot(root: &Path, kind: Kind) -> Result<Self, String> {
        let directory = Directory::open(root, true)?;
        let lock = directory.lock(
            match kind {
                Kind::Assets => ".venturi-assets-catalog.lock",
                Kind::Presets => ".venturi-presets.lock",
                Kind::AudioPresets => ".venturi-audio-presets.lock",
            },
            true,
        )?;
        let result = Self {
            directory,
            kind,
            _locks: vec![lock],
        };
        if matches!(kind, Kind::Assets)
            && result.directory.marker(".venturi-assets-pending.json")?
        {
            return Err(busy());
        }
        if result.directory.marker(result.marker_name())? {
            drop(result);
            return Self::write(root, kind);
        }
        Ok(result)
    }
    pub fn write(root: &Path, kind: Kind) -> Result<Self, String> {
        let directory = Directory::open(root, true)?;
        let locks = match kind {
            Kind::Assets => vec![
                directory.lock(".venturi-assets.lock", false)?,
                directory.lock(".venturi-assets-catalog.lock", false)?,
            ],
            Kind::Presets => vec![directory.lock(".venturi-presets.lock", false)?],
            Kind::AudioPresets => vec![directory.lock(".venturi-audio-presets.lock", false)?],
        };
        let result = Self {
            directory,
            kind,
            _locks: locks,
        };
        if matches!(kind, Kind::Assets)
            && result.directory.marker(".venturi-assets-pending.json")?
        {
            return Err(busy());
        }
        result.recover()?;
        Ok(result)
    }
    fn marker_name(&self) -> &'static str {
        match self.kind {
            Kind::Assets => ASSET_PENDING,
            Kind::Presets => PRESET_PENDING,
            Kind::AudioPresets => AUDIO_PRESET_PENDING,
        }
    }
    fn target(&self, path: &str) -> Result<(Directory, String), String> {
        match self.kind {
            Kind::Assets if path == "folders.json" => {
                Ok((self.directory.duplicate()?, path.into()))
            }
            Kind::Assets => {
                let name = path.strip_prefix("assets/").ok_or_else(changed)?;
                valid_name(name)?;
                Ok((self.directory.child("assets", true)?, name.into()))
            }
            Kind::Presets => {
                valid_name(path)?;
                Ok((self.directory.duplicate()?, path.into()))
            }
            Kind::AudioPresets if path == AUDIO_PRESET_FILE => {
                Ok((self.directory.duplicate()?, path.into()))
            }
            Kind::AudioPresets => Err(changed()),
        }
    }
    pub fn read(&self, path: &str) -> Result<Option<Record>, String> {
        let (directory, name) = self.target(path)?;
        directory.read(
            &name,
            if matches!(self.kind, Kind::AudioPresets) {
                MAX_AUDIO_PRESET_BYTES
            } else {
                MAX_BYTES
            },
        )
    }
    pub fn records(&self, archived: bool) -> Result<Vec<(String, Record)>, String> {
        let directory = match self.kind {
            Kind::Assets => self.directory.child("assets", true)?,
            Kind::Presets => self.directory.duplicate()?,
            Kind::AudioPresets => return Err("Use the single audio preset catalog".into()),
        };
        let mut result = Vec::new();
        let mut total = 0;
        for (count, entry) in std::fs::read_dir(directory.descriptor_path())
            .map_err(error)?
            .enumerate()
        {
            if count >= 10000 {
                return Err("Library browsing is limited to 10000 directory entries".into());
            }
            let name = entry
                .map_err(error)?
                .file_name()
                .to_string_lossy()
                .into_owned();
            if name.starts_with('.') {
                continue;
            }
            if !(name.ends_with(".json")
                || archived && (name.ends_with(".json.deleted") || name.ends_with(".json.bak")))
            {
                continue;
            }
            valid_name(&name)?;
            let Some(record) = directory.read(&name, MAX_BYTES)? else {
                return Err(changed());
            };
            total += record.bytes.len();
            if total > MAX_METADATA {
                return Err("Library reads are limited to 16 MiB of metadata".into());
            }
            result.push((name, record));
        }
        result.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(result)
    }
    pub fn commit(&self, targets: Vec<Target>) -> Result<(), String> {
        if targets.is_empty() {
            return Ok(());
        }
        let mut journal = Journal {
            version: 1,
            targets,
        };
        self.validate_journal(&journal)?;
        for target in &journal.targets {
            if self.read(&target.path)? != target.before {
                return Err(changed());
            }
        }
        journal
            .targets
            .retain(|target| target.before.as_ref().map(|r| &r.bytes) != target.after.as_ref());
        if journal.targets.is_empty() {
            return Ok(());
        }
        let mut writer = LimitedBytes(Vec::new());
        serde_json::to_writer(&mut writer, &journal).map_err(|e| e.to_string())?;
        self.directory
            .atomic(self.marker_name(), &writer.0, false)?;
        self.recover()
    }
    fn validate_journal(&self, journal: &Journal) -> Result<(), String> {
        let mut names = HashSet::new();
        let mut total = 0usize;
        if journal.version != 1 || journal.targets.is_empty() || journal.targets.len() > 129 {
            return Err(changed());
        }
        for target in &journal.targets {
            self.target(&target.path)?;
            if !names.insert(&target.path) {
                return Err(changed());
            }
            for bytes in target
                .before
                .as_ref()
                .map(|r| &r.bytes)
                .into_iter()
                .chain(target.after.iter())
            {
                let limit = if matches!(self.kind, Kind::AudioPresets) {
                    MAX_AUDIO_PRESET_BYTES
                } else {
                    MAX_BYTES
                };
                if bytes.len() > limit {
                    return Err(if matches!(self.kind, Kind::AudioPresets) {
                        "Audio presets are limited to 1 MiB".into()
                    } else {
                        "Native library entries are limited to 4 MiB".into()
                    });
                }
                total = total.saturating_add(bytes.len());
                if total > MAX_METADATA {
                    return Err("Library transactions are limited to 16 MiB of metadata".into());
                }
            }
        }
        Ok(())
    }
    fn recover(&self) -> Result<(), String> {
        let Some(raw) = self.directory.read(self.marker_name(), MAX_JOURNAL)? else {
            return Ok(());
        };
        let journal: Journal = serde_json::from_str(&raw.bytes).map_err(|_| changed())?;
        self.validate_journal(&journal)?;
        // Check every witness before applying any remaining record.
        for target in &journal.targets {
            let current = self.read(&target.path)?;
            if current != target.before
                && current.as_ref().map(|r| &r.bytes) != target.after.as_ref()
            {
                return Err(changed());
            }
        }
        for target in &journal.targets {
            let current = self.read(&target.path)?;
            if current.as_ref().map(|r| &r.bytes) == target.after.as_ref() {
                continue;
            }
            if current != target.before {
                return Err(changed());
            }
            let (directory, name) = self.target(&target.path)?;
            match &target.after {
                Some(bytes) => directory.atomic(&name, bytes.as_bytes(), current.is_some())?,
                None => directory.remove(&name)?,
            }
        }
        if self.directory.read(self.marker_name(), MAX_JOURNAL)? != Some(raw) {
            return Err(changed());
        }
        self.directory.remove(self.marker_name())
    }
}

fn valid_name(name: &str) -> Result<(), String> {
    let id = name
        .strip_suffix(".json.deleted")
        .or_else(|| name.strip_suffix(".json.bak"))
        .or_else(|| name.strip_suffix(".json"))
        .ok_or_else(changed)?;
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(changed());
    }
    Ok(())
}

fn media_directory(root: &Path, path: &Path) -> Result<(Directory, String), String> {
    let relative = path
        .strip_prefix(root.join("media"))
        .map_err(|_| changed())?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 2
        || parts
            .iter()
            .any(|p| !matches!(p, std::path::Component::Normal(_)))
    {
        return Err(changed());
    }
    let hash = parts[0].as_os_str().to_str().ok_or_else(changed)?;
    let name = parts[1].as_os_str().to_str().ok_or_else(changed)?;
    if ![16, 64].contains(&hash.len())
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(changed());
    }
    let root = Directory::open(root, false)?;
    let media = root.child("media", false)?;
    let directory = Directory::open(&media.descriptor_path().join(hash), false)?;
    Ok((directory, name.into()))
}

pub(super) fn remove_media(root: &Path, path: &Path) -> Result<(), String> {
    let (directory, name) = media_directory(root, path)?;
    let file = options(false)
        .open(directory.descriptor_path().join(&name))
        .map_err(error)?;
    if !file.metadata().map_err(error)?.is_file() {
        return Err(changed());
    }
    directory.remove(&name)
}

pub(super) fn validate_media_reference(root: &Path, path: &Path) -> Result<(), String> {
    let (directory, name) = media_directory(root, path)?;
    let file = options(false)
        .open(directory.descriptor_path().join(name))
        .map_err(error)?;
    if !file.metadata().map_err(error)?.is_file() {
        return Err(changed());
    }
    Ok(())
}

pub(super) fn copy_media(
    root: &Path,
    source: &Path,
    hash: u64,
    name: &str,
) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err(changed());
    }
    let root_dir = Directory::open(root, false)?;
    let media = root_dir.child("media", true)?;
    let directory = Directory::open(&media.descriptor_path().join(format!("{hash:016x}")), true)?;
    let final_path = directory.path.join(name);
    let mut input = options(false).open(source).map_err(error)?;
    if !input.metadata().map_err(error)?.is_file() {
        return Err(changed());
    }
    let original = identity(&input)?;
    match options(false).open(directory.descriptor_path().join(name)) {
        Ok(mut existing) => {
            if !existing.metadata().map_err(error)?.is_file()
                || existing.metadata().map_err(error)?.len()
                    != input.metadata().map_err(error)?.len()
            {
                return Err(changed());
            }
            let previous = identity(&existing)?;
            let (mut a, mut b) = (vec![0; 1024 * 1024], vec![0; 1024 * 1024]);
            loop {
                let count = input.read(&mut a).map_err(error)?;
                existing.read_exact(&mut b[..count]).map_err(error)?;
                if a[..count] != b[..count] {
                    return Err(
                        "Existing native library media has different bytes and was preserved"
                            .into(),
                    );
                }
                if count == 0 {
                    break;
                }
            }
            if identity(&input)? != original
                || identity(&existing)? != previous
                || identity(&options(false).open(source).map_err(error)?)? != original
                || identity(
                    &options(false)
                        .open(directory.descriptor_path().join(name))
                        .map_err(error)?,
                )? != previous
            {
                return Err(changed());
            }
            return Ok(final_path);
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(error(e)),
    }
    let partial = format!(".{name}.partial");
    root_dir.reserve(input.metadata().map_err(error)?.len())?;
    let partial_path = directory.descriptor_path().join(&partial);
    let mut output = options(false)
        .write(true)
        .create_new(true)
        .open(&partial_path)
        .map_err(error)?;
    let result = (|| {
        let mut buffer = vec![0; 1024 * 1024];
        loop {
            let count = input.read(&mut buffer).map_err(error)?;
            if count == 0 {
                break;
            }
            output.write_all(&buffer[..count]).map_err(error)?;
        }
        output.sync_all().map_err(error)?;
        if identity(&input)? != original
            || identity(&options(false).open(source).map_err(error)?)? != original
        {
            return Err(changed());
        }
        directory.validate()?;
        root_dir.validate()?;
        std::fs::hard_link(&partial_path, directory.descriptor_path().join(name)).map_err(error)?;
        directory.sync()?;
        Ok(final_path)
    })();
    let _ = std::fs::remove_file(partial_path);
    result
}

struct LimitedBytes(Vec<u8>);
impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_JOURNAL.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other(
                "Library recovery journal exceeds 32 MiB",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/library_io.rs"]
mod tests;
