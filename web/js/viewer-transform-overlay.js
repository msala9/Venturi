import {createViewerTransformGesture,viewerTransformAvailability,viewerTransformGeometry} from './viewer-transform.js';

export function createViewerTransformOverlay({screen,image,toggle,getContext,canCommit,commit,notice}){
  const documentRef=screen.ownerDocument,windowRef=documentRef.defaultView;
  const canvas=documentRef.createElement('canvas'),status=documentRef.createElement('p');
  canvas.className='viewer-transform-canvas';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',touchAction:'none',pointerEvents:'none'});
  status.className='viewer-transform-status muted';status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  Object.assign(status.style,{position:'absolute',left:'8px',bottom:'8px',pointerEvents:'none'});
  screen.append(canvas,status);
  const originalTitle=toggle.getAttribute('title');toggle.setAttribute('aria-pressed','false');
  let enabled=false,disposed=false,frame=null,pointer=null,handle=null,ghost=null;
  const listeners=[];
  function listen(target,type,listener,options){target.addEventListener(type,listener,options);listeners.push(()=>target.removeEventListener(type,listener,options));}
  function schedule(){if(!disposed && frame===null)frame=windowRef.requestAnimationFrame(draw);}
  function text(message){if(status.textContent!==message)status.textContent=message;}
  function release(id){if(id===null)return;try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}}
  function cancel(){const id=pointer;pointer=null;handle=null;gesture.cancel();release(id);schedule();}
  const gesture=createViewerTransformGesture({getContext,getViewport:()=>image.getBoundingClientRect(),canCommit,commit,notice,onGhost:geometry=>{ghost=geometry;schedule();}});
  function draw(){
    frame=null;if(disposed)return;
    gesture.invalidate();if(pointer!==null && !gesture.active()){const id=pointer;pointer=null;handle=null;release(id);}
    canvas.hidden=status.hidden=!enabled;canvas.style.pointerEvents='none';
    if(!enabled)return;
    const context=getContext(),reason=viewerTransformAvailability(context);
    if(reason){canvas.hidden=true;text(`${reason} · use numeric Inspector controls`);return;}
    let geometry;
    try{geometry=ghost || viewerTransformGeometry(context,image.getBoundingClientRect());}
    catch(error){canvas.hidden=true;text(`${error.message} · use numeric Inspector controls`);return;}
    const bounds=canvas.getBoundingClientRect();
    if(bounds.width<=0 || bounds.height<=0){canvas.hidden=true;text('Viewer handles need a visible frame · use numeric Inspector controls');return;}
    const budget=4_194_304,ratio=Math.min(windowRef.devicePixelRatio || 1,Math.sqrt(budget/(bounds.width*bounds.height)));
    const width=Math.min(budget,Math.max(1,Math.floor(bounds.width*ratio))),height=Math.min(Math.floor(budget/width),Math.max(1,Math.floor(bounds.height*ratio)));
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    const painter=canvas.getContext('2d');if(!painter){text('Viewer overlay unavailable · use numeric Inspector controls');return;}
    painter.setTransform(width/bounds.width,0,0,height/bounds.height,0,0);painter.clearRect(0,0,bounds.width,bounds.height);
    const style=windowRef.getComputedStyle(canvas),accent=style.getPropertyValue('--primary').trim() || '#ff673d',foreground=style.getPropertyValue('--text').trim() || '#f5eff5',surface=style.getPropertyValue('--surface').trim() || '#19131d';
    const points=geometry.corners.map(point=>[point[0]-bounds.left,point[1]-bounds.top]);
    painter.strokeStyle=ghost?accent:foreground;painter.lineWidth=1.5;painter.setLineDash(ghost?[5,4]:[]);painter.beginPath();points.forEach(([x,y],index)=>index?painter.lineTo(x,y):painter.moveTo(x,y));painter.closePath();painter.stroke();painter.setLineDash([]);
    painter.fillStyle=surface;painter.strokeStyle=accent;
    for(const [x,y] of points){painter.beginPath();painter.arc(x,y,4.5,0,Math.PI*2);painter.fill();painter.stroke();}
    const writable=canCommit();canvas.style.pointerEvents=writable?'auto':'none';
    text(ghost?`Draft ${handle?.kind==='scale'?'scale':'position'} outline · release to apply · Escape cancels · Shift: independent scale`:writable?'Drag inside to move · drag a corner to scale · Shift: independent scale · animated axes use numeric Inspector controls':'Read only · use numeric Inspector controls');
  }
  function invalidate(){
    if(disposed)return;
    gesture.invalidate();if(pointer!==null && !gesture.active()){const id=pointer;pointer=null;handle=null;release(id);}schedule();
  }
  listen(toggle,'click',()=>{enabled=!enabled;toggle.setAttribute('aria-pressed',String(enabled));if(!enabled)cancel();schedule();});
  listen(toggle,'keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
  listen(canvas,'pointerdown',event=>{
    if(!enabled || pointer!==null || event.button!==0 || event.isPrimary===false)return;
    const next=gesture.begin([event.clientX,event.clientY]);if(!next)return;
    pointer=event.pointerId;handle=next;
    try{canvas.setPointerCapture(pointer);}catch(error){cancel();notice(error.message);return;}
    event.preventDefault();event.stopPropagation();schedule();
  });
  listen(canvas,'pointermove',event=>{
    if(event.pointerId!==pointer)return;
    if(!(event.buttons&1)){cancel();return;}
    event.preventDefault();gesture.move([event.clientX,event.clientY],{free:event.shiftKey});
    if(!gesture.active()){const id=pointer;pointer=null;handle=null;release(id);}schedule();
  });
  listen(canvas,'pointerup',event=>{
    if(event.pointerId!==pointer || event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const id=pointer;pointer=null;
    Promise.resolve(gesture.end([event.clientX,event.clientY],{free:event.shiftKey})).catch(error=>notice(error.message)).finally(invalidate);
    handle=null;release(id);schedule();
  });
  listen(canvas,'pointercancel',event=>{if(event.pointerId===pointer)cancel();});
  listen(canvas,'lostpointercapture',event=>{if(event.pointerId===pointer)cancel();});
  listen(documentRef,'keydown',event=>{if(event.key==='Escape' && gesture.active()){event.preventDefault();event.stopPropagation();cancel();}},true);
  listen(windowRef,'blur',cancel);
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  listen(screen,'wheel',cancel,{passive:true,capture:true});
  listen(windowRef,'scroll',cancel,{passive:true,capture:true});
  listen(windowRef,'resize',cancel);
  listen(image,'load',cancel);
  const imageObserver=new windowRef.MutationObserver(()=>{cancel();invalidate();});
  imageObserver.observe(image,{attributes:true,attributeFilter:['class','hidden','src']});
  const resizeObserver=new windowRef.ResizeObserver(()=>{cancel();invalidate();});resizeObserver.observe(screen);resizeObserver.observe(image);
  schedule();
  return {
    invalidate,
    cancel,
    dispose(){
      if(disposed)return;disposed=true;cancel();if(frame!==null)windowRef.cancelAnimationFrame(frame);frame=null;
      imageObserver.disconnect();resizeObserver.disconnect();for(const remove of listeners)remove();canvas.remove();status.remove();toggle.setAttribute('aria-pressed','false');
      if(originalTitle===null)toggle.removeAttribute('title');else toggle.setAttribute('title',originalTitle);
    },
  };
}
