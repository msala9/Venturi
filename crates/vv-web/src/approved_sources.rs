use crate::error::{ApiError, Result};
use rustix::fs::{Mode, OFlags, openat};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs::File,
    os::{fd::AsRawFd, unix::fs::MetadataExt},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

const MAX_DEPTH: usize = 16;
const MAX_ENTRIES: usize = 4096;
const MAX_DIRECTORIES: usize = 128;
const MAX_MEDIA: usize = 64;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcesQuery {
    pub project_epoch: String,
    #[serde(default)]
    pub directory_token: String,
    #[serde(default)]
    pub page: usize,
}

fn changed() -> ApiError {
    ApiError::conflict(
        "SOURCE_CHANGED",
        "Approved source directory changed; refresh the source browser",
    )
}
fn canceled() -> ApiError {
    ApiError::conflict("SOURCE_CANCELED", "Approved source scan was canceled")
}
fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        return Err(canceled());
    }
    Ok(())
}

fn parts(token: &str, directory: bool) -> Result<Vec<&str>> {
    if directory && token.is_empty() {
        return Ok(Vec::new());
    }
    if token.is_empty()
        || token.len() > 1024
        || token.contains('\\')
        || token.chars().any(char::is_control)
    {
        return Err(ApiError::invalid(
            "Choose an exact UTF-8 root-relative source token of at most 1024 bytes",
        ));
    }
    let parts: Vec<_> = token.split('/').collect();
    let depth = parts.len() - usize::from(!directory);
    if depth > MAX_DEPTH
        || parts
            .iter()
            .any(|part| part.is_empty() || *part == "." || *part == ".." || part.len() > 128)
    {
        return Err(ApiError::invalid(
            "Approved source paths require normal components and at most 16 directory levels",
        ));
    }
    if !directory && parts.first() == Some(&"Pasted Images") {
        if parts.len() != 2 {
            return Err(ApiError::invalid(
                "Native pasted images require their exact managed directory",
            ));
        }
        crate::clipboard_image::validate_filename(parts[1])?;
    } else if parts.iter().any(|part| part.starts_with('.')) {
        return Err(ApiError::invalid("Hidden source paths are not approved"));
    }
    if directory && parts.len() > 1 && parts[0] == "Pasted Images" {
        return Err(ApiError::invalid(
            "Native pasted images do not contain approved subdirectories",
        ));
    }
    Ok(parts)
}

pub(crate) fn validate_media_token(token: &str) -> Result<()> {
    parts(token, false).map(|_| ())
}

fn validate_root(root: &Path, dir: &File) -> Result<()> {
    let live = File::from(
        rustix::fs::open(
            root,
            OFlags::RDONLY
                | OFlags::DIRECTORY
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| changed())?,
    );
    crate::asset_store::same_directory(dir, &live).map_err(|_| changed())
}

fn directory_id(file: &File) -> Result<String> {
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_dir() {
        return Err(changed());
    }
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}

struct Parent {
    directory: Option<File>,
    lineage: String,
}

fn walk(root: &Path, dir: &File, names: &[&str]) -> Result<Parent> {
    validate_root(root, dir)?;
    let mut directory = dir.try_clone().map_err(|_| ApiError::io())?;
    let mut lineage = directory_id(&directory)?;
    for (index, name) in names.iter().enumerate() {
        match openat(
            &directory,
            *name,
            OFlags::RDONLY
                | OFlags::DIRECTORY
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(file) => {
                directory = File::from(file);
                lineage.push_str(&format!("/{}", directory_id(&directory)?));
            }
            Err(rustix::io::Errno::NOENT) => {
                validate_root(root, dir)?;
                return Ok(Parent {
                    directory: None,
                    lineage: format!("{lineage}/absent:{index}"),
                });
            }
            Err(_) => {
                return Err(ApiError::invalid(
                    "Source parents must be approved directories without links",
                ));
            }
        }
    }
    Ok(Parent {
        directory: Some(directory),
        lineage,
    })
}

