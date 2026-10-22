const frame=value=>Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000;
const activeEditors=new WeakMap();
export function keyframeClock(detail){
  const clock=detail?.keyframe_clock;
  return clock && Number.isSafeInteger(clock.source_frame) && Number.isSafeInteger(clock.source_in) && Number.isSafeInteger(clock.source_out) && clock.source_out>clock.source_in && Array.isArray(clock.ticks)?clock:null;
}
export function keyframeTimeRange(detail,fallback){
  const clock=keyframeClock(detail);
  return clock?{source_start:clock.source_in,source_end:clock.source_out}:fallback;
}
export function drawKeyframeHead(ctx,geometry,detail,{top,bottom,sourceFrame,color='#ff673d'}={}){
  const clock=keyframeClock(detail),source=sourceFrame ?? clock?.source_frame;
  if(!geometry || !Number.isSafeInteger(source))return;
  const x=geometry.x(source),left=geometry.left ?? geometry.x(keyframeTimeRange(detail,detail.curves).source_start),right=left+(geometry.plotWidth ?? geometry.x(keyframeTimeRange(detail,detail.curves).source_end)-left);
  if(!Number.isFinite(x) || x<left || x>right)return;
  ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,top ?? geometry.top ?? 0);ctx.lineTo(x,bottom ?? (geometry.top+geometry.plotHeight));ctx.stroke();
}
export function keyframeNavigationResult(value,detail,source){
  const clock=keyframeClock(detail),expected=clock && Math.max(clock.source_in,Math.min(clock.source_out,source));
  if(!clock || !['project_epoch','generation','timeline_id','revision','clip_id'].every(key=>typeof detail[key]==='string' && detail[key].length>0 && value?.[key]===detail[key]) || value.source_frame!==expected || !frame(value.timeline_frame))throw Error('The native keyframe destination no longer matches this clip');
  return value.timeline_frame;
}

