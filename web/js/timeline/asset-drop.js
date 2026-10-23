import {HEADER,RULER,MAX_FRAME,frameToX,xToFrame,snapFrame,linkedSelection,timelineLayout,timelineLayoutStamp} from './geometry.js';

export const ASSET_DRAG_TYPE='application/x-venturi-native-assets';
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const fps=value=>Number.isSafeInteger(value?.num) && value.num>0 && value.num<=2147483647 && Number.isSafeInteger(value.den) && value.den>0 && value.den<=2147483647;
export function nativeAssetDragItems(items){
  if(!Array.isArray(items) || !items.length || items.length>32 || new Set(items.map(item=>item?.id)).size!==items.length)return null;
  for(const item of items){
    const roots=item?.placement?.items,root=roots?.[0];
    if(!id(item?.id) || typeof item.revision!=='string' || !item.revision || item.revision.length>256 || /[\u0000-\u001f\u007f]/.test(item.revision) || typeof item.name!=='string' || !item.name.trim() || item.name.length>4096 || item.error!=null || item.archived===true || item.placement?.error!=null || ![item.placement?.project_epoch,item.placement?.generation].every(value=>typeof value==='string' && value.length>0) || !Array.isArray(roots) || roots.length!==1 || !root || root.source_in!==0 || !Number.isSafeInteger(root.source_out) || root.source_out<=0 || root.source_out>MAX_FRAME || !fps(root.fps) || typeof root.has_video!=='boolean' || typeof root.has_audio!=='boolean' || !(root.has_video || root.has_audio) || typeof root.is_image!=='boolean' || !Number.isSafeInteger(root.audio_streams) || root.audio_streams<0 || root.audio_streams>128 || root.has_audio && root.audio_streams<1)return null;
  }
  return items.map(item=>({id:item.id,revision:item.revision,name:item.name,placement:structuredClone(item.placement)}));
}
const conformed=(frame,source,target)=>{
  const n=BigInt(frame)*BigInt(target.num)*BigInt(source.den),d=BigInt(target.den)*BigInt(source.num);
  return (2n*n+d)/(2n*d);
};

export function nativeAssetPlacement(timeline,view,[x,y],width,height,items){
  const sources=nativeAssetDragItems(items);
  if(!sources)return null;
  const draft=mediaRangePlacement(timeline,view,[x,y],width,height,sources.map(item=>({name:item.name,...item.placement.items[0]})));
  return draft?{...draft,kind:'native_asset_placement',assets:sources.map(item=>({asset_id:item.id,revision:item.revision}))}:null;
}

