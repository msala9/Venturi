use crate::error::{ApiError, Result};
use std::collections::{HashMap, HashSet};
use vv_core::{
    Command, CommandLabel, FolderId, MediaFolder, MediaId, Project, TimelineId, pool::AddEntities,
};
use vv_session::Session;

pub struct Prepared {
    project: Project,
    name: String,
    reuse: HashMap<MediaId, MediaId>,
    top_level: Vec<bool>,
}
pub struct Report {
    pub timelines: Vec<TimelineId>,
    pub media: Vec<MediaId>,
    pub folder: Option<FolderId>,
}
pub fn prepare(
    current: &Project,
    mut imported: Project,
    name: &str,
    reuse_existing: bool,
) -> Result<Prepared> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 || name.chars().any(char::is_control) {
        return Err(ApiError::invalid(
            "Use a nonempty import name of at most 128 bytes",
        ));
    }
    crate::files::validate_project(&imported)?;
    for timeline in imported.timelines.values() {
        for track in &timeline.tracks {
            let ids: HashSet<_> = track.clips.iter().map(|clip| clip.id).collect();
            if track.crossings.iter().any(|crossing| {
                crossing.left_clip == crossing.right_clip
                    || !ids.contains(&crossing.left_clip)
                    || !ids.contains(&crossing.right_clip)
            }) {
                return Err(ApiError::invalid(
                    "Imported transitions refer to missing clips",
                ));
            }
            for clip in &track.clips {
                if matches!(clip.source, vv_core::ClipSource::Media(id) if !imported.media_pool.contains_key(id))
                {
                    return Err(ApiError::invalid("Imported clips refer to missing media"));
                }
                crate::presets::Preset {
                    version: 1,
                    name: "OTIO validation".into(),
                    attributes: vec![vv_core::attributes::Attribute::Fades],
                    anchor: vv_core::attributes::KeyframeAnchor::Start,
                    append_filters: false,
                    shortcut: None,
                    fps: timeline.fps,
                    resolution: timeline.resolution,
                    video: Some(Box::new(clip.clone())),
                    audio: None,
                }
                .validate()?;
            }
        }
    }
    let nested: HashSet<_> = imported
        .media_pool
        .values()
        .filter_map(|item| item.compound)
        .collect();
    let top_level: Vec<_> = imported
        .timelines
        .keys()
        .map(|id| !nested.contains(&id))
        .collect();
    let count = top_level.iter().filter(|top| **top).count();
    if count == 0 {
        return Err(ApiError::invalid(
            "The OTIO document contains no top-level timeline",
        ));
    }
    for (id, timeline) in imported.timelines.iter_mut() {
        if !nested.contains(&id) {
            timeline.name = if count == 1 {
                name.to_owned()
            } else {
                format!("{name} - {}", timeline.name)
            };
        }
        if timeline.name.trim().is_empty()
            || timeline.name.len() > 128
            || timeline.name.chars().any(char::is_control)
        {
            return Err(ApiError::invalid(
                "Imported timeline names exceed supported limits",
            ));
        }
    }
    let existing: HashMap<_, _> = current
        .media_pool
        .iter()
        .filter(|(_, item)| item.compound.is_none())
        .map(|(id, item)| (vv_session::file_label(&item.path), id))
        .collect();
    let reuse = if reuse_existing {
        imported
            .media_pool
            .iter()
            .filter(|(_, item)| item.compound.is_none())
            .filter_map(|(id, item)| {
                existing
                    .get(&vv_session::file_label(&item.path))
                    .map(|existing| (id, *existing))
            })
            .collect()
    } else {
        HashMap::new()
    };
    let prepared = Prepared {
        project: imported,
        name: name.to_owned(),
        reuse,
        top_level,
    };
    let mut trial = current.clone();
    let (mut add, _) = prepared.build(&mut trial);
    add.apply(&mut trial);
    crate::files::validate_project(&trial)?;
    Ok(prepared)
}
impl Prepared {
    fn build(&self, project: &mut Project) -> (AddEntities, Report) {
        let mut add = AddEntities::new(CommandLabel::ImportOtio);
        let folder = (self.project.media_pool.len() > self.reuse.len()).then(|| {
            add.folder(
                project,
                MediaFolder {
                    name: self.name.clone(),
                    parent: None,
                },
            )
        });
        let timelines =
            vv_core::pool::absorb(project, &mut add, self.project.clone(), &self.reuse, folder)
                .0
                .into_iter()
                .zip(&self.top_level)
                .filter_map(|(id, top)| top.then_some(id))
                .collect();
        let media = add.media_ids().collect();
        (
            add,
            Report {
                timelines,
                media,
                folder,
            },
        )
    }
    pub fn apply(self, session: &mut Session) -> Report {
        let (add, report) = self.build(&mut session.project);
        session.apply(Box::new(add));
        report
    }
}

#[cfg(test)]
#[path = "tests/otio.rs"]
mod tests;
