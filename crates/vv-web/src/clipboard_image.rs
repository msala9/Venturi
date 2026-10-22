use crate::error::{ApiError, Result};
use rustix::fs::{
    AtFlags, Mode, OFlags, RenameFlags, mkdirat, openat, renameat_with, statat, unlinkat,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Write,
    os::{
        fd::AsRawFd,
        unix::fs::{FileExt, MetadataExt},
    },
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub const MAX_BYTES: usize = 32 * 1024 * 1024;
pub const DIRECTORY: &str = "Pasted Images";
pub(crate) const STAGING_DIRECTORY: &str = ".venturi-clipboard-images";
const MAX_STAGES: usize = 8;
const EXTENSIONS: [&str; 6] = ["png", "jpg", "webp", "gif", "bmp", "tif"];

#[derive(Clone, Copy, Debug)]
pub struct ImageFormat {
    pub mime: &'static str,
    pub extension: &'static str,
}

pub fn validate(mime: &str, bytes: &[u8]) -> Result<ImageFormat> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(ApiError::invalid(
            "Clipboard images must contain 1 byte to 32 MiB",
        ));
    }
    let (extension, valid) = match mime {
        "image/png" => ("png", bytes.starts_with(b"\x89PNG\r\n\x1a\n")),
        "image/jpeg" => ("jpg", bytes.starts_with(b"\xff\xd8\xff")),
        "image/webp" => (
            "webp",
            bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        ),
        "image/gif" => (
            "gif",
            bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        ),
        "image/bmp" => ("bmp", bytes.starts_with(b"BM")),
        "image/tiff" => (
            "tif",
            bytes.starts_with(b"II\x2a\0") || bytes.starts_with(b"MM\0\x2a"),
        ),
        _ => return Err(ApiError::invalid("Choose a native clipboard image format")),
    };
    if !valid {
        return Err(ApiError::invalid(
            "Clipboard image signature does not match its format",
        ));
    }
    let mime = match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "image/tiff",
    };
    Ok(ImageFormat { mime, extension })
}

pub(crate) fn image_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 120
        || matches!(name, "." | "..")
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(ApiError::invalid(
            "Choose an image name of at most 120 bytes without separators or control characters",
        ));
    }
    Ok(name)
}

pub(crate) fn validate_filename(name: &str) -> Result<()> {
    let (base, extension) = name
        .rsplit_once('.')
        .ok_or_else(|| ApiError::invalid("Invalid pasted image file name"))?;
    if image_name(base)? != base || !EXTENSIONS.contains(&extension) {
        return Err(ApiError::invalid("Invalid pasted image file name"));
    }
    Ok(())
}

pub(crate) fn directory(dir: &File) -> Result<Option<File>> {
    match openat(
        dir,
        DIRECTORY,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(fd) => Ok(Some(File::from(fd))),
        Err(rustix::io::Errno::NOENT) => Ok(None),
        Err(_) => Err(ApiError::invalid(
            "Pasted Images must be a real directory inside the project root",
        )),
    }
}

fn canceled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(ApiError::conflict(
            "IMAGE_CANCELED",
            "Clipboard image import was canceled",
        ))
    } else {
        Ok(())
    }
}

fn taken() -> ApiError {
    ApiError::conflict(
        "IMAGE_NAME_TAKEN",
        "An image with this name already exists; choose another name",
    )
}

fn absent(dir: &File, name: &str) -> Result<()> {
    match statat(dir, name, AtFlags::SYMLINK_NOFOLLOW) {
        Err(rustix::io::Errno::NOENT) => Ok(()),
        Ok(_) => Err(taken()),
        Err(_) => Err(ApiError::io()),
    }
}

fn owned(dir: &File, name: &str, file: &File) -> bool {
    let Ok(meta) = file.metadata() else {
        return false;
    };
    let Ok(entry) = statat(dir, name, AtFlags::SYMLINK_NOFOLLOW) else {
        return false;
    };
    meta.is_file() && entry.st_dev == meta.dev() && entry.st_ino == meta.ino()
}

fn remove_owned(dir: &File, name: &str, file: &File) {
    if owned(dir, name, file) {
        let _ = unlinkat(dir, name, AtFlags::empty());
        let _ = dir.sync_all();
    }
}

