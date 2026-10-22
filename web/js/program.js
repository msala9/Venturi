import { request } from "./api.js";

export function sameComposition(a, b) {
  return !!a && !!b && ["project_epoch", "if_generation", "timeline_id", "revision", "width", "audio_origin_frame"].every((key) => a[key] === b[key]);
}
export function containsProgramRange(cached, current) {
  return sameComposition(cached, current) && cached.start_frame <= current.start_frame && current.start_frame < cached.end_frame && current.end_frame <= cached.end_frame;
}
async function seekMedia(video, seconds, signal, beforeSeek = () => {}) {
  const wait = (event, ready) => {
    signal.throwIfAborted();
    if (ready()) return Promise.resolve();
    return new Promise((resolve,reject) => {
      const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener("error",failed);signal.removeEventListener("abort",aborted);};
      const done=()=>{if(!ready())return;cleanup();resolve();},failed=()=>{if(video.error===null)return;cleanup();reject(new Error("Program media failed to load or seek"));},aborted=()=>{cleanup();reject(signal.reason);};
      const timer=setTimeout(()=>{cleanup();reject(new Error("Program media load or seek timed out"));},10_000);
      video.addEventListener(event,done);video.addEventListener("error",failed);signal.addEventListener("abort",aborted,{once:true});
    });
  };
  await wait("loadedmetadata",()=>video.readyState>=1);
  signal.throwIfAborted();beforeSeek(seconds);video.currentTime=seconds;
  await wait("seeked",()=>!video.seeking);
}
export function createProgramPlayer({ video, status, cancel, getState, onFrame, onState, onError, onStop, onUserPause, onCache, beforeWindowChange = () => {}, isInternalSeek = () => false, isInternalPause = () => false, api = request, fetcher = fetch, timers = globalThis }) {
  let sequence = 0, controller = null, query = null, jobURL = null, state = "stopped", monitor = null, frameCallback = null, suspended = true, presented = 0, cached = null;
  let playbackIntent = false, attached = null, startingPlayback = false, seekingTarget = null, ignoredPauses=0, handoffPause=false;
  let recordingHold=null,recordingStopped=null;
  const currentState=expected=>getState(undefined,expected?.audio_origin_frame);
  const originMatches=(job,expected)=>expected.audio_origin_frame===undefined || job.program?.audio_origin_frame===expected.audio_origin_frame;
  const setState = (next) => { if(next!=="ready")stopMonitor(); state = next; cancel.disabled = next === "stopped"; cancel.textContent = next === "preparing" ? "Cancel preparation" : "Stop playback"; onState(next); };
  function stopMonitor() {
    const previous=monitor;monitor=null;
    if(previous){timers.clearTimeout(previous.timer);previous.controller.abort();}
  }
  const ownsAttachment=()=>state==='ready' && attached?.seq===sequence && attached.src===video.src && sameComposition(query,currentState(query));
  function clockFrame(seconds=video.currentTime){
    if(!query || !Number.isFinite(seconds) || seconds<0)return null;
    return Math.max(query.start_frame,Math.min(query.end_frame-1,query.start_frame+Math.floor((seconds+1e-6)*query.fps.num/query.fps.den)));
  }
  function telemetryTarget(){
    if(!ownsAttachment() || video.seeking || typeof attached.jobId!=='string' || !attached.jobId || !Number.isFinite(video.currentTime) || video.currentTime<0)return null;
    const start=Math.round(query.start_frame*48000*query.fps.den/query.fps.num),end=Math.round(query.end_frame*48000*query.fps.den/query.fps.num);
    const terminal=video.ended || video.currentTime>=(query.end_frame-query.start_frame)*query.fps.den/query.fps.num;
    const sample=terminal?end:Math.max(start,Math.min(end-1,start+Math.floor(video.currentTime*48000)));
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(sample) || end<=start)return null;
    const requestQuery=Object.fromEntries(['project_epoch','if_generation','timeline_id','revision','start_frame','end_frame','width','audio_origin_frame'].filter(key=>query[key]!==undefined).map(key=>[key,query[key]]));
    return {job_id:attached.jobId,query:requestQuery,sample,playing:!video.paused && !suspended && playbackIntent};
  }
  function recordingClock(){
    const live=value=>sameComposition(value,currentState(value));
    if(recordingHold && state==='preparing' && playbackIntent && live(query))return {...recordingHold,state:(video.playbackRate ?? 1)===1?'holding':'stopped',sequence};
    if(!ownsAttachment())return recordingStopped && live(query)?{...recordingStopped,sequence}:null;
    const position=telemetryTarget();if(!position)return null;
    const start=Math.round(query.start_frame*48000*query.fps.den/query.fps.num),end=Math.round(query.end_frame*48000*query.fps.den/query.fps.num);
    const atEnd=position.sample===end;
    const next=atEnd && playbackIntent?getState(query.end_frame,query.audio_origin_frame):null;
    const continuation=next && validRange(next) && sameComposition(query,next) && next.start_frame===query.end_frame;
    const speed=video.playbackRate ?? 1;
    const clockState=!playbackIntent || speed!==1 || atEnd && !continuation?'stopped':atEnd || video.paused || suspended?'holding':'playing';
    return {state:clockState,project_epoch:query.project_epoch,generation:query.if_generation,timeline_id:query.timeline_id,revision:query.revision,
      audio_origin_frame:query.audio_origin_frame ?? query.start_frame,window_start_sample:start,window_end_sample:end,sample:position.sample,sequence};
  }
  function pauseLocal({notify=false,reason='pause'}={}) {
    const recording=recordingClock();recordingStopped=recording?{...recording,state:'stopped'}:null;recordingHold=null;
    const frame=notify && playbackIntent && !suspended && ownsAttachment() && !video.seeking && !isInternalSeek()?clockFrame():null;
    const playback=notify && reason==='ended'?telemetryTarget():null;
    const owner=attached,pausedQuery=query,seq=sequence;
    const preparing=state==='preparing';
    playbackIntent = false;
    suspended = true;
    controller?.abort();
    if(preparing){
      sequence++;stopMonitor();attached=null;jobURL=null;seekingTarget=null;startingPlayback=false;
      setState('stopped');status.textContent='Program preparation paused · press Play to resume';
    }
    pauseMedia();
    if (frameCallback !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = null;
    if(frame!==null && attached===owner && query===pausedQuery && sequence===seq && ownsAttachment() && video.paused && typeof onUserPause==='function'){
      onUserPause({frame,query:pausedQuery,reason,playback,isCurrent:()=>attached===owner && query===pausedQuery && sequence===seq && ownsAttachment()});return true;
    }
    return false;
  }
  function pauseMedia(){if(video.paused)return;ignoredPauses++;video.pause();}
  function stop() {
    const path = state === "preparing" ? jobURL : null;
    sequence++;
    stopMonitor();
    pauseLocal();
    query = null;
    attached = null;
    presented = 0;
    jobURL = null;
    video.removeAttribute("src"); video.load();
    setState("stopped");
    if (path) fetcher(path, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
  function present(seconds = video.currentTime) {
    if (suspended || !query || !sameComposition(query, currentState(query))) return;
    const frame=clockFrame(seconds);if(frame!==null)onFrame(frame);
  }
  function scheduleFrame() {
    if (suspended || state!=="ready" || !attached || !video.requestVideoFrameCallback || video.paused || frameCallback !== null) return;
    const owner=attached;
    const handle=video.requestVideoFrameCallback((_, metadata) => {
      if(attached!==owner || frameCallback!==handle)return;
      frameCallback=null;if(suspended)return;
      presented=metadata.presentedFrames;present(metadata.mediaTime);scheduleFrame();
    });
    frameCallback=handle;
  }
  function metrics() {
    if (!video.dataset) return;
    const quality = video.getVideoPlaybackQuality?.();
    video.dataset.playbackMetrics = JSON.stringify({ presented_frames: presented, total_frames: quality?.totalVideoFrames ?? null, dropped_frames: quality?.droppedVideoFrames ?? null, media_time: video.currentTime, duration: video.duration, frame_callback: !!video.requestVideoFrameCallback });
  }
  function monitorDocument(seq) {
    stopMonitor();
    const owner={controller:new AbortController(),timer:null,url:jobURL,query,src:video.src};monitor=owner;
    const active=()=>monitor===owner && seq===sequence && state==="ready" && query===owner.query && jobURL===owner.url && !!owner.src && video.src===owner.src;
    const fail=message=>{cached=null;pauseLocal();status.textContent=message;setState("failed");};
    const check=async()=>{
      owner.timer=null;
      if(!active()){if(monitor===owner)stopMonitor();return;}
      if(!sameComposition(owner.query,currentState(owner.query))){fail("STALE_REVISION · reconnect before playback");return;}
      try {
        const response=await fetcher(owner.url,{signal:AbortSignal.any([owner.controller.signal,AbortSignal.timeout(5_000)]),cache:"no-store"});
        if(!active())return;
        if(!sameComposition(owner.query,currentState(owner.query)) || !response.ok){fail("STALE_REVISION · reconnect before playback");return;}
        const job=await response.json();
        if(!active())return;
        if(!sameComposition(owner.query,currentState(owner.query)) || job.state!=="ready" || !originMatches(job,owner.query)){fail("Program media unavailable or changed · prepare again");return;}
      } catch { if(active())fail("Playback connection lost · reconnect"); }
      finally { if(active())owner.timer=timers.setTimeout(check,2_000);else if(monitor===owner)stopMonitor(); }
    };
    owner.timer=timers.setTimeout(check,2_000);
  }
  video.addEventListener("timeupdate", () => {present();metrics();});
  video.addEventListener("play", () => {
    if(video.paused || state!=="ready" || !attached || attached.seq!==sequence || attached.src!==video.src || !sameComposition(query,currentState(query)))return;
    startingPlayback=true;const owner=attached;
    queueMicrotask(()=>{if(attached===owner)startingPlayback=false;});
    playbackIntent=true;suspended=false;scheduleFrame();
  });
  video.addEventListener("pause", event => {
    const ownPause=ignoredPauses>0;if(ownPause)ignoredPauses--;
    const internal=ownPause || isInternalPause(event);
    if(video.paused===false)return;
    if (frameCallback !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = null;
    // A movie naturally pauses before its ended event. Fast transport pauses
    // inside play(), but the browser can deliver that owned pause event later.
    const atEnd=video.ended || (Number.isFinite(video.duration) && video.duration>0 && video.currentTime>=video.duration-1e-6);
    if(!internal && !handoffPause && state==='preparing')pauseLocal();
    else if(!internal && !handoffPause && state==="ready" && !startingPlayback && !atEnd)pauseLocal({notify:true});
    metrics();
  });
  video.addEventListener("seeking",()=>{
    if(video.seeking===false)return;
    if(isInternalSeek())return;
    if(seekingTarget!==null && Math.abs(video.currentTime-seekingTarget)<1e-6)return;
    if(state==="ready" || state==="preparing")pauseLocal();
  });
  video.addEventListener("ended",()=>{
    metrics();
    const previous=attached;
    if(!video.ended || !playbackIntent || state!=="ready" || !previous || previous.seq!==sequence || previous.src!==video.src)return;
    if(!sameComposition(query,currentState(query))){fail("STALE_REVISION · reconnect before playback");return;}
    present();
    const next=getState(query.end_frame,query.audio_origin_frame);
    if(!next){status.textContent="End of timeline";pauseLocal({notify:true,reason:'ended'});return;}
    if(!sameComposition(query,next) || next.start_frame!==query.end_frame || !validRange(next)){
      fail("Program window changed · prepare again");return;
    }
    // Preparing synchronously detaches the ended owner, including duplicate events.
    void prepare(next,true);
  });
  video.addEventListener("error", () => {
    if (video.error!==null && video.getAttribute("src")) { cached=null;pauseLocal();status.textContent = "Program media unavailable or changed · prepare again"; setState("failed"); }
  });
  cancel.addEventListener("click", () => {if(!pauseLocal({notify:true,reason:'stop'})){stop();onStop?.();}});
  function fail(message) {
    cached=null;pauseLocal();status.textContent=message;setState("failed");onError?.(message);
  }
  function validRange(value) {
    return Number.isSafeInteger(value?.start_frame) && Number.isSafeInteger(value?.end_frame) && value.start_frame>=0 && value.end_frame>value.start_frame && (value.audio_origin_frame===undefined || Number.isSafeInteger(value.audio_origin_frame) && value.audio_origin_frame>=0 && value.audio_origin_frame<=value.start_frame);
  }
  function live(owner) {
    if(owner.seq!==sequence || owner.signal.aborted || !playbackIntent)return false;
    if(!sameComposition(owner.current,currentState(owner.current))){fail("STALE_REVISION · reconnect before playback");return false;}
    return true;
  }
  async function attach(owner, range, url, src, message, rollover, jobId) {
    if(!validRange(range) || range.start_frame>owner.current.start_frame || range.end_frame<owner.current.end_frame || !Number.isSafeInteger(range.fps?.num) || range.fps.num<=0 || !Number.isSafeInteger(range.fps?.den) || range.fps.den<=0)throw new Error("Invalid composed preview range");
    // Stop the old fast-audio tail before changing the movie. Internal pauses in
    // this hook cannot revoke the intent that owns this preparation.
    if(rollover){
      let handoff;handoffPause=true;
      try{handoff=beforeWindowChange();}finally{handoffPause=false;}
      await handoff;
    }
    if(!live(owner))return;
    query=range;jobURL=url;video.src=src;
    try {
      await seekMedia(video,(owner.current.start_frame-range.start_frame)*range.fps.den/range.fps.num,owner.signal,value=>{seekingTarget=value;});
    } finally { if(owner.seq===sequence)seekingTarget=null; }
    if(!live(owner))return;
    attached={seq:owner.seq,src:video.src,jobId};
    cached={query,url:jobURL,src:video.src,jobId};
    recordingHold=null;recordingStopped=null;
    setState("ready");
    if(!live(owner) || !ownsAttachment())return;
    status.textContent=message;monitorDocument(owner.seq);suspended=false;
    if(rollover)present();
    startingPlayback=true;
    queueMicrotask(()=>{if(owner.seq===sequence)startingPlayback=false;});
    try { await video.play(); }
    catch(error) { if(live(owner) && error.name!=="AbortError"){playbackIntent=false;suspended=true;status.textContent+=" · press Play";onState(state);} }
    finally { if(owner.seq===sequence)startingPlayback=false; }
  }
  async function toggle() {
    if (state === "preparing") { stop(); return; }
    if (state === "ready" && !video.paused && sameComposition(query, currentState(query))) { pauseLocal({notify:true}); return; }
    stop();
    const current = getState();
    if (!current) return;
    playbackIntent=true;
    await prepare(current,false);
  }
  async function prepare(current,rollover) {
    const recording=rollover?recordingClock():null;
    const seq = ++sequence;
    recordingHold=recording?.state==='holding'?{...recording,sequence:seq}:null;recordingStopped=null;
    stopMonitor();controller?.abort();attached=null;jobURL=null;suspended=true;startingPlayback=false;seekingTarget=null;
    controller = new AbortController();
    const signal = controller.signal;
    const owner={seq,signal,current};
    setState("preparing");pauseMedia();status.textContent = rollover ? "Paused · preparing next composition window…" : "Preparing native composition and audio…";
    try {
      if(!validRange(current))throw new Error("Invalid composed preview range");
      if (cached && containsProgramRange(cached.query, current)) {
        const response = await fetcher(cached.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]), cache: "no-store" });
        if (!live(owner)) return;
        const checked=response.ok?await response.json():null;
        if (checked?.state === "ready") {
          if(!originMatches(checked,current))throw new Error("Program audio origin changed · prepare again");
          if (!live(owner)) return;
          await attach(owner,cached.query,cached.url,cached.src,"CACHED COMPOSED PREVIEW · inputs verified",rollover,cached.jobId);
          return;
        }
        if (!response.ok && ![404,409].includes(response.status)) throw new Error("Cannot validate the cached composition");
      }
      cached = null;
      let job = await api("/preview/program/prepare", current);
      if (!live(owner)) return;
      if(!originMatches(job,current))throw new Error("Program audio origin changed · prepare again");
      const reused = job.state === "ready";
      const prepared = {...current, start_frame:job.program.start_frame, end_frame:job.program.end_frame};
      // Prepare can return a job shared by another player: obsolete ACKs only detach locally.
      jobURL = `/api/v1/preview/program/${encodeURIComponent(job.id)}?${new URLSearchParams(prepared)}`;
      while (job.state === "queued" || job.state === "running") {
        status.textContent = `Preparing composition · ${job.progress?.current_frame || 0}/${job.progress?.total_frames || "…"} frames`;
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!live(owner)) return;
        const response = await fetcher(jobURL, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
        if (!live(owner)) return;
        if (!response.ok) throw new Error("Composition changed or became unavailable");
        job = await response.json();
        if (!live(owner)) return;
        if(!originMatches(job,current))throw new Error("Program audio origin changed · prepare again");
      }
      if (job.state !== "ready") throw new Error(job.error === "PREVIEW_STORAGE_PRESSURE" ? "Preview stopped to preserve scratch disk space · free space before preparing again" : job.error === "GPU_BUSY" ? "GPU_BUSY · retry after the inference workload releases the GPU" : job.error === "RENDER_BUSY" ? "The CPU compositor is preparing another job · wait or cancel it" : (job.error || `Composition ${job.state}`));
      const range={...prepared,fps:job.program.fps};
      const src=`/api/v1/preview/program/${encodeURIComponent(job.id)}/program.mp4?${new URLSearchParams(prepared)}`;
      await attach(owner,range,jobURL,src,`${reused ? "CACHED " : ""}COMPOSED PREVIEW · ${job.program.width}×${job.program.height} · revision ${current.revision.slice(0,8)}`,rollover,job.id);
      if(!live(owner))return;
      onCache?.();
    } catch (error) {
      if (seq === sequence && !signal.aborted && error.name !== "AbortError") fail(error.message);
    }
  }
  return { toggle, stop, pauseLocal, telemetryTarget, recordingClock, state: () => state, range: () => query };
}
