import {request} from "./api.js";
import {sourceAssetURL} from "./source.js";

export function slipIdentity(target) {
  return target ? [target.project_epoch,target.if_generation,target.timeline_id,target.revision,target.clip_id].join(":") : null;
}
export function slipFrames(manifest, delta) {
  if(!Number.isSafeInteger(delta) || delta<manifest.window_start || delta>manifest.window_end)return null;
  return manifest.frames[delta-manifest.window_start] || null;
}
function wait(signal) {
  return new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException("Canceled","AbortError"));};const timer=setTimeout(()=>{signal.removeEventListener("abort",cancel);resolve();},300);signal.addEventListener("abort",cancel,{once:true});});
}
export async function boundedProxy(url,signal,fetcher=fetch) {
  const response=await fetcher(url,{signal,cache:"no-store"});
  if(!response.ok)throw new Error("Slip source proxy is no longer available");
  const limit=32*1024*1024;
  if(Number(response.headers.get("content-length"))>limit){await response.body?.cancel();throw new Error("Slip's local proxy exceeds 32 MiB; use numeric slip without the dual preview");}
  const reader=response.body.getReader(),parts=[];let bytes=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new Error("Slip's local proxy exceeds 32 MiB");}parts.push(value);}} finally{reader.releaseLock();}
  return new Blob(parts,{type:"video/mp4"});
}

