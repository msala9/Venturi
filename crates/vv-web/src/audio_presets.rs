use crate::error::{ApiError, Result};
use rustix::fs::{
    AtFlags, FlockOperation, Mode, OFlags, RenameFlags, flock, openat, renameat, renameat_with,
    statat, unlinkat,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use vv_core::{self as core, AudioEffectKind};

const FILE_NAME: &str = ".venturi-audio-presets.json";
const LOCK_NAME: &str = ".venturi-audio-presets.lock";
const NATIVE_PENDING: &str = ".venturi-native-audio-presets-pending.json";
const MAX_BYTES: u64 = 1024 * 1024;
const MAX_PRESETS: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Equalizer,
    MultibandCompressor,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Save {
        name: String,
        revision: String,
        parameters: AudioEffectKind,
    },
    Delete {
        kind: Kind,
        name: String,
        revision: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preset<P> {
    name: String,
    params: P,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeFile {
    eq_presets: Vec<Preset<core::Equalizer>>,
    compressor_presets: Vec<Preset<core::MultibandCompressor>>,
}

struct Raw {
    bytes: Vec<u8>,
    revision: String,
    identity: Option<String>,
}

pub struct Store {
    root: PathBuf,
    dir: OnceLock<File>,
}

fn changed() -> ApiError {
    ApiError::conflict(
        "AUDIO_PRESETS_CHANGED",
        "Audio presets changed; retain the draft and refresh the library",
    )
}

fn name(raw: &str) -> Result<&str> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(ApiError::invalid(
            "Choose an audio preset name of 1 to 256 bytes without control characters",
        ));
    }
    Ok(value)
}

fn revision(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ApiError::invalid(
            "Choose the current audio preset library revision",
        ));
    }
    Ok(())
}

fn kind(parameters: &AudioEffectKind) -> Result<Kind> {
    match parameters {
        AudioEffectKind::Equalizer(_) => Ok(Kind::Equalizer),
        AudioEffectKind::MultibandCompressor(_) => Ok(Kind::MultibandCompressor),
        _ => Err(ApiError::invalid(
            "Only equalizer and multiband compressor parameters can be saved as audio presets",
        )),
    }
}

fn parameters(value: &AudioEffectKind) -> Result<()> {
    kind(value)?;
    crate::audio::validate(&[core::AudioEffect::new(value.clone())])
}

fn validate_names<P>(presets: &[Preset<P>]) -> Result<()> {
    if presets.len() > MAX_PRESETS {
        return Err(ApiError::invalid(
            "At most 256 custom presets of each audio effect kind are supported",
        ));
    }
    let mut seen = HashSet::new();
    for preset in presets {
        if name(&preset.name)? != preset.name || !seen.insert(preset.name.as_str()) {
            return Err(ApiError::invalid(
                "Saved audio preset names must be trimmed and distinct within each effect kind",
            ));
        }
    }
    Ok(())
}

fn parse(raw: &Raw) -> Result<NativeFile> {
    if raw.identity.is_none() {
        return Ok(NativeFile::default());
    }
    let data: NativeFile = serde_json::from_slice(&raw.bytes).map_err(|_| {
        ApiError::invalid("Audio preset metadata is unreadable; the existing file was preserved")
    })?;
    validate_names(&data.eq_presets)?;
    validate_names(&data.compressor_presets)?;
    for preset in &data.eq_presets {
        parameters(&AudioEffectKind::Equalizer(preset.params.clone()))?;
    }
    for preset in &data.compressor_presets {
        parameters(&AudioEffectKind::MultibandCompressor(preset.params.clone()))?;
    }
    Ok(data)
}

fn same_entry(dir: &File, name: &str, file: &File) -> bool {
    let Ok(meta) = file.metadata() else {
        return false;
    };
    let Ok(entry) = statat(dir, name, AtFlags::SYMLINK_NOFOLLOW) else {
        return false;
    };
    meta.is_file() && meta.dev() == entry.st_dev && meta.ino() == entry.st_ino
}

