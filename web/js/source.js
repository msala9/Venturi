import { request } from "./api.js";

export function sourceFrameAtTime(seconds, fps) {
  // Media clocks round requested seeks to microseconds.
  return Math.max(0, Math.floor((seconds + 1e-6) * fps));
}

export function sourceSelection(start, end, duration) {
  if (![start,end,duration].every(Number.isSafeInteger) || start < 0 || end <= start || end > duration) throw new Error("Source in/out must be integer frames inside the media; out is exclusive");
  return { source_in:start, source_out:end };
}

export function sourceAssetURL(media, job, name, epoch) {
  return `/api/v1/media/${encodeURIComponent(media)}/jobs/${encodeURIComponent(job)}/${name}?${new URLSearchParams({ project_epoch: epoch })}`;
}
function delay(signal,setTimer,clearTimer) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimer(timer); reject(new DOMException("Canceled", "AbortError")); };
    const timer = setTimer(() => { signal.removeEventListener("abort", abort); resolve(); }, 300);
    signal.addEventListener("abort", abort, { once: true });
    if(signal.aborted)abort();
  });
}
export function createSourcePlayer({ video, image, status, cancel, onReady, api = request, fetcher = fetch, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let sequence=0,controller=null,jobPath=null,jobState=null,ready=false,binding=null,heartbeatTimer=null,heartbeatController=null,disposed=false;
  const sourceAsset=job=>job.source_asset ?? 'source.mp4';
  const sourcePath=(media,job,epoch)=>`/api/v1/media/${encodeURIComponent(media)}/jobs/${encodeURIComponent(job)}?${new URLSearchParams({project_epoch:epoch})}`;
  const current=value=>!disposed && binding===value && value.sequence===sequence && value.path===jobPath && !value.signal.aborted;
  const attached=value=>current(value) && (value.element.getAttribute?.('src') ?? value.element.src)===value.url;
  function stopHeartbeat(){if(heartbeatTimer!==null)clearTimer(heartbeatTimer);heartbeatTimer=null;heartbeatController?.abort();heartbeatController=null;}
  function detach(message){
    sequence++;
    binding=null;stopHeartbeat();
    controller?.abort();
    controller=null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = false;
    if (image) { image.hidden = true; image.removeAttribute("src"); }
    ready = false;
    cancel.disabled = true;
    jobPath=null;jobState=null;
    status.textContent=message;
  }
  const reset=()=>detach('Select media and open Source');
  function scheduleHeartbeat(value){
    if(!attached(value) || heartbeatTimer!==null || heartbeatController)return;
    heartbeatTimer=setTimer(()=>{heartbeatTimer=null;heartbeat(value);},10_000);
  }
  async function heartbeat(value){
    if(!attached(value))return;
    const attempt=new AbortController();heartbeatController=attempt;
    try{
      const response=await fetcher(value.path,{signal:AbortSignal.any([value.signal,attempt.signal,AbortSignal.timeout(20_000)]),cache:'no-store'});
      if(!attached(value))return;
      if(!response.ok)throw Error('Source cache is no longer available; reopen Source');
      const job=await response.json();
      if(!attached(value))return;
      if(job.state!=='ready' || job.id!==value.job || sourceAsset(job)!==value.asset || (job.project_epoch!=null && job.project_epoch!==value.epoch))throw Error('Source cache changed; reopen Source');
    }catch(error){
      if(attached(value) && !attempt.signal.aborted)detach(error.message?.includes('reopen Source')?error.message:'Source cache verification failed; reopen Source');
    }finally{
      if(heartbeatController===attempt)heartbeatController=null;
      if(attached(value))scheduleHeartbeat(value);
    }
  }
  async function open(item, epoch, quality = "medium") {
    if(disposed)return;
    reset();
    const seq = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    status.textContent = `${item.name} · Preparing ${item.is_image ? "original image" : `${quality} source proxy`}`;
    try {
      const prepareFetch=(path,options={})=>fetcher(path,{...options,signal:AbortSignal.any([signal,options.signal].filter(Boolean))});
      let job = await api(`/media/${encodeURIComponent(item.id)}/prepare`, { project_epoch: epoch, quality },prepareFetch);
      // Prepare deduplicates jobs across clients: obsolete ACKs must never cancel a shared job.
      if (seq !== sequence) return;
      if(typeof job.id!=='string' || !job.id)throw Error('Source preparation returned an invalid job; reopen Source');
      const id=job.id,asset=sourceAsset(job);
      if(!['source.mp4','source.png','source.jpg','source.webp'].includes(asset))throw Error('Source preparation returned an unsupported asset; reopen Source');
      const path=sourcePath(item.id,id,epoch);jobPath=path;jobState=job.state;
      cancel.disabled = false;
      while (job.state === "queued" || job.state === "running") {
        status.textContent = `${item.name} · ${job.state} · ${job.frames} frames`;
        await delay(signal,setTimer,clearTimer);
        if(seq!==sequence || signal.aborted)return;
        const response = await fetcher(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
        if(seq!==sequence)return;
        if (!response.ok) throw new Error("Source job is no longer available; reopen Source");
        job = await response.json();
        if (seq !== sequence) return;
        if(job.id!==id || sourceAsset(job)!==asset)throw Error('Source preparation changed; reopen Source');
        jobState=job.state;
      }
      if (job.state !== "ready") throw new Error(`${job.error || `Source ${job.state}`} · reopen Source`);
      const still=asset!=='source.mp4';
      const url=sourceAssetURL(item.id,id,asset,epoch);
      if (still) {
        if (!image) throw new Error("Image viewer unavailable");
        image.src=url;
        image.alt = item.name; image.hidden = false; video.hidden = true;
      } else video.src=url;
      ready = !still;
      cancel.disabled = true;
      status.textContent = still ? `${item.name} · ORIGINAL STILL · embedded color profile and transparency preserved` : `${item.name} · SOURCE PROXY · ${quality} · first audio stream`;
      binding={sequence:seq,path:jobPath,signal,job:id,asset,epoch,url,element:still?image:video};scheduleHeartbeat(binding);
      onReady?.({ item, epoch, job:id });
    } catch (error) {
      if(seq===sequence && !signal.aborted)detach(error.message?.includes('reopen Source')?error.message:`${error.message} · reopen Source`);
    }
  }
  const cancelPreparation=async () => {
    const path=['queued','running'].includes(jobState)?jobPath:null;
    reset();
    status.textContent = "Source preparation canceled";
    if (path) await fetcher(path, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
  };
  const videoError=() => {
    if(binding?.element===video && attached(binding))detach('Browser could not decode this proxy; reopen Source or choose another quality');
  };
  const imageError=()=>{if(binding?.element===image && attached(binding))detach('Browser could not load this original image; reopen Source');};
  cancel.addEventListener('click',cancelPreparation);video.addEventListener('error',videoError);image?.addEventListener?.('error',imageError);
  const playable=()=>ready && binding && attached(binding);
  return { open, reset, pause: () => video.pause(),
    dispose(){if(disposed)return;reset();disposed=true;cancel.removeEventListener?.('click',cancelPreparation);video.removeEventListener?.('error',videoError);image?.removeEventListener?.('error',imageError);},
    async toggle() { if (playable()) { if (video.paused) {try{await video.play();}catch(error){if(error.name!=="AbortError")throw error;}} else video.pause(); } },
    step(delta, fps, totalFrames) { if (playable()) { video.pause(); const frame = Math.max(0, Math.min(totalFrames - 1, Math.round(video.currentTime * fps) + delta)); video.currentTime = frame / fps; } },
  };
}
