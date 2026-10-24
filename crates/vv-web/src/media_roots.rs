use crate::{
    error::{ApiError, Result},
    files,
};
use rustix::fs::{Mode, OFlags};
use std::{
    fs::{File, Metadata},
    io,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

const SHARED_PREFIX: &str = "library://";

struct Root {
    path: PathBuf,
    directory: OnceLock<File>,
}

#[derive(Clone)]
pub(crate) struct MediaRoots {
    project: Arc<Root>,
    shared: Option<Arc<Root>>,
}

fn directory(path: &Path) -> io::Result<File> {
    rustix::fs::open(
        path,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(io::Error::from)
}

pub(crate) fn unavailable() -> ApiError {
    ApiError::conflict(
        "LIBRARY_UNAVAILABLE",
        "The configured native library is unavailable; restore it and use Refresh",
    )
}

pub(crate) fn transient(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound
            | io::ErrorKind::PermissionDenied
            | io::ErrorKind::TimedOut
            | io::ErrorKind::WouldBlock
    ) || error.raw_os_error().is_some_and(|code| {
        [
            rustix::io::Errno::STALE,
            rustix::io::Errno::NETDOWN,
            rustix::io::Errno::NETUNREACH,
            rustix::io::Errno::HOSTUNREACH,
            rustix::io::Errno::HOSTDOWN,
            rustix::io::Errno::IO,
        ]
        .iter()
        .any(|errno| errno.raw_os_error() == code)
    })
}

pub(crate) fn configured_path(path: &Path) -> io::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut ancestor = absolute.as_path();
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_dir() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "Library root must be a directory, not a link",
                    ));
                }
                let mut normalized = match ancestor.canonicalize() {
                    Ok(path) => path,
                    Err(error) if transient(&error) => ancestor.to_owned(),
                    Err(error) => return Err(error),
                };
                for name in missing.iter().rev() {
                    normalized.push(name);
                }
                return Ok(normalized);
            }
            Err(error) if transient(&error) => {
                let name = ancestor.file_name().ok_or(error)?;
                missing.push(name.to_owned());
                ancestor = ancestor.parent().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "Invalid library root")
                })?;
            }
            Err(error) => return Err(error),
        }
    }
}

pub(crate) fn open_configured(path: &Path) -> io::Result<File> {
    let file = directory(path)?;
    if path.canonicalize()? != path {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Configured library root changed through a link",
        ));
    }
    crate::asset_store::same_directory(&file, &directory(path)?)
        .map_err(|_| io::Error::other("The configured library root changed"))?;
    Ok(file)
}

impl Root {
    fn directory(&self) -> Result<&File> {
        self.directory.get().ok_or_else(unavailable)
    }
}

impl MediaRoots {
    pub(crate) fn new(project_path: &Path, project_dir: File) -> io::Result<Self> {
        let path = project_path.canonicalize()?;
        let live = directory(&path)?;
        crate::asset_store::same_directory(&project_dir, &live)
            .map_err(|_| io::Error::other("The approved project root changed"))?;
        Ok(Self {
            project: Arc::new(Root {
                path,
                directory: OnceLock::from(project_dir),
            }),
            shared: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn with_shared(&self, shared_path: &Path) -> io::Result<Self> {
        if !shared_path.is_absolute() {
            return Err(io::Error::other("The shared media root must be absolute"));
        }
        let opened = directory(shared_path)?;
        let path = shared_path.canonicalize()?;
        crate::asset_store::same_directory(&opened, &directory(&path)?)
            .map_err(|_| io::Error::other("The approved shared media root changed"))?;
        Ok(Self {
            project: self.project.clone(),
            shared: Some(Arc::new(Root {
                path,
                directory: OnceLock::from(opened),
            })),
        })
    }

    pub(crate) fn with_unavailable_shared(&self, shared_path: &Path) -> io::Result<Self> {
        Ok(Self {
            project: self.project.clone(),
            shared: Some(Arc::new(Root {
                path: configured_path(shared_path)?,
                directory: OnceLock::new(),
            })),
        })
    }

    pub(crate) fn retry_shared(&self) -> io::Result<()> {
        if let Some(root) = &self.shared {
            if let Some(pinned) = root.directory.get() {
                let live = open_configured(&root.path)?;
                return crate::asset_store::same_directory(pinned, &live)
                    .map_err(|_| io::Error::other("The approved shared root changed"));
            }
            let opened = open_configured(&root.path)?;
            let _ = root.directory.set(opened);
            let live = open_configured(&root.path)?;
            crate::asset_store::same_directory(root.directory.get().unwrap(), &live)
                .map_err(|_| io::Error::other("The approved shared root changed"))?;
        }
        Ok(())
    }

    pub(crate) fn shared_path(&self) -> Option<&Path> {
        self.shared.as_ref().map(|root| root.path.as_path())
    }

    fn locate(&self, path: &Path) -> Result<(&Root, String)> {
        if path.starts_with(&self.project.path) {
            return Ok((
                &self.project,
                files::root_media_token(&self.project.path, path)?,
            ));
        }
        if let Some(shared) = &self.shared
            && path.starts_with(&shared.path)
        {
            return Ok((shared, files::root_media_token(&shared.path, path)?));
        }
        Err(ApiError::invalid(
            "Media must be inside an approved project or shared root",
        ))
    }

    pub(crate) fn token(&self, path: &Path) -> Result<String> {
        let (root, token) = self.locate(path)?;
        Ok(if std::ptr::eq(root, self.project.as_ref()) {
            token
        } else {
            format!("{SHARED_PREFIX}{token}")
        })
    }

    pub(crate) fn path(&self, token: &str) -> Result<PathBuf> {
        let (root, relative) = if let Some(relative) = token.strip_prefix(SHARED_PREFIX) {
            let relative = if let Some((relative, version)) = relative.split_once("?source=") {
                if version.len() != 64
                    || !version
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err(ApiError::invalid(
                        "Use an exact shared source version token",
                    ));
                }
                relative
            } else {
                relative
            };
            (
                self.shared
                    .as_ref()
                    .ok_or_else(|| ApiError::invalid("The shared media root is not configured"))?
                    .as_ref(),
                relative,
            )
        } else {
            (self.project.as_ref(), token)
        };
        let path = root.path.join(relative);
        if files::root_media_token(&root.path, &path)? != relative {
            return Err(ApiError::invalid("Use an exact approved media token"));
        }
        Ok(path)
    }

    pub(crate) fn open(&self, path: &Path) -> Result<File> {
        let (root, _) = self.locate(path)?;
        files::open_root_media(&root.path, root.directory()?, path)
    }

    pub(crate) fn entry(&self, path: &Path) -> Result<(Option<Metadata>, Option<String>)> {
        let (root, token) = self.locate(path)?;
        let Some(directory) = root.directory.get() else {
            return Ok((None, Some("library-unavailable".into())));
        };
        let (entry, lineage) = files::source_entry(&root.path, directory, &token)?;
        let identity = directory.metadata().map_err(|_| ApiError::io())?;
        let lineage = format!(
            "{}:{}/{}",
            identity.dev(),
            identity.ino(),
            lineage.as_deref().unwrap_or("")
        );
        Ok((entry, Some(lineage)))
    }

    pub(crate) fn validate_file(&self, path: &Path, file: &File) -> Result<()> {
        let (root, token) = self.locate(path)?;
        files::validate_approved_file(&root.path, root.directory()?, &token, file)
    }
}

#[cfg(test)]
#[path = "tests/media_roots.rs"]
mod tests;
