import {createKeyframeNavigation,drawKeyframeHead,keyframeClock,keyframeTimeRange} from './keyframe-navigation.js';
import {renderKeyframeLanes,animatedKeyRows,KEYFRAME_LABEL_WIDTH} from './keyframe-lanes.js';
import {createCurveViewportReader,nativeCurveTimeViewport} from './curve-viewport.js';

export const keyPickIdentity=pick=>JSON.stringify([pick.target,pick.source_frame]);
export function createKeyPickSelection(openState,scope){
  const stateKey=`all-keys:${scope}`,stored=openState?.get(stateKey),listeners=new Set(),gestureListeners=new Set(),targetListeners=new Set();
  let picks=[],activeTarget=null;
  try{picks=(stored?.ids || (Array.isArray(stored)?stored:stored?.after || [])).map(id=>{const [target,source_frame]=JSON.parse(id);return {target,source_frame};});}catch{}
  const valid=values=>Array.isArray(values) && values.length<=2048 && values.every(pick=>pick?.target && typeof pick.target.kind==='string' && Number.isSafeInteger(pick.source_frame)) && new Set(values.map(keyPickIdentity)).size===values.length;
  if(!valid(picks))picks=[];
  const get=()=>structuredClone(picks);
  const set=(values,{focus=false}={})=>{
    if(!valid(values))throw Error('Choose at most 2048 distinct native keys');
    const changed=JSON.stringify(picks)!==JSON.stringify(values);picks=structuredClone(values);
    if(openState){openState.delete(stateKey);openState.set(stateKey,{ids:picks.map(keyPickIdentity),focus});const keys=[...openState.keys()].filter(key=>key.startsWith('all-keys:'));for(const key of keys.slice(0,Math.max(0,keys.length-32)))openState.delete(key);}
    if(changed)for(const listener of listeners)listener();
  };
  return {get,set,replace(before,after,options){const removed=new Set(before.map(keyPickIdentity));set([...new Map([...picks.filter(pick=>!removed.has(keyPickIdentity(pick))),...after].map(pick=>[keyPickIdentity(pick),pick])).values()],options);},select(pick,additive=false){const exists=picks.some(value=>keyPickIdentity(value)===keyPickIdentity(pick));set(additive || exists?(exists?picks:[...picks,pick]):[pick]);},activate(target){activeTarget=structuredClone(target);for(const listener of targetListeners)listener(structuredClone(activeTarget));},subscribeTarget(listener){targetListeners.add(listener);return ()=>targetListeners.delete(listener);},beginGesture(){for(const listener of gestureListeners)listener();},onGesture(listener){gestureListeners.add(listener);return ()=>gestureListeners.delete(listener);},subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}};
}
export function pointerKeyOperation(clip,picks,delta,grabbed=null,linkZoom=false){
  if(!Array.isArray(picks) || !picks.length || picks.length>2048 || picks.some(pick=>!pick?.target || !Number.isSafeInteger(pick.source_frame)) || new Set(picks.map(keyPickIdentity)).size!==picks.length || !Number.isSafeInteger(delta))throw Error('Choose distinct native keys and an integer frame delta');
  if(grabbed && (!Number.isFinite(grabbed.value) || !picks.some(pick=>keyPickIdentity(pick)===keyPickIdentity(grabbed))))throw Error('Drag a selected native scalar key');
  return {kind:'edit_key_selection',clip_id:clip,edit:{picks:structuredClone(picks),link_zoom:Boolean(linkZoom),action:grabbed?{kind:'drag',delta_source_frames:delta,grabbed:structuredClone(grabbed)}:{kind:'move',delta_source_frames:delta}}};
}
export function pointerCurveDraft(curve,frames,grabbed,point){
  const selected=new Set(frames),delta=Math.round(point.frame-grabbed.source_frame),value=Math.max(curve.min,Math.min(curve.max,point.value));
  return {deltaFrame:delta,value,keys:curve.keys.filter(key=>selected.has(key.source_frame)).map(key=>({...key,source_frame:key.source_frame+delta,value:key.source_frame===grabbed.source_frame?value:key.value}))};
}

export function zoomParameters(param,linked=false){return linked && ["ZoomX","ZoomY"].includes(param)?[param,param==="ZoomX"?"ZoomY":"ZoomX"]:[param];}
export function createZoomLink(openState){
  let value=Boolean(openState?.get("zoom-link"));const inputs=new Set();
  return {get:()=>value,register(input){input.checked=value;inputs.add(input);input.addEventListener("change",()=>{value=input.checked;openState?.set("zoom-link",value);for(const other of inputs)other.checked=value;});}};
}
export function createKeyEditorGuard({root,section,disabled,canInteract=()=>true,commit}){
  let disposed=false,pending=false;
  const current=()=>!disposed && !disabled && root.isConnected!==false && section.isConnected!==false && canInteract();
  return {current,dispose(){disposed=true;},async commit(operation){
    if(pending || !current())throw Error('Key editor context changed; read its current native keys before editing');
    pending=true;
    try{await Promise.resolve();if(!current())throw Error('Key editor context changed; read its current native keys before editing');return await commit(operation);}
    finally{pending=false;}
  }};
}
export function curveKeyOperation(clip, target, previous, frame, value, mode, handles,linkZoom=false) {
  if (!Number.isSafeInteger(frame) || (value !== null && frame < 0)) throw new Error("Choose a nonnegative integer source frame for a new or moved key");
  if (value !== null && !Number.isFinite(value)) throw new Error("Choose a finite keyframe value");
  return {kind: "edit_curve_key", clip_id: clip, edit: {target, previous_source_frame: previous, source_frame: frame, value, interpolation:curveInterpolation(mode,handles),...(linkZoom && zoomParameters(target.param,true).length===2?{link_zoom:true}:{})}};
}
export function curveInterpolation(mode,handles) {
  let interpolation = mode;
  if (mode === "Bezier") {
    if (handles.length !== 4 || handles.some((v, i) => !Number.isFinite(v) || v < (i % 2 ? -10 : 0) || v > (i % 2 ? 10 : 1))) throw new Error("Bezier X must be 0–1 and Y must be −10–10");
    interpolation = {Bezier: {c1: handles.slice(0, 2), c2: handles.slice(2)}};
  } else if (!["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut"].includes(mode)) throw new Error("Choose a native interpolation");
  return interpolation;
}
export function retainedKeySelection(stored,frames,fallback=[]) {
  const available=new Set(frames);
  const selected=Array.isArray(stored)?stored:stored?.before?.length && stored.before.every(frame=>available.has(frame))?stored.before:stored?.after || fallback;
  return [...new Set(selected.filter(frame=>available.has(frame)))];
}

