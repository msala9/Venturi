use crate::{
    error::{ApiError, Result},
    files::Files,
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
};
use vv_core::{self as core, Id};
use vv_session::Session;

const MAX_BYTES: u64 = 4 * 1024 * 1024;
#[derive(Clone, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Known {
    pub model: Option<String>,
    pub prompt: Option<String>,
    pub seed: Option<String>,
}
#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Rating {
    #[default]
    Unrated,
    Favorite,
    Rejected,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    content_hash: String,
    version: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Take {
    shot_id: Option<String>,
    label: String,
    rating: Rating,
    metadata: Option<Known>,
    source_name: String,
    binding: Binding,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    shots: BTreeMap<String, String>,
    takes: BTreeMap<String, Take>,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            shots: BTreeMap::new(),
            takes: BTreeMap::new(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    NewShot {
        id: String,
        name: String,
    },
    RenameShot {
        id: String,
        name: String,
    },
    DeleteShot {
        id: String,
    },
    SetTake {
        media_id: String,
        shot_id: Option<String>,
        label: String,
        rating: Rating,
        metadata: Option<Known>,
        #[serde(default)]
        rebind_source: bool,
    },
    RestorePrevious,
}
struct Raw {
    bytes: Vec<u8>,
    identity: String,
}
fn raw(dir: &File, name: &str) -> Result<Option<Raw>> {
    let fd = match openat(
        dir,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => {
            return Err(ApiError::invalid(
                "Review sidecar links or unreadable files are preserved and refused",
            ));
        }
    };
    let file = File::from(fd);
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(ApiError::invalid(
            "Review sidecars must be regular files within 4 MiB",
        ));
    }
    let identity = crate::source::file_identity(&file)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ApiError::invalid("Review sidecar exceeds 4 MiB"));
    }
    Ok(Some(Raw { bytes, identity }))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn revision(raw: &Option<Raw>) -> String {
    raw.as_ref()
        .map_or_else(|| "absent".into(), |value| digest(&value.bytes))
}
fn text(value: &str, max: usize, empty: bool, multiline: bool) -> Result<()> {
    if value.len() > max
        || (!empty && value.trim().is_empty())
        || value
            .chars()
            .any(|c| c.is_control() && !(multiline && matches!(c, '\n' | '\r' | '\t')))
    {
        return Err(ApiError::invalid(
            "Review text is empty, too long or contains unsupported control characters",
        ));
    }
    Ok(())
}
fn shot_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
    {
        return Err(ApiError::invalid("Invalid shot ID"));
    }
    Ok(())
}
fn known(value: &mut Known) -> Result<()> {
    for (field, max, multiline) in [
        (&mut value.model, 256, false),
        (&mut value.prompt, 32768, true),
    ] {
        if let Some(text_value) = field {
            text(text_value, max, true, multiline)?;
            if text_value.is_empty() {
                *field = None;
            }
        }
    }
    if let Some(seed) = &mut value.seed {
        if seed.is_empty() {
            value.seed = None;
        } else {
            *seed = seed
                .parse::<u64>()
                .map_err(|_| {
                    ApiError::invalid("Use an exact unsigned 64-bit seed or leave it unknown")
                })?
                .to_string();
        }
    }
    Ok(())
}
fn parse(bytes: &[u8]) -> Result<Document> {
    let mut doc: Document = serde_json::from_slice(bytes).map_err(|_| {
        ApiError::invalid(
            "Review sidecar is unreadable or has an unknown schema; the file was preserved",
        )
    })?;
    if doc.version != 1 || doc.shots.len() > 1024 || doc.takes.len() > 4096 {
        return Err(ApiError::invalid(
            "Review schema version or item count is unsupported; the file was preserved",
        ));
    }
    for (id, name) in &doc.shots {
        shot_id(id)?;
        text(name, 128, false, false)?;
    }
    for (id, take) in &mut doc.takes {
        if id
            .parse::<u64>()
            .ok()
            .is_none_or(|value| value.to_string() != *id)
            || take
                .shot_id
                .as_ref()
                .is_some_and(|shot| !doc.shots.contains_key(shot))
            || take.binding.content_hash.parse::<u64>().is_err()
            || take.binding.version.as_ref().is_some_and(|v| v.len() > 256)
        {
            return Err(ApiError::invalid(
                "Review sidecar contains invalid source or shot references",
            ));
        }
        text(&take.label, 128, true, false)?;
        text(&take.source_name, 256, true, false)?;
        if let Some(meta) = &mut take.metadata {
            known(meta)?;
        }
    }
    Ok(doc)
}
fn token(files: &Files, session: &Session) -> Result<String> {
    let path = session
        .path()
        .ok_or_else(|| ApiError::invalid("Save the project before organizing review takes"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(ApiError::missing)?;
    if files.path(name)? != path || !name.ends_with(".vvproj") {
        return Err(ApiError::invalid(
            "Review metadata must belong to the current root-scoped project",
        ));
    }
    Ok(name.into())
}
fn name(files: &Files, project: &str) -> Result<String> {
    files.path(project)?;
    if !project.ends_with(".vvproj") {
        return Err(ApiError::invalid(
            "Choose a native project for review metadata",
        ));
    }
    Ok(format!("{project}.review.json"))
}
fn binding(files: &Files, media: &core::MediaItem) -> Binding {
    Binding {
        content_hash: media.content_hash.to_string(),
        version: files
            .media_file(&media.path)
            .ok()
            .and_then(|file| crate::source::file_identity(&file).ok()),
    }
}
fn stale(a: &Binding, b: &Binding) -> bool {
    a.content_hash != b.content_hash || a.version != b.version
}
fn origin_known(files: &Files, media: &core::MediaItem) -> Known {
    let origin = files.shared_origin(&media.path);
    let item = origin.as_ref().and_then(|origin| origin.get("item"));
    let field = |name: &str| {
        item.and_then(|item| item.get(name))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Known {
        model: field("model"),
        prompt: field("prompt"),
        seed: field("seed"),
    }
}
pub fn read(files: &Files, session: &Session) -> Result<Value> {
    let project = token(files, session)?;
    let dir = files.root_file()?;
    let file_name = name(files, &project)?;
    let current = raw(&dir, &file_name)?;
    let doc = current
        .as_ref()
        .map(|raw| parse(&raw.bytes))
        .transpose()?
        .unwrap_or_default();
    let previous = raw(&dir, &format!("{file_name}.bak"))?.filter(|raw| parse(&raw.bytes).is_ok());
    let mut items = Vec::new();
    for (id, media) in session
        .project
        .media_pool
        .iter()
        .filter(|(_, media)| media.compound.is_none())
    {
        let id = id.raw().to_string();
        let saved = doc.takes.get(&id);
        let current_binding = binding(files, media);
        let source_meta = origin_known(files, media);
        let meta = saved
            .and_then(|take| take.metadata.clone())
            .unwrap_or_else(|| source_meta.clone());
        items.push(json!({"media_id":id,"source_name":vv_session::file_label(&media.path),"label":saved.map(|t|t.label.as_str()).unwrap_or(""),"shot_id":saved.and_then(|t|t.shot_id.as_deref()),"rating":saved.map(|t|t.rating).unwrap_or_default(),"metadata":meta,"source_metadata":source_meta,"metadata_override":saved.is_some_and(|t|t.metadata.is_some()),"stale_source":saved.is_some_and(|t|stale(&t.binding,&current_binding)),"offline":current_binding.version.is_none()}));
    }
    let orphans: Vec<_> = doc
        .takes
        .iter()
        .filter(|(id, _)| {
            id.parse::<u64>().ok().is_none_or(|id| {
                !session
                    .project
                    .media_pool
                    .contains_key(core::MediaId::from_raw(id))
            })
        })
        .map(|(id, take)| json!({"media_id":id,"take":take}))
        .collect();
    Ok(
        json!({"version":1,"project_token":project,"revision":revision(&current),"shots":doc.shots,"items":items,"orphans":orphans,"can_restore_previous":previous.is_some_and(|previous|digest(&previous.bytes)!=revision(&current))}),
    )
}
fn publish(dir: &File, name: &str, bytes: &[u8], expected: Option<&str>) -> Result<()> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ApiError::invalid("Review metadata exceeds 4 MiB"));
    }
    let temp = format!(
        ".venturi-review-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let result = (|| {
        let fd = openat(
            dir,
            temp.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ApiError::io())?;
        let mut file = File::from(fd);
        file.write_all(bytes).map_err(|_| ApiError::io())?;
        file.sync_all().map_err(|_| ApiError::io())?;
        let now = raw(dir, name)?;
        if now.as_ref().map(|raw| raw.identity.as_str()) != expected {
            return Err(ApiError::conflict(
                "REVISION_CONFLICT",
                "Review sidecar changed outside this request; refresh before retrying",
            ));
        }
        if expected.is_none() {
            rustix::fs::renameat_with(dir, temp.as_str(), dir, name, RenameFlags::NOREPLACE)
                .map_err(|_| {
                    ApiError::conflict("FILE_EXISTS", "Existing review metadata was preserved")
                })?;
        } else {
            rustix::fs::renameat(dir, temp.as_str(), dir, name).map_err(|_| ApiError::io())?;
        }
        dir.sync_all().map_err(|_| ApiError::io())?;
        Ok(())
    })();
    let _ = unlinkat(dir, temp.as_str(), AtFlags::empty());
    result
}
pub fn edit(
    files: &Files,
    session: &Session,
    project: &str,
    expected: &str,
    edit: &Edit,
) -> Result<()> {
    if token(files, session)? != project {
        return Err(ApiError::conflict(
            "REVISION_CONFLICT",
            "The review project changed; retain the draft and refresh",
        ));
    }
    let dir = files.root_file()?;
    let file_name = name(files, project)?;
    let current = raw(&dir, &file_name)?;
    if revision(&current) != expected {
        return Err(ApiError::conflict(
            "REVISION_CONFLICT",
            "Annotations changed; retain the draft and refresh review",
        ));
    }
    let mut doc = current
        .as_ref()
        .map(|raw| parse(&raw.bytes))
        .transpose()?
        .unwrap_or_default();
    match edit {
        Edit::NewShot { id, name } => {
            shot_id(id)?;
            text(name, 128, false, false)?;
            if doc.shots.len() >= 1024 || doc.shots.contains_key(id) {
                return Err(ApiError::invalid(
                    "Shot already exists or the 1024-shot limit was reached",
                ));
            }
            doc.shots.insert(id.clone(), name.trim().into());
        }
        Edit::RenameShot { id, name } => {
            text(name, 128, false, false)?;
            *doc.shots.get_mut(id).ok_or_else(ApiError::missing)? = name.trim().into();
        }
        Edit::DeleteShot { id } => {
            doc.shots.remove(id).ok_or_else(ApiError::missing)?;
            for take in doc.takes.values_mut() {
                if take.shot_id.as_ref() == Some(id) {
                    take.shot_id = None;
                }
            }
        }
        Edit::SetTake {
            media_id,
            shot_id,
            label,
            rating,
            metadata,
            rebind_source,
        } => {
            let id = core::MediaId::from_raw(media_id.parse().map_err(|_| ApiError::missing())?);
            let media = session
                .project
                .media_pool
                .get(id)
                .filter(|media| media.compound.is_none())
                .ok_or_else(ApiError::missing)?;
            if media_id != &id.raw().to_string()
                || shot_id
                    .as_ref()
                    .is_some_and(|shot| !doc.shots.contains_key(shot))
                || (doc.takes.len() >= 4096 && !doc.takes.contains_key(media_id))
            {
                return Err(ApiError::invalid(
                    "Invalid take/shot reference or the 4096-take limit was reached",
                ));
            }
            text(label, 128, true, false)?;
            let mut metadata = metadata.clone();
            if let Some(value) = &mut metadata {
                known(value)?;
            }
            let binding = binding(files, media);
            if !rebind_source
                && doc
                    .takes
                    .get(media_id)
                    .is_some_and(|take| stale(&take.binding, &binding))
            {
                return Err(ApiError::conflict(
                    "SOURCE_CHANGED",
                    "Source changed; explicitly rebind the retained annotations after reviewing them",
                ));
            }
            doc.takes.insert(
                media_id.clone(),
                Take {
                    shot_id: shot_id.clone(),
                    label: label.trim().into(),
                    rating: *rating,
                    metadata,
                    source_name: vv_session::file_label(&media.path),
                    binding,
                },
            );
        }
        Edit::RestorePrevious => {
            let previous = raw(&dir, &format!("{file_name}.bak"))?.ok_or_else(ApiError::missing)?;
            doc = parse(&previous.bytes)?;
        }
    }
    let bytes = serde_json::to_vec_pretty(&doc).map_err(|_| ApiError::io())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ApiError::invalid("Review metadata exceeds 4 MiB"));
    }
    if let Some(old) = &current {
        let backup_name = format!("{file_name}.bak");
        let backup = raw(&dir, &backup_name)?;
        if let Some(backup) = &backup {
            parse(&backup.bytes)?;
        }
        publish(
            &dir,
            &backup_name,
            &old.bytes,
            backup.as_ref().map(|raw| raw.identity.as_str()),
        )?;
    }
    publish(
        &dir,
        &file_name,
        &bytes,
        current.as_ref().map(|raw| raw.identity.as_str()),
    )
}
pub struct CopyGuard {
    dir: File,
    name: Option<String>,
    identity: Option<String>,
    committed: bool,
}
impl CopyGuard {
    pub fn commit(mut self) {
        self.committed = true;
    }
}
impl Drop for CopyGuard {
    fn drop(&mut self) {
        if !self.committed
            && let (Some(name), Some(identity)) = (&self.name, &self.identity)
            && raw(&self.dir, name)
                .ok()
                .flatten()
                .is_some_and(|raw| &raw.identity == identity)
        {
            let _ = unlinkat(&self.dir, name.as_str(), AtFlags::empty());
            let _ = self.dir.sync_all();
        }
    }
}
pub fn reserve_copy(files: &Files, source: Option<&str>, target: &str) -> Result<CopyGuard> {
    let dir = files.root_file()?;
    let target = name(files, target)?;
    if raw(&dir, &target)?.is_some() {
        return Err(ApiError::conflict(
            "FILE_EXISTS",
            "A review sidecar already uses the new project name; its metadata was preserved",
        ));
    }
    let mut guard = CopyGuard {
        dir,
        name: None,
        identity: None,
        committed: false,
    };
    if let Some(source) = source
        && let Some(original) = raw(&guard.dir, &name(files, source)?)?
    {
        publish(&guard.dir, &target, &original.bytes, None)?;
        guard.identity = raw(&guard.dir, &target)?.map(|raw| raw.identity);
        guard.name = Some(target);
    }
    Ok(guard)
}
pub fn current_project(files: &Files, session: &Session) -> Result<String> {
    token(files, session)
}

#[cfg(test)]
#[path = "tests/reviewmeta.rs"]
mod tests;