pub(crate) fn source_entry(
    root: &Path,
    dir: &File,
    token: &str,
) -> Result<(Option<std::fs::Metadata>, Option<String>)> {
    let names = parts(token, false)?;
    let parents = &names[..names.len() - 1];
    let parent = walk(root, dir, parents)?;
    let lineage = (!parents.is_empty()).then(|| parent.lineage.clone());
    let metadata = if let Some(directory) = parent.directory {
        match std::fs::symlink_metadata(
            PathBuf::from(format!("/proc/self/fd/{}", directory.as_raw_fd()))
                .join(names[names.len() - 1]),
        ) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                Some(metadata)
            }
            Ok(_) => {
                return Err(ApiError::invalid(
                    "Source links and special files are refused",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(ApiError::io()),
        }
    } else {
        None
    };
    if walk(root, dir, parents)?.lineage != parent.lineage {
        return Err(changed());
    }
    Ok((metadata, lineage))
}

pub(crate) fn open_media(root: &Path, dir: &File, token: &str) -> Result<File> {
    let names = parts(token, false)?;
    let parents = &names[..names.len() - 1];
    let parent = walk(root, dir, parents)?;
    let directory = parent.directory.ok_or_else(ApiError::missing)?;
    let name = names[names.len() - 1];
    let file = File::from(
        openat(
            &directory,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::invalid("Media must be a regular file"));
    }
    let live = walk(root, dir, parents)?;
    if parent.lineage != live.lineage {
        return Err(changed());
    }
    let current = File::from(
        openat(
            live.directory.ok_or_else(changed)?,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| changed())?,
    );
    if crate::asset_store::stable_identity(&file)? != crate::asset_store::stable_identity(&current)?
    {
        return Err(changed());
    }
    Ok(file)
}

pub(crate) fn open_approved_media(root: &Path, dir: &File, token: &str) -> Result<File> {
    if !vv_media::is_media_path(Path::new(token)) {
        return Err(ApiError::invalid("Choose a supported native media source"));
    }
    open_media(root, dir, token)
}

pub(crate) fn validate_approved_file(
    root: &Path,
    dir: &File,
    token: &str,
    file: &File,
) -> Result<()> {
    let current = open_approved_media(root, dir, token)?;
    if crate::asset_store::stable_identity(&current)? != crate::asset_store::stable_identity(file)?
    {
        return Err(changed());
    }
    Ok(())
}

pub struct SourceBrowserTask {
    root: PathBuf,
    directory: File,
    query: SourcesQuery,
}
impl SourceBrowserTask {
    pub(crate) fn new(root: &Path, directory: &File, query: SourcesQuery) -> Result<Self> {
        parts(&query.directory_token, true)?;
        Ok(Self {
            root: root.to_owned(),
            directory: directory.try_clone().map_err(|_| ApiError::io())?,
            query,
        })
    }
    pub fn run(self) -> Result<Value> {
        static ACTIVE: AtomicUsize = AtomicUsize::new(0);
        ACTIVE
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 2).then_some(count + 1)
            })
            .map_err(|_| {
                ApiError::conflict(
                    "SOURCE_BROWSER_BUSY",
                    "Two approved source browser reads are already running",
                )
            })?;
        struct Slot(&'static AtomicUsize);
        impl Drop for Slot {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::AcqRel);
            }
        }
        let _slot = Slot(&ACTIVE);
        let token = &self.query.directory_token;
        let names = parts(token, true)?;
        let opened = walk(&self.root, &self.directory, &names)?;
        let directory = opened.directory.ok_or_else(ApiError::missing)?;
        let before = crate::asset_store::stable_identity(&directory)?;
        let mut entries = Vec::new();
        for (count, entry) in std::fs::read_dir(format!("/proc/self/fd/{}", directory.as_raw_fd()))
            .map_err(|_| ApiError::io())?
            .enumerate()
        {
            if count >= MAX_ENTRIES {
                return Err(ApiError::invalid(
                    "A source directory exceeds the 4096-entry browsing budget",
                ));
            }
            let entry = entry.map_err(|_| ApiError::io())?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let path_token = if token.is_empty() {
                name.clone()
            } else {
                format!("{token}/{name}")
            };
            let kind = entry.file_type().map_err(|_| ApiError::io())?;
            let kind = if kind.is_dir() && parts(&path_token, true).is_ok() {
                "directory"
            } else if kind.is_file()
                && vv_media::is_media_path(Path::new(&name))
                && parts(&path_token, false).is_ok()
            {
                "media"
            } else {
                continue;
            };
            entries.push(json!({"kind":kind,"name":name,"path_token":path_token}));
        }
        let current = walk(&self.root, &self.directory, &names)?;
        if current.lineage != opened.lineage
            || crate::asset_store::stable_identity(&directory)? != before
        {
            return Err(changed());
        }
        entries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        let pages = entries.len().div_ceil(32).max(1);
        if self.query.page >= pages {
            return Err(ApiError::invalid("Source page is beyond the last page"));
        }
        let parent = if token.is_empty() {
            None
        } else {
            Some(token.rsplit_once('/').map_or("", |(parent, _)| parent))
        };
        Ok(
            json!({"project_epoch":self.query.project_epoch,"directory_token":token,"parent_token":parent,
            "page":self.query.page,"pages":pages,"entries":entries.into_iter().skip(self.query.page*32).take(32).collect::<Vec<_>>()}),
        )
    }
}

