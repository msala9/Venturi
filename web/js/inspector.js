import {renderFilters,renderSelectedFilters,bindScalarRange} from "./visual.js";
import {renderMasks} from "./masks.js";
import {renderCurves,createZoomLink,zoomParameters,createKeyPickSelection} from "./curves.js";
import {renderEventKeys} from "./eventkeys.js";
import {renderKeySelection} from "./keyselection.js";
import {createTitleFontChooser} from './fonts.js';
import {renderColorPicker} from './color-picker.js';
import {createTransitionChoice,renderTransitionControls} from './transition-controls.js';

export function createInspectorViewportKeeper(root,{getContext,documentRef=root.ownerDocument ?? globalThis.document,windowRef=documentRef?.defaultView ?? globalThis.window,Observer=windowRef?.MutationObserver ?? globalThis.MutationObserver,requestFrame=callback=>windowRef.requestAnimationFrame(callback),cancelFrame=id=>windowRef.cancelAnimationFrame(id)}={}){
  let context=null,pending=null,frame=null,disposed=false,lastFocus=null,restoring=false;const listeners=[];
  const listen=(node,key,handler,options)=>{node?.addEventListener?.(key,handler,options);listeners.push(()=>node?.removeEventListener?.(key,handler,options));};
  const key=()=>{const value=getContext();return value==null?null:typeof value==='string'?value:JSON.stringify(value);};
  const nodes=()=>[...root.querySelectorAll('[aria-label],[id]')];
  const signature=node=>{const label=node?.getAttribute?.('aria-label') || '',id=node?.id || '';return label || id?{label,id,tag:node.tagName,type:node.type || ''}:null;};
  const matches=(node,value)=>{const actual=signature(node);return actual && ['label','id','tag','type'].every(name=>actual[name]===value[name]);};
  const describe=node=>{const value=signature(node);if(!value)return null;const index=nodes().filter(candidate=>matches(candidate,value)).indexOf(node);return index>=0?{...value,index}:null;};
  const find=value=>value?nodes().filter(node=>matches(node,value))[value.index]:null;
  const visible=node=>!!node && node.isConnected!==false && (node.getClientRects?.().length ?? 1)>0 && !node.closest?.('[hidden],[inert],details:not([open])') && (node.getBoundingClientRect?.().height ?? 0)>0;
  const observer=typeof Observer==='function'?new Observer(()=>schedule()):null;
  function stop(){pending=null;if(frame!==null){cancelFrame(frame);frame=null;}observer?.disconnect();}
  function cancel(){stop();lastFocus=null;}
  function contextChanged(){const next=key();if(next===context)return false;cancel();context=next;root.scrollTop=0;return true;}
  function remember(node){if(!root.contains(node))return;const value=describe(node);if(value)lastFocus={node,context:key()};}
  function capture(){
    if(disposed)return;const changed=contextChanged();if(context===null)return;
    if(pending?.context===context){pending.focused=false;schedule();return;}
    const bounds=root.getBoundingClientRect(),active=documentRef.activeElement,blank=!active || active===documentRef.body || active===root || active.isConnected===false;
    const focused=!changed && root.contains(active)?active:!changed && blank && lastFocus?.context===context && root.contains(lastFocus.node)?lastFocus.node:null;
    let anchor=visible(focused) && describe(focused)?focused:null;
    if(!changed && !anchor)anchor=nodes().filter(node=>visible(node)).map(node=>({node,rect:node.getBoundingClientRect()})).filter(({rect})=>rect.bottom>bounds.top && rect.top<bounds.bottom).sort((a,b)=>Math.abs(a.rect.top-bounds.top)-Math.abs(b.rect.top-bounds.top))[0]?.node ?? null;
    const snapshot={top:changed?0:root.scrollTop,anchor:anchor?describe(anchor):null,offset:anchor?anchor.getBoundingClientRect().top-bounds.top:0,focus:focused?describe(focused):null,oldFocus:focused,selection:focused?{start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection}:null};
    pending={context,snapshot,focused:false};observer?.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','open','hidden','inert']});schedule();
  }
  function restore(){
    if(!pending || disposed)return;if(key()!==pending.context){contextChanged();return;}
    if(root.isConnected===false || documentRef.hidden || documentRef.querySelector?.('dialog[open]')){cancel();return;}
    const owner=pending,snapshot=owner.snapshot,bounds=root.getBoundingClientRect();if(bounds.height<=0)return;
    const anchor=find(snapshot.anchor),desired=visible(anchor)?root.scrollTop+anchor.getBoundingClientRect().top-bounds.top-snapshot.offset:snapshot.top;
    root.scrollTop=Math.max(0,desired);
    if(!snapshot.focus || owner.focused)return;
    const target=find(snapshot.focus);if(!visible(target) || target.disabled || documentRef.hasFocus?.()===false || Math.abs(root.scrollTop-Math.max(0,desired))>1)return;
    const active=documentRef.activeElement,owned=!active || active===documentRef.body || active===root || active===snapshot.oldFocus || active===target || active.isConnected===false;
    if(!owned){cancel();return;}
    restoring=true;try{target.focus?.({preventScroll:true});if(Number.isInteger(snapshot.selection?.start))try{target.setSelectionRange?.(snapshot.selection.start,snapshot.selection.end,snapshot.selection.direction);}catch{}owner.focused=true;lastFocus={node:target,context:owner.context};}finally{restoring=false;}
  }
  function schedule(){if(disposed || !pending || frame!==null)return;frame=requestFrame(()=>{frame=null;restore();});}
  listen(documentRef,'pointerdown',event=>{stop();const target=event.target?.closest?.('input,textarea,select,button,[tabindex]') ?? event.target;if(root.contains(target))remember(target);else lastFocus=null;},true);
  listen(documentRef,'focusin',event=>{if(restoring)return;if(root.contains(event.target)){if(pending)stop();remember(event.target);}else if(event.target!==documentRef.body){cancel();}},true);
  listen(documentRef,'wheel',()=>stop(),{capture:true,passive:true});listen(documentRef,'touchstart',()=>stop(),{capture:true,passive:true});
  listen(documentRef,'keydown',event=>{if(['Tab','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))stop();},true);
  listen(windowRef,'blur',cancel);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  return {capture,restore:schedule,contextChanged,cancel,dispose(){if(disposed)return;cancel();disposed=true;for(const remove of listeners)remove();}};
}

export function inspectorGroup(section,group){
  if(!['video','audio','selection'].includes(group))throw Error('Choose an Inspector group');
  section.setAttribute('data-inspector-group',group);return section;
}
export function editingShortcutAllowed(event,{dialogOpen=false,allowRepeat=false}={}){
  return !dialogOpen && !event.defaultPrevented && (allowRepeat || !event.repeat) && !event.isComposing && event.keyCode!==229 && !event.getModifierState?.('AltGraph') && !event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog,video,audio,.app-menu[open]');
}
export function selectionInspectorRows(value,{query,clip_ids}){
  if(!value?.query || !Object.keys(query).every(key=>value.query[key]===query[key]) || !Array.isArray(value.rows) || value.rows.length!==clip_ids.length || new Set(clip_ids).size!==clip_ids.length || value.rows.length>2048)throw Error('The native selection summary changed');
  const requested=new Set(clip_ids),seen=new Set();
  for(const row of value.rows){if(!requested.has(row.clip_id) || seen.has(row.clip_id) || typeof row.track_id!=='string' || !['video','audio'].includes(row.kind) || typeof row.name!=='string' || typeof row.locked!=='boolean' || !Number.isSafeInteger(row.start_frame) || row.start_frame<0 || !Number.isSafeInteger(row.length_frames) || row.length_frames<1 || !Number.isSafeInteger(row.source_frame))throw Error('The native selection summary changed');seen.add(row.clip_id);}
  return value.rows;
}
export function renderInspectorSelection(root,rows){
  const table=document.createElement('table'),head=document.createElement('thead'),heading=document.createElement('tr'),body=document.createElement('tbody');table.className='inspector-selection-table';table.setAttribute('aria-label','Selected clips');
  for(const name of ['Kind','Track','Name','Start','Length','Source frame']){const cell=document.createElement('th');cell.scope='col';cell.textContent=name;heading.append(cell);}head.append(heading);
  for(const row of rows){const line=document.createElement('tr');for(const value of [row.kind,row.track_id,row.name,row.start_frame,row.length_frames,row.source_frame]){const cell=document.createElement('td');cell.textContent=String(value);line.append(cell);}body.append(line);}
  table.append(head,body);root.className='inspector-selection-summary';root.replaceChildren(table);
}
export function bindInspectorNumber(input,{canInteract,apply,speed=1,decimals=6,windowRef=input.ownerDocument?.defaultView ?? globalThis.window}){
  let gesture=null,disposed=false,lockRequest=null,lockOwner=null;const listeners=[],lockListeners=[],mouseListeners=[],documentRef=input.ownerDocument ?? windowRef?.document;
  const listen=(target,key,handler)=>{target?.addEventListener?.(key,handler);listeners.push(()=>target?.removeEventListener?.(key,handler));};
  const live=()=>!disposed && input.isConnected!==false && !input.disabled && (!lockOwner || documentRef?.pointerLockElement===input) && canInteract();
  const release=id=>{try{if(input.hasPointerCapture?.(id))input.releasePointerCapture(id);}catch{}};
  const locked=()=>lockOwner===gesture && !!gesture && documentRef?.pointerLockElement===input;
  const cleanLocks=()=>{if(disposed && !lockRequest && !lockOwner)for(const remove of lockListeners.splice(0))remove();};
  const clearMouse=()=>{for(const remove of mouseListeners.splice(0))remove();};
  function unlock(owner){if(lockOwner!==owner)return;lockOwner=null;clearMouse();if(documentRef?.pointerLockElement===input)try{documentRef.exitPointerLock();}catch{}cleanLocks();}
  function cancel(){if(!gesture)return;const before=gesture;gesture=null;input.value=before.text;unlock(before);release(before.id);}
  function lockChanged(){
    if(documentRef.pointerLockElement===input){
      const owner=lockOwner ?? lockRequest?.owner;if(!owner)return;
      lockRequest=null;
      if(gesture===owner && live()){lockOwner=owner;bindMouse();release(owner.id);}
      else{lockOwner=null;clearMouse();try{documentRef.exitPointerLock();}catch{}if(gesture)cancel();}
    }else if(lockOwner){const owner=lockOwner;lockOwner=null;clearMouse();if(gesture===owner)cancel();}
    cleanLocks();
  }
  function requestLock(owner){
    if(owner.lockAttempted)return;owner.lockAttempted=true;
    if(lockRequest || documentRef?.pointerLockElement || !documentRef?.addEventListener || typeof input.requestPointerLock!=='function' || typeof documentRef.exitPointerLock!=='function')return;
    const ticket={owner,promise:true};lockRequest=ticket;
    const failed=()=>{if(lockRequest===ticket)lockRequest=null;cleanLocks();};
    try{const result=input.requestPointerLock();if(result?.then)Promise.resolve(result).then(()=>{if(lockRequest===ticket || lockOwner===owner)lockChanged();},failed);else ticket.promise=false;}catch{failed();}
  }
  if(documentRef?.addEventListener)for(const [key,handler] of [['pointerlockchange',lockChanged],['pointerlockerror',()=>{if(!lockRequest?.promise)lockRequest=null;cleanLocks();}]]){documentRef.addEventListener(key,handler);lockListeners.push(()=>documentRef.removeEventListener(key,handler));}
  const draft=(event,relative=false)=>{
    const owner=gesture;if(!owner)return;
    if(!relative && (!Number.isFinite(event.clientX) || !owner.moved && Math.abs(event.clientX-owner.x)<3))return;
    const delta=relative?event.movementX:event.clientX-owner.lastX;if(!Number.isFinite(delta))return;
    event.preventDefault?.();owner.moved=true;if(!relative){owner.lastX=event.clientX;requestLock(owner);}if(gesture!==owner || delta===0)return;
    const bound=(value,fallback)=>String(value ?? '').trim() && Number.isFinite(Number(value))?Number(value):fallback,min=bound(input.min,-Infinity),max=bound(input.max,Infinity);
    owner.draftValue=Math.max(min,Math.min(max,owner.draftValue+delta*(event.shiftKey ? speed/10 : speed)));
    input.value=String(Number(owner.draftValue.toFixed(decimals)));
  };
  function finish(event,relative=false){
    if(!gesture)return;if(!live()){cancel();return;}
    if(!relative && (gesture.moved || Math.abs(event.clientX-gesture.x)>=3))draft(event);if(!gesture)return;
    const before=gesture;gesture=null;unlock(before);release(before.id);if(before.moved && Number(input.value)!==before.value)apply();
  }
  function bindMouse(){
    if(mouseListeners.length)return;
    for(const [key,handler] of [['mousemove',event=>{if(!locked())return;if(!live() || event.buttons!==undefined && !(event.buttons&1)){cancel();return;}draft(event,true);}],['mouseup',event=>{if(locked() && event.button===0)finish(event,true);}]]){documentRef.addEventListener(key,handler);mouseListeners.push(()=>documentRef.removeEventListener(key,handler));}
  }
  listen(input,'pointerdown',event=>{if(gesture || !live() || event.button!==0 || event.isPrimary===false || event.ctrlKey || event.metaKey || event.altKey || !String(input.value).trim() || !Number.isFinite(Number(input.value)))return;gesture={id:event.pointerId,x:event.clientX,lastX:event.clientX,text:input.value,value:Number(input.value),draftValue:Number(input.value),moved:false};input.setPointerCapture?.(event.pointerId);});
  listen(input,'pointermove',event=>{if(!gesture || event.pointerId!==gesture.id || locked())return;if(!live() || event.buttons!==undefined && !(event.buttons&1)){cancel();return;}draft(event);});
  listen(input,'pointerup',event=>{if(gesture && event.pointerId===gesture.id && !locked())finish(event);});
  listen(input,'pointercancel',cancel);listen(input,'lostpointercapture',()=>{if(documentRef?.pointerLockElement!==input)cancel();else lockChanged();});listen(input,'blur',cancel);
  listen(input,'keydown',event=>{if(event.key==='Escape' && gesture){event.preventDefault();event.stopPropagation();cancel();}});
  listen(windowRef,'blur',cancel);
  listen(windowRef,'pagehide',cancel);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  return {cancel,dispose(){if(disposed)return;cancel();disposed=true;for(const remove of listeners)remove();cleanLocks();}};
}
function inspectorHelp(parent,note,label='Editing this selection'){
  const help=document.createElement('details'),summary=document.createElement('summary');help.className='inspector-help';summary.textContent=label;help.append(summary,note);parent.append(help);
}
function compactReset(button){button.className='inspector-reset';button.title=button.getAttribute?.('aria-label') || button.textContent;button.textContent='↺';return button;}

export function detailIdentity(state) {
  return state ? [state.project_epoch, state.generation, state.timeline, state.revision, state.clip, state.frame,state.key_page].join(":") : null;
}
export function propertyOperation(clip, patch) { return { kind: "set_properties", clip_id: clip, patch }; }
function propertySelection({project_epoch,generation,timeline,selection}={},kind){
  if(typeof project_epoch!=='string' || !project_epoch || typeof generation!=='string' || !generation || typeof timeline?.id!=='string' || typeof timeline.revision!=='string' || !Array.isArray(timeline.tracks) || !Array.isArray(selection) || !selection.length || selection.some(id=>typeof id!=='string' || !id) || new Set(selection).size!==selection.length)return null;
  const all=new Set(timeline.tracks.flatMap(track=>track.clips.map(clip=>clip.id)));
  if(selection.some(id=>!all.has(id)))return null;
  const selected=new Set(selection),decimal=id=>/^\d{1,20}$/.test(id) && BigInt(id)<=18446744073709551615n;
  const clip_ids=timeline.tracks.filter(track=>(kind==='media' || track.kind===kind) && !track.locked).flatMap(track=>{
    const clips=track.clips.filter(clip=>selected.has(clip.id) && (kind!=='media' || clip.kind==='media'));
    // Inspector properties sort by start; native speed targets keep ClipKey order.
    if(clips.every(clip=>decimal(clip.id)))clips.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
    if(kind!=='media')clips.sort((a,b)=>a.start_frame-b.start_frame);
    return clips.map(clip=>clip.id);
  });
  return clip_ids.length && clip_ids.length<=4096?{project_epoch,generation,timeline_id:timeline.id,revision:timeline.revision,selection:[...selection].sort(),clip_ids}:null;
}
export function videoPropertySelection(state){return propertySelection(state,'video');}
export function audioPropertySelection(state){return propertySelection(state,'audio');}
export function retimePropertySelection(state){return propertySelection(state,'media');}
export function compoundSelectionOperation(clip_ids,name,mode='native'){
  if(!Array.isArray(clip_ids) || !clip_ids.length || clip_ids.length>4096 || clip_ids.some(id=>typeof id!=='string' || !id) || new Set(clip_ids).size!==clip_ids.length || typeof name!=='string' || !name.trim() || !['native','keep_track_audio_mix'].includes(mode))throw Error('Choose a current clip selection, compound name and grouping mode');
  return {kind:mode==='native'?'make_native_compound':'make_compound',clip_ids:[...clip_ids],name};
}
function renderCompositingChoices(parent,detail,{disabled=false,current,operation,commit,notice,onPreview}){
  const choices=[],buttons=[],doc=parent.ownerDocument ?? document;let disposed=false,waiting=false,unknown=false,sequence=0,pending=null;
  const live=()=>!disposed && !disabled && parent.isConnected!==false && !doc.hidden && !parent.closest?.('[hidden],[inert],details:not([open])') && !doc.querySelector?.('dialog[open]') && current();
  const available=()=>!waiting && !unknown && live();
  const sync=()=>{for(const button of buttons)button.disabled=disabled || disposed || waiting || unknown;};
  const send=(key,value)=>{
    if(!available())return false;const attempt={sequence,dispatched:false};pending=attempt;waiting=true;sync();for(const choice of choices)choice.cancel();
    return Promise.resolve().then(()=>{if(attempt.sequence!==sequence || pending!==attempt)return false;if(!live())throw Error('Video properties changed; read their current values before editing');attempt.dispatched=true;return Promise.resolve(commit(operation(key,value))).then(()=>true);}).catch(error=>{if(error.code==='OUTCOME_UNKNOWN')unknown=true;notice(error.message);return false;}).finally(()=>{if(pending===attempt){pending=null;waiting=false;sync();}});
  };
  for(const [label,key,value,values,kind] of [['Blend mode','blend',detail.blend,detail.blends,'blend_mode'],['Track matte','matte',detail.matte,detail.mattes,'track_matte']]){
    const field=document.createElement('label'),button=document.createElement('button');field.className='field';field.textContent=label;button.value=value;field.append(button);parent.append(field);buttons.push(button);
    choices.push(createTransitionChoice(button,{label,values,canInteract:available,notice,onPreview:value=>onPreview?.(value===null?null:{kind,[key]:value}),onConfirm:value=>send(key,value)}));
  }
  function cancel(){if(disposed)return;sequence++;for(const choice of choices)choice.cancel();if(pending && !pending.dispatched){pending=null;waiting=false;}sync();}
  sync();return {cancel,dispose(){if(disposed)return;cancel();disposed=true;for(const choice of choices)choice.dispose();sync();}};
}
export function renderBlendMatte(root,detail,{selection,getSelection,canInteract,commit,notice,primaryName='',visualState,frame,getFrame,previewInspectorChoice,disabled=false}){
  if(!selection?.clip_ids?.length || detail.clip_id!==selection.clip_ids[0] || !detail.video || detail.locked)return;
  const captured=structuredClone(selection),identity=JSON.stringify(captured),section=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('p');
  inspectorGroup(section,'video');section.setAttribute('data-visual-path','selected-compositing');section.className='inspector-compositing';section.open=visualState?.get('selected-compositing') ?? false;summary.textContent='Blending';note.className='muted';note.textContent=`Values from ${primaryName || 'the first selected video clip'} · changes apply to ${captured.clip_ids.length} selected unlocked video clip${captured.clip_ids.length===1?'':'s'}.`;section.append(summary);inspectorHelp(section,note);
  root.append(section);
  const detailIdentity=()=>JSON.stringify([detail.project_epoch,detail.generation,detail.timeline_id,detail.revision,detail.clip_id,detail.timeline_frame,detail.source_frame]),capturedDetail=detailIdentity();
  const current=()=>root.isConnected!==false && canInteract() && JSON.stringify(getSelection())===identity && detailIdentity()===capturedDetail && (!Number.isSafeInteger(frame) || getFrame?.()===frame);
  return renderCompositingChoices(section,detail,{disabled,current,commit,notice,onPreview:previewInspectorChoice,operation:(key,value)=>({kind:'set_properties_batch',clip_ids:[...captured.clip_ids],patch:{[key]:value}})});
}
const TRANSFORM_ROWS=[['Zoom',['ZoomX','ZoomY']],['Position',['PositionX','PositionY']],['Rotation',['Rotation']],['Anchor',['AnchorX','AnchorY']]];
const CROP_ROWS=[['Crop left',['CropLeft']],['Crop right',['CropRight']],['Crop top',['CropTop']],['Crop bottom',['CropBottom']],['Crop softness',['CropSoftness']]];
const CROP_PARAMS=['CropLeft','CropTop','CropRight','CropBottom','CropSoftness'];
function selectedPropertyControls(root,detail,{selection,getSelection,frame,getFrame,canInteract,canNavigate=canInteract,commit,notice,seek},video){
  if(!selection?.clip_ids?.length || detail.clip_id!==selection.clip_ids[0] || detail.video!==video || detail.locked || !Number.isSafeInteger(frame) || frame<0)return null;
  const captured=structuredClone(selection),identity=JSON.stringify(captured),controls=[],section=inspectorGroup(document.createElement('details'),video?'video':'audio');section.open=true;section.className='inspector-selected';
  if(getFrame()!==frame || JSON.stringify(getSelection())!==identity)return null;
  let waiting=false,outcomeUnknown=false,disposed=false,commandSequence=0;const gestures=[];
  const owns=()=>!disposed && root.isConnected!==false && section.isConnected!==false && getFrame()===frame && JSON.stringify(getSelection())===identity;
  const current=()=>owns() && canInteract(),navigationCurrent=()=>owns() && canNavigate();
  const sync=()=>{for(const [control,available,navigation] of controls)control.disabled=waiting || outcomeUnknown || !(navigation?navigationCurrent():current()) || !available();};
  const register=(control,available=()=>true,navigation=false)=>{controls.push([control,available,navigation]);control.disabled=waiting || outcomeUnknown || !(navigation?navigationCurrent():current()) || !available();return control;};
  const submit=edit=>{
    if(!edit)return false;
    if(waiting || outcomeUnknown)return false;
    if(!current()){notice('Inspector selection changed; read its current properties before editing');return false;}
    const operation={kind:'edit_inspector_selection',clip_ids:[...captured.clip_ids],timeline_frame:frame,edit};
    const sequence=++commandSequence;waiting=true;sync();
    return Promise.resolve().then(()=>{if(sequence!==commandSequence)return false;if(!current())throw Error('Inspector selection changed; read its current properties before editing');return Promise.resolve(commit(operation)).then(()=>true);}).catch(error=>{if(error.code==='OUTCOME_UNKNOWN')outcomeUnknown=true;notice(error.message);return false;}).finally(()=>{waiting=false;sync();});
  };
  const button=(label,edit,parent,available=()=>true)=>{const node=register(document.createElement('button'),available);node.type='button';node.textContent=label;node.setAttribute('aria-label',label);node.addEventListener('click',()=>{if(available())submit(typeof edit==='function'?edit():edit);});parent.append(node);if(label.startsWith('Reset '))compactReset(node);return node;};
  const localButton=(label,frame,parent)=>{
    const node=register(document.createElement('button'),()=>typeof seek==='function' && Number.isSafeInteger(frame) && frame>=0,true);node.type='button';node.textContent=label;node.setAttribute('aria-label',label);
    node.addEventListener('click',()=>{if(!waiting && !outcomeUnknown && navigationCurrent() && typeof seek==='function' && Number.isSafeInteger(frame) && frame>=0)seek(frame);});parent.append(node);return node;
  };
  const heading=document.createElement('summary');heading.textContent=video?'Selected video properties':'Selected audio gain';section.append(heading);
  root.append(section);
  return {section,register,button,localButton,submit,current,sync,own:gesture=>gestures.push(gesture),available:()=>!waiting && !outcomeUnknown && current(),cancel(){if(disposed)return;commandSequence++;for(const gesture of gestures)gesture.cancel?.();sync();},dispose(){if(disposed)return;disposed=true;commandSequence++;for(const gesture of gestures){if(typeof gesture.dispose==='function')gesture.dispose();else gesture.cancel?.();}gestures.length=0;sync();}};
}
function selectedNumber(parent,label,parameter,controls,apply,displayLabel){
  const form=document.createElement('form'),field=document.createElement('label'),input=controls.register(document.createElement('input'));
  form.className='property-row inspector-number';field.className='field';field.textContent=displayLabel ?? (/^(Zoom|Position|Anchor)[XY]$/.test(label)?label.slice(-1):label);
  input.type='number';input.step=parameter.step ?? 'any';input.required=true;input.value=parameter.value;input.min=parameter.min;input.max=parameter.max;input.setAttribute('aria-label',label);field.append(input);
  const button=controls.register(document.createElement('button'));button.className='inspector-number-apply';button.textContent='Apply';button.setAttribute('aria-label',`Apply ${label}`);form.append(field,button);
  const complete=()=>{const value=Number(input.value);if(String(input.value).trim() && Number.isFinite(value) && form.reportValidity())apply(value);};
  const submit=event=>{event.preventDefault();complete();};form.addEventListener('submit',submit);input.addEventListener('change',complete);controls.own({dispose(){form.removeEventListener?.('submit',submit);input.removeEventListener?.('change',complete);}});
  const live=()=>controls.available() && !input.closest?.('details:not([open])');
  input.title='Drag to adjust; Shift for fine control. Click to type. Escape cancels a drag.';controls.own(bindInspectorNumber(input,{canInteract:live,apply:complete,speed:parameter.speed ?? (/Zoom/.test(label) ? 0.01 : /Rotation|Opacity/.test(label) ? 0.5 : 1)}));
  if(parameter.slider){
    const slider=controls.register(document.createElement('input'));slider.type='range';slider.min=parameter.min;slider.max=parameter.max;slider.step='any';slider.value=parameter.value;slider.className='inspector-inline-slider';slider.setAttribute('aria-label',`${label} slider`);field.className+=' inspector-slider-field';field.append(slider);controls.own(bindScalarRange(input,slider,{canInteract:live,complete}));
  }else if(/^(Rotation|Opacity|CropLeft|CropRight|CropTop|CropBottom|CropSoftness)$/.test(label)){
    const slider=controls.register(document.createElement('input'));slider.type='range';slider.min=label==='Rotation'?-180:parameter.min;slider.max=label==='Rotation'?180:parameter.max;slider.step=label==='Rotation' || label==='Opacity'?0.5:1;slider.value=parameter.value;slider.className='inspector-inline-slider';slider.setAttribute('aria-label',`${label} slider`);field.className+=' inspector-slider-field';field.append(slider);
    let before=null,canceled=false;const listeners=[],listen=(target,key,handler)=>{target?.addEventListener?.(key,handler);listeners.push(()=>target?.removeEventListener?.(key,handler));};
    listen(slider,'pointerdown',()=>{if(controls.available()){canceled=false;before=input.value;}});listen(slider,'input',()=>{if(!canceled && controls.available())input.value=slider.value;});
    listen(slider,'change',()=>{if(!canceled && controls.available()){input.value=slider.value;complete();}before=null;});
    const cancel=()=>{if(before!==null){input.value=before;slider.value=before;before=null;canceled=true;}};listen(slider,'pointercancel',cancel);listen(slider,'blur',cancel);listen(slider,'keydown',event=>{if(event.key==='Escape' && before!==null){event.preventDefault();event.stopPropagation();cancel();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)){canceled=false;before=input.value;}});
    const windowRef=input.ownerDocument?.defaultView ?? globalThis.window;listen(windowRef,'blur',cancel);controls.own({cancel,dispose(){cancel();for(const remove of listeners)remove();}});
    listen(input,'change',()=>{slider.value=input.value;});
  }
  parent.append(form);
  return form;
}
function keyDiamond(parent,label,parameters,controls,edit){
  const keys=document.createElement('span');keys.className='inspector-key-controls';parent.append(keys);
  const button=controls.button(`Toggle ${label} keyframes at playhead`,edit,keys);button.textContent='◆';button.title=`Toggle ${label} keyframes at playhead`;
  const known=parameters.every(parameter=>typeof parameter.keyframe_info?.on_keyframe==='boolean');
  if(known)button.setAttribute('aria-pressed',String(parameters.some(parameter=>parameter.keyframe_info.on_keyframe)));
  const previous=known?parameters.map(parameter=>parameter.keyframe_info.previous_frame).filter(Number.isSafeInteger):[],next=known?parameters.map(parameter=>parameter.keyframe_info.next_frame).filter(Number.isSafeInteger):[];
  const previousButton=controls.localButton(`Previous ${label} keyframe`,previous.length?Math.max(...previous):null,keys);previousButton.textContent='‹';previousButton.title=`Previous ${label} keyframe`;
  const nextButton=controls.localButton(`Next ${label} keyframe`,next.length?Math.min(...next):null,keys);nextButton.textContent='›';nextButton.title=`Next ${label} keyframe`;
}
export function renderSelectedVideoProperties(root,detail,options){
  const rows=[...TRANSFORM_ROWS,...CROP_ROWS,['Opacity',['Opacity']]],parameters=new Map(detail.transform?.map(parameter=>[parameter.param,parameter]));
  if(rows.some(([,params])=>params.some(param=>!Number.isFinite(parameters.get(param)?.value))) || !Array.isArray(detail.flip) || detail.flip.length!==2 || detail.flip.some(value=>typeof value!=='boolean'))return;
  const controls=selectedPropertyControls(root,detail,options,true);if(!controls)return;
  const {section}=controls,zoomLink=options.zoomLink || createZoomLink(options.visualState),note=document.createElement('p');note.className='muted';
  note.textContent=`Values from ${options.primaryName || 'the first selected video clip'} · edits apply to ${options.selection.clip_ids.length} selected unlocked video clip${options.selection.clip_ids.length===1?'':'s'}. Apply changes a constant default or writes a native key at each clip's clamped playhead. Position moves by the same delta; other axes use the shown value.`;inspectorHelp(section,note);
  function group(label,groupRows,resetFlip=false){
    const group=document.createElement('details'),heading=document.createElement('summary');group.dataset.visualPath=`selected-property:${label}`;group.open=options.visualState?.get(group.dataset.visualPath) ?? label==='Transform';group.className='inspector-property-group';heading.textContent=label;group.append(heading);section.append(group);
    const groupParams=label==='Crop'?CROP_PARAMS:groupRows.flatMap(([,params])=>params);
    if(label!=='Opacity')controls.button(`Reset ${label.toLowerCase()}`,{action:'reset_transform',params:groupParams,reset_flip:resetFlip},heading);
    for(const [rowLabel,params] of groupRows){
      const row=document.createElement('div'),legend=document.createElement('span');row.className=`inspector-axis-row${params.length===1?' inspector-axis-single':''}`;legend.className='inspector-row-label';legend.textContent=rowLabel==='Zoom'?'Scale':rowLabel==='Anchor'?'Pivot':rowLabel;row.append(legend);group.append(row);
      for(const param of params)selectedNumber(row,param,parameters.get(param),controls,value=>{
        const changed=zoomParameters(param,zoomLink.get()).filter(axis=>parameters.get(axis).value!==value).map(param=>({param,value}));
        if(changed.length)controls.submit({action:'transform',parameters:changed});
      },params.length===1?'':undefined);
      if(rowLabel==='Zoom'){
        const field=document.createElement('label'),link=controls.register(document.createElement('input'));field.className='inspector-zoom-link';field.title='Link Zoom X/Y';link.type='checkbox';link.setAttribute('aria-label','Link selected Zoom X/Y');zoomLink.register(link);field.append(link,'↔');row.append(field);
        link.addEventListener('change',()=>{if(link.checked && parameters.get('ZoomY').value!==parameters.get('ZoomX').value)controls.submit({action:'transform',parameters:[{param:'ZoomY',value:parameters.get('ZoomX').value}]});});
      }
      keyDiamond(row,rowLabel,params.map(param=>parameters.get(param)),controls,{action:'toggle_transform_keys',params});
      controls.button(`Reset ${rowLabel.toLowerCase()} row`,{action:'reset_transform',params,reset_flip:false},row);
    }
    return group;
  }
  const transform=group('Transform',TRANSFORM_ROWS,true);
  for(const [axis,label] of [[0,'Flip horizontal'],[1,'Flip vertical']]){
    const button=controls.button(label,{action:'flip',axis,enabled:!detail.flip[axis]},transform);button.textContent=axis?'↕':'↔';button.title=label;button.setAttribute('aria-pressed',String(detail.flip[axis]));
  }
  controls.button('Reset flip',{action:'reset_transform',params:[],reset_flip:true},transform);
  group('Crop',CROP_ROWS);
  group('Opacity',[['Opacity',['Opacity']]]);
  controls.button('Reset compositing',{action:'reset_compositing'},section);
  return controls;
}
export function renderSelectedAudioGain(root,detail,options){
  if(!Number.isFinite(detail.gain?.value))return;
  const controls=selectedPropertyControls(root,detail,options,false);if(!controls)return;
  const note=document.createElement('p');note.className='muted';note.textContent=`Values from ${options.primaryName || 'the first selected audio clip'} · edits apply to ${options.selection.clip_ids.length} selected unlocked audio clip${options.selection.clip_ids.length===1?'':'s'}. Apply changes a constant default or writes a native gain key at each clip's clamped playhead.`;inspectorHelp(controls.section,note);
  selectedNumber(controls.section,'Selected gain dB',{...detail.gain,min:-100,max:30},controls,value=>{if(value!==detail.gain.value)controls.submit({action:'gain',value});});
  keyDiamond(controls.section,'gain',[detail.gain],controls,{action:'toggle_gain_key'});
  controls.button('Reset gain',{action:'reset_gain'},controls.section);
  return controls;
}
export function titleSelectionPatch(before,after){
  const fields=['text','font_family','font_weight','italic','size','tracking','line_spacing','underline','strikethrough','case','align','anchor','position','color','background'];
  return Object.fromEntries(fields.filter(field=>Object.hasOwn(after,field) && JSON.stringify(after[field])!==JSON.stringify(before[field])).map(field=>[field,structuredClone(after[field])]));
}
export function renderSelectedVideoEffects(root,detail,options){
  const controls=selectedPropertyControls(root,detail,options,true);if(!controls)return [];
  const {section}=controls;section.children[0].textContent='Selected video effects';
  const note=document.createElement('p');note.className='muted';note.textContent=`Values from ${options.primaryName || 'the first selected video clip'}. Title and Solid controls follow this primary type; edits affect only matching selected clips. Filter parameters affect selected clips already carrying that filter. Rust chooses defaults or keys at each clip's clamped playhead.`;inspectorHelp(section,note);
  const group=label=>{const node=document.createElement('details'),summary=document.createElement('summary');node.dataset.visualPath=`selected-effects:${label}`;node.open=options.visualState?.get(node.dataset.visualPath) ?? label==='Selected solid color';node.className='inspector-property-group';summary.textContent=label;node.append(summary);section.append(node);return node;};
  function colorRow(parent,label,value,apply){
    const row=document.createElement('div');row.className='inspector-color-row';parent.append(row);
    controls.own(renderColorPicker(row,{label,value,controls,apply,openState:options.visualState}));
  }
  if(detail.title){
    const title=detail.title,parent=group('Selected title typography'),before={...structuredClone(title),text:title.content.value ?? title.content.default};delete before.content;
    const submit=patch=>{const changed=titleSelectionPatch(before,patch);if(Object.keys(changed).length)return controls.submit({action:'title',patch:changed});};
    const reset=(parent,label,fields)=>controls.button(`Reset ${label}`,{action:'reset_title',fields},parent);
    function text(label,field,value,multiline=false,target=parent){
      const form=document.createElement('form'),row=document.createElement('label'),input=controls.register(document.createElement(multiline?'textarea':'input'));row.className='field';row.textContent=label;if(!multiline)input.type='text';input.value=value;input.maxLength=multiline?4096:128;input.setAttribute('aria-label',label);row.append(input);form.append(row);
      const button=controls.register(document.createElement('button'));button.textContent=`Apply ${label}`;button.setAttribute('aria-label',button.textContent);form.append(button);form.addEventListener('submit',event=>{event.preventDefault();if(new TextEncoder().encode(input.value).length>(multiline?4096:128))return options.notice(`${label} exceeds its UTF-8 byte limit`);if(form.reportValidity())submit({[field]:input.value});});target.append(form);return form;
    }
    const textForm=text('Title text','text',before.text,true);keyDiamond(textForm,'title text',[title.content],controls,{action:'toggle_text_key'});
    const fonts=document.createElement('div');parent.append(fonts);
    controls.own(createTitleFontChooser({root:fonts,group:parent,title,readFonts:options.readFonts,register:controls.register,sync:controls.sync,isCurrent:controls.current,canInteract:controls.available,onPreview:options.previewTitleFont,onFamily:font_family=>submit({font_family}),onFace:face=>submit({font_weight:face.weight,italic:face.italic})}));
    reset(fonts,'title font',['font_family']);reset(fonts,'title style',['font_weight','italic']);
    const manual=document.createElement('details'),manualTitle=document.createElement('summary');manual.dataset.visualPath='selected-title-font-manual';manual.className='inspector-help';manual.open=options.visualState?.get(manual.dataset.visualPath) ?? false;manualTitle.textContent='Manual font and style';manual.append(manualTitle);parent.append(manual);
    text('Font family (server)','font_family',title.font_family,false,manual);
    if(title.font_weight>=100 && title.font_weight<=900)selectedNumber(manual,'Font weight',{value:title.font_weight,min:100,max:900,step:1},controls,value=>submit({font_weight:value}));
    else{const current=document.createElement('p');current.className='muted';current.textContent=`Current server style weight: ${title.font_weight} · choose a listed server style to change it`;manual.append(current);}
    for(const [label,field,min,max] of [['Font size','size',1,1000],['Letter tracking','tracking',-300,1000],['Line spacing','line_spacing',-200,500]]){
      const row=selectedNumber(parent,label,{value:title[field],min,max,speed:1,slider:true},controls,value=>submit({[field]:value}));reset(row,label.toLowerCase(),[field]);
    }
    function checkbox(parent,label,checked,change){const row=document.createElement('label'),input=controls.register(document.createElement('input'));input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',label);row.append(input,label);input.addEventListener('change',()=>{if(controls.current())change(input.checked);});parent.append(row);}
    checkbox(manual,'Title italic',title.italic,value=>submit({italic:value}));
    for(const field of ['underline','strikethrough'])checkbox(parent,`Title ${field}`,title[field],value=>submit({[field]:value}));
    reset(parent,'title decorations',['underline','strikethrough']);
    function choice(parent,label,value,values,change){const row=document.createElement('label'),select=controls.register(document.createElement('select'));row.className='field';row.textContent=label;select.setAttribute('aria-label',label);for(const value of values)select.append(new Option(value,value));select.value=value;row.append(select);select.addEventListener('change',()=>{if(controls.current() && values.includes(select.value))change(select.value);});parent.append(row);}
    const caseRow=document.createElement('label'),caseChoice=controls.register(document.createElement('button'));caseRow.className='field';caseRow.textContent='Title case';caseChoice.value=title.case;caseRow.append(caseChoice);parent.append(caseRow);
    controls.own(createTransitionChoice(caseChoice,{label:'Title case',values:['Mixed','Upper','Lower','Title'],canInteract:controls.available,notice:options.notice,onPreview:value=>options.previewInspectorChoice?.(value===null?null:{kind:'title_case',case:value}),onConfirm:value=>submit({case:value})}));reset(parent,'title case',['case']);
    choice(parent,'Title alignment',title.align,['Left','Center','Right','Justify'],value=>submit({align:value}));reset(parent,'title alignment',['align']);
    choice(parent,'Title horizontal anchor',title.anchor[0],['Left','Center','Right'],value=>submit({anchor:[value,title.anchor[1]]}));
    choice(parent,'Title vertical anchor',title.anchor[1],['Top','Middle','Bottom'],value=>submit({anchor:[title.anchor[0],value]}));reset(parent,'title anchor',['anchor']);
    const size=options.timelineSize,hasSize=Array.isArray(size) && size.length===2 && size.every(value=>Number.isFinite(value) && value>0);
    for(const axis of [0,1]){const offset=hasSize?size[axis]/2:0;selectedNumber(parent,`Title position ${axis?'Y':'X'}${hasSize?' (from bottom-left)':' (from center)'}`,{value:title.position[axis]+offset,min:hasSize?-size[axis]:-1_000_000,max:hasSize?size[axis]*2:1_000_000},controls,value=>submit({position:title.position.map((current,index)=>index===axis?value-offset:current)}));}reset(parent,'title position',['position']);
    colorRow(parent,'Title color',title.color,color=>submit({color}));reset(parent,'title color',['color']);
    const background=group('Selected title background'),bg=title.background,backgroundPatch=patch=>submit({background:{...structuredClone(bg),...patch}});
    checkbox(background,'Title background enabled',bg.enabled,enabled=>backgroundPatch({enabled}));reset(background,'title background',['background']);
    if(bg.enabled){
    colorRow(background,'Background color',bg.color,color=>backgroundPatch({color}));colorRow(background,'Background outline color',bg.outline_color,outline_color=>backgroundPatch({outline_color}));
    reset(background,'background color',['background_color']);reset(background,'background outline color',['background_outline_color']);
    for(const [label,field,min,max,speed] of [['Background outline width','outline_width',0,100,0.5],['Background width','width',0,1,0.005],['Background height','height',0,1,0.005],['Background corner radius','corner_radius',0,0.5,0.005],['Background opacity','opacity',0,100,0.5]]){const row=selectedNumber(background,label,{value:bg[field],min,max,speed,slider:true},controls,value=>backgroundPatch({[field]:value}));reset(row,label.toLowerCase(),[`background_${field}`]);}
    for(const axis of [0,1])selectedNumber(background,`Background center ${axis?'Y':'X'}`,{value:bg.center[axis],min:hasSize?-size[axis]:-1_000_000,max:hasSize?size[axis]:1_000_000},controls,value=>backgroundPatch({center:bg.center.map((current,index)=>index===axis?value:current)}));
    reset(background,'background center',['background_center']);
    }
    const shadow=detail.filters?.stack.some(filter=>filter.kind==='DropShadow');checkbox(parent,'Title drop shadow',shadow,enabled=>controls.submit({action:'title_shadow',enabled}));
  }
  const solid=Object.hasOwn(detail,'color_info')?detail.color_info:detail.color?{value:detail.color}:null;
  if(solid){
    const parent=group('Selected solid color'),info=solid;
    colorRow(parent,'Solid color',info.value,value=>controls.submit({action:'solid_color',value}));keyDiamond(parent,'solid color',[info],controls,{action:'toggle_color_key'});
  }
  return [...renderSelectedFilters(section,detail,{controls,keyRow:(parent,label,parameters,edit)=>keyDiamond(parent,label,parameters,controls,edit),openState:options.visualState || new Map(),notice:options.notice,timelineSize:options.timelineSize,bindNumber:bindInspectorNumber,onPreview:options.previewInspectorChoice}),controls];
}
export function transformPatch(param,value,linked=false){return {transform:zoomParameters(param,linked).map(param=>({param,value}))};}
export function keyframeOperation(clip, target, frame, value, interpolation = "Linear",linked=false) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Choose an integer timeline frame");
  const edit={target,timeline_frame:frame,value,interpolation};
  const params=target.kind==="transform"?zoomParameters(target.param,linked):[];
  return params.length===2?{kind:"set_keyframes",clip_id:clip,edits:params.map(param=>({...edit,target:{kind:"transform",param}}))}:{kind:"set_keyframe",clip_id:clip,edit};
}
export function keyPageIndex(value,total) {
  const page=Number(value);
  if(!Number.isSafeInteger(page) || page<1 || page>total)throw Error(`Choose a key page from 1 to ${total}`);
  return page-1;
}
export function bindKeyEditorDelete(root,{selection,remove,canInteract,documentRef=globalThis.document}){
  let disposed=false;
  const keydown=event=>{
    if(disposed || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.getModifierState?.('AltGraph') || !['Delete','Backspace'].includes(event.key) || event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || documentRef.querySelector?.('dialog[open]') || !selection.get().length)return;
    event.preventDefault();event.stopPropagation();
    if(canInteract())remove();
  };
  root.addEventListener('keydown',keydown);
  return {cancel(){},dispose(){disposed=true;root.removeEventListener('keydown',keydown);}};
}
export function renderProperties(root, detail, { writable, getFrame, commit, reload, notice, visualState, scope,setKeyPage,seek,canInteract=()=>true,canNavigate=canInteract,navigateSource,readCurveViewport,keyEditorRoot=root,transitionDefaults,compositing=true,transformControls=true,gainControls=true,titleControls=true,colorControls=true,filterControls=true,retimeControls=true,zoomLink:sharedZoomLink,drawMaskPath,maskCommit,previewInspectorChoice }) {
  const disabled = !writable || detail.locked;
  if(detail.key_page && keyEditorRoot && detail.key_page.total_pages>1){
    const page=detail.key_page,form=document.createElement("form"),label=document.createElement("label"),input=document.createElement("input"),previous=document.createElement("button"),next=document.createElement("button"),go=document.createElement("button"),note=document.createElement("p");
    label.className="field";label.textContent="Native key page";input.type="number";input.min=1;input.max=page.total_pages;input.step=1;input.required=true;input.value=page.index+1;label.append(input);
    previous.type=next.type="button";previous.textContent="Previous key page";next.textContent="Next key page";go.textContent="Read key page";previous.disabled=page.index===0;next.disabled=page.index+1>=page.total_pages;
    previous.addEventListener("click",()=>setKeyPage(page.index-1));next.addEventListener("click",()=>setKeyPage(page.index+1));form.addEventListener("submit",event=>{event.preventDefault();if(form.reportValidity()){try{setKeyPage(keyPageIndex(input.value,page.total_pages));}catch(error){notice(error.message);}}});
    const pager=document.createElement('details'),summary=document.createElement('summary');pager.dataset.visualPath='key-page-controls';pager.open=visualState?.get(pager.dataset.visualPath) ?? false;summary.textContent='Key pages';pager.append(summary,form);
    note.className="muted";note.textContent=`Page ${page.index+1} of ${page.total_pages} · up to ${page.page_size} keys per parameter. Curve and value-key selections apply to this page; cross-parameter selection retains keys from other pages.`;form.append(label,previous,next,go,note);keyEditorRoot.append(pager);
    if(scope && visualState?.get("key-page-focus")===scope){pager.open=true;visualState.delete("key-page-focus");queueMicrotask(()=>{if(input.isConnected)input.focus({preventScroll:true});});}
  }
  const zoomLink=sharedZoomLink || createZoomLink(visualState);
  let waiting=false;const compositingBindings=[];
  const guardedCommit=async operation=>{if(waiting || disabled || root.isConnected===false || section.isConnected===false || !canInteract())return;waiting=true;try{await Promise.resolve();if(root.isConnected===false || section.isConnected===false || !canInteract())return;return await commit(operation);}finally{waiting=false;}};
  const report = (operation) => guardedCommit(operation).catch((error) => notice(error.message));
  const section = document.createElement("details");section.dataset.visualPath='clip-properties';section.open = visualState?.get(section.dataset.visualPath) ?? (transformControls || gainControls);section.className='inspector-advanced';
  const heading = document.createElement("summary"); heading.textContent = transformControls && gainControls ? "Properties and keyframes" : "Clip properties and key editors"; section.append(heading);
  const note = document.createElement("p"); note.className = "muted";
  note.textContent = `Native evaluation at timeline frame ${detail.timeline_frame} / source frame ${detail.source_frame}. ${transformControls && gainControls?'Apply sets the default; ◆ writes at the playhead.':'Fade lengths remain local to this clip. Dedicated key and curve editors below use this clip’s source frames.'}`;
  inspectorHelp(section,note,'Clip evaluation and key editors');
  const refresh = document.createElement("button"); refresh.textContent = "Read at playhead"; refresh.addEventListener("click", reload); section.append(refresh);
  const interpolation = document.createElement("select"); interpolation.setAttribute("aria-label", "Keyframe interpolation");
  for (const name of ["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut"]) interpolation.append(new Option(name, name));
  if(detail.video?transformControls:gainControls)section.append(interpolation);
  function number(label, value, min, max, patch, target = null, keys = [],keyCount=keys.length) {
    const form = document.createElement("form"); form.className = "property-row";
    const field = document.createElement("label"); field.className = "field"; field.textContent = label;
    const input = document.createElement("input"); input.type = "number"; input.step = "any"; input.min = min; input.max = max; input.value = value; input.disabled = disabled;
    field.append(input); form.append(field);
    const apply = document.createElement("button"); apply.textContent = "Apply"; apply.disabled = disabled;
    form.append(apply); form.addEventListener("submit", (event) => { event.preventDefault(); if (form.reportValidity()) report(propertyOperation(detail.clip_id, patch(Number(input.value)))); });
    if (target) for (const [text, remove] of [["◆", false], ["−◆", true]]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.disabled = disabled;
      button.setAttribute("aria-label", `${remove ? "Remove" : "Set"} ${label} keyframe at playhead`);
      button.addEventListener("click", () => { if (form.reportValidity()) report(keyframeOperation(detail.clip_id, target, getFrame(), remove ? null : Number(input.value), interpolation.value,zoomLink.get())); });
      form.append(button);
    }
    section.append(form);
    if (keys.length) {
      const list = document.createElement("p"); list.className = "muted keyframe-list";
      list.textContent = `Source keyframes: ${keys.map(([frame, value, mode]) => `${frame}: ${value} (${typeof mode === "string" ? mode : "Bezier"})`).join(", ")}${keyCount>keys.length?` · ${keys.length} of ${keyCount} summarized; use native key pages for all keys`:""}`;
      section.append(list);
    }
  }
  if (detail.video) {
    if(transformControls){
    const linkLabel=document.createElement("label"),linkInput=document.createElement("input");linkInput.type="checkbox";linkInput.disabled=disabled;zoomLink.register(linkInput);linkLabel.append(linkInput," Link Zoom X/Y");section.append(linkLabel);
    for (const parameter of detail.transform) number(parameter.param, parameter.value, parameter.min, parameter.max, (value) => transformPatch(parameter.param,value,zoomLink.get()), { kind: "transform", param: parameter.param }, parameter.keyframes,parameter.key_count);
    }
    if(compositing){
      const captured=JSON.stringify([detail.project_epoch,detail.generation,detail.timeline_id,detail.revision,detail.clip_id,detail.timeline_frame,detail.source_frame]);
      compositingBindings.push(renderCompositingChoices(section,detail,{disabled,current:()=>!waiting && root.isConnected!==false && canInteract() && getFrame()===detail.timeline_frame && JSON.stringify([detail.project_epoch,detail.generation,detail.timeline_id,detail.revision,detail.clip_id,detail.timeline_frame,detail.source_frame])===captured,commit,notice,onPreview:previewInspectorChoice,operation:(key,value)=>propertyOperation(detail.clip_id,{[key]:value})}));
    }
    if(transformControls)for (const [index, label] of [[0, "Flip horizontal"], [1, "Flip vertical"]]) {
      const button = document.createElement("button"); button.textContent = label; button.disabled = disabled; button.setAttribute("aria-pressed", detail.flip[index]);
      button.addEventListener("click", () => { const flip = [...detail.flip]; flip[index] = !flip[index]; report(propertyOperation(detail.clip_id, { flip })); }); section.append(button);
    }
    if (colorControls && detail.color) {
      const form = document.createElement("form"); const fields = {};
      for (const name of ["r", "g", "b", "a"]) {
        const label = document.createElement("label"); label.className = "field"; label.textContent = `Color ${name.toUpperCase()}`;
        const input = document.createElement("input"); input.type = "number"; input.min = 0; input.max = 1; input.step = "any"; input.value = detail.color[name]; input.disabled = disabled;
        fields[name] = input; label.append(input); form.append(label);
      }
      const apply = document.createElement("button"); apply.textContent = "Apply RGBA"; apply.disabled = disabled; form.append(apply);
      form.addEventListener("submit", (event) => { event.preventDefault(); report(propertyOperation(detail.clip_id, { color: Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,Number(input.value)])) })); }); section.append(form);
    }
  } else if(gainControls)number("Gain dB", detail.gain.value, -100, 30, (gain_db) => ({ gain_db }), { kind: "gain" }, detail.gain.keyframes,detail.gain.key_count);
  number("Fade in frames", detail.fade_in, 0, detail.length_frames, (fade_in) => ({ fade_in }));
  number("Fade out frames", detail.fade_out, 0, detail.length_frames, (fade_out) => ({ fade_out }));
  root.append(section);
  const retime=renderRetime(root,detail,disabled,getFrame,report,visualState,canInteract,{speedControls:retimeControls,notice});
  const controls=detail.video && filterControls ? renderFilters(root,detail,{disabled,getFrame,commit:guardedCommit,notice,openState:visualState,canInteract}) : [];
  controls.push(...compositingBindings);
  if(retime)controls.push(retime);
  if(keyEditorRoot){
    const selectedKeys=createKeyPickSelection(visualState,scope ?? detail.clip_id);
    const curves=renderCurves(keyEditorRoot,detail,{disabled,commit,notice,openState:visualState,scope,zoomLink,canInteract,seek,canNavigate,navigateSource,readCurveViewport,keySelection:selectedKeys,presentation:keyEditorRoot===root?'inline':'window'});if(curves)controls.push(curves);
    const eventKeys=renderEventKeys(keyEditorRoot,detail,{disabled,commit,notice,openState:visualState,scope,canInteract,seek,canNavigate,navigateSource,keySelection:selectedKeys});if(eventKeys)controls.push(eventKeys);
    const keySelection=renderKeySelection(keyEditorRoot,detail,{disabled,commit,notice,openState:visualState,scope,zoomLink,reload,canInteract,keySelection:selectedKeys});if(keySelection)controls.push(keySelection);
    if(keyEditorRoot!==root && keySelection)controls.push(bindKeyEditorDelete(keyEditorRoot.closest?.('[data-key-editor-window]') || keyEditorRoot,{selection:selectedKeys,remove:keySelection.removeSelected,canInteract:()=>!disabled && keyEditorRoot.isConnected!==false && canInteract()}));
  }
  if(detail.video){const masks=renderMasks(root,detail,{disabled,getFrame,commit:maskCommit || commit,notice,openState:visualState,seek,canInteract,drawPath:drawMaskPath,bindNumber:bindInspectorNumber,onPreview:previewInspectorChoice});if(masks)controls.push(masks);}
  if (titleControls && detail.title) renderTitle(root,detail,disabled,report);
  if (detail.video) renderTransitions(root,detail,disabled,report,transitionDefaults,notice);
  return controls;
}

