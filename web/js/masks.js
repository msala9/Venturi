function currentPath(detail,mask,frame){
  if(!Number.isSafeInteger(frame) || frame!==detail.timeline_frame)throw Error('Read native mask properties at the current playhead before editing or navigating path keys');
  if(mask.shape!=='Path' || typeof mask.path_navigation?.on_keyframe!=='boolean')throw Error('Read native path-key navigation before editing or navigating path keys');
}
export function maskFocusAfterEdit(index,edit,maskCount){
  if(!Number.isSafeInteger(maskCount) || maskCount<0 || maskCount>8 || !edit || typeof edit.action!=='string')return null;
  const selected=Number.isSafeInteger(index) && index>=0 && index<maskCount?index:null;
  if(edit.action==='add')return maskCount<8?maskCount:null;
  if(edit.action==='inspector' && edit.edit?.kind==='reset_all')return null;
  if(edit.action==='move' || edit.action==='remove'){
    const from=edit.index;if(!Number.isSafeInteger(from) || from<0 || from>=maskCount)return null;
    if(edit.action==='remove')return selected===from?null:selected!==null && selected>from?selected-1:selected;
    const to=edit.to_index;if(!Number.isSafeInteger(to) || to<0 || to>=maskCount)return null;
    if(selected===from)return to;
    if(selected!==null && from<to && selected>from && selected<=to)return selected-1;
    if(selected!==null && to<from && selected>=to && selected<from)return selected+1;
  }
  return selected;
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
export function renderMasks(root,detail,{disabled,getFrame,commit,notice,openState,seek,drawPath,canInteract=()=>!disabled}) {
  const section=document.createElement('details'),summary=document.createElement('summary');section.className='inspector-masks';section.dataset.visualPath='masks';section.open=openState?.get('masks') || false;summary.textContent=`Masks (${detail.masks.items.length})`;section.append(summary);root.append(section);
  const identity=()=>JSON.stringify([detail.project_epoch,detail.generation,detail.timeline_id,detail.revision,detail.clip_id,detail.timeline_frame,detail.source_frame]);
  const captured=identity(),frame=detail.timeline_frame,complete=['project_epoch','generation','timeline_id','revision','clip_id'].every(key=>typeof detail[key]==='string' && detail[key]) && Number.isSafeInteger(frame) && frame>=0 && Number.isSafeInteger(detail.source_frame);
  let built=false,waiting=false,settled=false,unknown=false,disposed=false;const controls=new Map();
  const current=()=>!disposed && complete && !disabled && root.isConnected!==false && section.isConnected!==false && identity()===captured && getFrame()===frame && canInteract() && !document.querySelector('dialog[open]');
  const available=()=>!waiting && !settled && !unknown && current();
  const sync=()=>{for(const [control,enabled] of controls)control.disabled=!available() || control.isConnected===false || !enabled();};
  const register=(control,enabled=()=>true)=>{controls.set(control,enabled);control.disabled=!available() || !enabled();return control;};
  const submit=(edit,inspector=true)=>{
    if(waiting || settled || unknown || disposed)return;
    if(!current()){sync();notice('Read native mask properties at the current playhead before editing');return;}
    const operation={kind:'edit_mask',clip_id:detail.clip_id,edit:inspector?{action:'inspector',timeline_frame:frame,edit}:edit};waiting=true;sync();
    return Promise.resolve().then(()=>{if(!current())throw Error('The mask Inspector context changed');return commit(operation);}).then(()=>{settled=true;}).catch(error=>{if(error.code==='OUTCOME_UNKNOWN')unknown=true;if(!disposed && root.isConnected!==false && section.isConnected!==false && identity()===captured && getFrame()===frame)notice(error.message);}).finally(()=>{waiting=false;sync();});
  };
  const keyboard=event=>{if([' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.stopPropagation();};
  const button=(parent,label,action,enabled=()=>true,text=label)=>{const node=register(document.createElement('button'),enabled);node.type='button';node.textContent=text;node.title=label;node.setAttribute('aria-label',label);node.addEventListener('keydown',keyboard);node.addEventListener('click',()=>{if(node.isConnected!==false && enabled())action(node);});parent.append(node);return node;};
  const write=(parent,label,edit,{enabled=()=>true,text=label,legacy=false}={})=>button(parent,label,()=>submit(edit,!legacy),enabled,text);
  const reset=(parent,label,edit)=>{const node=write(parent,label,edit,{text:'↺'});node.className='inspector-reset';return node;};
  function navigate(node,destination){
    if(waiting || settled || unknown || disposed)return;
    if(!current()){sync();notice('Read native mask properties at the current playhead before navigating');return;}
    try{const target=destination();if(target===null || typeof seek!=='function')return;seek(target);sync();}catch(error){sync();notice(error.message);}
  }
  const owner={register,unregister:control=>controls.delete(control),available,submit,sync,button,reset,keyboard};
  function build() {
    if(!section.open || built)return;built=true;
    const help=document.createElement('details'),helpTitle=document.createElement('summary'),note=document.createElement('p');help.className='inspector-help';helpTitle.textContent='Editing masks';note.className='muted';note.textContent='Layer pixels, Y up. Constant parameters change their default; animated parameters receive a native Linear key at each clamped playhead. Path edits use evaluated geometry. Escape cancels a vertex draft. Up to eight masks; closed paths share the native polygon budget.';help.append(helpTitle,note);section.append(help);
    const toolbar=document.createElement('div');toolbar.className='inspector-mask-toolbar';section.append(toolbar);
    const shape=register(document.createElement('select'));shape.setAttribute('aria-label','New mask shape');for(const value of detail.masks.shapes)shape.append(new Option(value,value));if(detail.masks.shapes.length)shape.value=detail.masks.shapes[0];toolbar.append(shape);
    const add=button(toolbar,'Add mask',()=>{
      if(shape.value!=='Path')return submit({action:'add',shape:shape.value},false);
      if(!available()){sync();if(!unknown && !waiting && !settled && !disposed)notice('Read native mask properties at the current playhead before drawing');return;}
      if(typeof drawPath!=='function'){notice('Path drawing is unavailable in this Inspector');return;}
      drawPath();
    },()=>detail.masks.items.length<8 && detail.masks.shapes.includes(shape.value) && (shape.value!=='Path' || typeof drawPath==='function'),'Add');
    shape.addEventListener('change',sync);add.title='Add a mask · Path starts drawing in the viewer';
    const globalMenu=document.createElement('details'),menuTitle=document.createElement('summary');globalMenu.className='inspector-mask-actions';menuTitle.textContent='Mask actions';globalMenu.append(menuTitle);toolbar.append(globalMenu);write(globalMenu,'Reset all masks',{kind:'reset_all'},{enabled:()=>detail.masks.items.length>0});
    for(const mask of detail.masks.items) {
      const n=mask.index+1,group=document.createElement('details'),heading=document.createElement('summary');group.className='inspector-mask';group.dataset.visualPath=`mask:${mask.index}`;group.open=openState?.get(group.dataset.visualPath) ?? true;heading.textContent=`Mask ${n} · ${mask.shape}`;group.append(heading);section.append(group);
      const header=document.createElement('div');header.className='inspector-mask-toolbar';group.append(header);
      for(const name of ['enabled','invert']){const label=document.createElement('label'),input=register(document.createElement('input'));input.type='checkbox';input.checked=mask[name];input.setAttribute('aria-label',`Mask ${n} ${name}`);label.append(input,name);input.addEventListener('change',()=>{if(input.isConnected!==false && input.checked!==mask[name])submit({action:'set',index:mask.index,patch:{[name]:input.checked}},false);});header.append(label);}
      const viewer=button(header,`Edit mask ${n} in viewer`,()=>{},()=>true,'Viewer');viewer.dataset.viewerMaskIndex=String(mask.index);viewer.dataset.clipId=detail.clip_id;viewer.addEventListener('click',event=>{if(!available()){event.preventDefault();event.stopPropagation();}});
      const menu=document.createElement('details'),menuHeading=document.createElement('summary');menu.className='inspector-mask-actions';menuHeading.textContent='Actions';menu.append(menuHeading);header.append(menu);
      for(const [label,to] of [['Move up',mask.index-1],['Move down',mask.index+1]])write(menu,`${label} mask ${n}`,{action:'move',index:mask.index,to_index:to},{legacy:true,enabled:()=>to>=0 && to<detail.masks.items.length});
      write(menu,`Reset mask ${n}`,{kind:'reset_mask',index:mask.index});write(menu,`Remove mask ${n}`,{action:'remove',index:mask.index},{legacy:true});
      const modeRow=document.createElement('div'),modeLabel=document.createElement('label'),mode=register(document.createElement('select'));modeRow.className='property-row';modeLabel.className='field';modeLabel.textContent='Combination';mode.setAttribute('aria-label',`Mask ${n} combination`);for(const name of detail.masks.modes)mode.append(new Option(name,name));mode.value=mask.mode;mode.addEventListener('change',()=>{if(mode.isConnected!==false && detail.masks.modes.includes(mode.value) && mode.value!==mask.mode)submit({action:'set',index:mask.index,patch:{mode:mode.value}},false);});modeLabel.append(mode);modeRow.append(modeLabel);reset(modeRow,`Reset mask ${n} combination`,{kind:'reset_mode',index:mask.index});group.append(modeRow);
      for(const parameter of mask.parameters) {
        const form=document.createElement('form'),label=document.createElement('label'),input=register(document.createElement('input'));form.className='property-row inspector-number inspector-mask-parameter';label.className='field';label.textContent=parameter.param;input.type='number';input.step='any';input.min=parameter.min;input.max=parameter.max;input.required=true;input.value=parameter.value;input.setAttribute('aria-label',`Mask ${n} ${parameter.param}`);label.append(input);form.append(label);
        const apply=register(document.createElement('button'));apply.className='inspector-number-apply';apply.textContent='Apply';apply.setAttribute('aria-label',`Apply mask ${n} ${parameter.param}`);form.append(apply);
        const complete=()=>{const value=Number(input.value);if(input.isConnected!==false && String(input.value).trim() && Number.isFinite(value) && value>=parameter.min && value<=parameter.max && value!==parameter.value && form.reportValidity())submit({kind:'set',index:mask.index,param:parameter.param,value});};form.addEventListener('submit',event=>{event.preventDefault();complete();});input.addEventListener('change',complete);
        const keys=document.createElement('span'),info=parameter.keyframe_info;keys.className='inspector-key-controls';const known=typeof info?.on_keyframe==='boolean';
        const diamond=write(keys,`Mask ${n} Toggle ${parameter.param} keyframe at playhead`,{kind:'toggle_key',index:mask.index,param:parameter.param},{enabled:()=>known,text:known && info.on_keyframe?'◆':'◇'});diamond.setAttribute('aria-pressed',String(Boolean(info?.on_keyframe)));
        for(const [direction,text] of [['previous','‹'],['next','›']])button(keys,`Mask ${n} ${direction==='previous'?'Previous':'Next'} ${parameter.param} keyframe`,node=>navigate(node,()=>info[`${direction}_frame`]),()=>known && typeof seek==='function' && Number.isSafeInteger(info[`${direction}_frame`]) && info[`${direction}_frame`]>=0,text);
        form.append(keys);reset(form,`Reset mask ${n} ${parameter.param}`,{kind:'reset_parameter',index:mask.index,param:parameter.param});group.append(form);
      }
      if(mask.shape==='Path'){
        const row=document.createElement('div');row.className='property-row inspector-mask-path-keys';row.setAttribute('role','group');row.setAttribute('aria-label',`Mask ${n} path keyframes`);group.append(row);
        const navigation=mask.path_navigation,known=typeof navigation?.on_keyframe==='boolean',focusKey=`mask-path-key-focus:${detail.clip_id}:${mask.index}`;
        for(const [action,text,label] of [['previous','‹','Previous path keyframe'],['toggle',navigation?.on_keyframe?'◆':'◇',navigation?.on_keyframe?'Remove path key at playhead':'Set path key at playhead'],['next','›','Next path keyframe']]){
          const node=button(row,`Mask ${n} ${label}`,node=>{if(document.activeElement===node)openState?.set(focusKey,action);if(action==='toggle')submit({kind:'toggle_path_key',index:mask.index});else navigate(node,()=>maskPathKeyDestination(detail,mask,getFrame(),action));},()=>known && (action==='toggle'?Boolean(mask.evaluated_path):typeof seek==='function' && Boolean(navigation[action])),text);node.dataset.pathKeyAction=action;if(action==='toggle')node.setAttribute('aria-pressed',String(Boolean(navigation?.on_keyframe)));
          if(openState?.get(focusKey)===action){openState.delete(focusKey);queueMicrotask(()=>{if(available() && node.isConnected!==false && !node.disabled && document.activeElement===document.body)node.focus({preventScroll:true});});}
        }
        reset(row,`Reset mask ${n} path`,{kind:'reset_path',index:mask.index});
        const status=document.createElement('span');status.className='muted';status.textContent=`${mask.path_keyframes} native path keys`;row.append(status);
        pathEditor(group,mask,owner);
      }
    }
    sync();
  }
  section.addEventListener("toggle",build);build();
  return {cancel(){disposed=true;sync();}};
}
function pathEditor(root,mask,owner) {
  const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent=`Bezier vertices · ${mask.path_keyframes} path keys retained`;section.append(summary);root.append(section);
  const form=document.createElement('form'),rows=document.createElement('div'),initial=structuredClone(mask.evaluated_path?.points || []);let points=structuredClone(initial),fields=[],registered=[];
  const register=(node,enabled=()=>true)=>{registered.push(node);return owner.register(node,()=>initial.length>=3 && enabled());};
  function read(){return fields.map((point)=>Object.fromEntries(Object.entries(point).map(([name,axes])=>[name,axes.map((input)=>Number(input.value))])));}
  function render(){
    for(const control of registered)owner.unregister(control);registered=[];
    rows.replaceChildren();fields=[];
    for(const [index,point] of points.entries()) {
      const vertex=document.createElement("details"),heading=document.createElement("summary");heading.textContent=`Vertex ${index+1}`;vertex.append(heading);const inputs={};
      for(const name of ["point","in_handle","out_handle"]) {
        inputs[name]=[0,1].map((axis)=>{
          const label=document.createElement("label");label.className="field";label.textContent=`Vertex ${index+1} ${name==="point" ? "position" : name==="in_handle" ? "incoming handle" : "outgoing handle"} ${axis===0 ? "X" : "Y"}`;
          const input=register(document.createElement('input'));input.type='number';input.step='any';input.min=-100000;input.max=100000;input.required=true;input.value=point[name][axis];input.setAttribute('aria-label',`Mask ${mask.index+1} vertex ${index+1} ${name} ${axis?'Y':'X'}`);label.append(input);vertex.append(label);return input;
        });
      }
      const remove=register(document.createElement('button'),()=>points.length>3);remove.type='button';remove.textContent=`Remove vertex ${index+1}`;remove.addEventListener('keydown',owner.keyboard);remove.addEventListener('click',()=>{if(!owner.available() || remove.isConnected===false || points.length<=3)return;points=read();points.splice(index,1);render();});vertex.append(remove);rows.append(vertex);fields.push(inputs);
    }
    owner.sync();
  }
  const append=owner.register(document.createElement('button'),()=>initial.length>=3 && points.length<21);append.type='button';append.textContent='Append vertex';append.addEventListener('keydown',owner.keyboard);append.addEventListener('click',()=>{if(!owner.available() || points.length>=21 || initial.length<3)return;points=read();points.push({point:[0,0],in_handle:[0,0],out_handle:[0,0]});render();});
  const save=owner.register(document.createElement('button'),()=>initial.length>=3);save.textContent='Apply path';save.setAttribute('aria-label',`Apply mask ${mask.index+1} path`);
  form.append(rows,append,save);form.addEventListener('submit',event=>{event.preventDefault();if(!owner.available() || form.isConnected===false || !form.reportValidity())return;const path={points:read()};if(fields.some(point=>Object.values(point).flat().some(input=>!String(input.value).trim() || !Number.isFinite(Number(input.value)))) || JSON.stringify(path.points)===JSON.stringify(initial))return;owner.submit({kind:'set_path',index:mask.index,path});});
  form.addEventListener('keydown',event=>{if(event.key==='Escape' && owner.available()){event.preventDefault();event.stopPropagation();points=structuredClone(initial);render();}});section.append(form);render();
}
