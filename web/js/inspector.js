import {renderFilters} from "./visual.js";
import {renderMasks} from "./masks.js";
import {renderCurves,createZoomLink,zoomParameters} from "./curves.js";
import {renderEventKeys} from "./eventkeys.js";
import {renderKeySelection} from "./keyselection.js";

export function detailIdentity(state) {
  return state ? [state.project_epoch, state.generation, state.timeline, state.revision, state.clip, state.frame,state.key_page].join(":") : null;
}
export function propertyOperation(clip, patch) { return { kind: "set_properties", clip_id: clip, patch }; }
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
export function renderProperties(root, detail, { writable, getFrame, commit, reload, notice, visualState, scope,setKeyPage }) {
  const disabled = !writable || detail.locked;
  if(detail.key_page){
    const page=detail.key_page,form=document.createElement("form"),label=document.createElement("label"),input=document.createElement("input"),previous=document.createElement("button"),next=document.createElement("button"),go=document.createElement("button"),note=document.createElement("p");
    label.className="field";label.textContent="Native key page";input.type="number";input.min=1;input.max=page.total_pages;input.step=1;input.required=true;input.value=page.index+1;label.append(input);
    previous.type=next.type="button";previous.textContent="Previous key page";next.textContent="Next key page";go.textContent="Read key page";previous.disabled=page.index===0;next.disabled=page.index+1>=page.total_pages;
    previous.addEventListener("click",()=>setKeyPage(page.index-1));next.addEventListener("click",()=>setKeyPage(page.index+1));form.addEventListener("submit",event=>{event.preventDefault();if(form.reportValidity()){try{setKeyPage(keyPageIndex(input.value,page.total_pages));}catch(error){notice(error.message);}}});
    note.className="muted";note.textContent=`Page ${page.index+1} of ${page.total_pages} · up to ${page.page_size} keys per parameter. Curve and value-key selections apply to this page; cross-parameter selection retains keys from other pages.`;form.append(label,previous,next,go,note);root.append(form);
    if(visualState?.get("key-page-focus")===scope){visualState.delete("key-page-focus");queueMicrotask(()=>{if(input.isConnected)input.focus({preventScroll:true});});}
  }
  const zoomLink=createZoomLink(visualState);
  const report = (operation) => commit(operation).catch((error) => notice(error.message));
  const section = document.createElement("details"); section.open = true;
  const heading = document.createElement("summary"); heading.textContent = "Properties and keyframes"; section.append(heading);
  const note = document.createElement("p"); note.className = "muted";
  note.textContent = `Native evaluation at timeline frame ${detail.timeline_frame} / source frame ${detail.source_frame}. Apply sets the default; ◆ writes at the playhead.`;
  section.append(note);
  const refresh = document.createElement("button"); refresh.textContent = "Read at playhead"; refresh.addEventListener("click", reload); section.append(refresh);
  const interpolation = document.createElement("select"); interpolation.setAttribute("aria-label", "Keyframe interpolation");
  for (const name of ["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut"]) interpolation.append(new Option(name, name));
  section.append(interpolation);
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
    const linkLabel=document.createElement("label"),linkInput=document.createElement("input");linkInput.type="checkbox";linkInput.disabled=disabled;zoomLink.register(linkInput);linkLabel.append(linkInput," Link Zoom X/Y");section.append(linkLabel);
    for (const parameter of detail.transform) number(parameter.param, parameter.value, parameter.min, parameter.max, (value) => transformPatch(parameter.param,value,zoomLink.get()), { kind: "transform", param: parameter.param }, parameter.keyframes,parameter.key_count);
    function choice(label, value, values, patch) {
      const field = document.createElement("label"); field.className = "field"; field.textContent = label;
      const select = document.createElement("select"); select.disabled = disabled;
      for (const name of values) select.append(new Option(name, name)); select.value = value;
      select.addEventListener("change", () => report(propertyOperation(detail.clip_id, patch(select.value)))); field.append(select); section.append(field);
    }
    choice("Blend mode", detail.blend, detail.blends, (blend) => ({ blend }));
    choice("Track matte", detail.matte, detail.mattes, (matte) => ({ matte }));
    for (const [index, label] of [[0, "Flip horizontal"], [1, "Flip vertical"]]) {
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
  } else number("Gain dB", detail.gain.value, -100, 30, (gain_db) => ({ gain_db }), { kind: "gain" }, detail.gain.keyframes,detail.gain.key_count);
  number("Fade in frames", detail.fade_in, 0, detail.length_frames, (fade_in) => ({ fade_in }));
  number("Fade out frames", detail.fade_out, 0, detail.length_frames, (fade_out) => ({ fade_out }));
  root.append(section);
  renderRetime(root,detail,disabled,getFrame,report,visualState);
  const controls=detail.video ? renderFilters(root,detail,{disabled,getFrame,commit,notice,openState:visualState}) : [];
  const curves=renderCurves(root,detail,{disabled,commit,notice,openState:visualState,scope,zoomLink});if(curves)controls.push(curves);
  const eventKeys=renderEventKeys(root,detail,{disabled,commit,notice,openState:visualState,scope});if(eventKeys)controls.push(eventKeys);
  const keySelection=renderKeySelection(root,detail,{disabled,commit,notice,openState:visualState,scope,zoomLink,reload});if(keySelection)controls.push(keySelection);
  if(detail.video)renderMasks(root,detail,{disabled,getFrame,commit,notice,openState:visualState});
  if (detail.title) renderTitle(root,detail,disabled,report);
  if (detail.video) renderTransitions(root,detail,disabled,report);
  return controls;
}

