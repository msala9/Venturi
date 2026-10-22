use crate::error::{ApiError, Result};
use rustix::fs::{AtFlags, Mode, OFlags, openat, renameat, unlinkat};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    cell::RefCell,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use vv_core::Project;

pub(crate) const MAX_PROJECT: u64 = 8 * 1024 * 1024;
pub const MAX_MEDIA_IMPORTS: usize = 256;
pub(crate) fn media_import_tokens(path_tokens: &[String]) -> Result<Vec<String>> {
    if path_tokens.is_empty() || path_tokens.len() > 4096 {
        return Err(ApiError::invalid(
            "Choose between 1 and 256 unique root media files",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut tokens = Vec::new();
    for token in path_tokens {
        Files::name(token)?;
        if !vv_media::is_media_path(Path::new(token)) {
            return Err(ApiError::invalid(
                "Choose a native media file inside the configured project root",
            ));
        }
        if seen.insert(token.as_str()) {
            tokens.push(token.clone());
            if tokens.len() > MAX_MEDIA_IMPORTS {
                return Err(ApiError::invalid(
                    "A media import batch supports at most 256 unique files",
                ));
            }
        }
    }
    Ok(tokens)
}
#[derive(Clone, PartialEq, Eq)]
struct ProjectVersion {
    identity: String,
    sha256: String,
}
pub struct Files {
    root: PathBuf,
    dir: File,
    version: RefCell<Option<(String, ProjectVersion)>>,
}

pub(crate) fn root_media_token(root: &Path, path: &Path) -> Result<String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| ApiError::invalid("Media must be in the configured root"))?;
    let token = relative
        .to_str()
        .ok_or_else(|| ApiError::invalid("Media file names must be UTF-8"))?;
    if let Some(name) = token.strip_prefix("Pasted Images/") {
        crate::clipboard_image::validate_filename(name)?;
    } else {
        Files::name(token)?;
    }
    if root.join(token).as_os_str() != path.as_os_str() {
        return Err(ApiError::invalid(
            "Media must use its exact root-relative path",
        ));
    }
    Ok(token.to_owned())
}

pub(crate) fn open_root_media(root: &Path, dir: &File, path: &Path) -> Result<File> {
    let token = root_media_token(root, path)?;
    let live = File::from(
        rustix::fs::open(
            root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ApiError::io())?,
    );
    crate::asset_store::same_directory(dir, &live)?;
    let child;
    let (parent, name) = if let Some(name) = token.strip_prefix("Pasted Images/") {
        child = crate::clipboard_image::directory(dir)?.ok_or_else(ApiError::missing)?;
        (&child, name)
    } else {
        (dir, token.as_str())
    };
    let file = File::from(
        openat(
            parent,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| ApiError::missing())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::invalid("Media must be a regular file"));
    }
    Ok(file)
}

