export const CURVE_WINDOW_STORAGE_KEY='venturi.curves-window.layout.v1';
const finite=value=>typeof value==='number' && Number.isFinite(value);
export function curveWindowRect(value={},viewport={width:1280,height:720}){
  const vw=Math.max(1,Math.round(finite(viewport.width)?viewport.width:1280)),vh=Math.max(1,Math.round(finite(viewport.height)?viewport.height:720));
  const topInset=Math.max(0,Math.min(vh-1,Math.ceil(finite(viewport.topInset)?viewport.topInset:0))),availableHeight=vh-topInset;
  const margin=Math.min(8,Math.floor(Math.min(vw,availableHeight)/4)),maxWidth=Math.max(1,vw-2*margin),maxHeight=Math.max(1,availableHeight-2*margin);
  const width=Math.max(Math.min(320,maxWidth),Math.min(maxWidth,Math.round(finite(value.width)?value.width:720)));
  const height=Math.max(Math.min(220,maxHeight),Math.min(maxHeight,Math.round(finite(value.height)?value.height:440)));
  const x=Math.max(margin,Math.min(vw-margin-width,Math.round(finite(value.x)?value.x:(vw-width)/2)));
  const y=Math.max(topInset+margin,Math.min(vh-margin-height,Math.round(finite(value.y)?value.y:topInset+(availableHeight-height)/2)));
  return {x,y,width,height};
}

export function createCurveWindow(options={}){
  return createWindow({...options,name:'Curves',ariaLabel:'Curves editor window',closeLabel:'Close Curves',storageKey:CURVE_WINDOW_STORAGE_KEY,defaultRect:{width:720,height:440},keyEditor:true});
}

export function createToolWindow({name='Tool',ariaLabel,closeLabel,moveLabel,resizeLabel,storageKey,defaultRect,...options}={}){
  if(typeof name!=='string' || !name.trim() || name.length>64 || /[\u0000-\u001f\u007f]/.test(name))throw TypeError('Choose a tool window name');
  name=name.trim();
  const id=name.toLowerCase(),key=storageKey??`venturi.${id}-window.layout.v1`;
  if(typeof key!=='string' || !key.trim() || key.length>256 || key===CURVE_WINDOW_STORAGE_KEY)throw TypeError('Tool windows need independent layout storage');
  const defaults=id==='mixer'?{width:420,height:360}:id==='color'?{width:760,height:640}:{width:720,height:440};
  return createWindow({...options,name,ariaLabel:ariaLabel??`${name} window`,closeLabel:closeLabel??`Close ${name}`,moveLabel,resizeLabel,storageKey:key,defaultRect:{...defaults,...defaultRect},keyEditor:false});
}

