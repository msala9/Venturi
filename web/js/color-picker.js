const axes=['r','g','b','a'],f=Math.fround,clamp=value=>Math.max(0,Math.min(1,value));
const latentColors=new Map(),colorKey=color=>axes.map(axis=>f(color[axis])).join(',');
export function linearToGamma(value){const x=f(value);return x<=f(.0031308)?f(f(12.92)*x):f(f(f(1.055)*f(Math.pow(x,f(1/f(2.4)))))-f(.055));}
export function gammaToLinear(value){const x=f(value);return x<=f(.04045)?f(x/f(12.92)):f(Math.pow(f(f(x+f(.055))/f(1.055)),f(2.4)));}
export function colorToPicker(color){
  const r=f(color.r),g=f(color.g),b=f(color.b),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=f(max-min);
  let h=0;if(delta){h=max===r?f(f(g-b)/delta):max===g?f(f(f(b-r)/delta)+2):f(f(f(r-g)/delta)+4);h=f(h/6);if(h<0)h=f(h+1);}
  return {h,s:max?f(delta/max):0,v:linearToGamma(max)};
}
export function pickerToColor({h,s,v},alpha){
  const value=gammaToLinear(clamp(v)),sat=f(clamp(s)),hue=f((clamp(h)%1)*6),sector=Math.floor(hue),fraction=f(hue-sector),p=f(value*f(1-sat)),q=f(value*f(1-f(sat*fraction))),t=f(value*f(1-f(sat*f(1-fraction))));
  const rgb=[[value,t,p],[q,value,p],[p,value,t],[p,q,value],[t,p,value],[value,p,q]][sector%6];
  return {r:rgb[0],g:rgb[1],b:rgb[2],a:alpha};
}
const byte=value=>Math.max(0,Math.min(255,Math.floor(value+.5)));
const linearByte=value=>value<=0?0:value<=f(.0031308)?byte(f(f(3294.6)*f(value))):value<=1?byte(f(f(f(269.025)*f(Math.pow(f(value),f(1/f(2.4)))))-f(14.025))):255;
export function colorToHex(color){return '#'+[linearByte(color.r),linearByte(color.g),linearByte(color.b),byte(f(f(color.a)*255))].map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();}
export function hexToColor(text,alpha=1){
  const value=String(text).trim();if(!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))throw Error('Use #RRGGBB or #RRGGBBAA');
  const parts=value.slice(1).match(/../g).map(part=>parseInt(part,16));
  const decode=value=>value<=10?f(value/f(3294.6)):f(Math.pow(f(f(value+f(14.025))/f(269.025)),f(2.4)));
  return {r:decode(parts[0]),g:decode(parts[1]),b:decode(parts[2]),a:parts.length===4?f(parts[3]/255):alpha};
}
export function colorEdit(original,next){
  if(!axes.every(axis=>Number.isFinite(next[axis]) && next[axis]>=0 && next[axis]<=1))throw Error('Linear RGBA values must be between 0 and 1');
  const result=Object.fromEntries(axes.map(axis=>[axis,f(original[axis])===f(next[axis])?original[axis]:f(next[axis])]));
  if(axes.every(axis=>result[axis]===original[axis]))return null;
  return result.a===0?{r:0,g:0,b:0,a:0}:result;
}
function remember(color,picker,rgb){const key=colorKey(color);latentColors.delete(key);latentColors.set(key,{picker:{...picker},rgb:{r:rgb.r,g:rgb.g,b:rgb.b}});if(latentColors.size>32)latentColors.delete(latentColors.keys().next().value);}