export function renderRetime(root,detail,disabled,getFrame,report,openState,canInteract=()=>true,{selection,getSelection,frame=getFrame(),labelControls=true,speedControls=true,cancelButton=true,notice=()=>{}}={}) {
  if(selection && (!selection.clip_ids?.length || selection.clip_ids[0]!==detail.clip_id || !detail.retime || detail.locked))return;
  const captured=selection?structuredClone(selection):null,identity=JSON.stringify(captured),ids=captured?.clip_ids || [detail.clip_id],controls=[];
  const documentRef=root.ownerDocument ?? document;
  const section=inspectorGroup(document.createElement("details"),'selection'),summary=document.createElement("summary");section.dataset.visualPath=labelControls && !speedControls?"clip-label":"retime";section.open=openState?.get(section.dataset.visualPath) || false;summary.textContent=labelControls?(speedControls?"Speed, freeze and clip label":"Clip label"):"Selected media speed and freeze";section.append(summary);
  let waiting=false,outcomeUnknown=false,disposed=false,scrub=null;
  const listeners=[],listen=(node,key,handler)=>{node?.addEventListener?.(key,handler);listeners.push(()=>node?.removeEventListener?.(key,handler));};
  const current=()=>!disposed && !disabled && !documentRef.hidden && root.isConnected!==false && section.isConnected!==false && canInteract() && getFrame()===frame && (!captured || JSON.stringify(getSelection?.())===identity);
  const sync=()=>{for(const control of controls)control.disabled=waiting || outcomeUnknown || !current();};
  const register=node=>{controls.push(node);node.disabled=!current();return node;};
  const apply=operation=>{
    if(waiting || outcomeUnknown)return;
    if(!current()){notice('Media selection changed; read its current speed before editing');return;}
    waiting=true;sync();
    return Promise.resolve().then(()=>{if(!current())throw Error('Media selection changed; read its current speed before editing');return report(operation);}).catch(error=>{if(error.code==='OUTCOME_UNKNOWN')outcomeUnknown=true;if(!disposed)notice(error.message);}).finally(()=>{waiting=false;if(!disposed)sync();});
  };
  if(captured){const note=document.createElement('p');note.className='muted';note.textContent=`Values from the first selected media clip · edits apply to ${ids.length} selected unlocked media clip${ids.length===1?'':'s'} and their native linked groups. Freeze clamps the playhead separately to each clip; Undo restores the edit.`;inspectorHelp(section,note);}
  if(labelControls){
    const color=register(document.createElement("select"));color.setAttribute("aria-label","Clip display color");color.append(new Option("Default",""));
    for (const name of detail.display_colors) color.append(new Option(name,name));color.value=detail.display_color || "";
    const applyColor=register(document.createElement("button"));applyColor.type='button';applyColor.textContent="Apply clip label";applyColor.addEventListener("click",()=>apply({kind:"set_display_color",clip_ids:[detail.clip_id],color:color.value || null}));section.append(color,applyColor);
  }
  if (speedControls && detail.retime) {
    const form=document.createElement("form"),row=document.createElement('div'),label=document.createElement("label");row.className='tools';label.className="field";label.textContent="Speed percent";
    const percent=register(document.createElement("input"));percent.type="number";percent.min=1;percent.max=10000;percent.step="any";percent.value=detail.retime.speed_percent;percent.required=true;percent.setAttribute('aria-label','Speed percent');percent.title='Drag: 1% per pixel; Shift: fine control. Two decimal places while dragging. Apply commits the draft.';label.append(percent);row.append(label);form.append(row);
    const draftCurrent=()=>current() && !waiting && !outcomeUnknown && section.open;
    const presets=[];
    const syncPresets=()=>{for(const [value,button] of presets)button.setAttribute('aria-pressed',String(String(percent.value).trim()!=='' && Number(percent.value)===value));};
    for(const value of [50,100,200]){
      const button=register(document.createElement('button'));button.type='button';button.textContent=`${value}%`;button.setAttribute('aria-label',`Draft speed ${value}%`);presets.push([value,button]);row.append(button);
      listen(button,'click',()=>{if(!draftCurrent())return;scrub?.cancel();percent.value=String(value);syncPresets();});
    }
    listen(percent,'input',syncPresets);listen(percent,'change',syncPresets);
    scrub=bindInspectorNumber(percent,{canInteract:draftCurrent,apply:syncPresets,speed:1,decimals:2});
    const fit=register(document.createElement("select"));fit.setAttribute("aria-label","Speed duration policy");
    for (const [value,text] of [["keep_length","Keep length (capped by source)"],["resize","Resize safely, leave neighbours"],["ripple","Ripple unlocked tracks"]]) fit.append(new Option(text,value));fit.value="ripple";form.append(fit);
    const pitchLabel=document.createElement("label");pitchLabel.textContent="Preserve pitch";const pitch=register(document.createElement("input"));pitch.type="checkbox";pitch.checked=detail.retime.pitch_correction;pitchLabel.append(pitch);form.append(pitchLabel);
    const applySpeed=register(document.createElement("button"));applySpeed.textContent="Apply speed";form.append(applySpeed);
    const cancelDraft=()=>{scrub.cancel();percent.value=detail.retime.speed_percent;fit.value='ripple';pitch.checked=detail.retime.pitch_correction;syncPresets();};
    if(cancelButton){const cancel=register(document.createElement('button'));cancel.type='button';cancel.textContent='Cancel speed changes';listen(cancel,'click',()=>{if(draftCurrent())cancelDraft();});form.append(cancel);}
    listen(form,'submit',event=>{event.preventDefault();scrub.cancel();const value=Number(percent.value);if(String(percent.value).trim() && Number.isFinite(value) && value>=1 && value<=10000 && ['keep_length','resize','ripple'].includes(fit.value) && form.reportValidity())apply({kind:"set_speed",clip_ids:[...ids],percent:value,pitch_correction:pitch.checked,fit:fit.value});});
    listen(form,'keydown',event=>{
      if(event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey)return;
      if(['Enter',' '].includes(event.key))event.stopPropagation();
      if(cancelButton && event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelDraft();}
    });
    listen(section,'toggle',()=>{if(!section.open){scrub.cancel();syncPresets();}});
    listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden){scrub.cancel();syncPresets();}});
    syncPresets();section.append(form);
    const status=document.createElement("p");status.className="muted";status.textContent=detail.retime.freeze_source_frame === null ? "Normal motion · edits include linked clips" : `Frozen at source frame ${detail.retime.freeze_source_frame} · linked clips follow native freeze semantics`;section.append(status);
    for (const [text,value] of [["Freeze at playhead",frame],["Unfreeze",null]]) {
      const button=register(document.createElement("button"));button.type='button';button.textContent=text;button.addEventListener("click",()=>{if(value===null || Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000)apply({kind:"set_freeze",clip_ids:[...ids],frame:value});});section.append(button);
    }
    if(openState?.get('retime-focus')===detail.clip_id){openState.delete('retime-focus');section.open=true;queueMicrotask(()=>{if(current() && percent.isConnected && !percent.disabled)percent.focus({preventScroll:true});});}
  }
  root.append(section);sync();
  return {cancel(){scrub?.cancel();},dispose(){if(disposed)return;disposed=true;scrub?.dispose();for(const remove of listeners)remove();sync();}};
}