export function curveGroupOperation(clip,target,frames,deltaFrame,deltaValue,deleting=false,linkZoom=false) {
  if(!frames.length || frames.length>2048 || new Set(frames).size!==frames.length || frames.some(frame=>!Number.isSafeInteger(frame)) || !Number.isSafeInteger(deltaFrame) || !Number.isFinite(deltaValue))throw Error("Choose distinct native keys and finite frame/value deltas");
  return {kind:"edit_curve_keys",clip_id:clip,edit:{target,source_frames:frames,delta_source_frames:deltaFrame,delta_value:deltaValue,delete:deleting,...(linkZoom && zoomParameters(target.param,true).length===2?{link_zoom:true}:{})}};
}
export function curveGroupDraft(curve,range,frames,deltaFrame,deltaValue) {
  const selected=new Set(frames),keys=curve.keys.filter(key=>selected.has(key.source_frame));
  if(!keys.length)return null;
  const df=Math.max(range.source_start-Math.min(...keys.map(key=>key.source_frame)),Math.min(range.source_end-Math.max(...keys.map(key=>key.source_frame)),Math.round(deltaFrame)));
  const dv=Math.max(curve.min-Math.min(...keys.map(key=>key.value)),Math.min(curve.max-Math.max(...keys.map(key=>key.value)),deltaValue));
  return {deltaFrame:df,deltaValue:dv,keys:keys.map(key=>({...key,source_frame:key.source_frame+df,value:key.value+dv}))};
}
export function curveViewport(range,full,curve,g,{zoomX=1,zoomY=1,panX=0,panY=0}={}) {
  const span=Math.max(1,Math.min(full.source_end-full.source_start,(range.source_end-range.source_start)/zoomX));
  const center=(range.source_start+range.source_end)/2+panX;
  const start=Math.max(full.source_start,Math.min(full.source_end-span,Math.round(center-span/2)));
  const time={...range,source_start:start,source_end:Math.max(start,Math.min(full.source_end,Math.round(start+span)))};
  if(zoomY===1 && panY===0)return time;
  const height=Math.max(1e-6,Math.min(curve.max-curve.min,(g.max-g.min)/zoomY));
  const middle=(g.min+g.max)/2+panY;
  const min=Math.max(curve.min,Math.min(curve.max-height,middle-height/2));
  return {...time,value_min:min,value_max:min+height};
}

export function curveHandles(curve, selected) {
  const frames=new Set(selected instanceof Set || Array.isArray(selected)?selected:selected===null?[]:[selected]),segments=new Map();
  for(const [index,key] of curve.keys.entries())if(frames.has(key.source_frame)){
    for(const [start,end] of [[key.previous_key??curve.keys[index-1],key],[key,key.next_key??curve.keys[index+1]]])if(start?.controls?.length===2 && end && end.source_frame>start.source_frame)segments.set(start.source_frame,{start,end});
  }
  return [...segments.values()].sort((a,b)=>a.start.source_frame-b.start.source_frame).flatMap(({start,end})=>start.controls.map((point,index)=>({index,segment_frame:start.source_frame,point,start,end,frame:start.source_frame+(end.source_frame-start.source_frame)*point[0],value:start.value+(end.value-start.value)*point[1]})));
}
export function curveHandleOperation(clip,target,handle,point,linkZoom=false){
  const controls=handle.start.controls.map(value=>[...value]);controls[handle.index]=[...point];
  return {kind:'edit_key_selection',clip_id:clip,edit:{picks:[{target,source_frame:handle.start.source_frame}],link_zoom:Boolean(linkZoom),action:{kind:'interpolation',interpolation:curveInterpolation('Bezier',controls.flat())}}};
}

export function curveGeometry(curve, range, width, height, selected = null, left = 42) {
  const values = [...curve.samples.map((p) => p[1]), ...curve.keys.filter((k) => k.source_frame >= range.source_start && k.source_frame <= range.source_end).map((k) => k.value)];
  values.push(...curveHandles(curve, selected).map((p) => p.value));
  if(!values.length)values.push(Number.isFinite(curve.default)?curve.default:0);
  let min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * 0.1, Math.abs(min) * 0.02, 0.01);
  min -= padding; max += padding;
  if(Number.isFinite(range.value_min) && Number.isFinite(range.value_max) && range.value_max>range.value_min){min=range.value_min;max=range.value_max;}
  const top = 12, plotWidth = Math.max(1, width - left - 12), plotHeight = Math.max(1, height - top - 28);
  return {min, max, left, top, plotWidth, plotHeight,
    x: (frame) => left + (frame - range.source_start) / Math.max(1, range.source_end - range.source_start) * plotWidth,
    y: (value) => top + (max - value) / (max - min) * plotHeight,
    frame: (x) => Math.round(range.source_start + Math.max(0, Math.min(1, (x - left) / plotWidth)) * (range.source_end - range.source_start)),
    value: (y) => Math.max(curve.min, Math.min(curve.max, max - (y - top) / plotHeight * (max - min))),
    control: (handle, x, y) => [Math.max(0, Math.min(1, (range.source_start + (x - left) / plotWidth * (range.source_end - range.source_start) - handle.start.source_frame) / (handle.end.source_frame - handle.start.source_frame))), Math.max(-10, Math.min(10, handle.end.value === handle.start.value ? handle.point[1] : (max - (y - top) / plotHeight * (max - min) - handle.start.value) / (handle.end.value - handle.start.value)))]};
}

