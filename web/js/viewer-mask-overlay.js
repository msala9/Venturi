import {createViewerMaskGesture,viewerMaskAvailability,viewerMaskGeometry} from './viewer-mask.js';
import {createViewerMaskPen,viewerMaskPenAvailability} from './viewer-mask-pen.js';

export function createViewerMaskOverlay({screen,image,toggle,penToggle,getContext,getPenContext=getContext,canCommit,commit,notice}){
  const documentRef=screen.ownerDocument,windowRef=documentRef.defaultView,canvas=documentRef.createElement('canvas'),status=documentRef.createElement('p');
  canvas.className='viewer-mask-canvas viewer-transform-canvas';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',touchAction:'none',pointerEvents:'none'});
  status.className='viewer-mask-status viewer-transform-status muted';status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  Object.assign(status.style,{position:'absolute',left:'8px',bottom:'8px',pointerEvents:'none'});screen.append(canvas,status);
  toggle.setAttribute('aria-pressed','false');
  if(penToggle)penToggle.setAttribute('aria-pressed','false');
  let enabled=false,disposed=false,frame=null,pointer=null,owner=null,handle=null,ghost=null,penGhost=null,suppressDoubleClick=false;const listeners=[];
  const listen=(target,type,callback,options)=>{target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));};
  const schedule=()=>{if(!disposed && frame===null)frame=windowRef.requestAnimationFrame(draw);};
  const text=value=>{if(status.textContent!==value)status.textContent=value;};
  const release=id=>{if(id!==null)try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}};
  const modal=()=>Boolean(documentRef.querySelector?.('dialog[open]'));
  const canDraw=()=>canCommit() && !modal();
  const gesture=createViewerMaskGesture({getContext,getViewport:()=>image.getBoundingClientRect(),canCommit,commit,notice,onGhost:geometry=>{ghost=geometry;schedule();}});
  const pen=createViewerMaskPen({getContext:getPenContext,getViewport:()=>image.getBoundingClientRect(),canCommit:canDraw,commit,notice,onGhost:geometry=>{penGhost=geometry;schedule();}});
  function cancel(){const id=pointer;pointer=null;owner=null;handle=null;gesture.cancel();pen.cancel();release(id);schedule();}
  function check(){
    gesture.invalidate();pen.invalidate();
    if(pointer!==null && !(owner==='pen'?pen.dragging():gesture.active())){const id=pointer;pointer=null;owner=null;handle=null;release(id);}
  }
  function invalidate(){if(disposed)return;check();schedule();}
  function setEnabled(value){enabled=Boolean(value);toggle.setAttribute('aria-pressed',String(enabled));if(!enabled)cancel();schedule();}
  function startPen(){
    if(disposed || pen.pending() || !canDraw())return false;
    if(pen.active()){pen.invalidate();if(pen.active())return true;}
    const reason=viewerMaskPenAvailability(getPenContext());if(reason){notice(reason);schedule();return false;}
    cancel();if(!pen.start())return false;setEnabled(true);suppressDoubleClick=true;canvas.hidden=false;canvas.tabIndex=0;canvas.setAttribute('aria-hidden','false');canvas.setAttribute('aria-label','Draw mask path: click to add, drag for tangents, Enter to finish, Escape to cancel');canvas.focus({preventScroll:true});schedule();return true;
  }
  function penControls(){
    const drawing=pen.active(),pending=pen.pending(),reason=pending?'Wait for the native mask command':!canDraw()?'Drawing requires a writable stopped Program with no open dialog':viewerMaskPenAvailability(getPenContext());
    if(penToggle){penToggle.setAttribute('aria-pressed',String(drawing));penToggle.disabled=pending || Boolean(reason);penToggle.title=reason || (drawing?'Cancel this path draft':'Draw a new mask path: click vertices and drag tangents');penToggle.setAttribute('aria-description',penToggle.title);}
    if(!drawing){canvas.tabIndex=-1;canvas.setAttribute('aria-hidden','true');}
  }
  function draw(){
    frame=null;if(disposed)return;
    check();penControls();
    canvas.hidden=status.hidden=!enabled;canvas.style.pointerEvents='none';if(!enabled)return;
    if(pen.pending()){canvas.hidden=true;text('Applying the completed path · wait for native mask properties');return;}
    const drawing=pen.active(),context=drawing?getPenContext():getContext(),reason=drawing?viewerMaskPenAvailability(context):viewerMaskAvailability(context);
    if(reason){canvas.hidden=true;text(`${reason} · use numeric Inspector controls`);return;}
    let geometry;
    try{geometry=drawing?penGhost:ghost || viewerMaskGeometry(context,image.getBoundingClientRect(),{selectedVertex:gesture.selectedVertex()});if(!geometry)throw Error('Read the current path draft');}
    catch(error){canvas.hidden=true;text(`${error.message} · use numeric Inspector controls`);return;}
    const bounds=canvas.getBoundingClientRect();if(bounds.width<=0 || bounds.height<=0){canvas.hidden=true;text('Mask handles need a visible frame · use numeric Inspector controls');return;}
    const budget=4_194_304,ratio=Math.min(windowRef.devicePixelRatio || 1,Math.sqrt(budget/(bounds.width*bounds.height)));
    const width=Math.min(budget,Math.max(1,Math.floor(bounds.width*ratio))),height=Math.min(Math.floor(budget/width),Math.max(1,Math.floor(bounds.height*ratio)));
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    const painter=canvas.getContext('2d');if(!painter){canvas.hidden=true;text('Mask overlay unavailable · use numeric Inspector controls');return;}
    painter.setTransform(width/bounds.width,0,0,height/bounds.height,0,0);painter.clearRect(0,0,bounds.width,bounds.height);
    const style=windowRef.getComputedStyle(canvas),accent=style.getPropertyValue('--primary').trim() || '#ff673d',foreground=style.getPropertyValue('--text').trim() || '#f5eff5',surface=style.getPropertyValue('--surface').trim() || '#19131d';
    const local=point=>[point[0]-bounds.left,point[1]-bounds.top];
    const line=(a,b)=>{painter.beginPath();painter.moveTo(...local(a));painter.lineTo(...local(b));painter.stroke();};
    const dot=(point,radius=4.5,selected=false)=>{painter.beginPath();painter.arc(...local(point),radius,0,Math.PI*2);painter.fillStyle=selected?accent:surface;painter.fill();painter.stroke();};
    painter.strokeStyle=drawing || ghost?accent:foreground;painter.lineWidth=1.5;painter.setLineDash(drawing || ghost?[5,4]:[]);painter.beginPath();
    for(const [index,point] of geometry.outline.entries()){const [x,y]=local(point);if(index)painter.lineTo(x,y);else painter.moveTo(x,y);}
    if(geometry.closed)painter.closePath();painter.stroke();painter.setLineDash([]);painter.strokeStyle=accent;
    if(geometry.shape!=='Path' && geometry.knob){line(geometry.top || geometry.center,geometry.knob);dot(geometry.knob);}
    for(const corner of geometry.corners || [])dot(corner.point);
    for(const side of geometry.sides || [])dot(side.point,3.5);
    for(const tangent of geometry.tangents || []){line(tangent.vertex,tangent.point);dot(tangent.point,3.5);}
    for(const [index,point] of (geometry.vertices || []).entries())dot(point,index===geometry.selectedVertex?5.5:4.5,index===geometry.selectedVertex);
    const writable=drawing?canDraw():canCommit();canvas.style.pointerEvents=writable?'auto':'none';canvas.style.cursor=drawing?'crosshair':'';
    text(drawing?`New path draft · ${pen.count()} of 21 vertices · click to add, drag for tangents · Alt: independent tangent · first vertex or Enter closes after three points · Escape cancels`:ghost?`Draft mask ${handle?.kind || 'edit'} · release to apply · Escape cancels`:writable?'Inside: move · handles: resize/rotate · select vertex: tangents · outside edge: insert · double-click: smooth/corner · Alt: independent tangent/remove vertex · Shift: proportional size/15° rotation':'Read only · use numeric Inspector controls');
  }
  listen(toggle,'click',()=>setEnabled(!enabled));
  listen(toggle,'keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
  if(penToggle){listen(penToggle,'click',()=>{if(pen.active())cancel();else startPen();});listen(penToggle,'keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});}
  listen(canvas,'pointerdown',event=>{
    if(!enabled || pointer!==null || event.button!==0 || event.isPrimary===false || pen.pending())return;
    const drawing=pen.active(),next=drawing?pen.begin([event.clientX,event.clientY]):gesture.begin([event.clientX,event.clientY],{alt:event.altKey});if(!next)return;
    owner=drawing?'pen':'mask';suppressDoubleClick=drawing;pointer=event.pointerId;handle=next;
    try{canvas.setPointerCapture(pointer);}catch(error){cancel();notice(error.message);return;}
    if(drawing)canvas.focus({preventScroll:true});
    event.preventDefault();event.stopPropagation();schedule();
  });
  listen(canvas,'pointermove',event=>{
    if(event.pointerId!==pointer)return;if(!(event.buttons&1)){cancel();return;}
    event.preventDefault();(owner==='pen'?pen:gesture).move([event.clientX,event.clientY],{shift:event.shiftKey,alt:event.altKey});check();schedule();
  });
  listen(canvas,'pointerup',event=>{
    if(event.pointerId!==pointer || event.button!==0)return;
    event.preventDefault();event.stopPropagation();const id=pointer,controller=owner==='pen'?pen:gesture;pointer=null;owner=null;
    Promise.resolve(controller.end([event.clientX,event.clientY],{shift:event.shiftKey,alt:event.altKey})).catch(error=>notice(error.message)).finally(invalidate);
    handle=null;release(id);schedule();
  });
  listen(canvas,'dblclick',event=>{if(suppressDoubleClick || pen.active() || pen.pending()){event.preventDefault();event.stopPropagation();return;}if(!enabled || event.button!==0 || event.altKey || !canCommit())return;event.preventDefault();event.stopPropagation();Promise.resolve(gesture.doubleClick([event.clientX,event.clientY])).catch(error=>notice(error.message)).finally(invalidate);});
  listen(canvas,'pointercancel',event=>{if(event.pointerId===pointer)cancel();});
  listen(canvas,'lostpointercapture',event=>{if(event.pointerId===pointer)cancel();});
  listen(documentRef,'keydown',event=>{
    if(modal()){if(pen.active())cancel();return;}
    if(event.key==='Escape' && (gesture.active() || pen.active())){event.preventDefault();event.stopPropagation();cancel();return;}
    if(event.key==='Enter' && pen.active() && !event.repeat && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !modal() && documentRef.activeElement===canvas && canDraw()){
      event.preventDefault();event.stopPropagation();Promise.resolve(pen.finish()).catch(error=>notice(error.message)).finally(invalidate);schedule();
    }
  },true);
  listen(windowRef,'blur',cancel);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  listen(screen,'wheel',cancel,{passive:true,capture:true});listen(windowRef,'scroll',cancel,{passive:true,capture:true});listen(windowRef,'resize',cancel);listen(image,'load',cancel);
  const imageObserver=new windowRef.MutationObserver(()=>{cancel();invalidate();});imageObserver.observe(image,{attributes:true,attributeFilter:['class','hidden','src']});
  const resizeObserver=new windowRef.ResizeObserver(()=>{cancel();invalidate();});resizeObserver.observe(screen);resizeObserver.observe(image);schedule();
  return {invalidate,cancel,setEnabled,startPen,penActive:()=>pen.active() || pen.pending(),enabled:()=>enabled,dispose(){if(disposed)return;disposed=true;cancel();if(frame!==null)windowRef.cancelAnimationFrame(frame);frame=null;imageObserver.disconnect();resizeObserver.disconnect();for(const remove of listeners)remove();canvas.remove();status.remove();toggle.setAttribute('aria-pressed','false');if(penToggle){penToggle.setAttribute('aria-pressed','false');penToggle.disabled=true;}}};
}