function renderRetime(root,detail,disabled,getFrame,report,openState) {
  const section=document.createElement("details"),summary=document.createElement("summary");section.dataset.visualPath="retime";section.open=openState?.get("retime") || false;summary.textContent="Speed, freeze and clip label";section.append(summary);
  const color=document.createElement("select");color.setAttribute("aria-label","Clip display color");color.disabled=disabled;color.append(new Option("Default",""));
  for (const name of detail.display_colors) color.append(new Option(name,name));color.value=detail.display_color || "";
  const applyColor=document.createElement("button");applyColor.textContent="Apply clip label";applyColor.disabled=disabled;applyColor.addEventListener("click",()=>report({kind:"set_display_color",clip_ids:[detail.clip_id],color:color.value || null}));section.append(color,applyColor);
  if (detail.retime) {
    const form=document.createElement("form"),label=document.createElement("label");label.className="field";label.textContent="Speed percent";
    const percent=document.createElement("input");percent.type="number";percent.min=1;percent.max=10000;percent.step="any";percent.value=detail.retime.speed_percent;percent.required=true;percent.disabled=disabled;label.append(percent);form.append(label);
    const fit=document.createElement("select");fit.setAttribute("aria-label","Speed duration policy");fit.disabled=disabled;
    for (const [value,text] of [["keep_length","Keep length (capped by source)"],["resize","Resize safely, leave neighbours"],["ripple","Ripple unlocked tracks"]]) fit.append(new Option(text,value));form.append(fit);
    const pitchLabel=document.createElement("label");pitchLabel.textContent="Preserve pitch";const pitch=document.createElement("input");pitch.type="checkbox";pitch.checked=detail.retime.pitch_correction;pitch.disabled=disabled;pitchLabel.append(pitch);form.append(pitchLabel);
    const apply=document.createElement("button");apply.textContent="Apply speed";apply.disabled=disabled;form.append(apply);
    form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())report({kind:"set_speed",clip_ids:[detail.clip_id],percent:Number(percent.value),pitch_correction:pitch.checked,fit:fit.value});});section.append(form);
    const status=document.createElement("p");status.className="muted";status.textContent=detail.retime.freeze_source_frame === null ? "Normal motion · edits include linked clips" : `Frozen at source frame ${detail.retime.freeze_source_frame} · linked clips follow native freeze semantics`;section.append(status);
    for (const [text,frame] of [["Freeze at playhead",()=>getFrame()],["Unfreeze",()=>null]]) {
      const button=document.createElement("button");button.textContent=text;button.disabled=disabled;button.addEventListener("click",()=>report({kind:"set_freeze",clip_ids:[detail.clip_id],frame:frame()}));section.append(button);
    }
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
function renderTransitions(root, detail, disabled, report) {
  const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Transitions";section.append(summary);
  for (const [slot,label] of [["in","Transition in"],["out","Transition out"],["cut_after","Crossing to next clip"]]) {
    if (slot === "cut_after" && !detail.transitions.cut_max_frames) continue;
    const form=document.createElement("form"),legend=document.createElement("strong");legend.textContent=label;form.append(legend);
    const value=detail.transitions[slot],kind=document.createElement("select");kind.setAttribute("aria-label",`${label} kind`);kind.disabled=disabled;
    for (const name of ["None","Push","CrossDissolve","SmoothCut"])kind.append(new Option(name,name));kind.value=value?.kind || "None";form.append(kind);
    const duration=document.createElement("input");duration.type="number";duration.min=1;duration.max=slot === "cut_after" ? detail.transitions.cut_max_frames : detail.length_frames;duration.step=1;duration.value=value?.duration || Math.min(12,Number(duration.max));duration.setAttribute("aria-label",`${label} duration frames`);duration.disabled=disabled;form.append(duration);
    const direction=document.createElement("select");direction.setAttribute("aria-label",`${label} direction`);direction.disabled=disabled;for(const name of ["Left","Right","Up","Down"])direction.append(new Option(name,name));direction.value=value?.direction || "Left";form.append(direction);
    const ease=document.createElement("select");ease.setAttribute("aria-label",`${label} ease`);ease.disabled=disabled;for(const name of ["None","In","Out","InOut"])ease.append(new Option(name,name));ease.value=value?.ease || "None";form.append(ease);
    const curve=document.createElement("input");curve.type="number";curve.min=0;curve.max=1;curve.step="any";curve.value=value?.curve ?? 0.5;curve.setAttribute("aria-label",`${label} curve`);curve.disabled=disabled;form.append(curve);
    const apply=document.createElement("button");apply.textContent=`Apply ${label.toLowerCase()}`;apply.disabled=disabled;form.append(apply);
    form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())report({kind:"set_transition",clip_id:detail.clip_id,slot,transition:kind.value === "None" ? null : {kind:kind.value,duration:Number(duration.value),direction:direction.value,ease:ease.value,curve:Number(curve.value)}});});
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
