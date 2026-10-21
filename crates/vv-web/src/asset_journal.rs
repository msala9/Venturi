use crate::{
    asset_store::{self, regular, stable_identity},
    error::{ApiError, Result},
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, renameat, renameat_with, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    os::{fd::AsRawFd, unix::fs::MetadataExt},
    sync::atomic::{AtomicBool, Ordering},
};

const PENDING: &str = ".venturi-assets-pending.json";
const RECEIPTS: &str = ".venturi-asset-completions";
const MAX_MANIFEST: u64 = 4 * 1024 * 1024;
pub const MAX_METADATA: u64 = 16 * 1024 * 1024;
pub const MAX_AFFECTED: usize = 128;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Completion {
    pub version: u32,
    pub command_id: String,
    pub fingerprint: [u8; 32],
    pub project_root_binding: String,
    pub receipt: Value,
}
pub fn project_binding(directory: &File) -> Result<String> {
    let metadata = directory.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_dir() {
        return Err(ApiError::invalid(
            "Asset receipt binding requires a directory",
        ));
    }
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}
pub(crate) fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
}
fn changed() -> ApiError {
    ApiError::conflict(
        "ASSET_JOURNAL_CONFLICT",
        "Asset library changed outside its transaction; existing data and recovery journal were preserved",
    )
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Before {
    pub identity: String,
    pub sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Target {
    asset: bool,
    name: String,
    before: Option<Before>,
    stage: String,
    stage_identity: String,
    after_identity: String,
    after_sha256: String,
    bytes: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadGuard {
    asset: bool,
    name: String,
    before: Option<Before>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RosterEntry {
    pub name: String,
    pub identity: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    directory: String,
    completion: Completion,
    targets: Vec<Target>,
    guards: Vec<ReadGuard>,
    roster: Option<Vec<RosterEntry>>,
}
pub struct PreparedEdit {
    manifest: Manifest,
    stage: File,
    root: File,
    durable: bool,
    summary: Value,
}
impl PreparedEdit {
    pub(crate) fn new(root: &File, completion: Completion, summary: Value) -> Result<Self> {
        validate_completion(&completion)?;
        receipt_capacity(root, &completion)?;
        let mut stages = 0;
        for (index, entry) in std::fs::read_dir(format!("/proc/self/fd/{}", root.as_raw_fd()))
            .map_err(|_| ApiError::io())?
            .enumerate()
        {
            if index >= 10000 {
                return Err(ApiError::invalid(
                    "Native asset staging directory exceeds its browsing budget",
                ));
            }
            if entry
                .map_err(|_| ApiError::io())?
                .file_name()
                .to_string_lossy()
                .starts_with(".venturi-asset-stage-")
            {
                stages += 1;
                if stages >= 16 {
                    return Err(ApiError::conflict(
                        "ASSET_STAGE_LIMIT",
                        "Preserved native asset stages reached the 16-stage safety limit",
                    ));
                }
            }
        }
        let name = format!(".venturi-asset-stage-{}", crate::asset_jobs::nonce());
        let stage = asset_store::directory(root, &name)?;
        Ok(Self {
            manifest: Manifest {
                version: 1,
                directory: name,
                completion,
                targets: Vec::new(),
                guards: Vec::new(),
                roster: None,
            },
            stage,
            root: root.try_clone().map_err(|_| ApiError::io())?,
            durable: false,
            summary,
        })
    }
    pub fn summary(&self) -> Value {
        self.summary.clone()
    }
    pub(crate) fn set_summary(&mut self, summary: Value) {
        self.summary = summary;
    }
    pub(crate) fn roster(&mut self, roster: Vec<RosterEntry>) {
        self.manifest.roster = Some(roster);
    }
    pub(crate) fn guard(&mut self, asset: bool, name: String, before: Option<Before>) {
        self.manifest.guards.push(ReadGuard {
            asset,
            name,
            before,
        });
    }
    pub(crate) fn add(
        &mut self,
        asset: bool,
        name: String,
        before: Option<Before>,
        bytes: &[u8],
    ) -> Result<()> {
        if self.manifest.targets.len() > MAX_AFFECTED
            || self.manifest.targets.iter().map(|t| t.bytes).sum::<u64>() + bytes.len() as u64
                > MAX_METADATA
        {
            return Err(ApiError::invalid(
                "Asset folder transaction exceeds its 128-asset or 16 MiB staging budget",
            ));
        }
        let disk = rustix::fs::fstatvfs(&self.stage).map_err(|_| ApiError::io())?;
        if disk.f_bavail.saturating_mul(disk.f_frsize) < 512 * 1024 * 1024 + bytes.len() as u64 {
            return Err(ApiError::conflict(
                "ASSET_DISK_FULL",
                "Asset transactions require 512 MiB free disk reserve",
            ));
        }
        let stage = format!("after-{}.json", self.manifest.targets.len());
        let mut file = File::from(
            openat(
                &self.stage,
                stage.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        let written = (|| {
            file.write_all(bytes).map_err(|_| ApiError::io())?;
            file.sync_all().map_err(|_| ApiError::io())
        })();
        if let Err(error) = written {
            remove_owned(&self.stage, &stage, &file);
            return Err(error);
        }
        self.manifest.targets.push(Target {
            asset,
            name,
            before,
            stage,
            stage_identity: stable_identity(&file)?,
            after_identity: crate::source::file_identity(&file)?,
            after_sha256: digest(bytes),
            bytes: bytes.len() as u64,
        });
        Ok(())
    }
    pub(crate) fn commit(&mut self, root: &File, assets: &File, cancel: &AtomicBool) -> Result<()> {
        if cancel.load(Ordering::Acquire) {
            return Err(ApiError::conflict(
                "ASSET_CANCELED",
                "Asset preparation was canceled",
            ));
        }
        validate_manifest(&self.manifest)?;
        preflight(root, assets, &self.manifest, false)?;
        for target in &self.manifest.targets {
            if stable_identity(&regular(&self.stage, &target.stage)?)? != target.stage_identity {
                return Err(changed());
            }
        }
        receipt_capacity(root, &self.manifest.completion)?;
        let bytes = serde_json::to_vec(&self.manifest).map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_MANIFEST {
            return Err(ApiError::invalid("Asset folder journal exceeds 4 MiB"));
        }
        self.stage.sync_all().map_err(|_| ApiError::io())?;
        if cancel.load(Ordering::Acquire) {
            return Err(ApiError::conflict(
                "ASSET_CANCELED",
                "Asset preparation was canceled",
            ));
        }
        self.durable = true;
        if let Err(error) = atomic(root, PENDING, &bytes, false) {
            if matches!(pending(root), Ok(false)) {
                self.durable = false;
            }
            return Err(error);
        }
        let identity = stable_identity(&regular(root, PENDING)?)?;
        for target in &self.manifest.targets {
            let directory = if target.asset { assets } else { root };
            if stable_identity(&regular(&self.stage, &target.stage)?)? != target.stage_identity {
                return Err(changed());
            }
            if let Some(before) = &target.before {
                if stable_identity(&regular(directory, &target.name)?)? != before.identity {
                    return Err(changed());
                }
                renameat(
                    &self.stage,
                    target.stage.as_str(),
                    directory,
                    target.name.as_str(),
                )
                .map_err(|_| ApiError::io())?;
            } else {
                renameat_with(
                    &self.stage,
                    target.stage.as_str(),
                    directory,
                    target.name.as_str(),
                    RenameFlags::NOREPLACE,
                )
                .map_err(|_| changed())?;
            }
            directory.sync_all().map_err(|_| ApiError::io())?;
        }
        finish(root, &self.stage, &self.manifest, &identity)
    }
}
impl Drop for PreparedEdit {
    fn drop(&mut self) {
        if self.durable {
            return;
        }
        for target in &self.manifest.targets {
            if let Ok(file) = regular(&self.stage, &target.stage)
                && crate::source::file_identity(&file).ok().as_deref()
                    == Some(target.after_identity.as_str())
            {
                let _ = unlinkat(&self.stage, target.stage.as_str(), AtFlags::empty());
            }
        }
        let _ = unlinkat(
            &self.root,
            self.manifest.directory.as_str(),
            AtFlags::REMOVEDIR,
        );
    }
}
fn validate_completion(completion: &Completion) -> Result<()> {
    if completion.version != 1
        || !safe_id(&completion.command_id)
        || completion.project_root_binding.is_empty()
        || completion.project_root_binding.len() > 128
        || completion.receipt["command_id"] != completion.command_id
        || completion.receipt["status"] != "applied"
        || serde_json::to_vec(completion).map_err(|_| changed())?.len() > 4096
    {
        return Err(ApiError::invalid(
            "Invalid durable native asset command receipt",
        ));
    }
    Ok(())
}
fn validate_manifest(manifest: &Manifest) -> Result<()> {
    validate_completion(&manifest.completion)?;
    if manifest.version != 1
        || !manifest.directory.starts_with(".venturi-asset-stage-")
        || manifest.directory.len() > 100
        || !manifest
            .directory
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        || manifest.targets.len() > MAX_AFFECTED + 1
        || manifest.guards.len() > 65
        || manifest
            .targets
            .iter()
            .fold(0_u64, |sum, t| sum.saturating_add(t.bytes))
            > MAX_METADATA
        || manifest.roster.as_ref().is_some_and(|r| r.len() > 10000)
    {
        return Err(changed());
    }
    let mut names = std::collections::HashSet::new();
    for (index, target) in manifest.targets.iter().enumerate() {
        if !names.insert((target.asset, &target.name))
            || target.stage != format!("after-{index}.json")
            || target.bytes > asset_store::MAX_JSON
            || if target.asset {
                !target.name.strip_suffix(".json").is_some_and(safe_id)
            } else {
                target.name != "folders.json"
            }
        {
            return Err(changed());
        }
    }
    let mut guarded = std::collections::HashSet::new();
    for guard in &manifest.guards {
        if !guarded.insert((guard.asset, &guard.name))
            || if guard.asset {
                !guard.name.strip_suffix(".json").is_some_and(safe_id)
            } else {
                guard.name != "folders.json"
            }
        {
            return Err(changed());
        }
    }
    if let Some(roster) = &manifest.roster {
        let mut names = std::collections::HashSet::new();
        for entry in roster {
            if !entry.name.strip_suffix(".json").is_some_and(safe_id) || !names.insert(&entry.name)
            {
                return Err(changed());
            }
        }
    }
    Ok(())
}
fn read(parent: &File, name: &str, limit: u64) -> Result<Option<(File, Vec<u8>)>> {
    let fd = match openat(
        parent,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => return Err(changed()),
    };
    let file = File::from(fd);
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(changed());
    }
    let identity = stable_identity(&file)?;
    let mut bytes = Vec::new();
    (&file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() as u64 > limit
        || stable_identity(&file)? != identity
        || stable_identity(&regular(parent, name)?)? != identity
    {
        return Err(changed());
    }
    Ok(Some((file, bytes)))
}
pub(crate) fn active_roster(assets: &File) -> Result<Vec<RosterEntry>> {
    let mut result = Vec::new();
    for (index, entry) in std::fs::read_dir(format!("/proc/self/fd/{}", assets.as_raw_fd()))
        .map_err(|_| ApiError::io())?
        .enumerate()
    {
        if index >= 10000 {
            return Err(ApiError::invalid(
                "Asset folder operations are limited to 10000 directory entries",
            ));
        }
        let name = entry
            .map_err(|_| ApiError::io())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if name.strip_suffix(".json").is_some_and(safe_id) {
            result.push(RosterEntry {
                identity: stable_identity(&regular(assets, &name)?)?,
                name,
            });
        }
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}
fn preflight(root: &File, assets: &File, manifest: &Manifest, recovery: bool) -> Result<()> {
    for guard in &manifest.guards {
        if manifest
            .targets
            .iter()
            .any(|target| target.asset == guard.asset && target.name == guard.name)
        {
            continue;
        }
        let directory = if guard.asset { assets } else { root };
        match (
            &guard.before,
            openat(
                directory,
                guard.name.as_str(),
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            ),
        ) {
            (None, Err(rustix::io::Errno::NOENT)) => (),
            (Some(before), Ok(fd)) => {
                if stable_identity(&File::from(fd))? != before.identity {
                    return Err(changed());
                }
                if recovery {
                    let (_, bytes) =
                        read(directory, &guard.name, asset_store::MAX_JSON)?.ok_or_else(changed)?;
                    if digest(&bytes) != before.sha256 {
                        return Err(changed());
                    }
                }
            }
            _ => return Err(changed()),
        }
    }
    if let Some(roster) = &manifest.roster {
        let live = active_roster(assets)?;
        if live.len() != roster.len() {
            return Err(changed());
        }
        for (live, expected) in live.iter().zip(roster) {
            if live.name != expected.name {
                return Err(changed());
            }
            if live.identity != expected.identity
                && !manifest
                    .targets
                    .iter()
                    .any(|target| target.asset && target.name == live.name && recovery)
            {
                return Err(changed());
            }
        }
    }
    for target in &manifest.targets {
        let directory = if target.asset { assets } else { root };
        if !recovery {
            match (
                &target.before,
                openat(
                    directory,
                    target.name.as_str(),
                    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                    Mode::empty(),
                ),
            ) {
                (None, Err(rustix::io::Errno::NOENT)) => (),
                (Some(before), Ok(fd)) => {
                    if stable_identity(&File::from(fd))? != before.identity {
                        return Err(changed());
                    }
                }
                _ => return Err(changed()),
            }
        } else {
            state(directory, target)?;
        }
    }
    Ok(())
}
fn state(directory: &File, target: &Target) -> Result<bool> {
    let current = read(directory, &target.name, asset_store::MAX_JSON)?;
    match current {
        None if target.before.is_none() => Ok(false),
        Some((file, bytes))
            if crate::source::file_identity(&file)? == target.after_identity
                && digest(&bytes) == target.after_sha256 =>
        {
            Ok(true)
        }
        Some((file, bytes))
            if target.before.as_ref().is_some_and(|before| {
                stable_identity(&file).ok().as_deref() == Some(before.identity.as_str())
                    && digest(&bytes) == before.sha256
            }) =>
        {
            Ok(false)
        }
        _ => Err(changed()),
    }
}
pub(crate) fn pending(root: &File) -> Result<bool> {
    match openat(
        root,
        PENDING,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(fd) => {
            if !File::from(fd)
                .metadata()
                .map_err(|_| ApiError::io())?
                .is_file()
            {
                return Err(changed());
            }
            Ok(true)
        }
        Err(rustix::io::Errno::NOENT) => Ok(false),
        Err(_) => Err(changed()),
    }
}
pub(crate) fn recover(root: &File, assets: &File) -> Result<()> {
    let Some((journal, bytes)) = read(root, PENDING, MAX_MANIFEST)? else {
        return Ok(());
    };
    let identity = stable_identity(&journal)?;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| changed())?;
    validate_manifest(&manifest)?;
    let stage = File::from(
        openat(
            root,
            manifest.directory.as_str(),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| changed())?,
    );
    preflight(root, assets, &manifest, true)?;
    for target in &manifest.targets {
        let directory = if target.asset { assets } else { root };
        if state(directory, target)? {
            continue;
        }
        let (file, bytes) =
            read(&stage, &target.stage, asset_store::MAX_JSON)?.ok_or_else(changed)?;
        if crate::source::file_identity(&file)? != target.after_identity
            || digest(&bytes) != target.after_sha256
        {
            return Err(changed());
        }
        if target.before.is_some() {
            renameat(
                &stage,
                target.stage.as_str(),
                directory,
                target.name.as_str(),
            )
            .map_err(|_| ApiError::io())?;
        } else {
            renameat_with(
                &stage,
                target.stage.as_str(),
                directory,
                target.name.as_str(),
                RenameFlags::NOREPLACE,
            )
            .map_err(|_| changed())?;
        }
        directory.sync_all().map_err(|_| ApiError::io())?;
    }
    finish(root, &stage, &manifest, &identity)
}
fn finish(root: &File, stage: &File, manifest: &Manifest, identity: &str) -> Result<()> {
    persist_completion(root, &manifest.completion)?;
    if stable_identity(&regular(root, PENDING)?)? != identity {
        return Err(changed());
    }
    unlinkat(root, PENDING, AtFlags::empty()).map_err(|_| ApiError::io())?;
    root.sync_all().map_err(|_| ApiError::io())?;
    for target in &manifest.targets {
        if let Some((file, bytes)) = read(stage, &target.stage, asset_store::MAX_JSON)?
            && crate::source::file_identity(&file)? == target.after_identity
            && digest(&bytes) == target.after_sha256
        {
            unlinkat(stage, target.stage.as_str(), AtFlags::empty()).map_err(|_| ApiError::io())?;
        }
    }
    let _ = unlinkat(root, manifest.directory.as_str(), AtFlags::REMOVEDIR);
    Ok(())
}
fn atomic(directory: &File, name: &str, bytes: &[u8], replace: bool) -> Result<()> {
    let disk = rustix::fs::fstatvfs(directory).map_err(|_| ApiError::io())?;
    if disk.f_bavail.saturating_mul(disk.f_frsize) < 512 * 1024 * 1024 + bytes.len() as u64 {
        return Err(ApiError::conflict(
            "ASSET_DISK_FULL",
            "Asset transactions require 512 MiB free disk reserve",
        ));
    }
    let temp = format!(".asset-journal-{}.tmp", crate::asset_jobs::nonce());
    let mut file = File::from(
        openat(
            directory,
            temp.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ApiError::io())?,
    );
    let result = (|| {
        file.write_all(bytes).map_err(|_| ApiError::io())?;
        file.sync_all().map_err(|_| ApiError::io())?;
        if replace {
            renameat(directory, temp.as_str(), directory, name).map_err(|_| ApiError::io())?;
        } else {
            renameat_with(
                directory,
                temp.as_str(),
                directory,
                name,
                RenameFlags::NOREPLACE,
            )
            .map_err(|_| changed())?;
        }
        directory.sync_all().map_err(|_| ApiError::io())
    })();
    remove_owned(directory, &temp, &file);
    result
}
fn remove_owned(directory: &File, name: &str, file: &File) {
    if let (Ok(owned), Ok(live)) = (
        file.metadata(),
        regular(directory, name).and_then(|file| file.metadata().map_err(|_| ApiError::io())),
    ) && (owned.dev(), owned.ino()) == (live.dev(), live.ino())
    {
        let _ = unlinkat(directory, name, AtFlags::empty());
    }
}
fn receipt_capacity(root: &File, completion: &Completion) -> Result<()> {
    let directory = asset_store::directory(root, RECEIPTS)?;
    let mut total = 0_u64;
    let mut count = 0;
    let existing = read(&directory, &format!("{}.json", completion.command_id), 4096)?;
    if let Some((_, bytes)) = &existing {
        let old: Completion = serde_json::from_slice(bytes).map_err(|_| changed())?;
        if old.fingerprint != completion.fingerprint
            || old.project_root_binding != completion.project_root_binding
            || old.receipt != completion.receipt
        {
            return Err(ApiError::conflict(
                "COMMAND_ID_REUSED",
                "Native asset command ID was reused",
            ));
        }
    }
    for entry in std::fs::read_dir(format!("/proc/self/fd/{}", directory.as_raw_fd()))
        .map_err(|_| ApiError::io())?
    {
        count += 1;
        if count > 4096 {
            return Err(ApiError::invalid(
                "Unconfirmed asset command receipts exceed 4096 entries",
            ));
        }
        let name = entry
            .map_err(|_| ApiError::io())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        let file = regular(&directory, &name)?;
        total = total.saturating_add(file.metadata().map_err(|_| ApiError::io())?.len());
    }
    let extra = if existing.is_none() { 4096 } else { 0 };
    if count + usize::from(existing.is_none()) > 4096
        || total.saturating_add(extra) > 8 * 1024 * 1024
    {
        return Err(ApiError::invalid(
            "Unconfirmed asset command receipts exceed their 4096-entry or 8 MiB budget",
        ));
    }
    if let Some(existing) = completion_for(
        root,
        &completion.command_id,
        &completion.project_root_binding,
    )? && (existing.fingerprint != completion.fingerprint
        || existing.receipt != completion.receipt)
    {
        return Err(ApiError::conflict(
            "COMMAND_ID_REUSED",
            "Native asset command ID was reused",
        ));
    }
    Ok(())
}
fn persist_completion(root: &File, completion: &Completion) -> Result<()> {
    receipt_capacity(root, completion)?;
    let directory = asset_store::directory(root, RECEIPTS)?;
    let name = format!("{}.json", completion.command_id);
    if let Some((_, bytes)) = read(&directory, &name, 4096)? {
        let old: Completion = serde_json::from_slice(&bytes).map_err(|_| changed())?;
        if old.fingerprint == completion.fingerprint
            && old.project_root_binding == completion.project_root_binding
            && old.receipt == completion.receipt
        {
            return Ok(());
        }
        return Err(changed());
    }
    atomic(
        &directory,
        &name,
        &serde_json::to_vec(completion).map_err(|_| ApiError::io())?,
        false,
    )
}
pub(crate) fn completion_for(root: &File, id: &str, binding: &str) -> Result<Option<Completion>> {
    if !safe_id(id) {
        return Err(ApiError::invalid("Invalid native asset command ID"));
    }
    let directory = asset_store::directory(root, RECEIPTS)?;
    let Some((_, bytes)) = read(&directory, &format!("{id}.json"), 4096)? else {
        return Ok(None);
    };
    let completion: Completion = serde_json::from_slice(&bytes).map_err(|_| changed())?;
    validate_completion(&completion)?;
    if completion.command_id != id {
        return Err(changed());
    }
    Ok((completion.project_root_binding == binding).then_some(completion))
}
pub(crate) fn completions(root: &File, binding: &str) -> Result<Vec<Completion>> {
    let directory = asset_store::directory(root, RECEIPTS)?;
    let mut result = Vec::new();
    let mut total = 0_u64;
    for (index, entry) in std::fs::read_dir(format!("/proc/self/fd/{}", directory.as_raw_fd()))
        .map_err(|_| ApiError::io())?
        .enumerate()
    {
        if index >= 4096 {
            return Err(changed());
        }
        let name = entry
            .map_err(|_| ApiError::io())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        let file = regular(&directory, &name)?;
        total += file.metadata().map_err(|_| ApiError::io())?.len();
        if total > 8 * 1024 * 1024 {
            return Err(changed());
        }
        if name.starts_with(".asset-journal-") && name.ends_with(".tmp") {
            continue;
        }
        let id = name
            .strip_suffix(".json")
            .filter(|id| safe_id(id))
            .ok_or_else(changed)?;
        if let Some(completion) = completion_for(root, id, binding)? {
            result.push(completion);
        }
    }
    Ok(result)
}
pub(crate) fn acknowledge(
    root: &File,
    id: &str,
    fingerprint: [u8; 32],
    binding: &str,
) -> Result<()> {
    if let Some(completion) = completion_for(root, id, binding)? {
        if completion.fingerprint != fingerprint {
            return Err(changed());
        }
        let directory = asset_store::directory(root, RECEIPTS)?;
        unlinkat(&directory, format!("{id}.json").as_str(), AtFlags::empty())
            .map_err(|_| ApiError::io())?;
        directory.sync_all().map_err(|_| ApiError::io())?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/asset_journal.rs"]
mod tests;