fn staging_directory(root: &File) -> Result<File> {
    match mkdirat(
        root,
        STAGING_DIRECTORY,
        Mode::RUSR | Mode::WUSR | Mode::XUSR,
    ) {
        Ok(()) => root.sync_all().map_err(|_| ApiError::io())?,
        Err(rustix::io::Errno::EXIST) => {}
        Err(_) => return Err(ApiError::io()),
    }
    let dir = File::from(
        openat(
            root,
            STAGING_DIRECTORY,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| {
            ApiError::invalid("Clipboard image staging must be a real project directory")
        })?,
    );
    let entries = std::fs::read_dir(format!("/proc/self/fd/{}", dir.as_raw_fd()))
        .map_err(|_| ApiError::io())?;
    for (count, entry) in entries.take(MAX_STAGES + 1).enumerate() {
        let entry = entry.map_err(|_| ApiError::io())?;
        let name = entry.file_name();
        let name = name.to_str().ok_or_else(cache_full)?;
        let meta = statat(&dir, name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| ApiError::io())?;
        if count >= MAX_STAGES - 1
            || !name.starts_with(".venturi-clipboard-image-")
            || rustix::fs::FileType::from_raw_mode(meta.st_mode)
                != rustix::fs::FileType::RegularFile
            || meta.st_size < 0
            || meta.st_size as u64 > MAX_BYTES as u64
        {
            return Err(cache_full());
        }
    }
    Ok(dir)
}

fn cache_full() -> ApiError {
    ApiError::conflict(
        "IMAGE_CACHE_FULL",
        "Clipboard image staging is full or contains unknown files; release prepared images or clean up old staging files",
    )
}

pub struct Target {
    pub path: PathBuf,
    pub path_token: String,
}

pub struct Published {
    pub path: PathBuf,
    pub path_token: String,
    pub content_hash: u64,
}

pub struct Stage {
    root: PathBuf,
    dir: File,
    staging: File,
    file: File,
    temporary: String,
    identity: String,
    digest: [u8; 32],
    format: ImageFormat,
    published: bool,
    relocated: Option<(File, String)>,
}