export function renderColorPicker(root,{label,value,controls,apply,openState}){
  const doc=root.ownerDocument ?? globalThis.document,win=doc.defaultView ?? globalThis.window,original={...value};
  let draft={...original},picker={...colorToPicker(original),...(latentColors.get(colorKey(original))?.picker ?? {})},latent=latentColors.get(colorKey(original))?.rgb ?? {r:original.r,g:original.g,b:original.b};
  let opened=false,disposed=false,waiting=false,gesture=null,popover=false,paintFrame=null,paintedHue=null,huePainted=false;
  const listeners=[],listen=(node,type,handler,options)=>{node?.addEventListener?.(type,handler,options);listeners.push(()=>node?.removeEventListener?.(type,handler,options));};
  const node=(tag,className)=>{const element=doc.createElement(tag);if(className)element.className=className;return element;};
  const visible=()=>!root.closest?.('details:not([open]),[hidden],[inert]');
  const current=()=>!disposed && root.isConnected!==false && !doc.hidden && visible() && controls.current() && !doc.querySelector?.('dialog[open]');
  const available=()=>!waiting && current() && controls.available();
  const register=(element,enabled=available)=>controls.register(element,enabled);
  const section=node('div','color-picker'),swatch=register(node('button','color-picker-swatch')),chip=node('span','color-picker-chip'),name=node('span');
  swatch.type='button';swatch.setAttribute('aria-label',`Choose ${label}`);swatch.setAttribute('aria-haspopup','dialog');swatch.setAttribute('aria-expanded','false');name.textContent=label;swatch.append(chip,name);section.append(swatch);root.append(section);
  const popup=node('div','color-picker-popup');popup.setAttribute('popover','manual');popup.setAttribute('role','dialog');popup.setAttribute('aria-label',`${label} color editor`);popup.hidden=true;section.append(popup);
  const heading=node('strong');heading.textContent=label;popup.append(heading);
  const square=register(node('div','color-picker-square'),()=>opened && available()),squareCanvas=node('canvas','color-picker-colors'),dot=node('span','color-picker-dot');square.tabIndex=0;square.setAttribute('role','group');square.setAttribute('aria-label',`${label} saturation and value`);squareCanvas.setAttribute('aria-hidden','true');square.append(squareCanvas,dot);popup.append(square);
  function slider(kind,title){const row=node('label','color-picker-slider-row'),element=register(node('div',`color-picker-slider color-picker-${kind}`),()=>opened && available()),canvas=kind==='hue'?node('canvas','color-picker-colors'):null,thumb=node('span','color-picker-thumb');row.textContent=title;element.tabIndex=0;element.setAttribute('role','slider');element.setAttribute('aria-label',`${label} ${title.toLowerCase()}`);element.setAttribute('aria-valuemin','0');element.setAttribute('aria-valuemax',kind==='hue'?'360':'100');if(canvas){canvas.setAttribute('aria-hidden','true');element.append(canvas);}element.append(thumb);row.append(element);popup.append(row);return {element,thumb,canvas};}
  const hue=slider('hue','Hue'),alpha=slider('alpha','Alpha'),status=node('p','color-picker-status');status.setAttribute('role','status');status.textContent='Local preview · release to apply. Arrow keys adjust; Shift is fine control.';popup.append(status);
  const hexForm=node('form','color-picker-hex'),hexLabel=node('label','field'),hex=register(node('input'));
  hex.type='text';hex.spellcheck=false;hex.maxLength=9;hex.setAttribute('aria-label',`${label} sRGB hex`);hexLabel.textContent='sRGB hex';hexLabel.append(hex);const hexApply=register(node('button'));hexApply.textContent='Apply hex';hexApply.setAttribute('aria-label',`Apply ${label} hex`);hexForm.append(hexLabel,hexApply);popup.append(hexForm);
  const precision=node('details','color-picker-precision'),summary=node('summary');summary.textContent='Native linear RGBA precision';precision.open=openState?.get?.(`color-linear:${label}`) ?? false;precision.append(summary);popup.append(precision);
  const form=node('form','color-picker-linear'),fields={};
  for(const axis of axes){const field=node('label','field'),input=register(node('input'));field.textContent=`${label} ${axis.toUpperCase()}`;input.type='number';input.min=0;input.max=1;input.step='any';input.required=true;input.value=String(value[axis]);input.setAttribute('aria-label',field.textContent);field.append(input);form.append(field);fields[axis]=input;}
  const confirm=register(node('button'));confirm.textContent=`Apply ${label}`;confirm.setAttribute('aria-label',confirm.textContent);form.append(confirm);precision.append(form);
  const close=register(node('button'),()=>current());close.type='button';close.textContent='Cancel';close.setAttribute('aria-label',`Cancel ${label} color`);popup.append(close);
  const css=color=>`rgba(${linearByte(color.r)},${linearByte(color.g)},${linearByte(color.b)},${clamp(color.a)})`;
  const property=(element,key,value)=>element.style?.setProperty?.(key,value);
  function paintColors(){
    paintFrame=null;if(disposed || !opened || !current())return;
    const draw=(canvas,width,height,colorAt)=>{const context=canvas.getContext?.('2d');if(!context?.createImageData || !context.putImageData)return;canvas.width=width;canvas.height=height;const image=context.createImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=colorAt(x,y),offset=(y*width+x)*4;image.data[offset]=linearByte(color.r);image.data[offset+1]=linearByte(color.g);image.data[offset+2]=linearByte(color.b);image.data[offset+3]=255;}context.putImageData(image,0,0);};
    if(paintedHue!==picker.h){draw(squareCanvas,128,128,(x,y)=>pickerToColor({h:picker.h,s:x/127,v:1-y/127},1));paintedHue=picker.h;}
    if(!huePainted){draw(hue.canvas,256,1,x=>pickerToColor({h:x/255,s:1,v:1},1));huePainted=true;}
  }
  function requestColors(){if(!opened || paintFrame!==null)return;if(win?.requestAnimationFrame)paintFrame=win.requestAnimationFrame(paintColors);else paintColors();}
  function paint(writeFields=true){
    property(chip,'--color',css(opened?draft:original));property(dot,'left',`${picker.s*100}%`);property(dot,'top',`${(1-picker.v)*100}%`);
    property(hue.thumb,'left',`${picker.h*100}%`);property(alpha.thumb,'left',`${draft.a*100}%`);property(alpha.element,'--color',css({...draft,...(draft.a===0?latent:{}),a:1}));
    square.setAttribute('aria-description',`Saturation ${Math.round(picker.s*100)}%, perceptual value ${Math.round(picker.v*100)}%. Left/right changes saturation; up/down changes value.`);
    hue.element.setAttribute('aria-valuenow',String(picker.h*360));alpha.element.setAttribute('aria-valuenow',String(draft.a*100));hex.value=colorToHex(draft);
    if(writeFields)for(const axis of axes)fields[axis].value=String(draft[axis]);controls.sync();requestColors();
  }
  function release(){const previous=gesture;gesture=null;if(previous)try{if(previous.element.hasPointerCapture?.(previous.id))previous.element.releasePointerCapture(previous.id);}catch{}}
  function reset(){draft={...original};const cached=latentColors.get(colorKey(original));picker=cached?{...cached.picker}:colorToPicker(original);latent=cached?.rgb ?? {r:original.r,g:original.g,b:original.b};paint();}
  function cancel({focus=false}={}){release();opened=false;if(paintFrame!==null){win?.cancelAnimationFrame?.(paintFrame);paintFrame=null;}swatch.setAttribute('aria-expanded','false');if(popover){try{popup.hidePopover?.();}catch{}}popup.hidden=true;popover=false;reset();if(focus && current())swatch.focus?.();}
  function position(){const rect=swatch.getBoundingClientRect?.();if(!rect)return;const width=Math.min(284,Math.max(180,(win?.innerWidth ?? 1024)-16)),height=Math.min(480,(win?.innerHeight ?? 768)-16);property(popup,'width',`${width}px`);property(popup,'max-height',`${height}px`);property(popup,'left',`${Math.max(8,Math.min(rect.left,(win?.innerWidth ?? 1024)-width-8))}px`);property(popup,'top',`${Math.max(8,Math.min(rect.bottom+4,(win?.innerHeight ?? 768)-height-8))}px`);}
  function open(){if(!available())return;if(opened){cancel({focus:true});return;}reset();opened=true;popup.hidden=false;position();try{if(popup.showPopover){popup.setAttribute('popover','manual');popup.showPopover();popover=true;}}catch{popup.removeAttribute?.('popover');}swatch.setAttribute('aria-expanded','true');paint();square.focus?.();}
  async function commit(kind){
    if(!available())return;let next;try{next=colorEdit(original,draft);}catch(error){status.textContent=error.message;return;}if(!next)return;
    const selectedPicker={...picker},selectedRgb=draft.a===0?{...latent}:{...draft};waiting=true;cancel();status.textContent='Submitting color · waiting for native properties';controls.sync();
    try{await Promise.resolve();if(current() && controls.available()){const receipt=await apply(next);if(kind==='visual' && receipt!==undefined && receipt!==false)remember(next,selectedPicker,selectedRgb);}}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{waiting=false;if(!disposed){reset();controls.sync();}}
  }
  function readFields(){const next={};for(const axis of axes){const text=String(fields[axis].value).trim(),value=Number(text);if(!text || !Number.isFinite(value) || value<0 || value>1)throw Error('Linear RGBA values must be between 0 and 1');next[axis]=value;}return next;}
  function fromFields(){if(!available())return;try{draft=readFields();picker=colorToPicker(draft);if(draft.r || draft.g || draft.b)latent={r:draft.r,g:draft.g,b:draft.b};paint(false);status.textContent='Local linear RGBA draft · Apply to confirm';}catch(error){status.textContent=error.message;}}
  const rectKey=rect=>[rect.left,rect.top,rect.width,rect.height].join(',');
  function gestureCurrent(){if(!gesture)return false;const valid=available() && opened && rectKey(gesture.element.getBoundingClientRect())===gesture.rectKey;if(!valid)cancel();return valid;}
  function point(kind,event,rect){
    const x=f(clamp((event.clientX-rect.left)/rect.width)),y=f(clamp((rect.top+rect.height-event.clientY)/rect.height));
    if(kind==='alpha'){if(draft.a===0 && (latent.r || latent.g || latent.b))draft={...draft,...latent};draft.a=x;}
    else{picker=kind==='square'?{...picker,s:x,v:y}:{...picker,h:x};draft=pickerToColor(picker,draft.a);latent={r:draft.r,g:draft.g,b:draft.b};}paint();
  }
  function bind(element,kind){
    listen(element,'pointerdown',event=>{if(event.button!==0 || event.isPrimary===false || !available() || !opened || gesture)return;const rect=element.getBoundingClientRect?.();if(!rect || ![rect.width,rect.height].every(value=>Number.isFinite(value) && value>0))return;try{readFields();}catch(error){status.textContent=error.message;return;}event.preventDefault();event.stopPropagation();element.focus?.();gesture={element,kind,id:event.pointerId,rect,rectKey:rectKey(rect)};try{element.setPointerCapture?.(event.pointerId);}catch{release();return;}point(kind,event,rect);});
    listen(element,'pointermove',event=>{if(!gesture || gesture.id!==event.pointerId || gesture.element!==element)return;if(!gestureCurrent())return;if(event.buttons!==undefined && !(event.buttons&1)){cancel();return;}point(kind,event,gesture.rect);});
    listen(element,'pointerup',event=>{if(!gesture || gesture.id!==event.pointerId || gesture.element!==element || event.button!==0)return;if(!gestureCurrent())return;point(kind,event,gesture.rect);release();void commit('visual');});
    for(const type of ['pointercancel','lostpointercapture'])listen(element,type,event=>{if(gesture?.id===event.pointerId && gesture.element===element)cancel();});
    listen(element,'keydown',event=>{const delta={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[event.key];if(!delta || !opened || !available())return;event.preventDefault();event.stopPropagation();const step=event.shiftKey ? .001 : .01;if(kind==='alpha'){if(!draft.a)draft={...draft,...latent};draft.a=f(clamp(draft.a+delta*step));}else{const axis=kind==='hue'?'h':['ArrowLeft','ArrowRight'].includes(event.key)?'s':'v';picker={...picker,[axis]:f(clamp(picker[axis]+delta*step))};draft=pickerToColor(picker,draft.a);latent={r:draft.r,g:draft.g,b:draft.b};}paint();void commit('visual');});
  }
  bind(square,'square');bind(hue.element,'hue');bind(alpha.element,'alpha');
  listen(swatch,'click',open);listen(swatch,'keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
  listen(close,'click',()=>cancel({focus:true}));listen(popup,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancel({focus:true});}});
  listen(form,'submit',event=>{event.preventDefault();if(!available())return;try{draft=readFields();if(form.reportValidity?.()===false)return;void commit('numeric');}catch(error){status.textContent=error.message;}});
  for(const axis of axes)listen(fields[axis],'input',fromFields);
  listen(hexForm,'submit',event=>{event.preventDefault();if(!available())return;try{readFields();if(String(hex.value).trim().toUpperCase()!==colorToHex(draft)){draft=hexToColor(hex.value,draft.a);picker=colorToPicker(draft);}void commit('hex');}catch(error){status.textContent=error.message;}});
  listen(precision,'toggle',()=>openState?.set?.(`color-linear:${label}`,precision.open));
  listen(doc,'pointerdown',event=>{if(opened && event.target!==swatch && section.contains?.(event.target)===false)cancel();},true);
  listen(doc,'focusin',event=>{if(opened && section.contains?.(event.target)===false)cancel();});
  listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel();});listen(win,'blur',()=>cancel());listen(win,'resize',()=>cancel());listen(win,'scroll',event=>{if(opened && popup.contains?.(event.target)!==true)cancel();},true);
  const visibilityChanged=()=>{if(opened && !current())cancel();else controls.sync();};
  const observer=typeof MutationObserver==='function'?new MutationObserver(visibilityChanged):null;
  for(let ancestor=root;ancestor;ancestor=ancestor.parentElement){observer?.observe(ancestor,{attributes:true,attributeFilter:['hidden','inert','open']});if(ancestor.tagName?.toLowerCase()==='details')listen(ancestor,'toggle',visibilityChanged);}
  paint();return {cancel,dispose(){if(disposed)return;cancel();disposed=true;observer?.disconnect();for(const remove of listeners)remove();}};
}
