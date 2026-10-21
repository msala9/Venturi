function currentPath(detail,mask,frame){
  if(!Number.isSafeInteger(frame) || frame!==detail.timeline_frame)throw Error('Read native mask properties at the current playhead before editing or navigating path keys');
  if(mask.shape!=='Path' || typeof mask.path_navigation?.on_keyframe!=='boolean')throw Error('Read native path-key navigation before editing or navigating path keys');
}
export function maskPathKeyDestination(detail,mask,frame,direction){
  currentPath(detail,mask,frame);
  if(direction!=='previous' && direction!=='next')throw Error('Choose the previous or next native path key');
  const key=mask.path_navigation[direction];if(key===null)return null;
  if(!key || !Number.isSafeInteger(key.source_frame) || !Number.isSafeInteger(key.timeline_frame) || key.timeline_frame<0 || !Number.isSafeInteger(detail.source_frame) || (direction==='previous'?key.source_frame>=detail.source_frame:key.source_frame<=detail.source_frame))throw Error('Read valid native path-key navigation at the current playhead');
  return key.timeline_frame;
}
export function maskPathKeyOperation(detail,mask,frame){
  currentPath(detail,mask,frame);
  if(!mask.path_navigation.on_keyframe && !mask.evaluated_path)throw Error('Read the native evaluated path before setting a path key');
  return {kind:'edit_mask',clip_id:detail.clip_id,edit:{action:'path_key',index:mask.index,timeline_frame:frame,path:mask.path_navigation.on_keyframe?null:structuredClone(mask.evaluated_path)}};
}
export function renderMasks(root,detail,{disabled,getFrame,commit,notice,openState,seek,canInteract=()=>!disabled}) {
  const section=document.createElement("details"),summary=document.createElement("summary");section.dataset.visualPath="masks";section.open=openState?.get("masks") || false;summary.textContent=`Masks (${detail.masks.items.length})`;section.append(summary);root.append(section);
  let built=false;
  const send=(edit)=>commit({kind:"edit_mask",clip_id:detail.clip_id,edit}).catch((error)=>notice(error.message));
  const key=(index,param,value)=>commit({kind:"set_keyframe",clip_id:detail.clip_id,edit:{target:{kind:"mask",index,param},timeline_frame:getFrame(),value,interpolation:"Linear"}}).catch((error)=>notice(error.message));
  function build() {
    if(!section.open || built)return;built=true;
    const note=document.createElement("p");note.className="muted";note.textContent="Layer pixels, Y up. Apply changes the default and retains animation; ◆ writes a native linear key at the playhead. Up to eight masks; closed paths share the native polygon budget.";section.append(note);
    const shape=document.createElement("select");shape.setAttribute("aria-label","New mask shape");shape.disabled=disabled;for(const value of detail.masks.shapes)shape.append(new Option(value,value));
    const add=document.createElement("button");add.textContent="Add mask";add.disabled=disabled || detail.masks.items.length>=8;add.addEventListener("click",()=>send({action:"add",shape:shape.value}));section.append(shape,add);
    for(const mask of detail.masks.items) {
      const group=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent=`Mask ${mask.index+1} · ${mask.shape}`;group.append(legend);
      const viewer=document.createElement('button');viewer.type='button';viewer.textContent=`Edit mask ${mask.index+1} in viewer`;viewer.disabled=disabled;viewer.dataset.viewerMaskIndex=String(mask.index);viewer.dataset.clipId=detail.clip_id;viewer.addEventListener('keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});group.append(viewer);
      for(const name of ["enabled","invert"]) {
        const label=document.createElement("label");label.textContent=`Mask ${mask.index+1} ${name}`;const input=document.createElement("input");input.type="checkbox";input.checked=mask[name];input.disabled=disabled;input.addEventListener("change",()=>send({action:"set",index:mask.index,patch:{[name]:input.checked}}));label.append(input);group.append(label);
      }
      const mode=document.createElement("select");mode.setAttribute("aria-label",`Mask ${mask.index+1} combination`);mode.disabled=disabled;for(const name of detail.masks.modes)mode.append(new Option(name,name));mode.value=mask.mode;mode.addEventListener("change",()=>send({action:"set",index:mask.index,patch:{mode:mode.value}}));group.append(mode);
      for(const [label,edit,unavailable] of [["Move mask up",{action:"move",index:mask.index,to_index:mask.index-1},mask.index===0],["Move mask down",{action:"move",index:mask.index,to_index:mask.index+1},mask.index===detail.masks.items.length-1],["Remove mask",{action:"remove",index:mask.index},false]]) {
        const button=document.createElement("button");button.textContent=label;button.disabled=disabled || unavailable;button.addEventListener("click",()=>send(edit));group.append(button);
      }
      for(const parameter of mask.parameters) {
        const form=document.createElement("form");form.className="property-row";const label=document.createElement("label");label.className="field";label.textContent=`Mask ${mask.index+1} ${parameter.param}`;
        const input=document.createElement("input");input.type="number";input.step="any";input.min=parameter.min;input.max=parameter.max;input.required=true;input.value=parameter.value;input.disabled=disabled;label.append(input);form.append(label);
        const apply=document.createElement("button");apply.textContent="Apply";apply.disabled=disabled;form.append(apply);form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())send({action:"set",index:mask.index,patch:{parameters:[{param:parameter.param,value:Number(input.value)}]}});});
        for(const [text,value] of [["◆",()=>Number(input.value)],["◇",()=>null]]) {
          const button=document.createElement("button");button.type="button";button.textContent=text;button.setAttribute("aria-label",`${text==="◆" ? "Set" : "Remove"} mask ${mask.index+1} ${parameter.param} keyframe`);button.disabled=disabled;button.addEventListener("click",()=>{if(value()===null || form.reportValidity())key(mask.index,parameter.param,value());});form.append(button);
        }
        group.append(form);
      }
      if(mask.shape==="Path") {
        const pathNote=document.createElement('p');pathNote.className='muted';pathNote.textContent='Apply path below changes its default. Path keys use the native evaluated path at this playhead; viewer edits add a Linear key when path animation exists.';group.append(pathNote);
        pathKeyControls(group,detail,mask,{disabled,getFrame,commit,notice,openState,seek,canInteract});
        pathEditor(group,mask,disabled,(path)=>send({action:"set",index:mask.index,patch:{path}}));
      }
      section.append(group);
    }
  }
  section.addEventListener("toggle",build);build();
}
function pathKeyControls(root,detail,mask,{disabled,getFrame,commit,notice,openState,seek,canInteract}){
  const row=document.createElement('div');row.className='property-row';row.setAttribute('role','group');row.setAttribute('aria-label',`Mask ${mask.index+1} path keyframes`);
  const navigation=mask.path_navigation,focusKey=`mask-path-key-focus:${detail.clip_id}:${mask.index}`;
  const available=!disabled && detail.timeline_frame===getFrame() && typeof navigation?.on_keyframe==='boolean';
  let waiting=false;
  const buttons=[],initialDisabled=new Map();
  const blocked=()=>disabled || waiting || !canInteract() || Boolean(document.querySelector('dialog[open]'));
  const remember=button=>{if(document.activeElement===button)openState?.set(focusKey,button.dataset.pathKeyAction);};
  for(const [action,text,label] of [['previous','‹','Previous path keyframe'],['toggle',navigation?.on_keyframe?'◆':'◇',navigation?.on_keyframe?'Remove path key at playhead':'Set path key at playhead'],['next','›','Next path keyframe']]){
    const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.pathKeyAction=action;button.setAttribute('aria-label',`Mask ${mask.index+1} ${label}`);button.title=label;
    button.disabled=!available || (action==='toggle'?!navigation.on_keyframe && !mask.evaluated_path:typeof seek!=='function' || !navigation[action]);
    if(action==='toggle')button.setAttribute('aria-pressed',String(Boolean(navigation?.on_keyframe)));
    button.addEventListener('keydown',event=>{if([' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.stopPropagation();});
    button.addEventListener('click',()=>{
      if(blocked())return;
      try{
        if(action!=='toggle'){
          const frame=maskPathKeyDestination(detail,mask,getFrame(),action);if(frame===null || typeof seek!=='function')return;
          remember(button);seek(frame);return;
        }
        const operation=maskPathKeyOperation(detail,mask,getFrame());remember(button);waiting=true;for(const control of buttons)control.disabled=true;
        Promise.resolve().then(()=>commit(operation)).catch(error=>{waiting=false;for(const control of buttons)control.disabled=initialDisabled.get(control) || detail.timeline_frame!==getFrame() || blocked();notice(error.message);}).finally(()=>{waiting=false;});
      }catch(error){if(detail.timeline_frame!==getFrame())for(const control of buttons)control.disabled=true;notice(error.message);}
    });
    buttons.push(button);initialDisabled.set(button,button.disabled);row.append(button);
    if(openState?.get(focusKey)===action){openState.delete(focusKey);queueMicrotask(()=>{if(button.isConnected && !button.disabled && document.activeElement===document.body && !document.querySelector('dialog[open]'))button.focus({preventScroll:true});});}
  }
  const status=document.createElement('span');status.className='muted';status.textContent=typeof navigation?.on_keyframe==='boolean'?`${mask.path_keyframes} native path keys · ${navigation.on_keyframe?'key at playhead':'evaluated path at playhead'}`:'Read native path-key navigation';row.append(status);root.append(row);
}
function pathEditor(root,mask,disabled,apply) {
  const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent=`Bezier vertices · ${mask.path_keyframes} path keys retained`;section.append(summary);root.append(section);
  const form=document.createElement("form"),rows=document.createElement("div");let points=structuredClone(mask.path.points),fields=[];
  function read(){return fields.map((point)=>Object.fromEntries(Object.entries(point).map(([name,axes])=>[name,axes.map((input)=>Number(input.value))])));}
  function render(){
    rows.replaceChildren();fields=[];
    for(const [index,point] of points.entries()) {
      const vertex=document.createElement("details"),heading=document.createElement("summary");heading.textContent=`Vertex ${index+1}`;vertex.append(heading);const inputs={};
      for(const name of ["point","in_handle","out_handle"]) {
        inputs[name]=[0,1].map((axis)=>{
          const label=document.createElement("label");label.className="field";label.textContent=`Vertex ${index+1} ${name==="point" ? "position" : name==="in_handle" ? "incoming handle" : "outgoing handle"} ${axis===0 ? "X" : "Y"}`;
          const input=document.createElement("input");input.type="number";input.step="any";input.min=-100000;input.max=100000;input.required=true;input.value=point[name][axis];input.disabled=disabled;label.append(input);vertex.append(label);return input;
        });
      }
      const remove=document.createElement("button");remove.type="button";remove.textContent=`Remove vertex ${index+1}`;remove.disabled=disabled || points.length<=3;remove.addEventListener("click",()=>{points=read();points.splice(index,1);render();});vertex.append(remove);rows.append(vertex);fields.push(inputs);
    }
    append.disabled=disabled || points.length>=21;
  }
  const append=document.createElement("button");append.type="button";append.textContent="Append vertex";append.addEventListener("click",()=>{points=read();points.push({point:[0,0],in_handle:[0,0],out_handle:[0,0]});render();});
  const save=document.createElement("button");save.textContent="Apply path";save.disabled=disabled;
  form.append(rows,append,save);form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())apply({points:read()});});section.append(form);render();
}