impl Files {
    pub fn media_import_tokens(&self, path_tokens: &[String]) -> Result<Vec<String>> {
        media_import_tokens(path_tokens)
    }
    pub fn root_file(&self) -> Result<File> {
        self.dir.try_clone().map_err(|_| ApiError::io())
    }
    pub fn shared_origin(&self, path: &Path) -> Option<Value> {
        if path.parent() != Some(self.root.as_path()) {
            return None;
        }
        crate::library::provenance(&self.dir, path.file_name()?.to_str()?)
    }
    pub fn media_file(&self, path: &Path) -> Result<File> {
        open_root_media(&self.root, &self.dir, path)
    }
    #[cfg(test)]
    pub fn probe(&self, name: &str) -> Result<(PathBuf, vv_core::MediaMeta)> {
        let (path, meta, _) = self.prepare_media(name)?;
        Ok((path, meta))
    }
    pub fn prepare_media(&self, name: &str) -> Result<(PathBuf, vv_core::MediaMeta, u64)> {
        let path = self.root.join(name);
        root_media_token(&self.root, &path)?;
        if !name.starts_with("Pasted Images/")
            && !self.list()?["importable_media"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["path_token"] == name))
        {
            return Err(ApiError::invalid(
                "Choose an importable file listed by the server",
            ));
        }
        let file = self.media_file(&path)?;
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
        let hash = vv_media::content_fingerprint(&fd_path)
            .map_err(|_| ApiError::invalid("The native engine could not fingerprint this media"))?;
        Ok((path, meta, hash))
    }
    pub fn new(root: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        let root = root.canonicalize()?;
        let dir = File::open(&root)?;
        dir.try_lock().map_err(|_| std::io::Error::other("Another Venturi Web process owns this project root, or directory locking is unavailable"))?;
        Ok(Self {
            root,
            dir,
            version: RefCell::new(None),
        })
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
    #[cfg(test)]
    fn read(&self, name: &str) -> Result<Vec<u8>> {
        self.read_versioned(name).map(|(bytes, _)| bytes)
    }
    fn read_versioned(&self, name: &str) -> Result<(Vec<u8>, ProjectVersion)> {
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
        let identity = crate::source::file_identity(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_PROJECT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::io())?;
        if bytes.len() as u64 > MAX_PROJECT {
            return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
        }
        if identity != crate::source::file_identity(&file)? {
            return Err(ApiError::conflict(
                "SAVE_CONFLICT",
                "Project changed while being read; retry opening it",
            ));
        }
        let version = ProjectVersion {
            identity,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        Ok((bytes, version))
    }
    pub fn list(&self) -> Result<Value> {
        let mut projects = Vec::new();
        let mut media = Vec::new();
        let mut otio = Vec::new();
        let mut backups = Vec::new();
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
            } else if name.ends_with(".vvproj.bak") {
                backups.push(item);
            } else if name.ends_with(".otio") {
                otio.push(item);
            } else if vv_media::is_media_path(Path::new(&name)) {
                media.push(item);
            }
        }
        Ok(
            json!({"projects":projects,"backups":backups,"importable_media":media,"importable_otio":otio}),
        )
    }
    #[cfg(test)]
    pub fn import_otio(&self, name: &str) -> Result<(Project, Vec<String>)> {
        if !name.ends_with(".otio") {
            return Err(ApiError::invalid("Choose a listed .otio file"));
        }
        parse_otio(
            &self.read(name)?,
            &self.root,
            &mut |path| {
                if path.parent().and_then(|p| p.canonicalize().ok()).as_ref() != Some(&self.root) {
                    return Err("Media must be directly inside the configured project root".into());
                }
                let token = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("Invalid media name")?;
                let (safe_path, meta) = self.probe(token).map_err(|_| {
                    "Media is offline or refused by the configured root policy".to_string()
                })?;
                let file = self
                    .media_file(&safe_path)
                    .map_err(|_| "Media changed before native fingerprinting".to_string())?;
                let fd_path = PathBuf::from(format!(
                    "/proc/self/fd/{}",
                    std::os::fd::AsRawFd::as_raw_fd(&file)
                ));
                Ok((meta, vv_media::content_fingerprint(&fd_path).unwrap_or(0)))
            },
            &mut |_| {},
        )
    }
    pub fn load(&self, name: &str) -> Result<Project> {
        if !name.ends_with(".vvproj") {
            return Err(ApiError::invalid("Choose a .vvproj file"));
        }
        self.load_project_file(name, None)
    }
    pub fn load_matching(&self, name: &str, sha256: &str) -> Result<Project> {
        if !name.ends_with(".vvproj") {
            return Err(ApiError::invalid("Choose a native project"));
        }
        self.load_project_file(name, Some(sha256))
    }
    pub fn saved_fingerprint(&self, name: &str) -> Option<String> {
        self.version
            .borrow()
            .as_ref()
            .filter(|(token, _)| token == name)
            .map(|(_, version)| version.sha256.clone())
    }
    pub fn project_fingerprint(&self, name: &str) -> Result<String> {
        self.read_versioned(name).map(|(_, version)| version.sha256)
    }
    pub fn load_detached(&self, name: &str) -> Result<Project> {
        let previous = self.version.borrow().clone();
        let result = self.load(name);
        *self.version.borrow_mut() = previous;
        result
    }
    pub fn save_detached(&self, project: &Project, name: &str) -> Result<String> {
        let previous = self.version.borrow().clone();
        let result = self
            .save(project, name, true)
            .and_then(|_| self.saved_fingerprint(name).ok_or_else(ApiError::io));
        *self.version.borrow_mut() = previous;
        result
    }
    pub fn validate_recovery(&self, mut project: Project) -> Result<Project> {
        self.validate_media(&mut project)?;
        validate_project(&project)?;
        project.refresh_clip_rates();
        Ok(project)
    }
    pub fn load_backup(&self, name: &str) -> Result<Project> {
        if !name.ends_with(".vvproj.bak") {
            return Err(ApiError::invalid("Choose a listed .vvproj.bak backup"));
        }
        self.load_project_file(name, None)
    }
    fn load_project_file(&self, name: &str, expected: Option<&str>) -> Result<Project> {
        let (bytes, version) = self.read_versioned(name)?;
        if expected.is_some_and(|sha256| sha256 != version.sha256) {
            return Err(ApiError::conflict(
                "SAVE_CONFLICT",
                "The previous project changed; open it explicitly",
            ));
        }
        let mut project: Project = ron::de::from_bytes(&bytes)
            .map_err(|_| ApiError::invalid("The project is not valid Venturi RON"))?;
        self.validate_media(&mut project)?;
        validate_project(&project)?;
        project.refresh_clip_rates();
        if name.ends_with(".vvproj") {
            *self.version.borrow_mut() = Some((name.into(), version));
        }
        Ok(project)
    }
    fn validate_media(&self, project: &mut Project) -> Result<()> {
        let live = File::from(
            rustix::fs::open(
                &self.root,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| ApiError::io())?,
        );
        crate::asset_store::same_directory(&self.dir, &live)?;
        validate_root_media_in(project, &self.root, &self.dir)
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
        let expected = if create {
            None
        } else {
            Some(
                self.version
                    .borrow()
                    .as_ref()
                    .filter(|(token, _)| token == name)
                    .map(|(_, version)| version.clone())
                    .ok_or_else(|| {
                        ApiError::conflict(
                            "SAVE_CONFLICT",
                            "Open the current on-disk project before saving, or use Save As",
                        )
                    })?,
            )
        };
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
            let next = ProjectVersion {
                identity: crate::source::file_identity(&file)?,
                sha256: format!("{:x}", Sha256::digest(data.as_bytes())),
            };
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
                let check = || {
                    self.read_versioned(name).map_err(|_| {
                        ApiError::conflict(
                            "SAVE_CONFLICT",
                            "The on-disk project is missing or changed; keep edits with Save As",
                        )
                    })
                };
                let (old, version) = check()?;
                if Some(&version) != expected.as_ref() {
                    return Err(ApiError::conflict(
                        "SAVE_CONFLICT",
                        "The on-disk project changed since opening or saving; preserve edits with Save As",
                    ));
                }
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
                if check()?.1 != version {
                    let _ = unlinkat(&self.dir, backup_temp.as_str(), AtFlags::empty());
                    return Err(ApiError::conflict(
                        "SAVE_CONFLICT",
                        "The on-disk project changed during Save; preserve edits with Save As",
                    ));
                }
                renameat(&self.dir, backup_temp.as_str(), &self.dir, backup.as_str())
                    .map_err(|_| ApiError::io())?;
                if check()?.1 != version {
                    return Err(ApiError::conflict(
                        "SAVE_CONFLICT",
                        "The on-disk project changed during Save; preserve edits with Save As",
                    ));
                }
                renameat(&self.dir, temp.as_str(), &self.dir, name).map_err(|_| ApiError::io())?;
            }
            self.dir.sync_all().map_err(|_| ApiError::io())?;
            *self.version.borrow_mut() = Some((name.into(), next));
            Ok(())
        })();
        let _ = unlinkat(&self.dir, temp.as_str(), AtFlags::empty());
        result
    }
}

