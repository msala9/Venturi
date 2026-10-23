export const HEADER = 150,
  RULER = 48,
  MARKER_TOP = 24,
  MARKER_BOTTOM = 42,
  TRACK = 62,
  MAX_FRAME = 1_000_000_000;
export const MIN_TIMELINE_SCALE=.1,MAX_TIMELINE_SCALE=800;
export function timelineScrollBounds(timeline,view,width){
  const scale=Number.isFinite(view.scale) && view.scale>0?view.scale:60;
  const fps=timeline?.fps?.num/timeline?.fps?.den;
  if(!Number.isFinite(fps) || fps<=0)return {maxOrigin:0,maxOffset:0,viewportFrames:0,pixelsPerFrame:0};
  let end=0;for(const track of timeline.tracks)for(const clip of track.clips)end=Math.max(end,clip.start_frame+clip.length_frames);
  const viewport=Math.max(1,Number.isFinite(width)?width-HEADER:1),pixelsPerFrame=scale/fps;
  const maxOffset=Math.max(0,Math.max(20,end/fps+5)*scale-viewport);
  return {maxOrigin:Math.min(MAX_FRAME,maxOffset/pixelsPerFrame),maxOffset:Math.min(MAX_FRAME*pixelsPerFrame,maxOffset),viewportFrames:viewport/pixelsPerFrame,pixelsPerFrame};
}
export function timelineOriginForFrame(timeline,view,width,frame){
  const bounds=timelineScrollBounds(timeline,view,width),origin=Math.max(0,Math.min(bounds.maxOrigin,Number.isFinite(view.origin)?view.origin:0));
  if(!Number.isFinite(frame) || frame<0 || !bounds.pixelsPerFrame)return origin;
  return frame<origin || frame>origin+bounds.viewportFrames?Math.max(0,Math.min(bounds.maxOrigin,frame-bounds.viewportFrames/3)):origin;
}
export function kineticScrollStep(offset,velocity,maximum,seconds){
  if(![offset,velocity,maximum,seconds].every(Number.isFinite) || maximum<0)return {offset:0,velocity:0,moved:false};
  const dt=Math.max(0,Math.min(.1,seconds)),friction=500*dt;
  if(!velocity || friction>Math.abs(velocity) || Math.abs(velocity)<15)return {offset:Math.max(0,Math.min(maximum,offset)),velocity:0,moved:false};
  velocity-=friction*Math.sign(velocity);
  const raw=offset+velocity*dt,next=Math.max(0,Math.min(maximum,raw));
  return {offset:next,velocity:next!==raw?0:velocity,moved:next!==offset};
}
export function timelineLayout(timeline,view={},height=view.viewportHeight){
  const tracks=timeline?.tracks || [],video=tracks.flatMap((track,index)=>track.kind==='video'?[index]:[]).reverse(),audio=tracks.flatMap((track,index)=>track.kind==='audio'?[index]:[]);
  const rowOrder=[...video,...audio],rowOfTrack=new Map(rowOrder.map((index,row)=>[index,row]));
  const rowHeight=Number.isFinite(view.rowHeight)?Math.max(40,Math.min(160,view.rowHeight)):TRACK;
  const dividerHeight=video.length && audio.length?8:0;
  height=Number.isFinite(height)?Math.max(RULER,height):RULER+rowOrder.length*rowHeight+dividerHeight;
  const available=Math.max(0,height-RULER-dividerHeight),videoRows=video.length*rowHeight,audioRows=audio.length*rowHeight;
  const defaultVideo=videoRows+audioRows<=available?(available-videoRows-audioRows)/2+videoRows:available*video.length/Math.max(1,rowOrder.length);
  const minimum=dividerHeight?Math.min(20,available/2):0;
  const videoHeight=dividerHeight && Number.isFinite(view.videoPaneHeight)?Math.max(minimum,Math.min(available-minimum,view.videoPaneHeight)):defaultVideo;
  const videoPane={top:RULER,bottom:RULER+videoHeight},audioPane={top:videoPane.bottom+dividerHeight,bottom:height};
  const maxScroll=(rows,pane)=>rows>pane?rows+24-pane:0;
  const videoMaxScroll=maxScroll(videoRows,videoHeight),audioMaxScroll=maxScroll(audioRows,available-videoHeight);
  const videoScroll=Math.max(0,Math.min(videoMaxScroll,Number.isFinite(view.videoScroll)?view.videoScroll:0)),audioScroll=Math.max(0,Math.min(audioMaxScroll,Number.isFinite(view.audioScroll)?view.audioScroll:0));
  const videoTop=videoPane.bottom-videoRows+videoScroll,audioTop=audioPane.top-audioScroll;
  const pane=index=>tracks[index]?.kind==='video'?videoPane:audioPane;
  const trackTop=index=>{const row=rowOfTrack.get(index);return row===undefined?NaN:row<video.length?videoTop+row*rowHeight:audioTop+(row-video.length)*rowHeight;};
  const paneAtY=y=>video.length && y>=videoPane.top && y<videoPane.bottom?'video':audio.length && y>=audioPane.top && y<audioPane.bottom?'audio':null;
  const trackAtY=y=>{
    const kind=paneAtY(y),indices=kind==='video'?video:kind==='audio'?audio:[],top=kind==='video'?videoTop:audioTop,row=Math.floor((y-top)/rowHeight);
    return row>=0 && row<indices.length?indices[row]:null;
  };
  const dragTarget=(y,kind)=>{
    if(kind==='video'){
      if(y>=videoPane.bottom)return null;
      y=Math.max(y,videoPane.top);
      if(y<videoTop)return {depth:1};
      if(y<videoTop+videoRows){const row=Math.max(0,Math.min(video.length-1,Math.floor((y-videoTop)/rowHeight)));return {track:video[row]};}
    }else if(kind==='audio'){
      if(y<audioPane.top)return null;
      y=Math.min(y,audioPane.bottom-1);
      if(y>=audioTop+audioRows)return {depth:1};
      if(y>=audioTop){const row=Math.max(0,Math.min(audio.length-1,Math.floor((y-audioTop)/rowHeight)));return {track:audio[row]};}
    }
    return null;
  };
  const newTrackTop=(kind,depth)=>kind==='video'?videoTop-depth*rowHeight:audioTop+audioRows+(depth-1)*rowHeight;
  const clipRect=(index,clip,visible=false)=>{
    const left=frameToX(clip.start_frame,view,timeline.fps),top=trackTop(index)+2;
    const rect={left,right:left+Math.max(2,clip.length_frames*pixelsPerFrame(view,timeline.fps)),top,bottom:top+rowHeight-4};
    if(visible){const box=pane(index);rect.top=Math.max(rect.top,box.top);rect.bottom=Math.min(rect.bottom,box.bottom);}
    return rect;
  };
  return {rowOrder,rowOfTrack,rowHeight,height,videoPane,audioPane,divider:{top:videoPane.bottom,bottom:audioPane.top},videoHeight,videoHeightRange:[minimum,available-minimum],videoScroll,audioScroll,videoMaxScroll,audioMaxScroll,trackTop,trackAtY,dragTarget,newTrackTop,paneAtY,pane,clipRect};
}
export function timelineLayoutStamp(view){return [view.viewportHeight,view.rowHeight,view.videoPaneHeight,view.videoScroll,view.audioScroll];}
export function paneScrollbars(timeline,view,width,height=view.viewportHeight){
  if(!Number.isFinite(width) || width<=HEADER+10)return [];
  const layout=timelineLayout(timeline,view,height);
  return ['video','audio'].flatMap(pane=>{
    const box=pane==='video'?layout.videoPane:layout.audioPane,maxOffset=pane==='video'?layout.videoMaxScroll:layout.audioMaxScroll;
    const top=box.top+2,bottom=box.bottom-2,railHeight=bottom-top;
    if(maxOffset<=0 || railHeight<=0)return [];
    const offset=pane==='video'?maxOffset-layout.videoScroll:layout.audioScroll;
    const thumbHeight=Math.min(railHeight,Math.max(16,railHeight*railHeight/(railHeight+maxOffset))),travel=railHeight-thumbHeight;
    return [{kind:'pane_scrollbar',pane,left:width-10,right:width-2,top,bottom,offset,maxOffset,thumbHeight,travel,thumbTop:top+travel*offset/maxOffset}];
  });
}
export function clipsInTimelineRect(timeline,view,box,{visible=true}={}){
  const layout=timelineLayout(timeline,view);
  return timeline.tracks.flatMap((track,index)=>track.locked?[]:track.clips.filter(clip=>{
    const rect=layout.clipRect(index,clip,visible);
    return rect.bottom>rect.top && rect.left<=box.right && rect.right>=box.left && rect.top<=box.bottom && rect.bottom>=box.top;
  }).map(clip=>clip.id));
}
export function moveTrackTargets(timeline,view,primaryTrack,y,ids){
  const layout=timelineLayout(timeline,view),primaryKind=timeline.tracks[primaryTrack]?.kind,target=layout.dragTarget(y,primaryKind);
  const selected=new Set(ids),unchanged=new Map(timeline.tracks.flatMap((track,index)=>track.clips.filter(clip=>selected.has(clip.id)).map(clip=>[clip.id,index])));
  if(target===null)return unchanged;
  const targetRow=target.depth?(primaryKind==='video'?-1:layout.rowOrder.length):layout.rowOfTrack.get(target.track);
  const delta=targetRow-layout.rowOfTrack.get(primaryTrack),videoCount=timeline.tracks.filter(track=>track.kind==='video').length;
  let newVideoTracks=0,newAudioTracks=0;
  const result=new Map([...unchanged].map(([id,index])=>{
    const video=timeline.tracks[index].kind==='video',shift=timeline.tracks[index].kind===primaryKind?delta:-delta,row=layout.rowOfTrack.get(index)+shift;
    if(video && row<0){newVideoTracks=Math.max(newVideoTracks,-row);return [id,{kind:'video',depth:-row}];}
    if(!video && row>=layout.rowOrder.length){const depth=row-layout.rowOrder.length+1;newAudioTracks=Math.max(newAudioTracks,depth);return [id,{kind:'audio',depth}];}
    const bounded=video?Math.max(0,Math.min(videoCount-1,row)):Math.max(videoCount,Math.min(layout.rowOrder.length-1,row));
    return [id,layout.rowOrder[bounded]];
  }));
  if([...result.values()].some(index=>typeof index==='number' && timeline.tracks[index].locked))return unchanged;
  result.new_video_tracks=newVideoTracks;result.new_audio_tracks=newAudioTracks;
  if(timeline.tracks.length+newVideoTracks+newAudioTracks>128)result.error='The group move exceeds the 128-track limit';
  return result;
}
export function dragRangeAt(timeline,track,exclude,reference,length){
  let lower=0,upper=MAX_FRAME;
  for(const clip of timeline.tracks[track]?.clips || [])if(!exclude.has(clip.id)){
    if(clip.start_frame+clip.length_frames<=reference)lower=Math.max(lower,clip.start_frame+clip.length_frames);
    if(clip.start_frame>=reference+length)upper=Math.min(upper,clip.start_frame);
  }
  return [lower,Math.max(lower,upper-length)];
}
export function groupDragBounds(timeline,primaryId,targets,reference){
  const clips=new Map(timeline.tracks.flatMap(track=>track.clips.map(clip=>[clip.id,clip]))),primary=clips.get(primaryId),exclude=new Set(targets.keys());
  const bound=(id,start)=>{const target=targets.get(id),length=clips.get(id).length_frames;return typeof target==='number'?dragRangeAt(timeline,target,exclude,start,length):[0,MAX_FRAME-length];};
  let [minimum,maximum]=bound(primaryId,reference);
  for(const id of targets.keys())if(id!==primaryId){
    const offset=clips.get(id).start_frame-primary.start_frame,[lower,upper]=bound(id,reference+offset);
    minimum=Math.max(minimum,lower-offset);maximum=Math.min(maximum,upper-offset);
  }
  return [minimum,Math.max(minimum,maximum)];
}
export function groupMoveStart(timeline,view,primaryId,targets,reference){
  const [minimum,maximum]=groupDragBounds(timeline,primaryId,targets,reference),clamp=frame=>Math.max(minimum,Math.min(maximum,frame)),candidate=clamp(reference),exclude=new Set(targets.keys());
  if(!view.snap)return candidate;
  const edges=timeline.tracks.flatMap(track=>track.clips.filter(clip=>!exclude.has(clip.id)).flatMap(clip=>[clip.start_frame,clip.start_frame+clip.length_frames]));
  edges.push(view.playhead);
  const primary=timeline.tracks.flatMap(track=>track.clips).find(clip=>clip.id===primaryId);
  return clamp(snapFrame(candidate,edges,view,timeline.fps,10,primary.length_frames));
}
export function trimGroupDraft(timeline,view,primaryId,selected,edge,raw,neighborId=null,overwrite=false){
  const entries=timeline.tracks.flatMap(track=>track.clips.map(clip=>({track,clip}))),primary=entries.find(item=>item.clip.id===primaryId),neighbor=entries.find(item=>item.clip.id===neighborId);
  const fail=error=>({kind:'trim_group',changes:[],error});
  if(!primary || !['start','end'].includes(edge) || !Number.isSafeInteger(raw))return fail('Invalid trim target');
  const opposite=edge==='start'?'end':'start',value=(clip,side)=>side==='start'?clip.start_frame:clip.start_frame+clip.length_frames;
  if(neighborId && (!neighbor || neighbor.track!==primary.track || value(primary.clip,edge)!==value(neighbor.clip,opposite)))return fail('Roll requires adjacent clips');
  const first=linkedSelection(timeline,neighborId?[primaryId]:selected.includes(primaryId)?selected:[primaryId]),second=neighborId?linkedSelection(timeline,[neighborId]):[];
  if(first.some(id=>second.includes(id)))return fail('Roll groups overlap');
  const members=entries.filter(item=>first.includes(item.clip.id) || second.includes(item.clip.id)).map(item=>({...item,edge:second.includes(item.clip.id)?opposite:edge}));
  const original=value(primary.clip,edge);let minimum=0,maximum=MAX_FRAME;
  for(const member of members){
    const {clip,track,edge:side}=member,limits=clip.trim_limits?.[side],offset=value(clip,side)-original;
    if(track.locked)return fail('Unlock the selected clips and their linked tracks before editing');
    if(!Array.isArray(limits) || limits.length!==2 || !limits.every(Number.isSafeInteger) || limits[0]>limits[1])return fail('Native trim limits unavailable');
    let [low,high]=limits;
    for(const other of members)if(other.track===track && other.clip.id!==clip.id && other.edge===side){
      if(side==='end' && other.clip.start_frame>=value(clip,'end'))high=Math.min(high,other.clip.start_frame);
      if(side==='start' && value(other.clip,'end')<=clip.start_frame)low=Math.max(low,value(other.clip,'end'));
    }
    minimum=Math.max(minimum,low-offset);maximum=Math.min(maximum,high-offset);
  }
  if(minimum>maximum)return fail('No shared source handles for this trim');
  const clamp=frame=>Math.max(minimum,Math.min(maximum,frame)),exclude=new Set(members.map(item=>item.clip.id));
  let target=clamp(raw);
  if(view.snap){const candidates=entries.filter(item=>!exclude.has(item.clip.id)).flatMap(({clip})=>[clip.start_frame,value(clip,'end')]);candidates.push(view.playhead);target=clamp(snapFrame(target,candidates,view,timeline.fps));}
  const delta=target-original,changes=members.map(({clip,track,edge:side})=>({clip_id:clip.id,to_track:track.id,to_start_frame:clip.start_frame+(side==='start'?delta:0),length_frames:clip.length_frames+(side==='start'?-delta:delta)}));
  const validation=validateDraft(timeline,changes),error=overwrite?validateDraft({...timeline,tracks:timeline.tracks.map(track=>({...track,clips:track.clips.filter(clip=>exclude.has(clip.id))}))},changes):validation;
  return {kind:'trim_group',changes,error,target,original,operation:{kind:'trim_group',clip_id:primaryId,clip_ids:[...selected],edge,frame:target,...(neighborId?{roll_neighbor_id:neighborId}:{}),overwrite:Boolean(overwrite)}};
}
export function gainLine(clip,track,view,fps){
  if(track.kind!=='audio' || clip.gain_constant!==true || !Number.isFinite(clip.gain_db) || !Array.isArray(clip.gain_bounds) || clip.gain_bounds.length!==2 || !clip.gain_bounds.every(Number.isFinite) || clip.gain_bounds[0]>=0 || clip.gain_bounds[1]<=0)return null;
  const bounds=clip.gain_bounds,offset=Math.max(-1,Math.min(1,clip.gain_db>=0?clip.gain_db/bounds[1]:-clip.gain_db/bounds[0]));
  return {offset,bounds,left:frameToX(clip.start_frame,view,fps),right:frameToX(clip.start_frame+clip.length_frames,view,fps)};
}
export function gainDraft(clip,track,view,fps,dy){
  const line=gainLine(clip,track,view,fps);if(!line)return null;
  const half=(timelineLayout({tracks:[track]},view).rowHeight-4)/2,offset=Math.max(-1,Math.min(1,line.offset-dy/half));
  return {kind:'gain',clip_id:clip.id,gain_db:Math.fround(offset>=0?offset*line.bounds[1]:-offset*line.bounds[0]),original:clip.gain_db};
}
export function trackHeaderButtons(track){
  return [{flag:'locked',label:'L',left:34,right:58},...(track.kind==='video'?[{flag:'muted',label:'V',left:62,right:86}]:[{flag:'solo',label:'S',left:62,right:86},{flag:'muted',label:'M',left:90,right:114},{flag:'armed',label:'R',left:118,right:142}])];
}
export function nativeGapAt(timeline,trackId,frame){
  const track=timeline?.tracks.find(item=>item.id===trackId);
  if(!track || track.locked || !Number.isSafeInteger(frame) || frame<0 || frame>MAX_FRAME || !Array.isArray(timeline.gaps))return null;
  return timeline.gaps.find(gap=>gap?.track_id===trackId && Number.isSafeInteger(gap.start_frame) && gap.start_frame>=0 && Number.isSafeInteger(gap.length_frames) && gap.length_frames>0 && gap.start_frame+gap.length_frames<=MAX_FRAME && gap.start_frame<=frame && frame<gap.start_frame+gap.length_frames) || null;
}
export function selectedGap(timeline,view){
  const selection=view.selectedGap;
  if(!selection || view.selection.length || view.transitionSelection || timeline?.id!==selection.timeline_id || timeline.revision!==selection.revision)return null;
  const gap=nativeGapAt(timeline,selection.track_id,selection.frame);
  return gap && gap.start_frame===selection.start_frame && gap.length_frames===selection.length_frames?selection:null;
}
export function timelineClipSelection(timeline,fromFrame=null){
  if(!Array.isArray(timeline?.tracks) || (fromFrame!==null && (!Number.isSafeInteger(fromFrame) || fromFrame<0)))return [];
  const decimal=id=>/^\d{1,20}$/.test(id) && BigInt(id)<=18446744073709551615n;
  return timeline.tracks.filter(track=>!track.locked).flatMap(track=>{
    const clips=(track.clips || []).filter(clip=>typeof clip.id==='string' && clip.id.length>0 && (fromFrame===null || clip.start_frame+clip.length_frames>fromFrame));
    // Native ClipKey sets order each lane by ClipId. Fixture IDs stay opaque.
    if(clips.every(clip=>decimal(clip.id)))clips.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
    return clips.map(clip=>clip.id);
  });
}
export function clipSelectionAnchor(timeline,clipId,projectEpoch=null){
  const track=timeline?.tracks.find(track=>!track.locked && track.clips.some(clip=>clip.id===clipId));
  return track?{project_epoch:projectEpoch,timeline_id:timeline.id,track_id:track.id,clip_id:clipId}:null;
}
export function reconcileSelectionAnchor(timeline,anchor,projectEpoch=null){
  if(!anchor || anchor.project_epoch!==projectEpoch || anchor.timeline_id!==timeline?.id)return null;
  const current=clipSelectionAnchor(timeline,anchor.clip_id,projectEpoch);
  return current?.track_id===anchor.track_id?current:null;
}
export function firstSelectionAnchor(timeline,ids,projectEpoch=null){
  const selected=new Set(ids);
  return clipSelectionAnchor(timeline,timelineClipSelection(timeline).find(id=>selected.has(id)),projectEpoch);
}
export function unlockedLinkedSelection(timeline,ids){
  const unlocked=timeline.tracks.filter(track=>!track.locked).flatMap(track=>track.clips),byId=new Map(unlocked.map(clip=>[clip.id,clip])),chosen=new Set(ids),groups=new Set(unlocked.filter(clip=>chosen.has(clip.id) && clip.linked_group!=null).map(clip=>clip.linked_group));
  return timelineClipSelection(timeline).filter(id=>{const clip=byId.get(id);return chosen.has(id) || (clip.linked_group!=null && groups.has(clip.linked_group));});
}
export function clickTimelineSelection(timeline,{ids,anchor},clickedId,{shift=false,toggle=false,projectEpoch=null}={},view){
  const clicked=clipSelectionAnchor(timeline,clickedId,projectEpoch);
  if(!clicked)return null;
  let next=new Set(ids),nextAnchor=clicked;
  if(shift){
    nextAnchor=reconcileSelectionAnchor(timeline,anchor,projectEpoch) || clicked;
    const layout=timelineLayout(timeline,view);
    const rectangles=timeline.tracks.flatMap((track,index)=>track.clips.map(clip=>({id:clip.id,...layout.clipRect(index,clip),locked:track.locked})));
    const a=rectangles.find(item=>item.id===nextAnchor.clip_id),b=rectangles.find(item=>item.id===clickedId);
    const union={left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom)};
    next=new Set(rectangles.filter(item=>!item.locked && item.left<=union.right && item.right>=union.left && item.top<=union.bottom && item.bottom>=union.top).map(item=>item.id));
  }else if(toggle){if(!next.delete(clickedId))next.add(clickedId);}
  else next=new Set([clickedId]);
  return {ids:unlockedLinkedSelection(timeline,[...next]),anchor:nextAnchor};
}
export function playheadSelectionAnchor(timeline,frame,projectEpoch=null){
  return clipSelectionAnchor(timeline,activePlayheadClip(timeline,frame)?.id,projectEpoch);
}
function activePlayheadClip(timeline,frame){
  return [...(timeline?.tracks || [])].reverse().filter(track=>track.kind==='video' && !track.muted).map(track=>track.clips.find(clip=>!clip.disabled && clip.start_frame<=frame && frame<clip.start_frame+clip.length_frames)).find(Boolean);
}
export function playheadSelection(timeline, frame) {
  if(!timeline)return [];
  const active=activePlayheadClip(timeline,frame);
  if(!active)return [];
  return timeline.tracks.filter(track=>!track.locked).flatMap(track=>track.clips.filter(clip=>clip.id===active.id || (active.linked_group!=null && clip.linked_group===active.linked_group)).map(clip=>clip.id));
}
export function pixelsPerFrame(view, fps) {
  if (!(fps.num > 0 && fps.den > 0 && view.scale > 0))
    throw new RangeError("Invalid frame scale");
  return (view.scale * fps.den) / fps.num;
}
export const frameToX = (frame, view, fps) =>
  HEADER + (frame - (view.origin ?? 0)) * pixelsPerFrame(view, fps);
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
export function snapFrame(frame, candidates, view, fps, threshold = 10, length = 0) {
  const limit = Math.round(threshold / pixelsPerFrame(view, fps));
  if(limit<=0)return Math.max(0,frame);
  let best = frame,
    distance = Infinity;
  for (const candidate of candidates) {
    for(const point of [frame,frame+length])if(Math.abs(candidate-point)<=limit && Math.abs(candidate-point)<distance){best=frame+candidate-point;distance=Math.abs(candidate-point);}
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
export function slipPointerDelta(pixelDelta,view,fps,minimum,maximum){
  const scale=Math.fround(view.scale),rate=Math.fround(Math.max(1,fps.num/fps.den)),pixels=Math.fround(scale/rate),raw=Math.fround(Math.fround(pixelDelta)/pixels);
  if(!Number.isFinite(raw) || pixels<=0 || !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum>maximum)throw Error('Native Slip pointer bounds are invalid');
  const frames=raw<0?-Math.round(-raw):Math.round(raw);
  return Math.max(minimum,Math.min(maximum,-frames)) || 0;
}
export function slipMediaExtents(timeline,view){
  const draft=view.draft;if(draft?.kind!=='slip' || !Number.isSafeInteger(draft.target))return [];
  const selected=new Set((draft.changes || []).map(change=>change.clip_id)),layout=timelineLayout(timeline,view);
  return timeline.tracks.flatMap((track,index)=>track.locked?[]:track.clips.flatMap(clip=>{
    const range=clip.slip_range;
    if(!selected.has(clip.id) || !Array.isArray(range) || range.length!==2 || !range.every(Number.isSafeInteger) || draft.target<range[0] || draft.target>range[1])return [];
    const start=clip.start_frame+range[0]-draft.target,end=clip.start_frame+clip.length_frames+range[1]-draft.target,top=layout.trackTop(index);
    return [{track_id:track.id,clip_id:clip.id,start_frame:start,end_frame:end,left:frameToX(start,view,timeline.fps),right:frameToX(end,view,timeline.fps),top:top+1,bottom:top+layout.rowHeight-1}];
  }));
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
  const layout=timelineLayout(timeline,view),trackIndex=layout.trackAtY(y),track=timeline?.tracks?.[trackIndex],top=layout.trackTop(trackIndex);
  if(track?.kind!=='video' || track.locked || y<top+2 || y>top+layout.rowHeight-2)return blocked('Choose an unlocked video clip');
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
  if(!(view.retimeVisible instanceof Set) || !view.retimeVisible.size || view.tool==='slip' || !['video','audio'].includes(track?.kind) || track.locked)return [];
  return (track.clips || []).filter(clip=>view.retimeVisible.has(clip.id) && retimeMetadata(clip) && clip.length_frames*pixelsPerFrame(view,fps)>=20).map(clip=>{
    const end_frame=clip.start_frame+clip.length_frames,left=frameToX(clip.start_frame,view,fps),right=frameToX(end_frame,view,fps);
    return {kind:'retime',clip,clip_id:clip.id,end_frame,metadata:structuredClone(clip.retime),left,right,x:right,topOffset:7,bottomOffset:21};
  });
}
export function retimeStrips(track,view,fps,width=Infinity){
  return retimeHandles(track?.locked?{...track,locked:false}:track,view,fps).flatMap(handle=>{
    const left=Math.max(HEADER,handle.left),right=Math.min(width,handle.right),visible=right-left;
    if(visible<12)return [];
    const endpointVisible=handle.right<=width,endpointInset=endpointVisible?10:0,showClose=visible>=90;
    const close=showClose?{left:right-endpointInset-16,right:right-endpointInset}:null;
    const menuRight=close?close.left-2:right-endpointInset,menuWidth=Math.min(120,Math.max(0,menuRight-left)),center=(left+menuRight)/2;
    return [{...handle,interactive:!track.locked,visibleLeft:left,visibleRight:right,menu:{left:center-menuWidth/2,right:center+menuWidth/2},close}];
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
  const scrollbar=paneScrollbars(timeline,view,width).find(bar=>x>=bar.left && x<=bar.right && y>=bar.top && y<=bar.bottom);
  if(scrollbar)return scrollbar;
  const layout=timelineLayout(timeline,view);
  if(layout.divider.bottom>layout.divider.top && y>=layout.divider.top && y<layout.divider.bottom)return {kind:'divider'};
  const track = layout.trackAtY(y);
  if (track===null) return { kind: "blank" };
  const top=layout.trackTop(track),rowHeight=layout.rowHeight;
  if (x < HEADER){
    const button=Math.abs(y-top-rowHeight/2)<=13?trackHeaderButtons(timeline.tracks[track]).find(button=>x>=button.left && x<=button.right):null;
    return button?{kind:'header_flag',track,flag:button.flag}:{kind:'header',track};
  }
  const speedStrips=retimeStrips(timeline.tracks[track],view,timeline.fps,width);
  if(y>=top+7 && y<=top+21){
    const retime=speedStrips.find(handle=>handle.interactive && x>=handle.left && x<=handle.right && handle.right-x<8);
    if(retime)return {...retime,track};
    const strip=speedStrips.find(strip=>strip.interactive && x>=strip.visibleLeft && x<=strip.visibleRight);
    if(strip?.close && x>=strip.close.left && x<=strip.close.right)return {...strip,kind:'retime_close',track};
    if(strip && x>=strip.menu.left && x<=strip.menu.right)return {...strip,kind:'retime_menu',track};
  }
  if(y>=top+rowHeight-21 && y<=top+rowHeight-7){
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
    if (x >= left && x <= Math.max(right,left+2) && y>=top+2 && y<=top+rowHeight-2){
      if(!timeline.tracks[track].locked && view.tool!=='slip' && !speedStrips.some(strip=>strip.clip_id===clip.id) && y>=top+7 && y<=top+21){
        const handle=fadeHandles(clip,view,timeline.fps).filter(handle=>Math.abs(x-handle.x)<=9).sort((a,b)=>Math.abs(x-a.x)-Math.abs(x-b.x))[0];
        if(handle)return {kind:'fade',edge:handle.edge,track,clip};
      }
      const width=right-left;
      for(const [distance,edge] of [[x-left,'start'],[right-x,'end']]){
        const neighbor=timeline.tracks[track].clips.find(other=>other.id!==clip.id && (edge==='start'?other.start_frame+other.length_frames===clip.start_frame:other.start_frame===clip.start_frame+clip.length_frames));
        if(edge==='end' && distance<Math.min(8,width/3)+(neighbor?Math.min(4,width/6):0)){
          const speed=speedStrips.find(strip=>strip.interactive && strip.clip_id===clip.id);
          if(speed)return {...speed,track};
        }
        if(neighbor && distance<Math.min(4,width/6))return {kind:edge==='start'?'trim_start':'trim_end',track,clip,roll_neighbor_id:neighbor.id};
        if(distance<Math.min(8,width/3)+(neighbor?Math.min(4,width/6):0))return {kind:edge==='start'?'trim_start':'trim_end',track,clip};
      }
      const gain=gainLine(clip,timeline.tracks[track],view,timeline.fps);
      if(gain && !timeline.tracks[track].locked && view.tool!=='slip' && Math.abs(y-(top+rowHeight/2-gain.offset*(rowHeight-4)/2))<=5)return {kind:'gain',track,clip};
      return {kind:'move',track,clip};
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
    let target = timeline.tracks.find(
      (track) => track.id === change.to_track,
    );
    const source = timeline.tracks.find((track) =>
      track.clips.some((clip) => clip.id === change.clip_id),
    );
    if(change.to_new_track && Number.isSafeInteger(change.to_new_track.depth) && change.to_new_track.depth>=1 && change.to_new_track.depth<=128 && change.to_new_track.kind===source?.kind)target={kind:source.kind,locked:false,clips:[]};
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
          (change.to_new_track?other.to_new_track?.kind===change.to_new_track.kind && other.to_new_track.depth===change.to_new_track.depth:!other.to_new_track && other.to_track===change.to_track) &&
          start < other.to_start_frame + other.length_frames &&
          start + length > other.to_start_frame,
      )
    )
      return "Selected clips overlap";
  }
  return null;
}
