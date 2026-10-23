import {compressorPosition as knobPosition,compressorValue as knobValue} from './compressor-controls.js';

const f=Math.fround,clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=['freq_hz','gain_db','q'],names={freq_hz:'Hz',gain_db:'Gain',q:'Q'},steps={freq_hz:5,gain_db:.1,q:.01};
export function eqKnobDelta(value,range,log,dx,dy,fine=false){
  const delta=f(f(f(f(dx)-f(dy))/200)*f(fine ? .1 : 1));
  return delta===0?f(value):knobValue(f(knobPosition(value,range,log)+delta),range,log);
}
export function createEqControls({root,label,getParameters,defaults,catalog,canInteract,isCurrent=()=>true,isValid=()=>true,getContext=()=>null,onStart=()=>{},onDraft=()=>{},onCancel=()=>{},onCommit,notice=()=>{},windowRef=globalThis.window,documentRef=globalThis.document}){
  const host=documentRef.createElement('div');host.className='eq-controls';root.append(host);
  const range=value=>Array.isArray(value) && value.length===2 && value.every(Number.isFinite) && value[0]<value[1];
  if(!keys.every(key=>range(catalog[key])) || catalog.freq_hz[0]<=0 || catalog.q[0]<=0 || !catalog.graph?.shape_has_gain || !Array.isArray(catalog.shapes) || !Array.isArray(defaults?.bands) || defaults.bands.length!==6){
    host.textContent='Native EQ metadata unavailable · use the precise fields';return {sync(){},cancel(){},dispose(){}};
  }
  let values=structuredClone(getParameters()),gesture=null,waiting=false,unknown=false,disposed=false;
  const controls=[],toggles=[],resets=[],listeners=[];
  const listen=(target,type,callback,options)=>{target?.addEventListener?.(type,callback,options);listeners.push(()=>target?.removeEventListener?.(type,callback,options));};
  const live=()=>!disposed && !waiting && !unknown && root.isConnected!==false && host.isConnected!==false && !documentRef.hidden && isCurrent() && canInteract();
  const owned=node=>node.isConnected!==false && !node.disabled;
  const valid=next=>Array.isArray(next?.bands) && next.bands.length===6 && next.bands.every(band=>typeof band.enabled==='boolean' && catalog.shapes.includes(band.shape) && keys.every(key=>Number.isFinite(band[key]) && band[key]>=catalog[key][0] && band[key]<=catalog[key][1]));
  const sizeKey=node=>{const rect=node.getBoundingClientRect();return JSON.stringify([rect.width,rect.height]);};
  function paint(){
    for(const {button,output,band,key} of controls){
      const data=values.bands[band],position=knobPosition(data[key],catalog[key],key!=='gain_db');button.disabled=!live() || button.isConnected===false || !data.enabled || key==='gain_db' && !catalog.graph.shape_has_gain[data.shape];
      button.style?.setProperty('--eq-angle',`${f(f(f(position*2)-1)*135)}deg`);button.setAttribute('aria-valuenow',String(data[key]));
      const text=key==='freq_hz'?`${data[key].toFixed(0)} Hz`:key==='gain_db'?`${data[key].toFixed(1)} dB`:data[key].toFixed(2);output.textContent=text;button.setAttribute('aria-valuetext',text);
    }
    for(const {toggle,shape,band} of toggles){toggle.disabled=shape.disabled=!live() || toggle.isConnected===false || shape.isConnected===false;toggle.checked=values.bands[band].enabled;shape.value=values.bands[band].shape;}
    for(const reset of resets)reset.disabled=!live() || reset.isConnected===false;host.setAttribute('aria-busy',String(waiting));
  }
  function release(owner){try{if(owner.button.hasPointerCapture?.(owner.id))owner.button.releasePointerCapture(owner.id);}catch{}}
  function cancel(restore=true){if(!gesture)return;const owner=gesture;gesture=null;values=structuredClone(owner.before);release(owner);if(restore)onCancel();paint();}
  function sync(){cancel(false);if(!disposed){values=structuredClone(getParameters());paint();}}
  const current=owner=>live() && owned(owner.button) && owner.context===getContext() && same(owner.before,getParameters()) && owner.size===sizeKey(owner.button) && isValid();
  async function commit(next,before,context,node){
    if(same(next,before)){onCancel();sync();return;}
    if(!live() || !owned(node) || context!==getContext() || !same(before,getParameters()) || !isValid() || !valid(next)){onCancel();sync();return;}
    waiting=true;values=structuredClone(next);paint();
    try{await onCommit(structuredClone(next));}catch(error){if(error.code==='OUTCOME_UNKNOWN')unknown=true;if(!disposed){onCancel();notice(error.message);}}
    finally{waiting=false;if(!disposed){values=structuredClone(getParameters());paint();}}
  }
  const edit=(node,change)=>{
    if(!live() || !owned(node) || !isValid())return;cancel();onStart();const before=structuredClone(getParameters()),next=structuredClone(before);change(next);onDraft(next);void commit(next,before,getContext(),node);
  };
  function move(event,releaseEvent=false){
    const owner=gesture;if(!owner || event.pointerId!==owner.id || event.currentTarget!==owner.button)return;
    if(!current(owner) || !releaseEvent && event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
    const dx=event.clientX-owner.x,dy=event.clientY-owner.y;owner.x=event.clientX;owner.y=event.clientY;if(!dx && !dy)return;
    values.bands[owner.band][owner.key]=eqKnobDelta(values.bands[owner.band][owner.key],catalog[owner.key],owner.key!=='gain_db',dx,dy,event.shiftKey);paint();onDraft(structuredClone(values));
  }
  for(let band=0;band<6;band++){
    const strip=documentRef.createElement('section');strip.className='eq-band-controls';strip.dataset.eqBand=String(band);host.append(strip);
    const heading=documentRef.createElement('strong');heading.textContent=String(band+1);strip.append(heading);
    const enabled=documentRef.createElement('label'),toggle=documentRef.createElement('input');enabled.textContent='On';toggle.type='checkbox';toggle.setAttribute('aria-label',`${label} EQ band ${band+1} on`);enabled.append(toggle);strip.append(enabled);
    const shape=documentRef.createElement('select');shape.setAttribute('aria-label',`${label} EQ band ${band+1} shape`);for(const value of catalog.shapes){const option=documentRef.createElement('option');option.value=value;option.textContent=value;shape.append(option);}strip.append(shape);toggles.push({toggle,shape,band});
    listen(toggle,'change',()=>{const checked=toggle.checked;edit(toggle,next=>{next.bands[band].enabled=checked;});paint();});
    listen(shape,'change',()=>{const selected=shape.value;edit(shape,next=>{next.bands[band].shape=selected;});paint();});
    for(const key of keys){
      const cell=documentRef.createElement('div');cell.className='eq-control-cell';strip.append(cell);const name=documentRef.createElement('span');name.textContent=names[key];cell.append(name);
      const button=documentRef.createElement('button');button.type='button';button.className='eq-knob';button.dataset.eqBand=String(band);button.dataset.eqParam=key;button.setAttribute('role','slider');button.setAttribute('aria-label',`${label} EQ band ${band+1} ${names[key]} knob`);button.setAttribute('aria-valuemin',String(catalog[key][0]));button.setAttribute('aria-valuemax',String(catalog[key][1]));
      const mark=documentRef.createElement('span');mark.className='eq-knob-mark';mark.setAttribute('aria-hidden','true');button.append(mark);const output=documentRef.createElement('output');cell.append(button,output);controls.push({button,output,band,key});
      listen(button,'pointerdown',event=>{
        if(event.button!==0 || event.isPrimary===false || gesture || !live() || !owned(button) || !isValid())return;
        event.preventDefault();button.focus();onStart();values=structuredClone(getParameters());gesture={id:event.pointerId,button,band,key,before:structuredClone(values),context:getContext(),size:sizeKey(button),x:event.clientX,y:event.clientY};
        try{button.setPointerCapture(event.pointerId);}catch{cancel();}
      });
      listen(button,'pointermove',move);listen(button,'pointerup',event=>{if(!gesture || gesture.button!==button || gesture.id!==event.pointerId || event.button!==0)return;move(event,true);if(!gesture)return;const owner=gesture;gesture=null;release(owner);void commit(values,owner.before,owner.context,button);});
      for(const type of ['pointercancel','lostpointercapture'])listen(button,type,event=>{if(gesture?.button===button && gesture.id===event.pointerId)cancel();});listen(button,'blur',()=>{if(gesture?.button===button)cancel();});
      const reset=()=>edit(button,next=>{next.bands[band][key]=defaults.bands[band][key];});listen(button,'dblclick',event=>{event.preventDefault();reset();});
      listen(button,'keydown',event=>{
        if(!['Escape','Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();if(event.key==='Escape'){cancel();return;}
        if(event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.getModifierState?.('AltGraph') || gesture)return;
        if(event.key==='Enter' || event.key===' '){if(!event.repeat)reset();return;}
        edit(button,next=>{const direction=['ArrowUp','ArrowRight','PageUp'].includes(event.key)?1:-1;next.bands[band][key]=event.key==='Home'?catalog[key][0]:event.key==='End'?catalog[key][1]:f(clamp(f(next.bands[band][key]+f(direction*steps[key]*(event.shiftKey ? .1 : 1)*(event.key.startsWith('Page')?10:1))),...catalog[key]));});
      });
    }
    const reset=documentRef.createElement('button');reset.type='button';reset.className='eq-band-reset';reset.textContent='↺';reset.title='Reset band';reset.setAttribute('aria-label',`Reset ${label} EQ band ${band+1}`);strip.append(reset);resets.push(reset);listen(reset,'click',()=>edit(reset,next=>{next.bands[band]=structuredClone(defaults.bands[band]);}));
  }
  listen(windowRef,'blur',()=>cancel());listen(windowRef,'resize',()=>cancel());listen(windowRef,'scroll',()=>cancel(),true);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  paint();return {sync,cancel:()=>cancel(),dispose(){cancel();disposed=true;paint();for(const remove of listeners)remove();}};
}
