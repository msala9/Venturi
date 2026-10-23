use crate::{
    commands::{self, Operation},
    error::{ApiError, Result},
    files::Files,
};
use std::{collections::HashSet, path::PathBuf};
use vv_core::{Id, MediaId, TimelineId};
use vv_session::Session;

pub const MAX_MEDIA: usize = 256;

struct Sources {
    selected: Vec<MediaId>,
    witnesses: Vec<(PathBuf, String)>,
}

fn sources(session: &Session, files: &Files, ids: &[String]) -> Result<Sources> {
    if ids.is_empty() || ids.len() > MAX_MEDIA {
        return Err(ApiError::invalid("Place 1 to 256 project media items"));
    }
    let mut selected = Vec::with_capacity(ids.len());
    let mut seen = HashSet::new();
    let mut paths = HashSet::new();
    let mut witnesses = Vec::new();
    let mut clips = 0usize;
    for raw in ids {
        if raw.is_empty()
            || raw.len() > 20
            || raw.len() > 1 && raw.starts_with('0')
            || !raw.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(ApiError::invalid(
                "Media IDs must be unsigned decimal strings",
            ));
        }
        let media = MediaId::from_raw(raw.parse().map_err(|_| ApiError::missing())?);
        if !seen.insert(media) {
            return Err(ApiError::invalid(
                "A project media item cannot be placed twice in one batch",
            ));
        }
        let item = session
            .project
            .media_pool
            .get(media)
            .ok_or_else(ApiError::missing)?;
        clips = clips
            .saturating_add(usize::from(item.meta.has_video))
            .saturating_add(if item.meta.has_audio {
                item.meta.audio_stream_count()
            } else {
                0
            });
        if clips > 4096 {
            return Err(ApiError::invalid(
                "A project media placement supports at most 4096 new clips",
            ));
        }
        if item.compound.is_none() && paths.insert(item.path.clone()) {
            let file = files.media_file(&item.path).map_err(|_| offline())?;
            witnesses.push((item.path.clone(), crate::source::source_version(&file)?));
        }
        selected.push(media);
    }
    Ok(Sources {
        selected,
        witnesses,
    })
}

fn offline() -> ApiError {
    ApiError::conflict(
        "SOURCE_OFFLINE",
        "A selected project source is offline or unreadable; relink it before placing",
    )
}

fn unchanged(files: &Files, witnesses: &[(PathBuf, String)]) -> Result<()> {
    for (path, before) in witnesses {
        let file = files.media_file(path).map_err(|_| offline())?;
        if crate::source::source_version(&file)? != *before {
            return Err(ApiError::conflict(
                "SOURCE_CHANGED",
                "A selected project source changed during placement",
            ));
        }
    }
    Ok(())
}

pub fn place(
    session: &mut Session,
    files: &Files,
    timeline: TimelineId,
    operation: &Operation,
) -> Result<Vec<String>> {
    let Operation::PlaceProjectMedia {
        media_ids,
        start_frame,
        target,
        overwrite,
    } = operation
    else {
        return Err(ApiError::invalid("Choose project media placement"));
    };
    let Sources {
        selected,
        witnesses,
    } = sources(session, files, media_ids)?;
    let plan = commands::prepare_whole_media_placement(
        &session.project,
        timeline,
        &selected,
        *start_frame,
        target,
        *overwrite,
    )?;
    unchanged(files, &witnesses)?;
    Ok(plan
        .apply(session)
        .into_iter()
        .map(|clip| clip.0.to_string())
        .collect())
}

#[cfg(test)]
#[path = "tests/project_media_placement.rs"]
mod tests;