struct DirectoryWitness {
    token: String,
    lineage: String,
    identity: String,
}
struct MediaWitness {
    token: String,
    lineage: Option<String>,
    identity: String,
}
pub struct SourceTreeWitness {
    directories: Vec<DirectoryWitness>,
    media: Vec<MediaWitness>,
}
impl SourceTreeWitness {
    pub fn validate(&self, root: &Path, dir: &File, cancel: &AtomicBool) -> Result<()> {
        for witness in &self.directories {
            check_cancel(cancel)?;
            let names = parts(&witness.token, true)?;
            let current = walk(root, dir, &names)?;
            let directory = current.directory.ok_or_else(changed)?;
            if current.lineage != witness.lineage
                || crate::asset_store::stable_identity(&directory)? != witness.identity
            {
                return Err(changed());
            }
        }
        for witness in &self.media {
            check_cancel(cancel)?;
            let file = open_approved_media(root, dir, &witness.token)?;
            let (_, lineage) = source_entry(root, dir, &witness.token)?;
            if lineage != witness.lineage
                || crate::asset_store::stable_identity(&file)? != witness.identity
            {
                return Err(changed());
            }
        }
        Ok(())
    }
}

pub struct SourceTree {
    pub tree: vv_session::MediaTree,
    pub witness: SourceTreeWitness,
}
struct Scanner<'a> {
    root: &'a Path,
    dir: &'a File,
    cancel: &'a AtomicBool,
    entries: usize,
    tree: vv_session::MediaTree,
    directories: Vec<DirectoryWitness>,
    media: Vec<MediaWitness>,
}
impl Scanner<'_> {
    fn walk(&mut self, token: &str, parent: Option<usize>) -> Result<bool> {
        check_cancel(self.cancel)?;
        if self.directories.len() >= MAX_DIRECTORIES {
            return Err(ApiError::invalid(
                "Source scans support at most 128 directories",
            ));
        }
        let names = parts(token, true)?;
        let opened = walk(self.root, self.dir, &names)?;
        let directory = opened.directory.ok_or_else(ApiError::missing)?;
        let identity = crate::asset_store::stable_identity(&directory)?;
        self.directories.push(DirectoryWitness {
            token: token.into(),
            lineage: opened.lineage.clone(),
            identity: identity.clone(),
        });
        let first_folder = self.tree.folders.len();
        let first_file = self.tree.files.len();
        self.tree
            .folders
            .push((names[names.len() - 1].into(), parent));
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(format!("/proc/self/fd/{}", directory.as_raw_fd()))
            .map_err(|_| ApiError::io())?
        {
            check_cancel(self.cancel)?;
            self.entries += 1;
            if self.entries > MAX_ENTRIES {
                return Err(ApiError::invalid(
                    "Source scans are limited to 4096 total directory entries",
                ));
            }
            entries.push(entry.map_err(|_| ApiError::io())?);
        }
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            check_cancel(self.cancel)?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let child = format!("{token}/{name}");
            let kind = entry.file_type().map_err(|_| ApiError::io())?;
            if kind.is_symlink() || !(kind.is_file() || kind.is_dir()) {
                return Err(ApiError::invalid(
                    "Source scans refuse links and special files",
                ));
            }
            if kind.is_dir() {
                parts(&child, true)?;
                self.walk(&child, Some(first_folder))?;
            } else if vv_media::is_media_path(Path::new(&name)) {
                parts(&child, false)?;
                if self.tree.files.len() >= MAX_MEDIA {
                    return Err(ApiError::invalid(
                        "A library source tree supports at most 64 media files",
                    ));
                }
                let file = open_approved_media(self.root, self.dir, &child)?;
                let (_, lineage) = source_entry(self.root, self.dir, &child)?;
                validate_approved_file(self.root, self.dir, &child, &file)?;
                self.media.push(MediaWitness {
                    token: child.clone(),
                    lineage,
                    identity: crate::asset_store::stable_identity(&file)?,
                });
                drop(file);
                self.tree
                    .files
                    .push((self.root.join(child), Some(first_folder)));
            }
        }
        let current = walk(self.root, self.dir, &names)?;
        if current.lineage != opened.lineage
            || crate::asset_store::stable_identity(&directory)? != identity
        {
            return Err(changed());
        }
        let any = self.tree.files.len() != first_file;
        if !any {
            self.tree.folders.truncate(first_folder);
        }
        Ok(any)
    }
}

pub(crate) fn scan_media_tree(
    root: &Path,
    dir: &File,
    directory_token: &str,
    cancel: &AtomicBool,
) -> Result<SourceTree> {
    if directory_token.is_empty() {
        return Err(ApiError::invalid(
            "Choose an explicit source folder; scanning the project root is not permitted",
        ));
    }
    parts(directory_token, true)?;
    let mut scanner = Scanner {
        root,
        dir,
        cancel,
        entries: 0,
        tree: Default::default(),
        directories: Vec::new(),
        media: Vec::new(),
    };
    scanner.walk(directory_token, None)?;
    let result = SourceTree {
        tree: scanner.tree,
        witness: SourceTreeWitness {
            directories: scanner.directories,
            media: scanner.media,
        },
    };
    result.witness.validate(root, dir, cancel)?;
    Ok(result)
}

#[cfg(test)]
#[path = "tests/approved_sources.rs"]
mod tests;