export function createSlipView({root,getTarget,commit,notice,onVisible=()=>{},api=request,fetcher=fetch}) {
  const videos=[...root.querySelectorAll("video")],labels=[...root.querySelectorAll("[data-slip-label]")],status=root.querySelector("output"),input=root.querySelector("input"),apply=root.querySelector("[data-slip-apply]"),refresh=root.querySelector("[data-slip-refresh]"),close=root.querySelector("[data-slip-close]");
  let controller=null,sequence=0,manifest=null,target=null,delta=0,ready=false,previewReady=false,blobURL=null,blobIdentity=null;
  const current=()=>target && slipIdentity(target)===slipIdentity(getTarget(target.clip_id));
  function show(visible){if(root.hidden===!visible)return;root.hidden=!visible;root.parentElement.dataset.slipPreview=String(visible);onVisible(visible);}
  function paint() {
    input.value=delta;apply.disabled=!ready || !current() || manifest?.locked || delta===0;
    if(!manifest){status.textContent="Preparing native source handles…";return;}
    const frames=manifest && slipFrames(manifest,delta);
    if(!current()){status.textContent="STALE · reopen Slip after the project or selection changes";videos.forEach((video)=>{video.hidden=true;});return;}
    if(!frames){status.textContent="Draft outside cached native frame map · Refresh edges to inspect this range";videos.forEach((video)=>{video.hidden=true;});return;}
    labels.forEach((label,index)=>{label.textContent=`${index?"Last":"First"} source frame ${frames[index+1]}`;});
    if(!ready)return;
    if(!manifest.preview_available){status.textContent="Native slip handles ready · dual video preview is available for movie sources";return;}
    if(!previewReady){videos.forEach((video)=>{video.hidden=true;});return;}
    videos.forEach((video,index)=>{video.hidden=false;const time=frames[index+1]*manifest.fps.den/manifest.fps.num;if(video.readyState>=1 && Math.abs(video.currentTime-time)>1e-6)video.currentTime=time;});
    status.textContent=videos.some((video)=>video.seeking) ? "SEEKING · local source edges" : `DRAFT · ${delta>=0?"+":""}${delta} timeline frames · raw source edges · Apply commits one Undo`;
  }
  function reset(message="Slip closed") {
    sequence++;controller?.abort();controller=null;manifest=null;target=null;ready=false;previewReady=false;apply.disabled=true;videos.forEach((video)=>{video.pause();video.hidden=true;});labels.forEach((label)=>{label.textContent="Preparing source edge…";});show(false);status.textContent=message;
  }
  async function open(clip,center=0) {
    reset();target=getTarget(clip);if(!target)return notice("Select a writable source clip first");
    const wanted=target,identity=slipIdentity(wanted),seq=sequence;delta=center;input.value=center;show(true);controller=new AbortController();const signal=controller.signal;
    status.textContent="Reading native linked slip handles…";
    try {
      const {clip_id,...query}=wanted;
      const result=await api(`/timelines/${encodeURIComponent(wanted.timeline_id)}/clips/${encodeURIComponent(clip)}/slip/${center}?${new URLSearchParams(query)}`);
      if(seq!==sequence)return;
      if(identity!==slipIdentity(getTarget(clip))){status.textContent="STALE · reopen Slip after the project or selection changes";return;}
      if(result.project_epoch!==wanted.project_epoch || result.generation!==wanted.if_generation || result.revision!==wanted.revision || result.clip_id!==clip)throw new Error("Native slip manifest is obsolete");
      manifest=result;input.min=result.min_delta;input.max=result.max_delta;
      const sourceIdentity=[wanted.project_epoch,result.media_id,result.source_version].join(":");
      previewReady=sourceIdentity===blobIdentity;
      if(result.preview_available && sourceIdentity!==blobIdentity) {
        let job=await api(`/media/${encodeURIComponent(result.media_id)}/prepare`,{project_epoch:wanted.project_epoch,quality:"low"});
        const path=`/media/${encodeURIComponent(result.media_id)}/jobs/${encodeURIComponent(job.id)}?${new URLSearchParams({project_epoch:wanted.project_epoch})}`;
        while(["queued","running"].includes(job.state)) {status.textContent=`Preparing local Slip proxy · ${job.state} · ${job.frames} frames`;await wait(signal);job=await api(path);if(seq!==sequence)return;}
        if(job.state!=="ready")throw new Error(job.error || `Slip proxy ${job.state}`);
        status.textContent="Caching bounded local Slip proxy…";
        const blob=await boundedProxy(sourceAssetURL(result.media_id,job.id,"source.mp4",wanted.project_epoch),signal,fetcher);
        if(seq!==sequence || !current())return;
        if(blobURL)URL.revokeObjectURL(blobURL);blobURL=URL.createObjectURL(blob);blobIdentity=sourceIdentity;previewReady=true;
        videos.forEach((video)=>{video.src=blobURL;video.load();});
      }
      if(seq!==sequence || !current())return;
      ready=true;paint();
    }catch(error){if(seq===sequence && error.name!=="AbortError"){status.textContent=error.message;ready=!!manifest && current();apply.disabled=!ready || !delta || manifest.locked;videos.forEach((video)=>{video.hidden=true;});}}
  }
  videos.forEach((video)=>{video.addEventListener("loadedmetadata",paint);video.addEventListener("seeked",paint);video.addEventListener("error",()=>{if(!root.hidden)status.textContent="Slip proxy could not be decoded · native numeric slip remains available";});});
  input.addEventListener("input",()=>{const value=Number(input.value);if(Number.isSafeInteger(value) && manifest && value>=manifest.min_delta && value<=manifest.max_delta){delta=value;paint();}else{apply.disabled=true;status.textContent="Choose an integer delta inside the native linked source handles";}});
  refresh.addEventListener("click",()=>{if(target)open(target.clip_id,delta);});close.addEventListener("click",()=>reset());
  apply.addEventListener("click",async()=>{if(!ready || !current() || !delta || Number(input.value)!==delta || !input.reportValidity())return;apply.disabled=true;try{await commit({kind:"slip",clip_ids:manifest.clip_ids,delta_frames:delta});reset();}catch(error){notice(error.message);reset();}});
  return {open,reset,draft(event){if(event.phase==="begin")open(event.clip_id,event.delta);else if(event.phase==="draft"){delta=event.delta;paint();}else reset();},destroy(){reset();videos.forEach((video)=>{video.removeAttribute("src");video.load();});if(blobURL)URL.revokeObjectURL(blobURL);}};
}