export function bindCurveGesture(canvas, {getCurve, getGeometry, getHandles = () => [], getSelection=()=>null,getSelectionIdentity=()=>null, isBusy, canEdit,canInteract=()=>true,beforeBegin=()=>{}, select, selectBox=()=>{}, draftBox=()=>{}, pan=()=>{}, draft, draftHandle, finish, reset}) {
  let gesture = null;
  const available=()=>canvas.isConnected!==false && !isBusy() && canInteract();
  const viewport=()=>{const rect=canvas.getBoundingClientRect();return JSON.stringify([rect.left,rect.top,rect.width,rect.height]);};
  const cancel = () => { if (gesture) { const before=gesture;gesture = null; reset();try{canvas.releasePointerCapture(before.id);}catch{} } };
  function updatePoint(event){
    const box=canvas.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
    if(gesture.moved && x===gesture.lastX && y===gesture.lastY)return;
    if(!gesture.moved && Math.hypot(x-gesture.x,y-gesture.y)<3)return;
    gesture.moved=true;gesture.lastX=x;gesture.lastY=y;
    if(gesture.box || gesture.pan){gesture.point={x,y};if(gesture.box)draftBox({x:Math.min(x,gesture.x),y:Math.min(y,gesture.y),width:Math.abs(x-gesture.x),height:Math.abs(y-gesture.y)});else pan({frames:gesture.g.frame(gesture.x)-gesture.g.frame(x),value:gesture.g.value(gesture.y)-gesture.g.value(y),final:false});}
    else if(gesture.handle){gesture.point=gesture.g.control(gesture.handle,x,y);draftHandle(gesture.handle.index,gesture.point,gesture.handle);}
    else{gesture.point={frame:gesture.g.frame(gesture.g.x(gesture.key.source_frame)+x-gesture.x),value:gesture.g.value(y)};draft(gesture.point,gesture.members);}
  }
  canvas.addEventListener("pointerdown", (event) => {
    const g = getGeometry(); if (gesture || !available() || event.isPrimary===false || ![0,1].includes(event.button) || !g) return;
    beforeBegin();
    const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    if(event.button===1 || event.altKey){canvas.focus();canvas.setPointerCapture(event.pointerId);gesture={id:event.pointerId,pan:true,g,x,y,viewport:viewport(),selectionIdentity:getSelectionIdentity(),moved:false,point:{x,y}};return;}
    const handle = getHandles().find((h) => Math.hypot(g.x(h.frame) - x, g.y(h.value) - y) <= 9);
    if (handle && canEdit()) {
      canvas.focus(); canvas.setPointerCapture(event.pointerId);
      gesture = {id: event.pointerId, handle, g, x, y,viewport:viewport(),selectionIdentity:getSelectionIdentity(), moved: false, point: handle.point}; return;
    }
    const key = getCurve().keys.find((k) => Math.hypot(g.x(k.source_frame) - x, g.y(k.value) - y) <= 10);
    if(!key){canvas.focus();canvas.setPointerCapture(event.pointerId);gesture={id:event.pointerId,box:true,append:event.ctrlKey || event.metaKey || event.shiftKey,g,x,y,viewport:viewport(),selectionIdentity:getSelectionIdentity(),moved:false,point:{x,y}};return;}
    canvas.focus(); select(key,{toggle:event.ctrlKey || event.metaKey || event.shiftKey});
    const members=getSelection();if(members && !members.includes(key.source_frame))return;
    if (!canEdit()) return;
    canvas.setPointerCapture(event.pointerId);
    gesture = {id: event.pointerId, key, members,selectionIdentity:getSelectionIdentity(),viewport:viewport(), g, x, y, moved: false, point: {frame: key.source_frame, value: key.value}};
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if(!available() || gesture.viewport!==viewport() || gesture.selectionIdentity!==getSelectionIdentity() || !gesture.box && !gesture.pan && !canEdit()){cancel();return;}
    updatePoint(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if(!available() || gesture.viewport!==viewport() || gesture.selectionIdentity!==getSelectionIdentity() || !gesture.box && !gesture.pan && !canEdit()){cancel();return;}
    const x=event.clientX-canvas.getBoundingClientRect().left,y=event.clientY-canvas.getBoundingClientRect().top;
    if(gesture.moved || Math.hypot(x-gesture.x,y-gesture.y)>=3)updatePoint(event);
    const before = gesture; gesture = null; canvas.releasePointerCapture(event.pointerId);
    if(before.pan){pan({final:true});return;}
    if(before.box){selectBox({start:before.g.frame(Math.min(before.x,before.point.x)),end:before.g.frame(Math.max(before.x,before.point.x)),min:Math.min(before.g.value(before.y),before.g.value(before.point.y)),max:Math.max(before.g.value(before.y),before.g.value(before.point.y)),append:before.append,moved:before.moved});return;}
    const changed = before.handle ? before.point.some((v, i) => v !== before.handle.point[i]) : before.point.frame !== before.key.source_frame || before.point.value !== before.key.value;
    if (before.moved && changed) finish(before.point,before.members,before.handle); else reset();
  });
  canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); cancel(); } });
  return {cancel};
}