pub(crate) type OtioProbeResult = std::result::Result<(vv_core::MediaMeta, u64), String>;
pub(crate) fn parse_otio(
    bytes: &[u8],
    root: &Path,
    probe: &mut dyn FnMut(&Path) -> OtioProbeResult,
    on_total: &mut dyn FnMut(usize),
) -> Result<(Project, Vec<String>)> {
    if bytes.len() as u64 > MAX_PROJECT {
        return Err(ApiError::invalid("Project exceeds the 8 MiB file limit"));
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::invalid("The OTIO file is not valid JSON"))?;
    let total = vv_core::otio::media_url_count(&value);
    if total > 64 {
        return Err(ApiError::invalid(
            "OTIO import currently supports at most 64 distinct media URLs",
        ));
    }
    on_total(total);
    let mut imported = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let measure = |title: &vv_core::TitleParams| vv_render::text::title_metrics(title);
        vv_core::otio::project_from_otio(&value, root, probe, Some(&measure))
    }))
    .map_err(|_| {
        ApiError::invalid("Native OTIO parsing failed; the current project was preserved")
    })?
    .map_err(|_| ApiError::invalid("The native engine could not import this OTIO timeline"))?;
    validate_root_media(&mut imported.project, root)?;
    validate_project(&imported.project)?;
    imported.project.refresh_clip_rates();
    let mut warnings: Vec<_> = imported
        .warnings
        .iter()
        .take(64)
        .map(|warning| otio_warning(warning).chars().take(512).collect::<String>())
        .collect();
    if imported.warnings.len() > 64 {
        warnings.push(format!(
            "{} further native import warnings were omitted",
            imported.warnings.len() - 64
        ));
    }
    Ok((imported.project, warnings))
}
fn validate_root_media(project: &mut Project, root: &Path) -> Result<()> {
    let dir = File::from(
        rustix::fs::open(
            root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| ApiError::io())?,
    );
    validate_root_media_in(project, root, &dir)
}
fn validate_root_media_in(project: &mut Project, root: &Path, dir: &File) -> Result<()> {
    for item in project.media_pool.values_mut() {
        if item.compound.is_some() {
            continue;
        }
        let path = if item.path.is_absolute() {
            item.path.clone()
        } else {
            root.join(&item.path)
        };
        let token = root_media_token(root, &path)?;
        let child;
        let entry = if let Some(name) = token.strip_prefix("Pasted Images/") {
            child = crate::clipboard_image::directory(dir)?;
            child.as_ref().map(|parent| (parent, name))
        } else {
            Some((dir, token.as_str()))
        };
        if let Some((parent, name)) = entry {
            match rustix::fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW) {
                Err(rustix::io::Errno::NOENT) => {}
                Err(_) => return Err(ApiError::io()),
                Ok(_) => {
                    open_root_media(root, dir, &path)?;
                }
            }
        }
        item.path = path;
    }
    Ok(())
}
fn otio_warning(warning: &vv_core::otio::OtioWarning) -> String {
    use vv_core::otio::OtioWarning::*;
    match warning {
        EffectIgnored { effect, clips } => format!("Effect {effect} was omitted on {clips} clips"),
        EffectPartlyIgnored { effect, clips } => {
            format!("Effect {effect} was only partly imported on {clips} clips")
        }
        SpeedNotApplied { clip, percent } => {
            format!("Speed {percent}% could not be applied to {clip}")
        }
        UnsupportedInStack { schema } | UnsupportedItem { schema } => {
            format!("Unsupported OTIO item {schema} was omitted")
        }
        TrackKindIgnored { .. } => "An unsupported track kind was omitted".into(),
        TransitionIgnored => "An unsupported transition was omitted".into(),
        ClipWithoutDuration { clip } => format!("Clip {clip} has no duration and was omitted"),
        Placeholder { clip } => format!("Clip {clip} became a disabled title placeholder"),
        ClipShorterThanAFrame { clip } => format!("Clip {clip} is shorter than one frame"),
        AudioOnlyOnVideoTrack { clip } => {
            format!("Audio-only clip {clip} was found on a video track")
        }
        UnsupportedReference { clip, .. } => {
            format!("Clip {clip} has an unsupported media reference")
        }
        UnsupportedUrl { .. } => "An unsupported media URL was omitted".into(),
        MediaUnreadable { path, .. } => format!(
            "Media {} was imported offline",
            vv_session::file_label(path)
        ),
    }
}