export function mediaRangePlacement(timeline,view,[x,y],width,height,items){
  if(!Array.isArray(items) || !items.length || items.length>32 || items.some(item=>!fps(item?.fps) || !Number.isSafeInteger(item.source_in) || item.source_in<0 || !Number.isSafeInteger(item.source_out) || item.source_out<=item.source_in || item.source_out>MAX_FRAME || typeof item.has_video!=='boolean' || typeof item.has_audio!=='boolean' || !(item.has_video || item.has_audio) || !Number.isSafeInteger(item.audio_streams) || item.audio_streams<0 || item.audio_streams>128 || item.has_audio && item.audio_streams<1))return null;
  if(!fps(timeline?.fps) || !Array.isArray(timeline.tracks) || ![x,y,width,height,view.scale,view.origin].every(Number.isFinite) || view.scale<=0 || x<HEADER || x>=width || y<RULER || y>=height)return null;
  const layout=timelineLayout(timeline,view,height),hover=layout.trackAtY(y),hovered=timeline.tracks[hover],pane=layout.paneAtY(y);
  let target;
  if(hovered)target={kind:'track',track_id:hovered.id};
  else if(pane==='video' || y>=layout.videoPane.top && y<layout.videoPane.bottom)target={kind:'new_video_track'};
  else if(pane==='audio' || y>=layout.audioPane.top && y<layout.audioPane.bottom)target={kind:'new_audio_track'};
  else return null;
  const segments=items.map(item=>({...item,length_frames:Number(conformed(item.source_out,item.fps,timeline.fps)-conformed(item.source_in,item.fps,timeline.fps))}));
  const length=segments.reduce((sum,item)=>sum+item.length_frames,0);
  if(segments.some(item=>item.length_frames<=0) || !Number.isSafeInteger(length) || length>MAX_FRAME)return null;
  const candidates=timeline.tracks.flatMap(track=>track.clips.flatMap(clip=>[clip.start_frame,clip.start_frame+clip.length_frames]));candidates.push(view.playhead);
  const raw=xToFrame(x,view,timeline.fps),start=view.snap?snapFrame(raw,candidates,view,timeline.fps,10,length):raw;
  let error=hovered?.locked?'The target track is locked':start+length>MAX_FRAME?'The asset set exceeds the timeline frame limit':null;
  const video=timeline.tracks.findIndex(track=>track.kind==='video' && !track.locked),audios=timeline.tracks.flatMap((track,index)=>track.kind==='audio' && !track.locked?[index]:[]),hasAudio=timeline.tracks.some(track=>track.kind==='audio');
  const hasVideo=segments.some(item=>item.has_video),newRows=[],outlines=[],overlaps=[];
  let videoTarget=hasVideo && hovered?.kind==='video'?hover:video,offset=0;
  const newRow=kind=>{const row={kind,depth:1+newRows.filter(row=>row.kind===kind).length};newRows.push(row);return row;};
  if(target.kind==='new_video_track' && hasVideo)videoTarget=newRow('video');
  else if(hasVideo && videoTarget<0)videoTarget=newRow('video');
  const audioTargets=[...audios];if(target.kind==='new_audio_track' && segments.some(item=>item.has_audio))audioTargets.unshift(newRow('audio'));
  for(const segment of segments){
    const destinations=[];
    if(segment.has_video)destinations.push(videoTarget);
    const streams=segment.has_audio && (hasAudio || audioTargets.length || !segment.has_video)?segment.audio_streams:0;
    while(audioTargets.length<streams)audioTargets.push(newRow('audio'));
    destinations.push(...audioTargets.slice(0,streams));
    for(const destination of destinations){
      const existing=Number.isInteger(destination),track=existing?timeline.tracks[destination]:null,box=existing?layout.pane(destination):destination.kind==='video'?layout.videoPane:layout.audioPane,top=existing?layout.trackTop(destination):layout.newTrackTop(destination.kind,destination.depth);
      const left=Math.max(HEADER,frameToX(start+offset,view,timeline.fps)),right=Math.min(width,frameToX(start+offset+segment.length_frames,view,timeline.fps));
      const clippedTop=existing?Math.max(box.top,top+3):Math.max(box.top+2,Math.min(box.bottom-22,top+3)),bottom=existing?Math.min(box.bottom,top+layout.rowHeight-3):Math.min(box.bottom-2,clippedTop+layout.rowHeight-6);
      if(right>left && bottom>clippedTop)outlines.push({left,right,top:clippedTop,bottom,name:existing?segment.name:`New ${destination.kind} track · ${segment.name}`,track_id:track?.id??null,start_frame:start+offset,length_frames:segment.length_frames});
      if(track)for(const clip of track.clips)if(clip.start_frame<start+offset+segment.length_frames && clip.start_frame+clip.length_frames>start+offset)overlaps.push(clip.id);
    }
    offset+=segment.length_frames;
  }
  if(timeline.tracks.length+newRows.length>128)error='The timeline track limit would be exceeded';
  if(overlaps.length){
    const affected=linkedSelection(timeline,overlaps);
    if(timeline.tracks.some(track=>track.locked && track.clips.some(clip=>affected.includes(clip.id))))error='An overlapping clip or linked peer is locked';
    else if(!view.retimeOverwrite)error='Clips overlap the destination · enable overwrite to replace them';
  }
  return {start_frame:start,length_frames:length,target,overwrite:Boolean(view.retimeOverwrite),outlines,error};
}