export function createKeyframeNavigation({root,scopeRoot=root,detail,getKey,getRange,getGeometry,seek,canNavigate=()=>true,navigateSource,notice=()=>{},onDraft=()=>{},label='curve'}){
  const documentRef=root.ownerDocument ?? document,windowRef=documentRef.defaultView ?? window;
  const ruler=documentRef.createElement('canvas'),jump=documentRef.createElement('button'),status=documentRef.createElement('p');
  ruler.className='curve-graph keyframe-ruler';ruler.style.height='28px';ruler.tabIndex=0;ruler.setAttribute('aria-label',`Native ${label} keyframe ruler; click or drag to seek on release`);
  jump.type='button';jump.textContent=`Go to selected ${label} key`;status.className='muted';status.setAttribute('aria-live','polite');root.append(ruler,jump,status);
  let disposed=false,gesture=null,pending=null,draft=null;const listeners=[];
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  const clock=()=>keyframeClock(detail);
  const available=()=>!disposed && root.isConnected!==false && !documentRef.hidden && !documentRef.querySelector?.('dialog[open]') && canNavigate() && typeof seek==='function';
  const selected=()=>{const key=getKey();return key && frame(key.timeline_frame)?key:null;};
  const geometryStamp=()=>{
    const rect=ruler.getBoundingClientRect();
    return JSON.stringify([rect.left,rect.top,rect.width,rect.height,getRange(),getKey()?.source_frame]);
  };
  const owned=owner=>available() && owner.stamp===geometryStamp();
  function release(id){try{if(ruler.hasPointerCapture?.(id))ruler.releasePointerCapture(id);}catch{}}
  function cancel(){
    const before=gesture;gesture=null;if(before)release(before.id);
    if(pending){pending.canceled=true;pending.controller.abort();}
    if(activeEditors.get(scopeRoot)===cancel)activeEditors.delete(scopeRoot);
    if(draft!==null){draft=null;onDraft(null);}draw();
  }
  function claim(){const previous=activeEditors.get(scopeRoot);if(previous && previous!==cancel)previous();activeEditors.set(scopeRoot,cancel);}
  function draw(){
    if(disposed)return;
    const permitted=available(),key=selected(),native=clock(),geometry=getGeometry();
    jump.disabled=!permitted || Boolean(pending) || !key;
    ruler.setAttribute('aria-disabled',String(!permitted || !native || !navigateSource || Boolean(pending)));
    if(!pending)status.textContent=native?`Timeline ${detail.timeline_frame} · animation source ${native.source_frame}${draft===null?'':` · seek draft source ${draft}`}`:'Read the native animation clock to use the ruler';
    if(!root.open || !geometry || !native)return;
    const box=ruler.getBoundingClientRect();if(!box.width || !box.height)return;
    const ratio=windowRef.devicePixelRatio || 1;ruler.width=Math.round(box.width*ratio);ruler.height=Math.round(box.height*ratio);
    const ctx=ruler.getContext('2d');if(!ctx)return;
    const style=windowRef.getComputedStyle?.(ruler),color=key=>style?.getPropertyValue(key).trim();
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,box.width,box.height);ctx.font='10px sans-serif';ctx.fillStyle=color('--muted') || '#aaa';ctx.strokeStyle=color('--border') || '#555';
    const range=getRange();
    for(const tick of native.ticks){
      if(!Number.isSafeInteger(tick.source_frame) || !Number.isSafeInteger(tick.timeline_frame) || tick.source_frame<range.source_start || tick.source_frame>range.source_end)continue;
      const x=geometry.x(tick.source_frame);ctx.beginPath();ctx.moveTo(x,box.height-5);ctx.lineTo(x,box.height);ctx.stroke();
      ctx.textAlign=tick.source_frame===range.source_end?'right':'left';ctx.fillText(`T ${tick.timeline_frame}`,x,12);
    }
    drawKeyframeHead(ctx,geometry,detail,{top:0,bottom:box.height,sourceFrame:draft,color:color('--primary') || '#ff673d'});
  }
  function refresh(){
    if(gesture && !owned(gesture) || pending && !owned(pending))cancel();else draw();
  }
  function point(event){
    const native=clock(),geometry=getGeometry(),rect=ruler.getBoundingClientRect();
    if(!native || !geometry || rect.width<=0)return null;
    return Math.max(native.source_in,Math.min(native.source_out,geometry.frame((event.clientX-rect.left)*(ruler.clientWidth && rect.width?ruler.clientWidth/rect.width:1))));
  }
  async function navigate(source,owner){
    if(pending || !owned(owner) || typeof navigateSource!=='function')return false;
    const ticket={...owner,controller:new AbortController(),canceled:false};pending=ticket;status.textContent='Reading native keyframe destination…';draw();
    try{
      const value=await navigateSource(source,{signal:ticket.controller.signal});
      if(ticket.canceled || pending!==ticket || !owned(ticket))return false;
      const destination=keyframeNavigationResult(value,detail,source);
      pending=null;draft=null;onDraft(null);if(ticket.canceled || !owned(ticket))return false;seek(destination);return true;
    }catch(error){if(!ticket.canceled && owned(ticket) && error.name!=='AbortError')notice(error.message);return false;}
    finally{if(pending===ticket)pending=null;if(activeEditors.get(scopeRoot)===cancel)activeEditors.delete(scopeRoot);if(!disposed){draft=null;onDraft(null);draw();}}
  }
  listen(ruler,'pointerdown',event=>{
    if(gesture || pending || !available() || typeof navigateSource!=='function' || event.button!==0 || event.isPrimary===false || event.defaultPrevented)return;
    const source=point(event);if(source===null)return;
    claim();if(!available())return;
    gesture={id:event.pointerId,stamp:geometryStamp()};
    try{ruler.setPointerCapture(event.pointerId);}catch{gesture=null;return;}
    event.preventDefault();event.stopPropagation();draft=source;onDraft(draft);draw();
  });
  listen(ruler,'pointermove',event=>{
    if(!gesture || gesture.id!==event.pointerId)return;
    if(!owned(gesture) || event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
    event.preventDefault();event.stopPropagation();draft=point(event);onDraft(draft);draw();
  });
  listen(ruler,'pointerup',event=>{
    if(!gesture || gesture.id!==event.pointerId || event.button!==0)return;
    const owner=gesture,source=point(event),current=owned(owner);gesture=null;release(owner.id);
    event.preventDefault();event.stopPropagation();
    if(!current || source===null){cancel();return;}
    navigate(source,owner);
  });
  const pointerCancel=event=>{if(gesture?.id===event.pointerId)cancel();};
  listen(ruler,'pointercancel',pointerCancel);listen(ruler,'lostpointercapture',pointerCancel);
  listen(ruler,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}});
  listen(jump,'click',()=>{const key=selected();if(available() && key && !pending){claim();cancel();if(available() && selected()===key)seek(key.timeline_frame);}});
  listen(windowRef,'blur',cancel);listen(windowRef,'resize',cancel);listen(windowRef,'scroll',cancel,{passive:true,capture:true});
  listen(documentRef,'toggle',refresh,true);listen(documentRef,'visibilitychange',cancel);
  const resize=new windowRef.ResizeObserver(()=>{cancel();draw();});resize.observe(ruler);
  draw();
  return {refresh,cancel,ruler,jump,status,sourceFrame:()=>draft,dispose(){if(disposed)return;cancel();disposed=true;resize.disconnect();for(const remove of listeners)remove();ruler.remove();jump.remove();status.remove();}};
}
