use crate::error::{ApiError, Result};
use rustix::fs::{AtFlags, Mode, OFlags, openat, renameat, unlinkat};
use serde_json::{Value, json};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use vv_core::Project;

const MAX_PROJECT: u64 = 8 * 1024 * 1024;
pub struct Files {
    root: PathBuf,
    dir: File,
}
impl Files {
    pub fn media_file(&self, path: &Path) -> Result<File> {
        if path.parent() != Some(self.root.as_path()) {
            return Err(ApiError::invalid("Media must be in the configured root"));
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(ApiError::missing)?;
        Self::name(name)?;
        let fd = openat(
            &self.dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?;
        let file = File::from(fd);
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::invalid("Media must be a regular file"));
        }
        Ok(file)
    }
    pub fn probe(&self, name: &str) -> Result<(PathBuf, vv_core::MediaMeta)> {
        Self::name(name)?;
        let listed = self.list()?;
        if !listed["importable_media"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["path_token"] == name))
        {
            return Err(ApiError::invalid(
                "Choose an importable file listed by the server",
            ));
        }
        let fd = openat(
            &self.dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?;
        let file = File::from(fd);
        if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
            return Err(ApiError::invalid("Media must be a regular file"));
        }
        use std::os::fd::AsRawFd;
        let fd_path = PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()));
        let meta = (if vv_media::is_image_path(Path::new(name)) {
            vv_media::probe_image(&fd_path)
        } else {
            vv_media::probe_media(&fd_path)
        })
        .map_err(|_| ApiError::invalid("The native engine could not read this media"))?;
        if meta.duration_frames < 0
            || meta.duration_frames > 1_000_000_000
            || meta.fps.num <= 0
            || meta.fps.den <= 0
        {
            return Err(ApiError::invalid("Unsupported source timing"));
        }
        Ok((self.root.join(name), meta))
    }
    pub fn new(root: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        let root = root.canonicalize()?;
        let dir = File::open(&root)?;
        Ok(Self { root, dir })
    }
    fn name(name: &str) -> Result<()> {
        if name.is_empty()
            || name.len() > 128
            || name.starts_with('.')
            || name
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
        {
            return Err(ApiError::invalid(
                "Choose a simple file name inside the project root",
            ));
        }
        Ok(())
    }
    fn read(&self, name: &str) -> Result<Vec<u8>> {
        Self::name(name)?;
        let fd = openat(
            &self.dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?;
        let file = File::from(fd);
        let meta = file.metadata().map_err(|_| ApiError::io())?;
        if !meta.is_file() || meta.len() > MAX_PROJECT {
            return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
        }
        let mut bytes = Vec::new();
        file.take(MAX_PROJECT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_PROJECT {
            return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
        }
        Ok(bytes)
    }
    pub fn list(&self) -> Result<Value> {
        let mut projects = Vec::new();
        let mut media = Vec::new();
        for entry in std::fs::read_dir(&self.root)
            .map_err(|_| ApiError::io())?
            .take(4096)
        {
            let entry = entry.map_err(|_| ApiError::io())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if Self::name(&name).is_err()
                || !entry.file_type().map_err(|_| ApiError::io())?.is_file()
            {
                continue;
            }
            let item = json!({"path_token":name,"name":name});
            if name.ends_with(".vvproj") {
                projects.push(item);
            } else if [
                "mp4", "mov", "mkv", "webm", "wav", "mp3", "flac", "png", "jpg", "jpeg",
            ]
            .iter()
            .any(|ext| name.to_lowercase().ends_with(&format!(".{ext}")))
            {
                media.push(item);
            }
        }
        Ok(json!({"projects":projects,"importable_media":media}))
    }
    pub fn load(&self, name: &str) -> Result<Project> {
        if !name.ends_with(".vvproj") {
            return Err(ApiError::invalid("Choose a .vvproj file"));
        }
        let bytes = self.read(name)?;
        let mut project: Project = ron::de::from_bytes(&bytes)
            .map_err(|_| ApiError::invalid("The project is not valid Venturi RON"))?;
        self.validate_media(&mut project)?;
        validate_project(&project)?;
        project.refresh_clip_rates();
        Ok(project)
    }
    fn validate_media(&self, project: &mut Project) -> Result<()> {
        for item in project.media_pool.values_mut() {
            if item.compound.is_some() {
                continue;
            }
            let path = if item.path.is_absolute() {
                item.path.clone()
            } else {
                self.root.join(&item.path)
            };
            let parent = path
                .parent()
                .and_then(|p| p.canonicalize().ok())
                .ok_or_else(|| ApiError::invalid("Media must be in the configured root"))?;
            if parent != self.root {
                return Err(ApiError::invalid(
                    "Media must be in the configured root; nested paths are not supported yet",
                ));
            }
            if let Ok(meta) = std::fs::symlink_metadata(&path)
                && (meta.file_type().is_symlink() || !meta.is_file())
            {
                return Err(ApiError::invalid(
                    "Media links and special files are refused",
                ));
            }
            item.path = path;
        }
        Ok(())
    }
    pub fn path(&self, name: &str) -> Result<PathBuf> {
        Self::name(name)?;
        Ok(self.root.join(name))
    }
    pub fn save(&self, project: &Project, name: &str, create: bool) -> Result<()> {
        Self::name(name)?;
        if !name.ends_with(".vvproj") {
            return Err(ApiError::invalid("Choose a .vvproj file"));
        }
        let data = ron::ser::to_string_pretty(project, ron::ser::PrettyConfig::default())
            .map_err(|_| ApiError::io())?;
        if data.len() as u64 > MAX_PROJECT {
            return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
        }
        let temp = format!(
            ".venturi-{}-{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let result = (|| {
            let fd = openat(
                &self.dir,
                temp.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?;
            let mut file = File::from(fd);
            file.write_all(data.as_bytes())
                .map_err(|_| ApiError::io())?;
            file.sync_all().map_err(|_| ApiError::io())?;
            if create {
                rustix::fs::renameat_with(
                    &self.dir,
                    temp.as_str(),
                    &self.dir,
                    name,
                    rustix::fs::RenameFlags::NOREPLACE,
                )
                .map_err(|_| {
                    ApiError::conflict("FILE_EXISTS", "A project with that name already exists")
                })?;
            } else {
                let old = self.read(name)?;
                let backup = format!("{name}.bak");
                let backup_temp = format!("{temp}.bak");
                let fd = openat(
                    &self.dir,
                    backup_temp.as_str(),
                    OFlags::WRONLY
                        | OFlags::CREATE
                        | OFlags::EXCL
                        | OFlags::NOFOLLOW
                        | OFlags::CLOEXEC,
                    Mode::RUSR | Mode::WUSR,
                )
                .map_err(|_| ApiError::io())?;
                let mut file = File::from(fd);
                file.write_all(&old).map_err(|_| ApiError::io())?;
                file.sync_all().map_err(|_| ApiError::io())?;
                renameat(&self.dir, backup_temp.as_str(), &self.dir, backup.as_str())
                    .map_err(|_| ApiError::io())?;
                renameat(&self.dir, temp.as_str(), &self.dir, name).map_err(|_| ApiError::io())?;
            }
            self.dir.sync_all().map_err(|_| ApiError::io())?;
            Ok(())
        })();
        let _ = unlinkat(&self.dir, temp.as_str(), AtFlags::empty());
        result
    }
}

fn validate_project(project: &Project) -> Result<()> {
    if project.timelines.len() > 64 || project.media_pool.len() > 10_000 {
        return Err(ApiError::invalid("Project exceeds web host limits"));
    }
    for tl in project.timelines.values() {
        if tl.fps.num <= 0
            || tl.fps.den <= 0
            || tl.fps.as_f64() > 240.0
            || tl.resolution.0 == 0
            || tl.resolution.1 == 0
            || tl.resolution.0 > 8192
            || tl.resolution.1 > 8192
            || tl.tracks.len() > 128
        {
            return Err(ApiError::invalid("Unsupported timeline geometry"));
        }
        let mut ids = std::collections::HashSet::new();
        for track in &tl.tracks {
            let mut end = 0;
            for clip in &track.clips {
                if !ids.insert(clip.id)
                    || clip.timeline_start < end
                    || clip.timeline_len < 1
                    || clip.timeline_start > 1_000_000_000 - clip.timeline_len
                    || clip.rate().num <= 0
                    || clip.rate().den <= 0
                    || clip.speed().num <= 0
                    || clip.speed().den <= 0
                    || clip.source_offset < 0
                    || clip.source_offset > 1_000_000_000 - clip.timeline_len
                {
                    return Err(ApiError::invalid("Invalid clip range or duplicate ID"));
                }
                end = clip.timeline_end();
            }
        }
    }
    for item in project.media_pool.values() {
        if item.meta.fps.num <= 0
            || item.meta.fps.den <= 0
            || item.meta.duration_frames < 0
            || item.meta.duration_frames > 1_000_000_000
        {
            return Err(ApiError::invalid("Invalid source metadata"));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/files.rs"]
mod tests;
