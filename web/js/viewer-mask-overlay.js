import {createViewerMaskGesture,viewerMaskAvailability,viewerMaskGeometry} from './viewer-mask.js';

export function createViewerMaskOverlay({screen,image,toggle,getContext,canCommit,commit,notice}){
  const documentRef=screen.ownerDocument,windowRef=documentRef.defaultView,canvas=documentRef.createElement('canvas'),status=documentRef.createElement('p');
  canvas.className='viewer-mask-canvas viewer-transform-canvas';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',touchAction:'none',pointerEvents:'none'});
  status.className='viewer-mask-status viewer-transform-status muted';status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  Object.assign(status.style,{position:'absolute',left:'8px',bottom:'8px',pointerEvents:'none'});screen.append(canvas,status);
  toggle.setAttribute('aria-pressed','false');
  let enabled=false,disposed=false,frame=null,pointer=null,handle=null,ghost=null;const listeners=[];
  const listen=(target,type,callback,options)=>{target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));};
  const schedule=()=>{if(!disposed && frame===null)frame=windowRef.requestAnimationFrame(draw);};
  const text=value=>{if(status.textContent!==value)status.textContent=value;};
  const release=id=>{if(id!==null)try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}};
  const gesture=createViewerMaskGesture({getContext,getViewport:()=>image.getBoundingClientRect(),canCommit,commit,notice,onGhost:geometry=>{ghost=geometry;schedule();}});
  function cancel(){const id=pointer;pointer=null;handle=null;gesture.cancel();release(id);schedule();}
  function invalidate(){if(disposed)return;gesture.invalidate();if(pointer!==null && !gesture.active()){const id=pointer;pointer=null;handle=null;release(id);}schedule();}
  function setEnabled(value){enabled=Boolean(value);toggle.setAttribute('aria-pressed',String(enabled));if(!enabled)cancel();schedule();}
  function draw(){
    frame=null;if(disposed)return;
    gesture.invalidate();if(pointer!==null && !gesture.active()){const id=pointer;pointer=null;handle=null;release(id);}
    canvas.hidden=status.hidden=!enabled;canvas.style.pointerEvents='none';if(!enabled)return;
    const context=getContext(),reason=viewerMaskAvailability(context);
    if(reason){canvas.hidden=true;text(`${reason} · use numeric Inspector controls`);return;}
    let geometry;
    try{geometry=ghost || viewerMaskGeometry(context,image.getBoundingClientRect(),{selectedVertex:gesture.selectedVertex()});}
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
    painter.strokeStyle=ghost?accent:foreground;painter.lineWidth=1.5;painter.setLineDash(ghost?[5,4]:[]);painter.beginPath();
    for(const [index,point] of geometry.outline.entries()){const [x,y]=local(point);if(index)painter.lineTo(x,y);else painter.moveTo(x,y);}
    if(geometry.closed)painter.closePath();painter.stroke();painter.setLineDash([]);painter.strokeStyle=accent;
    if(geometry.shape!=='Path' && geometry.knob){line(geometry.top || geometry.center,geometry.knob);dot(geometry.knob);}
    for(const corner of geometry.corners || [])dot(corner.point);
    for(const side of geometry.sides || [])dot(side.point,3.5);
    for(const tangent of geometry.tangents || []){line(tangent.vertex,tangent.point);dot(tangent.point,3.5);}
    for(const [index,point] of (geometry.vertices || []).entries())dot(point,index===geometry.selectedVertex?5.5:4.5,index===geometry.selectedVertex);
    const writable=canCommit();canvas.style.pointerEvents=writable?'auto':'none';
    text(ghost?`Draft mask ${handle?.kind || 'edit'} · release to apply · Escape cancels`:writable?'Inside: move · handles: resize/rotate · select vertex: tangents · outside edge: insert · double-click: smooth/corner · Alt: independent tangent/remove vertex · Shift: proportional size/15° rotation':'Read only · use numeric Inspector controls');
  }
  listen(toggle,'click',()=>setEnabled(!enabled));
  listen(toggle,'keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
  listen(canvas,'pointerdown',event=>{
    if(!enabled || pointer!==null || event.button!==0 || event.isPrimary===false)return;
    const next=gesture.begin([event.clientX,event.clientY],{alt:event.altKey});if(!next)return;
    pointer=event.pointerId;handle=next;
    try{canvas.setPointerCapture(pointer);}catch(error){cancel();notice(error.message);return;}
    event.preventDefault();event.stopPropagation();schedule();
  });
  listen(canvas,'pointermove',event=>{
    if(event.pointerId!==pointer)return;if(!(event.buttons&1)){cancel();return;}
    event.preventDefault();gesture.move([event.clientX,event.clientY],{shift:event.shiftKey,alt:event.altKey});
    if(!gesture.active()){const id=pointer;pointer=null;handle=null;release(id);}schedule();
  });
  listen(canvas,'pointerup',event=>{
    if(event.pointerId!==pointer || event.button!==0)return;
    event.preventDefault();event.stopPropagation();const id=pointer;pointer=null;
    Promise.resolve(gesture.end([event.clientX,event.clientY],{shift:event.shiftKey,alt:event.altKey})).catch(error=>notice(error.message)).finally(invalidate);
    handle=null;release(id);schedule();
  });
  listen(canvas,'dblclick',event=>{if(!enabled || event.button!==0 || event.altKey || !canCommit())return;event.preventDefault();event.stopPropagation();Promise.resolve(gesture.doubleClick([event.clientX,event.clientY])).catch(error=>notice(error.message)).finally(invalidate);});
  listen(canvas,'pointercancel',event=>{if(event.pointerId===pointer)cancel();});
  listen(canvas,'lostpointercapture',event=>{if(event.pointerId===pointer)cancel();});
  listen(documentRef,'keydown',event=>{if(event.key==='Escape' && gesture.active()){event.preventDefault();event.stopPropagation();cancel();}},true);
  listen(windowRef,'blur',cancel);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  listen(screen,'wheel',cancel,{passive:true,capture:true});listen(windowRef,'scroll',cancel,{passive:true,capture:true});listen(windowRef,'resize',cancel);listen(image,'load',cancel);
  const imageObserver=new windowRef.MutationObserver(()=>{cancel();invalidate();});imageObserver.observe(image,{attributes:true,attributeFilter:['class','hidden','src']});
  const resizeObserver=new windowRef.ResizeObserver(()=>{cancel();invalidate();});resizeObserver.observe(screen);resizeObserver.observe(image);schedule();
  return {invalidate,cancel,setEnabled,enabled:()=>enabled,dispose(){if(disposed)return;disposed=true;cancel();if(frame!==null)windowRef.cancelAnimationFrame(frame);frame=null;imageObserver.disconnect();resizeObserver.disconnect();for(const remove of listeners)remove();canvas.remove();status.remove();toggle.setAttribute('aria-pressed','false');}};
}
