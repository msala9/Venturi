import {
  HEADER,
  RULER,
  xToFrame,
  snapFrame,
  hitTest,
  linkedSelection,
  validateDraft,
  markerDraft,
  fadeDraft,
  transitionDraft,
  retimeDraft,
  transitionPlacement,
  selectedTransition,
  frameToX,
  nativeGapAt,
  selectedGap,
  timelineClipSelection,
  clipSelectionAnchor,
  reconcileSelectionAnchor,
  firstSelectionAnchor,
  unlockedLinkedSelection,
  clickTimelineSelection,
  timelineLayout,
  timelineLayoutStamp,
  clipsInTimelineRect,
  moveTrackTargets,
  groupMoveStart,
  MIN_TIMELINE_SCALE,
  MAX_TIMELINE_SCALE,
  timelineScrollBounds,
  kineticScrollStep,
  trimGroupDraft,
  gainDraft,
  slipPointerDelta,
} from "./geometry.js";
import {isTextTarget} from '../ui.js';
import {createPresetDrop} from './preset-drop.js';
import {createAssetDrop} from './asset-drop.js';
import {createSourceDrop} from '../source-placement.js';
import {createProjectPoolDrop} from '../project-pool-placement.js';

export function isRetimeShortcut(event,{dialogOpen=false}={}){
  return !dialogOpen && !event.defaultPrevented && !event.repeat && !event.isComposing && !event.altKey && !event.shiftKey && Boolean(event.ctrlKey)!==Boolean(event.metaKey) && event.key?.toLowerCase()==='r' && !isTextTarget(event.target);
}
export const TRANSITION_DRAG_TYPE='application/x-venturi-transition';
export function isCloseGapShortcut(event,{dialogOpen=false}={}){
  return event.code==='IntlBackslash' && !event.defaultPrevented && !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.getModifierState?.('AltGraph') && !dialogOpen && !isTextTarget(event.target);
}
export function timelineSelectionFocus(target){
  return Boolean(target?.closest?.('#timeline-panel')) && !target?.closest?.('#browser,#inspector,[data-keyframe-editor],[data-clipboard-owner="pool"]');
}
export function timelineSelectionAction(event,{dialogOpen=false,timelineFocused=false}={}){
  if(dialogOpen || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 || event.getModifierState?.('AltGraph') || isTextTarget(event.target))return null;
  const key=event.key?.toLowerCase();
  if(key==='a' && timelineFocused && Boolean(event.ctrlKey)!==Boolean(event.metaKey) && !event.altKey && !event.shiftKey)return 'all';
  if(key==='y' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey)return 'from_playhead';
  return null;
}