struct Temporary<'a> {
    dir: &'a File,
    name: String,
    file: File,
    installed: bool,
}
impl<'a> Temporary<'a> {
    fn new(dir: &'a File) -> Result<Self> {
        let name = format!(".venturi-audio-presets-{}.tmp", crate::asset_jobs::nonce());
        let file = File::from(
            openat(
                dir,
                name.as_str(),
                OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        Ok(Self {
            dir,
            name,
            file,
            installed: false,
        })
    }
}
impl Drop for Temporary<'_> {
    fn drop(&mut self) {
        if !self.installed && same_entry(self.dir, &self.name, &self.file) {
            let _ = unlinkat(self.dir, self.name.as_str(), AtFlags::empty());
            let _ = self.dir.sync_all();
        }
    }
}

impl Store {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        let path = crate::media_roots::configured_path(root)?;
        let dir = crate::media_roots::open_configured(&path)?;
        Ok(Self {
            root: path,
            dir: OnceLock::from(dir),
        })
    }
    pub(crate) fn configured(root: &Path) -> std::io::Result<Self> {
        let store = Self {
            root: crate::media_roots::configured_path(root)?,
            dir: OnceLock::new(),
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
                .map_err(|_| std::io::Error::other("The configured audio preset root changed"))?;
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
    fn validate_root(&self) -> Result<()> {
        self.directory()?;
        let live = File::from(
            rustix::fs::open(
                self.root.as_path(),
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| changed())?,
        );
        crate::asset_store::same_directory(self.directory()?, &live).map_err(|_| changed())
    }

    fn lock(&self, exclusive: bool) -> Result<File> {
        self.validate_root()?;
        let file = File::from(
            openat(
                self.directory()?,
                LOCK_NAME,
                OFlags::RDWR
                    | OFlags::CREATE
                    | OFlags::NOFOLLOW
                    | OFlags::NONBLOCK
                    | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| {
                ApiError::invalid(
                    "Audio preset lock is unreadable or linked; existing files were preserved",
                )
            })?,
        );
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::invalid(
                "Audio preset lock must be a regular file",
            ));
        }
        flock(
            &file,
            if exclusive {
                FlockOperation::NonBlockingLockExclusive
            } else {
                FlockOperation::NonBlockingLockShared
            },
        )
        .map_err(|_| {
            ApiError::conflict(
                "AUDIO_PRESETS_BUSY",
                "Audio preset library is busy; retain the draft and retry",
            )
        })?;
        if !same_entry(self.directory()?, LOCK_NAME, &file) {
            return Err(changed());
        }
        self.no_native_pending()?;
        Ok(file)
    }

    fn no_native_pending(&self) -> Result<()> {
        match statat(self.directory()?, NATIVE_PENDING, AtFlags::SYMLINK_NOFOLLOW) {
            Err(rustix::io::Errno::NOENT) => Ok(()),
            _ => Err(ApiError::conflict(
                "LIBRARY_RECOVERY_REQUIRED",
                "A desktop audio preset transaction is pending; reopen the desktop library to recover it",
            )),
        }
    }

    fn raw(&self) -> Result<Raw> {
        let file = match openat(
            self.directory()?,
            FILE_NAME,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => File::from(fd),
            Err(rustix::io::Errno::NOENT) => {
                return Ok(Raw {
                    bytes: Vec::new(),
                    revision: format!("{:x}", Sha256::digest([])),
                    identity: None,
                });
            }
            Err(_) => {
                return Err(ApiError::invalid(
                    "Audio preset links and unreadable files were preserved and refused",
                ));
            }
        };
        let meta = file.metadata().map_err(|_| ApiError::io())?;
        if !meta.is_file() || meta.len() > MAX_BYTES {
            return Err(ApiError::invalid(
                "Audio preset metadata must be a regular file within 1 MiB",
            ));
        }
        let identity = crate::asset_store::stable_identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_BYTES
            || crate::asset_store::stable_identity(&file)? != identity
            || !same_entry(self.directory()?, FILE_NAME, &file)
        {
            return Err(changed());
        }
        Ok(Raw {
            revision: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            identity: Some(identity),
        })
    }

    pub fn list(&self) -> Result<Value> {
        let _lock = self.lock(false)?;
        let raw = self.raw()?;
        let data = parse(&raw)?;
        Ok(
            json!({"revision":raw.revision,"eq_presets":data.eq_presets,"compressor_presets":data.compressor_presets}),
        )
    }

    pub fn resolve(&self, target: Kind, raw_name: &str, expected: &str) -> Result<AudioEffectKind> {
        revision(expected)?;
        let selected = name(raw_name)?;
        let _lock = self.lock(false)?;
        let raw = self.raw()?;
        if raw.revision != expected {
            return Err(changed());
        }
        let data = parse(&raw)?;
        match target {
            Kind::Equalizer => data
                .eq_presets
                .into_iter()
                .find(|p| p.name == selected)
                .map(|p| AudioEffectKind::Equalizer(p.params)),
            Kind::MultibandCompressor => data
                .compressor_presets
                .into_iter()
                .find(|p| p.name == selected)
                .map(|p| AudioEffectKind::MultibandCompressor(p.params)),
        }
        .ok_or_else(ApiError::missing)
    }

