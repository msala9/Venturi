import {drawKeyframeHead,keyframeTimeRange} from './keyframe-navigation.js';

export const KEYFRAME_ROW_HEIGHT=22;
export const KEYFRAME_LABEL_WIDTH=110;
const targetId=target=>JSON.stringify(target);
const pickId=pick=>JSON.stringify([pick.target,pick.source_frame]);
const round=value=>value<0?-Math.floor(-value+0.5):Math.floor(value+0.5);

export function animatedKeyRows(detail){
  const scalar=(detail.curves?.tracks || []).filter(row=>row.key_count>0);
  const typed=(detail.event_keys || []).filter(row=>row.key_count>0);
  const rows=[],seen=new Set();
  const add=row=>{if(row && !seen.has(targetId(row.target))){seen.add(targetId(row.target));rows.push(row);}};
  scalar.filter(row=>['transform','gain'].includes(row.target.kind)).forEach(add);
  typed.filter(row=>row.target.kind==='color').forEach(add);
  const filters=[...new Set([...(detail.filters?.stack || []).map(filter=>filter.kind),...scalar.map(row=>row.target.filter || (row.target.kind==='grade'?'ColorCorrection':null)),...typed.map(row=>row.target.filter)].filter(Boolean))];
  for(const filter of filters){
    for(const kind of ['filter_radius','direction','filter_amount','filter_offset','filter_grow','grade']){
      [...scalar,...typed].filter(row=>row.target.kind===kind && (row.target.filter===filter || kind==='grade' && filter==='ColorCorrection')).forEach(add);
    }
  }
  scalar.filter(row=>row.target.kind==='mask').forEach(add);
  typed.filter(row=>row.target.kind==='text').forEach(add);
  [...scalar,...typed].forEach(add);
  return rows;
}

export function laneBoxPicks(rows,axis,box,scroll=0){
  const left=Math.max(axis.left,Math.min(box.x0,box.x1)),right=Math.min(axis.left+axis.plotWidth,Math.max(box.x0,box.x1));
  const top=Math.min(box.y0,box.y1)+scroll,bottom=Math.max(box.y0,box.y1)+scroll;
  if(right<axis.left)return [];
  return rows.flatMap((row,index)=>{
    const center=(index+0.5)*KEYFRAME_ROW_HEIGHT;
    return center<top || center>bottom?[]:row.keys.filter(key=>axis.x(key.source_frame)>=left && axis.x(key.source_frame)<=right).map(key=>({target:row.target,source_frame:key.source_frame}));
  });
}

export function laneDragDelta(picks,range,axis,x0,x){
  if(!picks.length || picks.some(pick=>!Number.isSafeInteger(pick.source_frame)))return 0;
  const frame=position=>axis.range.source_start+round((position-axis.left)/axis.plotWidth*(axis.range.source_end-axis.range.source_start));
  const low=range.source_start-Math.min(...picks.map(pick=>pick.source_frame));
  const high=range.source_end-Math.max(...picks.map(pick=>pick.source_frame));
  return low>high?0:Math.max(low,Math.min(high,frame(x)-frame(x0)));
}

