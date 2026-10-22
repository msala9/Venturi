import {isTextTarget} from './ui.js';

// Native viewer_zoom.rs geometry; scale refers to received preview pixels per screen pixel.
export const VIEWER_ZOOM_PRESETS=[0.0625,0.125,0.25,0.5,0.75,1,2,3];
const MIN_SCALE=0.02,MAX_SCALE=32,MIN_VISIBLE=32;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const fresh=()=>({scale:null,pan:[0,0]});
export function isViewerFullscreenShortcut(event,{dialogOpen=false}={}){
  return !dialogOpen && !event.defaultPrevented && !event.repeat && !event.isComposing && event.keyCode!==229 && !event.getModifierState?.('AltGraph') && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key?.toLowerCase()==='f' && !isTextTarget(event.target);
}
const valid=(area,frame,dpr)=>area && [area.left,area.top,area.width,area.height,...frame,dpr].every(Number.isFinite) && area.width>0 && area.height>0 && frame.every(value=>value>0) && dpr>0;
export function viewerZoomPercent(scale){
  const percent=scale*100;
  return `${percent>=100?percent.toFixed(0):Number(percent.toFixed(2))}%`;
}
export function viewerZoomRect(state,area,frame,dpr=1){
  if(!valid(area,frame,dpr))return null;
  const scale=state.scale===null?Math.min(area.width/frame[0],area.height/frame[1])*dpr:clamp(state.scale,MIN_SCALE,MAX_SCALE);
  const width=frame[0]*scale/dpr,height=frame[1]*scale/dpr;
  const limits=[Math.max(0,(width+area.width)/2-MIN_VISIBLE),Math.max(0,(height+area.height)/2-MIN_VISIBLE)];
  const pan=state.pan.map((value,index)=>clamp(value,-limits[index],limits[index]));
  return {left:area.left+(area.width-width)/2+pan[0],top:area.top+(area.height-height)/2+pan[1],width,height,scale,pan};
}
export function viewerZoomScale(state,scale,area,frame,dpr=1){
  const before=viewerZoomRect(state,area,frame,dpr);
  if(!before || !Number.isFinite(scale))return state;
  const next=clamp(scale,MIN_SCALE,MAX_SCALE);
  const geometry=viewerZoomRect({scale:next,pan:before.pan.map(value=>value*next/before.scale)},area,frame,dpr);
  return {scale:next,pan:geometry.pan};
}
export function viewerZoomAround(state,pointer,factor,area,frame,dpr=1){
  const before=viewerZoomRect(state,area,frame,dpr);
  if(!before || !pointer.every(Number.isFinite) || !Number.isFinite(factor) || factor<=0)return state;
  const scale=clamp(before.scale*factor,MIN_SCALE,MAX_SCALE),ratio=scale/before.scale;
  const center=[before.left+before.width/2,before.top+before.height/2],areaCenter=[area.left+area.width/2,area.top+area.height/2];
  const pan=pointer.map((value,index)=>value+(center[index]-value)*ratio-areaCenter[index]);
  return {scale,pan:viewerZoomRect({scale,pan},area,frame,dpr).pan};
}
export function viewerZoomPan(state,delta,area,frame,dpr=1){
  const before=viewerZoomRect(state,area,frame,dpr);
  if(!before || !delta.every(Number.isFinite))return state;
  const next={scale:before.scale,pan:before.pan.map((value,index)=>value+delta[index])};
  return {scale:next.scale,pan:viewerZoomRect(next,area,frame,dpr).pan};
}

