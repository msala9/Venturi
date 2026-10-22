use crate::{
    error::{ApiError, Result},
    presets::Preset,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use vv_core::{
    Clip, ClipSource, MediaId, Project, TimelineId,
    attributes::{Attribute, KeyframeAnchor},
    clipboard::{ClipboardEntry, ClipboardOrigin, ClipboardPayload},
};
use vv_session::Session;

pub const MAX_ASSET_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetFile {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub folder: Option<String>,
    pub payload: String,
}

fn header(asset: &AssetFile) -> Result<()> {
    if asset.version != 1
        || asset.name.trim().is_empty()
        || asset.name.len() > 128
        || asset.name.chars().any(char::is_control)
        || asset.folder.as_ref().is_some_and(|id| {
            id.is_empty()
                || id.len() > 80
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
        || asset.payload.is_empty()
        || asset.payload.len() > MAX_ASSET_BYTES
    {
        return Err(ApiError::invalid(
            "Choose a named native v1 asset within the supported bounds",
        ));
    }
    if serde_json::to_vec(asset)
        .map_err(|_| ApiError::invalid("Invalid native asset JSON"))?
        .len()
        > MAX_ASSET_BYTES
    {
        return Err(ApiError::invalid("Native asset JSON exceeds 4 MiB"));
    }
    Ok(())
}

pub fn parse(bytes: &[u8]) -> Result<AssetFile> {
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(ApiError::invalid("Native asset JSON exceeds 4 MiB"));
    }
    let asset: AssetFile = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::invalid("Invalid native asset JSON"))?;
    decode(&asset)?;
    Ok(asset)
}

pub fn decode(asset: &AssetFile) -> Result<ClipboardPayload> {
    header(asset)?;
    let payload = ClipboardPayload::from_text(&asset.payload)
        .ok_or_else(|| ApiError::invalid("Asset does not contain a native clipboard payload"))?
        .map_err(|_| ApiError::invalid("Unsupported or malformed native asset payload"))?;
    if payload.has_clips() || payload.media_ids().len() != 1 {
        return Err(ApiError::invalid(
            "A library asset must contain exactly one pool item and no copied clips",
        ));
    }
    let project = payload.fragment();
    crate::files::validate_project(project)?;
    let closure = closure(project, payload.media_ids()[0])?;
    if closure.media.len() != project.media_pool.len()
        || closure.timelines.len() != project.timelines.len()
    {
        return Err(ApiError::invalid(
            "Asset contains entities outside its selected media dependencies",
        ));
    }
    Ok(payload)
}

pub fn validate_clipboard(payload: &ClipboardPayload) -> Result<()> {
    if payload.to_text().len() > MAX_ASSET_BYTES {
        return Err(ApiError::invalid("Native clipboard text exceeds 4 MiB"));
    }
    let closure = clipboard_closure(
        payload.fragment(),
        payload.media_ids(),
        payload.clip_entries(),
    )?;
    if closure.media.len() != payload.fragment().media_pool.len()
        || closure.timelines.len() != payload.fragment().timelines.len()
        || !payload.fragment().folders.is_empty()
    {
        return Err(ApiError::invalid(
            "Clipboard contains entities outside its selected dependencies",
        ));
    }
    Ok(())
}
// The native copier follows dependencies recursively. Bound the selected closure
// before invoking it, rather than serializing an already-expanded large fragment.
pub fn validate_clipboard_capture(
    project: &Project,
    media: &[MediaId],
    entries: &[ClipboardEntry],
) -> Result<()> {
    clipboard_closure(project, media, entries).map(|_| ())
}
fn clipboard_closure(
    project: &Project,
    media: &[MediaId],
    entries: &[ClipboardEntry],
) -> Result<Closure> {
    crate::files::validate_project(project)?;
    if media.len() > 4096 || entries.len() > 4096 {
        return Err(ApiError::invalid(
            "Native clipboard selections are limited to 4096 items",
        ));
    }
    let mut closure = Closure::default();
    for &id in media {
        if !project.media_pool.contains_key(id) {
            return Err(ApiError::invalid(
                "Copied pool item is missing from the native fragment",
            ));
        }
        visit_impl(project, id, &mut closure, true)?;
    }
    for entry in entries {
        validate_clip_format(&entry.clip, entry.timeline_fps, (1, 1))?;
        if !(1..=128).contains(&entry.track_number)
            || entry.relative_start < 0
            || entry.relative_start > crate::commands::MAX_FRAME - entry.clip.timeline_len
            || entry.timeline_fps.num <= 0
            || entry.timeline_fps.den <= 0
            || entry.timeline_fps.as_f64() > 240.0
        {
            return Err(ApiError::invalid(
                "Copied clip track, frame or timeline format is invalid",
            ));
        }
        native_values(entry)?;
        budget(entry, &mut closure)?;
        if let ClipSource::Media(id) = entry.clip.source {
            visit_impl(project, id, &mut closure, true)?;
        }
    }
    for &id in &closure.media {
        native_values(&project.media_pool[id])?;
    }
    let files: HashSet<_> = closure
        .media
        .iter()
        .filter_map(|&id| project.media_pool.get(id))
        .filter(|item| item.compound.is_none())
        .map(|item| &item.path)
        .collect();
    if files.len() > 64 {
        return Err(ApiError::invalid(
            "Native clipboard dependencies are limited to 64 unique files",
        ));
    }
    Ok(closure)
}

pub fn capture(
    session: &Session,
    media_id: MediaId,
    name: &str,
    origin: ClipboardOrigin,
) -> Result<AssetFile> {
    let mut asset = AssetFile {
        version: 1,
        name: name.to_owned(),
        folder: None,
        payload: "pending".into(),
    };
    header(&asset)?;
    // The native copier preserves offline references and otherwise follows nested timelines.
    crate::files::validate_project(&session.project)?;
    closure(&session.project, media_id)?;
    asset.payload = ClipboardPayload::new(origin, &session.project, &[media_id], &[]).to_text();
    decode(&asset)?;
    Ok(asset)
}

#[derive(Default)]
struct Closure {
    media: HashSet<MediaId>,
    timelines: HashSet<TimelineId>,
    copied_timelines: usize,
    bytes: usize,
}

fn closure(project: &Project, root: MediaId) -> Result<Closure> {
    let mut closure = Closure::default();
    visit(project, root, &mut closure)?;
    Ok(closure)
}

fn budget<T: Serialize>(value: &T, closure: &mut Closure) -> Result<()> {
    let size = ron::to_string(value)
        .map_err(|_| ApiError::invalid("Invalid native asset values"))?
        .len();
    closure.bytes = closure
        .bytes
        .checked_add(size)
        .filter(|bytes| *bytes <= MAX_ASSET_BYTES)
        .ok_or_else(|| ApiError::invalid("Native asset dependencies exceed 4 MiB"))?;
    Ok(())
}

fn visit(project: &Project, id: MediaId, closure: &mut Closure) -> Result<()> {
    visit_impl(project, id, closure, false)
}
fn visit_impl(
    project: &Project,
    id: MediaId,
    closure: &mut Closure,
    allow_missing: bool,
) -> Result<()> {
    if !project.media_pool.contains_key(id) && allow_missing {
        return Ok(());
    }
    if !closure.media.insert(id) {
        return Ok(());
    }
    let item = project
        .media_pool
        .get(id)
        .ok_or_else(|| ApiError::invalid("Asset refers to a missing media item"))?;
    if item.path.to_str().is_none_or(|path| {
        path.is_empty() || path.len() > 4096 || path.chars().any(char::is_control)
    }) {
        return Err(ApiError::invalid(
            "Asset media path is not supported native text",
        ));
    }
    budget(item, closure)?;
    let Some(child) = item.compound else {
        return Ok(());
    };
    let timeline = project
        .timelines
        .get(child)
        .ok_or_else(|| ApiError::invalid("Asset refers to a missing compound timeline"))?;
    closure.copied_timelines += 1;
    if closure.copied_timelines > 64 {
        return Err(ApiError::invalid(
            "Asset exceeds the native timeline budget",
        ));
    }
    // Distinct media may reference the same timeline; the native copier copies each one.
    budget(timeline, closure)?;
    if closure.timelines.insert(child) {
        native_values(timeline)?;
        for track in &timeline.tracks {
            let ids = track
                .clips
                .iter()
                .map(|clip| clip.id)
                .collect::<HashSet<_>>();
            if track.crossings.iter().any(|crossing| {
                crossing.left_clip == crossing.right_clip
                    || !ids.contains(&crossing.left_clip)
                    || !ids.contains(&crossing.right_clip)
            }) {
                return Err(ApiError::invalid("Asset crossing refers to a missing clip"));
            }
            for clip in &track.clips {
                validate_clip(clip, timeline)?;
                if let ClipSource::Media(media) = clip.source {
                    visit_impl(project, media, closure, allow_missing)?;
                }
            }
        }
    }
    Ok(())
}

fn validate_clip(clip: &Clip, timeline: &vv_core::Timeline) -> Result<()> {
    validate_clip_format(clip, timeline.fps, timeline.resolution)
}
fn validate_clip_format(clip: &Clip, fps: vv_core::Rational, resolution: (u32, u32)) -> Result<()> {
    Preset {
        version: 1,
        name: "Asset validation".into(),
        attributes: vec![Attribute::Fades],
        anchor: KeyframeAnchor::Start,
        append_filters: false,
        shortcut: None,
        fps,
        resolution,
        video: Some(Box::new(clip.clone())),
        audio: None,
    }
    .validate()
}

fn native_values<T: Serialize + serde::de::DeserializeOwned>(value: &T) -> Result<()> {
    let value = serde_json::to_value(value)
        .map_err(|_| ApiError::invalid("Asset has invalid native values"))?;
    let roundtrip: T = serde_json::from_value(value.clone())
        .map_err(|_| ApiError::invalid("Asset has nonfinite or unsupported native values"))?;
    if serde_json::to_value(roundtrip).map_err(|_| ApiError::io())? != value {
        return Err(ApiError::invalid(
            "Asset values require native normalization",
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/asset_payload.rs"]
mod tests;