export function createInput({
  canvas,
  getTimeline,
  getPresetContext = () => null,
  getAssetContext = getPresetContext,
  getGapContext = () => null,
  view,
  invalidate,
  onSelect,
  onSeek,
  onCommand,
  onNotice,
  onSlip = () => {},
  canEdit = () => true,
  canNavigate = () => true,
  onOpenCompound = () => {},
  onNavigationIntent = () => {},
  onMarkerEdit = () => {},
  onTransitionSelect = () => {},
  onRetimeMenu = () => {},
  onRetimeVisibilityChange = () => {},
  now = () => performance.now(),
  requestFrame = callback => window.requestAnimationFrame?.(callback),
  cancelFrame = id => window.cancelAnimationFrame?.(id),
}) {
  let gesture = null,
    waiting = false,
    transitionDrag = null,
    presetDrop = null,
    assetDrop = null,
    sourceDrop = null,
    projectPoolDrop = null,
    coast = null;
  const syncLayout=()=>{
    const rect=canvas.getBoundingClientRect(),height=canvas.clientHeight ?? rect.height;
    if(Number.isFinite(height))view.viewportHeight=height;
    const layout=timelineLayout(getTimeline(),view);
    view.videoScroll=layout.videoScroll;view.audioScroll=layout.audioScroll;
    return layout;
  };
  syncLayout();
  const canvasMapping=()=>{
    const rect=canvas.getBoundingClientRect();
    return JSON.stringify([rect.left,rect.top,rect.width,rect.height,canvas.clientWidth,canvas.clientHeight,window.devicePixelRatio ?? 1]);
  };
  let viewportMapping=canvasMapping();
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    syncLayout();
    return [(event.clientX-rect.left)*(canvas.clientWidth && rect.width?canvas.clientWidth/rect.width:1),(event.clientY-rect.top)*(canvas.clientHeight && rect.height?canvas.clientHeight/rect.height:1)];
  };
  const transitionContext=timeline=>{
    const rect=canvas.getBoundingClientRect();
    return JSON.stringify([timeline?.id,timeline?.revision,timeline?.fps.num,timeline?.fps.den,view.scale,view.origin,view.scrollY,timelineLayoutStamp(view),view.tool,view.snap,view.retimeOverwrite,[...(view.retimeVisible || [])].sort(),Boolean(view.transitionReplace),view.transitionSelection,view.selectedGap,view.playhead,[...view.selection].sort(),view.selectionAnchor,rect.left,rect.top,rect.width,rect.height]);
  };
  const modal=()=>Boolean(canvas.ownerDocument?.querySelector?.('dialog[open]'));
  const gapContext=timeline=>JSON.stringify([timeline?.id,timeline?.revision,getGapContext()]);
  const scrollOffsets=()=>JSON.stringify([view.origin,view.videoScroll,view.audioScroll]);
  const scrollContext=timeline=>JSON.stringify([gapContext(timeline),view.scale,view.rowHeight,view.videoPaneHeight,view.tool,view.playhead,view.selection,view.selectionAnchor,canvasMapping()]);
  const scrollBounds=timeline=>timelineScrollBounds(timeline,view,canvas.clientWidth ?? canvas.getBoundingClientRect().width);
  const panCurrent=g=>getTimeline()===g.timeline && scrollContext(g.timeline)===g.context && scrollOffsets()===g.offsets && !modal() && !canvas.ownerDocument?.hidden && canNavigate();
  function stopCoast(){const previous=coast;coast=null;if(previous?.frame!==null && previous?.frame!==undefined)cancelFrame(previous.frame);}
  function coastFrame(owner){
    let id;id=requestFrame(timestamp=>{
      if(coast!==owner || owner.frame!==id)return;owner.frame=null;
      if(gesture || transitionDrag || (presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || waiting || !panCurrent(owner)){stopCoast();return;}
      const bounds=owner.bounds,layout=syncLayout(),dt=(timestamp-owner.at)/1000;owner.at=timestamp;
      const horizontal=kineticScrollStep(view.origin*bounds.pixelsPerFrame,owner.vx,bounds.maxOffset,dt);
      const vertical=kineticScrollStep(owner.pane==='video'?view.videoScroll:view.audioScroll,owner.vy,owner.pane==='video'?layout.videoMaxScroll:owner.pane==='audio'?layout.audioMaxScroll:0,dt);
      view.origin=bounds.pixelsPerFrame?horizontal.offset/bounds.pixelsPerFrame:0;
      if(owner.pane==='video')view.videoScroll=vertical.offset;
      if(owner.pane==='audio')view.audioScroll=vertical.offset;
      owner.vx=horizontal.velocity;owner.vy=vertical.velocity;owner.offsets=scrollOffsets();
      if(horizontal.moved || vertical.moved)invalidate();
      if(owner.vx || owner.vy)coastFrame(owner);else stopCoast();
    });
    if(id===undefined || id===null){stopCoast();return;}owner.frame=id;
  }
  function releasePan(g){
    if(!panCurrent(g) || now()-g.lastMove>100 || !Number.isFinite(g.vx) || !Number.isFinite(g.vy))return;
    const owner={...g,bounds:scrollBounds(g.timeline),vx:g.vx*1.6,vy:g.vy*1.6,at:now(),frame:null};
    if(Math.abs(owner.vx)<15)owner.vx=0;if(Math.abs(owner.vy)<15)owner.vy=0;
    if(!owner.vx && !owner.vy)return;coast=owner;coastFrame(owner);
  }
  const checkGapSelection=()=>{
    if(view.selectedGap && (!selectedGap(getTimeline(),view) || view.selectedGap.context!==gapContext(getTimeline())))view.selectedGap=null;
    return selectedGap(getTimeline(),view);
  };
  const transitionCurrent=g=>{const timeline=getTimeline();return timeline===g.timeline && !timeline.tracks[g.track]?.locked && transitionContext(timeline)===g.context && !modal() && canEdit();};
  const placementContextCurrent=g=>getTimeline()===g.timeline && transitionContext(getTimeline())===g.context && !modal();
  const placementCurrent=g=>placementContextCurrent(g) && canEdit();
  const sourceIdentity=(timeline,selection)=>{
    const source=selectedTransition(timeline,selection);if(!source)return null;
    return JSON.stringify([source.transition,source.locked,source.clip?.start_frame,source.clip?.length_frames,source.left?.start_frame,source.left?.length_frames,source.right?.start_frame,source.right?.length_frames]);
  };
  const sourceCurrent=g=>!g.source || sourceIdentity(getTimeline(),g.source)===g.sourceIdentity;
  const selectTransition=selection=>{view.selectedGap=null;view.selection=[];view.selectionAnchor=null;view.transitionSelection=structuredClone(selection);onTransitionSelect(view.transitionSelection);invalidate();};
  const selectionIntent=()=>JSON.stringify([view.selection,view.selectionAnchor,view.transitionSelection,view.selectedGap]);
  const projectEpoch=()=>getGapContext()?.project_epoch ?? null;
  const checkSelectionAnchor=()=>view.selectionAnchor=reconcileSelectionAnchor(getTimeline(),view.selectionAnchor,projectEpoch());
  const scrollbarOwned=g=>getTimeline()===g.timeline && gapContext(g.timeline)===g.gapContext && transitionContext(g.timeline)===g.context;
  const setScrollbarOffset=(g,offset)=>{
    view[g.pane==='video'?'videoScroll':'audioScroll']=g.pane==='video'?g.maxOffset-offset:offset;
    syncLayout();g.context=transitionContext(g.timeline);invalidate();
  };
  const cancel = (notify=true) => {
    stopCoast();
    viewportMapping=canvasMapping();
    const previous=gesture;
    const slipping = gesture?.kind === "slip";
    const pointerId=gesture?.pointerId;
    if(previous?.kind==='divider' && getTimeline()===previous.timeline && gapContext(previous.timeline)===previous.gapContext)view.videoPaneHeight=previous.beforeHeight;
    if(previous?.kind==='pane_scrollbar' && scrollbarOwned(previous))view[previous.pane==='video'?'videoScroll':'audioScroll']=previous.beforeScroll;
    gesture = null;
    transitionDrag = null;
    presetDrop?.dnd.end();
    assetDrop?.cancel();
    sourceDrop?.cancel();
    projectPoolDrop?.cancel();
    view.draft = null;
    view.lasso = null;
    let restored=false;
    if(previous?.selectionBefore && !previous.moved && clipSelectionOwned(previous)){
      const before=previous.selectionBefore,intent=selectionIntent();
      view.selection=[...before.ids];view.selectionAnchor=reconcileSelectionAnchor(getTimeline(),before.anchor,projectEpoch());
      view.transitionSelection=selectedTransition(getTimeline(),before.transition)?structuredClone(before.transition):null;
      const gapView={selection:view.selection,transitionSelection:view.transitionSelection,selectedGap:before.gap};
      view.selectedGap=before.gap?.context===gapContext(getTimeline()) && selectedGap(getTimeline(),gapView)?structuredClone(before.gap):null;
      restored=true;
      if(previous.selectionPublished && selectionIntent()!==intent){if(view.transitionSelection)onTransitionSelect(view.transitionSelection);else onSelect();}
    }
    if(!restored && !previous?.selectionBefore && !['lasso','divider','pan','header_flag','pane_scrollbar'].includes(previous?.kind) && view.selectedGap){view.selectedGap=null;if(notify)onSelect();}
    if(slipping)onSlip({phase:"cancel"});
    if(pointerId!==undefined && canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);
    invalidate();
  };
  const rippleOwner=()=>({epoch:getGapContext()?.project_epoch,timelineId:getTimeline()?.id,playhead:view.playhead,selection:[...view.selection]});
  function followRipple(position,owner,receipt,removed=[]){
    const after=getTimeline(),clips=after?.tracks.flatMap(track=>track.clips) || [],present=new Set(clips.map(clip=>clip.id));
    if(typeof owner.epoch!=='string' || getGapContext()?.project_epoch!==owner.epoch || after?.id!==owner.timelineId || view.playhead!==owner.playhead || view.transitionSelection || JSON.stringify(view.selection)!==JSON.stringify(owner.selection.filter(id=>present.has(id))) || removed.some(id=>present.has(id)) || (receipt?.project_epoch!=null && receipt.project_epoch!==owner.epoch) || (receipt?.generation!=null && receipt.generation!==getGapContext()?.generation) || !clips.some(clip=>clip.start_frame===position))return;
    view.selectedGap=null;view.playhead=position;
    const width=canvas.getBoundingClientRect().width,x=frameToX(view.playhead,view,after.fps);
    if(Number.isFinite(width) && width>HEADER && (x<HEADER || x>width-8))view.origin=Math.max(0,view.playhead-(width-HEADER)*after.fps.num/(2*view.scale*after.fps.den));
    onSeek(true);
  }
  async function closeGap(){
    const gap=checkGapSelection();
    if(!gap || waiting || gesture || transitionDrag || (presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || modal() || !canEdit())return false;
    const operation={kind:'close_gap',track:gap.track_id,frame:gap.frame};
    const owner=rippleOwner();
    onNavigationIntent();
    if(checkGapSelection()!==gap || modal() || !canEdit())return false;
    waiting=true;invalidate();
    try{
      const receipt=await onCommand(operation);followRipple(gap.start_frame,owner,receipt);
      return true;
    }catch(error){onNotice(error.message);return false;}
    finally{waiting=false;view.selectedGap=null;onSelect();invalidate();}
  }
  async function rippleDelete(){
    if(checkGapSelection())return closeGap();
    if(waiting || gesture || transitionDrag || (presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || modal() || !canEdit() || view.transitionSelection)return false;
    const timeline=getTimeline(),ids=[...view.selection];
    if(!timeline || !ids.length || ids.length>4096 || new Set(ids).size!==ids.length || ids.some(id=>!timeline.tracks.some(track=>track.clips.some(clip=>clip.id===id))))return false;
    const affected=linkedSelection(timeline,ids);
    if(timeline.tracks.some(track=>track.locked && track.clips.some(clip=>affected.includes(clip.id)))){onNotice('Unlock the selected clips and their linked tracks before ripple delete');return false;}
    const context=gapContext(timeline),intent=selectionIntent(),owner=rippleOwner(),starts=timeline.tracks.flatMap(track=>track.clips.filter(clip=>affected.includes(clip.id)).map(clip=>clip.start_frame));
    onNavigationIntent();
    if(getTimeline()!==timeline || gapContext(timeline)!==context || selectionIntent()!==intent || modal() || !canEdit())return false;
    waiting=true;invalidate();
    try{const receipt=await onCommand({kind:'delete',clip_ids:ids,ripple:true});followRipple(Math.min(...starts),owner,receipt,affected);return true;}catch(error){onNotice(error.message);return false;}
    finally{waiting=false;if(getTimeline()?.id===owner.timelineId && getGapContext()?.project_epoch===owner.epoch && selectionIntent()===intent){view.selection=[];view.selectionAnchor=null;}view.selectedGap=null;onSelect();invalidate();}
  }
  const canCloseGap=()=>Boolean(checkGapSelection() && !waiting && !gesture && !transitionDrag && !(presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) && !modal() && canEdit());
  const canSelectTimeline=()=>Boolean(getTimeline() && !waiting && !gesture && !transitionDrag && !(presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) && !view.draft && !view.lasso && !modal() && canNavigate());
  function selectTimelineClips(mode){
    if(!['all','from_playhead'].includes(mode) || !canSelectTimeline() || (mode==='from_playhead' && (!Number.isSafeInteger(view.playhead) || view.playhead<0)))return false;
    const timeline=getTimeline(),context=gapContext(timeline),playhead=view.playhead,ids=timelineClipSelection(timeline,mode==='from_playhead'?playhead:null);
    onNavigationIntent();
    if(getTimeline()!==timeline || gapContext(timeline)!==context || view.playhead!==playhead || !canSelectTimeline())return false;
    view.selectedGap=null;view.transitionSelection=null;view.selection=ids;view.selectionAnchor=firstSelectionAnchor(timeline,ids,projectEpoch());onSelect();invalidate();return true;
  }
  function selectClip(clipId,modifiers={}){
    if(!canSelectTimeline() || modifiers.defaultPrevented || modifiers.isComposing || modifiers.keyCode===229 || modifiers.repeat || modifiers.getModifierState?.('AltGraph') || modifiers.altKey)return false;
    checkSelectionAnchor();
    const timeline=getTimeline(),context=gapContext(timeline),intent=selectionIntent();
    const result=clickTimelineSelection(timeline,{ids:view.selection,anchor:view.selectionAnchor},clipId,{shift:Boolean(modifiers.shiftKey),toggle:Boolean(modifiers.ctrlKey || modifiers.metaKey),projectEpoch:projectEpoch()},view);
    if(!result)return false;
    onNavigationIntent();
    if(getTimeline()!==timeline || gapContext(timeline)!==context || selectionIntent()!==intent || !canSelectTimeline())return false;
    view.selection=result.ids;view.selectionAnchor=result.anchor;view.selectedGap=null;view.transitionSelection=null;onSelect();invalidate();return true;
  }
  function handleSelectionKey(event,{timelineFocused=true}={}){
    const action=timelineSelectionAction(event,{dialogOpen:modal(),timelineFocused});
    if(!action || !canSelectTimeline())return false;
    event.preventDefault?.();event.stopPropagation?.();return selectTimelineClips(action);
  }
  function selectGap(trackId,frame){
    if(waiting || gesture || transitionDrag || (presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || modal() || !canNavigate())return false;
    const timeline=getTimeline(),gap=nativeGapAt(timeline,trackId,frame);if(!gap)return false;
    const context=gapContext(timeline);
    onNavigationIntent();
    if(getTimeline()!==timeline || gapContext(timeline)!==context || modal() || !canNavigate())return false;
    view.selection=[];view.selectionAnchor=null;view.transitionSelection=null;view.selectedGap={...gap,frame,timeline_id:timeline.id,revision:timeline.revision,context};onSelect();invalidate();return true;
  }
  function handleGapKey(event){
    if(event.key==='Escape' && view.selectedGap && !event.defaultPrevented && !event.isComposing && !isTextTarget(event.target) && !modal()){
      event.preventDefault?.();event.stopPropagation?.();onNavigationIntent();cancel();return true;
    }
    if(!isCloseGapShortcut(event,{dialogOpen:modal()}) || (!checkGapSelection() && !view.selection.length))return false;
    event.preventDefault?.();event.stopPropagation?.();void rippleDelete();return true;
  }
  const placementAt=(g,x,y)=>transitionPlacement(g.timeline,view,[x,y],g.transition ?? g.catalogKind,{replace:Boolean(view.transitionReplace),source:g.source || null});
  async function applyPlacement(draft){
    if(!draft || draft.noop)return;
    if(draft.error){onNotice(draft.error);return;}
    if(!draft.operation)return;
    const intent=selectionIntent(),timelineId=getTimeline()?.id;waiting=true;
    try{
      await onCommand(draft.operation);
      const current=getTimeline(),selected=selectedTransition(current,draft.selection);
      if(selectionIntent()===intent && current?.id===timelineId && selected && ['kind','duration','direction','ease','curve'].every(key=>selected.transition[key]===draft.transition[key]))selectTransition(draft.selection);
    }catch(error){onNotice(error.message);}finally{waiting=false;}
  }
  const clipViewport=()=>{const rect=canvas.getBoundingClientRect();return JSON.stringify([view.scale,view.origin,view.scrollY,timelineLayoutStamp(view),view.tool,view.snap,view.retimeOverwrite,view.playhead,rect.left,rect.top,rect.width,rect.height]);};
  function clipSelectionOwned(g){return getTimeline()===g.timeline && gapContext(g.timeline)===g.selectionContext && selectionIntent()===g.selectionIntent;}
  function clipSelectionCurrent(g){return clipSelectionOwned(g) && clipViewport()===g.selectionViewport && !modal() && canNavigate();}
  function beginClipGesture(hit,event,x,y,timeline,notify=true){
    if(!canNavigate())return false;
    const before={ids:[...view.selection],anchor:checkSelectionAnchor(),gap:structuredClone(view.selectedGap || null),transition:structuredClone(view.transitionSelection || null)};
    const modifiers={shift:Boolean(event.shiftKey),toggle:Boolean(event.ctrlKey || event.metaKey),projectEpoch:projectEpoch()};
    if(!['fade','gain'].includes(hit.kind)){
      const selected=clickTimelineSelection(timeline,before,hit.clip.id,modifiers,view);if(!selected)return false;
      if(modifiers.shift || modifiers.toggle || !before.ids.includes(hit.clip.id)){view.selection=selected.ids;view.selectionAnchor=selected.anchor;}
      view.selectedGap=null;view.transitionSelection=null;if(notify)onSelect();
    }
    gesture={...hit,x,y,frame:xToFrame(x,view,timeline.fps),moved:false,timeline,pointerId:event.pointerId,duplicate:hit.kind==='move' && Boolean(event.altKey)};
    if(!['fade','gain'].includes(hit.kind))Object.assign(gesture,{selectionBefore:before,selectionPublished:notify,clickModifiers:modifiers,selectionContext:gapContext(timeline),selectionViewport:clipViewport(),selectionIntent:selectionIntent()});
    if(['fade','gain'].includes(hit.kind)){
      if(!canEdit()){gesture=null;onNotice('A writable idle session is required to edit this clip');return false;}
      gesture.context=transitionContext(timeline);
    }
    if(view.tool==='slip' && !['fade','gain'].includes(hit.kind)){
      const linked=linkedSelection(timeline,[hit.clip.id]),affected=timeline.tracks.flatMap(track=>track.clips.filter(clip=>linked.includes(clip.id)).map(clip=>({track,clip})));
      if(affected.some(({track,clip})=>track.locked || !clip.slip_range)){gesture=null;onNotice('Slip requires unlocked source clips and their linked handles');return false;}
      gesture.kind='slip';gesture.min=Math.max(...affected.map(({clip})=>clip.slip_range[0]));gesture.max=Math.min(...affected.map(({clip})=>clip.slip_range[1]));onSlip({phase:'begin',clip_id:hit.clip.id,delta:0});
    }
    return true;
  }
  function beginSelectionDrag(g){
    if(!g.selectionBefore || g.moved)return true;
    if(!canEdit()){cancel(false);onNotice('A writable idle session is required to edit these clips');return false;}
    const ids=g.kind!=='slip' && g.selectionBefore.ids.includes(g.clip.id)?[...g.selectionBefore.ids]:unlockedLinkedSelection(g.timeline,[g.clip.id]);
    const affected=linkedSelection(g.timeline,g.roll_neighbor_id?[g.clip.id,g.roll_neighbor_id]:ids);
    if(g.timeline.tracks.some(track=>track.locked && track.clips.some(clip=>affected.includes(clip.id)))){cancel(false);onNotice('Unlock the selected clips and their linked tracks before editing');return false;}
    view.selection=ids;
    view.selectionAnchor=clipSelectionAnchor(g.timeline,g.clip.id,projectEpoch());view.selectedGap=null;view.transitionSelection=null;
    g.selectionIntent=selectionIntent();if(g.fromTransitionBody)g.context=transitionContext(g.timeline);return true;
  }
  function beginBodyClipDrag(g){
    const timeline=getTimeline(),left=frameToX(g.clip.start_frame,view,timeline.fps),right=frameToX(g.clip.start_frame+g.clip.length_frames,view,timeline.fps),kind=g.x-left<8?'trim_start':right-g.x<8?'trim_end':'move';
    gesture=null;
    if(!beginClipGesture({kind,clip:g.clip,track:g.track},{...g.modifiers,pointerId:g.pointerId},g.x,g.y,timeline,false)){cancel(false);if(canvas.hasPointerCapture(g.pointerId))canvas.releasePointerCapture(g.pointerId);return false;}
    gesture={...gesture,fromTransitionBody:true,pointerId:g.pointerId,timeline,context:transitionContext(timeline),source:g.source,sourceIdentity:g.sourceIdentity};return true;
  }
  const down = (event) => {
    stopCoast();
    if (waiting || gesture || transitionDrag || (presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || modal() || event.defaultPrevented || event.isComposing || !canNavigate()) return;
    const timeline = getTimeline();
    if (!timeline) return;
    onNavigationIntent();
    canvas.focus({preventScroll:true});
    const [x, y] = point(event);
    viewportMapping=canvasMapping();
    const hit = hitTest(x, y, timeline, view,canvas.clientWidth ?? canvas.getBoundingClientRect().width);
    if(event.button===0 && hit.kind==='pane_scrollbar'){
      gesture={...hit,x,y,pointerId:event.pointerId,timeline,gapContext:gapContext(timeline),context:transitionContext(timeline),beforeScroll:view[hit.pane==='video'?'videoScroll':'audioScroll'],moved:false};
    }else if(event.button===0 && hit.kind==='divider'){
      const layout=syncLayout();
      gesture={kind:'divider',x,y,pointerId:event.pointerId,timeline,gapContext:gapContext(timeline),beforeHeight:view.videoPaneHeight,initialHeight:layout.videoHeight,viewportHeight:view.viewportHeight};
    }else if(event.button===0 && hit.kind==='header_flag'){
      if(!canEdit()){onNotice('A writable idle session is required to change track flags');return;}
      gesture={...hit,x,y,pointerId:event.pointerId,timeline,context:transitionContext(timeline),value:Boolean(timeline.tracks[hit.track][hit.flag]),moved:false};
    }else if (event.button === 0 && hit.kind === "marker") {
      gesture = {kind:"marker",marker:hit.marker,mode:hit.edge || (event.altKey && !hit.marker.duration_frames ? "extend" : "move"),frame:xToFrame(x,view,timeline.fps),x,y,moved:false,editable:canEdit()};
    } else if(event.button===0 && hit.kind==='transition'){
      if(!canEdit()){onNotice('A writable idle session is required to edit this handle');return;}
      gesture={...hit,x,y,moved:false,pointerId:event.pointerId,timeline,context:transitionContext(timeline)};
    } else if(event.button===0 && hit.kind==='transition_body'){
      if(event.altKey && !canEdit()){onNotice('A writable idle session is required to duplicate a transition');return;}
      gesture={...hit,kind:event.altKey?'transition_copy':'transition_body',x,y,moved:false,pointerId:event.pointerId,timeline,context:transitionContext(timeline),source:structuredClone(hit.selection),sourceIdentity:sourceIdentity(timeline,hit.selection),transition:structuredClone(hit.transition),modifiers:{ctrlKey:event.ctrlKey,shiftKey:event.shiftKey}};
    } else if (event.button === 1 || (event.altKey && !hit.clip)) {
      gesture = {
        kind: "pan",
        x,
        y,
        origin: view.origin,
        pane:syncLayout().paneAtY(y),videoScroll:view.videoScroll,audioScroll:view.audioScroll,
        timeline,pointerId:event.pointerId,button:event.button,context:scrollContext(timeline),offsets:scrollOffsets(),sampleAt:now(),lastMove:-Infinity,vx:0,vy:0,
      };
    } else if (event.button !== 0) return;
    else if(['transition','retime','retime_menu','retime_close'].includes(hit.kind)){
      if(!canEdit()){onNotice('A writable idle session is required to edit this handle');return;}
      gesture={...hit,x,y,moved:false,pointerId:event.pointerId,timeline,context:transitionContext(timeline)};
    } else if (hit.clip) {
      if(!beginClipGesture(hit,event,x,y,timeline))return;
    } else if (hit.kind === "scrub") {
      gesture = { kind: "scrub" };
      view.playhead = xToFrame(x, view, timeline.fps);
      onSeek(false);
    } else if (hit.kind === "blank") {
      const frame=xToFrame(x,view,timeline.fps),gap=nativeGapAt(timeline,timeline.tracks[hit.track]?.id,frame);
      gesture = { kind: "lasso", x, y, timeline,context:transitionContext(timeline),gapContext:gapContext(timeline),pointerId:event.pointerId,moved:false,gap:gap?{...gap,frame}:null };
    } else return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    invalidate();
  };
  const move = (event,allowRelease=false) => {
    stopCoast();
    if((presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()))return;
    if (!gesture) {
      const timeline = getTimeline(); if (!timeline) return;
      const [x,y] = point(event), hit = hitTest(x,y,timeline,view,canvas.clientWidth ?? canvas.getBoundingClientRect().width);
      if(hit.kind==='pane_scrollbar'){canvas.title=`Scroll ${hit.pane} tracks`;if(canvas.style)canvas.style.cursor='ns-resize';return;}
      canvas.title = hit.marker ? `${hit.marker.note || "Marker"} Â· ${hit.marker.start_frame}f Â· drag to move, range edges resize, Alt+drag a point to extend, double-click to edit` : hit.kind==='retime_menu'?'Choose a native speed preset Â· keyboard: select clip and press Shift+F10':hit.kind==='retime_close'?'Hide this clipâ€™s speed strip':hit.kind==='retime' ? `Speed handle Â· drag the right endpoint to resize at native speed${view.retimeOverwrite?' Â· OVERWRITE clips enabled':''}` : hit.kind==='transition_body'?'Click to select this transition Â· Alt+drag its body to copy Â· handles resize':hit.kind==='transition' ? `${hit.slot==='cut_after'?'Cross transition':`Transition ${hit.slot}`} Â· ${hit.duration}f Â· drag to change duration` : hit.kind==='fade' ? `Fade ${hit.edge} Â· ${hit.clip[`fade_${hit.edge}`]}f Â· drag to change this clip's fade` : '';
      if(canvas.style)canvas.style.cursor = hit.kind==='divider'?'ns-resize':['fade','transition','retime'].includes(hit.kind) ? 'ew-resize' : ['header_flag','retime_menu','retime_close'].includes(hit.kind)?'pointer':hit.kind==='transition_body'?'copy':hit.marker ? hit.edge ? "ew-resize" : "grab" : "";
      if(hit.kind==='gain'){canvas.title='Drag clip gain vertically · constant audio gain only';if(canvas.style)canvas.style.cursor='ns-resize';}
      if(hit.roll_neighbor_id){canvas.title='Roll adjacent cut · both linked groups';if(canvas.style)canvas.style.cursor='ew-resize';}
      if(hit.kind==='move' && event.altKey){canvas.title=`Duplicate linked selection${view.retimeOverwrite?' · OVERWRITE enabled':''}`;if(canvas.style)canvas.style.cursor='copy';}
      const hover=hit.clip?.id ?? null;if(view.hoverFadeClip!==hover){view.hoverFadeClip=hover;invalidate();}
      return;
    }
    const timeline = getTimeline(),
      [x, y] = point(event),
      g = gesture;
    if(g.kind==='pane_scrollbar'){
      if(event.pointerId!==g.pointerId)return;
      if(!scrollbarOwned(g) || modal() || !canNavigate() || (!allowRelease && event.buttons!==undefined && !(event.buttons&1))){cancel();return;}
      g.moved ||= Math.hypot(x-g.x,y-g.y)>=4;
      if(g.moved && g.travel>0)setScrollbarOffset(g,Math.max(0,Math.min(g.maxOffset,g.offset+(y-g.y)*g.maxOffset/g.travel)));
      return;
    }
    if(g.kind==='divider'){
      if(event.pointerId!==g.pointerId)return;
      if(timeline!==g.timeline || gapContext(timeline)!==g.gapContext || view.viewportHeight!==g.viewportHeight || modal() || !canNavigate()){cancel();return;}
      const layout=syncLayout(),[minimum,maximum]=layout.videoHeightRange;
      view.videoPaneHeight=Math.max(minimum,Math.min(maximum,g.initialHeight+y-g.y));syncLayout();invalidate();return;
    }
    if(g.kind==='header_flag'){
      if(event.pointerId!==g.pointerId)return;
      if(timeline!==g.timeline || transitionContext(timeline)!==g.context || !canEdit() || modal()){cancel();return;}
      g.moved ||= Math.hypot(x-g.x,y-g.y)>=4;return;
    }
    if(g.selectionBefore){
      if(event.pointerId!==g.pointerId)return;
      if(!clipSelectionCurrent(g) || (g.moved && !canEdit()) || (!allowRelease && event.buttons!==undefined && !(event.buttons&1))){cancel(false);return;}
      if(Math.hypot(x-g.x,y-g.y)>=4 && !beginSelectionDrag(g))return;
    }
    if(g.kind==='lasso'){
      if(event.pointerId!==g.pointerId)return;
      if(timeline!==g.timeline || transitionContext(timeline)!==g.context || gapContext(timeline)!==g.gapContext || modal()){cancel();return;}
      if(Math.hypot(x-g.x,y-g.y)>=4)g.moved=true;
    }
    if(g.kind==='retime_menu' || g.kind==='retime_close'){
      if(event.pointerId!==g.pointerId)return;
      if(!transitionCurrent(g) || (!allowRelease && event.buttons!==undefined && !(event.buttons&1))){cancel();return;}
      if(Math.hypot(x-g.x,y-g.y)>=4)g.moved=true;
      return;
    }
    if(g.fromTransitionBody){
      if(event.pointerId!==g.pointerId)return;
      if(!placementCurrent(g) || !sourceCurrent(g)){cancel();onNotice('Clip gesture cancelled because the transition source or editing session changed');return;}
      if(!allowRelease && event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
    }
    if(g.kind==='transition_copy' || g.kind==='transition_body'){
      if(event.pointerId!==g.pointerId)return;
      if(!(g.kind==='transition_body'?placementContextCurrent(g):placementCurrent(g)) || !sourceCurrent(g)){cancel();onNotice('Transition gesture cancelled because the source, editing session or viewport changed');return;}
      if(event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      if(g.kind==='transition_copy')view.draft=placementAt(g,x,y);
      else{if(!canEdit()){cancel();onNotice('A writable idle session is required to move this clip');return;}if(beginBodyClipDrag(g))move(event,allowRelease);return;}
    } else if(g.kind==='transition' || g.kind==='retime'){
      if(event.pointerId!==g.pointerId)return;
      if(!transitionCurrent(g)){cancel();onNotice('Duration gesture cancelled because the editing session or viewport changed');return;}
      if(event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      view.draft={...(g.kind==='retime'?retimeDraft(g,x-g.x,timeline,view):transitionDraft(g,x-g.x,view,timeline.fps)),track_id:timeline.tracks[g.track].id};
    } else if(g.kind==='fade' || g.kind==='gain'){
      if(event.pointerId!==g.pointerId)return;
      if(!transitionCurrent(g) || canvas.ownerDocument?.hidden || (!allowRelease && event.buttons!==undefined && !(event.buttons&1))){cancel();return;}
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      view.draft=g.kind==='gain'?gainDraft(g.clip,timeline.tracks[g.track],view,timeline.fps,y-g.y):fadeDraft(g.clip,g.edge,Math.round((x-g.x)*timeline.fps.num/(view.scale*timeline.fps.den)));
    } else if (g.kind === "pan") {
      if(event.pointerId!==g.pointerId)return;
      if(!panCurrent(g) || (!allowRelease && event.buttons!==undefined && !(event.buttons&(g.button===1?4:1)))){cancel();return;}
      const beforeOrigin=view.origin,beforeVertical=g.pane==='video'?view.videoScroll:g.pane==='audio'?view.audioScroll:0,time=now(),elapsed=(time-g.sampleAt)/1000,bounds=scrollBounds(timeline);
      view.origin = Math.max(
        0,
        Math.min(bounds.maxOrigin,g.origin -
          (x - g.x) / ((view.scale * timeline.fps.den) / timeline.fps.num),
        ),
      );
      if(g.pane==='video')view.videoScroll=g.videoScroll+y-g.y;
      if(g.pane==='audio')view.audioScroll=g.audioScroll-(y-g.y);
      syncLayout();
      const dx=(view.origin-beforeOrigin)*bounds.pixelsPerFrame,dy=(g.pane==='video'?view.videoScroll:g.pane==='audio'?view.audioScroll:0)-beforeVertical;
      if(dx || dy){g.vx=elapsed>0 && elapsed<=.1?dx/elapsed:0;g.vy=elapsed>0 && elapsed<=.1?dy/elapsed:0;g.lastMove=time;}
      g.sampleAt=time;g.offsets=scrollOffsets();
    } else if (g.kind === "scrub") {
      view.playhead = xToFrame(x, view, timeline.fps);
      onSeek(false);
    } else if (g.kind === "marker") {
      if (!g.editable || (Math.hypot(x-g.x,y-g.y)<4 && !g.moved)) return;
      g.moved = true;
      const candidates = [view.playhead,...timeline.tracks.flatMap(track=>track.clips.flatMap(clip=>[clip.start_frame,clip.start_frame+clip.length_frames]))];
      view.draft = {kind:"marker",marker:markerDraft(g.marker,g.mode,xToFrame(x,view,timeline.fps),g.frame,candidates,view,timeline.fps)};
    } else if (g.kind === "lasso") {
      view.lasso = {
        x: Math.min(g.x, x),
        y: Math.min(g.y, y),
        width: Math.abs(x - g.x),
        height: Math.abs(y - g.y),
      };
    } else if(g.kind === "slip") {
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      const delta=slipPointerDelta(x-g.x,view,timeline.fps,g.min,g.max);
      const ids=linkedSelection(timeline,[g.clip.id]);
      view.draft={kind:"slip",target:delta,error:null,changes:timeline.tracks.flatMap((track)=>track.clips.filter((clip)=>ids.includes(clip.id)).map((clip)=>({clip_id:clip.id,to_track:track.id,to_start_frame:clip.start_frame,length_frames:clip.length_frames})))};
      onSlip({phase:"draft",clip_id:g.clip.id,delta});
    } else if(g.kind==='trim_start' || g.kind==='trim_end'){
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      const edge=g.kind==='trim_start'?'start':'end',original=edge==='start'?g.clip.start_frame:g.clip.start_frame+g.clip.length_frames;
      view.draft=trimGroupDraft(timeline,view,g.clip.id,view.selection,edge,Math.round(original+(x-g.x)*timeline.fps.num/(view.scale*timeline.fps.den)),g.roll_neighbor_id,view.retimeOverwrite===true);
    } else {
      if (Math.hypot(x - g.x, y - g.y) < 4 && !g.moved) return;
      g.moved = true;
      let frame = xToFrame(x, view, timeline.fps);
      const affected=g.kind==='move'?linkedSelection(timeline,view.selection):linkedSelection(timeline,[g.clip.id]);
      const targets=g.kind==='move'?moveTrackTargets(timeline,view,g.track,y,affected):null;
      const candidates = [];
      if(g.kind!=='move')for (const track of timeline.tracks)
        for (const clip of track.clips)
          if (!affected.includes(clip.id))
            candidates.push(
              clip.start_frame,
              clip.start_frame + clip.length_frames,
            );
      if(g.kind!=='move')candidates.push(view.playhead);
      const original =
        g.kind === "move"
          ? g.clip.start_frame
          : g.kind === "trim_start"
            ? g.clip.start_frame
            : g.clip.start_frame + g.clip.length_frames;
      let target;
      if(g.kind==='move'){
        const raw=original+(x-g.x)*timeline.fps.num/(view.scale*timeline.fps.den),reference=raw<0?-Math.round(-raw):Math.round(raw);
        target=groupMoveStart(timeline,view,g.clip.id,targets,reference);
      }else{
        target=Math.max(0,original+frame-g.frame);
        if(view.snap)target=snapFrame(target,candidates,view,timeline.fps);
      }
      const delta = target - original;
      const changes = [];
      for (const [index, track] of timeline.tracks.entries())
        for (const clip of track.clips)
          if (affected.includes(clip.id)) {
            const destination =
              g.kind === "move" ? targets.get(clip.id) : index;
            const start =
              g.kind === "trim_end"
                ? clip.start_frame
                : clip.start_frame + delta;
            const length =
              clip.length_frames +
              (g.kind === "trim_start"
                ? -delta
                : g.kind === "trim_end"
                  ? delta
                  : 0);
            changes.push({
              clip_id: clip.id,
              ...(typeof destination==='object'?{to_new_track:destination}:{to_track:timeline.tracks[destination]?.id}),
              to_start_frame: start,
              length_frames: length,
            });
          }
      view.draft = {
        changes,
        error: targets?.error || validateDraft(timeline, changes),
        new_video_tracks:targets?.new_video_tracks || 0,
        new_audio_tracks:targets?.new_audio_tracks || 0,
        kind: g.kind,
        target,
      };
      if(g.duplicate){
        view.draft.duplicate=true;
        if(view.retimeOverwrite && view.draft.error==='Overlap · safe move blocked')view.draft.error=validateDraft({...timeline,tracks:timeline.tracks.map(track=>({...track,clips:track.clips.filter(clip=>affected.includes(clip.id))}))},changes);
        if(!view.draft.error && !view.retimeOverwrite && changes.some(change=>!change.to_new_track && timeline.tracks.find(track=>track.id===change.to_track)?.clips.some(clip=>change.to_start_frame<clip.start_frame+clip.length_frames && change.to_start_frame+change.length_frames>clip.start_frame)))view.draft.error='Overlap · safe duplicate blocked';
      }
    }
    invalidate();
  };
  const up = async (event) => {
    if (!gesture) return;
    const g = gesture,
      timeline = getTimeline();
    if(g.kind==='pan'){
      if(event.pointerId!==g.pointerId || event.button!==g.button)return;
      move(event,true);if(gesture!==g)return;
      gesture=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      releasePan(g);invalidate();return;
    }
    if(g.kind==='pane_scrollbar'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      move(event,true);if(gesture!==g)return;
      if(!g.moved && g.travel>0){const [,y]=point(event);setScrollbarOffset(g,Math.max(0,Math.min(g.maxOffset,(y-g.top-g.thumbHeight/2)*g.maxOffset/g.travel)));}
      gesture=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);invalidate();return;
    }
    if(g.kind==='divider' || g.kind==='header_flag'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(g.kind==='divider'){
        move(event,true);if(gesture!==g)return;
        gesture=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);invalidate();return;
      }
      const [x,y]=point(event),hit=hitTest(x,y,timeline,view,canvas.clientWidth ?? canvas.getBoundingClientRect().width);
      const valid=timeline===g.timeline && transitionContext(timeline)===g.context && canEdit() && !modal() && !g.moved && Math.hypot(x-g.x,y-g.y)<4 && hit.kind==='header_flag' && hit.track===g.track && hit.flag===g.flag && Boolean(timeline.tracks[g.track][g.flag])===g.value;
      gesture=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(valid){waiting=true;try{await onCommand({kind:'set_track',track:timeline.tracks[g.track].id,[g.flag]:!g.value});}catch(error){onNotice(error.message);}finally{waiting=false;}}
      invalidate();return;
    }
    if(g.selectionBefore){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!clipSelectionCurrent(g) || (g.moved && !canEdit())){cancel();return;}
      const [x,y]=point(event);
      if(!g.moved && Math.hypot(x-g.x,y-g.y)>=4){move(event,true);if(gesture!==g)return;}
      if(!g.moved){
        const selection=clickTimelineSelection(timeline,g.selectionBefore,g.clip.id,g.clickModifiers,view);
        gesture=null;view.draft=null;
        if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
        if(selection){view.selection=selection.ids;view.selectionAnchor=selection.anchor;view.selectedGap=null;view.transitionSelection=null;onSelect();}
        if(g.kind==='slip')onSlip({phase:'end'});
        invalidate();return;
      }
      move(event,true);if(gesture!==g)return;
    }
    if(g.kind==='lasso'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(timeline!==g.timeline || transitionContext(timeline)!==g.context || gapContext(timeline)!==g.gapContext || modal()){cancel();return;}
      const [x,y]=point(event);g.moved ||= Math.hypot(x-g.x,y-g.y)>=4;
      if(!g.moved){
        const native=g.gap && nativeGapAt(timeline,g.gap.track_id,g.gap.frame);
        const selection=native && native.start_frame===g.gap.start_frame && native.length_frames===g.gap.length_frames?{...g.gap,timeline_id:timeline.id,revision:timeline.revision,context:g.gapContext}:null;
        gesture=null;view.lasso=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
        view.selection=[];view.selectionAnchor=null;view.transitionSelection=null;view.selectedGap=selection;onSelect();invalidate();return;
      }
      view.lasso={x:Math.min(g.x,x),y:Math.min(g.y,y),width:Math.abs(x-g.x),height:Math.abs(y-g.y)};
    }
    if(g.kind==='retime_menu' || g.kind==='retime_close'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!transitionCurrent(g)){cancel();onNotice('Speed menu cancelled because the editing session or viewport changed');return;}
      const [x,y]=point(event),hit=hitTest(x,y,timeline,view,canvas.getBoundingClientRect().width);
      const clicked=!g.moved && Math.hypot(x-g.x,y-g.y)<4 && hit.kind===g.kind && hit.clip_id===g.clip_id;
      cancel();
      if(clicked && g.kind==='retime_close'){view.retimeVisible.delete(g.clip_id);onRetimeVisibilityChange();onNotice('Speed strip hidden for this clip');invalidate();}
      else if(clicked)onRetimeMenu({clip_id:g.clip_id,track_id:timeline.tracks[g.track].id,returnFocus:canvas});
      return;
    }
    if(g.fromTransitionBody){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!placementCurrent(g) || !sourceCurrent(g)){cancel();onNotice('Clip gesture cancelled because the transition source or editing session changed');return;}
      move(event,true);if(gesture!==g)return;
    }
    if(g.kind==='transition_copy' || g.kind==='transition_body'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!(g.kind==='transition_body'?placementContextCurrent(g):placementCurrent(g)) || !sourceCurrent(g)){cancel();onNotice('Transition gesture cancelled because the source, editing session or viewport changed');return;}
      const [x,y]=point(event);g.moved=g.moved || Math.hypot(x-g.x,y-g.y)>=4;
      if(g.kind==='transition_body' && g.moved){if(!canEdit()){cancel();onNotice('A writable idle session is required to move this clip');return;}if(beginBodyClipDrag(g)){move(event,true);if(gesture)await up(event);}return;}
      const draft=g.kind==='transition_copy' && g.moved?placementAt(g,x,y):null;
      gesture=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(!g.moved)selectTransition(g.source);
      else if(g.kind==='transition_copy')await applyPlacement(draft);
      view.draft=null;invalidate();return;
    }
    if(g.kind==='transition' || g.kind==='retime'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!transitionCurrent(g)){cancel();onNotice('Duration gesture cancelled because the editing session or viewport changed');return;}
      const [x,y]=point(event);
      if(g.moved || Math.hypot(x-g.x,y-g.y)>=4){g.moved=true;view.draft={...(g.kind==='retime'?retimeDraft(g,x-g.x,timeline,view):transitionDraft(g,x-g.x,view,timeline.fps)),track_id:timeline.tracks[g.track].id};}
    }
    if(g.kind==='fade' || g.kind==='gain'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!transitionCurrent(g) || canvas.ownerDocument?.hidden){cancel();return;}
      move(event,true);if(gesture!==g)return;
    }
    const draft=view.draft;
    if(g.kind==='fade' && event.pointerId!==g.pointerId)return;
    if(g.kind==='fade' && (timeline!==g.timeline || !canEdit())){cancel();onNotice('Fade gesture cancelled because the editing session changed');return;}
    if (g.kind === "lasso" && view.lasso) {
      const box = view.lasso;
      const hits=clipsInTimelineRect(timeline,view,{left:box.x,right:box.x+box.width,top:box.y,bottom:box.y+box.height});
      view.selection=unlockedLinkedSelection(timeline,hits);view.selectionAnchor=clipSelectionAnchor(timeline,hits[0],projectEpoch());view.selectedGap=null;view.transitionSelection=null;
      onSelect();
    }
    gesture = null;
    view.lasso = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if(g.selectionBefore)onSelect();
    if (g.kind === "scrub") onSeek(true);
    if (g.kind === "marker" && !g.moved) { view.playhead=g.marker.start_frame;onSeek(true); }
    const markerChanged = g.kind !== "marker" || (draft && (draft.marker.start_frame!==g.marker.start_frame || draft.marker.duration_frames!==g.marker.duration_frames));
    const bodyChanged=!g.fromTransitionBody || draft?.changes?.some(change=>timeline.tracks.some(track=>track.clips.some(clip=>clip.id===change.clip_id && (track.id!==change.to_track || clip.start_frame!==change.to_start_frame || clip.length_frames!==change.length_frames))));
    if (draft && g.moved && markerChanged && bodyChanged && !(g.kind === "slip" && draft.target === 0) && !(g.kind==='fade' && draft.frames===draft.original) && !(g.kind==='gain' && draft.gain_db===draft.original) && !(draft.kind==='trim_group' && draft.target===draft.original) && !(g.kind==='transition' && draft.duration===g.duration) && !(g.kind==='retime' && draft.end_frame===g.end_frame)) {
      if (draft.error) onNotice(draft.error);
      else {
        waiting = true;
        try {
          const operation =
            draft.kind==='trim_group' || ['transition','retime'].includes(g.kind) ? draft.operation : g.kind==='gain'?{kind:'set_properties',clip_id:g.clip.id,patch:{gain_db:draft.gain_db}}:g.kind==='fade' ? {kind:'set_properties',clip_id:g.clip.id,patch:{[`fade_${g.edge}`]:draft.frames}} : g.kind === "marker" ? {kind:"move_marker",marker_id:g.marker.id,start_frame:draft.marker.start_frame,duration_frames:draft.marker.duration_frames} : g.kind === "move"
              ? draft.duplicate || draft.new_video_tracks || draft.new_audio_tracks ? {
                  kind:'move_clips',new_video_tracks:draft.new_video_tracks,new_audio_tracks:draft.new_audio_tracks,
                  ...(draft.duplicate?{duplicate:true,overwrite:view.retimeOverwrite===true}:{}),
                  moves:draft.changes.map(change=>({clip_id:change.clip_id,to_start_frame:change.to_start_frame,to_track:change.to_new_track?{kind:'new',depth:change.to_new_track.depth}:{kind:'existing',track_id:change.to_track}})),
                } : {
                  kind: "safe_move",
                  moves: draft.changes.map(
                    ({ clip_id, to_track, to_start_frame }) => ({
                      clip_id,
                      to_track,
                      to_start_frame,
                    }),
                  ),
                }
              : g.kind === "slip" ? {kind:"slip",clip_ids:linkedSelection(timeline,[g.clip.id]),delta_frames:draft.target} : {
                  kind: "trim",
                  clip_id: g.clip.id,
                  edge: g.kind === "trim_start" ? "start" : "end",
                  frame: draft.target,
                };
          const owner=draft.duplicate?{epoch:projectEpoch(),timelineId:timeline.id,selection:[...view.selection],anchor:structuredClone(view.selectionAnchor),ids:new Set(timeline.tracks.flatMap(track=>track.clips.map(clip=>clip.id)))}:null;
          const receipt=await onCommand(operation);
          if(owner && receipt?.project_epoch===owner.epoch && projectEpoch()===owner.epoch && getTimeline()?.id===owner.timelineId && receipt.generation===getGapContext()?.generation && Array.isArray(receipt.clip_ids) && receipt.clip_ids.length===draft.changes.length && new Set(receipt.clip_ids).size===receipt.clip_ids.length){
            const current=getTimeline(),present=new Set(current.tracks.flatMap(track=>track.clips.map(clip=>clip.id))),expected=owner.selection.filter(id=>present.has(id));
            if(!view.transitionSelection && !view.selectedGap && JSON.stringify(view.selection)===JSON.stringify(expected) && JSON.stringify(view.selectionAnchor)===JSON.stringify(reconcileSelectionAnchor(current,owner.anchor,owner.epoch)) && receipt.clip_ids.every(id=>typeof id==='string' && !owner.ids.has(id) && present.has(id))){
              view.selection=[...receipt.clip_ids];view.selectionAnchor=firstSelectionAnchor(current,view.selection,owner.epoch);onSelect();
            }
          }
        } catch (error) {
          onNotice(error.message);
        } finally {
          waiting = false;
        }
      }
    }
    view.draft = null;
    if(g.kind === "slip")onSlip({phase:"end"});
    invalidate();
  };
  const wheel = (event) => {
    // Browser wheel events already contain the operating system's momentum tail.
    stopCoast();
    if(event.defaultPrevented || event.metaKey || event.isComposing || event.getModifierState?.('AltGraph') || waiting || modal() || !canNavigate())return;
    onNavigationIntent();
    if((presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || transitionDrag || gesture)cancel();
    const timeline = getTimeline();
    if (!timeline) return;
    event.preventDefault();
    const [,y] = point(event),layout=syncLayout(),unit=event.deltaMode===1?16:event.deltaMode===2?Math.max(1,layout.height-RULER):1;
    const deltaY=(event.deltaY || 0)*unit,deltaX=(event.deltaX || 0)*unit;
    if (event.altKey) {
      const oldScale=view.scale;
      view.scale = Math.max(
        MIN_TIMELINE_SCALE,
        Math.min(MAX_TIMELINE_SCALE, view.scale * Math.exp(-deltaY * 0.004)),
      );
      view.origin=Math.max(0,view.playhead-(view.playhead-view.origin)*oldScale/view.scale);
    } else if(event.ctrlKey)view.origin=Math.max(0,view.origin+(deltaX || deltaY)/((view.scale*timeline.fps.den)/timeline.fps.num));
    else if (event.shiftKey)view.rowHeight=Math.max(40,Math.min(160,layout.rowHeight*Math.exp(-deltaY/200)));
    else{
      const pane=layout.paneAtY(y);
      if(pane==='video')view.videoScroll-=deltaY;
      if(pane==='audio')view.audioScroll+=deltaY;
      view.origin=Math.max(0,view.origin+deltaX/((view.scale*timeline.fps.den)/timeline.fps.num));
    }
    view.origin=Math.max(0,Math.min(scrollBounds(timeline).maxOrigin,view.origin));
    syncLayout();
    invalidate();
  };
  const key = (event) => {
    stopCoast();
    if((presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active())){if(event.key==='Escape'){event.preventDefault?.();event.stopPropagation?.();cancel();}return;}
    if(handleSelectionKey(event))return;
    if(handleGapKey(event))return;
    if(!event.defaultPrevented && !event.repeat && !event.isComposing && !gesture && !transitionDrag && !waiting && view.retimeVisible?.size && view.tool!=='slip' && canEdit() && !isTextTarget(event.target) && !documentRef?.querySelector?.('dialog[open]') && !event.ctrlKey && !event.metaKey && !event.altKey && ((event.key==='F10' && event.shiftKey) || (event.key==='ContextMenu' && !event.shiftKey))){
      const timeline=getTimeline(),target=timeline?.tracks.flatMap(track=>track.clips.filter(clip=>view.selection.includes(clip.id) && clip.retime && !track.locked && view.retimeVisible.has(clip.id)).map(clip=>({clip,track})))[0];
      if(target){event.preventDefault?.();event.stopPropagation?.();onRetimeMenu({clip_id:target.clip.id,track_id:target.track.id,returnFocus:canvas});return;}
    }
    if(event.key!=='Escape' || isTextTarget(event.target) || documentRef?.querySelector?.('dialog[open]'))return;
    const active=Boolean(gesture || transitionDrag);
    if(transitionDrag || gesture?.fromTransitionBody || ['transition','retime','retime_menu','retime_close','transition_body','transition_copy'].includes(gesture?.kind) || (!active && (view.transitionSelection || view.selectedGap))){event.preventDefault?.();event.stopPropagation?.();}
    onNavigationIntent();
    cancel();
    if(!active && view.transitionSelection){view.transitionSelection=null;onTransitionSelect(null);invalidate();}
  };
  const pointerAbort=event=>{if(!gesture || (gesture.pointerId!==undefined && event?.pointerId!==undefined && event.pointerId!==gesture.pointerId))return;cancel();};
  const viewportChanged=event=>{
    const mapping=canvasMapping();
    // Inspector rebuilds can scroll a separate pane without changing Canvas coordinates.
    if(event?.type==='scroll' && mapping===viewportMapping && !modal() && !documentRef?.hidden)return;
    stopCoast();
    if((presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || transitionDrag || gesture)cancel();
    viewportMapping=mapping;syncLayout();invalidate();
  };
  const documentRef=canvas.ownerDocument ?? window.document;
  const visibilityChanged=()=>{if(documentRef?.hidden)viewportChanged();};
  const catalogTransition=(timeline,kind)=>['Push','CrossDissolve','SmoothCut'].includes(kind)?timeline?.transition_defaults?.find(item=>item.kind===kind):null;
  function startTransitionDrag(kind){
    const timeline=getTimeline(),transition=catalogTransition(timeline,kind);
    if(waiting || !canEdit() || !transition || documentRef?.querySelector?.('dialog[open]'))return false;
    onNavigationIntent();
    cancel();transitionDrag={catalogKind:kind,transition:structuredClone(transition),defaultsIdentity:JSON.stringify(transition),timeline,context:transitionContext(timeline)};return true;
  }
  function endTransitionDrag(){if(!transitionDrag)return;transitionDrag=null;if(view.draft?.kind==='transition_placement')view.draft=null;invalidate();}
  const transitionPayload=event=>Array.from(event.dataTransfer?.types || []).includes(TRANSITION_DRAG_TYPE);
  function currentTransitionDrag(){
    if(!transitionDrag)return false;
    if(!placementCurrent(transitionDrag) || JSON.stringify(catalogTransition(getTimeline(),transitionDrag.catalogKind))!==transitionDrag.defaultsIdentity){cancel();onNotice('Transition drop cancelled because the catalog, editing session or viewport changed');return false;}
    return true;
  }
  function dragOver(event){
    stopCoast();
    if(projectPoolDrop?.over(event))return;
    if(sourceDrop?.over(event))return;
    if(assetDrop?.over(event))return;
    if(presetDrop?.over(event))return;
    if(!transitionPayload(event) || !currentTransitionDrag())return;
    event.preventDefault();view.draft=placementAt(transitionDrag,...point(event));event.dataTransfer.dropEffect=view.draft.error?'none':'copy';invalidate();
  }
  const dragLeave=event=>{projectPoolDrop?.leave(event);sourceDrop?.leave(event);assetDrop?.leave(event);presetDrop?.leave(event);if(transitionDrag && event.relatedTarget!==canvas && view.draft?.kind==='transition_placement'){view.draft=null;invalidate();}};
  async function drop(event){
    if(projectPoolDrop?.hasType(event))return projectPoolDrop.drop(event);
    if(sourceDrop?.hasType(event))return sourceDrop.drop(event);
    if(assetDrop?.hasType(event))return assetDrop.drop(event);
    if(presetDrop?.hasType(event))return presetDrop.drop(event);
    if(!transitionPayload(event) || !currentTransitionDrag())return;
    event.preventDefault();
    let kind;try{kind=event.dataTransfer.getData(TRANSITION_DRAG_TYPE);}catch(error){cancel();onNotice(error.message);return;}
    if(kind!==transitionDrag.catalogKind){cancel();onNotice('The transition drop no longer matches its catalog source');return;}
    const draft=placementAt(transitionDrag,...point(event));transitionDrag=null;view.draft=draft;invalidate();
    await applyPlacement(draft);view.draft=null;invalidate();
  }
  const doubleClick = event => {
    const timeline = getTimeline(); if (!timeline || waiting || gesture || transitionDrag || (presetDrop?.active() || assetDrop?.active() || sourceDrop?.active() || projectPoolDrop?.active()) || modal() || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const hit = hitTest(...point(event),timeline,view,canvas.getBoundingClientRect().width);
    if(hit.marker){onMarkerEdit(hit.marker.id);return;}
    if(hit.clip && canNavigate()){event.preventDefault();onOpenCompound([hit.clip.id]);}
  };
  presetDrop=createPresetDrop({canvas,getTimeline,getPresetContext,view,invalidate,onCommand,onNotice,canEdit,getBusy:()=>waiting,setBusy:value=>waiting=value,cancelGesture:cancel});
  assetDrop=createAssetDrop({canvas,getTimeline,getAssetContext,view,invalidate,onNotice,canEdit,getBusy:()=>waiting,setBusy:value=>waiting=value,cancelGesture:cancel});
  sourceDrop=createSourceDrop({canvas,getTimeline,getAssetContext,view,invalidate,onNotice,canEdit,getBusy:()=>waiting,setBusy:value=>waiting=value,cancelGesture:cancel});
  projectPoolDrop=createProjectPoolDrop({canvas,getTimeline,getAssetContext,view,invalidate,onNotice,canEdit,getBusy:()=>waiting,setBusy:value=>waiting=value,cancelGesture:cancel});
  const endDrag=()=>{endTransitionDrag();presetDrop.dnd.end();assetDrop.dnd.end();sourceDrop.dnd.end();projectPoolDrop.dnd.end();};
  const assetKey=event=>{if((assetDrop.active() || sourceDrop.active() || projectPoolDrop.active()) && event.key==='Escape'){event.preventDefault?.();event.stopPropagation?.();cancel();}};
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", pointerAbort);
  canvas.addEventListener("lostpointercapture", pointerAbort);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("keydown", key);
  canvas.addEventListener("dblclick", doubleClick);
  canvas.addEventListener('dragover',dragOver);
  canvas.addEventListener('dragleave',dragLeave);
  canvas.addEventListener('drop',drop);
  window.addEventListener("blur", cancel);
  window.addEventListener('dragend',endDrag);
  window.addEventListener('resize',viewportChanged);
  window.addEventListener('scroll',viewportChanged,true);
  window.addEventListener('pointerdown',stopCoast,true);
  window.addEventListener('pointermove',stopCoast,true);
  window.addEventListener('keydown',stopCoast,true);
  window.addEventListener('keydown',assetKey);
  window.addEventListener('wheel',stopCoast,true);
  documentRef?.addEventListener('visibilitychange',visibilityChanged);
  return {
    cancel,
    closeGap,
    rippleDelete,
    selectGap,
    canCloseGap,
    handleGapKey,
    checkGapSelection,
    selectTimelineClips,
    selectClip,
    checkSelectionAnchor,
    canSelectTimeline,
    handleSelectionKey,
    transitionDnd:{type:TRANSITION_DRAG_TYPE,start:startTransitionDrag,end:endTransitionDrag},
    presetDnd:presetDrop.dnd,
    assetDnd:assetDrop.dnd,
    sourceDnd:sourceDrop.dnd,
    projectPoolDnd:projectPoolDrop.dnd,
    navigationIdle:()=>!gesture && !coast && !waiting && !transitionDrag && !presetDrop.active() && !assetDrop.active() && !sourceDrop.active() && !projectPoolDrop.active() && !view.draft && !view.lasso,
    checkPresetDrop:()=>presetDrop.current(),
    checkAssetDrop:()=>assetDrop.current(),
    checkSourceDrop:()=>sourceDrop.current(),
    checkProjectPoolDrop:()=>projectPoolDrop.current(),
    destroy() {
      cancel();
      presetDrop.destroy();
      assetDrop.destroy();
      sourceDrop.destroy();
      projectPoolDrop.destroy();
      for (const [event, fn] of [
        ["pointerdown", down],
        ["pointermove", move],
        ["pointerup", up],
        ["pointercancel", pointerAbort],
        ["lostpointercapture", pointerAbort],
        ["wheel", wheel],
        ["keydown", key],
        ["dblclick", doubleClick],
        ['dragover',dragOver],
        ['dragleave',dragLeave],
        ['drop',drop],
      ])
        canvas.removeEventListener(event, fn);
      window.removeEventListener("blur", cancel);
      window.removeEventListener('dragend',endDrag);
      window.removeEventListener('resize',viewportChanged);
      window.removeEventListener('scroll',viewportChanged,true);
      window.removeEventListener('pointerdown',stopCoast,true);
      window.removeEventListener('pointermove',stopCoast,true);
      window.removeEventListener('keydown',stopCoast,true);
      window.removeEventListener('keydown',assetKey);
      window.removeEventListener('wheel',stopCoast,true);
      documentRef?.removeEventListener('visibilitychange',visibilityChanged);
    },
  };
}
