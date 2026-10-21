import {HEADER,RULER,TRACK,MAX_FRAME,frameToX,linkedSelection} from './geometry.js';

export const PRESET_DRAG_TYPE='application/x-venturi-preset';
const nativeClip=clip=>typeof clip?.id==='string' && clip.id.length>0 && Number.isSafeInteger(clip.start_frame) && clip.start_frame>=0 && Number.isSafeInteger(clip.length_frames) && clip.length_frames>0 && clip.start_frame+clip.length_frames<=MAX_FRAME;
const metadata=item=>item && typeof item.id==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(item.id) && typeof item.revision==='string' && item.revision.length>0 && item.revision.length<=256 && !/[\u0000-\u001f\u007f]/.test(item.revision) && typeof item.name==='string' && item.name.trim().length>0 && new TextEncoder().encode(item.name).length<=128 && !/[\u0000-\u001f\u007f]/.test(item.name) && typeof item.video==='boolean' && typeof item.audio==='boolean' && (item.video || item.audio) && item.archived!==true && item.error==null;

export function presetApplication(timeline,view,[x,y],width,height,item){
  if(!metadata(item) || !Array.isArray(timeline?.tracks) || ![x,y,width,height,view.scale,view.origin,view.scrollY].every(Number.isFinite) || width<=HEADER || height<=RULER || x<HEADER || x>=width || y<RULER || y>=height || view.scale<=0 || !Number.isSafeInteger(timeline.fps?.num) || !Number.isSafeInteger(timeline.fps?.den) || timeline.fps.num<=0 || timeline.fps.den<=0)return null;
  const index=Math.floor((y-RULER+view.scrollY)/TRACK),track=timeline.tracks[index];
  if(!track || !['video','audio'].includes(track.kind))return null;
  const top=RULER+index*TRACK-view.scrollY;
  if(y<Math.max(RULER,top+7) || y>=Math.min(height,top+TRACK-7))return null;
  const clip=track.clips.find(clip=>nativeClip(clip) && x>=Math.max(HEADER,frameToX(clip.start_frame,view,timeline.fps)+1) && x<Math.min(width,frameToX(clip.start_frame+clip.length_frames,view,timeline.fps)-1));
  if(!clip)return null;
  const selection=Array.isArray(view.selection)?view.selection:[],clip_ids=selection.includes(clip.id)?[...selection]:[clip.id];
  const affected_ids=linkedSelection(timeline,clip_ids),affected=timeline.tracks.flatMap((track,index)=>track.clips.filter(clip=>affected_ids.includes(clip.id)).map(clip=>({track,index,clip})));
  let error=null;
  if(clip_ids.length===0 || new Set(clip_ids).size!==clip_ids.length || clip_ids.some(id=>typeof id!=='string' || !affected.some(({clip})=>clip.id===id)))error='The selected clips changed · refresh the timeline';
  else if(track.locked || affected.some(({track})=>track.locked))error='The target or a selected or linked track is locked';
  else if(!affected.some(({track})=>item[track.kind]===true))error='This preset has no matching video or audio source for these clips';
  const outlines=affected.flatMap(({track,index,clip})=>{
    const left=Math.max(HEADER,frameToX(clip.start_frame,view,timeline.fps)+1),right=Math.min(width,frameToX(clip.start_frame+clip.length_frames,view,timeline.fps)-1),top=Math.max(RULER,RULER+index*TRACK-view.scrollY+7),bottom=Math.min(height,RULER+(index+1)*TRACK-view.scrollY-7);
    return right>left && bottom>top?[{clip_id:clip.id,track_id:track.id,left,right,top,bottom}]:[];
  });
  return {kind:'preset_application',preset_id:item.id,name:item.name,target_clip_id:clip.id,clip_ids,affected_ids,outlines,count:affected_ids.length,error};
}