pub(crate) fn validate_project(project: &Project) -> Result<()> {
    if project.timelines.len() > 64
        || project.media_pool.len() > 10_000
        || project.folders.len() > 512
    {
        return Err(ApiError::invalid("Project exceeds web host limits"));
    }
    for (id, folder) in &project.folders {
        if folder.name.trim().is_empty()
            || folder.name.len() > 128
            || folder.name.chars().any(char::is_control)
        {
            return Err(ApiError::invalid("Invalid media folder name"));
        }
        let mut visited = std::collections::HashSet::from([id]);
        let mut ancestor = folder.parent;
        while let Some(parent) = ancestor {
            if !visited.insert(parent) {
                return Err(ApiError::invalid("Media folders contain a cycle"));
            }
            ancestor = project.folders.get(parent).and_then(|f| f.parent);
        }
    }
    let mut depths = std::collections::HashMap::new();
    for id in project.timelines.keys() {
        compound_depth(
            project,
            id,
            &mut std::collections::HashSet::new(),
            &mut depths,
        )?;
    }
    for (_, tl) in project.timelines.iter() {
        for channel in std::iter::once(&tl.master).chain(tl.tracks.iter().map(|t| &t.mix)) {
            if !channel.gain_db.is_finite()
                || !(vv_core::GAIN_DB_MIN..=vv_core::GAIN_DB_MAX).contains(&channel.gain_db)
                || !channel.pan.is_finite()
                || !(-1.0..=1.0).contains(&channel.pan)
            {
                return Err(ApiError::invalid(
                    "Project mixer parameters exceed the native ranges",
                ));
            }
            crate::audio::validate(&channel.effects)?;
        }
        let mut marker_ids = std::collections::HashSet::new();
        if tl.markers.len() > 4096
            || tl.markers.iter().any(|m| {
                !marker_ids.insert(m.id)
                    || m.id.0 == u64::MAX
                    || m.start < 0
                    || m.duration < 0
                    || m.start > 1_000_000_000 - m.duration
                    || m.note.len() > 4096
            })
        {
            return Err(ApiError::invalid("Project markers exceed supported ranges"));
        }
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
        if item
            .compound
            .is_some_and(|id| !project.timelines.contains_key(id))
        {
            return Err(ApiError::invalid(
                "Compound media refers to a missing timeline",
            ));
        }
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

fn compound_depth(
    project: &Project,
    id: vv_core::TimelineId,
    visiting: &mut std::collections::HashSet<vv_core::TimelineId>,
    known: &mut std::collections::HashMap<vv_core::TimelineId, u32>,
) -> Result<u32> {
    if let Some(depth) = known.get(&id) {
        return Ok(*depth);
    }
    if !visiting.insert(id) {
        return Err(ApiError::invalid(
            "Project contains a compound timeline cycle",
        ));
    }
    let timeline = project
        .timelines
        .get(id)
        .ok_or_else(|| ApiError::invalid("Compound timeline is missing"))?;
    let mut depth = 1;
    for clip in timeline.tracks.iter().flat_map(|t| &t.clips) {
        if let vv_core::ClipSource::Media(media) = clip.source
            && let Some(child) = project.media_pool.get(media).and_then(|m| m.compound)
        {
            depth = depth.max(1 + compound_depth(project, child, visiting, known)?);
        }
    }
    if depth > vv_core::MAX_COMPOUND_DEPTH {
        return Err(ApiError::invalid(
            "Project exceeds native compound nesting depth",
        ));
    }
    visiting.remove(&id);
    known.insert(id, depth);
    Ok(depth)
}

#[cfg(test)]
#[path = "tests/files.rs"]
mod tests;
