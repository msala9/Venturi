import {renderColorPicker} from './color-picker.js';
import {createTransitionChoice} from './transition-controls.js';

export function wheelDelta(x,y,dx,dy,radius,fine=false) {
  const scale=(fine ? 0.2 : 1)/(radius*2.5);let nextX=x+dx*scale,nextY=y-dy*scale;
  const length=Math.hypot(nextX,nextY);if(length>1){nextX/=length;nextY/=length;}return [nextX,nextY];
}
export function bindColorWheel(canvas,{x,y,paint,onCommit,onReset,onError,canInteract=()=>true}) {
  let gesture=null,waiting=false;
  const live=()=>canvas.isConnected!==false && canInteract();
  const redraw=()=>paint(x,y,!!gesture);
  const cancel=()=>{if(gesture){const previous=gesture;x=previous.x;y=previous.y;gesture=null;try{if(canvas.hasPointerCapture?.(previous.id))canvas.releasePointerCapture(previous.id);}catch{}redraw();}};
  async function commit(before,reset=false) {
    if(!live())return;
    waiting=true;
    try{await Promise.resolve();if(live())await (reset && onReset?onReset():onCommit(x,y));else{x=before[0];y=before[1];redraw();}}catch(error){x=before[0];y=before[1];redraw();onError(error.message);}finally{waiting=false;}
  }
  canvas.addEventListener("pointerdown",(event)=>{
    if(waiting || !live() || event.button!==0 || event.isPrimary===false)return;canvas.focus();canvas.setPointerCapture(event.pointerId);
    gesture={x,y,lastX:event.clientX,lastY:event.clientY,moved:false,id:event.pointerId};
  });
  canvas.addEventListener("pointermove",(event)=>{
    if(!gesture || event.pointerId!==gesture.id)return;if(!live() || event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
    const radius=canvas.getBoundingClientRect().width/2-6;
    [x,y]=wheelDelta(x,y,event.clientX-gesture.lastX,event.clientY-gesture.lastY,radius,event.shiftKey);
    gesture.lastX=event.clientX;gesture.lastY=event.clientY;gesture.moved=x!==gesture.x || y!==gesture.y;redraw();
  });
  canvas.addEventListener("pointerup",event=>{
    if(!gesture || event?.pointerId!==undefined && event.pointerId!==gesture.id)return;if(!live()){cancel();return;}const before=gesture;gesture=null;
    canvas.releasePointerCapture(before.id);redraw();if(before.moved)commit([before.x,before.y]);
  });
  canvas.addEventListener("pointercancel",cancel);canvas.addEventListener("lostpointercapture",cancel);
  canvas.addEventListener("keydown",(event)=>{
    if(event.key==="Escape"){event.stopPropagation();event.preventDefault();cancel();return;}
    const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!direction)return;event.stopPropagation();event.preventDefault();if(waiting || !live())return;
    const before=[x,y];[x,y]=wheelDelta(x,y,direction[0]*2.5,direction[1]*2.5,100,event.shiftKey);redraw();commit(before);
  });
  canvas.addEventListener("dblclick",()=>{if(waiting || !live() || (!onReset && !x && !y))return;cancel();const before=[x,y];x=0;y=0;redraw();commit(before,true);});
  redraw();return {cancel};
}
function colorWheel(canvas,hues,initial,onCommit,onError,disabled=false,canInteract=()=>true,onReset) {
  const ctx=canvas.getContext("2d");let state=initial,active=false,queued=false;
  const paint=(x,y,dragging)=>{
    state=[x,y];active=dragging;if(queued)return;queued=true;
    requestAnimationFrame(()=>{
      queued=false;const size=150,dpr=devicePixelRatio || 1;canvas.width=Math.round(size*dpr);canvas.height=Math.round(size*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
      const radius=size/2-6,center=size/2;ctx.fillStyle="#100d14";ctx.beginPath();ctx.arc(center,center,radius,0,Math.PI*2);ctx.fill();ctx.lineWidth=4;
      for(const [index,rgb] of hues.entries()){ctx.strokeStyle=`rgb(${rgb.join(",")})`;ctx.beginPath();ctx.arc(center,center,radius,-index/hues.length*Math.PI*2,-(index+1)/hues.length*Math.PI*2,true);ctx.stroke();}
      ctx.lineWidth=1;ctx.strokeStyle="#5a4e60";ctx.beginPath();ctx.moveTo(6,center);ctx.lineTo(size-6,center);ctx.moveTo(center,6);ctx.lineTo(center,size-6);ctx.stroke();
      ctx.lineWidth=2;ctx.strokeStyle=active ? "#ff673d" : "#f5eff5";ctx.beginPath();ctx.arc(center+state[0]*radius,center-state[1]*radius,5,0,Math.PI*2);ctx.stroke();
    });
  };
  if(disabled){paint(initial[0],initial[1],false);return {cancel(){}};}
  return bindColorWheel(canvas,{x:initial[0],y:initial[1],paint,onCommit,onReset,onError,canInteract});
}
export function bindScalarRange(input,slider,{canInteract,complete}){
  const listeners=[],win=input.ownerDocument?.defaultView ?? globalThis.window;let gesture=null,canceled=false,dirty=false,disposed=false;
  const listen=(node,key,handler)=>{node?.addEventListener?.(key,handler);listeners.push(()=>node?.removeEventListener?.(key,handler));};
  const live=()=>!disposed && slider.isConnected!==false && !slider.disabled && canInteract();
  const release=id=>{if(id===null)return;try{if(slider.hasPointerCapture?.(id))slider.releasePointerCapture(id);}catch{}};
  const cancel=()=>{const before=gesture;gesture=null;dirty=false;canceled=true;if(before){input.value=before.text;slider.value=before.slider;release(before.id);}else slider.value=input.value;};
  const start=id=>{canceled=false;dirty=false;gesture={id,text:input.value,slider:input.value};};
  const finish=()=>{const before=gesture;gesture=null;if(before)release(before.id);const changed=dirty || before && Number(input.value)!==Number(before.text);dirty=false;if(changed)complete();};
  listen(slider,'pointerdown',event=>{if(gesture || !live() || event.button!==0 || event.isPrimary===false || event.ctrlKey || event.metaKey || event.altKey)return;start(event.pointerId);try{slider.setPointerCapture?.(event.pointerId);}catch{cancel();}});
  listen(slider,'input',()=>{if(!live()){cancel();return;}if(canceled)return;if(!gesture)start(null);dirty ||= Number(input.value)!==Number(slider.value);input.value=slider.value;});
  listen(slider,'pointermove',event=>{if(gesture?.id===event.pointerId && (!live() || event.buttons!==undefined && !(event.buttons&1)))cancel();});
  listen(slider,'pointerup',event=>{if(!gesture || gesture.id!==event.pointerId)return;if(!live()){cancel();return;}input.value=slider.value;finish();});
  listen(slider,'change',()=>{if(canceled || !live()){cancel();return;}if(gesture && gesture.id!==null)return;if(dirty)finish();});
  for(const key of ['pointercancel','lostpointercapture'])listen(slider,key,event=>{if(gesture?.id===event.pointerId)cancel();});
  listen(slider,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancel();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key) && live() && !gesture)start(null);});
  listen(slider,'blur',cancel);listen(win,'blur',cancel);listen(input,'input',()=>{if(!gesture)slider.value=input.value;});listen(input,'change',()=>{if(!gesture)slider.value=input.value;});
  for(const key of ['pointermove','pointerup','pointercancel','lostpointercapture','blur'])listen(input,key,()=>{if(!gesture)slider.value=input.value;});
  listen(input,'keydown',event=>{if(event.key==='Escape' && !gesture)slider.value=input.value;});
  return {cancel,dispose(){if(disposed)return;cancel();disposed=true;for(const remove of listeners)remove();}};
}
export function renderSelectedFilters(root,detail,{controls,keyRow,openState,notice,timelineSize,bindNumber,onPreview}){
  if(!detail.filters)return [];
  const gestures=[],section=document.createElement('details'),heading=document.createElement('summary');section.dataset.visualPath='selected-filters';section.open=openState.get('selected-filters') ?? true;heading.textContent='Selected filters and color';section.append(heading);root.append(section);
  const help=document.createElement('details'),helpTitle=document.createElement('summary'),note=document.createElement('p');help.className='inspector-help';helpTitle.textContent='Editing selected filters';note.className='muted';note.textContent='Add affects the selected video clips; existing filters keep their settings. Parameter edits skip clips without this filter. Apply changes a constant default or writes a native key. Moving a filter refuses incompatible peer stack positions.';help.append(helpTitle,note);section.append(help);
  const addRow=document.createElement('div');addRow.className='inspector-filter-toolbar';section.append(addRow);
  const choice=controls.register(document.createElement('select'));choice.setAttribute('aria-label','Visual filter type');for(const kind of detail.filters.kinds)choice.append(new Option(kind,kind));if(detail.filters.kinds.length)choice.value=detail.filters.kinds[0];addRow.append(choice);
  const add=controls.button('Add visual filter to selection',()=>({action:'filter_presence',filter:choice.value,enabled:true}),addRow,()=>detail.filters.kinds.includes(choice.value));add.textContent='Add';choice.addEventListener('change',controls.sync);
  for(const [index,filter] of detail.filters.stack.entries()){
    const kind=filter.kind,card=document.createElement('details'),summary=document.createElement('summary');card.className='inspector-filter';card.dataset.visualPath=`selected-filter:${kind}`;card.open=openState.get(card.dataset.visualPath) ?? true;summary.textContent=kind;card.append(summary);section.append(card);
    const edit=patch=>controls.submit({action:'filter',filter:kind,patch});
    const enabled=controls.button(`${kind} enabled`,{action:'filter',filter:kind,patch:{enabled:!filter.enabled}},card);enabled.className='inspector-filter-enabled';enabled.textContent='Enabled';enabled.setAttribute('aria-pressed',String(filter.enabled));
    const reset=(params,flags={})=>({action:'reset_filter',filter:kind,params,reset_enabled:false,reset_color:false,reset_grade:false,...flags});
    const params=[];
    function keyControls(parent,label,values,parameters){keyRow(parent,label,values,{action:'toggle_filter_keys',filter:kind,params:parameters});controls.button(`Reset ${label}`,reset(parameters),parent);params.push(...parameters);}
    function number(parent,label,parameter,range,patch,key,{scrub=false,slider=false,speed=0.005}={}){
      const form=document.createElement('form'),field=document.createElement('label'),input=controls.register(document.createElement('input'));form.className='property-row inspector-number';field.className='field';field.textContent=label==='LowRange'?'Shadows range':label==='HighRange'?'Highlights range':label.startsWith(`${kind} `)?label.slice(kind.length+1):label.replace(/^(Shadows|Midtones|Highlights|Offset)(Luma|Sat)$/,'$2').replace(/^Saturation$/,'Sat');input.type='number';input.step='any';input.required=true;input.min=range[0];input.max=range[1];input.value=parameter.value;input.setAttribute('aria-label',label);field.append(input);form.append(field);
      const button=controls.register(document.createElement('button'));button.className='inspector-number-apply';button.textContent='Apply';button.setAttribute('aria-label',`Apply ${label}`);form.append(button);
      const live=()=>controls.available() && section.open && card.open && input.isConnected!==false;
      const complete=()=>{const value=Number(input.value);if(String(input.value).trim() && Number.isFinite(value) && value>=range[0] && value<=range[1] && value!==parameter.value && form.reportValidity())return edit(patch(value));};
      const submit=event=>{event.preventDefault();complete();};form.addEventListener('submit',submit);input.addEventListener('change',complete);controls.own({dispose(){form.removeEventListener?.('submit',submit);input.removeEventListener?.('change',complete);}});
      if(scrub && typeof bindNumber==='function'){input.title='Drag to adjust; Shift for fine control. Click to type. Escape cancels a drag.';controls.own(bindNumber(input,{canInteract:live,apply:complete,speed}));}
      if(slider){
        const rangeInput=controls.register(document.createElement('input'));rangeInput.type='range';rangeInput.min=range[0];rangeInput.max=range[1];rangeInput.step='any';rangeInput.value=parameter.value;rangeInput.className='inspector-inline-slider';rangeInput.setAttribute('aria-label',`${label} slider`);field.className+=' inspector-slider-field';form.className+=' inspector-grade-range';field.append(rangeInput);
        controls.own(bindScalarRange(input,rangeInput,{canInteract:live,complete}));
      }
      parent.append(form);if(key)keyControls(form,label,[parameter],[key]);return input;
    }
    if(['BoxBlur','GaussianBlur','DropShadow'].includes(kind))number(card,kind==='DropShadow'?'DropShadow softness':`${kind} radius`,filter.radius,[0,detail.filters.blur_radius_max],radius=>({radius}),{kind:'radius'},{scrub:true,slider:true,speed:0.5});
    if(['BoxBlur','GaussianBlur'].includes(kind)){
      const field=document.createElement('label'),select=controls.register(document.createElement('button'));field.className='field';field.textContent=`${kind} direction`;select.value=filter.direction_info?.value ?? filter.direction;field.append(select);card.append(field);
      controls.own(createTransitionChoice(select,{label:`${kind} direction`,values:detail.filters.blur_directions,canInteract:controls.available,notice,onPreview:value=>onPreview?.(value===null?null:{kind:'blur_direction',filter:kind,direction:value}),onConfirm:direction=>edit({direction})}));keyControls(field,`${kind} direction`,[filter.direction_info || {}],[{kind:'direction'}]);
    }
    if(filter.amount_range)number(card,kind==='Exposure'?'Exposure stops':`${kind} opacity`,filter.amount,filter.amount_range,amount=>({amount}),{kind:'amount'},{scrub:true,slider:true,speed:kind==='Exposure'?0.01:0.5});
    if(kind==='DropShadow'){
      number(card,'DropShadow grow',filter.grow,[0,detail.filters.shadow_grow_max],grow=>({grow}),{kind:'grow'},{scrub:true,slider:true,speed:0.5});
      const offset=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='DropShadow offset';offset.append(legend);card.append(offset);
      for(const axis of [0,1]){const bound=Number.isFinite(timelineSize?.[axis]) && timelineSize[axis]>0?timelineSize[axis]:8192;number(offset,`DropShadow offset ${axis?'Y':'X'}`,filter.offset[axis],[-bound,bound],value=>({offset:filter.offset.map((own,index)=>index===axis?value:own.value)}),null,{scrub:true,speed:0.5});}
      keyControls(offset,'DropShadow offset',filter.offset,[{kind:'offset',axis:0},{kind:'offset',axis:1}]);
      const color=document.createElement('div');color.className='inspector-color-row';card.append(color);
      gestures.push(renderColorPicker(color,{label:'DropShadow color',value:filter.color,controls,apply:value=>edit({color:value}),openState}));
      controls.button('Reset DropShadow color',reset([],{reset_color:true}),card);
    }
    if(kind==='ColorCorrection'){
      const presetRow=document.createElement('div');presetRow.className='inspector-filter-toolbar';card.append(presetRow);
      const preset=controls.register(document.createElement('select'));preset.setAttribute('aria-label','Native color preset');preset.append(new Option('Choose a preset…',''));for(const name of detail.filters.grade_presets || [])preset.append(new Option(name,name));preset.value='';presetRow.append(preset);
      const applyPreset=controls.button('Apply native color preset',()=>({action:'grade_preset',preset:preset.value}),presetRow,()=>Boolean(detail.filters.grade_presets?.includes(preset.value)));applyPreset.textContent='Apply preset';preset.addEventListener('change',controls.sync);
      const balance=controls.register(document.createElement('button'));balance.type='button';balance.textContent='Auto balance';balance.dataset.inspectorAutoBalance='';balance.setAttribute('aria-label','Auto balance selected video');balance.addEventListener('click',event=>{if(!controls.available()){event.preventDefault();event.stopPropagation();}});presetRow.append(balance);
      const wheels=document.createElement('div');wheels.className='grade-wheels';card.append(wheels);const grouped=new Set(),scalarParents=new Map();
      const coordinates=document.createElement('details'),coordinatesTitle=document.createElement('summary');coordinates.dataset.visualPath='selected-grade-coordinates';coordinates.open=openState.get(coordinates.dataset.visualPath) ?? false;coordinates.className='inspector-grade-coordinates';coordinatesTitle.textContent='Wheel coordinates and numeric grade';coordinates.append(coordinatesTitle);
      for(const wheel of detail.filters.wheels || []){
        const names=[wheel.x,wheel.y,wheel.luma,wheel.saturation],values=names.map(param=>filter.grade.find(value=>value.param===param));
        if(new Set(names).size!==4 || values.some(value=>!value || !Number.isFinite(value.value)))continue;
        for(const name of names)grouped.add(name);
        const block=document.createElement('div'),label=document.createElement('strong'),canvas=document.createElement('canvas');block.className='inspector-wheel';label.textContent=wheel.name;block.append(label);wheels.append(block);const [x,y]=values;
        keyControls(block,`${wheel.name} wheel`,values,names.map(param=>({kind:'grade',param})));
        canvas.className='color-wheel';canvas.tabIndex=0;canvas.setAttribute('role','group');canvas.setAttribute('aria-label',`${wheel.name} color wheel; arrows adjust X/Y`);block.append(canvas);
        gestures.push(colorWheel(canvas,detail.filters.wheel_hues,[x.value,y.value],(x,y)=>edit({grade:[{param:wheel.x,value:x},{param:wheel.y,value:y}]}),notice,false,()=>controls.available(),()=>controls.submit(reset(names.slice(0,2).map(param=>({kind:'grade',param}))))));
        scalarParents.set(wheel.luma,block);scalarParents.set(wheel.saturation,block);
      }
      for(const parameter of filter.grade || []){
        const key={kind:'grade',param:parameter.param},parent=scalarParents.get(parameter.param) || (grouped.has(parameter.param)?coordinates:card);
        const boundary=['LowRange','HighRange'].includes(parameter.param),scalar=boundary || /Luma$|Sat$|^Saturation$/.test(parameter.param);
        number(parent,parameter.param,parameter,parameter.range,value=>({grade:[{param:parameter.param,value}]}),grouped.has(parameter.param)?null:key,{scrub:scalar,slider:boundary});
        if(grouped.has(parameter.param))controls.button(`Reset ${parameter.param}`,reset([key]),parent);
      }
      card.append(coordinates);
      controls.button('Reset ColorCorrection grade',reset([],{reset_grade:true}),card);
    }
    const actions=document.createElement('div');actions.className='inspector-filter-actions';card.append(actions);
    controls.button(`Reset ${kind} filter`,reset(params,{reset_enabled:true,reset_color:kind==='DropShadow',reset_grade:kind==='ColorCorrection'}),actions);
    for(const [label,to] of [['Move up',index-1],['Move down',index+1]]){const button=controls.register(document.createElement('button'),()=>to>=0 && to<detail.filters.stack.length);button.type='button';button.textContent=to<index?'↑':'↓';button.title=`${label} ${kind}`;button.setAttribute('aria-label',button.title);button.addEventListener('click',()=>{if(to>=0 && to<detail.filters.stack.length)controls.submit({action:'filter_move',filter:kind,to_index:to});});actions.append(button);}
    const remove=controls.button(`Remove ${kind} from selection`,{action:'filter_presence',filter:kind,enabled:false},actions);remove.textContent='Remove';
  }
  return gestures;
}
export function renderFilters(root,detail,{disabled,getFrame,commit,notice,openState,canInteract=()=>true}) {
  const controls=[];
  const section=document.createElement("details"),heading=document.createElement("summary");section.dataset.visualPath="filters";section.open=openState.get("filters") || false;heading.textContent="Filters and color";section.append(heading);root.append(section);
  const post=(edit)=>commit({kind:"edit_filter",clip_id:detail.clip_id,edit});const report=(edit)=>post(edit).catch((error)=>notice(error.message));
  const choices=document.createElement("select");choices.setAttribute("aria-label","Visual filter type");choices.disabled=disabled;
  for(const name of detail.filters.kinds){const option=new Option(name,name);option.disabled=detail.filters.stack.some((filter)=>filter.kind===name);choices.append(option);}choices.selectedIndex=[...choices.options].findIndex((option)=>!option.disabled);section.append(choices);
  const add=document.createElement("button");add.textContent="Add visual filter";add.disabled=disabled || choices.selectedIndex<0;add.addEventListener("click",()=>report({action:"add",filter:choices.value}));section.append(add);
  const note=document.createElement("p");note.className="muted";note.textContent="Apply changes defaults; ◆ writes at the playhead. Wheels with animated X/Y write a joint keyframe. Escape cancels a wheel drag.";section.append(note);
  for(const [index,filter] of detail.filters.stack.entries()) {
    const card=document.createElement("details"),title=document.createElement("summary");card.dataset.visualPath=`filter:${filter.kind}`;card.open=openState.get(card.dataset.visualPath) ?? true;title.textContent=`${index+1} · ${filter.kind}`;card.append(title);section.append(card);
    const enabled=document.createElement("button");enabled.textContent=`${filter.kind} enabled`;enabled.setAttribute("aria-pressed",filter.enabled);enabled.disabled=disabled;enabled.addEventListener("click",()=>report({action:"set",filter:filter.kind,patch:{enabled:!filter.enabled}}));card.append(enabled);
    function number(parent,label,value,range,patch,target) {
      const form=document.createElement("form");form.className="property-row";const row=document.createElement("label");row.className="field";row.textContent=label;
      const input=document.createElement("input");input.type="number";input.required=true;input.step="any";input.min=range[0];input.max=range[1];input.value=value;input.disabled=disabled;row.append(input);form.append(row);
      const apply=document.createElement("button");apply.textContent="Apply";apply.disabled=disabled;form.append(apply);form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())report({action:"set",filter:filter.kind,patch:patch(Number(input.value))});});
      if(target)for(const [text,remove]of [["◆",false],["−◆",true]]){const button=document.createElement("button");button.type="button";button.textContent=text;button.disabled=disabled;button.setAttribute("aria-label",`${remove ? "Remove" : "Set"} ${label} keyframe at playhead`);button.addEventListener("click",()=>{if(form.reportValidity())commit({kind:"set_keyframe",clip_id:detail.clip_id,edit:{target,timeline_frame:getFrame(),value:remove ? null : Number(input.value),interpolation:"Linear"}}).catch((error)=>notice(error.message));});form.append(button);}
      parent.append(form);
    }
    if(filter.kind==="ColorCorrection") {
      const preset=document.createElement("select");preset.setAttribute("aria-label","Native color preset");preset.disabled=disabled;
      preset.append(new Option("Choose a preset…",""));
      for(const name of detail.filters.grade_presets || [])preset.append(new Option(name === "BlackAndWhite" ? "Black and white" : name,name));
      const applyPreset=document.createElement("button");applyPreset.textContent="Apply native color preset";applyPreset.disabled=true;preset.addEventListener("change",()=>{applyPreset.disabled=disabled || !preset.value;});
      applyPreset.addEventListener("click",()=>commit({kind:"apply_grade_preset",clip_id:detail.clip_id,preset:preset.value}).catch((error)=>notice(error.message)));
      const presetNote=document.createElement("p");presetNote.className="muted";presetNote.textContent="Neutral resets grade animation. Black and white resets only global saturation. One Undo restores the grade.";
      card.append(preset,applyPreset,presetNote);
      const wheels=document.createElement("div");wheels.className="grade-wheels";card.append(wheels);
      for(const wheel of detail.filters.wheels) {
        const block=document.createElement("div"),label=document.createElement("strong");label.textContent=wheel.name;block.append(label);wheels.append(block);
        const x=filter.grade.find((p)=>p.param===wheel.x),y=filter.grade.find((p)=>p.param===wheel.y);
        const canvas=document.createElement("canvas");canvas.className="color-wheel";canvas.tabIndex=disabled ? -1 : 0;canvas.setAttribute("role","group");canvas.setAttribute("aria-label",`${wheel.name} color wheel; arrows adjust X/Y`);block.append(canvas);
        canvas.setAttribute("aria-disabled",String(disabled));
        controls.push(colorWheel(canvas,detail.filters.wheel_hues,[x.value,y.value],(nx,ny)=>{
          const parameters=[{param:wheel.x,value:nx},{param:wheel.y,value:ny}];
          return x.keyframes.length || y.keyframes.length ? commit({kind:"set_keyframes",clip_id:detail.clip_id,edits:parameters.map(({param,value})=>({target:{kind:"grade",param},timeline_frame:getFrame(),value,interpolation:"Linear"}))}) : post({action:"set",filter:filter.kind,patch:{grade:parameters}});
        },notice,disabled,()=>root.isConnected!==false && canInteract()));
        for(const param of [wheel.x,wheel.y,wheel.luma,wheel.saturation]){const parameter=filter.grade.find((p)=>p.param===param);number(block,param,parameter.value,parameter.range,(value)=>({grade:[{param,value}]}),{kind:"grade",param});}
      }
      for(const parameter of filter.grade.filter((p)=>["LowRange","HighRange"].includes(p.param)))number(card,parameter.param,parameter.value,parameter.range,(value)=>({grade:[{param:parameter.param,value}]}),{kind:"grade",param:parameter.param});
    }
    if(["BoxBlur","GaussianBlur","DropShadow"].includes(filter.kind))number(card,`${filter.kind} radius`,filter.radius.value,[0,detail.filters.blur_radius_max],(radius)=>({radius}),{kind:"filter_radius",filter:filter.kind});
    if(["BoxBlur","GaussianBlur"].includes(filter.kind)) {
      const direction=document.createElement("select");direction.setAttribute("aria-label",`${filter.kind} direction`);direction.disabled=disabled;for(const name of detail.filters.blur_directions)direction.append(new Option(name,name));direction.value=filter.direction;direction.addEventListener("change",()=>report({action:"set",filter:filter.kind,patch:{direction:direction.value}}));card.append(direction);
    }
    if(filter.amount_range)number(card,`${filter.kind} amount`,filter.amount.value,filter.amount_range,(amount)=>({amount}),{kind:"filter_amount",filter:filter.kind});
    if(filter.kind==="DropShadow") {
      number(card,"DropShadow grow",filter.grow.value,[0,detail.filters.shadow_grow_max],(grow)=>({grow}),{kind:"filter_grow",filter:filter.kind});
      for(const axis of [0,1])number(card,`DropShadow offset ${axis ? "Y" : "X"}`,filter.offset[axis].value,[-8192,8192],(value)=>({offset:filter.offset.map((p,i)=>i===axis ? value : p.value)}),{kind:"filter_offset",filter:filter.kind,axis});
      for(const key of ["r","g","b","a"])number(card,`DropShadow ${key.toUpperCase()}`,filter.color[key],[0,1],(value)=>({color:{...filter.color,[key]:value}}));
    }
    for(const [label,to] of [["Move up",index-1],["Move down",index+1],["Remove",null]]){const button=document.createElement("button");button.textContent=`${label} ${filter.kind}`;button.disabled=disabled || (to!==null && (to<0 || to>=detail.filters.stack.length));button.addEventListener("click",()=>report(to===null ? {action:"remove",filter:filter.kind} : {action:"move",filter:filter.kind,to_index:to}));card.append(button);}
  }
  return controls;
}