export function createPresetDrop({canvas,getTimeline,getPresetContext=()=>null,view,invalidate,onCommand,onNotice=()=>{},canEdit=()=>true,getBusy=()=>false,setBusy=()=>{},cancelGesture=()=>{}}){
  let drag=null,disposed=false,serial=0;
  const documentRef=canvas.ownerDocument;
  const modal=()=>Boolean(documentRef?.querySelector?.('dialog[open]'));
  const bounds=()=>{
    const rect=canvas.getBoundingClientRect(),width=canvas.clientWidth ?? rect.width,height=canvas.clientHeight ?? rect.height;
    return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,localWidth:width,localHeight:height};
  };
  const stamp=()=>{
    try{
      const context=getPresetContext(),timeline=getTimeline(),rect=bounds();
      if(!context || !timeline || ![rect.left,rect.top,rect.width,rect.height,rect.localWidth,rect.localHeight].every(Number.isFinite) || rect.width<=0 || rect.height<=0 || rect.localWidth<=HEADER || rect.localHeight<=RULER)return null;
      const epoch=context.epoch ?? context.project_epoch,generation=context.generation ?? context.if_generation,id=context.timeline ?? context.timeline_id;
      if(![epoch,generation,id,context.revision].every(value=>typeof value==='string' && value.length>0) || timeline.id!==id || timeline.revision!==context.revision || !Number.isSafeInteger(timeline.fps?.num) || !Number.isSafeInteger(timeline.fps?.den) || timeline.fps.num<=0 || timeline.fps.den<=0)return null;
      return JSON.stringify([context,timeline.fps,view.scale,view.origin,view.scrollY,view.playhead,view.tool,view.snap,view.selection,view.transitionSelection,view.transitionReplace,view.retimeOverwrite,[...(view.retimeVisible || [])].sort(),rect]);
    }catch{return null;}
  };
  function end(){
    const changed=Boolean(drag || view.draft?.kind==='preset_application');drag=null;
    if(view.draft?.kind==='preset_application')view.draft=null;
    if(changed && !disposed)invalidate();
  }
  const boundCurrent=bound=>!disposed && drag===bound && !getBusy() && !documentRef?.hidden && !modal() && canEdit() && getTimeline()===bound.timeline && stamp()===bound.stamp;
  function current(bound=drag){
    if(!bound)return false;
    try{
      if(boundCurrent(bound) && bound.sourceCurrent(bound.item)===true && boundCurrent(bound))return true;
    }catch{}
    end();return false;
  }
  function start(item,sourceCurrent){
    end();
    if(disposed || getBusy() || !canEdit() || modal() || documentRef?.hidden || !metadata(item) || typeof sourceCurrent!=='function')return null;
    const source=Object.freeze({id:item.id,revision:item.revision,name:item.name,video:item.video,audio:item.audio});
    try{if(sourceCurrent(source)!==true)return null;}catch{return null;}
    cancelGesture();
    const timeline=getTimeline(),identity=stamp();
    if(!identity || getBusy() || !canEdit() || modal() || documentRef?.hidden)return null;
    const token=globalThis.crypto?.randomUUID?.() ?? `${++serial}:${Math.random().toString(36).slice(2)}`;
    const payload=JSON.stringify({version:1,token,preset_id:source.id,revision:source.revision});
    drag={timeline,stamp:identity,item:source,sourceCurrent,payload};
    return current()?payload:null;
  }
  const hasType=event=>{
    try{return Array.from(event.dataTransfer?.types || []).includes(PRESET_DRAG_TYPE);}catch{return false;}
  };
  const at=event=>{
    const rect=bounds();
    if(!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || event.clientX<rect.left || event.clientX>=rect.left+rect.width || event.clientY<rect.top || event.clientY>=rect.top+rect.height)return null;
    return presetApplication(getTimeline(),view,[(event.clientX-rect.left)*rect.localWidth/rect.width,(event.clientY-rect.top)*rect.localHeight/rect.height],rect.localWidth,rect.localHeight,drag.item);
  };
  function over(event){
    if(!hasType(event))return false;
    if(!current())return true;
    event.preventDefault();
    view.draft=at(event);event.dataTransfer.dropEffect=view.draft && !view.draft.error?'copy':'none';invalidate();return true;
  }
  function leave(event){
    if(drag && event.relatedTarget!==canvas && view.draft?.kind==='preset_application'){view.draft=null;invalidate();}
  }
  async function drop(event){
    if(!hasType(event) || !drag)return false;
    const bound=drag;
    event.preventDefault();
    if(!current(bound)){onNotice('Preset drop cancelled because its source, timeline or editing context changed');return true;}
    let payload;
    try{payload=event.dataTransfer.getData(PRESET_DRAG_TYPE);}catch(error){end();onNotice(error.message);return true;}
    if(payload!==bound.payload){end();onNotice('The preset drop no longer matches its active library source');return true;}
    if(!current(bound)){onNotice('Preset drop cancelled because its source or editing context changed');return true;}
    const draft=at(event);
    if(!draft || draft.error){end();if(draft?.error)onNotice(draft.error);return true;}
    if(!current(bound))return true;
    drag=null;view.draft=draft;setBusy(true);invalidate();
    try{await onCommand({kind:'apply_saved_preset',clip_ids:draft.clip_ids,preset_id:bound.item.id,revision:bound.item.revision});}
    catch(error){if(!disposed)onNotice(error.message);}
    finally{if(view.draft===draft)view.draft=null;setBusy(false);if(!disposed)invalidate();}
    return true;
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(drag && stamp()!==drag.stamp)end();}):null;
  observer?.observe(canvas);
  return {dnd:{type:PRESET_DRAG_TYPE,start,end},active:()=>Boolean(drag),current,over,leave,drop,hasType,destroy(){disposed=true;end();observer?.disconnect();}};
}
