export const CURVE_WINDOW_STORAGE_KEY='venturi.curves-window.layout.v1';
const finite=value=>typeof value==='number' && Number.isFinite(value);
export function curveWindowRect(value={},viewport={width:1280,height:720}){
  const vw=Math.max(1,Math.round(finite(viewport.width)?viewport.width:1280)),vh=Math.max(1,Math.round(finite(viewport.height)?viewport.height:720));
  const margin=Math.min(8,Math.floor(Math.min(vw,vh)/4)),maxWidth=Math.max(1,vw-2*margin),maxHeight=Math.max(1,vh-2*margin);
  const width=Math.max(Math.min(320,maxWidth),Math.min(maxWidth,Math.round(finite(value.width)?value.width:720)));
  const height=Math.max(Math.min(220,maxHeight),Math.min(maxHeight,Math.round(finite(value.height)?value.height:440)));
  const x=Math.max(margin,Math.min(vw-margin-width,Math.round(finite(value.x)?value.x:(vw-width)/2)));
  const y=Math.max(margin,Math.min(vh-margin-height,Math.round(finite(value.y)?value.y:(vh-height)/2)));
  return {x,y,width,height};
}

export function createCurveWindow({root=document.body,onChange=()=>{},notice=()=>{},storage,viewport=()=>({width:innerWidth,height:innerHeight})}={}){
  const documentRef=root.ownerDocument??document,windowRef=documentRef.defaultView??window;
  const element=documentRef.createElement('section'),header=documentRef.createElement('div'),title=documentRef.createElement('h2'),closeButton=documentRef.createElement('button'),status=documentRef.createElement('p'),content=documentRef.createElement('div'),grip=documentRef.createElement('button');
  element.className='curve-window';element.setAttribute('role','region');element.setAttribute('aria-label','Curves editor window');element.setAttribute('data-key-editor-window','true');element.hidden=true;element.style.position='fixed';
  header.className='curve-window-header';header.tabIndex=0;header.setAttribute('aria-label','Move Curves window');header.title='Drag to move. Arrow keys move; Shift moves 10 pixels. Home resets the window.';header.style.touchAction='none';
  title.className='curve-window-title';title.textContent='Curves';closeButton.className='curve-window-close';closeButton.type='button';closeButton.textContent='Close Curves';
  status.className='curve-window-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');content.className='curve-window-content';
  grip.className='curve-window-resize';grip.type='button';grip.textContent='↘';grip.setAttribute('aria-label','Resize Curves window');grip.title='Drag to resize. Arrow keys resize; Shift changes 10 pixels. Home resets the window.';grip.style.touchAction='none';
  header.append(title,closeButton);element.append(header,status,content,grip);root.append(element);
  let store=storage,opened=false,disposed=false,launcher=null,gesture=null,storageWarned=false;
  if(store===undefined){try{store=globalThis.localStorage;}catch{store=null;}}
  let saved=null;try{const raw=store?.getItem(CURVE_WINDOW_STORAGE_KEY);if(typeof raw==='string' && raw.length<=2048){const value=JSON.parse(raw);if(value?.version===1)saved=value;}}catch{}
  let rect=curveWindowRect(saved??{},viewport());
  const listeners=[],listen=(node,event,fn,options)=>{node.addEventListener(event,fn,options);listeners.push(()=>node.removeEventListener(event,fn,options));};
  const modal=()=>Boolean(documentRef.querySelector?.('dialog[open]'));
  const available=()=>!disposed && opened && element.isConnected!==false && !documentRef.hidden && !modal();
  const paint=()=>{rect=curveWindowRect(rect,viewport());element.style.left=`${rect.x}px`;element.style.top=`${rect.y}px`;element.style.width=`${rect.width}px`;element.style.height=`${rect.height}px`;};
  const persist=()=>{try{store?.setItem(CURVE_WINDOW_STORAGE_KEY,JSON.stringify({version:1,...rect}));}catch{if(!storageWarned){storageWarned=true;notice('Curves window layout could not be saved in this browser');}}};
  const release=owner=>{try{if(owner.node.hasPointerCapture?.(owner.id))owner.node.releasePointerCapture(owner.id);}catch{}};
  function cancel(){const old=gesture;if(!old)return;gesture=null;rect=old.before;paint();release(old);}
  function update(owner,event){
    if(![event.clientX,event.clientY].every(finite))return;
    const dx=event.clientX-owner.x,dy=event.clientY-owner.y;
    rect=curveWindowRect(owner.kind==='move'?{...owner.before,x:owner.before.x+dx,y:owner.before.y+dy}:{...owner.before,width:owner.before.width+dx,height:owner.before.height+dy},viewport());paint();
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
      cancel();const step=event.shiftKey?10:1;rect=event.key==='Home'?curveWindowRect({},viewport()):curveWindowRect(kind==='move'?{...rect,x:rect.x+direction[0]*step,y:rect.y+direction[1]*step}:{...rect,width:rect.width+direction[0]*step,height:rect.height+direction[1]*step},viewport());paint();persist();event.preventDefault();event.stopPropagation();
    });
  }
  bindPointer(header,'move');bindPointer(grip,'resize');
  listen(element,'keydown',event=>{if(gesture && event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}});
  listen(closeButton,'click',()=>close());listen(windowRef,'blur',cancel);
  listen(windowRef,'resize',()=>{if(disposed)return;cancel();paint();persist();});
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});listen(documentRef,'toggle',()=>{if(modal())cancel();},true);
  function close(){if(disposed || !opened)return;cancel();opened=false;element.hidden=true;const focus=launcher;launcher=null;onChange(false);if(!opened && !disposed && focus?.isConnected!==false && typeof focus?.focus==='function' && !modal())focus.focus({preventScroll:true});}
  paint();
  return {element,content,isOpen:()=>opened&&!disposed,open({focus=true}={}){if(disposed)return;const changed=!opened;if(changed){const active=documentRef.activeElement;launcher=element.contains?.(active)?null:active;opened=true;element.hidden=false;paint();onChange(true);}if(focus && opened && !disposed)header.focus({preventScroll:true});},close,setTitle(text){if(!disposed)title.textContent=String(text??'Curves').slice(0,256);},setStatus(text){if(!disposed)status.textContent=String(text??'').slice(0,2048);},dispose(){if(disposed)return;cancel();disposed=true;opened=false;launcher=null;for(const remove of listeners)remove();element.remove();}};
}
