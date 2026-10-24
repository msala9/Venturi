import {createMediaDrop,mediaRangePlacement} from './timeline/asset-drop.js';
import {createNativeAssetTransfer} from './native-assets.js';

export const SOURCE_DRAG_TYPE='application/x-venturi-source-range';
const id=value=>typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<=18_446_744_073_709_551_615n;
const token=value=>typeof value==='string' && value.length>0 && value.length<=256 && !/[\u0000-\u001f\u007f]/.test(value);
const frame=value=>Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000;
const fps=value=>[value?.num,value?.den].every(n=>Number.isSafeInteger(n) && n>0 && n<=2_147_483_647);
const nativeId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const revision=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export function sourceDragItems(items){
  if(!Array.isArray(items) || items.length!==1)return null;
  const value=items[0];
  const native=value?.source_kind==='native_asset';
  if(!value || (native?value.media_id!==undefined || !nativeId(value.asset_id) || !revision(value.revision) || !id(value.source_generation):value.source_kind!==undefined || !id(value.media_id) || ['asset_id','revision','source_generation'].some(key=>Object.hasOwn(value,key))) || ![value.project_epoch,value.generation,value.timeline_revision,value.source_version].every(token) || ![value.job_id,value.timeline_id].every(id) || !['all','video_only','audio_only'].includes(value.streams) || !fps(value.fps) || !frame(value.source_in) || !frame(value.source_out) || !frame(value.total_frames) || value.source_out<=value.source_in || value.source_out>value.total_frames || typeof value.name!=='string' || !value.name.trim() || value.name.length>4096 || typeof value.has_video!=='boolean' || typeof value.has_audio!=='boolean' || !(value.has_video || value.has_audio) || !Number.isSafeInteger(value.audio_streams) || value.audio_streams<0 || value.audio_streams>128 || value.has_audio && value.audio_streams<1 || value.streams==='video_only' && !value.has_video || value.streams==='audio_only' && !value.has_audio)return null;
  return structuredClone(items);
}
export function sourcePlacementItem(context,streams='all'){
  const media=context?.item,verified=context?.verified;
  if(!media || typeof media.id!=='string' || !media.id || verified?.epoch!==context.project_epoch || verified?.media_id!==media.id)return null;
  const total=media.is_image && fps(media.fps)?Math.round(5*media.fps.num/media.fps.den):media.duration_frames;
  const native=media.native_asset;
  if(native && native.source_version!==verified.source_version)return null;
  return sourceDragItems([{project_epoch:context.project_epoch,generation:context.generation,timeline_id:context.timeline_id,timeline_revision:context.timeline_revision,...(native?{source_kind:'native_asset',asset_id:native.id,revision:native.revision,source_generation:native.if_generation}:{media_id:media.id}),job_id:verified.job,source_version:verified.source_version,source_in:context.source_in,source_out:context.source_out,total_frames:total,name:media.name,fps:media.fps,has_video:media.has_video,has_audio:media.has_audio,audio_streams:native && media.has_audio?Math.max(1,media.audio_stream_count??1):media.audio_stream_count??0,streams}])?.[0]??null;
}
export function sourcePlacementOperation(item,start,target,overwrite=false){
  if(!sourceDragItems([item]) || !frame(start) || !['track','new_video_track','new_audio_track'].includes(target?.kind) || target.kind==='track' && !id(target.track_id))throw Error('The marked Source range or destination is no longer valid');
  return {...(item.source_kind==='native_asset'?{kind:'place_native_source',asset_id:item.asset_id,revision:item.revision,source_generation:item.source_generation,source_job_id:item.job_id}:{kind:'place_source',media_id:item.media_id,job_id:item.job_id}),source_version:item.source_version,source_in:item.source_in,source_out:item.source_out,streams:item.streams,start_frame:start,target:structuredClone(target),overwrite:Boolean(overwrite)};
}
export function createNativeSourceInsertion({getContext,canCommit,commit,api,pause,onStatus}){
  let operation=null;
  const transfer=createNativeAssetTransfer({getContext,canCommit,api,pause,onStatus:text=>onStatus?.(text.startsWith('Native asset imported')?'Marked Library Source inserted · one Undo available':text),
    projectCommit:prepared=>commit({...operation,job_id:prepared.job_id})});
  return {async run(next,isCurrent){
    if(operation || next.kind!=='place_native_source')return null;
    operation=structuredClone(next);
    try{return await transfer.run({kind:'import',asset_id:next.asset_id,revision:next.revision},isCurrent);}
    finally{operation=null;}
  },invalidate:transfer.invalidate,cancel:transfer.cancel};
}
export function sourceRangePlacement(timeline,view,point,width,height,items){
  const source=sourceDragItems(items)?.[0];
  if(!source || source.timeline_id!==timeline?.id || source.timeline_revision!==timeline?.revision)return null;
  const segment={...source,has_video:source.has_video && source.streams!=='audio_only',has_audio:source.has_audio && source.streams!=='video_only'};
  const draft=mediaRangePlacement(timeline,view,point,width,height,[segment]);
  return draft?{...draft,kind:'source_media_placement',source}:null;
}
export const createSourceDrop=options=>createMediaDrop({...options,type:SOURCE_DRAG_TYPE,normalizeItems:sourceDragItems,placement:sourceRangePlacement,itemContext:item=>item});