impl Stage {
    pub fn new(
        root: &Path,
        dir: File,
        mime: &str,
        bytes: &[u8],
        cancel: &AtomicBool,
    ) -> Result<Self> {
        let format = validate(mime, bytes)?;
        canceled(cancel)?;
        let live = File::from(
            rustix::fs::open(
                root,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        crate::asset_store::same_directory(&dir, &live)?;
        let staging = staging_directory(&dir)?;
        let temporary = format!(
            ".venturi-clipboard-image-{}.{}",
            crate::asset_jobs::nonce(),
            format.extension
        );
        let mut file = File::from(
            openat(
                &staging,
                temporary.as_str(),
                OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        let write = (|| {
            for chunk in bytes.chunks(64 * 1024) {
                canceled(cancel)?;
                file.write_all(chunk).map_err(|_| ApiError::io())?;
            }
            file.sync_all().map_err(|_| ApiError::io())?;
            staging.sync_all().map_err(|_| ApiError::io())?;
            canceled(cancel)
        })();
        if let Err(error) = write {
            remove_owned(&staging, &temporary, &file);
            return Err(error);
        }
        let identity = match crate::asset_store::stable_identity(&file) {
            Ok(identity) => identity,
            Err(error) => {
                remove_owned(&staging, &temporary, &file);
                return Err(error);
            }
        };
        Ok(Self {
            root: root.to_owned(),
            dir,
            staging,
            file,
            temporary,
            identity,
            digest: Sha256::digest(bytes).into(),
            format,
            published: false,
            relocated: None,
        })
    }

    pub fn file(&self) -> &File {
        &self.file
    }
    pub fn mime(&self) -> &'static str {
        self.format.mime
    }
    pub fn extension(&self) -> &'static str {
        self.format.extension
    }
    pub fn is_image(&self) -> bool {
        self.format.extension != "gif"
    }

    fn validate_root(&self) -> Result<()> {
        let live = File::from(
            rustix::fs::open(
                &self.root,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        crate::asset_store::same_directory(&self.dir, &live)
    }

    pub fn validate(&self) -> Result<()> {
        self.validate_root()?;
        let staging = File::from(
            openat(
                &self.dir,
                STAGING_DIRECTORY,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        crate::asset_store::same_directory(&self.staging, &staging)?;
        if self.published
            || !owned(&self.staging, &self.temporary, &self.file)
            || crate::asset_store::stable_identity(&self.file)? != self.identity
        {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Clipboard image staging file changed",
            ));
        }
        Ok(())
    }

    pub fn verify_content(&self) -> Result<()> {
        self.validate()?;
        let mut hash = Sha256::new();
        let mut offset = 0;
        let mut buffer = [0; 64 * 1024];
        loop {
            let count = self
                .file
                .read_at(&mut buffer, offset)
                .map_err(|_| ApiError::io())?;
            if count == 0 {
                break;
            }
            offset += count as u64;
            if offset > MAX_BYTES as u64 {
                return Err(ApiError::invalid(
                    "Clipboard image staging file exceeds its limit",
                ));
            }
            hash.update(&buffer[..count]);
        }
        let digest: [u8; 32] = hash.finalize().into();
        if digest != self.digest
            || crate::asset_store::stable_identity(&self.file)? != self.identity
        {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Clipboard image staging file changed",
            ));
        }
        Ok(())
    }

    pub fn suggested_name(&self) -> Result<String> {
        self.validate_root()?;
        let Some(dir) = directory(&self.dir)? else {
            return Ok("Image 001".into());
        };
        for n in 1..=10_000 {
            let name = format!("Image {n:03}");
            let mut available = true;
            for extension in EXTENSIONS {
                match absent(&dir, &format!("{name}.{extension}")) {
                    Ok(()) => {}
                    Err(error) if error.1 == "IMAGE_NAME_TAKEN" => {
                        available = false;
                        break;
                    }
                    Err(error) => return Err(error),
                }
            }
            if available {
                return Ok(name);
            }
        }
        // An editable suggestion must not prevent importing into a large image folder.
        Ok("Image 10001".into())
    }

    pub fn preview(&self, name: &str) -> Result<Target> {
        self.validate()?;
        let name = image_name(name)?;
        let filename = format!("{name}.{}", self.extension());
        if let Some(dir) = directory(&self.dir)? {
            absent(&dir, &filename)?;
        }
        let path_token = format!("{DIRECTORY}/{filename}");
        Ok(Target {
            path: self.root.join(&path_token),
            path_token,
        })
    }

    pub fn publish(&mut self, name: &str, cancel: &AtomicBool) -> Result<Published> {
        canceled(cancel)?;
        let target = self.preview(name)?;
        match mkdirat(&self.dir, DIRECTORY, Mode::RUSR | Mode::WUSR | Mode::XUSR) {
            Ok(()) | Err(rustix::io::Errno::EXIST) => {}
            Err(_) => return Err(ApiError::io()),
        }
        let dir = directory(&self.dir)?.ok_or_else(ApiError::io)?;
        let filename = target
            .path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(ApiError::io)?;
        self.validate()?;
        canceled(cancel)?;
        let basic_identity = crate::source::file_identity(&self.file)?;
        if crate::asset_store::stable_identity(&self.file)? != self.identity {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "Clipboard image staging file changed",
            ));
        }
        match renameat_with(
            &self.staging,
            self.temporary.as_str(),
            &dir,
            filename,
            RenameFlags::NOREPLACE,
        ) {
            Ok(()) => {}
            Err(rustix::io::Errno::EXIST) => return Err(taken()),
            Err(_) => return Err(ApiError::io()),
        }
        let result = (|| {
            let published_identity = crate::asset_store::stable_identity(&self.file)?;
            self.staging.sync_all().map_err(|_| ApiError::io())?;
            self.dir.sync_all().map_err(|_| ApiError::io())?;
            dir.sync_all().map_err(|_| ApiError::io())?;
            self.validate_root()?;
            let live = directory(&self.dir)?.ok_or_else(ApiError::io)?;
            crate::asset_store::same_directory(&dir, &live)?;
            if !owned(&dir, filename, &self.file)
                || crate::source::file_identity(&self.file)? != basic_identity
            {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Published clipboard image changed",
                ));
            }
            canceled(cancel)?;
            let content_hash = vv_media::content_fingerprint(&PathBuf::from(format!(
                "/proc/self/fd/{}",
                self.file.as_raw_fd()
            )))
            .map_err(|_| ApiError::invalid("The native engine could not fingerprint this image"))?;
            canceled(cancel)?;
            self.validate_root()?;
            let live = directory(&self.dir)?.ok_or_else(ApiError::io)?;
            crate::asset_store::same_directory(&dir, &live)?;
            if !owned(&dir, filename, &self.file)
                || crate::asset_store::stable_identity(&self.file)? != published_identity
            {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Published clipboard image changed",
                ));
            }
            Ok(content_hash)
        })();
        match result {
            Ok(content_hash) => {
                self.published = true;
                Ok(Published {
                    path: target.path,
                    path_token: target.path_token,
                    content_hash,
                })
            }
            Err(error) => {
                remove_owned(&dir, filename, &self.file);
                self.relocated = Some((dir, filename.to_owned()));
                Err(error)
            }
        }
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        if !self.published {
            remove_owned(&self.staging, &self.temporary, &self.file);
            if let Some((dir, name)) = &self.relocated {
                remove_owned(dir, name, &self.file);
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/clipboard_image.rs"]
mod tests;
