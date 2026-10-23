use crate::{
    asset_jobs::PreparedMedia,
    catalog,
    error::{ApiError, Result},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use vv_core::{self as core, Command, FolderId, Id, MediaId};
use vv_session::Session;

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum ImportRequest {
    Files {
        project_epoch: String,
        if_generation: String,
        path_tokens: Vec<String>,
        #[serde(default)]
        parent: Option<String>,
    },
    Tree {
        project_epoch: String,
        if_generation: String,
        directory_token: String,
        #[serde(default)]
        parent: Option<String>,
    },
}
impl ImportRequest {
    pub fn binding(&self) -> (&str, &str) {
        match self {
            Self::Files {
                project_epoch,
                if_generation,
                ..
            }
            | Self::Tree {
                project_epoch,
                if_generation,
                ..
            } => (project_epoch, if_generation),
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelinkRequest {
    pub project_epoch: String,
    pub if_generation: String,
    pub action: RelinkAction,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RelinkAction {
    Chosen {
        items: Vec<catalog::Relink>,
    },
    ByName {
        directory_token: String,
        scope: RelinkScope,
    },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RelinkScope {
    Selected { media_ids: Vec<String> },
    Folder { folder_id: String },
}
#[derive(Clone)]
pub(crate) struct Target {
    pub id: MediaId,
    pub item: core::MediaItem,
}
pub(crate) enum Work {
    Import {
        tokens: Vec<String>,
        directory: Option<String>,
        parent: Option<String>,
    },
    Relink {
        targets: Vec<Target>,
        chosen: Option<Vec<catalog::Relink>>,
        directory: Option<String>,
    },
}
impl Work {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Import { .. } => "project_import",
            Self::Relink { .. } => "project_relink",
        }
    }
    pub fn reservation(&self) -> usize {
        match self {
            Self::Import {
                directory: Some(_), ..
            } => 256,
            Self::Import { tokens, .. } => tokens.len(),
            Self::Relink { targets, .. } => targets.len() * 2,
        }
    }
}
#[derive(Clone)]
pub(crate) struct Folder {
    pub name: String,
    pub parent_index: Option<usize>,
}
#[derive(Clone)]
pub(crate) enum Data {
    Import {
        parent: Option<String>,
        directory: Option<String>,
        folders: Vec<Folder>,
        item_folders: HashMap<String, Option<usize>>,
    },
    Relink {
        chosen: bool,
        directory: Option<String>,
        mapping: Vec<(MediaId, String)>,
        not_found: Vec<String>,
        skipped: Vec<String>,
        ambiguous_count: usize,
    },
}
pub(crate) struct Payload {
    pub items: Vec<PreparedMedia>,
    pub errors: Vec<Value>,
    pub first_error: Option<ApiError>,
    pub data: Data,
}

fn id(raw: &str) -> Result<u64> {
    if raw.is_empty()
        || raw.len() > 20
        || raw.len() > 1 && raw.starts_with('0')
        || !raw.bytes().all(|v| v.is_ascii_digit())
    {
        return Err(ApiError::invalid("Use canonical decimal entity IDs"));
    }
    raw.parse().map_err(|_| ApiError::missing())
}
fn parent(session: &Session, raw: &Option<String>) -> Result<Option<FolderId>> {
    raw.as_deref()
        .map(|raw| {
            let id = FolderId::from_raw(id(raw)?);
            session
                .project
                .folders
                .contains_key(id)
                .then_some(id)
                .ok_or_else(ApiError::missing)
        })
        .transpose()
}
pub(crate) fn import_work(session: &Session, request: &ImportRequest) -> Result<Work> {
    let (tokens, directory, raw) = match request {
        ImportRequest::Files {
            path_tokens,
            parent,
            ..
        } => (
            crate::files::project_media_tokens(path_tokens)?,
            None,
            parent,
        ),
        ImportRequest::Tree {
            directory_token,
            parent,
            ..
        } => {
            crate::files::validate_directory_token(directory_token)?;
            (vec![], Some(directory_token.clone()), parent)
        }
    };
    parent(session, raw)?;
    Ok(Work::Import {
        tokens,
        directory,
        parent: raw.clone(),
    })
}
#[cfg(test)]
pub(crate) fn relink_work(session: &Session, action: &RelinkAction) -> Result<Work> {
    relink_work_inner(session, action, None)
}
pub(crate) fn relink_work_with_roots(
    session: &Session,
    action: &RelinkAction,
    roots: &crate::media_roots::MediaRoots,
) -> Result<Work> {
    relink_work_inner(session, action, Some(roots))
}
fn relink_work_inner(
    session: &Session,
    action: &RelinkAction,
    roots: Option<&crate::media_roots::MediaRoots>,
) -> Result<Work> {
    let (raw, chosen, directory) = match action {
        RelinkAction::Chosen { items } => {
            for item in items {
                if item.path_token.starts_with("library://") {
                    let path = roots
                        .ok_or_else(|| ApiError::invalid("Shared originals are not configured"))?
                        .path(&item.path_token)?;
                    if !vv_media::is_media_path(&path) {
                        return Err(ApiError::invalid("Choose approved native shared media"));
                    }
                } else {
                    crate::files::project_media_tokens(std::slice::from_ref(&item.path_token))?;
                }
            }
            (
                items.iter().map(|v| v.media_id.clone()).collect::<Vec<_>>(),
                Some(items.clone()),
                None,
            )
        }
        RelinkAction::ByName {
            directory_token,
            scope,
        } => {
            crate::files::validate_directory_token(directory_token)?;
            let raw = match scope {
                RelinkScope::Selected { media_ids } => media_ids.clone(),
                RelinkScope::Folder { folder_id } => {
                    let folder = parent(session, &Some(folder_id.clone()))?.unwrap();
                    session
                        .project
                        .media_in_folder(folder)
                        .into_iter()
                        .map(|id| id.raw().to_string())
                        .collect()
                }
            };
            (raw, None, Some(directory_token.clone()))
        }
    };
    if raw.is_empty() || raw.len() > 64 {
        return Err(ApiError::invalid("Relink 1 to 64 project media items"));
    }
    let mut seen = HashSet::new();
    let mut targets = Vec::new();
    for raw in raw {
        let id = MediaId::from_raw(id(&raw)?);
        if !seen.insert(id) {
            return Err(ApiError::invalid("Relink targets must be distinct"));
        }
        let item = session
            .project
            .media_pool
            .get(id)
            .ok_or_else(ApiError::missing)?;
        if chosen.is_some() && item.compound.is_some() {
            return Err(ApiError::invalid(
                "Compound timelines cannot be relinked to files",
            ));
        }
        targets.push(Target {
            id,
            item: item.clone(),
        });
    }
    Ok(Work::Relink {
        targets,
        chosen,
        directory,
    })
}

pub(crate) fn commit(
    session: &mut Session,
    jobs: &crate::asset_jobs::Jobs,
    job: &str,
    epoch: &str,
    generation: &str,
    kind: &str,
) -> Result<Value> {
    let payload = jobs.project_media_payload(job, epoch, generation, kind)?;
    match &payload.data {
        Data::Import {
            parent: raw,
            folders,
            item_folders,
            ..
        } => {
            if payload.items.is_empty() && folders.is_empty() {
                return Err(payload.first_error.unwrap_or_else(|| {
                    ApiError::invalid("No readable project media were prepared")
                }));
            }
            let parent = parent(session, raw)?;
            let mut existing = HashMap::new();
            for (id, item) in session
                .project
                .media_pool
                .iter()
                .filter(|(_, item)| item.compound.is_none())
            {
                existing.entry(item.path.clone()).or_insert(id);
            }
            let build = |project: &mut core::Project| {
                let mut add = core::AddEntities::new(core::CommandLabel::ImportMedia);
                let mut folder_ids = Vec::new();
                for folder in folders {
                    let parent = folder
                        .parent_index
                        .map(|index| folder_ids[index])
                        .or(parent);
                    let found = project
                        .folders
                        .iter()
                        .find(|(_, f)| f.name == folder.name && f.parent == parent)
                        .map(|(id, _)| id);
                    folder_ids.push(found.unwrap_or_else(|| {
                        add.folder(
                            project,
                            core::MediaFolder {
                                name: folder.name.clone(),
                                parent,
                            },
                        )
                    }));
                }
                let mut media_ids = Vec::new();
                let mut added = 0;
                for item in &payload.items {
                    let folder = item_folders
                        .get(&item.path_token)
                        .copied()
                        .flatten()
                        .map(|index| folder_ids[index])
                        .or(parent);
                    let id = existing.get(&item.path).copied().unwrap_or_else(|| {
                        added += 1;
                        add.media(
                            project,
                            core::MediaItem {
                                path: item.path.clone(),
                                meta: item.meta.clone(),
                                content_hash: item.content_hash,
                                compound: None,
                                folder,
                            },
                        )
                    });
                    media_ids.push(id);
                }
                (add, media_ids, folder_ids, added)
            };
            let mut trial = session.project.clone();
            let (mut command, _, _, _) = build(&mut trial);
            command.apply(&mut trial);
            crate::files::validate_project(&trial)?;
            jobs.accept_project_media(job, epoch, generation, kind)?;
            let (command, media, folders, new_count) = build(&mut session.project);
            let changed = !command.is_empty();
            if changed {
                session.apply(Box::new(command));
            }
            Ok(
                json!({"media_ids":media.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>(),"folder_ids":folders.iter().map(|id|id.raw().to_string()).collect::<Vec<_>>(),"errors":payload.errors,"changed":changed,"new_count":new_count,"reused_count":media.len()-new_count}),
            )
        }
        Data::Relink {
            chosen,
            mapping,
            not_found,
            skipped,
            ambiguous_count,
            ..
        } => {
            if *chosen && !payload.errors.is_empty() {
                return Err(payload.first_error.unwrap_or_else(|| {
                    ApiError::invalid("A chosen replacement could not be prepared")
                }));
            }
            let mut replacements = Vec::new();
            for (id, token) in mapping {
                let item = payload
                    .items
                    .iter()
                    .find(|item| &item.path_token == token)
                    .ok_or_else(ApiError::missing)?;
                replacements.push((*id, item.clone()));
            }
            let command = catalog::prepared_relink(session, &replacements)?;
            jobs.accept_project_media(job, epoch, generation, kind)?;
            let changed = command.is_some();
            if let Some(command) = command {
                session.apply(command);
            }
            Ok(
                json!({"relinked_media_ids":replacements.iter().map(|(id,_)|id.raw().to_string()).collect::<Vec<_>>(),"not_found":not_found,"skipped":skipped,"errors":payload.errors,"ambiguous_count":ambiguous_count,"changed":changed}),
            )
        }
    }
}

#[cfg(test)]
#[path = "tests/project_media.rs"]
mod tests;
