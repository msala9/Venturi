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
export function hitTest(x, y, timeline, view) {
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
  if(y>=top+TRACK-21 && y<=top+TRACK-7){
    const transition=transitionHandles(timeline.tracks[track],view,timeline.fps).find(handle=>x>=frameToX(handle.clip.start_frame,view,timeline.fps) && x<=frameToX(handle.clip.start_frame+handle.clip.length_frames,view,timeline.fps) && Math.abs(x-handle.x)<=9);
    if(transition)return {...transition,track};
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
      if(!timeline.tracks[track].locked && view.tool!=='slip' && y>=top+7 && y<=top+21){
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