function renderTitle(root, detail, disabled, report) {
  const section = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Title typography"; section.append(summary);
  const form = document.createElement("form"), fields = {};
  function field(name,key,type,value,min,max) {
    const label = document.createElement("label"); label.className = key === "text" ? "field text-field" : "field"; label.textContent = name;
    const input = document.createElement(key === "text" ? "textarea" : "input");
    if (key !== "text") input.type = type;
    if (type === "checkbox") input.checked = value; else input.value = value;
    if (type === "number") {input.min=min;input.max=max;input.step="any";}
    input.disabled = disabled; if (type === "text") input.maxLength = key === "text" ? 4096 : 128;
    fields[key]=input;label.append(input);form.append(label);
  }
  field("Title text","text","text",detail.title.content.default);
  field("Font family (server)","font_family","text",detail.title.font_family);
  field("Font size","size","number",detail.title.size,1,1000);
  field("Font weight","font_weight","number",detail.title.font_weight,100,900); fields.font_weight.step=1;
  for (const key of ["italic","underline","strikethrough"]) field(key,key,"checkbox",detail.title[key]);
  field("Letter tracking","tracking","number",detail.title.tracking,-300,1000);
  field("Line spacing","line_spacing","number",detail.title.line_spacing,-200,500);
  const align = document.createElement("select");align.setAttribute("aria-label","Title alignment");align.disabled=disabled;
  for (const name of ["Left","Center","Right","Justify"]) align.append(new Option(name,name));align.value=detail.title.align;form.append(align);
  for (const key of ["r","g","b","a"]) field(`Title color ${key.toUpperCase()}`,`color_${key}`,"number",detail.title.color[key],0,1);
  field("Title background","background_enabled","checkbox",detail.title.background.enabled);
  const button=document.createElement("button");button.textContent="Apply typography";button.disabled=disabled;form.append(button);
  form.addEventListener("submit",(event)=>{
    event.preventDefault();if (!form.reportValidity()) return;
    const title={align:align.value,color:{},background:{...detail.title.background,enabled:fields.background_enabled.checked}};
    for (const [key,input] of Object.entries(fields)) {
      if (key.startsWith("color_")) title.color[key.slice(6)]=Number(input.value);
      else if (key !== "background_enabled") title[key]=input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    }
    report(propertyOperation(detail.clip_id,{title}));
  });
  section.append(form);root.append(section);
}
export function transitionSelectionOperation(target,patch){
  if(!target || !['in','out','cut_after'].includes(target.slot) || typeof target.clip_id!=='string' || !target.transition)throw Error('Choose a current native transition');
  if(patch===null)return {kind:'set_transition',clip_id:target.clip_id,slot:target.slot,transition:null};
  if(!patch || Object.keys(patch).some(name=>!['duration','direction','ease','curve'].includes(name)))throw Error('Choose transition duration, direction, ease or curve');
  const value={...structuredClone(target.transition),...patch};
  if(!Number.isSafeInteger(value.duration) || value.duration<1 || value.duration>target.max || !['Left','Right','Up','Down'].includes(value.direction) || !['None','In','Out','InOut'].includes(value.ease) || !Number.isFinite(value.curve) || value.curve<0 || value.curve>1)throw Error('Choose transition values within the native limits');
  return Object.keys(value).every(key=>value[key]===target.transition[key])?null:{kind:'set_transition',clip_id:target.clip_id,slot:target.slot,transition:value};
}
export function renderTransitionSelection(root,target,options){
  return renderTransitionControls(root,target,{...options,bindNumber:bindInspectorNumber,operation:transitionSelectionOperation});
}
function renderTransitions(root, detail, disabled, report,defaults=[],notice) {
  const section=document.createElement("details"),summary=document.createElement("summary");section.dataset.visualPath='transitions';summary.textContent="Transitions";section.append(summary);
  for (const [slot,label] of [["in","Transition in"],["out","Transition out"],["cut_after","Crossing to next clip"]]) {
    if (slot === "cut_after" && !detail.transitions.cut_max_frames) continue;
    const form=document.createElement("form"),legend=document.createElement("strong");legend.textContent=label;form.append(legend);
    const value=detail.transitions[slot],kind=document.createElement("select");kind.setAttribute("aria-label",`${label} kind`);kind.disabled=disabled;
    for (const name of ["None","Push","CrossDissolve","SmoothCut"])kind.append(new Option(name,name));kind.value=value?.kind || "None";form.append(kind);
    const initial=value || defaults.find(item=>item.kind==='Push');
    const duration=document.createElement("input");duration.type="number";duration.min=1;duration.max=slot === "cut_after" ? detail.transitions.cut_max_frames : detail.length_frames;duration.step=1;duration.value=initial?Math.min(initial.duration,Number(duration.max)):'';duration.setAttribute("aria-label",`${label} duration frames`);duration.disabled=disabled;form.append(duration);
    const direction=document.createElement("select");direction.setAttribute("aria-label",`${label} direction`);direction.disabled=disabled;for(const name of ["Left","Right","Up","Down"])direction.append(new Option(name,name));direction.value=initial?.direction || "Right";direction.hidden=kind.value!=='Push';form.append(direction);
    const ease=document.createElement("select");ease.setAttribute("aria-label",`${label} ease`);ease.disabled=disabled;for(const name of ["None","In","Out","InOut"])ease.append(new Option(name,name));ease.value=initial?.ease || "None";form.append(ease);
    const curve=document.createElement("input");curve.type="number";curve.min=0;curve.max=1;curve.step="any";curve.value=value?.curve ?? 0.5;curve.setAttribute("aria-label",`${label} curve`);curve.disabled=disabled;form.append(curve);
    const apply=document.createElement("button");apply.textContent=`Apply ${label.toLowerCase()}`;apply.disabled=disabled;form.append(apply);
    kind.addEventListener('change',()=>{direction.hidden=kind.value!=='Push';if(!value){const preset=defaults.find(item=>item.kind===kind.value);if(preset){duration.value=Math.min(preset.duration,Number(duration.max));direction.value=preset.direction;ease.value=preset.ease;curve.value=preset.curve;}}});
    form.addEventListener("submit",(event)=>{event.preventDefault();if(kind.value!=='None' && !value && !defaults.some(item=>item.kind===kind.value)){notice('Read native transition defaults before creating a transition');return;}if(form.reportValidity())report({kind:"set_transition",clip_id:detail.clip_id,slot,transition:kind.value === "None" ? null : {kind:kind.value,duration:Number(duration.value),direction:direction.value,ease:ease.value,curve:Number(curve.value)}});});
    section.append(form);
  }
  root.append(section);
}

