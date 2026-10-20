export function wheelDelta(x,y,dx,dy,radius,fine=false) {
  const scale=(fine ? 0.2 : 1)/(radius*2.5);let nextX=x+dx*scale,nextY=y-dy*scale;
  const length=Math.hypot(nextX,nextY);if(length>1){nextX/=length;nextY/=length;}return [nextX,nextY];
}
export function bindColorWheel(canvas,{x,y,paint,onCommit,onError}) {
  let gesture=null,waiting=false;
  const redraw=()=>paint(x,y,!!gesture);
  const cancel=()=>{if(gesture){x=gesture.x;y=gesture.y;gesture=null;redraw();}};
  async function commit(before) {
    waiting=true;
    try{await onCommit(x,y);}catch(error){x=before[0];y=before[1];redraw();onError(error.message);}finally{waiting=false;}
  }
  canvas.addEventListener("pointerdown",(event)=>{
    if(waiting || event.button!==0)return;canvas.focus();canvas.setPointerCapture(event.pointerId);
    gesture={x,y,lastX:event.clientX,lastY:event.clientY,moved:false,id:event.pointerId};
  });
  canvas.addEventListener("pointermove",(event)=>{
    if(!gesture)return;
    const radius=canvas.getBoundingClientRect().width/2-6;
    [x,y]=wheelDelta(x,y,event.clientX-gesture.lastX,event.clientY-gesture.lastY,radius,event.shiftKey);
    gesture.lastX=event.clientX;gesture.lastY=event.clientY;gesture.moved=x!==gesture.x || y!==gesture.y;redraw();
  });
  canvas.addEventListener("pointerup",()=>{
    if(!gesture)return;const before=gesture;gesture=null;
    canvas.releasePointerCapture(before.id);redraw();if(before.moved)commit([before.x,before.y]);
  });
  canvas.addEventListener("pointercancel",cancel);canvas.addEventListener("lostpointercapture",cancel);
  canvas.addEventListener("keydown",(event)=>{
    if(event.key==="Escape"){event.stopPropagation();event.preventDefault();cancel();return;}
    const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!direction)return;event.stopPropagation();event.preventDefault();if(waiting)return;
    const before=[x,y];[x,y]=wheelDelta(x,y,direction[0]*2.5,direction[1]*2.5,100,event.shiftKey);redraw();commit(before);
  });
  canvas.addEventListener("dblclick",()=>{if(waiting || (!x && !y))return;const before=[x,y];x=0;y=0;redraw();commit(before);});
  redraw();return {cancel};
}
function colorWheel(canvas,hues,initial,onCommit,onError,disabled=false) {
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
  return bindColorWheel(canvas,{x:initial[0],y:initial[1],paint,onCommit,onError});
}
export function renderFilters(root,detail,{disabled,getFrame,commit,notice,openState}) {
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
        },notice,disabled));
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
