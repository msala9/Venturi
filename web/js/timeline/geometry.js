export const HEADER = 150,
  RULER = 48,
  MARKER_TOP = 24,
  MARKER_BOTTOM = 42,
  TRACK = 62,
  MAX_FRAME = 1_000_000_000;
export function playheadSelection(timeline, frame) {
  if(!timeline)return [];
  const video=[...timeline.tracks].reverse().filter(track=>track.kind==="video" && !track.muted);
  const active=video.map(track=>track.clips.find(clip=>!clip.disabled && clip.start_frame<=frame && frame<clip.start_frame+clip.length_frames)).find(Boolean);
  if(!active)return [];
  return timeline.tracks.filter(track=>!track.locked).flatMap(track=>track.clips.filter(clip=>clip.id===active.id || (active.linked_group!=null && clip.linked_group===active.linked_group)).map(clip=>clip.id));
}
export function pixelsPerFrame(view, fps) {
  if (!(fps.num > 0 && fps.den > 0 && view.scale > 0))
    throw new RangeError("Invalid frame scale");
  return (view.scale * fps.den) / fps.num;
}
export const frameToX = (frame, view, fps) =>
  HEADER + (frame - view.origin) * pixelsPerFrame(view, fps);
export const xToFrame = (x, view, fps) =>
  Math.max(
    0,
    Math.min(
      MAX_FRAME,
      Math.round(view.origin + (x - HEADER) / pixelsPerFrame(view, fps)),
    ),
  );
