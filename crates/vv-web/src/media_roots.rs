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
    sync::Arc,
};

const SHARED_PREFIX: &str = "library://";

struct Root {
    path: PathBuf,
    directory: File,
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

impl MediaRoots {
    pub(crate) fn new(project_path: &Path, project_dir: File) -> io::Result<Self> {
        let path = project_path.canonicalize()?;
        let live = directory(&path)?;
        crate::asset_store::same_directory(&project_dir, &live)
            .map_err(|_| io::Error::other("The approved project root changed"))?;
        Ok(Self {
            project: Arc::new(Root {
                path,
                directory: project_dir,
            }),
            shared: None,
        })
    }

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
                directory: opened,
            })),
        })
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
        files::open_root_media(&root.path, &root.directory, path)
    }

    pub(crate) fn entry(&self, path: &Path) -> Result<(Option<Metadata>, Option<String>)> {
        let (root, token) = self.locate(path)?;
        let (entry, lineage) = files::source_entry(&root.path, &root.directory, &token)?;
        let identity = root.directory.metadata().map_err(|_| ApiError::io())?;
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
        files::validate_approved_file(&root.path, &root.directory, &token, file)
    }
}

#[cfg(test)]
#[path = "tests/media_roots.rs"]
mod tests;
