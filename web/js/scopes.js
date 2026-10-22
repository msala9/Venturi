import { createViewer, matchesFrame } from "./viewer.js";

export function scopeGraticule(kind,{x=0,y=0,width,height}){
  const lines=[],labels=[],circles=[],targets=[];
  const line=(x1,y1,x2,y2,color)=>lines.push({x1,y1,x2,y2,color});
  if(['Waveform','Parade'].includes(kind)){
    for(const percent of [0,25,50,75,100]){const at=y+height*(1-percent/100);line(x,at,x+width,at);labels.push({text:String(percent),x:x+2,y:at});}
    if(kind==='Parade')for(const third of [1,2])line(x+width*third/3,y,x+width*third/3,y+height);
  }else if(kind==='Histogram'){
    for(const quarter of [1,2,3])line(x+width*quarter/4,y,x+width*quarter/4,y+height);
  }else if(kind==='Vectorscope'){
    const side=Math.min(width,height),cx=x+width/2,cy=y+height/2;
    const at=(cb,cr)=>[cx+cb*side,cy-cr*side];
    circles.push({x:cx,y:cy,radius:side/2});line(cx-side/2,cy,cx+side/2,cy);line(cx,cy-side/2,cx,cy+side/2);
    const skin=123*Math.PI/180,skinEnd=at(Math.cos(skin)*.5,Math.sin(skin)*.5);line(cx,cy,...skinEnd,'rgba(255,200,150,0.275)');
    // Native graticule targets use Rec.709 Cb/Cr of static 75% color bars.
    const f=Math.fround;
    for(const [text,rgb] of [['R',[.75,0,0]],['Mg',[.75,0,.75]],['B',[0,0,.75]],['Cy',[0,.75,.75]],['G',[0,.75,0]],['Yl',[.75,.75,0]]]){
      const luma=f(f(f(f(.2126)*rgb[0])+f(f(.7152)*rgb[1]))+f(f(.0722)*rgb[2]));
      const [px,py]=at(f(f(rgb[2]-luma)/f(1.8556)),f(f(rgb[0]-luma)/f(1.5748)));
      targets.push({x:px,y:py,size:8});labels.push({text,x:px+6,y:py-6});
    }
  }
  return {lines,labels,circles,targets};
}

export function drawScopeGraticule(ctx,kind,rect){
  const guide=scopeGraticule(kind,rect);ctx.save();ctx.beginPath();ctx.rect(rect.x || 0,rect.y || 0,rect.width,rect.height);ctx.clip();ctx.lineWidth=1;
  for(const line of guide.lines){ctx.strokeStyle=line.color || 'rgba(255,255,255,0.157)';ctx.beginPath();ctx.moveTo(line.x1,line.y1);ctx.lineTo(line.x2,line.y2);ctx.stroke();}
  ctx.strokeStyle='rgba(255,255,255,0.157)';for(const circle of guide.circles){ctx.beginPath();ctx.arc(circle.x,circle.y,circle.radius,0,Math.PI*2);ctx.stroke();}
  ctx.strokeStyle='rgba(255,255,255,0.353)';for(const target of guide.targets)ctx.strokeRect(target.x-target.size/2,target.y-target.size/2,target.size,target.size);
  ctx.fillStyle='rgba(255,255,255,0.431)';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';for(const label of guide.labels)ctx.fillText(label.text,label.x,label.y);ctx.restore();
}