function createWindow({root=document.body,onChange=()=>{},onLayout=()=>{},notice=()=>{},storage,viewport=()=>({width:innerWidth,height:innerHeight}),name,ariaLabel,closeLabel,moveLabel,resizeLabel,storageKey,defaultRect,keyEditor}){
  const documentRef=root.ownerDocument??document,windowRef=documentRef.defaultView??window;
  const element=documentRef.createElement('section'),header=documentRef.createElement('div'),title=documentRef.createElement('h2'),closeButton=documentRef.createElement('button'),status=documentRef.createElement('p'),content=documentRef.createElement('div'),grip=documentRef.createElement('button');
  const prefix=keyEditor?'curve-window':'native-tool-window';
  element.className=prefix;element.setAttribute('role','region');element.setAttribute('aria-label',ariaLabel);if(keyEditor)element.setAttribute('data-key-editor-window','true');else{element.setAttribute('data-tool-window',name.toLowerCase());element.setAttribute('data-command-owner','timeline');}element.hidden=true;element.style.position='fixed';
  header.className=`${prefix}-header`;header.tabIndex=0;header.setAttribute('aria-label',moveLabel??`Move ${name} window`);header.title='Drag to move. Arrow keys move; Shift moves 10 pixels. Home resets the window.';header.style.touchAction='none';
  title.className=`${prefix}-title`;title.textContent=name;closeButton.className=`${prefix}-close`;closeButton.type='button';closeButton.textContent=closeLabel;
  status.className=`${prefix}-status`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');content.className=`${prefix}-content`;
  grip.className=`${prefix}-resize`;grip.type='button';grip.textContent='↘';grip.setAttribute('aria-label',resizeLabel??`Resize ${name} window`);grip.title='Drag to resize. Arrow keys resize; Shift changes 10 pixels. Home resets the window.';grip.style.touchAction='none';
  header.append(title,closeButton);element.append(header,status,content,grip);root.append(element);
  let store=storage,opened=false,disposed=false,launcher=null,gesture=null,storageWarned=false;
  if(store===undefined){try{store=globalThis.localStorage;}catch{store=null;}}
  let saved=null;try{const raw=store?.getItem(storageKey);if(typeof raw==='string' && raw.length<=2048){const value=JSON.parse(raw);if(value?.version===1)saved=value;}}catch{}
  const defaults={...defaultRect},layout=(value={})=>curveWindowRect({...defaults,...Object.fromEntries(Object.entries(value??{}).filter(([key,value])=>['x','y','width','height'].includes(key) && finite(value)))},viewport());
  let rect=layout(saved??{});
  const listeners=[],listen=(node,event,fn,options)=>{node.addEventListener(event,fn,options);listeners.push(()=>node.removeEventListener(event,fn,options));};
  const modal=()=>Boolean(documentRef.querySelector?.('dialog[open]'));
  const available=()=>!disposed && opened && element.isConnected!==false && !documentRef.hidden && !modal();
  const paint=()=>{rect=layout(rect);element.style.left=`${rect.x}px`;element.style.top=`${rect.y}px`;element.style.width=`${rect.width}px`;element.style.height=`${rect.height}px`;onLayout({...rect});};
  const persist=()=>{try{store?.setItem(storageKey,JSON.stringify({version:1,...rect}));}catch{if(!storageWarned){storageWarned=true;notice(`${name} window layout could not be saved in this browser`);}}};
  const release=owner=>{try{if(owner.node.hasPointerCapture?.(owner.id))owner.node.releasePointerCapture(owner.id);}catch{}};
  function cancel(){const old=gesture;if(!old)return;gesture=null;rect=old.before;paint();release(old);}
  function update(owner,event){
    if(![event.clientX,event.clientY].every(finite))return;
    const dx=event.clientX-owner.x,dy=event.clientY-owner.y;
    rect=layout(owner.kind==='move'?{...owner.before,x:owner.before.x+dx,y:owner.before.y+dy}:{...owner.before,width:owner.before.width+dx,height:owner.before.height+dy});paint();
  }
  function bindPointer(node,kind){
    listen(node,'pointerdown',event=>{
      if(!available() || gesture || event.defaultPrevented || event.button!==0 || event.isPrimary===false || node===header && (event.target===closeButton || closeButton.contains?.(event.target)) || ![event.clientX,event.clientY].every(finite))return;
      node.focus({preventScroll:true});gesture={node,kind,id:event.pointerId,x:event.clientX,y:event.clientY,before:{...rect},viewport:JSON.stringify(viewport())};
      try{node.setPointerCapture(event.pointerId);}catch{gesture=null;return;}event.preventDefault();event.stopPropagation();
    });
    listen(node,'pointermove',event=>{const owner=gesture;if(!owner || owner.node!==node || owner.id!==event.pointerId)return;if(!available() || owner.viewport!==JSON.stringify(viewport())){cancel();return;}update(owner,event);event.preventDefault();event.stopPropagation();});
    listen(node,'pointerup',event=>{const owner=gesture;if(!owner || owner.node!==node || owner.id!==event.pointerId || event.button!==0)return;if(!available() || owner.viewport!==JSON.stringify(viewport())){cancel();return;}update(owner,event);gesture=null;release(owner);persist();event.preventDefault();event.stopPropagation();});
    const abort=event=>{if(gesture?.node===node && gesture.id===event.pointerId)cancel();};listen(node,'pointercancel',abort);listen(node,'lostpointercapture',abort);
    listen(node,'keydown',event=>{
      if(event.target!==node || !available() || event.defaultPrevented || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.getModifierState?.('AltGraph'))return;
      const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},direction=directions[event.key];if(!direction && event.key!=='Home')return;
      cancel();const step=event.shiftKey?10:1;rect=event.key==='Home'?layout():layout(kind==='move'?{...rect,x:rect.x+direction[0]*step,y:rect.y+direction[1]*step}:{...rect,width:rect.width+direction[0]*step,height:rect.height+direction[1]*step});paint();persist();event.preventDefault();event.stopPropagation();
    });
  }
  bindPointer(header,'move');bindPointer(grip,'resize');
  listen(element,'keydown',event=>{if(gesture && event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}});
  listen(closeButton,'click',()=>close());listen(windowRef,'blur',cancel);
  listen(windowRef,'resize',()=>{if(disposed)return;cancel();paint();persist();});
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});listen(documentRef,'toggle',()=>{if(modal())cancel();},true);
  function close(){if(disposed || !opened)return;const ownedFocus=keyEditor || element.contains?.(documentRef.activeElement);cancel();opened=false;element.hidden=true;const focus=launcher;launcher=null;onChange(false);const hiddenLauncher=!keyEditor && focus?.closest?.('[data-tool-window],[data-key-editor-window]')?.hidden;if(ownedFocus && !hiddenLauncher && !opened && !disposed && focus?.isConnected!==false && typeof focus?.focus==='function' && !modal())focus.focus({preventScroll:true});}
  paint();
  return {element,content,isOpen:()=>opened&&!disposed,open({focus=true}={}){if(disposed)return;const changed=!opened;if(changed){const active=documentRef.activeElement;launcher=element.contains?.(active)?null:active;opened=true;element.hidden=false;paint();onChange(true);}if(focus && opened && !disposed)header.focus({preventScroll:true});},close,setTitle(text){if(!disposed)title.textContent=String(text??name).slice(0,256);},setStatus(text){if(!disposed)status.textContent=String(text??'').slice(0,2048);},dispose(){if(disposed)return;cancel();disposed=true;opened=false;launcher=null;for(const remove of listeners)remove();element.remove();}};
}
