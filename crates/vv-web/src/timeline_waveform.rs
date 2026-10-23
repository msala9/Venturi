use crate::{
    error::{ApiError, Result},
    inspector,
    preview::FrameQuery,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashSet;
use vv_core::{ClipSource, Id, Interpolation, Keyframed, TimelineId, TrackKind};
use vv_session::Session;

pub const MAX_CLIPS: usize = 64;
const MAX_SCAN: usize = 262_144;
const MAX_RUNS: usize = 65_536;
const MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub query: FrameQuery,
    pub clip_ids: Vec<String>,
}

struct Budget {
    scan: usize,
    runs: usize,
    bytes: usize,
}

fn append(runs: &mut Vec<(i64, i64, f32)>, start: i64, end: i64, value: f32) -> Option<()> {
    if start >= end {
        return Some(());
    }
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    if let Some(last) = runs.last_mut()
        && last.1 == start
        && last.2.to_bits() == value.to_bits()
    {
        last.1 = end;
        return Some(());
    }
    if runs.len() >= MAX_RUNS {
        return None;
    }
    runs.push((start, end, value));
    Some(())
}

fn linear(track: &Keyframed<f32>, at: i64) -> Option<f32> {
    let db = track.value_at(at);
    let value = vv_audio::mixer::db_to_linear(db);
    (db.is_finite() && value.is_finite() && value >= 0.0).then_some(value)
}

fn gain(track: &Keyframed<f32>, end: i64, budget: &mut Budget) -> Option<Value> {
    if track.is_constant() {
        return Some(json!({"kind":"constant","linear":linear(track, 0)?}));
    }
    let keys = track.keyframes();
    if keys.len() > MAX_RUNS || keys.len() > budget.scan {
        return None;
    }
    budget.scan -= keys.len();
    let mut runs = Vec::new();
    let mut start = 0;
    while start < end {
        let next = keys.partition_point(|(frame, _, _)| *frame <= start);
        let stop = keys.get(next).map_or(end, |key| key.0.min(end));
        let constant = next == 0
            || next == keys.len()
            || keys[next - 1].2 == Interpolation::Hold
            || keys[next - 1].1 == keys[next].1;
        if constant {
            append(&mut runs, start, stop, linear(track, start)?)?;
        } else {
            let count = usize::try_from(stop - start).ok()?;
            if count > budget.scan {
                return None;
            }
            budget.scan -= count;
            for frame in start..stop {
                append(&mut runs, frame, frame + 1, linear(track, frame)?)?;
            }
        }
        start = stop;
    }
    if runs.len() > budget.runs {
        return None;
    }
    budget.runs -= runs.len();
    Some(json!({"kind":"runs","runs":runs}))
}

pub fn presentation(session: &Session, id: TimelineId, request: &Request) -> Result<Value> {
    if request.clip_ids.is_empty() || request.clip_ids.len() > MAX_CLIPS {
        return Err(ApiError::invalid("Choose one to 64 audio media clips"));
    }
    let mut seen = HashSet::new();
    let timeline = &session.project.timelines[id];
    let mut clips = Vec::with_capacity(request.clip_ids.len());
    // Resolve every target before compiling any gain data.
    for raw in &request.clip_ids {
        let (lane, _, clip) = inspector::find(session, id, raw)?;
        if raw.len() > 20
            || !seen.insert(clip.id)
            || timeline.tracks[lane].kind != TrackKind::Audio
            || !matches!(clip.source, ClipSource::Media(_))
        {
            return Err(ApiError::invalid("Choose unique audio media clips"));
        }
        clips.push((raw, clip));
    }
    let mut budget = Budget {
        scan: MAX_SCAN,
        runs: MAX_RUNS,
        bytes: MAX_BYTES - 64 * 1024,
    };
    let mut output = Vec::with_capacity(clips.len());
    for (raw, clip) in clips {
        let ClipSource::Media(media_id) = clip.source else {
            unreachable!()
        };
        let item = session
            .project
            .media_pool
            .get(media_id)
            .ok_or_else(ApiError::missing)?;
        let end = item.meta.duration_frames.checked_add(2).unwrap_or(0);
        let valid = item.meta.has_audio
            && end > 2
            && end <= crate::commands::MAX_FRAME + 2
            && item.meta.fps.num > 0
            && item.meta.fps.den > 0
            && timeline.fps.num > 0
            && timeline.fps.den > 0
            && clip.speed().num > 0
            && clip.speed().den > 0
            && (0..=crate::commands::MAX_FRAME).contains(&clip.source_offset)
            && clip.audio_stream_index < item.meta.audio_stream_count();
        let mut value = json!({"clip_id":raw,"media_id":media_id.raw().to_string(),
            "audio_stream_index":clip.audio_stream_index,"content_hash":item.content_hash.to_string(),
            "clock":{"source_offset_frames":clip.source_offset,"speed":clip.speed(),
                "timeline_fps":timeline.fps,"media_fps":item.meta.fps},"coverage":[0,end],"gain":null});
        let hidden = if clip.freeze.is_some() {
            Some("frozen")
        } else if item.compound.is_some() {
            Some("compound")
        } else if !valid {
            Some("invalid_media")
        } else {
            None
        };
        if let Some(reason) = hidden {
            value["state"] = json!("hidden");
            value["reason"] = json!(reason);
        } else if let Some(gain) = gain(&clip.effects.gain_db, end, &mut budget) {
            value["state"] = json!("ready");
            value["gain"] = gain;
            let bytes = serde_json::to_vec(&value)
                .map_err(|_| ApiError::io())?
                .len();
            if bytes <= budget.bytes {
                budget.bytes -= bytes;
            } else {
                value["state"] = json!("unavailable");
                value["reason"] = json!("gain_lookup_budget");
                value["gain"] = Value::Null;
            }
        } else {
            value["state"] = json!("unavailable");
            value["reason"] = json!("gain_lookup_budget");
        }
        output.push(value);
    }
    let value = json!({"project_epoch":request.query.project_epoch,"generation":request.query.if_generation,
        "timeline_id":request.query.timeline_id,"revision":request.query.revision,"clips":output});
    if serde_json::to_vec(&value)
        .map_err(|_| ApiError::io())?
        .len()
        > MAX_BYTES
    {
        return Err(ApiError::invalid(
            "Waveform presentation exceeds its response limit",
        ));
    }
    Ok(value)
}

#[cfg(test)]
#[path = "tests/timeline_waveform.rs"]
mod tests;