export function matchesScope(request, current) {
  return matchesFrame(request, current) && ["clip", "first", "second", "selection_key", "source_version"].every((key) => request[key] === current[key]);
}
export function scopeURL(target) {
  const {clip,first,second}=target;
  const frame=Object.fromEntries(['project_epoch','if_generation','timeline_id','revision','frame','width'].map(key=>[key,target[key]]));
  return `/api/v1/preview/scopes/${encodeURIComponent(clip)}/${encodeURIComponent(first)}/${encodeURIComponent(second)}?${new URLSearchParams(frame)}`;
}
export function scopeTarget(document, timeline, selection, frame) {
  if (!document?.capabilities.scopes || !timeline || !Array.isArray(selection) || !Number.isSafeInteger(frame) || frame<0) return null;
  const selected=new Set(selection);
  const compareId=(a,b)=>/^\d{1,20}$/.test(a) && /^\d{1,20}$/.test(b)?(BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0):a.localeCompare(b);
  let primary=null;
  for(const track of timeline.tracks){
    if(track.kind!=='video')continue;
    primary=track.clips.filter(clip=>selected.has(clip.id)).sort((a,b)=>a.start_frame-b.start_frame || compareId(a.id,b.id))[0];
    if(primary)break;
  }
  if (!primary || frame < primary.start_frame || frame >= primary.start_frame + primary.length_frames) return null;
  const media=document.media?.find(media=>media.id===primary.media_id);
  return { project_epoch: document.project_epoch, if_generation: document.generation, timeline_id: timeline.id, revision: timeline.revision, frame, width: 960, clip: primary.id,
    selection_key:JSON.stringify([...selected].sort(compareId)),
    source_version:JSON.stringify([primary.kind,primary.media_id,media?.content_hash,media?.compound_timeline_id,media?.offline]),
  };
}
export function createScopes({ panel, getTarget, isPlaying=()=>false, now=()=>performance.now(), timers=globalThis }) {
  const image = panel.querySelector("img"), status = panel.querySelector("output"), empty = panel.querySelector("p");
  const guides=panel.querySelector('[data-scope-guides]'),stage=panel.querySelector('.scope-stage'),layoutNote=panel.querySelector('[data-scope-layout]'),windowRef=panel.ownerDocument?.defaultView ?? globalThis;
  const selects = panel.querySelectorAll("select"),context=panel.querySelector('[data-scope-context]'),button=panel.querySelector('button');
  let owner=null,sequence=0,timer=null,lastStart=-Infinity,blocked=false,destroyed=false,lastRead=null;
  const target=()=>{
    const target = !panel.hidden && getTarget();
    return target ? { ...target, first: selects[0].value, second: selects[1].value } : null;
  };
  const sameContext=(a,b)=>!!a && !!b && matchesScope(a,{...b,frame:a.frame});
  const viewer = createViewer({ image, status, empty, matches: matchesScope, endpoint: scopeURL, getState: () => {
    const current=target();
    return owner?.live && sameContext(owner.target,current)?{...current,frame:owner.target.frame}:current;
  }});
  function clearTimer(){if(timer!==null){timers.clearTimeout(timer);timer=null;}}
  function drawGuides(){
    if(!guides)return;
    const style=windowRef.getComputedStyle?.(panel),available=panel.clientWidth-(parseFloat(style?.paddingLeft) || 0)-(parseFloat(style?.paddingRight) || 0);
    if(stage && available>0){const single=available<528;stage.dataset.scopeSlots=single?'1':'2';image.alt=single?'Native isolated clip scope, first slot':'Native isolated clip scopes, left and right';if(selects[1].parentElement)selects[1].parentElement.hidden=single;if(layoutNote)layoutNote.hidden=!single;}
    guides.hidden=true;
    if(panel.hidden || image.hidden || !lastRead || !sameContext(lastRead,target()))return;
    const rect=(stage || image).getBoundingClientRect(),naturalWidth=image.naturalWidth,naturalHeight=image.naturalHeight;
    if(!rect.width || !rect.height || !naturalWidth || !naturalHeight)return;
    const ratio=windowRef.devicePixelRatio || 1,scale=Math.min(rect.width/naturalWidth,rect.height/naturalHeight),width=naturalWidth*scale,height=naturalHeight*scale;
    guides.width=Math.round(rect.width*ratio);guides.height=Math.round(rect.height*ratio);
    const ctx=guides.getContext('2d');ctx.scale(ratio,ratio);
    if(stage?.dataset.scopeSlots==='1')drawScopeGraticule(ctx,lastRead.first,{x:0,y:0,width:rect.width,height:rect.height});
    else for(const [slot,kind] of [lastRead.first,lastRead.second].entries())drawScopeGraticule(ctx,kind,{x:(rect.width-width)/2+slot*width/2,y:(rect.height-height)/2,width:width/2,height});
    guides.hidden=false;
  }
  function cancel(){sequence++;owner=null;lastRead=null;clearTimer();viewer.invalidate();if(guides)guides.hidden=true;}
  function noTarget(){cancel();context.textContent='';status.textContent='Select a video clip containing the playhead · scopes use the first selected video';}
  async function request(current,live){
    const pending={sequence:++sequence,target:current,live};owner=pending;if(live)lastStart=now();
    await viewer.seek();
    if(destroyed || owner!==pending || pending.sequence!==sequence)return;
    const actual=target(),shown=viewer.current();owner=null;
    if(!sameContext(current,actual))return;
    if(shown){
      lastRead=shown;
      drawGuides();
      context.textContent=`Clip ${shown.clip} · timeline frame ${shown.frame} · native isolated stack${live?` · playhead ${actual.frame}`:''}`;
      if(live)status.textContent=`LIVE · native frame ${shown.frame}`;
    }else if(live){
      blocked=true;clearTimer();status.textContent=`${status.textContent} · Live paused; press Refresh to retry`;
    }
    if(live && !blocked && isPlaying() && target()?.frame!==current.frame)schedule();
  }
  function schedule(){
    if(destroyed || panel.hidden || blocked || !isPlaying())return;
    const current=target();if(!current){noTarget();return;}
    if(owner){if(sameContext(owner.target,current))return;cancel();}
    if(lastRead && matchesScope(lastRead,current))return;
    clearTimer();
    const remaining=250-(now()-lastStart);
    if(remaining>0){timer=timers.setTimeout(()=>{timer=null;return schedule();},remaining);return;}
    return request(current,true);
  }
  function refresh(){
    if(destroyed || panel.hidden)return;
    blocked=false;lastRead=null;
    if(isPlaying())return schedule();
    const current=target();if(!current){noTarget();return;}
    cancel();return request(current,false);
  }
  function invalidate(message){cancel();if(message)status.textContent=message;}
  for (const select of selects) select.addEventListener("change",refresh);
  button.addEventListener("click",refresh);
  const observer=guides && windowRef.ResizeObserver?new windowRef.ResizeObserver(drawGuides):null;observer?.observe(panel);
  return {
    refresh,onPlaybackFrame:schedule,invalidate,
    setVisible(visible,{defer=false}={}){const hidden=panel.hidden;panel.hidden=!visible;if(visible){if(defer){cancel();status.textContent='READY · scopes follow Program playback';return;}if(hidden || !isPlaying())return refresh();return schedule();}else cancel();},
    destroy(){if(destroyed)return;destroyed=true;cancel();observer?.disconnect();viewer.destroy();for(const select of selects)select.removeEventListener('change',refresh);button.removeEventListener('click',refresh);},
  };
}
