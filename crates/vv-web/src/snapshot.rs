use crate::error::{ApiError, Result};
use serde_json::{Value, json};
use vv_core::{ClipSource, TimelineId, id_map::Id};
use vv_session::Session;

pub fn timeline_id(session: &Session, id: &str) -> Result<TimelineId> {
    let raw = id.parse::<u64>().map_err(|_| ApiError::missing())?;
    let key = TimelineId::from_raw(raw);
    session
        .project
        .timelines
        .contains_key(key)
        .then_some(key)
        .ok_or_else(ApiError::missing)
}

pub fn timeline(session: &Session, id: TimelineId) -> Value {
    let tl = &session.project.timelines[id];
    json!({"api_version":1,"timeline_id":id.raw().to_string(),"id":id.raw().to_string(),"revision":session.timeline_revision(id),"name":tl.name,
      "fps":{"num":tl.fps.num,"den":tl.fps.den},"resolution":{"width":tl.resolution.0,"height":tl.resolution.1},
      "marker_colors":vv_core::ClipColor::ALL,
      "markers":tl.markers.iter().map(|m|{let (r,g,b)=m.color.rgb();json!({"id":m.id.0.to_string(),"start_frame":m.start,"duration_frames":m.duration,"note":m.note,"color":m.color,"rgb":[r,g,b]})}).collect::<Vec<_>>(),
      "tracks":tl.tracks.iter().enumerate().map(|(index,track)|json!({
        "id":index.to_string(),"label":tl.track_label(index),"kind":match track.kind {vv_core::TrackKind::Video=>"video",vv_core::TrackKind::Audio=>"audio"},
        "locked":track.locked,"muted":track.muted,"solo":track.solo,
        "crossings":track.crossings.iter().filter_map(|c|{let left=track.clip(c.left_clip)?;let right=track.clip(c.right_clip)?;let window=c.window(left,right);Some(json!({"left_clip":left.id.0.to_string(),"right_clip":right.id.0.to_string(),"start_frame":window.start,"end_frame":window.end,"kind":c.transition.kind}))}).collect::<Vec<_>>(),
        "clips":track.clips.iter().map(|clip|{
          let (kind,media_id,name)=match &clip.source {
            ClipSource::Media(id)=>("media",Some(id.raw().to_string()),session.project.media_pool.get(*id).map(|m|vv_session::file_label(&m.path)).unwrap_or_else(||"Offline media".into())),
            ClipSource::SolidColor=>("solid_color",None,"Solid color".into()),ClipSource::Text=>("title",None,"Title".into()),ClipSource::Adjustment=>("adjustment",None,"Adjustment".into())
          };
          json!({"id":clip.id.0.to_string(),"name":name,"kind":kind,"media_id":media_id,"start_frame":clip.timeline_start,"length_frames":clip.timeline_len,
            "source_in_frames":clip.source_in(),"source_out_frames":clip.source_out(),"linked_group":clip.linked_group.map(|g|g.0.to_string()),"disabled":clip.disabled,"fade_in":clip.fade_in,"fade_out":clip.fade_out,"transition_in":clip.effects.transition_in,"transition_out":clip.effects.transition_out})
        }).collect::<Vec<_>>()
      })).collect::<Vec<_>>()})
}

pub fn session(session: &Session, epoch: &str) -> Value {
    json!({"api_version":1,"project_epoch":format!("{epoch}:{}",session.epoch()),"generation":session.history.generation().to_string(),
      "project_name":session.path().and_then(|p|p.file_name()).map(|p|p.to_string_lossy()),"unsaved":session.has_unsaved_changes(),
      "history":{"position":session.history.position(),"labels":session.history.labels().map(|l|format!("{l:?}")).collect::<Vec<_>>()},
      "timelines":session.project.timelines.keys().map(|id|timeline(session,id)).collect::<Vec<_>>(),
      "media":session.project.media_pool.iter().map(|(id,m)|json!({"id":id.raw().to_string(),"name":vv_session::file_label(&m.path),"duration_frames":m.meta.duration_frames,"fps":{"num":m.meta.fps.num,"den":m.meta.fps.den},"is_image":m.meta.is_image(),"has_video":m.meta.has_video,"has_audio":m.meta.has_audio,"offline":m.compound.is_none()&&!m.path.exists()})).collect::<Vec<_>>(),
      "capabilities":{"preview":false,"playback":false,"export":false,"editing":true}})
}