export function createSourcePlacement({root,surfaces,handles,getContext,getNativeContext,canCommit,canInsert=()=>true,sourceDnd,commit,onStart=()=>{},notice=()=>{}}){
  const streams=root.querySelector('[data-source-streams]'),destination=root.querySelector('[data-source-target]'),insert=root.querySelector('[data-source-insert]'),status=root.querySelector('[data-source-placement-status]');
  let disposed=false,pending=false,destinationStamp=null;
  const listeners=[];
  const listen=(element,name,callback)=>{element.addEventListener(name,callback);listeners.push(()=>element.removeEventListener(name,callback));};
  const item=role=>canCommit()?sourcePlacementItem(getContext(),role):null;
  const nativeInsertion=createNativeSourceInsertion({getContext:getNativeContext??getContext,canCommit,commit,onStatus:text=>{if(!disposed)status.textContent=text;}});
  const apply=async(selected,start,target,overwrite,current,signal)=>{
    const operation=sourcePlacementOperation(selected,start,target,overwrite);
    if(selected.source_kind!=='native_asset')return commit(operation);
    const abort=()=>nativeInsertion.cancel();
    signal?.addEventListener('abort',abort,{once:true});pending=true;refresh();
    try{return await nativeInsertion.run(operation,current);}
    finally{signal?.removeEventListener('abort',abort);pending=false;refresh();}
  };
  function refresh(){
    if(disposed)return;
    nativeInsertion.invalidate();
    const context=getContext(),targets=context?.tracks??[],stamp=JSON.stringify(targets.map(track=>[track.id,track.kind,track.label,track.locked]));
    if(stamp!==destinationStamp){
      const selected=destinationStamp==='[]'?'':destination.value;destination.replaceChildren();
      const option=(label,value,disabled=false)=>{const node=root.ownerDocument.createElement('option');node.value=value;node.textContent=label;node.disabled=disabled;destination.append(node);};
      targets.forEach(track=>option(track.label || `${track.kind==='video'?'Video':'Audio'} ${track.id}`,`track:${track.id}`,track.locked));
      option('New video track','new_video_track');option('New audio track','new_audio_track');
      if([...destination.options].some(option=>option.value===selected && !option.disabled))destination.value=selected;
      else destination.value=[...destination.options].find(option=>!option.disabled)?.value??'new_video_track';
      destinationStamp=stamp;
    }
    const selected=item(streams.value),all=item('all');
    for(const option of streams.options)option.disabled=!item(option.value);
    streams.disabled=pending || !all;destination.disabled=pending || !selected;insert.disabled=pending || !selected || !canInsert();
    for(const surface of surfaces)surface.draggable=Boolean(all) && !pending;
    for(const [button,role] of handles){button.draggable=Boolean(item(role)) && !pending;button.disabled=!button.draggable;button.hidden=!(all?.has_video && all?.has_audio);}
    status.textContent=selected?`${selected.source_in}–${selected.source_out} · ${selected.streams==='video_only' || !selected.has_audio?'video only':selected.streams==='audio_only' || !selected.has_video?'all audio streams':'video and all audio streams'}${pending?' · inserting…':''}`:'Wait for a verified Source preview and valid marks';
  }
  function drag(event,role){
    if(!event.dataTransfer || pending){event.preventDefault();return;}
    onStart();const captured=item(role);if(!captured){event.preventDefault();refresh();return;}
    const key=JSON.stringify(captured),current=()=>!disposed && JSON.stringify(item(role))===key;
    const payload=sourceDnd.start([captured],current,async(draft,isCurrent,signal)=>{
      if(!isCurrent())throw Error('The marked Source range changed before insertion');
      await apply(captured,draft.start_frame,draft.target,draft.overwrite,()=>isCurrent() && current(),signal);
    });
    if(!payload){event.preventDefault();return;}
    event.dataTransfer.setData(SOURCE_DRAG_TYPE,payload);event.dataTransfer.effectAllowed='copy';
    refresh();
  }
  for(const surface of surfaces){listen(surface,'dragstart',event=>drag(event,'all'));listen(surface,'dragend',()=>{sourceDnd.end();refresh();});}
  for(const [button,role] of handles){
    listen(button,'dragstart',event=>{event.stopPropagation();drag(event,role);});listen(button,'dragend',()=>{sourceDnd.end();refresh();});
    listen(button,'click',()=>{streams.value=role;root.open=true;refresh();destination.focus();});
  }
  listen(streams,'change',refresh);listen(destination,'change',refresh);
  listen(insert,'click',()=>{
    if(pending || !canInsert())return;onStart();const selected=item(streams.value),context=getContext();if(!selected){refresh();return;}
    const target=destination.value.startsWith('track:')?{kind:'track',track_id:destination.value.slice(6)}:{kind:destination.value};
    pending=true;refresh();
    const key=JSON.stringify(selected),destinationValue=destination.value,current=()=>!disposed && canInsert() && streams.value===selected.streams && destination.value===destinationValue && getContext()?.frame===context.frame && JSON.stringify(item(selected.streams))===key;
    void (async()=>{try{await apply(selected,context.frame,target,context.overwrite,current);}catch(error){notice(error.message);}finally{pending=false;refresh();}})();
  });
  refresh();
  return {refresh,dispose(){if(disposed)return;disposed=true;nativeInsertion.cancel();sourceDnd.end();for(const remove of listeners)remove();for(const surface of surfaces)surface.draggable=false;}};
}
