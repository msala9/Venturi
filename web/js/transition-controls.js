export function transitionFrameRate(fps){
  return Number.isSafeInteger(fps?.num) && fps.num>0 && Number.isSafeInteger(fps?.den) && fps.den>0?Math.max(1,fps.num/fps.den):null;
}
export function transitionDuration(value,unit,fps,max){
  if(!String(value).trim() || !Number.isFinite(Number(value)) || !Number.isSafeInteger(max) || max<1)throw Error('Choose a finite transition duration');
  const rate=transitionFrameRate(fps);if(unit==='seconds' && rate===null)throw Error('Read the native timeline frame rate before editing seconds');
  if(!['seconds','frames'].includes(unit))throw Error('Choose seconds or frames');
  return Math.max(1,Math.min(max,Math.round(Number(value)*(unit==='seconds'?rate:1))));
}
const plain=event=>!event.defaultPrevented && !event.repeat && !event.isComposing && event.keyCode!==229 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.getModifierState?.('AltGraph');
let choiceSequence=0;
export function createTransitionChoice(button,{label,values,canInteract,onConfirm,onPreview,notice=()=>{},schedule=setTimeout,unschedule=clearTimeout}){
  const doc=button.ownerDocument ?? globalThis.document,view=doc?.defaultView ?? globalThis.window,listeners=[],prefix=`transition-choice-${++choiceSequence}`;
  let disposed=false,popup=null,draft=null,previewTimer=null,wheelTimer=null,previewSent=false,waiting=false;
  const listen=(node,key,handler,options)=>{node?.addEventListener?.(key,handler,options);listeners.push(()=>node?.removeEventListener?.(key,handler,options));};
  const available=()=>!disposed && !waiting && button.isConnected!==false && !button.disabled && canInteract();
  const attr=(node,name,value)=>node.setAttribute?.(name,String(value));
  button.type='button';button.className='transition-combobox';attr(button,'role','combobox');attr(button,'aria-label',label);attr(button,'aria-haspopup','listbox');attr(button,'aria-expanded','false');
  function report(value){try{Promise.resolve(onPreview?.(value)).catch(error=>{if(!disposed)notice(error.message);});}catch(error){if(!disposed)notice(error.message);}}
  function paint(){button.textContent=draft?values[draft.index]:button.value;attr(button,'aria-expanded',!!popup);if(popup){popup.rows.forEach((node,index)=>attr(node,'aria-selected',index===draft.index));const active=popup.rows[draft.index];if(active){attr(button,'aria-activedescendant',active.id);active.scrollIntoView?.({block:'nearest'});}}}
  function cancel(restore=false){
    const old=popup,hadPreview=previewSent;popup=null;draft=null;previewSent=false;
    if(previewTimer!==null)unschedule(previewTimer);if(wheelTimer!==null)unschedule(wheelTimer);previewTimer=wheelTimer=null;
    if(old){for(const remove of old.remove)remove();try{old.node.hidePopover?.();}catch{}old.node.remove?.();button.removeAttribute?.('aria-controls');button.removeAttribute?.('aria-activedescendant');}
    if(hadPreview)report(null);paint();if(restore && old && available())button.focus?.();
  }
  const owned=owner=>draft===owner && available() && (owner.mode==='wheel' || popup?.owner===owner);
  function preview(owner){
    if(previewTimer!==null)unschedule(previewTimer);
    previewTimer=schedule(()=>{previewTimer=null;if(!owned(owner)){if(draft===owner)cancel();return;}const next=values[owner.index];if(next!==button.value){previewSent=true;report(next);}else if(previewSent){previewSent=false;report(null);}},130);
  }
  function select(index){if(!draft || !available() || index<0 || index>=values.length)return;if(index!==draft.index && previewSent){previewSent=false;report(null);}draft.index=index;paint();preview(draft);}
  async function confirm(owner=draft){
    if(!owner || !owned(owner))return;const next=values[owner.index],before=button.value;cancel();if(next===before)return;waiting=true;button.value=next;paint();
    try{await onConfirm(next);}catch(error){button.value=before;notice(error.message);}finally{waiting=false;if(!disposed)paint();}
  }
  function open(){
    if(!available())return;cancel();const node=doc.createElement('div'),owner={index:Math.max(0,values.indexOf(button.value)),mode:'popup'},rows=[];
    node.id=prefix;node.className='transition-listbox';attr(node,'role','listbox');attr(node,'aria-label',`${label} choices`);attr(node,'popover','manual');draft=owner;popup={node,owner,rows,remove:[]};
    const popupListen=(node,key,handler)=>{node.addEventListener(key,handler);popup.remove.push(()=>node.removeEventListener(key,handler));};
    values.forEach((value,index)=>{const row=doc.createElement('div');row.id=`${prefix}-${index}`;row.textContent=value;attr(row,'role','option');popupListen(row,'pointerenter',()=>{if(popup?.owner===owner)select(index);});popupListen(row,'pointerdown',event=>event.preventDefault());popupListen(row,'click',event=>{if(!plain(event) || popup?.owner!==owner)return;event.preventDefault();event.stopPropagation();owner.index=index;void confirm(owner);});rows.push(row);node.append(row);});
    (doc.body ?? button.parentNode).append(node);attr(button,'aria-controls',prefix);
    const bounds=button.getBoundingClientRect?.() ?? {left:0,bottom:0,width:160},viewportWidth=view?.innerWidth ?? 1024,viewportHeight=view?.innerHeight ?? 768,width=Math.min(240,Math.max(120,bounds.width),Math.max(1,viewportWidth-16)),height=Math.min(values.length*28+8,Math.max(1,viewportHeight-16));
    if(node.style){node.style.left=`${Math.max(8,Math.min(bounds.left,viewportWidth-width-8))}px`;node.style.top=`${Math.max(8,Math.min(bounds.bottom+3,viewportHeight-height-8))}px`;node.style.width=`${width}px`;node.style.maxHeight=`${height}px`;}
    try{node.showPopover?.();}catch{}paint();button.focus?.();
  }
  function keyboard(event){
    event.stopPropagation();if(event.key==='Tab'){cancel();return;}if(event.key==='Escape'){if(popup || draft){event.preventDefault();cancel(true);}return;}
    if(!plain(event)){if(['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key))event.preventDefault();return;}
    if(['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!available()){cancel();return;}if(['Enter',' '].includes(event.key)){if(popup)void confirm();else open();return;}if(!popup)open();if(!draft)return;
      select(event.key==='Home'?0:event.key==='End'?values.length-1:Math.max(0,Math.min(values.length-1,draft.index+(event.key==='ArrowDown'?1:-1))));
    }else if(event.key?.length===1){event.preventDefault();if(!available()){cancel();return;}if(!popup)open();if(!draft)return;for(let offset=1;offset<=values.length;offset++){const index=(draft.index+offset)%values.length;if(values[index].toLowerCase().startsWith(event.key.toLowerCase())){select(index);break;}}}
  }
  function wheel(event){
    if(popup || !plain(event) || !Number.isFinite(event.deltaY) || !event.deltaY || !available())return;event.preventDefault();event.stopPropagation();
    if(draft?.mode!=='wheel'){cancel();draft={mode:'wheel',index:Math.max(0,values.indexOf(button.value))};}
    const owner=draft,index=Math.max(0,Math.min(values.length-1,owner.index+Math.sign(event.deltaY)));
    if(values[index]===button.value){cancel();return;}select(index);if(wheelTimer!==null)unschedule(wheelTimer);wheelTimer=schedule(()=>{wheelTimer=null;if(owned(owner))void confirm(owner);else if(draft===owner)cancel();},150);
  }
  const inside=node=>node===button || !!popup?.node.contains?.(node);
  listen(button,'click',event=>{if(!plain(event))return;if(popup)cancel();else open();});listen(button,'keydown',keyboard);listen(button,'wheel',wheel,{passive:false});
  listen(doc,'pointerdown',event=>{if((popup || draft) && !inside(event.target))cancel();},true);listen(doc,'focusin',event=>{if((popup || draft) && !inside(event.target))cancel();});listen(doc,'scroll',event=>{if((popup || draft) && !popup?.node.contains?.(event.target))cancel();},true);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel();});listen(view,'blur',()=>cancel());listen(view,'resize',()=>cancel());paint();
  return {cancel,dispose(){if(disposed)return;cancel();disposed=true;for(const remove of listeners)remove();}};
}

export function renderTransitionControls(root,target,{disabled=false,getTarget,canInteract,commit,notice,fps,onPreview=null,bindNumber,operation,schedule=setTimeout,unschedule=clearTimeout}){
  const doc=root.ownerDocument ?? globalThis.document,view=doc.defaultView ?? globalThis.window,identity=JSON.stringify(target),base=structuredClone(target.transition),rate=transitionFrameRate(fps),bindings=[],choices=[],listeners=[],fields={},rows={};
  let disposed=false,waiting=false,rangeGesture=null,previewSequence=0;
  const attr=(node,name,value)=>node.setAttribute?.(name,String(value));
  const listen=(node,key,handler,options)=>{node?.addEventListener?.(key,handler,options);listeners.push(()=>node?.removeEventListener?.(key,handler,options));};
  const current=()=>!disposed && root.isConnected!==false && !disabled && !doc.hidden && !root.closest?.('[hidden],[inert],details:not([open])') && !doc.querySelector?.('dialog[open]') && canInteract() && JSON.stringify(getTarget())===identity;
  const available=()=>!waiting && current();
  const heading=doc.createElement('strong');heading.textContent=`${base.kind} · ${target.slot==='cut_after'?'Cross transition':`Transition ${target.slot}`}`;root.append(heading);
  const form=doc.createElement('form');form.className='property-row transition-controls';
  const row=(label,type,value,min,max,step,className='')=>{const field=doc.createElement('label'),input=doc.createElement(type==='choice'?'button':'input');field.className=`field ${className}`;field.textContent=label;attr(input,'aria-label',label);input.value=String(value);if(type!=='choice'){input.type=type;input.min=min;input.max=max;input.step=step;input.required=true;}input.disabled=disabled;field.append(input);form.append(field);rows[label]=field;return input;};
  fields.duration=row('Duration frames','number',base.duration,1,target.max,1,'transition-duration-field');
  const seconds=row('Duration seconds','number',rate===null?'':base.duration/rate,0,rate===null?0:target.max/rate,'any','transition-duration-field');seconds.disabled=disabled || rate===null;
  for(const [key,label,values] of [['direction','Push direction',['Left','Right','Up','Down']],['ease','Ease',['None','In','Out','InOut']]]){
    if(key==='direction' && base.kind!=='Push')continue;fields[key]=row(label,'choice',base[key]);
    choices.push(createTransitionChoice(fields[key],{label,values,canInteract:available,schedule,unschedule,notice,onPreview:value=>preview(value===null?null:{[key]:value}),onConfirm:()=>send(readPatch())}));
  }
  fields.curve=row('Curve','number',base.curve,0,1,'any','transition-curve-field');
  const range=doc.createElement('input');range.type='range';range.min=0;range.max=1;range.step='any';range.value=String(base.curve);range.disabled=disabled;range.className='transition-curve';attr(range,'aria-label','Transition curve slider');rows.Curve.append(range);
  form.title=onPreview?'Drag to adjust; Shift for fine control. Menu choices preview; Enter confirms, Escape cancels.':'Drag to adjust; Shift for fine control. Apply confirms typed values.';
  const apply=doc.createElement('button'),remove=doc.createElement('button');apply.textContent='Apply transition';remove.textContent='Remove transition';remove.type='button';apply.disabled=remove.disabled=disabled;form.append(apply,remove);root.append(form);
  function readPatch(override={}){
    const patch={};for(const [name,input] of Object.entries(fields)){if(['duration','curve'].includes(name)){if(!String(input.value).trim() || !Number.isFinite(Number(input.value)))throw Error('Choose valid transition values before confirming');patch[name]=Number(input.value);}else patch[name]=input.value;}
    return {...patch,...override};
  }
  function syncDuration(unit){const frames=transitionDuration(unit==='seconds'?seconds.value:fields.duration.value,unit,fps,target.max);fields.duration.value=String(frames);if(rate!==null)seconds.value=String(frames/rate);}
  function reset(){for(const [name,input] of Object.entries(fields))input.value=String(base[name]);if(rate!==null)seconds.value=String(base.duration/rate);range.value=String(base.curve);}
  function preview(patch){
    const seq=++previewSequence;try{const value=patch===null?null:operation(target,readPatch(patch))?.transition ?? base;return Promise.resolve(onPreview?.(value)).catch(error=>{if(!disposed && seq===previewSequence)notice(error.message);});}catch(error){if(!disposed)notice(error.message);return Promise.resolve();}
  }
  function cancelDraft(){for(const choice of choices)choice.cancel();for(const binding of bindings)binding.cancel();const old=rangeGesture;rangeGesture=null;if(old?.id!==undefined)try{if(range.hasPointerCapture?.(old.id))range.releasePointerCapture(old.id);}catch{}reset();void preview(null);}
  function lock(){for(const input of [...Object.values(fields),seconds,range,apply,remove])input.disabled=disabled || waiting || disposed || input===seconds && rate===null;}
  async function send(patch){
    if(!available()){notice('Transition changed; read its current properties before editing');cancelDraft();return;}
    if(patch!==null && form.reportValidity?.()===false)throw Error('Choose valid transition values before confirming');
    let command;try{command=operation(target,patch);}catch(error){notice(error.message);throw error;}if(!command)return;
    waiting=true;for(const choice of choices)choice.cancel();void preview(null);lock();
    try{if(!current())throw Error('Transition changed; read its current properties before editing');await commit(command);}
    catch(error){waiting=false;reset();lock();notice(error.message);throw error;}
  }
  const attempt=callback=>{try{Promise.resolve(callback()).catch(()=>{});}catch(error){notice(error.message);}};
  listen(fields.duration,'input',()=>{if(rate!==null && String(fields.duration.value).trim() && Number.isFinite(Number(fields.duration.value)))seconds.value=String(Number(fields.duration.value)/rate);});
  listen(seconds,'input',()=>{try{fields.duration.value=String(transitionDuration(seconds.value,'seconds',fps,target.max));}catch{}});
  listen(fields.curve,'input',()=>{if(String(fields.curve.value).trim() && Number.isFinite(Number(fields.curve.value)))range.value=fields.curve.value;});
  if(bindNumber){
    bindings.push(bindNumber(fields.duration,{canInteract:available,speed:0.25,apply:()=>attempt(()=>{syncDuration('frames');return send(readPatch());})}));
    bindings.push(bindNumber(seconds,{canInteract:()=>available() && rate!==null,speed:0.02,apply:()=>attempt(()=>{syncDuration('seconds');return send(readPatch());})}));
    bindings.push(bindNumber(fields.curve,{canInteract:available,speed:0.003,apply:()=>attempt(()=>{range.value=fields.curve.value;return send(readPatch());})}));
  }
  listen(form,'submit',event=>{event.preventDefault();attempt(()=>{if(form.reportValidity?.()===false)return;return send(readPatch());});});listen(apply,'click',event=>{if(!plain(event))event.preventDefault();});listen(remove,'click',event=>{if(plain(event))attempt(()=>send(null));});
  listen(range,'pointerdown',event=>{if(rangeGesture || !available() || event.button!==0 || event.isPrimary===false || event.ctrlKey || event.metaKey || event.altKey)return;rangeGesture={id:event.pointerId,value:fields.curve.value};range.setPointerCapture?.(event.pointerId);});
  listen(range,'input',()=>{if(rangeGesture && available())fields.curve.value=range.value;});
  listen(range,'pointermove',event=>{if(rangeGesture?.id===event.pointerId && (!available() || event.buttons!==undefined && !(event.buttons&1)))cancelDraft();});
  listen(range,'pointerup',event=>{if(!rangeGesture || rangeGesture.id!==event.pointerId)return;if(!available()){cancelDraft();return;}const before=rangeGesture;rangeGesture=null;try{if(range.hasPointerCapture?.(before.id))range.releasePointerCapture(before.id);}catch{}if(Number(fields.curve.value)!==Number(before.value))attempt(()=>send(readPatch()));});
  for(const key of ['pointercancel','lostpointercapture'])listen(range,key,event=>{if(rangeGesture?.id===event.pointerId)cancelDraft();});
  listen(range,'change',()=>{if(!rangeGesture && available() && Number(range.value)!==Number(fields.curve.value)){fields.curve.value=range.value;attempt(()=>send(readPatch()));}});
  for(const node of [...Object.values(fields),seconds,range,apply,remove])listen(node,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancelDraft();}else if(['Enter',' '].includes(event.key) && !plain(event))event.preventDefault();});
  listen(view,'blur',cancelDraft);listen(view,'resize',cancelDraft);listen(doc,'visibilitychange',()=>{if(doc.hidden)cancelDraft();});
  listen(doc,'scroll',event=>{if(rangeGesture && !form.contains?.(event.target))cancelDraft();},true);
  lock();
  function dispose(){if(disposed)return;cancelDraft();disposed=true;for(const choice of choices)choice.dispose();for(const binding of bindings)binding.dispose();for(const remove of listeners)remove();}
  return {cancel:cancelDraft,dispose};
}