export function createMediaDrop({canvas,getTimeline,getAssetContext=()=>null,view,invalidate,onNotice=()=>{},canEdit=()=>true,getBusy=()=>false,setBusy=()=>{},cancelGesture=()=>{},type,normalizeItems,placement,itemContext}){
  let owner=null,disposed=false,serial=0;
  const documentRef=canvas.ownerDocument,modal=()=>Boolean(documentRef?.querySelector?.('dialog[open]'));
  const bounds=()=>{const rect=canvas.getBoundingClientRect();return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,localWidth:canvas.clientWidth??rect.width,localHeight:canvas.clientHeight??rect.height};};
  const stamp=()=>{try{const context=getAssetContext(),timeline=getTimeline(),rect=bounds(),epoch=context?.epoch??context?.project_epoch,generation=context?.generation??context?.if_generation,id=context?.timeline??context?.timeline_id;if(!timeline || ![epoch,generation,id,context?.revision].every(value=>typeof value==='string' && value) || timeline.id!==id || timeline.revision!==context.revision || !fps(timeline.fps) || !Object.values(rect).every(Number.isFinite) || rect.width<=0 || rect.height<=0)return null;return JSON.stringify([context,timeline.fps,view.scale,view.origin,view.scrollY,timelineLayoutStamp(view),view.playhead,view.selection,view.selectionAnchor,view.selectedGap,view.transitionSelection,view.tool,view.snap,view.retimeOverwrite,rect]);}catch{return null;}};
  function cancel(){const bound=owner;if(!bound)return;owner=null;bound.controller.abort();if(view.draft===bound.draft)view.draft=null;if(!disposed)invalidate();}
  function end(){if(owner?.phase==='dragging')cancel();}
  function current(bound=owner){
    if(!bound)return false;
    const valid=()=>!disposed && owner===bound && !bound.controller.signal.aborted && !documentRef?.hidden && !modal() && canEdit() && (!getBusy() || bound.phase==='preparing') && getTimeline()===bound.timeline && stamp()===bound.stamp;
    try{if(valid() && bound.sourceCurrent(bound.items)===true && valid())return true;}catch{}
    if(owner===bound)cancel();return false;
  }
  function start(items,sourceCurrent,onDrop){
    if(owner?.phase==='preparing')return null;cancel();
    const sources=normalizeItems(items);if(disposed || getBusy() || !canEdit() || modal() || documentRef?.hidden || !sources || typeof sourceCurrent!=='function' || typeof onDrop!=='function')return null;
    const context=getAssetContext();if(sources.some(item=>itemContext(item).project_epoch!==(context?.epoch??context?.project_epoch) || itemContext(item).generation!==(context?.generation??context?.if_generation)))return null;
    try{if(sourceCurrent(sources)!==true)return null;}catch{return null;}
    cancelGesture();const identity=stamp();if(!identity || getBusy() || !canEdit())return null;
    const token=globalThis.crypto?.randomUUID?.()??`${++serial}:${Math.random().toString(36).slice(2)}`;
    const bound={items:sources,sourceCurrent,onDrop,timeline:getTimeline(),stamp:identity,controller:new AbortController(),phase:'dragging',payload:JSON.stringify({version:1,token}),draft:null};owner=bound;
    return current(bound)?bound.payload:null;
  }
  const hasType=event=>{try{return Array.from(event.dataTransfer?.types||[]).includes(type);}catch{return false;}};
  const at=event=>{const rect=bounds();return placement(getTimeline(),view,[(event.clientX-rect.left)*rect.localWidth/rect.width,(event.clientY-rect.top)*rect.localHeight/rect.height],rect.localWidth,rect.localHeight,owner.items);};
  function over(event){if(!hasType(event))return false;if(!current() || owner.phase!=='dragging')return true;event.preventDefault();owner.draft=at(event);view.draft=owner.draft;event.dataTransfer.dropEffect=owner.draft && !owner.draft.error?'copy':'none';invalidate();return true;}
  function leave(event){if(owner?.phase==='dragging' && event.relatedTarget!==canvas && view.draft===owner.draft){view.draft=null;invalidate();}}
  async function drop(event){
    if(!hasType(event))return false;event.preventDefault();const bound=owner;if(!current(bound) || bound.phase!=='dragging')return true;
    try{if(event.dataTransfer.getData(type)!==bound.payload){cancel();return true;}}catch(error){cancel();onNotice(error.message);return true;}
    if(!current(bound))return true;const draft=at(event);if(!draft || draft.error){cancel();if(draft?.error)onNotice(draft.error);return true;}
    bound.phase='preparing';bound.draft=draft;view.draft=draft;setBusy(true);invalidate();
    try{if(current(bound))await bound.onDrop(structuredClone(draft),()=>current(bound),bound.controller.signal);}
    catch(error){if(!disposed && error.name!=='AbortError')onNotice(error.message);}
    finally{if(owner===bound)owner=null;if(view.draft===draft)view.draft=null;setBusy(false);if(!disposed)invalidate();}
    return true;
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(owner)current();}):null;observer?.observe(canvas);
  return {dnd:{type,start,end},active:()=>Boolean(owner),current,cancel,over,leave,drop,hasType,destroy(){disposed=true;cancel();observer?.disconnect();}};
}

export const createAssetDrop=options=>createMediaDrop({...options,type:ASSET_DRAG_TYPE,normalizeItems:nativeAssetDragItems,placement:nativeAssetPlacement,itemContext:item=>item.placement});
