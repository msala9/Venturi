const f=Math.fround,clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const parameters=['threshold_db','ratio','makeup_db','attack_ms','release_ms'];
const logarithmic=key=>['ratio','attack_ms','release_ms'].includes(key);
const steps={threshold_db:.2,ratio:.05,makeup_db:.1,attack_ms:.2,release_ms:2};
const names={threshold_db:'Threshold',ratio:'Ratio',makeup_db:'Makeup',attack_ms:'Attack',release_ms:'Release'};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function compressorPosition(value,range,log=false){
  const [min,max]=range.map(f);value=f(value);
  return f(clamp(log?f(f(Math.log(f(value/min)))/f(Math.log(f(max/min)))):f(f(value-min)/f(max-min)),0,1));
}
export function compressorValue(position,range,log=false){
  const [min,max]=range.map(f),t=f(clamp(position,0,1));
  return f(clamp(log?f(min*f(f(max/min)**t)):f(min+f(f(max-min)*t)),min,max));
}
export function compressorDelta(key,value,dx,dy,height,range,fine=false){
  const scale=f(fine ? .1 : 1);
  if(key==='threshold_db')return f(clamp(f(f(value)-f(f(f(f(dy)/f(height-14))*f(f(range[1])-f(range[0])))*scale)),...range));
  const moved=f(f(f(f(dx)-f(dy))/200)*scale);
  return moved===0?f(value):compressorValue(f(compressorPosition(value,range,logarithmic(key))+moved),range,logarithmic(key));
}
export function createCompressorControls({root,label,getParameters,defaults,catalog,canInteract,isCurrent=()=>true,isValid=()=>true,getContext=()=>null,onStart=()=>{},onDraft=()=>{},onCancel=()=>{},onCommit,notice=()=>{},windowRef=globalThis.window,documentRef=globalThis.document}){
  const host=documentRef.createElement('div');host.className='compressor-controls';root.append(host);
  const validRange=range=>Array.isArray(range) && range.length===2 && range.every(Number.isFinite) && range[0]<range[1];
  if(!parameters.every(key=>validRange(catalog[key]) && (!logarithmic(key) || catalog[key][0]>0)) || !Array.isArray(defaults?.bands) || defaults.bands.length!==3){
    host.textContent='Native dynamics metadata unavailable · use the precise fields';return {sync(){},cancel(){},dispose(){}};
  }
  let values=structuredClone(getParameters()),gesture=null,waiting=false,unknown=false,disposed=false;
  const controls=[],resets=[],listeners=[];
  const listen=(target,type,fn,options)=>{target?.addEventListener?.(type,fn,options);listeners.push(()=>target?.removeEventListener?.(type,fn,options));};
  const live=()=>!disposed && !waiting && !unknown && root.isConnected!==false && host.isConnected!==false && !documentRef?.hidden && isCurrent() && canInteract();
  const owned=button=>button.isConnected!==false && !button.disabled;
  const validValues=next=>Array.isArray(next?.bands) && next.bands.length===3 && next.bands.every(band=>parameters.every(key=>Number.isFinite(band[key]) && band[key]>=catalog[key][0] && band[key]<=catalog[key][1]));
  const rectKey=node=>{const rect=node.getBoundingClientRect();return JSON.stringify([rect.left,rect.top,rect.width,rect.height]);};
  function paint(){
    for(const {button,output,band,key} of controls){
      const value=values.bands[band][key],position=compressorPosition(value,catalog[key],logarithmic(key));
      button.disabled=!live() || button.isConnected===false;button.style?.setProperty('--compressor-position',`${position*100}%`);button.style?.setProperty('--compressor-fraction',String(position));button.style?.setProperty('--compressor-top',`${(1-position)*100}%`);button.style?.setProperty('--compressor-angle',`${f(f(f(position*2)-1)*135)}deg`);
      button.setAttribute('aria-valuenow',String(value));const text=`${value.toFixed(key==='release_ms'?0:1)}${key==='ratio'?':1':key.endsWith('_db')?' dB':' ms'}`;button.setAttribute('aria-valuetext',text);output.textContent=text;
    }
    for(const button of resets)button.disabled=!live() || button.isConnected===false;host.setAttribute('aria-busy',String(waiting));
  }
  function release(owner){try{if(owner.button.hasPointerCapture?.(owner.id))owner.button.releasePointerCapture(owner.id);}catch{}}
  function cancel(restore=true){if(!gesture)return;const owner=gesture;gesture=null;values=structuredClone(owner.before);release(owner);if(restore)onCancel();paint();}
  function sync(){cancel(false);if(!disposed){values=structuredClone(getParameters());paint();}}
  const current=owner=>live() && owned(owner.button) && owner.context===getContext() && same(owner.source,getParameters()) && owner.rect===rectKey(owner.button) && isValid();
  async function commit(next,before,context,button){
    if(same(next,before)){onCancel();sync();return;}
    if(!live() || !owned(button) || context!==getContext() || !same(before,getParameters()) || !isValid() || !validValues(next)){onCancel();sync();return;}
    waiting=true;values=structuredClone(next);paint();
    try{await onCommit(structuredClone(next));}
    catch(error){if(error.code==='OUTCOME_UNKNOWN')unknown=true;if(!disposed){onCancel();notice(error.message);}}
    finally{waiting=false;if(!disposed){values=structuredClone(getParameters());paint();}}
  }
  function move(event,releaseEvent=false){
    const owner=gesture;if(!owner || owner.id!==event.pointerId || event.currentTarget!==owner.button)return;
    if(!current(owner) || (!releaseEvent && event.buttons!==undefined && !(event.buttons&1))){cancel();return;}
    const dx=event.clientX-owner.x,dy=event.clientY-owner.y;owner.x=event.clientX;owner.y=event.clientY;
    if(!dx && !dy)return;
    values.bands[owner.band][owner.key]=compressorDelta(owner.key,values.bands[owner.band][owner.key],dx,dy,owner.height,catalog[owner.key],event.shiftKey);
    paint();onDraft(structuredClone(values));
  }
  for(let band=0;band<3;band++){
    const strip=documentRef.createElement('section');strip.className='compressor-band-controls';strip.dataset.compressorBand=String(band);host.append(strip);
    const heading=documentRef.createElement('strong');heading.textContent=['Low','Mid','High'][band];strip.append(heading);
    const reset=documentRef.createElement('button');reset.type='button';reset.textContent='Reset band';reset.setAttribute('aria-label',`Reset ${label} ${heading.textContent} band dynamics`);resets.push(reset);strip.append(reset);
    const panel=documentRef.createElement('div');panel.className='compressor-band-panel';strip.append(panel);
    for(const key of parameters){
      const cell=documentRef.createElement('div');cell.className=`compressor-cell${key==='threshold_db'?' compressor-threshold-cell':''}`;panel.append(cell);
      const name=documentRef.createElement('span');name.textContent=key==='threshold_db'?'Thr':names[key];cell.append(name);
      const button=documentRef.createElement('button');button.type='button';button.className=key==='threshold_db'?'compressor-threshold':'compressor-knob';button.dataset.compressorParam=key;button.dataset.compressorBand=String(band);
      const mark=documentRef.createElement('span');mark.className='compressor-control-mark';mark.setAttribute('aria-hidden','true');
      if(key==='threshold_db'){const rail=documentRef.createElement('span');rail.className='compressor-fader-rail';rail.setAttribute('aria-hidden','true');rail.append(mark);button.append(rail);}else button.append(mark);
      const output=documentRef.createElement('output');output.setAttribute('aria-hidden','true');cell.append(button,output);controls.push({button,output,band,key});
      button.setAttribute('role','slider');button.setAttribute('aria-label',`${label} ${heading.textContent} ${names[key].toLowerCase()}`);button.setAttribute('aria-valuemin',String(catalog[key][0]));button.setAttribute('aria-valuemax',String(catalog[key][1]));button.setAttribute('aria-orientation',key==='threshold_db'?'vertical':'horizontal');
      button.title='Drag up/right · Shift for precision · double-click or Enter resets';
      listen(button,'pointerdown',event=>{
        if(event.button!==0 || event.isPrimary===false || gesture || !live() || !owned(button) || !isValid() || !validValues(getParameters()))return;
        const rect=button.getBoundingClientRect();if(!(rect.width>0 && rect.height>14))return;
        event.preventDefault();button.focus();onStart();values=structuredClone(getParameters());
        gesture={button,id:event.pointerId,band,key,x:event.clientX,y:event.clientY,height:rect.height,before:structuredClone(values),source:structuredClone(getParameters()),context:getContext(),rect:rectKey(button)};
        try{button.setPointerCapture(event.pointerId);}catch{cancel();}
      });
      listen(button,'pointermove',move);
      listen(button,'pointerup',event=>{if(!gesture || gesture.button!==button || gesture.id!==event.pointerId || event.button!==0)return;move(event,true);if(!gesture)return;const owner=gesture;gesture=null;release(owner);void commit(values,owner.before,owner.context,button);});
      for(const type of ['pointercancel','lostpointercapture'])listen(button,type,event=>{if(gesture?.button===button && gesture.id===event.pointerId)cancel();});
      listen(button,'blur',()=>{if(gesture?.button===button)cancel();});
      const resetValue=()=>{if(!live() || !owned(button) || !isValid())return;cancel();onStart();const before=structuredClone(getParameters()),next=structuredClone(before);next.bands[band][key]=defaults.bands[band][key];onDraft(next);void commit(next,before,getContext(),button);};
      listen(button,'dblclick',event=>{event.preventDefault();resetValue();});
      listen(button,'keydown',event=>{
        if(!['Escape','Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();if(event.key==='Escape'){cancel();return;}
        if(event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.getModifierState?.('AltGraph') || !live() || !owned(button) || gesture || !isValid())return;
        if(event.key==='Enter' || event.key===' '){resetValue();return;}
        onStart();const before=structuredClone(getParameters()),next=structuredClone(before),direction=['ArrowUp','ArrowRight','PageUp'].includes(event.key)?1:-1;
        next.bands[band][key]=event.key==='Home'?catalog[key][0]:event.key==='End'?catalog[key][1]:f(clamp(f(before.bands[band][key]+f(direction*steps[key]*(event.shiftKey ? .1 : 1)*(event.key.startsWith('Page')?10:1))),...catalog[key]));
        onDraft(next);void commit(next,before,getContext(),button);
      });
    }
    listen(reset,'click',()=>{if(!live() || !owned(reset) || !isValid())return;cancel();onStart();const before=structuredClone(getParameters()),next=structuredClone(before);next.bands[band]=structuredClone(defaults.bands[band]);onDraft(next);void commit(next,before,getContext(),reset);});
  }
  listen(windowRef,'blur',()=>cancel());listen(windowRef,'resize',()=>cancel());listen(windowRef,'scroll',()=>cancel(),true);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  paint();return {sync,cancel:()=>cancel(),dispose(){cancel();disposed=true;for(const remove of listeners)remove();}};
}