export function renderMarkers(root, timeline, { writable, getFrame, commit, seek, notice, selectedId = null, onSelect = () => {}, openState }) {
  const section = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = `Timeline markers (${timeline.markers.length})`; section.append(summary);
  section.dataset.visualPath="markers"; section.open=openState?.get("markers") || false;
  const form = document.createElement("form");
  const select = document.createElement("select"); select.setAttribute("aria-label","Marker to edit"); select.append(new Option("New marker at playhead", ""));
  for (const marker of timeline.markers) select.append(new Option(`${marker.start_frame} · ${marker.note.slice(0,60) || marker.id}`,marker.id));
  if(timeline.markers.some(marker=>marker.id===selectedId))select.value=selectedId;
  form.append(select);
  function field(name, type, value) {
    const label = document.createElement("label"); label.className = "field"; label.textContent = name;
    const input = document.createElement("input"); input.type = type; input.value = value; input.disabled = !writable;
    if (type === "number") { input.min = 0; input.max = 1_000_000_000; input.step = 1; } else input.maxLength = 4096;
    label.append(input); form.append(label); return input;
  }
  const start = field("Marker start frame","number",getFrame()), duration = field("Marker duration frames","number",0), note = field("Marker note","text","");
  const color = document.createElement("select"); color.setAttribute("aria-label","Marker color"); color.disabled = !writable;
  for (const name of timeline.marker_colors) color.append(new Option(name,name)); color.value = "Orange"; form.append(color);
  const submit = document.createElement("button"); submit.textContent = "Apply marker"; submit.disabled = !writable; form.append(submit);
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove marker"; remove.disabled = !writable || !select.value; form.append(remove);
  const jump = document.createElement("button"); jump.type = "button"; jump.textContent = "Go to marker"; jump.disabled = !select.value; form.append(jump);
  const load = () => {
    const marker = timeline.markers.find((m) => m.id === select.value);
    start.value = marker?.start_frame ?? getFrame(); duration.value = marker?.duration_frames ?? 0; note.value = marker?.note ?? ""; color.value = marker?.color ?? "Orange";
    remove.disabled = !writable || !marker; jump.disabled = !marker;
  };
  select.addEventListener("change",()=>{onSelect(select.value);load();}); load();
  const apply = (deleting) => commit({kind:"set_marker",marker:{id:select.value || null,delete:deleting,start_frame:Number(start.value),duration_frames:Number(duration.value),note:note.value,color:color.value}}).catch((error)=>notice(error.message));
  form.addEventListener("submit",(event)=>{event.preventDefault(); if (form.reportValidity()) apply(false);}); remove.addEventListener("click",()=>apply(true));
  jump.addEventListener("click",()=>seek(Number(start.value)));
  section.append(form); root.append(section);
}
