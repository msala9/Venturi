use crate::{
    error::{ApiError, Result},
    inspector,
};
use serde_json::{Value, json};
use vv_core::{self as core, Id};
use vv_session::Session;

pub fn detail(session: &Session, id: core::TimelineId, raw: &str, center: i64) -> Result<Value> {
    let (lane, clip_id, clip) = inspector::find(session, id, raw)?;
    let core::ClipSource::Media(_) = clip.source else {
        return Err(ApiError::invalid("Slip requires source media"));
    };
    let timeline = &session.project.timelines[id];
    let mut min = i64::MIN;
    let mut max = i64::MAX;
    let mut ids = Vec::new();
    let mut locked = false;
    for track in &timeline.tracks {
        for linked in &track.clips {
            if linked.id != clip_id
                && !(clip.linked_group.is_some() && linked.linked_group == clip.linked_group)
            {
                continue;
            }
            let (first, last) = core::edit::slip_range(&session.project, linked)
                .ok_or_else(|| ApiError::invalid("A linked clip has no source handles"))?;
            min = min.max(first);
            max = max.min(last);
            ids.push(linked.id.0.to_string());
            locked |= track.locked;
        }
    }
    if !(min..=max).contains(&center) {
        return Err(ApiError::invalid(
            "Slip preview exceeds linked source handles",
        ));
    }
    let (preview_lane, preview_clip) = timeline
        .tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| track.kind == core::TrackKind::Video)
        .flat_map(|(lane, track)| track.clips.iter().map(move |clip| (lane, clip)))
        .filter(|(_, linked)| {
            linked.id == clip_id
                || clip.linked_group.is_some() && linked.linked_group == clip.linked_group
        })
        .min_by_key(|(lane, linked)| (linked.id != clip_id, *lane, linked.id.0))
        .unwrap_or((lane, clip));
    let core::ClipSource::Media(media_id) = preview_clip.source else {
        return Err(ApiError::invalid("Slip requires source media"));
    };
    let media = session
        .project
        .media_pool
        .get(media_id)
        .ok_or_else(ApiError::missing)?;
    let start = min.max(center.saturating_sub(32768));
    let end = max.min(center.saturating_add(32768));
    let mut sample = preview_clip.clone();
    let frames: Vec<_> = (start..=end)
        .map(|delta| {
            sample.source_offset = preview_clip.source_offset + delta;
            [delta, sample.source_in(), sample.source_out() - 1]
        })
        .collect();
    Ok(
        json!({"clip_id":raw,"clip_ids":ids,"media_id":media_id.raw().to_string(),"source_version":media.content_hash.to_string(),"fps":media.meta.fps,"total_frames":media.meta.duration_frames,"name":vv_session::file_label(&media.path),"min_delta":min,"max_delta":max,"locked":locked,"preview_available":timeline.tracks[preview_lane].kind==core::TrackKind::Video && media.meta.has_video && !media.meta.is_image() && media.compound.is_none(),"window_start":start,"window_end":end,"frames":frames}),
    )
}

#[cfg(test)]
#[path = "tests/slip.rs"]
mod tests;