export const visibleRange = (width, view, fps) => [
  view.origin,
  xToFrame(width, view, fps),
];
export function snapFrame(frame, candidates, view, fps, threshold = 8) {
  const limit = threshold / pixelsPerFrame(view, fps);
  let best = frame,
    distance = limit + Number.EPSILON;
  for (const candidate of candidates) {
    if (Math.abs(candidate - frame) <= distance) {
      best = candidate;
      distance = Math.abs(candidate - frame);
    }
  }
  return Math.max(0, best);
}
export function fadeHandles(clip,view,fps){
  if(!Number.isSafeInteger(clip.fade_in) || !Number.isSafeInteger(clip.fade_out) || clip.length_frames<1)return [];
  const left=frameToX(clip.start_frame,view,fps),right=frameToX(clip.start_frame+clip.length_frames,view,fps);
  if(right-left<20)return [];
  return ['in','out'].map(edge=>{const frames=Math.max(0,Math.min(clip.length_frames,clip[`fade_${edge}`])),end=frameToX(clip.start_frame+(edge==='in'?frames:clip.length_frames-frames),view,fps);return {edge,frames,end,x:Math.max(left+4,Math.min(right-4,end)),left,right};});
}
export function fadeDraft(clip,edge,delta){
  const original=clip[`fade_${edge}`],frames=Math.max(0,Math.min(clip.length_frames,original+(edge==='in'?delta:-delta)));
  return {kind:'fade',clip_id:clip.id,edge,frames,original};
}
const transitionClip=clip=>typeof clip?.id==='string' && clip.id.length>0 && clip.kind!=='adjustment' && Number.isSafeInteger(clip.start_frame) && clip.start_frame>=0 && Number.isSafeInteger(clip.length_frames) && clip.length_frames>0 && clip.start_frame+clip.length_frames<=MAX_FRAME;
const nativeTransition=transition=>transition && !Array.isArray(transition) && ['Push','CrossDissolve','SmoothCut'].includes(transition.kind) && ['Left','Right','Up','Down'].includes(transition.direction) && ['None','In','Out','InOut'].includes(transition.ease) && Number.isSafeInteger(transition.duration) && transition.duration>=1 && Number.isFinite(transition.curve) && transition.curve>=0 && transition.curve<=1;
function transitionGeometry(base,duration,view,fps){
  const crossing=base.slot==='cut_after',clip=base.clip,cut=crossing?base.left.start_frame+base.left.length_frames:null;
  const start_frame=crossing?cut-Math.ceil(duration/2):base.slot==='in'?clip.start_frame:clip.start_frame+clip.length_frames-duration;
  const end_frame=crossing?cut+Math.floor(duration/2):base.slot==='in'?clip.start_frame+duration:clip.start_frame+clip.length_frames;
  const shared={kind:'transition',slot:base.slot,clip_id:base.clip_id,left:base.left,right:base.right,duration,min:1,max:base.max,start_frame,end_frame,start_x:frameToX(start_frame,view,fps),end_x:frameToX(end_frame,view,fps),transition:{...structuredClone(base.transition),duration}};
  const handle=(clip,edge,dragSide,frame)=>({...shared,clip,edge,dragSide,x:frameToX(frame,view,fps)});
  return crossing?[handle(base.left,'out','left',start_frame),handle(base.right,'in','right',end_frame)]:[handle(clip,base.slot,base.slot==='in'?'right':'left',base.slot==='in'?end_frame:start_frame)];
}
export function transitionHandles(track,view,fps){
  if(track?.kind!=='video' || track.locked || view.tool==='slip')return [];
  const clips=track.clips || [],byId=new Map(clips.map(clip=>[clip.id,clip])),crossings=track.crossings || [],into=new Map(),from=new Map();
  for(const crossing of crossings){from.set(crossing.left_clip,crossing);into.set(crossing.right_clip,crossing);}
  const usable=clip=>transitionClip(clip) && clip.length_frames*pixelsPerFrame(view,fps)>=20;
  const crossingHandles=new Map();
  for(const crossing of crossings){
    const left=byId.get(crossing.left_clip),right=byId.get(crossing.right_clip),transition=crossing.transition;
    if(!transitionClip(left) || !transitionClip(right) || left===right || left.start_frame+left.length_frames!==right.start_frame || !nativeTransition(transition))continue;
    const max=2*Math.min(left.length_frames,right.length_frames),cut=right.start_frame;
    if(transition.duration>max || crossing.kind!==transition.kind || crossing.start_frame!==cut-Math.ceil(transition.duration/2) || crossing.end_frame!==cut+Math.floor(transition.duration/2))continue;
    crossingHandles.set(crossing,transitionGeometry({slot:'cut_after',clip_id:left.id,clip:left,left,right,transition,max},transition.duration,view,fps));
  }
  return clips.flatMap(clip=>{
    if(!usable(clip))return [];
    return ['in','out'].flatMap(slot=>{
      const crossing=(slot==='in'?into:from).get(clip.id);
      if(crossing)return (crossingHandles.get(crossing) || []).filter(handle=>handle.clip.id===clip.id && handle.edge===slot);
      const transition=clip[`transition_${slot}`];if(!nativeTransition(transition) || transition.duration>clip.length_frames)return [];
      return transitionGeometry({slot,clip_id:clip.id,clip,left:null,right:null,transition,max:clip.length_frames},transition.duration,view,fps);
    });
  });
}
export function transitionDraft(handle,pixelDelta,view,fps){
  if(handle?.kind!=='transition' || !['in','out','cut_after'].includes(handle.slot) || !nativeTransition(handle.transition) || !Number.isFinite(pixelDelta) || !Number.isSafeInteger(handle.max) || handle.max<1)throw Error('Choose a complete native transition handle');
  const signed=Math.fround(handle.dragSide==='left'?-pixelDelta:pixelDelta),scale=Math.fround(pixelsPerFrame(view,fps));
  const delta=Math.fround((handle.slot==='cut_after'?Math.fround(2*signed):signed)/scale),raw=Math.fround(Math.fround(handle.duration)+delta);
  if(!Number.isFinite(raw))throw Error('Transition pointer exceeds its native frame budget');
  const rounded=raw<0?-Math.round(-raw):Math.round(raw),duration=pixelDelta===0?handle.duration:Math.max(1,Math.min(handle.max,rounded));
  const handles=transitionGeometry(handle,duration,view,fps),geometry=handles.find(candidate=>candidate.clip.id===handle.clip.id && candidate.edge===handle.edge);
  return {...handle,...geometry,original:handle.duration,handles,operation:{kind:'set_transition',clip_id:handle.clip_id,slot:handle.slot,transition:structuredClone(geometry.transition)}};
}
const transitionEligible=clip=>transitionClip(clip) && ['media','solid_color','title'].includes(clip.kind);
const sameTransition=(a,b)=>nativeTransition(a) && nativeTransition(b) && ['kind','duration','direction','ease','curve'].every(key=>a[key]===b[key]);
export function selectedTransition(timeline,selection){
  if(!selection || !['in','out','cut_after'].includes(selection.slot))return null;
  const track=timeline?.tracks?.find(track=>track.id===selection.track_id),clip=track?.clips?.find(clip=>clip.id===selection.clip_id);
  if(track?.kind!=='video' || !transitionEligible(clip))return null;
  const crossings=track.crossings || [];
  let left=null,right=null,transition,max=clip.length_frames;
  if(selection.slot==='cut_after'){
    const matches=crossings.filter(crossing=>crossing.left_clip===clip.id);if(matches.length!==1)return null;
    const crossing=matches[0];left=clip;right=track.clips.find(candidate=>candidate.id===crossing.right_clip);transition=crossing.transition;
    if(!transitionEligible(right) || left===right || left.start_frame+left.length_frames!==right.start_frame || !nativeTransition(transition))return null;
    max=2*Math.min(left.length_frames,right.length_frames);
    if(transition.duration>max || crossing.kind!==transition.kind || crossing.start_frame!==right.start_frame-Math.ceil(transition.duration/2) || crossing.end_frame!==right.start_frame+Math.floor(transition.duration/2) || crossings.some(other=>other!==crossing && (other.left_clip===left.id || other.right_clip===right.id)))return null;
  }else{
    if(crossings.some(crossing=>(selection.slot==='in'?crossing.right_clip:crossing.left_clip)===clip.id))return null;
    transition=clip[`transition_${selection.slot}`];
    if(!nativeTransition(transition) || transition.duration>max)return null;
  }
  const canonical={track_id:track.id,clip_id:clip.id,slot:selection.slot};
  return {...canonical,selection:canonical,transition:structuredClone(transition),max,locked:!!track.locked,clip,left,right,involved_clips:left?[left,right]:[clip]};
}
export function transitionBodies(track,view,fps){
  if(track?.kind!=='video' || track.locked || view.tool==='slip')return [];
  const timeline={tracks:[track]},crossings=track.crossings || [];
  return (track.clips || []).flatMap(clip=>['in','out'].flatMap(edge=>{
    const crossing=crossings.find(crossing=>(edge==='in'?crossing.right_clip:crossing.left_clip)===clip.id);
    const selection={track_id:track.id,clip_id:crossing?crossing.left_clip:clip.id,slot:crossing?'cut_after':edge},descriptor=selectedTransition(timeline,selection);
    if(!descriptor)return [];
    const handles=transitionGeometry(descriptor,descriptor.transition.duration,view,fps),handle=handles.find(handle=>handle.clip.id===clip.id && handle.edge===edge);
    if(!handle)return [];
    const left=frameToX(clip.start_frame,view,fps),right=frameToX(clip.start_frame+clip.length_frames,view,fps);
    return [{...handle,kind:'transition_body',track_id:track.id,selection:descriptor.selection,left_x:edge==='in'?left:handle.x,right_x:edge==='in'?handle.x:right}];
  }));
}
export function transitionPlacement(timeline,view,point,transition,{replace=false,source=null}={}){
  const blocked=error=>({kind:'transition_placement',error,noop:false,replacement:false,operation:null,handles:[]});
  const [x,y]=Array.isArray(point)?point:[point?.x,point?.y];
  if(!Number.isFinite(x) || !Number.isFinite(y) || x<HEADER || y<RULER || view.tool==='slip')return blocked('Drop a transition near a video clip edge');
  const trackIndex=Math.floor((y-RULER+view.scrollY)/TRACK),track=timeline?.tracks?.[trackIndex],top=RULER+trackIndex*TRACK-view.scrollY;
  if(track?.kind!=='video' || track.locked || y<top+7 || y>top+TRACK-7)return blocked('Choose an unlocked video clip');
  const payload=typeof transition==='string'?(timeline.transition_defaults || []).find(candidate=>candidate.kind===transition):transition;
  if(!nativeTransition(payload))return blocked('A complete native transition is required');
  if(source){
    const original=selectedTransition(timeline,source);
    if(!original || original.locked || !sameTransition(original.transition,payload))return blocked('The source transition changed or is locked');
  }
  const clip=(track.clips || []).find(clip=>transitionClip(clip) && x>=frameToX(clip.start_frame,view,timeline.fps) && x<=frameToX(clip.start_frame+clip.length_frames,view,timeline.fps));
  if(!transitionEligible(clip))return blocked('Choose a media, solid or title clip edge');
  const clipLeft=frameToX(clip.start_frame,view,timeline.fps),clipRight=frameToX(clip.start_frame+clip.length_frames,view,timeline.fps),zone=Math.min(40,(clipRight-clipLeft)/2);
  const edge=x-clipLeft<=zone?'in':clipRight-x<=zone?'out':null;
  if(!edge)return blocked('Drop within 40 pixels of the nearest clip edge');
  const neighbors=track.clips.filter(candidate=>candidate.id!==clip.id && (edge==='in'?candidate.start_frame+candidate.length_frames===clip.start_frame:candidate.start_frame===clip.start_frame+clip.length_frames));
  if(neighbors.length>1 || neighbors.some(candidate=>!transitionEligible(candidate)))return blocked('The adjacent clip cannot accept a transition');
  const neighbor=neighbors[0],left=neighbor?(edge==='in'?neighbor:clip):null,right=neighbor?(edge==='in'?clip:neighbor):null,slot=neighbor?'cut_after':edge,anchor=left || clip;
  const selection={track_id:track.id,clip_id:anchor.id,slot},max=neighbor?2*Math.min(left.length_frames,right.length_frames):clip.length_frames;
  const occupied=(track.crossings || []).filter(crossing=>neighbor?(crossing.left_clip===left.id || crossing.right_clip===right.id):(edge==='in'?crossing.right_clip:crossing.left_clip)===clip.id);
  const existing=selectedTransition(timeline,selection);
  if(occupied.length && !existing)return blocked('The destination crossing snapshot is incomplete');
  const singles=neighbor?[left.transition_out,right.transition_in]:[clip[`transition_${edge}`]];
  const singleClips=neighbor?[left,right]:[clip];
  if(!occupied.length && singles.some((value,index)=>value!=null && (!nativeTransition(value) || value.duration>singleClips[index].length_frames)))return blocked('The destination transition snapshot is incomplete');
  const next={...structuredClone(payload),duration:Math.max(1,Math.min(max,payload.duration))},noop=!!existing && sameTransition(existing.transition,next),replacement=!!existing || (!occupied.length && singles.some(value=>value!=null));
  const handles=transitionGeometry({slot,clip_id:anchor.id,clip:anchor,left,right,transition:next,max},next.duration,view,timeline.fps),geometry=handles[0];
  const error=replacement && !noop && replace!==true?'A destination transition exists; enable Replace explicitly':null;
  return {...geometry,kind:'transition_placement',track:trackIndex,track_id:track.id,clip:anchor,left,right,selection,handles,transition:structuredClone(next),replacement,error,noop,operation:error || noop?null:{kind:'set_transition',clip_id:anchor.id,slot,transition:structuredClone(next)}};
}
function retimeMetadata(clip){
  const metadata=clip?.retime;
  return transitionClip(clip) && clip.kind==='media' && Number.isSafeInteger(metadata?.source_span) && metadata.source_span>0 && Number.isSafeInteger(metadata.min_length) && metadata.min_length>=1 && Number.isSafeInteger(metadata.max_length) && metadata.max_length>=metadata.min_length && metadata.max_length<=MAX_FRAME-clip.start_frame && typeof metadata.pitch_correction==='boolean';
}
export function retimeHandles(track,view,fps){
  if(view.retime!==true || view.tool==='slip' || !['video','audio'].includes(track?.kind) || track.locked)return [];
  return (track.clips || []).filter(clip=>!view.retimeHidden?.has(clip.id) && retimeMetadata(clip) && clip.length_frames*pixelsPerFrame(view,fps)>=20).map(clip=>{
    const end_frame=clip.start_frame+clip.length_frames,left=frameToX(clip.start_frame,view,fps),right=frameToX(end_frame,view,fps);
    return {kind:'retime',clip,clip_id:clip.id,end_frame,metadata:structuredClone(clip.retime),left,right,x:right,topOffset:7,bottomOffset:21};
  });
}
export function retimeStrips(track,view,fps,width=Infinity){
  return retimeHandles(track,view,fps).flatMap(handle=>{
    const left=Math.max(HEADER,handle.left),right=Math.min(width,handle.right),visible=right-left;
    if(visible<12)return [];
    const endpointVisible=handle.right<=width,endpointInset=endpointVisible?10:0,showClose=visible>=90;
    const close=showClose?{left:right-endpointInset-16,right:right-endpointInset}:null;
    const menuRight=close?close.left-2:right-endpointInset,menuWidth=Math.min(120,Math.max(0,menuRight-left)),center=(left+menuRight)/2;
    return [{...handle,visibleLeft:left,visibleRight:right,menu:{left:center-menuWidth/2,right:center+menuWidth/2},close}];
  });
}
export function retimeSpeedLabel(percent){
  if(!Number.isFinite(percent) || percent<=0)return 'Speed unavailable';
  return `${Math.abs(percent-Math.round(percent))<0.005?Math.round(percent):percent.toFixed(2)}%`;
}
export function retimeDraft(handle,pixelDelta,timeline,view){
  if(handle?.kind!=='retime' || !retimeMetadata({...handle.clip,retime:handle.metadata}) || !Number.isFinite(pixelDelta))throw Error('Choose a complete native speed handle');
  const clip=handle.clip,metadata=handle.metadata,source=timeline.tracks.find(track=>track.clips.some(candidate=>candidate.id===clip.id));
  if(!source)throw Error('The speed handle clip is no longer in this timeline');
  const linked=typeof clip.linked_group==='string'?timeline.tracks.flatMap(track=>track.clips.filter(candidate=>candidate.linked_group===clip.linked_group).map(candidate=>({track,clip:candidate}))):[{track:source,clip}];
  const exclude=new Set([clip.id,...linked.map(target=>target.clip.id)]),candidates=[view.playhead,...timeline.tracks.flatMap(track=>track.clips.filter(candidate=>!exclude.has(candidate.id)).flatMap(candidate=>[candidate.start_frame,candidate.start_frame+candidate.length_frames]))].filter(frame=>Number.isSafeInteger(frame) && frame>=0 && frame<=MAX_FRAME);
  const raw=handle.end_frame+pixelDelta/pixelsPerFrame(view,timeline.fps);if(!Number.isFinite(raw))throw Error('Speed pointer exceeds its integer frame budget');
  const rounded=Math.max(0,Math.min(MAX_FRAME,Math.round(raw))),snapped=view.snap?snapFrame(rounded,candidates,view,timeline.fps):rounded;
  const length_frames=Math.max(metadata.min_length,Math.min(metadata.max_length,snapped-clip.start_frame)),end_frame=clip.start_frame+length_frames,overwrite=view.retimeOverwrite===true;
  const changes=[{clip_id:clip.id,to_track:source.id,to_start_frame:clip.start_frame,length_frames}],validation=validateDraft(timeline,changes),validation_pending=linked.length>1;
  let error=validation;if(error==='Overlap · safe move blocked' && overwrite)error=null;
  if(linked.some(target=>target.track.locked))error='Track locked or incompatible';
  return {...handle,metadata:structuredClone(metadata),original:handle.end_frame,start_frame:clip.start_frame,end_frame,length_frames,left:frameToX(clip.start_frame,view,timeline.fps),right:frameToX(end_frame,view,timeline.fps),x:frameToX(end_frame,view,timeline.fps),target:end_frame,changes,error,validation_pending,operation:{kind:'retime_clip',clip_id:clip.id,end_frame,overwrite}};
}
export function hitTest(x, y, timeline, view, width=Infinity) {
  if (x >= HEADER && y >= MARKER_TOP && y < MARKER_BOTTOM) {
    for (const marker of [...(timeline.markers || [])].reverse()) {
      const left = frameToX(marker.start_frame, view, timeline.fps);
      const right = frameToX(marker.start_frame + marker.duration_frames, view, timeline.fps);
      if (x < left - 7 || x > right + 7) continue;
      const edge = right - left < 15 ? null : Math.abs(x - left) <= 5 ? "start" : Math.abs(x - right) <= 5 ? "end" : null;
      return {kind:"marker",marker,edge};
    }
  }
  if (y < RULER) return { kind: "scrub" };
  const track = Math.floor((y - RULER + view.scrollY) / TRACK);
  if (!timeline.tracks[track]) return { kind: "blank" };
  if (x < HEADER) return { kind: "header", track };
  const top=RULER+track*TRACK-view.scrollY;
  const speedStrips=y>=top+7 && y<=top+21?retimeStrips(timeline.tracks[track],view,timeline.fps,width):[];
  if(y>=top+7 && y<=top+21){
    const retime=speedStrips.find(handle=>x>=handle.left && x<=handle.right && handle.right-x<8);
    if(retime)return {...retime,track};
    const strip=speedStrips.find(strip=>x>=strip.visibleLeft && x<=strip.visibleRight);
    if(strip?.close && x>=strip.close.left && x<=strip.close.right)return {...strip,kind:'retime_close',track};
    if(strip && x>=strip.menu.left && x<=strip.menu.right)return {...strip,kind:'retime_menu',track};
  }
  if(y>=top+TRACK-21 && y<=top+TRACK-7){
    const transition=transitionHandles(timeline.tracks[track],view,timeline.fps).find(handle=>x>=frameToX(handle.clip.start_frame,view,timeline.fps) && x<=frameToX(handle.clip.start_frame+handle.clip.length_frames,view,timeline.fps) && Math.abs(x-handle.x)<=9);
    if(transition)return {...transition,track};
    const body=transitionBodies(timeline.tracks[track],view,timeline.fps).find(body=>x>=body.left_x && x<=body.right_x);
    if(body)return {...body,track};
  }
  for (const clip of timeline.tracks[track].clips) {
    const left = frameToX(clip.start_frame, view, timeline.fps);
    const right = frameToX(
      clip.start_frame + clip.length_frames,
      view,
      timeline.fps,
    );
    if (x >= left && x <= right){
      const top=RULER+track*TRACK-view.scrollY;
      if(!timeline.tracks[track].locked && view.tool!=='slip' && !speedStrips.some(strip=>strip.clip_id===clip.id) && y>=top+7 && y<=top+21){
        const handle=fadeHandles(clip,view,timeline.fps).filter(handle=>Math.abs(x-handle.x)<=9).sort((a,b)=>Math.abs(x-a.x)-Math.abs(x-b.x))[0];
        if(handle)return {kind:'fade',edge:handle.edge,track,clip};
      }
      return {
        kind: x - left < 8 ? "trim_start" : right - x < 8 ? "trim_end" : "move",
        track,
        clip,
      };
    }
  }
  return { kind: "blank", track };
}
export function markerDraft(marker, mode, pointer, grab, candidates, view, fps) {
  const snap = frame => view.snap ? snapFrame(frame,candidates,view,fps) : frame;
  const end = marker.start_frame + marker.duration_frames;
  let start = marker.start_frame, stop = end;
  if (mode === "move") {
    const target = marker.start_frame+pointer-grab;
    const snapped = view.snap ? snapFrame(target,candidates.flatMap(frame=>[frame,frame-marker.duration_frames]).filter(frame=>frame>=0 && frame<=MAX_FRAME-marker.duration_frames),view,fps) : target;
    start = Math.max(0,Math.min(MAX_FRAME-marker.duration_frames,snapped));
    stop = start+marker.duration_frames;
  } else if (mode === "start") start = Math.max(0,Math.min(end,snap(pointer)));
  else if (mode === "end") stop = Math.min(MAX_FRAME,Math.max(start,snap(pointer)));
  else {
    const other = Math.max(0,Math.min(MAX_FRAME,snap(pointer)));
    start = Math.min(marker.start_frame,other); stop = Math.max(marker.start_frame,other);
  }
  return {...marker,start_frame:start,duration_frames:stop-start};
}
export function linkedSelection(timeline, ids) {
  const clips = timeline.tracks.flatMap((track) => track.clips);
  const groups = new Set(
    clips
      .filter((clip) => ids.includes(clip.id) && clip.linked_group !== null)
      .map((clip) => clip.linked_group),
  );
  return clips
    .filter(
      (clip) =>
        ids.includes(clip.id) ||
        (clip.linked_group !== null && groups.has(clip.linked_group)),
    )
    .map((clip) => clip.id);
}
export function validateDraft(timeline, changes) {
  const ids = new Set(changes.map((change) => change.clip_id));
  for (const change of changes) {
    const target = timeline.tracks.find(
      (track) => track.id === change.to_track,
    );
    const source = timeline.tracks.find((track) =>
      track.clips.some((clip) => clip.id === change.clip_id),
    );
    if (
      !target ||
      !source ||
      target.locked ||
      source.locked ||
      source.kind !== target.kind
    )
      return "Track locked or incompatible";
    const start = change.to_start_frame,
      length = change.length_frames;
    if (
      !Number.isSafeInteger(start) ||
      start < 0 ||
      length < 1 ||
      start + length > MAX_FRAME
    )
      return "Invalid frame range";
    if (
      target.clips.some(
        (clip) =>
          !ids.has(clip.id) &&
          start < clip.start_frame + clip.length_frames &&
          start + length > clip.start_frame,
      )
    )
      return "Overlap · safe move blocked";
    if (
      changes.some(
        (other) =>
          other !== change &&
          other.to_track === change.to_track &&
          start < other.to_start_frame + other.length_frames &&
          start + length > other.to_start_frame,
      )
    )
      return "Selected clips overlap";
  }
  return null;
}
