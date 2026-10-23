import {createMediaDrop,mediaRangePlacement} from './timeline/asset-drop.js';

export const PROJECT_POOL_DRAG_TYPE='application/x-venturi-project-media';
const id=value=>typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<=18_446_744_073_709_551_615n;
const token=value=>typeof value==='string' && value.length>0 && value.length<=256 && !/[\u0000-\u001f\u007f]/.test(value);
const frame=value=>Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000;
const fps=value=>[value?.num,value?.den].every(n=>Number.isSafeInteger(n) && n>0 && n<=2_147_483_647);
export function projectPoolDragItems(items){
  if(!Array.isArray(items) || !items.length || items.length>256 || new Set(items.map(item=>item?.media_id)).size!==items.length)return null;
  let clips=0;
  for(const item of items){
    if(!item || ![item.project_epoch,item.generation,item.timeline_revision].every(token) || ![item.media_id,item.timeline_id,item.content_hash].every(id) || !fps(item.fps) || item.source_in!==0 || !frame(item.source_out) || item.source_out===0 || typeof item.name!=='string' || !item.name.trim() || item.name.length>4096 || typeof item.has_video!=='boolean' || typeof item.has_audio!=='boolean' || !(item.has_video || item.has_audio) || !Number.isSafeInteger(item.audio_streams) || item.audio_streams<0 || item.audio_streams>128 || item.has_audio && item.audio_streams===0)return null;
    if(['project_epoch','generation','timeline_id','timeline_revision'].some(key=>item[key]!==items[0][key]))return null;
    clips+=Number(item.has_video)+(item.has_audio?item.audio_streams:0);if(clips>4096)return null;
  }
  return structuredClone(items);
}
export function projectPoolItems(context,media){
  if(!context || !Array.isArray(media))return null;
  const items=[];
  for(const item of media){
    if(!item || item.offline || !fps(item.fps))return null;
    const end=item.is_image?Number((10n*BigInt(item.fps.num)+BigInt(item.fps.den))/(2n*BigInt(item.fps.den))):item.duration_frames;
    items.push({project_epoch:context.project_epoch,generation:context.generation,timeline_id:context.timeline_id,timeline_revision:context.timeline_revision,media_id:item.id,content_hash:item.content_hash,name:item.name,fps:{...item.fps},source_in:0,source_out:end,has_video:item.has_video,has_audio:item.has_audio,audio_streams:item.audio_stream_count??0});
  }
  return projectPoolDragItems(items);
}
export function projectPoolOperation(items,start,target,overwrite=false){
  const values=projectPoolDragItems(items);
  if(!values || !frame(start) || !['track','new_video_track','new_audio_track'].includes(target?.kind) || target.kind==='track' && !id(target.track_id))throw Error('The selected project media or destination changed; select the files again');
  return {kind:'place_project_media',media_ids:values.map(item=>item.media_id),start_frame:start,target:structuredClone(target),overwrite:Boolean(overwrite)};
}
export function projectPoolTarget(timeline,items){
  const track=timeline?.tracks.find(track=>track.kind==='video' && !track.locked) ?? timeline?.tracks.find(track=>!track.locked);
  return track?{kind:'track',track_id:track.id}:{kind:items?.some(item=>item.has_video)?'new_video_track':'new_audio_track'};
}
export function projectPoolRangePlacement(timeline,view,point,width,height,items){
  const values=projectPoolDragItems(items);
  if(!values || values[0].timeline_id!==timeline?.id || values[0].timeline_revision!==timeline?.revision)return null;
  const draft=mediaRangePlacement(timeline,view,point,width,height,values);
  return draft?{...draft,kind:'project_media_placement',media_ids:values.map(item=>item.media_id)}:null;
}
export const createProjectPoolDrop=options=>createMediaDrop({...options,type:PROJECT_POOL_DRAG_TYPE,normalizeItems:projectPoolDragItems,placement:projectPoolRangePlacement,itemContext:item=>item});
