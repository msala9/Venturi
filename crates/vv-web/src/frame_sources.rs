use crate::{
    error::{ApiError, Result},
    files::Files,
    media_roots::MediaRoots,
};
use std::{
    collections::BTreeMap,
    fs::File,
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use vv_core::{MediaId, MediaItem};
use vv_session::audio_render::{AudioSourceResolver, ResolvedAudioSource};
use vv_session::export::{
    ExportError, PreviewVideoSources, ResolvedVideoSource, VideoSourceResolver,
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Witness {
    lineage: Option<String>,
    version: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Manifest {
    sources: BTreeMap<String, Witness>,
}

pub struct FrameSources {
    roots: MediaRoots,
    touched: Mutex<Manifest>,
}

struct Resolver {
    sources: Arc<FrameSources>,
    proxies: PreviewVideoSources,
}
struct AudioResolver(Arc<FrameSources>);

struct Lease {
    _original: File,
    _proxy: Option<File>,
}

fn changed() -> ApiError {
    ApiError::conflict(
        "SOURCE_CHANGED",
        "Frame source changed; prepare the render again",
    )
}

fn native_error(error: ApiError) -> ExportError {
    ExportError::Failed(format!("{}: {}", error.1, error.2))
}

impl FrameSources {
    pub fn capture(files: &Files) -> Result<Self> {
        Ok(Self {
            roots: files.media_roots(),
            touched: Mutex::new(Manifest::default()),
        })
    }

    pub fn resolver(
        self: &Arc<Self>,
        proxies: &PreviewVideoSources,
    ) -> Arc<dyn VideoSourceResolver> {
        Arc::new(Resolver {
            sources: self.clone(),
            proxies: proxies.clone(),
        })
    }

    pub fn audio_resolver(self: &Arc<Self>) -> Arc<dyn AudioSourceResolver> {
        Arc::new(AudioResolver(self.clone()))
    }

    pub fn manifest(&self) -> Result<Manifest> {
        self.touched
            .lock()
            .map(|manifest| manifest.clone())
            .map_err(|_| ApiError::io())
    }

    pub fn validate(&self) -> Result<()> {
        self.validate_manifest(&self.manifest()?)
    }

    pub fn validate_manifest(&self, manifest: &Manifest) -> Result<()> {
        for (token, expected) in &manifest.sources {
            let (_, witness) = self.open(token)?;
            if witness != *expected {
                return Err(changed());
            }
        }
        Ok(())
    }

    fn open(&self, token: &str) -> Result<(File, Witness)> {
        let path = self.roots.path(token)?;
        if !vv_media::is_media_path(&path) {
            return Err(ApiError::invalid("Choose a supported native media source"));
        }
        let (_, lineage) = self.roots.entry(&path)?;
        let file = self.roots.open(&path)?;
        let version = crate::asset_store::stable_identity(&file)?;
        self.roots.validate_file(&path, &file)?;
        let (_, current_lineage) = self.roots.entry(&path)?;
        if lineage != current_lineage || version != crate::asset_store::stable_identity(&file)? {
            return Err(changed());
        }
        Ok((file, Witness { lineage, version }))
    }

    fn original(&self, item: &MediaItem) -> Result<File> {
        self.original_path(&item.path)
    }

    fn original_path(&self, path: &Path) -> Result<File> {
        let token = self.roots.token(path)?;
        let (file, witness) = self.open(&token)?;
        let mut touched = self.touched.lock().map_err(|_| ApiError::io())?;
        match touched.sources.get(&token) {
            Some(first) if first != &witness => return Err(changed()),
            Some(_) => {}
            None => {
                touched.sources.insert(token, witness);
            }
        }
        Ok(file)
    }
}

impl AudioSourceResolver for AudioResolver {
    fn resolve(&self, original: &Path) -> std::result::Result<ResolvedAudioSource, ExportError> {
        let file = self.0.original_path(original).map_err(native_error)?;
        Ok(ResolvedAudioSource {
            path: PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd())),
            lease: Arc::new(file),
        })
    }
}

fn proxy_file(path: &Path) -> Result<File> {
    let value = path.to_str().ok_or_else(changed)?;
    let fd = value.strip_prefix("/proc/self/fd/").ok_or_else(changed)?;
    let number = fd.parse::<u32>().map_err(|_| changed())?;
    if number.to_string() != fd {
        return Err(changed());
    }
    let file = File::from(
        rustix::fs::open(
            path,
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NONBLOCK | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|_| changed())?,
    );
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(changed());
    }
    Ok(file)
}

impl VideoSourceResolver for Resolver {
    fn resolve(
        &self,
        media: MediaId,
        item: &MediaItem,
        decode_path: &Path,
    ) -> std::result::Result<ResolvedVideoSource, ExportError> {
        let original = self.sources.original(item).map_err(native_error)?;
        let proxy = if decode_path == item.path {
            None
        } else {
            if self.proxies.get(&media).map(PathBuf::as_path) != Some(decode_path) {
                return Err(native_error(changed()));
            }
            Some(proxy_file(decode_path).map_err(native_error)?)
        };
        let selected = proxy.as_ref().unwrap_or(&original);
        let path = PathBuf::from(format!("/proc/self/fd/{}", selected.as_raw_fd()));
        Ok(ResolvedVideoSource {
            path,
            lease: Arc::new(Lease {
                _original: original,
                _proxy: proxy,
            }),
        })
    }
}

#[cfg(test)]
#[path = "tests/frame_sources.rs"]
mod tests;