export function renderKeyframeLanes(root,detail,{keySelection,getGeometry,getRange,canNavigate=()=>true,canEdit=()=>false,commit,operation,notice=()=>{},activate=()=>{},linkZoom=()=>false,seek,onViewportWheel,windowRef=root.ownerDocument?.defaultView ?? window}={}){
  const rows=animatedKeyRows(detail);
  if(!rows.length || !keySelection)return null;
  const documentRef=root.ownerDocument ?? document,section=documentRef.createElement('div'),heading=documentRef.createElement('p');
  section.className='keyframe-lanes';heading.className='keyframe-lanes-heading';heading.textContent='Animated parameters';section.append(heading);
  const viewport=documentRef.createElement('div'),content=documentRef.createElement('div'),canvas=documentRef.createElement('canvas');
  viewport.className='keyframe-lanes-viewport';content.className='keyframe-lanes-content';content.style.height=`${(rows.length+1)*KEYFRAME_ROW_HEIGHT}px`;
  canvas.className='keyframe-lanes-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label','Animated parameter lanes. Select across rows, drag key times, Delete selected keys. Double-click a key to seek.');
  canvas.style.height=`${Math.min(220,(rows.length+1)*KEYFRAME_ROW_HEIGHT)}px`;viewport.style.height=canvas.style.height;
  content.append(canvas);viewport.append(content);section.append(viewport);
  const status=documentRef.createElement('p');status.className='muted';status.setAttribute('aria-live','polite');section.append(status);root.append(section);
  const listeners=[];let disposed=false,pending=false,gesture=null,axis=null;
  const listen=(node,event,handler,options)=>{node.addEventListener(event,handler,options);listeners.push(()=>node.removeEventListener(event,handler,options));};
  const modal=()=>Boolean(documentRef.querySelector?.('dialog[open]'));
  const available=()=>!disposed && !pending && root.isConnected!==false && canvas.isConnected!==false && !documentRef.hidden && !modal() && canNavigate();
  const selection=()=>keySelection.get();
  const stamp=()=>{const rect=canvas.getBoundingClientRect();return JSON.stringify([rect.left,rect.top,rect.width,rect.height,viewport.scrollTop || 0,getRange(),selection()]);};
  const point=event=>{const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
  const release=id=>{try{if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);}catch{}};
  function cancel(){const old=gesture;gesture=null;if(old)release(old.id);draw();}
  function current(owner){return available() && stamp()===owner.stamp && (!owner.edit || canEdit());}
  function draw(){
    if(disposed || root.isConnected===false)return;
    const rect=canvas.getBoundingClientRect(),source=getGeometry();if(!rect.width || !source)return;
    const range=getRange(),ratio=windowRef.devicePixelRatio || 1;
    canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
    const width=source.plotWidth;
    axis={left:source.left,plotWidth:width,range:{...range},x:frame=>source.left+(frame-range.source_start)/Math.max(1,range.source_end-range.source_start)*width};
    const ctx=canvas.getContext('2d'),style=windowRef.getComputedStyle?.(canvas),color=(name,fallback)=>style?.getPropertyValue(name).trim() || fallback;
    ctx.scale(ratio,ratio);ctx.fillStyle=color('--bg','#17191f');ctx.fillRect(0,0,rect.width,rect.height);ctx.font='11px sans-serif';
    const selected=new Set(selection().map(pickId)),scroll=viewport.scrollTop || 0;
    const first=Math.max(0,Math.floor(scroll/KEYFRAME_ROW_HEIGHT)),last=Math.min(rows.length,Math.ceil((scroll+rect.height)/KEYFRAME_ROW_HEIGHT));
    ctx.save();ctx.beginPath();ctx.rect(0,0,rect.width,rect.height);ctx.clip();
    for(let index=first;index<last;index++){
      const row=rows[index],top=index*KEYFRAME_ROW_HEIGHT-scroll,y=top+KEYFRAME_ROW_HEIGHT/2;
      ctx.fillStyle=color('--muted','#a6abb6');ctx.textAlign='right';ctx.save();ctx.beginPath();ctx.rect(0,top,axis.left-6,KEYFRAME_ROW_HEIGHT);ctx.clip();ctx.fillText(row.name,axis.left-6,y+4);ctx.restore();ctx.textAlign='left';
      ctx.strokeStyle=color('--border','#343842');ctx.beginPath();ctx.moveTo(axis.left,y);ctx.lineTo(rect.width-12,y);ctx.stroke();
      ctx.save();ctx.beginPath();ctx.rect(axis.left,top,axis.plotWidth,KEYFRAME_ROW_HEIGHT);ctx.clip();
      for(const key of row.keys){
        const pick={target:row.target,source_frame:key.source_frame},chosen=selected.has(pickId(pick)),x=axis.x(key.source_frame+(chosen && gesture?.kind==='time'?gesture.delta:0));
        ctx.fillStyle=color(chosen?'--text':'--primary',chosen?'#fff':'#ff673d');ctx.beginPath();ctx.moveTo(x,y-4);ctx.lineTo(x+4,y);ctx.lineTo(x,y+4);ctx.lineTo(x-4,y);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
    drawKeyframeHead(ctx,{...axis,top:0,plotHeight:rect.height},detail);
    if(gesture?.kind==='box' && gesture.moved){const b=gesture.box;ctx.strokeStyle=color('--primary','#ff673d');ctx.strokeRect(Math.min(b.x0,b.x1),Math.min(b.y0,b.y1),Math.abs(b.x1-b.x0),Math.abs(b.y1-b.y0));}
    ctx.restore();
    const page=detail.key_page,shown=rows.reduce((sum,row)=>sum+row.keys.length,0),total=rows.reduce((sum,row)=>sum+row.key_count,0);
    status.textContent=gesture?.kind==='time' && gesture.moved?`Move ${selection().length} keys · ${gesture.delta} source frames · release to apply`:`${rows.length} animated parameters · ${selection().length} selected keys${shown<total?` · ${shown} of ${total} keys shown${page?`, page ${page.index+1}/${page.total_pages}`:''}; use Key pages for the rest`:''}`;
  }
  function hit(position){
    const index=Math.floor((position.y+(viewport.scrollTop || 0))/KEYFRAME_ROW_HEIGHT),row=rows[index];if(!row)return null;
    const key=position.x>=axis.left && position.x<=axis.left+axis.plotWidth?row.keys.filter(key=>key.source_frame>=axis.range.source_start && key.source_frame<=axis.range.source_end).map(key=>({key,distance:Math.abs(axis.x(key.source_frame)-position.x)})).filter(item=>item.distance<=11).sort((a,b)=>a.distance-b.distance)[0]?.key:null;
    return {row,key,index};
  }
  function update(owner,position){
    if(!owner.moved && Math.hypot(position.x-owner.x,position.y-owner.y)<3)return;
    owner.moved=true;
    if(owner.kind==='time')owner.delta=laneDragDelta(owner.picks,detail.curves,owner.axis,owner.x,position.x);
    else owner.box={x0:owner.x,y0:owner.y,x1:position.x,y1:position.y};
    draw();
  }
  async function apply(picks,delta,deleting=false){
    if(!available() || !canEdit() || !picks.length || !deleting && !delta)return;
    const before=selection(),after=deleting?[]:before.map(pick=>({...pick,source_frame:pick.source_frame+delta}));
    let payload;try{payload=operation(picks,delta,linkZoom());if(deleting)payload.edit.action={kind:'delete'};}catch(error){notice(error.message);return;}
    pending=true;keySelection.set(after,{focus:true});
    try{await commit(payload);}catch(error){if(JSON.stringify(selection())===JSON.stringify(after))keySelection.set(before,{focus:true});if(!disposed && root.isConnected!==false)notice(error.message);}finally{pending=false;draw();}
  }
  listen(canvas,'pointerdown',event=>{
    if(gesture || event.button!==0 || event.isPrimary===false || event.defaultPrevented || !available() || !axis)return;
    keySelection.beginGesture();const position=point(event),found=hit(position);canvas.focus({preventScroll:true});
    if(found && position.x<axis.left){activate(found.row.target);return;}
    const append=Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
    if(found?.key){
      const pick={target:found.row.target,source_frame:found.key.source_frame};keySelection.select(pick,append);activate(found.row.target);draw();
      if(!canEdit())return;
      gesture={kind:'time',id:event.pointerId,...position,axis:{...axis},picks:selection(),delta:0,moved:false,edit:true};
    }else{
      if(!append)keySelection.set([]);
      gesture={kind:'box',id:event.pointerId,...position,axis:{...axis},picks:selection(),append,moved:false,edit:false};
    }
    gesture.stamp=stamp();canvas.setPointerCapture(event.pointerId);event.preventDefault();
  });
  listen(canvas,'pointermove',event=>{const owner=gesture;if(!owner || owner.id!==event.pointerId)return;if(!current(owner)){cancel();return;}update(owner,point(event));});
  listen(canvas,'pointerup',event=>{
    const owner=gesture;if(!owner || owner.id!==event.pointerId || event.button!==0)return;
    if(!current(owner)){cancel();return;}update(owner,point(event));gesture=null;release(owner.id);event.preventDefault();
    if(owner.kind==='box'){
      const picks=owner.moved?laneBoxPicks(rows,owner.axis,owner.box,viewport.scrollTop || 0):[];
      try{keySelection.set([...new Map([...(owner.append?owner.picks:[]),...picks].map(pick=>[pickId(pick),pick])).values()],{focus:true});}catch(error){notice(error.message);}
    }else if(owner.moved)void apply(owner.picks,owner.delta);
    draw();
  });
  const abort=event=>{if(gesture?.id===event.pointerId)cancel();};
  listen(canvas,'pointercancel',abort);listen(canvas,'lostpointercapture',abort);
  if(onViewportWheel)listen(canvas,'wheel',onViewportWheel,{passive:false});
  listen(canvas,'dblclick',event=>{if(event.button!==0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !available() || !axis)return;const found=hit(point(event));if(found?.key && Number.isSafeInteger(found.key.timeline_frame) && typeof seek==='function'){event.preventDefault();seek(found.key.timeline_frame);}});
  listen(canvas,'keydown',event=>{
    if(event.defaultPrevented || event.isComposing)return;
    if(event.key==='Escape' && gesture){event.preventDefault();event.stopPropagation();cancel();}
    else if(['Delete','Backspace'].includes(event.key) && selection().length){event.preventDefault();event.stopPropagation();if(!gesture)void apply(selection(),0,true);}
  });
  listen(viewport,'scroll',cancel,{passive:true});listen(windowRef,'blur',cancel);listen(windowRef,'resize',cancel);
  listen(windowRef,'scroll',()=>{if(gesture && !current(gesture))cancel();},{passive:true,capture:true});
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});listen(documentRef,'toggle',()=>{if(modal())cancel();},true);
  const unsubscribe=keySelection.subscribe(draw),stopGesture=keySelection.onGesture(cancel);
  const Observer=windowRef.ResizeObserver ?? globalThis.ResizeObserver,observer=Observer?new Observer(cancel):null;observer?.observe(canvas);draw();
  return {refresh:draw,cancel,width:()=>canvas.getBoundingClientRect().width,dispose(){if(disposed)return;cancel();disposed=true;unsubscribe();stopGesture();observer?.disconnect();for(const remove of listeners)remove();section.remove();}};
}
