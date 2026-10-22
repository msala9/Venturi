import {renderFilters} from "./visual.js";
import {renderMasks} from "./masks.js";
import {renderCurves,createZoomLink,zoomParameters} from "./curves.js";
import {renderEventKeys} from "./eventkeys.js";
import {renderKeySelection} from "./keyselection.js";

export function detailIdentity(state) {
  return state ? [state.project_epoch, state.generation, state.timeline, state.revision, state.clip, state.frame,state.key_page].join(":") : null;
}
export function propertyOperation(clip, patch) { return { kind: "set_properties", clip_id: clip, patch }; }
function propertySelection({project_epoch,generation,timeline,selection}={},kind){
  if(typeof project_epoch!=='string' || !project_epoch || typeof generation!=='string' || !generation || typeof timeline?.id!=='string' || typeof timeline.revision!=='string' || !Array.isArray(timeline.tracks) || !Array.isArray(selection) || !selection.length || selection.some(id=>typeof id!=='string' || !id) || new Set(selection).size!==selection.length)return null;
  const all=new Set(timeline.tracks.flatMap(track=>track.clips.map(clip=>clip.id)));
  if(selection.some(id=>!all.has(id)))return null;
  const selected=new Set(selection),decimal=id=>/^\d{1,20}$/.test(id) && BigInt(id)<=18446744073709551615n;
  const clip_ids=timeline.tracks.filter(track=>track.kind===kind && !track.locked).flatMap(track=>{
    const clips=track.clips.filter(clip=>selected.has(clip.id));
    // Native panel targets sort by start, preserving ClipKey order for ties.
    if(clips.every(clip=>decimal(clip.id)))clips.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
    clips.sort((a,b)=>a.start_frame-b.start_frame);
    return clips.map(clip=>clip.id);
  });
  return clip_ids.length && clip_ids.length<=4096?{project_epoch,generation,timeline_id:timeline.id,revision:timeline.revision,selection:[...selection].sort(),clip_ids}:null;
}
export function videoPropertySelection(state){return propertySelection(state,'video');}
export function audioPropertySelection(state){return propertySelection(state,'audio');}
export function renderBlendMatte(root,detail,{selection,getSelection,canInteract,commit,notice,primaryName=''}){
  if(!selection?.clip_ids?.length || detail.clip_id!==selection.clip_ids[0] || !detail.video || detail.locked)return;
  const captured=structuredClone(selection),identity=JSON.stringify(captured),section=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('p');
  section.open=true;summary.textContent='Selected video compositing';note.className='muted';note.textContent=`Values from ${primaryName || 'the first selected video clip'} · changes apply to ${captured.clip_ids.length} selected unlocked video clip${captured.clip_ids.length===1?'':'s'}.`;section.append(summary,note);
  let waiting=false;
  const current=()=>root.isConnected!==false && canInteract() && JSON.stringify(getSelection())===identity;
  const controls=[];
  for(const [label,key,value,values] of [['Blend mode','blend',detail.blend,detail.blends],['Track matte','matte',detail.matte,detail.mattes]]){
    const field=document.createElement('label'),select=document.createElement('select');field.className='field';field.textContent=label;select.setAttribute('aria-label',label);
    for(const name of values)select.append(new Option(name,name));select.value=value;select.disabled=!current();field.append(select);section.append(field);controls.push(select);
    select.addEventListener('change',()=>{
      if(waiting)return;
      if(!current()){notice('Video selection changed; read its current properties before editing');return;}
      if(!values.includes(select.value)){notice('Choose an available native compositing value');return;}
      const operation={kind:'set_properties_batch',clip_ids:[...captured.clip_ids],patch:{[key]:select.value}};
      waiting=true;for(const control of controls)control.disabled=true;
      Promise.resolve().then(()=>{if(!current())throw Error('Video selection changed; read its current properties before editing');return commit(operation);}).catch(error=>notice(error.message)).finally(()=>{waiting=false;for(const control of controls)control.disabled=!current();});
    });
  }
  root.append(section);
}
const TRANSFORM_ROWS=[['Zoom',['ZoomX','ZoomY']],['Position',['PositionX','PositionY']],['Rotation',['Rotation']],['Anchor',['AnchorX','AnchorY']]];
const CROP_ROWS=[['Crop left',['CropLeft']],['Crop right',['CropRight']],['Crop top',['CropTop']],['Crop bottom',['CropBottom']],['Crop softness',['CropSoftness']]];
const CROP_PARAMS=['CropLeft','CropTop','CropRight','CropBottom','CropSoftness'];
function selectedPropertyControls(root,detail,{selection,getSelection,frame,getFrame,canInteract,commit,notice,seek},video){
  if(!selection?.clip_ids?.length || detail.clip_id!==selection.clip_ids[0] || detail.video!==video || detail.locked || !Number.isSafeInteger(frame) || frame<0)return null;
  const captured=structuredClone(selection),identity=JSON.stringify(captured),controls=[],section=document.createElement('details');section.open=true;
  if(getFrame()!==frame || JSON.stringify(getSelection())!==identity)return null;
  let waiting=false;
  const current=()=>root.isConnected!==false && section.isConnected!==false && getFrame()===frame && canInteract() && JSON.stringify(getSelection())===identity;
  const sync=()=>{for(const [control,available] of controls)control.disabled=waiting || !current() || !available();};
  const register=(control,available=()=>true)=>{controls.push([control,available]);control.disabled=waiting || !current() || !available();return control;};
  const submit=edit=>{
    if(waiting)return;
    if(!current()){notice('Inspector selection changed; read its current properties before editing');return;}
    const operation={kind:'edit_inspector_selection',clip_ids:[...captured.clip_ids],timeline_frame:frame,edit};
    waiting=true;sync();
    Promise.resolve().then(()=>{if(!current())throw Error('Inspector selection changed; read its current properties before editing');return commit(operation);}).catch(error=>notice(error.message)).finally(()=>{waiting=false;sync();});
  };
  const button=(label,edit,parent)=>{const node=register(document.createElement('button'));node.type='button';node.textContent=label;node.setAttribute('aria-label',label);node.addEventListener('click',()=>submit(typeof edit==='function'?edit():edit));parent.append(node);return node;};
  const localButton=(label,frame,parent)=>{
    const node=register(document.createElement('button'),()=>typeof seek==='function' && Number.isSafeInteger(frame) && frame>=0);node.type='button';node.textContent=label;node.setAttribute('aria-label',label);
    node.addEventListener('click',()=>{if(!waiting && current() && typeof seek==='function' && Number.isSafeInteger(frame) && frame>=0)seek(frame);});parent.append(node);
  };
  const heading=document.createElement('summary');heading.textContent=video?'Selected video properties':'Selected audio gain';section.append(heading);
  root.append(section);
  return {section,register,button,localButton,submit,current};
}
function selectedNumber(parent,label,parameter,controls,apply){
  const form=document.createElement('form'),field=document.createElement('label'),input=controls.register(document.createElement('input'));
  form.className='property-row';field.className='field';field.textContent=label;
  input.type='number';input.step='any';input.required=true;input.value=parameter.value;input.min=parameter.min;input.max=parameter.max;input.setAttribute('aria-label',label);field.append(input);
  const button=controls.register(document.createElement('button'));button.textContent='Apply';button.setAttribute('aria-label',`Apply ${label}`);form.append(field,button);
  form.addEventListener('submit',event=>{event.preventDefault();const value=Number(input.value);if(String(input.value).trim() && Number.isFinite(value) && form.reportValidity())apply(value);});parent.append(form);
  return input;
}
function keyDiamond(parent,label,parameters,controls,edit){
  const button=controls.button(`Toggle ${label} keyframes at playhead`,edit,parent);button.textContent='◆';
  const known=parameters.every(parameter=>typeof parameter.keyframe_info?.on_keyframe==='boolean');
  if(known)button.setAttribute('aria-pressed',String(parameters.some(parameter=>parameter.keyframe_info.on_keyframe)));
  const previous=known?parameters.map(parameter=>parameter.keyframe_info.previous_frame).filter(Number.isSafeInteger):[],next=known?parameters.map(parameter=>parameter.keyframe_info.next_frame).filter(Number.isSafeInteger):[];
  controls.localButton(`Previous ${label} keyframe`,previous.length?Math.max(...previous):null,parent);
  controls.localButton(`Next ${label} keyframe`,next.length?Math.min(...next):null,parent);
}
export function renderSelectedVideoProperties(root,detail,options){
  const rows=[...TRANSFORM_ROWS,...CROP_ROWS,['Opacity',['Opacity']]],parameters=new Map(detail.transform?.map(parameter=>[parameter.param,parameter]));
  if(rows.some(([,params])=>params.some(param=>!Number.isFinite(parameters.get(param)?.value))) || !Array.isArray(detail.flip) || detail.flip.length!==2 || detail.flip.some(value=>typeof value!=='boolean'))return;
  const controls=selectedPropertyControls(root,detail,options,true);if(!controls)return;
  const {section}=controls,zoomLink=options.zoomLink || createZoomLink(options.visualState),note=document.createElement('p');note.className='muted';
  note.textContent=`Values from ${options.primaryName || 'the first selected video clip'} · edits apply to ${options.selection.clip_ids.length} selected unlocked video clip${options.selection.clip_ids.length===1?'':'s'}. Apply changes a constant default or writes a native key at each clip's clamped playhead. Position moves by the same delta; other axes use the shown value.`;section.append(note);
  function group(label,groupRows,resetFlip=false){
    const group=document.createElement('details'),heading=document.createElement('summary');group.open=true;heading.textContent=label;group.append(heading);section.append(group);
    const groupParams=label==='Crop'?CROP_PARAMS:groupRows.flatMap(([,params])=>params);
    if(label!=='Opacity')controls.button(`Reset ${label.toLowerCase()}`,{action:'reset_transform',params:groupParams,reset_flip:resetFlip},group);
    for(const [rowLabel,params] of groupRows){
      const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=rowLabel;row.append(legend);group.append(row);
      for(const param of params)selectedNumber(row,param,parameters.get(param),controls,value=>{
        const changed=zoomParameters(param,zoomLink.get()).filter(axis=>parameters.get(axis).value!==value).map(param=>({param,value}));
        if(changed.length)controls.submit({action:'transform',parameters:changed});
      });
      if(rowLabel==='Zoom'){
        const field=document.createElement('label'),link=controls.register(document.createElement('input'));link.type='checkbox';link.setAttribute('aria-label','Link selected Zoom X/Y');zoomLink.register(link);field.append(link,' Link Zoom X/Y');row.append(field);
        link.addEventListener('change',()=>{if(link.checked && parameters.get('ZoomY').value!==parameters.get('ZoomX').value)controls.submit({action:'transform',parameters:[{param:'ZoomY',value:parameters.get('ZoomX').value}]});});
      }
      keyDiamond(row,rowLabel,params.map(param=>parameters.get(param)),controls,{action:'toggle_transform_keys',params});
      controls.button(`Reset ${rowLabel.toLowerCase()} row`,{action:'reset_transform',params,reset_flip:false},row);
    }
    return group;
  }
  const transform=group('Transform',TRANSFORM_ROWS,true);
  for(const [axis,label] of [[0,'Flip horizontal'],[1,'Flip vertical']]){
    const button=controls.button(label,{action:'flip',axis,enabled:!detail.flip[axis]},transform);button.setAttribute('aria-pressed',String(detail.flip[axis]));
  }
  controls.button('Reset flip',{action:'reset_transform',params:[],reset_flip:true},transform);
  group('Crop',CROP_ROWS);
  group('Opacity',[['Opacity',['Opacity']]]);
  controls.button('Reset compositing',{action:'reset_compositing'},section);
}
export function renderSelectedAudioGain(root,detail,options){
  if(!Number.isFinite(detail.gain?.value))return;
  const controls=selectedPropertyControls(root,detail,options,false);if(!controls)return;
  const note=document.createElement('p');note.className='muted';note.textContent=`Values from ${options.primaryName || 'the first selected audio clip'} · edits apply to ${options.selection.clip_ids.length} selected unlocked audio clip${options.selection.clip_ids.length===1?'':'s'}. Apply changes a constant default or writes a native gain key at each clip's clamped playhead.`;controls.section.append(note);
  selectedNumber(controls.section,'Selected gain dB',{...detail.gain,min:-100,max:30},controls,value=>{if(value!==detail.gain.value)controls.submit({action:'gain',value});});
  keyDiamond(controls.section,'gain',[detail.gain],controls,{action:'toggle_gain_key'});
  controls.button('Reset gain',{action:'reset_gain'},controls.section);
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
export function renderProperties(root, detail, { writable, getFrame, commit, reload, notice, visualState, scope,setKeyPage,seek,canInteract,transitionDefaults,compositing=true,transformControls=true,gainControls=true,zoomLink:sharedZoomLink }) {
  const disabled = !writable || detail.locked;
  if(detail.key_page){
    const page=detail.key_page,form=document.createElement("form"),label=document.createElement("label"),input=document.createElement("input"),previous=document.createElement("button"),next=document.createElement("button"),go=document.createElement("button"),note=document.createElement("p");
    label.className="field";label.textContent="Native key page";input.type="number";input.min=1;input.max=page.total_pages;input.step=1;input.required=true;input.value=page.index+1;label.append(input);
    previous.type=next.type="button";previous.textContent="Previous key page";next.textContent="Next key page";go.textContent="Read key page";previous.disabled=page.index===0;next.disabled=page.index+1>=page.total_pages;
    previous.addEventListener("click",()=>setKeyPage(page.index-1));next.addEventListener("click",()=>setKeyPage(page.index+1));form.addEventListener("submit",event=>{event.preventDefault();if(form.reportValidity()){try{setKeyPage(keyPageIndex(input.value,page.total_pages));}catch(error){notice(error.message);}}});
    note.className="muted";note.textContent=`Page ${page.index+1} of ${page.total_pages} · up to ${page.page_size} keys per parameter. Curve and value-key selections apply to this page; cross-parameter selection retains keys from other pages.`;form.append(label,previous,next,go,note);root.append(form);
    if(visualState?.get("key-page-focus")===scope){visualState.delete("key-page-focus");queueMicrotask(()=>{if(input.isConnected)input.focus({preventScroll:true});});}
  }
  const zoomLink=sharedZoomLink || createZoomLink(visualState);
  const report = (operation) => commit(operation).catch((error) => notice(error.message));
  const section = document.createElement("details"); section.open = true;
  const heading = document.createElement("summary"); heading.textContent = transformControls && gainControls ? "Properties and keyframes" : "Clip properties and key editors"; section.append(heading);
  const note = document.createElement("p"); note.className = "muted";
  note.textContent = `Native evaluation at timeline frame ${detail.timeline_frame} / source frame ${detail.source_frame}. ${transformControls && gainControls?'Apply sets the default; ◆ writes at the playhead.':'Fade lengths remain local to this clip. Dedicated key and curve editors below use this clip’s source frames.'}`;
  section.append(note);
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
    function choice(label, value, values, patch) {
      const field = document.createElement("label"); field.className = "field"; field.textContent = label;
      const select = document.createElement("select"); select.disabled = disabled;
      for (const name of values) select.append(new Option(name, name)); select.value = value;
      select.addEventListener("change", () => report(propertyOperation(detail.clip_id, patch(select.value)))); field.append(select); section.append(field);
    }
    if(compositing){
      choice("Blend mode", detail.blend, detail.blends, (blend) => ({ blend }));
      choice("Track matte", detail.matte, detail.mattes, (matte) => ({ matte }));
    }
    if(transformControls)for (const [index, label] of [[0, "Flip horizontal"], [1, "Flip vertical"]]) {
      const button = document.createElement("button"); button.textContent = label; button.disabled = disabled; button.setAttribute("aria-pressed", detail.flip[index]);
      button.addEventListener("click", () => { const flip = [...detail.flip]; flip[index] = !flip[index]; report(propertyOperation(detail.clip_id, { flip })); }); section.append(button);
    }
    if (detail.color) {
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
  renderRetime(root,detail,disabled,getFrame,report,visualState,canInteract);
  const controls=detail.video ? renderFilters(root,detail,{disabled,getFrame,commit,notice,openState:visualState}) : [];
  const curves=renderCurves(root,detail,{disabled,commit,notice,openState:visualState,scope,zoomLink,canInteract});if(curves)controls.push(curves);
  const eventKeys=renderEventKeys(root,detail,{disabled,commit,notice,openState:visualState,scope,canInteract});if(eventKeys)controls.push(eventKeys);
  const keySelection=renderKeySelection(root,detail,{disabled,commit,notice,openState:visualState,scope,zoomLink,reload,canInteract});if(keySelection)controls.push(keySelection);
  if(detail.video)renderMasks(root,detail,{disabled,getFrame,commit,notice,openState:visualState,seek,canInteract});
  if (detail.title) renderTitle(root,detail,disabled,report);
  if (detail.video) renderTransitions(root,detail,disabled,report,transitionDefaults,notice);
  return controls;
}

export function renderRetime(root,detail,disabled,getFrame,report,openState,canInteract=()=>true) {
  const apply=operation=>{if(disabled || !canInteract())return;report(operation);};
  const section=document.createElement("details"),summary=document.createElement("summary");section.dataset.visualPath="retime";section.open=openState?.get("retime") || false;summary.textContent="Speed, freeze and clip label";section.append(summary);
  const color=document.createElement("select");color.setAttribute("aria-label","Clip display color");color.disabled=disabled;color.append(new Option("Default",""));
  for (const name of detail.display_colors) color.append(new Option(name,name));color.value=detail.display_color || "";
  const applyColor=document.createElement("button");applyColor.textContent="Apply clip label";applyColor.disabled=disabled;applyColor.addEventListener("click",()=>apply({kind:"set_display_color",clip_ids:[detail.clip_id],color:color.value || null}));section.append(color,applyColor);
  if (detail.retime) {
    const form=document.createElement("form"),label=document.createElement("label");label.className="field";label.textContent="Speed percent";
    const percent=document.createElement("input");percent.type="number";percent.min=1;percent.max=10000;percent.step="any";percent.value=detail.retime.speed_percent;percent.required=true;percent.disabled=disabled;label.append(percent);form.append(label);
    const fit=document.createElement("select");fit.setAttribute("aria-label","Speed duration policy");fit.disabled=disabled;
    for (const [value,text] of [["keep_length","Keep length (capped by source)"],["resize","Resize safely, leave neighbours"],["ripple","Ripple unlocked tracks"]]) fit.append(new Option(text,value));fit.value="ripple";form.append(fit);
    const pitchLabel=document.createElement("label");pitchLabel.textContent="Preserve pitch";const pitch=document.createElement("input");pitch.type="checkbox";pitch.checked=detail.retime.pitch_correction;pitch.disabled=disabled;pitchLabel.append(pitch);form.append(pitchLabel);
    const applySpeed=document.createElement("button");applySpeed.textContent="Apply speed";applySpeed.disabled=disabled;form.append(applySpeed);
    form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())apply({kind:"set_speed",clip_ids:[detail.clip_id],percent:Number(percent.value),pitch_correction:pitch.checked,fit:fit.value});});section.append(form);
    const status=document.createElement("p");status.className="muted";status.textContent=detail.retime.freeze_source_frame === null ? "Normal motion · edits include linked clips" : `Frozen at source frame ${detail.retime.freeze_source_frame} · linked clips follow native freeze semantics`;section.append(status);
    for (const [text,frame] of [["Freeze at playhead",()=>getFrame()],["Unfreeze",()=>null]]) {
      const button=document.createElement("button");button.textContent=text;button.disabled=disabled;button.addEventListener("click",()=>apply({kind:"set_freeze",clip_ids:[detail.clip_id],frame:frame()}));section.append(button);
    }
    if(openState?.get('retime-focus')===detail.clip_id){openState.delete('retime-focus');section.open=true;queueMicrotask(()=>{if(percent.isConnected && !percent.disabled)percent.focus({preventScroll:true});});}
  }
  root.append(section);
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
export function renderTransitionSelection(root,target,{disabled,getTarget,canInteract,commit,notice}){
  const heading=document.createElement('strong');heading.textContent=`${target.transition.kind} · ${target.slot==='cut_after'?'Cross transition':`Transition ${target.slot}`}`;root.append(heading);
  const form=document.createElement('form');form.className='property-row';const fields={};
  for(const [name,label,choices] of [['duration','Duration frames',null],['direction','Push direction',['Left','Right','Up','Down']],['ease','Ease',['None','In','Out','InOut']],['curve','Curve',null]]){
    if(name==='direction' && target.transition.kind!=='Push')continue;
    const row=document.createElement('label');row.className='field';row.textContent=label;const input=document.createElement(choices?'select':'input');
    if(choices)for(const value of choices)input.append(new Option(value,value));
    else{input.type='number';input.required=true;input.min=name==='duration'?1:0;input.max=name==='duration'?target.max:1;input.step=name==='duration'?1:'any';}
    input.value=target.transition[name];input.disabled=disabled;row.append(input);form.append(row);fields[name]=input;
  }
  const apply=document.createElement('button'),remove=document.createElement('button');apply.textContent='Apply transition';remove.textContent='Remove transition';remove.type='button';apply.disabled=remove.disabled=disabled;form.append(apply,remove);root.append(form);
  const identity=JSON.stringify(target);let waiting=false;
  const send=patch=>{if(disabled || waiting || !canInteract() || JSON.stringify(getTarget())!==identity){notice('Transition changed; read its current properties before editing');return;}
    try{const operation=transitionSelectionOperation(target,patch);if(!operation)return;waiting=true;apply.disabled=remove.disabled=true;Promise.resolve().then(()=>commit(operation)).catch(error=>{waiting=false;apply.disabled=remove.disabled=disabled || !canInteract() || JSON.stringify(getTarget())!==identity;notice(error.message);});}catch(error){notice(error.message);}};
  form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())send(Object.fromEntries(Object.entries(fields).map(([name,input])=>[name,['duration','curve'].includes(name)?Number(input.value):input.value])));});
  remove.addEventListener('click',()=>send(null));
  for(const node of [...Object.values(fields),apply,remove])node.addEventListener('keydown',event=>{if([' ','Enter','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.stopPropagation();});
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
