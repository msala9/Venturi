import {curveInterpolation,createKeyEditorGuard} from "./curves.js";

const identity=pick=>JSON.stringify([pick.target,pick.source_frame]);
export function keySelectionOperation(clip,picks,action,linkZoom=false) {
  if(!picks.length || picks.length>2048 || picks.some(pick=>!Number.isSafeInteger(pick.source_frame)) || new Set(picks.map(identity)).size!==picks.length)throw Error("Choose 1–2048 distinct native keys");
  if(action.kind==="move" && !Number.isSafeInteger(action.delta_source_frames))throw Error("Choose an integer source frame delta");
  if(!["move","delete","interpolation"].includes(action.kind))throw Error("Choose a native key selection action");
  return {kind:"edit_key_selection",clip_id:clip,edit:{picks,link_zoom:Boolean(linkZoom),action}};
}
export function retainedCrossKeys(stored,picks) {
  const available=new Set(picks.map(identity));
  const ids=Array.isArray(stored)?stored:stored?.before?.length && stored.before.every(id=>available.has(id))?stored.before:stored?.after || [];
  return ids.filter(id=>available.has(id));
}
export function mergeCrossSelection(stored,visible,chosen) {
  const visibleIds=new Set(visible.map(identity));
  const result=[...new Set([...stored.filter(id=>!visibleIds.has(id)),...chosen.map(identity)])];
  if(result.length>2048)throw Error("Select at most 2048 keys across all pages");
  return result;
}
export function renderKeySelection(root,detail,{disabled,commit,notice,openState,scope=detail.clip_id,zoomLink,reload,canInteract,keySelection}) {
  const rows=[...(detail.curves?.tracks || []),...(detail.event_keys || [])];
  const total=rows.reduce((sum,row)=>sum+row.key_count,0);
  if(!total)return null;
  const stateKey=`all-keys:${scope}`;
  function remember(value){
    if(!openState)return;
    openState.delete(stateKey);openState.set(stateKey,value);
    const keys=[...openState.keys()].filter(key=>key.startsWith("all-keys:"));
    for(const key of keys.slice(0,Math.max(0,keys.length-32)))openState.delete(key);
  }
  const section=document.createElement("details"),summary=document.createElement("summary");section.className="curve-editor";section.dataset.visualPath="all-keys";section.open=openState?.get("all-keys") || false;summary.textContent="Keys across parameters";section.append(summary);
  const note=document.createElement("p");note.className="muted";note.textContent="Select keys with Ctrl/Shift. Selection retains keys from other parameters and pages. Move preserves native values and interpolation. Missing keys reject the whole action. Link Zoom includes existing twins. Each action is one Undo.";section.append(note);
  const filter=document.createElement("select");filter.setAttribute("aria-label","Cross-parameter key row");filter.append(new Option("All parameters on this page",""));rows.forEach((row,index)=>filter.append(new Option(`${row.name} (${row.key_count} keys)`,String(index))));filter.value=openState?.get("all-keys-row") || "";section.append(filter);
  const form=document.createElement("form"),list=document.createElement("select");list.multiple=true;list.size=8;list.setAttribute("aria-label","Keys across parameters");list.disabled=disabled;
  const stored=openState?.get(stateKey);let selectedIds=keySelection?keySelection.get().map(identity):stored?.ids || (Array.isArray(stored)?stored:stored?.after || []),shown=[],picks=[];form.append(list);
  const clear=document.createElement("button");clear.type="button";clear.textContent="Clear keys on all pages";form.append(clear);
  const status=document.createElement("p");status.className="muted";status.setAttribute("aria-live","polite");form.append(status);
  const linkedLabel=document.createElement("label"),linked=document.createElement("input");linked.type="checkbox";linked.checked=Boolean(openState?.get("key-selection-zoom-link"));linked.disabled=disabled;linkedLabel.append(linked," Link Zoom X/Y key times and interpolation");form.append(linkedLabel);
  zoomLink?.register(linked);
  const deltaLabel=document.createElement("label"),delta=document.createElement("input");deltaLabel.className="field";deltaLabel.textContent="Cross-parameter frame delta";delta.type="number";delta.step=1;delta.required=true;delta.value="0";delta.disabled=disabled;deltaLabel.append(delta);form.append(deltaLabel);
  const move=document.createElement("button");move.formNoValidate=true;move.textContent="Move keys across parameters";form.append(move);
  const mode=document.createElement("select");mode.setAttribute("aria-label","Cross-parameter interpolation");mode.disabled=disabled;
  for(const name of ["Linear","Hold","EaseInOut","EaseIn","EaseOut","Bezier"])mode.append(new Option(name,name));form.append(mode);
  const controls=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent="Cross-parameter Bezier controls";controls.append(legend);const values=[];
  for(const [index,value] of [1/3,1/3,2/3,2/3].entries()){
    const label=document.createElement("label"),input=document.createElement("input");label.className="field";label.textContent=["Cross Bezier c1x","Cross Bezier c1y","Cross Bezier c2x","Cross Bezier c2y"][index];input.type="number";input.step="any";input.min=index%2?-10:0;input.max=index%2?10:1;input.value=value;input.required=true;input.disabled=disabled;label.append(input);controls.append(label);values.push(input);
  }
  controls.hidden=controls.disabled=true;form.append(controls);
  const interpolate=document.createElement("button");interpolate.type="button";interpolate.textContent="Set selected keys interpolation";form.append(interpolate);
  const remove=document.createElement("button");remove.type="button";remove.textContent="Delete keys across parameters";form.append(remove);section.append(form);root.append(section);
  let waiting=false,disposed=false;
  const owner=createKeyEditorGuard({root,section,disabled,canInteract,commit});
  if(stored?.focus && !disabled && section.open){
    remember({ids:selectedIds,focus:false});
    queueMicrotask(()=>{if(!disposed && list.isConnected && document.activeElement===document.body)list.focus({preventScroll:true});});
  }
  const selected=()=>selectedIds.map(id=>{const [target,source_frame]=JSON.parse(id);return {target,source_frame};});
  function update(){const ids=new Set(selectedIds),hidden=selectedIds.length-picks.filter(pick=>ids.has(identity(pick))).length;status.textContent=`${selectedIds.length} selected · ${hidden} selected outside this list · ${shown.length} shown of ${total} native keys${shown.length===2048?" · choose a parameter row to access more keys on this page":""}`;move.disabled=remove.disabled=interpolate.disabled=disabled || waiting || !selectedIds.length;clear.disabled=waiting || !selectedIds.length;}
  function show(){
    shown=[];for(const row of filter.value===""?rows:[rows[Number(filter.value)]].filter(Boolean))for(const key of row.keys.slice(0,2048-shown.length))shown.push({target:row.target,source_frame:key.source_frame,name:row.name,timeline:key.timeline_frame});
    picks=shown.map(({target,source_frame})=>({target,source_frame}));const ids=new Set(selectedIds);list.replaceChildren(...shown.map((key,index)=>{const option=new Option(`${key.name} · source ${key.source_frame} · timeline ${key.timeline}`,String(index));option.selected=ids.has(identity(picks[index]));return option;}));update();
  }
  async function send(action){
    if(!owner.current() || waiting || !selectedIds.length || action.kind==="move" && !delta.reportValidity())return;
    const before=selected();
    try{
      const operation=keySelectionOperation(detail.clip_id,before,action,linked.checked);
      waiting=true;form.inert=true;update();
      const after=action.kind==="delete"?[]:before.map(pick=>({...pick,source_frame:pick.source_frame+(action.kind==="move"?action.delta_source_frames:0)}));
      selectedIds=after.map(identity);if(keySelection)keySelection.set(after,{focus:true});else remember({ids:selectedIds,focus:true});
      await owner.commit(operation);
    }catch(error){selectedIds=before.map(identity);if(keySelection)keySelection.set(before,{focus:true});else remember({ids:selectedIds,focus:true});notice(error.message);if(disposed)reload?.();else if(list.isConnected)list.focus({preventScroll:true});}
    finally{waiting=false;form.inert=false;if(!disposed)show();}
  }
  list.addEventListener("change",()=>{try{selectedIds=mergeCrossSelection(selectedIds,picks,[...list.selectedOptions].map(option=>picks[Number(option.value)]));if(keySelection)keySelection.set(selected());else remember({ids:selectedIds});update();}catch(error){notice(error.message);show();}});
  filter.addEventListener("change",()=>{openState?.set("all-keys-row",filter.value);show();});
  clear.addEventListener("click",()=>{selectedIds=[];if(keySelection)keySelection.set([]);else remember({ids:selectedIds});show();});
  list.addEventListener("keydown",event=>{if(event.key==="Delete" || event.key==="Backspace"){event.preventDefault();event.stopPropagation();send({kind:"delete"});}});
  if(!zoomLink)linked.addEventListener("change",()=>openState?.set("key-selection-zoom-link",linked.checked));
  mode.addEventListener("change",()=>{controls.hidden=mode.value!=="Bezier";controls.disabled=controls.hidden || disabled;});
  form.addEventListener("submit",event=>{event.preventDefault();send({kind:"move",delta_source_frames:Number(delta.value)});});
  interpolate.addEventListener("click",()=>{try{if(mode.value==="Bezier" && !values.every(input=>input.reportValidity()))return;send({kind:"interpolation",interpolation:curveInterpolation(mode.value,values.map(input=>Number(input.value)))});}catch(error){notice(error.message);}});
  const unsubscribe=keySelection?.subscribe(()=>{selectedIds=keySelection.get().map(identity);show();});
  remove.addEventListener("click",()=>send({kind:"delete"}));show();
  return {hasSelectedKeys:()=>selectedIds.length>0,removeSelected:()=>send({kind:'delete'}),cancel(){
    if(document.activeElement===list)remember({ids:selectedIds,focus:true});
    unsubscribe?.();owner.dispose();disposed=true;
  }};
}