export function renderCurves(root, detail, {disabled, commit, notice, openState, scope=detail.clip_id,zoomLink=createZoomLink(openState),canInteract,canNavigate=canInteract,navigateSource,readCurveViewport,seek,keySelection,presentation='inline'}) {
  const range = detail.curves;
  if (!range?.tracks.length) return null;
  const timeRange=keyframeTimeRange(detail,range);
  const fullViewport=()=>({source_start:timeRange.source_start,source_end:timeRange.source_end});
  function remember(key,value){
    if(!openState)return;
    openState.delete(key);openState.set(key,value);
    const retained=[...openState.keys()].filter(key=>key.startsWith("curves-group:") || key.startsWith("curves-viewport:"));
    for(const old of retained.slice(0,Math.max(0,retained.length-128)))openState.delete(old);
  }
  const section = document.createElement("details"), summary = document.createElement("summary");
  section.className = "curve-editor";
  section.dataset.visualPath = "curves"; section.open = presentation==='window' || openState?.get("curves") || false;
  summary.textContent = "Curves and keyframe editor"; section.append(summary);
  const note = document.createElement("p"); note.className = "muted";
  note.textContent = `Source frames ${range.source_start}–${range.source_end}. Native sampled curves; interpolation belongs to the outgoing key. Shift/Ctrl-click or box-select keys, then drag or edit group deltas. Alt/middle-drag pans; wheel zooms time, Shift-wheel zooms values. Each edit is one Undo. Escape cancels a draft.`;
  section.append(note);
  const tracks = document.createElement("select"); tracks.className='curve-parameter';tracks.setAttribute("aria-label", "Curve parameter");
  range.tracks.forEach((curve, index) => tracks.append(new Option(`${curve.name} (${curve.key_count} keys)`, String(index))));
  const storedTarget=range.tracks.findIndex(c=>JSON.stringify(c.target)===openState?.get('curves-target'));
  tracks.value=String(storedTarget>=0?storedTarget:Math.max(0,range.tracks.findIndex(c=>c.key_count>0)));
  section.append(tracks);
  if(detail.video){const label=document.createElement("label"),input=document.createElement("input");input.type="checkbox";input.disabled=disabled;zoomLink.register(input);label.title='Link Zoom X/Y values and key times';label.append(input,presentation==='window'?' Link Zoom X/Y':" Link Zoom X/Y values and key times");section.append(label);}
  const viewportTools=document.createElement("div");viewportTools.className="tools curve-viewport-tools";
  for(const [label,change] of [["Zoom curve time in",{zoomX:2}],["Zoom curve time out",{zoomX:0.5}],["Zoom curve values in",{zoomY:2}],["Zoom curve values out",{zoomY:0.5}],["Pan curve left",{direction:-1}],["Pan curve right",{direction:1}],["Pan curve values up",{valueDirection:1}],["Pan curve values down",{valueDirection:-1}],["Fit curve",null]]){
    const button=document.createElement("button");button.type="button";button.textContent=({'Zoom curve time in':'Time +','Zoom curve time out':'Time −','Zoom curve values in':'Value +','Zoom curve values out':'Value −','Pan curve left':'←','Pan curve right':'→','Pan curve values up':'↑','Pan curve values down':'↓','Fit curve':'Fit'})[label];button.setAttribute('aria-label',label);button.title=label;button.addEventListener("click",()=>{if(waiting || !geometry || !canRead())return;drag.cancel();navigation?.cancel();reader?.cancel();if(!change)viewRange=fullViewport();else if(change.zoomX || change.direction)viewRange=nativeCurveTimeViewport(viewRange,timeRange,geometry,{zoom:change.zoomX || 1,pan:-(change.direction || 0)*geometry.plotWidth/4});else if(!noScalar)viewRange=curveViewport(viewRange,timeRange,current(),geometry,{...change,panY:(change.valueDirection || 0)*(geometry.max-geometry.min)/4});rememberViewport();draw();});viewportTools.append(button);
  }
  section.append(viewportTools);
  const viewportStatus=document.createElement("p");viewportStatus.className="muted";viewportStatus.dataset.curveViewport="";section.append(viewportStatus);
  const canvas = document.createElement("canvas"); canvas.className = "curve-graph"; canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Native keyframe curve. Select keys below for keyboard editing."); section.append(canvas);
  const status = document.createElement("p"); status.className = "muted"; status.setAttribute("aria-live", "polite"); section.append(status);
  const select = document.createElement("select"); select.setAttribute("aria-label", "Curve keyframe"); section.append(select);
  const form = document.createElement("form"), fields = {};
  function number(name, key, min, max, step = "any") {
    const label = document.createElement("label"); label.className = "field"; label.textContent = name;
    const input = document.createElement("input"); input.type = "number"; input.required = true;
    input.min = min; input.max = max; input.step = step; input.disabled = disabled; fields[key] = input;
    label.append(input); form.append(label); return input;
  }
  const frame = number("Key source frame", "frame", range.source_start, range.source_end, 1);
  const value = number("Key value", "value", 0, 1);
  const mode = document.createElement("select"); mode.setAttribute("aria-label", "Curve interpolation"); mode.disabled = disabled;
  for (const name of ["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut", "Bezier"]) mode.append(new Option(name, name)); form.append(mode);
  const handles = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = "Normalized Bezier controls"; handles.append(legend);
  for (const [i, key] of ["c1x", "c1y", "c2x", "c2y"].entries()) {
    const input = number(`Bezier ${key}`, key, i % 2 ? -10 : 0, i % 2 ? 10 : 1);
    handles.append(input.parentElement);
  }
  form.append(handles);
  const apply = document.createElement("button"); apply.textContent = "Apply curve key"; apply.disabled = disabled; form.append(apply);
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete curve key"; form.append(remove);
  const duplicate = document.createElement("button"); duplicate.type = "button"; duplicate.textContent = "Duplicate as new key"; form.append(duplicate);
  section.append(form); root.append(section);
  const groupForm=document.createElement("form"),groupKeys=document.createElement("select");groupKeys.multiple=true;groupKeys.size=4;groupKeys.setAttribute("aria-label","Selected curve keys");groupForm.append(groupKeys);
  const groupFields={};
  for(const [label,key,step] of [["Selected keys frame delta","frame",1],["Selected keys value delta","value","any"]]){
    const row=document.createElement("label");row.className="field";row.textContent=label;const input=document.createElement("input");input.type="number";input.step=step;input.value="0";input.required=true;input.disabled=disabled;row.append(input);groupForm.append(row);groupFields[key]=input;
  }
  const groupApply=document.createElement("button");groupApply.textContent="Move selected keys";groupForm.append(groupApply);
  const groupRemove=document.createElement("button");groupRemove.type="button";groupRemove.textContent="Delete selected keys";groupForm.append(groupRemove);section.append(groupForm);
  let drafting = false, handleDraft = null, geometry = null, waiting = false, disposed = false,navigation=null,lanes=null,noScalar=null,keyValues=null;
  const owner=createKeyEditorGuard({root,section,disabled,canInteract,commit});
  let selectedFrames=new Set(),groupDraft=null,boxDraft=null,viewRange=fullViewport(),panOrigin=null;
  const events = new AbortController();
  const current = () => range.tracks[Number(tracks.value)];
  const canRead=()=>!disposed && section.open && root.isConnected!==false && section.isConnected!==false && !document.hidden && !document.querySelector?.('dialog[open]') && (canNavigate?.() ?? true);
  const reader=typeof readCurveViewport==='function'?createCurveViewportReader({detail,read:readCurveViewport,canRead:()=>canRead() && !waiting && !panOrigin && !handleDraft && !drafting && !boxDraft,onChange:draw,notice}):null;
  const previous = () => select.value === "" ? null : Number(select.value);
  const selectionKey=()=>`curves-group:${scope}:${detail.key_page?.index ?? 0}:${JSON.stringify(current().target)}`;
  const viewportKey=()=>`curves-viewport:${scope}:${JSON.stringify(current().target)}`;
  const rememberViewport=()=>remember(viewportKey(),viewRange);
  function updateGroup(){
    for(const option of groupKeys.options)option.selected=selectedFrames.has(Number(option.value));
    groupApply.disabled=groupRemove.disabled=disabled || waiting || !selectedFrames.size;
    const frames=[...selectedFrames];remember(selectionKey(),openState?.get(selectionKey())?.focus?{before:frames,after:frames,focus:true}:frames);
  }
  function draw() {
    if (disposed || !section.open) return;
    const box = canvas.getBoundingClientRect(); if (!box.width) return;
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext("2d"), style = getComputedStyle(canvas); ctx.scale(ratio, ratio);
    const color = (key) => style.getPropertyValue(key).trim();
    ctx.fillStyle = color("--bg"); ctx.fillRect(0, 0, box.width, box.height);
    const plotWidth=Math.max(1,Math.min(box.width,lanes?.width() || box.width)-(keySelection && animatedKeyRows(detail).length?KEYFRAME_LABEL_WIDTH:42)-12);
    const sampleQuery={target:current().target,source_start:viewRange.source_start,source_end:viewRange.source_end,points:Math.max(2,Math.min(2048,Math.ceil(plotWidth)+1))},sampleIdentity=[detail.project_epoch,detail.generation,detail.timeline_id,detail.revision,detail.clip_id];
    const native=reader && !noScalar && canRead()?panOrigin || handleDraft || drafting || boxDraft?reader.peek(sampleQuery,sampleIdentity):reader.request(sampleQuery,sampleIdentity):null;
    const visibleCurve={...current(),keys:noScalar?[]:current().keys,samples:noScalar?[]:reader?native?.samples || []:current().samples};
    form.hidden=groupForm.hidden=select.hidden=Boolean(noScalar);if(keyValues)keyValues.hidden=Boolean(noScalar);
    geometry = (handleDraft || drafting || boxDraft) && geometry ? geometry : curveGeometry(visibleCurve, viewRange, Math.min(box.width,lanes?.width() || box.width), box.height, selectedFrames,keySelection && animatedKeyRows(detail).length?KEYFRAME_LABEL_WIDTH:42);
    const g = geometry; ctx.font = "10px sans-serif";
    viewportStatus.textContent=noScalar?`No scalar curve for ${noScalar.kind} · use its event key editor`:`View source ${viewRange.source_start}–${viewRange.source_end} · values ${g.min.toPrecision(4)}–${g.max.toPrecision(4)} · ${selectedFrames.size} selected keys${reader && !native?reader.pending()?' · reading native viewport':' · native viewport unavailable':''}`;
    for (let i = 0; i <= 4; i++) {
      const y = g.top + g.plotHeight * i / 4;
      ctx.strokeStyle = color("--border"); ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.left + g.plotWidth, y); ctx.stroke();
      ctx.fillStyle = color("--muted"); ctx.fillText((g.max - (g.max - g.min) * i / 4).toPrecision(3), 1, y + 4);
    }
    ctx.fillStyle = color("--muted"); ctx.fillText(String(viewRange.source_start), g.left, box.height - 6);
    ctx.textAlign = "right"; ctx.fillText(String(viewRange.source_end), g.left + g.plotWidth, box.height - 6); ctx.textAlign = "left";
    ctx.save();ctx.beginPath();ctx.rect(g.left,g.top,g.plotWidth,g.plotHeight);ctx.clip();
    ctx.strokeStyle = color("--primary"); ctx.lineWidth = 1.5; ctx.beginPath();
    visibleCurve.samples.forEach(([frame, value], index) => { if (index) ctx.lineTo(g.x(frame), g.y(value)); else ctx.moveTo(g.x(frame), g.y(value)); }); ctx.stroke();
    for (const handle of noScalar?[]:curveHandles(current(), selectedFrames)) {
      if (handle.end.source_frame < viewRange.source_start || handle.start.source_frame > viewRange.source_end) continue;
      const point = handleDraft?.segment_frame===handle.segment_frame && handleDraft.index===handle.index ? handleDraft.point : handle.point;
      const x = g.x(handle.start.source_frame + (handle.end.source_frame - handle.start.source_frame) * point[0]);
      const y = g.y(handle.start.value + (handle.end.value - handle.start.value) * point[1]);
      const end = handle.index ? handle.end : handle.start;
      ctx.strokeStyle = color("--violet"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.x(end.source_frame), g.y(end.value)); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = color("--violet"); ctx.fill();
    }
    for (const key of visibleCurve.keys) {
      if (key.source_frame < range.source_start || key.source_frame > range.source_end) continue;
      ctx.fillStyle = color(selectedFrames.has(key.source_frame) ? "--text" : "--primary");
      ctx.beginPath(); ctx.arc(g.x(key.source_frame), g.y(key.value), 4, 0, Math.PI * 2); ctx.fill();
    }
    if(groupDraft){for(const key of groupDraft.keys){ctx.strokeStyle=color("--amber");ctx.lineWidth=2;ctx.beginPath();ctx.arc(g.x(key.source_frame),g.y(key.value),6,0,Math.PI*2);ctx.stroke();}}
    else if (drafting) {
      ctx.strokeStyle = color("--amber"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x(Number(frame.value)), g.y(Number(value.value)), 6, 0, Math.PI * 2); ctx.stroke();
    }
    if(boxDraft){ctx.strokeStyle=color("--violet");ctx.strokeRect(boxDraft.x,boxDraft.y,boxDraft.width,boxDraft.height);}
    drawKeyframeHead(ctx,g,detail,{sourceFrame:navigation?.sourceFrame(),color:color('--primary')});
    ctx.restore();
    lanes?.refresh();
    navigation?.refresh();
  }
  function load() {
    const key = current().keys.find((k) => k.source_frame === previous());
    frame.value = key?.source_frame ?? Math.max(range.source_start, Math.min(range.source_end, detail.source_frame));
    value.min = current().min; value.max = current().max; value.value = key?.value ?? current().default;
    const interpolation = key?.interpolation || "Linear";
    mode.value = typeof interpolation === "string" ? interpolation : "Bezier";
    const points = key?.controls?.flat() || [1/3, 1/3, 2/3, 2/3];
    ["c1x", "c1y", "c2x", "c2y"].forEach((key, index) => { fields[key].value = points[index]; });
    handles.hidden = mode.value !== "Bezier"; handles.disabled = mode.value !== "Bezier" || disabled;
    remove.disabled = duplicate.disabled = disabled || !key;
    status.textContent = key ? `Source ${key.source_frame} · timeline ${key.timeline_frame} · ${current().name}` : "New keyframe · choose a free source frame";
    openState?.set("curves-key", select.value); draw();
    updateGroup();
  }
  function chooseCurve() {
    select.replaceChildren(new Option("New keyframe", ""));
    current().keys.forEach((key) => select.append(new Option(`Source ${key.source_frame} · ${key.value} · timeline ${key.timeline_frame}`, String(key.source_frame))));
    select.value = [...select.options].some((o) => o.value === openState?.get("curves-key")) ? openState.get("curves-key") : "";
    openState?.set("curves-target", JSON.stringify(current().target));
    const storedViewport=openState?.get(viewportKey());
    viewRange=storedViewport && Number.isSafeInteger(storedViewport.source_start) && Number.isSafeInteger(storedViewport.source_end) && storedViewport.source_end>=storedViewport.source_start?nativeCurveTimeViewport(storedViewport,timeRange,{left:0,plotWidth:1}):fullViewport();
    groupKeys.replaceChildren(...current().keys.map(key=>new Option(`Source ${key.source_frame} · ${key.value}`,String(key.source_frame))));
    const stored=openState?.get(selectionKey());
    selectedFrames=new Set(keySelection?keySelection.get().filter(pick=>JSON.stringify(pick.target)===JSON.stringify(current().target)).map(pick=>pick.source_frame):retainedKeySelection(stored,current().keys.map(key=>key.source_frame),previous()===null?[]:[previous()]));
    if(previous()===null && selectedFrames.size)select.value=String([...selectedFrames][0]);
    load();
    if(openState?.get(selectionKey())?.focus && !disabled && section.open){remember(selectionKey(),[...selectedFrames]);queueMicrotask(()=>{if(!disposed && canvas.isConnected && document.activeElement===document.body)canvas.focus({preventScroll:true});});}
    if (current().key_count > current().keys.length) status.textContent += ` · ${current().keys.length} of ${current().key_count} keys on this page`;
  }
  async function save(deleting = false) {
    if (noScalar || waiting || !owner.current() || (!deleting && !form.reportValidity())) return;
    const before=previous()===null?[]:[previous()],sharedBefore=keySelection?.get();let sharedAfter=null;
    try {
      const operation = curveKeyOperation(detail.clip_id, current().target, previous(), Number(frame.value), deleting ? null : Number(value.value), mode.value, ["c1x", "c1y", "c2x", "c2y"].map((key) => Number(fields[key].value)),zoomLink.get());
      waiting = true; form.inert = true; tracks.disabled = select.disabled = true;
      openState?.set("curves-key", deleting ? "" : frame.value);
      remember(selectionKey(),{before,after:deleting?[]:[Number(frame.value)],focus:true});
      keySelection?.replace(before.map(source_frame=>({target:current().target,source_frame})),deleting?[]:[{target:current().target,source_frame:Number(frame.value)}],{focus:true});sharedAfter=keySelection?.get();
      await owner.commit(operation);
    } catch (error) { if(keySelection && JSON.stringify(keySelection.get())===JSON.stringify(sharedAfter))keySelection.set(sharedBefore,{focus:true});notice(error.message);if(!disposed)load();remember(selectionKey(),{before,after:before,focus:true});if(!disposed && canvas.isConnected)canvas.focus({preventScroll:true}); }
    finally { waiting = false; form.inert = false; tracks.disabled = select.disabled = false; }
  }
  async function saveGroup(deleting=false,deltaFrame=Number(groupFields.frame.value),deltaValue=Number(groupFields.value.value)){
    if(noScalar || waiting || !owner.current() || !selectedFrames.size || (!deleting && !groupForm.reportValidity()))return;
    const before=[...selectedFrames],sharedBefore=keySelection?.get();let sharedAfter=null;
    try{
      const operation=curveGroupOperation(detail.clip_id,current().target,before,deleting?0:deltaFrame,deleting?0:deltaValue,deleting,zoomLink.get());
      waiting=true;groupForm.inert=form.inert=true;tracks.disabled=select.disabled=true;
      remember(selectionKey(),{before,after:deleting?[]:before.map(frame=>frame+deltaFrame),focus:true});
      keySelection?.replace(before.map(source_frame=>({target:current().target,source_frame})),deleting?[]:before.map(source_frame=>({target:current().target,source_frame:source_frame+deltaFrame})),{focus:true});sharedAfter=keySelection?.get();
      await owner.commit(operation);
    }catch(error){if(keySelection && JSON.stringify(keySelection.get())===JSON.stringify(sharedAfter))keySelection.set(sharedBefore,{focus:true});remember(selectionKey(),{before,after:before,focus:true});notice(error.message);if(!disposed && canvas.isConnected)canvas.focus({preventScroll:true});}
    finally{waiting=false;groupForm.inert=form.inert=false;tracks.disabled=select.disabled=false;}
  }
  async function savePointer(point){
    if(waiting || !owner.current() || noScalar && point!==null)return;
    const target=current().target,source_frame=previous(),before=keySelection?.get() || [...selectedFrames].map(source_frame=>({target,source_frame})),deleting=point===null,delta=deleting?0:Math.round(point.frame-source_frame),grabbed=deleting?null:{target,source_frame,value:Math.max(current().min,Math.min(current().max,point.value))};
    if(!before.length || !deleting && !delta && current().keys.find(key=>key.source_frame===source_frame)?.value===grabbed.value)return;
    const after=deleting?[]:before.map(pick=>({...pick,source_frame:pick.source_frame+delta}));
    try{const operation=pointerKeyOperation(detail.clip_id,before,delta,grabbed,zoomLink.get());if(deleting)operation.edit.action={kind:'delete'};waiting=true;form.inert=groupForm.inert=true;keySelection?.set(after,{focus:true});remember(selectionKey(),{before:[...selectedFrames],after:after.filter(pick=>JSON.stringify(pick.target)===JSON.stringify(target)).map(pick=>pick.source_frame),focus:true});await owner.commit(operation);}
    catch(error){if(!keySelection || JSON.stringify(keySelection.get())===JSON.stringify(after))keySelection?.set(before,{focus:true});notice(error.message);}
    finally{waiting=false;form.inert=groupForm.inert=false;}
  }
  async function saveHandle(handle,point){
    if(noScalar || waiting || !owner.current() || point.every((value,index)=>value===handle.point[index]))return;
    try{const operation=curveHandleOperation(detail.clip_id,current().target,handle,point,zoomLink.get());waiting=true;form.inert=groupForm.inert=true;await owner.commit(operation);}
    catch(error){if(!disposed)notice(error.message);}
    finally{waiting=false;if(!disposed && section.isConnected!==false){form.inert=groupForm.inert=false;load();}}
  }
  const drag = bindCurveGesture(canvas, {
    getCurve: () => ({keys: noScalar?[]:current().keys.filter((k) => k.source_frame >= Math.max(range.source_start,viewRange.source_start) && k.source_frame <= Math.min(range.source_end,viewRange.source_end))}),
    getGeometry: () => geometry, isBusy: () => waiting, canEdit: () => !noScalar && owner.current(),canInteract:()=>!noScalar && canRead(),
    beforeBegin:()=>{reader?.pause();navigation?.cancel();keySelection?.beginGesture();},
    getHandles: () => curveHandles(current(),selectedFrames).filter(h=>h.frame>=viewRange.source_start && h.frame<=viewRange.source_end),
    getSelection:()=>[...selectedFrames],
    getSelectionIdentity:()=>keySelection?JSON.stringify(keySelection.get()):JSON.stringify([...selectedFrames]),
    select: (key,{toggle}) => { if(keySelection)keySelection.select({target:current().target,source_frame:key.source_frame},toggle);else if(toggle)selectedFrames.add(key.source_frame);else if(!selectedFrames.has(key.source_frame))selectedFrames=new Set([key.source_frame]);select.value=String(key.source_frame);load(); },
    draftBox:box=>{boxDraft=box;draw();},
    selectBox:box=>{const chosen=box.moved?current().keys.filter(key=>key.source_frame>=box.start && key.source_frame<=box.end && key.value>=box.min && key.value<=box.max).map(key=>({target:current().target,source_frame:key.source_frame})):[];if(keySelection){const values=box.append?keySelection.get():[];keySelection.set([...new Map([...values,...chosen].map(pick=>[keyPickIdentity(pick),pick])).values()]);}else{if(!box.append)selectedFrames.clear();for(const pick of chosen)selectedFrames.add(pick.source_frame);}boxDraft=null;select.value=selectedFrames.size?String([...selectedFrames][0]):"";load();},
    pan:event=>{if(event.final){panOrigin=null;draw();return;}reader?.cancel();navigation?.cancel();if(!panOrigin)panOrigin={range:viewRange,g:geometry};viewRange=curveViewport(panOrigin.range,timeRange,current(),panOrigin.g,{panX:event.frames,panY:event.value});rememberViewport();draw();},
    draft: (point,members) => { point={...point,frame:Math.max(range.source_start,Math.min(range.source_end,point.frame))};drafting = true;frame.value=point.frame;value.value=point.value;groupDraft=pointerCurveDraft(current(),members || [previous()],{source_frame:previous()},point);status.textContent=`Draft ${keySelection?.get().length || members?.length || 1} keys · ${groupDraft.deltaFrame} source frames · grabbed value ${groupDraft.value.toPrecision(5)} · release to apply`;draw(); },
    draftHandle: (index, point, handle) => { handleDraft = {index,point,segment_frame:handle.segment_frame}; mode.value = "Bezier"; handles.hidden = handles.disabled = false; fields[index ? "c2x" : "c1x"].value = point[0]; fields[index ? "c2y" : "c1y"].value = point[1]; status.textContent = "Draft Bezier control · release to apply"; draw(); },
    finish: (point,members,handle) => { const scalar=Boolean(groupDraft);drafting=false;handleDraft=groupDraft=null;draw();if(handle)saveHandle(handle,point);else if(scalar)savePointer(point); },
    reset: () => { if(panOrigin){viewRange=panOrigin.range;panOrigin=null;rememberViewport();}drafting=false;handleDraft=groupDraft=boxDraft=null;load(); },
  });
  if(keyframeClock(detail) && typeof seek==='function')navigation=createKeyframeNavigation({root:section,scopeRoot:root,detail,getKey:()=>noScalar?null:current().keys.find(key=>key.source_frame===previous()),getRange:()=>viewRange,getGeometry:()=>geometry,seek,canNavigate:()=>!waiting && !drafting && !handleDraft && !boxDraft && (canNavigate?.() ?? true),navigateSource,notice,onDraft:draw,label:'curve'});
  tracks.addEventListener("change", () => {noScalar=null;reader?.cancel();drag.cancel();navigation?.cancel();chooseCurve();keySelection?.activate(current().target);});
  select.addEventListener("change", () => { drag.cancel();navigation?.cancel();selectedFrames=new Set(previous()===null?[]:[previous()]);keySelection?.set([...selectedFrames].map(source_frame=>({target:current().target,source_frame})));load(); });
  groupKeys.addEventListener("change",()=>{drag.cancel();navigation?.cancel();selectedFrames=new Set([...groupKeys.selectedOptions].map(option=>Number(option.value)));keySelection?.set([...selectedFrames].map(source_frame=>({target:current().target,source_frame})));select.value=selectedFrames.size?String([...selectedFrames][0]):"";load();});
  groupForm.addEventListener("submit",event=>{event.preventDefault();saveGroup();});groupRemove.addEventListener("click",()=>saveGroup(true));
  function wheelViewport(event,lanesOnly=false){
    if(event.defaultPrevented || event.metaKey || event.isComposing || event.getModifierState?.('AltGraph') || lanesOnly && !event.deltaX && !event.altKey && !event.ctrlKey)return;
    event.preventDefault();event.stopPropagation();if(waiting || !geometry || !canRead())return;
    drag.cancel();lanes?.cancel();navigation?.cancel();reader?.cancel();
    const unit=event.deltaMode===1?16:event.deltaMode===2?geometry.plotWidth:1,deltaX=(event.deltaX || 0)*unit,deltaY=(event.deltaY || 0)*unit;
    if(event.shiftKey && !event.altKey && !event.ctrlKey && !deltaX){if(!noScalar)viewRange=curveViewport(viewRange,timeRange,current(),geometry,{zoomY:Math.exp(-deltaY*.004)});}
    else{const rect=event.target?.getBoundingClientRect?.() || event.currentTarget?.getBoundingClientRect?.() || canvas.getBoundingClientRect(),x=Number.isFinite(event.clientX)?event.clientX-rect.left:geometry.left+geometry.plotWidth/2;viewRange=nativeCurveTimeViewport(viewRange,timeRange,geometry,{x,zoom:deltaY && (!deltaX || event.altKey || event.ctrlKey)?Math.exp(-deltaY*.004):1,pan:-deltaX});}
    rememberViewport();draw();
  }
  canvas.addEventListener('wheel',event=>wheelViewport(event),{passive:false});
  section.addEventListener('wheel',event=>{if(event.target?.classList?.contains('keyframe-ruler'))wheelViewport(event);},{passive:false});
  canvas.addEventListener("keydown",event=>{if(event.key==="Delete" || event.key==="Backspace"){event.preventDefault();event.stopPropagation();if(keySelection)savePointer(null);else saveGroup(true);}else if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==="a"){event.preventDefault();event.stopPropagation();if(noScalar)return;selectedFrames=new Set(current().keys.filter(key=>key.source_frame>=viewRange.source_start && key.source_frame<=viewRange.source_end).map(key=>key.source_frame));keySelection?.set([...selectedFrames].map(source_frame=>({target:current().target,source_frame})));updateGroup();draw();}});
  mode.addEventListener("change", () => { handles.hidden = mode.value !== "Bezier"; handles.disabled = handles.hidden || disabled; });
  form.addEventListener("submit", (event) => { event.preventDefault(); save(); });
  remove.addEventListener("click", () => save(true));
  duplicate.addEventListener("click", () => {if(noScalar || !owner.current())return;select.value = "";selectedFrames.clear();updateGroup(); frame.value = Math.min(range.source_end, Number(frame.value) + 1); remove.disabled = duplicate.disabled = true; status.textContent = "Duplicate draft · choose a free source frame and Apply"; draw(); });
  window.addEventListener("blur", ()=>{drag.cancel();reader?.cancel();}, {signal: events.signal});
  section.addEventListener("toggle", ()=>{if(!section.open)reader?.cancel();draw();});
  const unsubscribe=keySelection?.subscribe(()=>{selectedFrames=new Set(keySelection.get().filter(pick=>JSON.stringify(pick.target)===JSON.stringify(current().target)).map(pick=>pick.source_frame));if(!selectedFrames.has(previous()))select.value=selectedFrames.size?String([...selectedFrames][0]):'';load();});
  const stopNavigation=keySelection?.onGesture(()=>navigation?.cancel());
  const stopTarget=keySelection?.subscribeTarget(target=>{
    const index=range.tracks.findIndex(row=>JSON.stringify(row.target)===JSON.stringify(target));
    if(index<0){noScalar=target;reader?.cancel();drag.cancel();navigation?.cancel();draw();return;}
    const wasTyped=Boolean(noScalar);noScalar=null;if(index===Number(tracks.value) && !wasTyped)return;
    reader?.cancel();drag.cancel();navigation?.cancel();const time={source_start:viewRange.source_start,source_end:viewRange.source_end};tracks.value=String(index);chooseCurve();viewRange=time;rememberViewport();draw();
  });
  lanes=renderKeyframeLanes(section,detail,{keySelection,getGeometry:()=>geometry,getRange:()=>viewRange,canNavigate:()=>!waiting && !drafting && !handleDraft && !boxDraft && (canNavigate?.() ?? true),canEdit:()=>owner.current(),commit:operation=>owner.commit(operation),operation:(picks,delta,linked)=>pointerKeyOperation(detail.clip_id,picks,delta,null,linked),notice,activate:target=>keySelection.activate(target),linkZoom:()=>zoomLink.get(),seek,onViewportWheel:event=>wheelViewport(event,true)});
  if(lanes)section.append(form,groupForm);
  if(presentation==='window'){
    keyValues=document.createElement('details');keyValues.dataset.visualPath='curve-key-values';keyValues.open=Boolean(openState?.get('curve-key-values'));
    const title=document.createElement('summary');title.textContent='Key values';keyValues.append(title,status,select,form,groupForm);
    if(navigation)keyValues.append(navigation.jump,navigation.status);
    const viewControls=document.createElement('details'),viewHeading=document.createElement('summary');viewControls.dataset.visualPath='curve-view-controls';viewControls.open=Boolean(openState?.get('curve-view-controls'));viewHeading.textContent='View controls';viewControls.append(viewHeading,viewportTools);
    const help=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Curve controls';help.append(heading,note);section.append(keyValues,viewControls,help);
  }
  const observer = new ResizeObserver(()=>{drag.cancel();draw();}); observer.observe(canvas); chooseCurve();
  return {cancel() {if(document.activeElement===canvas){const state=openState?.get(selectionKey());remember(selectionKey(),Array.isArray(state)?{before:state,after:state,focus:true}:{...state,focus:true});}reader?.dispose();lanes?.dispose();unsubscribe?.();stopNavigation?.();stopTarget?.();navigation?.dispose();owner.dispose();drag.cancel(); disposed = true; events.abort(); observer.disconnect(); }};
}
