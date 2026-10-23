use crate::{
    error::{ApiError, Result},
    files::Files,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use vv_core::{self as core, Command, FolderId, Id, MediaId};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    NewFolder {
        name: String,
        parent: Option<String>,
    },
    RenameFolder {
        folder: String,
        name: String,
    },
    MoveFolder {
        folder: String,
        parent: Option<String>,
    },
    DeleteFolder {
        folder: String,
    },
    MoveMedia {
        media_ids: Vec<String>,
        folder: Option<String>,
    },
    RemoveMedia {
        media_ids: Vec<String>,
    },
    Relink {
        items: Vec<Relink>,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Relink {
    pub media_id: String,
    pub path_token: String,
}

fn folder(session: &Session, raw: &str) -> Result<FolderId> {
    let id = FolderId::from_raw(raw.parse().map_err(|_| ApiError::missing())?);
    session
        .project
        .folders
        .contains_key(id)
        .then_some(id)
        .ok_or_else(ApiError::missing)
}
fn parent(session: &Session, raw: &Option<String>) -> Result<Option<FolderId>> {
    raw.as_deref().map(|id| folder(session, id)).transpose()
}
fn media(session: &Session, values: &[String]) -> Result<Vec<MediaId>> {
    if values.is_empty() || values.len() > 256 {
        return Err(ApiError::invalid("Choose between 1 and 256 media items"));
    }
    let mut ids = HashSet::new();
    values
        .iter()
        .map(|raw| {
            let id = MediaId::from_raw(raw.parse().map_err(|_| ApiError::missing())?);
            if !ids.insert(id) || !session.project.media_pool.contains_key(id) {
                return Err(ApiError::invalid("Media items must exist and be distinct"));
            }
            Ok(id)
        })
        .collect()
}
fn name(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(ApiError::invalid(
            "Use a folder name of 1–128 bytes without control characters",
        ));
    }
    Ok(())
}
fn unlocked(session: &Session, selected: &[MediaId]) -> Result<()> {
    for timeline in session.project.timelines.values() {
        for track in &timeline.tracks {
            if track.locked
                && track.clips.iter().any(
                    |c| matches!(c.source,core::ClipSource::Media(id) if selected.contains(&id)),
                )
            {
                return Err(ApiError::conflict(
                    "TRACK_LOCKED",
                    "A locked track uses selected media",
                ));
            }
        }
    }
    Ok(())
}

pub fn edit(session: &mut Session, _files: &Files, edit: &Edit) -> Result<()> {
    if session.path().is_none() {
        return Err(ApiError::invalid("Create or open a project first"));
    }
    let command: Box<dyn Command> = match edit {
        Edit::NewFolder {
            name: value,
            parent: raw,
        } => {
            name(value)?;
            let parent = parent(session, raw)?;
            if session.project.folders.len() >= 512 {
                return Err(ApiError::invalid("The project already has 512 folders"));
            }
            let mut add = core::AddEntities::new(core::CommandLabel::NewFolder);
            add.folder(
                &mut session.project,
                core::MediaFolder {
                    name: value.clone(),
                    parent,
                },
            );
            Box::new(add)
        }
        Edit::RenameFolder {
            folder: raw,
            name: value,
        } => {
            name(value)?;
            let id = folder(session, raw)?;
            if session.project.folders[id].name == *value {
                return Ok(());
            }
            Box::new(core::RenameFolder::new(id, value.clone()))
        }
        Edit::MoveFolder {
            folder: raw,
            parent: destination,
        } => {
            let id = folder(session, raw)?;
            let parent = parent(session, destination)?;
            if !session.project.can_move_folder(id, parent) {
                return Err(ApiError::invalid(
                    "A folder cannot contain itself or an ancestor",
                ));
            }
            if session.project.folders[id].parent == parent {
                return Ok(());
            }
            Box::new(core::MoveFolder::new(id, parent))
        }
        Edit::DeleteFolder { folder: raw } => {
            Box::new(core::DeleteFolder::new(folder(session, raw)?))
        }
        Edit::MoveMedia {
            media_ids,
            folder: raw,
        } => {
            let mut ids = media(session, media_ids)?;
            let parent = parent(session, raw)?;
            ids.retain(|id| session.project.media_pool[*id].folder != parent);
            if ids.is_empty() {
                return Ok(());
            }
            Box::new(core::SetMediaFolder::new(ids, parent))
        }
        Edit::RemoveMedia { media_ids } => {
            let ids = media(session, media_ids)?;
            unlocked(session, &ids)?;
            for id in &ids {
                if let Some(child) = session.project.media_pool[*id].compound
                    && session.project.timelines[child]
                        .tracks
                        .iter()
                        .any(|t| t.locked && !t.clips.is_empty())
                {
                    return Err(ApiError::conflict(
                        "TRACK_LOCKED",
                        "A selected compound contains a locked track",
                    ));
                }
            }
            Box::new(core::CompositeCommand::new(
                core::CommandLabel::RemoveMedia,
                ids.into_iter()
                    .map(|id| Box::new(core::RemoveMedia::new(id)) as Box<dyn Command>)
                    .collect(),
            ))
        }
        Edit::Relink { .. } => {
            return Err(ApiError::conflict(
                "MEDIA_IMPORT_PREPARATION_REQUIRED",
                "Prepare replacement media outside the session before relinking",
            ));
        }
    };
    let mut trial = session.project.clone();
    let mut command = command;
    command.apply(&mut trial);
    crate::files::validate_project(&trial)?;
    command.undo(&mut trial);
    session.apply(command);
    Ok(())
}

pub(crate) fn prepared_relink(
    session: &Session,
    replacements: &[(MediaId, crate::asset_jobs::PreparedMedia)],
) -> Result<Option<Box<dyn Command>>> {
    if session.path().is_none() {
        return Err(ApiError::invalid("Create or open a project first"));
    }
    if replacements.is_empty() {
        return Ok(None);
    }
    if replacements.len() > 64 {
        return Err(ApiError::invalid("Relink between 1 and 64 media items"));
    }
    let ids = media(
        session,
        &replacements
            .iter()
            .map(|(id, _)| id.raw().to_string())
            .collect::<Vec<_>>(),
    )?;
    unlocked(session, &ids)?;
    let mut commands: Vec<Box<dyn Command>> = Vec::new();
    for (id, replacement) in replacements {
        if session.project.media_pool[*id].compound.is_some() {
            return Err(ApiError::invalid(
                "Compound timelines cannot be relinked to files",
            ));
        }
        for timeline in session.project.timelines.values() {
            for track in &timeline.tracks {
                for clip in &track.clips {
                    if matches!(clip.source, core::ClipSource::Media(media) if media == *id)
                        && match track.kind {
                            core::TrackKind::Video => !replacement.meta.has_video,
                            core::TrackKind::Audio => {
                                !replacement.meta.has_audio
                                    || clip.audio_stream_index
                                        >= replacement.meta.audio_stream_count()
                            }
                        }
                    {
                        return Err(ApiError::invalid(
                            "Replacement media lacks a stream used by the timeline",
                        ));
                    }
                }
            }
        }
        let old = &session.project.media_pool[*id];
        if old.path != replacement.path
            || serde_json::to_value(&old.meta).map_err(|_| ApiError::io())?
                != serde_json::to_value(&replacement.meta).map_err(|_| ApiError::io())?
            || old.content_hash != replacement.content_hash
        {
            commands.push(Box::new(core::SetMediaPath::new(
                *id,
                replacement.path.clone(),
                replacement.content_hash,
                Some(replacement.meta.clone()),
            )));
        }
    }
    if commands.is_empty() {
        return Ok(None);
    }
    let mut command = core::CompositeCommand::new(core::CommandLabel::RelinkMedia, commands);
    let mut trial = session.project.clone();
    command.apply(&mut trial);
    crate::files::validate_project(&trial)?;
    for timeline in trial.timelines.values() {
        for clip in timeline.tracks.iter().flat_map(|t| &t.clips) {
            if let core::ClipSource::Media(id) = clip.source
                && ids.contains(&id)
                && let Some(item) = trial.media_pool.get(id)
                && !item.meta.is_image()
                && (clip.source_out() > item.meta.duration_frames
                    || clip.freeze.is_some_and(|f| f >= item.meta.duration_frames))
            {
                return Err(ApiError::invalid(
                    "Replacement media does not cover an existing clip source range",
                ));
            }
        }
    }
    command.undo(&mut trial);
    Ok(Some(Box::new(command)))
}

#[cfg(test)]
#[path = "tests/catalog.rs"]
mod tests;