    pub fn edit(&self, edit: &Edit) -> Result<()> {
        let (raw_name, expected) = match edit {
            Edit::Save { name, revision, .. } | Edit::Delete { name, revision, .. } => {
                (name, revision)
            }
        };
        revision(expected)?;
        let selected = name(raw_name)?;
        if let Edit::Save {
            parameters: value, ..
        } = edit
        {
            parameters(value)?;
        }
        let lock = self.lock(true)?;
        let raw = self.raw()?;
        if raw.revision != *expected {
            return Err(changed());
        }
        let mut data = parse(&raw)?;
        let changed = match edit {
            Edit::Save {
                parameters: AudioEffectKind::Equalizer(params),
                ..
            } => save(&mut data.eq_presets, selected, params)?,
            Edit::Save {
                parameters: AudioEffectKind::MultibandCompressor(params),
                ..
            } => save(&mut data.compressor_presets, selected, params)?,
            Edit::Save { .. } => unreachable!(),
            Edit::Delete {
                kind: Kind::Equalizer,
                ..
            } => remove(&mut data.eq_presets, selected)?,
            Edit::Delete {
                kind: Kind::MultibandCompressor,
                ..
            } => remove(&mut data.compressor_presets, selected)?,
        };
        if !changed {
            return Ok(());
        }
        let bytes = serde_json::to_vec_pretty(&data).map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(ApiError::invalid("Audio preset metadata exceeds 1 MiB"));
        }
        self.publish(&bytes, &raw, &lock)
    }

    fn publish(&self, bytes: &[u8], expected: &Raw, lock: &File) -> Result<()> {
        self.no_native_pending()?;
        let mut temp = Temporary::new(self.directory()?)?;
        temp.file.write_all(bytes).map_err(|_| ApiError::io())?;
        temp.file.sync_all().map_err(|_| ApiError::io())?;
        let temporary_identity = crate::asset_store::stable_identity(&temp.file)?;
        self.validate_root()?;
        let current = self.raw()?;
        self.validate_root()?;
        if current.identity != expected.identity
            || current.revision != expected.revision
            || !same_entry(self.directory()?, LOCK_NAME, lock)
            || !same_entry(self.directory()?, &temp.name, &temp.file)
            || crate::asset_store::stable_identity(&temp.file)? != temporary_identity
        {
            return Err(changed());
        }
        if expected.identity.is_none() {
            renameat_with(
                self.directory()?,
                temp.name.as_str(),
                self.directory()?,
                FILE_NAME,
                RenameFlags::NOREPLACE,
            )
            .map_err(|error| {
                if error == rustix::io::Errno::EXIST {
                    changed()
                } else {
                    ApiError::io()
                }
            })?;
        } else {
            renameat(
                self.directory()?,
                temp.name.as_str(),
                self.directory()?,
                FILE_NAME,
            )
            .map_err(|_| ApiError::io())?;
        }
        temp.installed = true;
        self.directory()?.sync_all().map_err(|_| ApiError::conflict("AUDIO_PRESETS_UNCERTAIN", "Audio presets changed but durability could not be confirmed; refresh before another command"))
    }
}

fn save<P: Clone + PartialEq>(
    presets: &mut Vec<Preset<P>>,
    name: &str,
    params: &P,
) -> Result<bool> {
    if let Some(existing) = presets.iter_mut().find(|p| p.name == name) {
        if existing.params == *params {
            return Ok(false);
        }
        existing.params = params.clone();
    } else {
        if presets.len() >= MAX_PRESETS {
            return Err(ApiError::invalid(
                "At most 256 custom presets of each audio effect kind are supported",
            ));
        }
        presets.push(Preset {
            name: name.into(),
            params: params.clone(),
        });
    }
    Ok(true)
}

fn remove<P>(presets: &mut Vec<Preset<P>>, name: &str) -> Result<bool> {
    let index = presets
        .iter()
        .position(|p| p.name == name)
        .ok_or_else(ApiError::missing)?;
    presets.remove(index);
    Ok(true)
}

#[cfg(test)]
#[path = "tests/audio_presets.rs"]
mod tests;
