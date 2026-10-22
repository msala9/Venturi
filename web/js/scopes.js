import { createViewer, matchesFrame } from "./viewer.js";

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
  function cancel(){sequence++;owner=null;lastRead=null;clearTimer();viewer.invalidate();}
  function noTarget(){cancel();context.textContent='';status.textContent='Select a video clip containing the playhead · scopes use the first selected video';}
  async function request(current,live){
    const pending={sequence:++sequence,target:current,live};owner=pending;if(live)lastStart=now();
    await viewer.seek();
    if(destroyed || owner!==pending || pending.sequence!==sequence)return;
    const actual=target(),shown=viewer.current();owner=null;
    if(!sameContext(current,actual))return;
    if(shown){
      lastRead=shown;
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
  return {
    refresh,onPlaybackFrame:schedule,invalidate,
    setVisible(visible,{defer=false}={}){const hidden=panel.hidden;panel.hidden=!visible;if(visible){if(defer){cancel();status.textContent='READY · scopes follow Program playback';return;}if(hidden || !isPlaying())return refresh();return schedule();}else cancel();},
    destroy(){if(destroyed)return;destroyed=true;cancel();viewer.destroy();for(const select of selects)select.removeEventListener('change',refresh);button.removeEventListener('click',refresh);},
  };
}