export function createViewerZoom({screen,media,getActive,getContext=()=>null,onChange=()=>{},select,status}){
  const documentRef=screen.ownerDocument,windowRef=documentRef.defaultView,listeners=[],groups=new Map(),originals=[];
  let state=fresh(),binding=null,pan=null,disposed=false;
  const listen=(target,type,callback,options)=>{target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));};
  for(const element of media){
    const parent=element.parentNode;
    let viewport=groups.get(parent);
    if(!viewport){
      viewport=documentRef.createElement('div');viewport.className='viewer-zoom-viewport';
      if(parent===screen)viewport.dataset.viewerZoomLayer='frame';
      parent.insertBefore(viewport,element);groups.set(parent,viewport);
    }
    originals.push({element,parent,viewport,style:element.style.cssText});viewport.append(element);
  }
  if(select){
    const option=(value,label)=>{const node=documentRef.createElement('option');node.value=value;node.textContent=label;return node;};
    select.replaceChildren(option('fit','Fit'),...VIEWER_ZOOM_PRESETS.map(scale=>option(String(scale),`${viewerZoomPercent(scale)}${scale===1?' · preview pixels':''}`)),option('custom','Custom zoom'));
  }
  const dpr=()=>windowRef.devicePixelRatio || 1;
  function context(){try{return JSON.stringify(getContext());}catch{return null;}}
  function target(){
    const element=getActive(),entry=originals.find(item=>item.element===element);
    if(!entry || element.hidden || documentRef.hidden || documentRef.querySelector?.('dialog[open]'))return null;
    const frame=[element.videoWidth || element.naturalWidth || 0,element.videoHeight || element.naturalHeight || 0];
    const area=entry.viewport.getBoundingClientRect();
    if(!valid(area,frame,dpr()))return null;
    return {...entry,area,frame,context:context()};
  }
  const stamp=next=>next?JSON.stringify([next.context,next.element.getAttribute('src'),next.area.left,next.area.top,next.area.width,next.area.height,...next.frame,dpr()]):null;
  function cancelPan(){
    const owner=pan;pan=null;
    if(owner)try{if(screen.hasPointerCapture(owner.id))screen.releasePointerCapture(owner.id);}catch{}
  }
  function paint(next){
    const geometry=next && viewerZoomRect(state,next.area,next.frame,dpr());
    if(select){
      select.disabled=!geometry;
      select.value=state.scale===null?'fit':VIEWER_ZOOM_PRESETS.includes(state.scale)?String(state.scale):'custom';
      const custom=select.querySelector?.('option[value="custom"]');if(custom)custom.textContent=`${geometry?viewerZoomPercent(geometry.scale):'Custom'} · custom`;
    }
    if(status)status.textContent=geometry?`${state.scale===null?'Fit':viewerZoomPercent(geometry.scale)} · ${next.frame[0]} × ${next.frame[1]} received preview pixels · 100% = one preview pixel per display pixel`:'Zoom applies to a received Source or Program preview';
    if(!geometry)return null;
    state={scale:state.scale,pan:geometry.pan};
    Object.assign(next.element.style,{left:`${geometry.left-next.area.left}px`,top:`${geometry.top-next.area.top}px`,width:`${geometry.width}px`,height:`${geometry.height}px`});
    return geometry;
  }
  function refresh(){
    if(disposed)return null;
    const next=target(),identity=stamp(next),changed=next?.element!==binding?.element || identity!==binding?.stamp;
    if(changed){cancelPan();onChange({reason:'viewport'});}
    binding=next?{...next,stamp:identity}:null;
    return paint(next);
  }
  function change(next,reason){
    if(disposed)return false;
    const current=target();if(!current)return false;
    state=next;onChange({reason});binding={...current,stamp:stamp(current)};paint(current);return true;
  }
  function fit(){cancelPan();state=fresh();if(!disposed){onChange({reason:'fit'});refresh();}}
  function setScale(scale){
    cancelPan();const current=target();
    if(!current)return false;
    return change(viewerZoomScale(state,scale,current.area,current.frame,dpr()),'zoom');
  }
  listen(select ?? screen,'change',()=>{
    if(!select)return;
    if(select.value==='fit')fit();else if(select.value!=='custom')setScale(Number(select.value));
  });
  listen(screen,'wheel',event=>{
    const current=target();if(!current || event.defaultPrevented)return;
    const {area,frame}=current,x=event.clientX,y=event.clientY;
    if(x<area.left || y<area.top || x>=area.left+area.width || y>=area.top+area.height)return;
    event.preventDefault();event.stopPropagation();cancelPan();
    const units=event.deltaMode===1?40:event.deltaMode===2?(windowRef.innerHeight || area.height):1;
    const delta=[event.deltaX*units,event.deltaY*units];
    if(event.ctrlKey || event.metaKey){
      if(state.scale!==null)change(viewerZoomPan(state,event.shiftKey?[-delta[0]-delta[1],0]:delta.map(value=>-value),area,frame,dpr()),'pan');
    }else change(viewerZoomAround(state,[x,y],Math.exp(-delta[1]/200),area,frame,dpr()),'zoom');
  },{passive:false,capture:true});
  listen(screen,'pointerdown',event=>{
    if(event.button!==1 || pan || event.defaultPrevented)return;
    const current=target();if(!current)return;
    const {area}=current;
    if(event.clientX<area.left || event.clientX>=area.left+area.width || event.clientY<area.top || event.clientY>=area.top+area.height)return;
    onChange({reason:'pan'});
    pan={id:event.pointerId,x:event.clientX,y:event.clientY,element:current.element,stamp:stamp(current)};
    try{screen.setPointerCapture(event.pointerId);}catch{pan=null;return;}
    event.preventDefault();event.stopPropagation();
  },true);
  listen(screen,'pointermove',event=>{
    if(!pan || event.pointerId!==pan.id)return;
    const current=target();
    if(!(event.buttons&4) || current?.element!==pan.element || stamp(current)!==pan.stamp){cancelPan();return;}
    const delta=[event.clientX-pan.x,event.clientY-pan.y];pan.x=event.clientX;pan.y=event.clientY;
    event.preventDefault();event.stopPropagation();if(delta[0] || delta[1])change(viewerZoomPan(state,delta,current.area,current.frame,dpr()),'pan');
  },true);
  const end=event=>{if(pan && event.pointerId===pan.id){event.preventDefault?.();event.stopPropagation?.();cancelPan();}};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(screen,type,end,true);
  listen(windowRef,'blur',cancelPan);listen(windowRef,'resize',refresh);
  listen(windowRef,'scroll',refresh,{passive:true,capture:true});
  listen(documentRef,'visibilitychange',refresh);
  listen(documentRef,'toggle',refresh,true);listen(documentRef,'fullscreenchange',refresh);
  for(const element of media)for(const type of ['load','loadedmetadata','resize','emptied','error'])listen(element,type,refresh);
  const resize=new windowRef.ResizeObserver(refresh);for(const viewport of groups.values())resize.observe(viewport);
  const mutation=new windowRef.MutationObserver(refresh);
  for(const element of media)mutation.observe(element,{attributes:true,attributeFilter:['src','hidden','class']});
  for(const parent of groups.keys())mutation.observe(parent,{attributes:true,attributeFilter:['hidden','data-viewer-mode','data-program-playback','data-slip-preview']});
  refresh();
  return {refresh,fit,setScale,
    current(){const next=target();if(!next)return null;const rect=viewerZoomRect(state,next.area,next.frame,dpr());return {media:next.element,viewport:next.viewport,rect,preview_pixels:[...next.frame],scale:rect.scale,is_fit:state.scale===null};},
    bounds(){return this.current()?.rect ?? null;},
    dispose(){
      if(disposed)return;disposed=true;cancelPan();resize.disconnect();mutation.disconnect();for(const remove of listeners)remove();
      for(const {element,parent,viewport,style} of originals){parent.insertBefore(element,viewport);element.style.cssText=style;}
      for(const viewport of groups.values())viewport.remove();
    },
  };
}
