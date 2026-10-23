use super::*;
use crate::project_media::{Data, Folder, Work as Input};

pub(super) struct Prepared {
    pub data: Data,
    witnesses: Vec<OtioWitness>,
    tree: Option<crate::files::SourceTreeWitness>,
}
impl Prepared {
    pub fn validate(&self, inner: &Inner) -> Result<()> {
        for witness in &self.witnesses {
            witness.validate(inner)?;
        }
        if let Some(tree) = &self.tree {
            tree.validate(&inner.root, &inner.directory, &AtomicBool::new(false))?;
        }
        Ok(())
    }
    pub fn retained(&self) -> usize {
        self.witnesses.iter().filter(|w| w.file.is_some()).count()
    }
    pub fn value(&self, items: &[ImportFile], errors: &[Value]) -> Value {
        match &self.data {
            Data::Import {
                parent,
                directory,
                folders,
                item_folders,
            } => {
                json!({"mode":if directory.is_some(){"tree"}else{"files"},"parent":parent,"directory_token":directory,
                "folders":folders.iter().map(|folder|json!({"name":folder.name,"parent_index":folder.parent_index})).collect::<Vec<_>>(),
                "items":items.iter().map(|file|json!({"path_token":file.item.path_token,"name":label(&file.item.path_token),"state":"ready","folder_index":item_folders.get(&file.item.path_token).copied().flatten()})).collect::<Vec<_>>(),"errors":errors})
            }
            Data::Relink {
                chosen,
                directory,
                mapping,
                not_found,
                skipped,
                ambiguous_count,
            } => json!({"mode":if *chosen{"chosen"}else{"by_name"},"directory_token":directory,
                "items":mapping.iter().map(|(id,token)|{use vv_core::Id;json!({"media_id":id.raw().to_string(),"path_token":token,"name":label(token),"state":"ready"})}).collect::<Vec<_>>(),
                "errors":errors,"not_found":not_found,"skipped":skipped,"ambiguous_count":ambiguous_count}),
        }
    }
}
fn label(token: &str) -> &str {
    token.rsplit('/').next().unwrap_or(token)
}
fn progress(inner: &Inner, work: &Work, done: usize, total: usize) {
    if let Ok(mut jobs) = inner.jobs.lock()
        && let Some(job) = jobs.iter_mut().find(|job| job.id == work.id)
    {
        job.import_completed = done;
        job.otio_probe_total = Some(total);
    }
}
fn remaining(start: Instant, budget: Duration, cancel: &AtomicBool) -> Result<Duration> {
    if cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    let remaining = budget.saturating_sub(start.elapsed());
    if remaining.is_zero() {
        return Err(ApiError::conflict(
            "MEDIA_IMPORT_BUDGET",
            "The project media preparation budget was exhausted",
        ));
    }
    Ok(remaining)
}
fn failure(
    prepared: &mut PreparedImport,
    token: Option<&str>,
    name: &str,
    id: Option<vv_core::MediaId>,
    error: ApiError,
) {
    use vv_core::Id;
    let mut value = json!({"path_token":token,"name":name,"code":error.1,"message":error.2,"status":error.0.as_u16()});
    if let Some(id) = id {
        value["media_id"] = json!(id.raw().to_string());
    }
    prepared.errors.push(value);
    if prepared.first_error.is_none() {
        prepared.first_error = Some(error);
    }
}
pub(super) fn run(
    inner: &Inner,
    work: &Work,
    input: &Input,
    budget: Duration,
) -> Result<PreparedImport> {
    use vv_core::Id;
    project_root(inner)?;
    let start = Instant::now();
    let mut prepared = PreparedImport {
        items: vec![],
        errors: vec![],
        first_error: None,
        project: None,
    };
    let mut witnesses = Vec::new();
    let mut tree = None;
    let data = match input {
        Input::Import {
            tokens,
            directory,
            parent,
        } => {
            let mut folders = Vec::new();
            let mut item_folders = HashMap::new();
            let tokens = if let Some(directory) = directory {
                let scan = crate::files::scan_project_media_tree(
                    &inner.root,
                    &inner.directory,
                    directory,
                    &work.cancel,
                )?;
                folders = scan
                    .tree
                    .folders
                    .into_iter()
                    .map(|(name, parent_index)| Folder { name, parent_index })
                    .collect();
                let mut tokens = Vec::new();
                for (path, folder) in scan.tree.files {
                    let token = crate::files::root_media_token(&inner.root, &path)?;
                    item_folders.insert(token.clone(), folder);
                    tokens.push(token);
                }
                tree = Some(scan.witness);
                tokens
            } else {
                tokens.clone()
            };
            progress(inner, work, 0, tokens.len());
            for (index, token) in tokens.iter().enumerate() {
                let witness = if directory.is_none() {
                    Some(otio_witness(inner, token)?)
                } else {
                    None
                };
                let result = remaining(start, budget, &work.cancel).and_then(|remaining| {
                    prepare_import_file(inner, token, &work.cancel, remaining)
                });
                if work.cancel.load(Ordering::Acquire) {
                    return Err(canceled());
                }
                match result {
                    Ok(file) => prepared.items.push(file),
                    Err(error) => {
                        failure(&mut prepared, Some(token), label(token), None, error);
                        if let Some(witness) = witness {
                            witnesses.push(witness);
                        }
                    }
                }
                progress(inner, work, index + 1, tokens.len());
            }
            Data::Import {
                parent: parent.clone(),
                directory: directory.clone(),
                folders,
                item_folders,
            }
        }
        Input::Relink {
            targets,
            chosen,
            directory,
        } => {
            let mut mapping = Vec::new();
            let mut skipped = Vec::new();
            let mut not_found = Vec::new();
            let mut ambiguous_count = 0;
            let mut wanted = Vec::new();
            if let Some(chosen) = chosen {
                for item in chosen {
                    let target = targets
                        .iter()
                        .find(|target| target.id.raw().to_string() == item.media_id)
                        .ok_or_else(ApiError::missing)?;
                    wanted.push((target.id, item.path_token.clone()));
                }
            } else {
                let mut offline = Vec::new();
                for target in targets {
                    remaining(start, budget, &work.cancel)?;
                    if target.item.compound.is_some() {
                        skipped.push(target.id.raw().to_string());
                        continue;
                    }
                    let reachable = if let Ok(token) =
                        crate::files::root_media_token(&inner.root, &target.item.path)
                    {
                        let witness = otio_witness(inner, &token)?;
                        let reachable = witness.entry.is_some();
                        witnesses.push(witness);
                        reachable
                    } else {
                        false
                    };
                    if reachable {
                        skipped.push(target.id.raw().to_string());
                    } else {
                        offline.push(target);
                    }
                }
                if !offline.is_empty() {
                    let scan = crate::files::scan_relink_tree(
                        &inner.root,
                        &inner.directory,
                        directory.as_deref().ok_or_else(ApiError::missing)?,
                        &work.cancel,
                    )?;
                    let mut candidates = scan
                        .tree
                        .files
                        .into_iter()
                        .map(|(path, _)| {
                            path.strip_prefix(&inner.root)
                                .ok()
                                .and_then(|path| path.to_str())
                                .map(str::to_owned)
                                .ok_or_else(ApiError::missing)
                        })
                        .collect::<Result<Vec<_>>>()?;
                    candidates.sort_by(|a, b| {
                        a.matches('/')
                            .count()
                            .cmp(&b.matches('/').count())
                            .then_with(|| a.cmp(b))
                    });
                    for target in offline {
                        let name = target
                            .item
                            .path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .ok_or_else(ApiError::missing)?;
                        let matches = candidates
                            .iter()
                            .filter(|token| label(token) == name)
                            .collect::<Vec<_>>();
                        if let Some(token) = matches.first() {
                            let depth = token.matches('/').count();
                            if matches
                                .iter()
                                .filter(|token| token.matches('/').count() == depth)
                                .count()
                                > 1
                            {
                                ambiguous_count += 1;
                            }
                            wanted.push((target.id, (*token).clone()));
                        } else {
                            not_found.push(target.id.raw().to_string());
                        }
                    }
                    tree = Some(scan.witness);
                }
            }
            progress(inner, work, 0, wanted.len());
            let mut probed = HashMap::<String, usize>::new();
            for (index, (id, token)) in wanted.iter().enumerate() {
                let result = if let Some(position) = probed.get(token) {
                    Ok(*position)
                } else {
                    remaining(start, budget, &work.cancel)
                        .and_then(|remaining| {
                            prepare_import_file(inner, token, &work.cancel, remaining)
                        })
                        .map(|file| {
                            let index = prepared.items.len();
                            prepared.items.push(file);
                            probed.insert(token.clone(), index);
                            index
                        })
                };
                if work.cancel.load(Ordering::Acquire) {
                    return Err(canceled());
                }
                match result {
                    Ok(_) => mapping.push((*id, token.clone())),
                    Err(error) => {
                        failure(&mut prepared, Some(token), label(token), Some(*id), error)
                    }
                }
                progress(inner, work, index + 1, wanted.len());
            }
            Data::Relink {
                chosen: chosen.is_some(),
                directory: directory.clone(),
                mapping,
                not_found,
                skipped,
                ambiguous_count,
            }
        }
    };
    prepared.project = Some(Prepared {
        data,
        witnesses,
        tree,
    });
    if work.cancel.load(Ordering::Acquire) {
        return Err(canceled());
    }
    prepared.validate(inner)?;
    Ok(prepared)
}
