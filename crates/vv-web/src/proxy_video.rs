use crate::{
    error::{ApiError, Result},
    preview::FrameSnapshot,
    proxy::{Lease, Manager},
    source::SourceSpec,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use vv_core::{ClipSource, Id};

pub struct Selection {
    pub sources: vv_session::export::PreviewVideoSources,
    pub tag: String,
    leases: Vec<Lease>,
}
impl Default for Selection {
    fn default() -> Self {
        Self {
            sources: Default::default(),
            tag: "originals".into(),
            leases: vec![],
        }
    }
}
impl Selection {
    pub fn capture(manager: &Manager, snapshot: &FrameSnapshot) -> Result<Self> {
        let settings = manager.settings()?;
        if settings["enabled"] != true {
            return Ok(Self::default());
        }
        let mut pending = vec![snapshot.timeline];
        let mut visited = HashSet::new();
        let mut ids = BTreeSet::new();
        while let Some(id) = pending.pop() {
            if !visited.insert(id) {
                continue;
            }
            let tl = snapshot
                .project
                .timelines
                .get(id)
                .ok_or_else(ApiError::missing)?;
            for clip in tl
                .tracks
                .iter()
                .filter(|track| track.kind == vv_core::TrackKind::Video)
                .flat_map(|track| &track.clips)
            {
                if let ClipSource::Media(id) = &clip.source {
                    let id = *id;
                    let item = snapshot
                        .project
                        .media_pool
                        .get(id)
                        .ok_or_else(ApiError::missing)?;
                    if let Some(child) = item.compound {
                        pending.push(child);
                    } else if item.meta.has_video && !item.meta.is_image() {
                        ids.insert(id.raw());
                    }
                }
            }
        }
        let mut selection = Self::default();
        let mut hash = Sha256::new();
        hash.update(settings["quality"].as_str().unwrap_or("medium").as_bytes());
        for raw in ids {
            let id = vv_core::MediaId::from_raw(raw);
            let item = &snapshot.project.media_pool[id];
            let Ok(fd) = rustix::fs::open(
                &item.path,
                rustix::fs::OFlags::RDONLY
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::NONBLOCK
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::empty(),
            ) else {
                continue;
            };
            let file = std::fs::File::from(fd);
            if !file.metadata().is_ok_and(|meta| meta.is_file()) {
                continue;
            }
            let spec = SourceSpec {
                file,
                epoch: snapshot.query.project_epoch.clone(),
                media_id: id.raw().to_string(),
                meta: item.meta.clone(),
            };
            if let Ok(Some(lease)) = manager.resolve(&spec, &item.path) {
                lease.validate()?;
                let path = lease.path();
                let proxy = std::fs::File::open(&path).map_err(|_| ApiError::io())?;
                hash.update(id.raw().to_le_bytes());
                hash.update(lease.source_version().as_bytes());
                hash.update(crate::source::source_version(&proxy)?.as_bytes());
                selection.sources.insert(id, path);
                selection.leases.push(lease);
            }
        }
        selection.tag = format!("proxy:{:x}", hash.finalize());
        Ok(selection)
    }
    pub fn validate(&self) -> Result<()> {
        for lease in &self.leases {
            lease.validate()?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/proxy_video.rs"]
mod tests;
