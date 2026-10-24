import { request } from "./api.js";

export function sourceFrameAtTime(seconds, fps) {
  // Media clocks round requested seeks to microseconds.
  return Math.max(0, Math.floor((seconds + 1e-6) * fps));
}

export function sourceSelection(start, end, duration) {
  if (![start,end,duration].every(Number.isSafeInteger) || start < 0 || end <= start || end > duration) throw new Error("Source in/out must be integer frames inside the media; out is exclusive");
  return { source_in:start, source_out:end };
}

function nativeSource(item){
  const value=item?.native_asset;
  if(!value)return null;
  if(typeof value.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)
    || typeof value.revision!=='string' || !/^[a-f0-9]{64}$/.test(value.revision)
    || typeof value.if_generation!=='string' || !/^(0|[1-9][0-9]*)$/.test(value.if_generation)
    || typeof value.source_version!=='string' || !value.source_version || value.source_version.length>256)throw Error('Library Source identity is invalid; open its preview again');
  return value;
}
export function sourceMediaPath(item,suffix='',{absolute=true}={}){
  const native=nativeSource(item),base=native?`/native-assets/items/${encodeURIComponent(native.id)}/source`:`/media/${encodeURIComponent(typeof item==='string'?item:item.id)}`;
  return `${absolute?'/api/v1':''}${base}${suffix}`;
}
export function sourceMediaQuery(item,epoch){
  const native=nativeSource(item);
  return {project_epoch:epoch,...(native?{if_generation:native.if_generation,revision:native.revision,source_version:native.source_version}:{})};
}
export function sourceAssetURL(media, job, name, epoch) {
  return `${sourceMediaPath(media,`/jobs/${encodeURIComponent(job)}/${name}`)}?${new URLSearchParams(sourceMediaQuery(media,epoch))}`;
}
function delay(signal,setTimer,clearTimer) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimer(timer); reject(new DOMException("Canceled", "AbortError")); };
    const timer = setTimer(() => { signal.removeEventListener("abort", abort); resolve(); }, 300);
    signal.addEventListener("abort", abort, { once: true });
    if(signal.aborted)abort();
  });
}
export function createSourcePlayer({ video, image, status, cancel, onReady, onStateChange = () => {}, onUserPause = () => {}, windowed = false, canPrefetch = () => false, onPrefetch = () => {}, beforeWindowChange = () => {}, isInternalSeek = () => false, isInternalPause = () => false, api = request, fetcher = fetch, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let sequence=0,controller=null,jobPath=null,jobState=null,ready=false,binding=null,heartbeatTimer=null,heartbeatController=null,disposed=false;
  let preparing=false,playbackIntent=false,internalPause=false,ignoredPauses=0,startingPlayback=false,seekingTarget=null,pendingPath=null,windowContext=null;
  let stateContext=null,nativeSeeking=false,future=null;
  const internalPauseEvents=new WeakSet();
  function notify(state,reason=stateContext?.reason,frame=stateContext?.frame){
    const context=stateContext;
    if(!context || context.sequence!==sequence || disposed)return;
    stateContext={...context,state,reason,frame};
    onStateChange({...stateContext});
  }
  function beginState(item,epoch,frame,reason,audio={index:0,mode:'selected'}){
    stateContext={item,epoch,frame,sequence,reason,state:'preparing',audio_mode:audio.mode,audio_stream_index:audio.mode==='all'?null:audio.index};
    notify('preparing');
  }
  const sourceAsset=job=>job.source_asset ?? 'source.mp4';
  const sourcePath=(media,job,epoch)=>`${sourceMediaPath(media,`/jobs/${encodeURIComponent(job)}`)}?${new URLSearchParams(sourceMediaQuery(media,epoch))}`;
  const current=value=>!disposed && binding===value && value.sequence===sequence && value.path===jobPath && !value.signal.aborted;
  const attached=value=>current(value) && (value.element.getAttribute?.('src') ?? value.element.src)===value.url;
  function stopHeartbeat(){if(heartbeatTimer!==null)clearTimer(heartbeatTimer);heartbeatTimer=null;heartbeatController?.abort();heartbeatController=null;}
  function detach(message,state='error',reason=stateContext?.reason,retry=null){
    clearFuture();
    const previous=stateContext;
    stateContext=null;nativeSeeking=false;
    preparing=false;playbackIntent=false;pendingPath=null;windowContext=retry;seekingTarget=null;startingPlayback=false;
    sequence++;
    binding=null;stopHeartbeat();
    controller?.abort();
    controller=null;
    pauseVideo();
    video.removeAttribute("src");
    video.load();
    video.hidden = false;
    if (image) { image.hidden = true; image.removeAttribute("src"); }
    ready = false;
    cancel.disabled = true;
    jobPath=null;jobState=null;
    status.textContent=message;
    if(previous && !disposed)onStateChange({...previous,state,reason,...(state==='error'?{error:message}: {})});
  }
  const reset=()=>detach('Select media and open Source','canceled','reset');
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
      if(value.window && !sameWindow(value.window,job.source_window,value.audioSelection))throw Error('Source window changed; reopen Source');
      if(value.sourceVersion && job.source_version!==value.sourceVersion)throw Error('Source identity changed; reopen Source');
    }catch(error){
      if(attached(value) && !attempt.signal.aborted)detach(error.message?.includes('reopen Source')?error.message:'Source cache verification failed; reopen Source');
    }finally{
      if(heartbeatController===attempt)heartbeatController=null;
      if(attached(value))scheduleHeartbeat(value);
    }
  }
  async function openLegacy(item, epoch, quality = "medium",audioSelection={index:0,explicit:false,mode:'selected'},expectedVersion) {
    if(disposed)return;
    const resetSequence=sequence+1;
    reset();
    if(disposed || sequence!==resetSequence)return;
    const seq = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    preparing=true;
    status.textContent = `${item.name} · Preparing ${item.is_image ? "original image" : `${quality} source proxy`}`;
    try {
      beginState(item,epoch,0,'open',audioSelection);
      if(seq!==sequence || signal.aborted)return;
      const prepareFetch=(path,options={})=>fetcher(path,{...options,signal:AbortSignal.any([signal,options.signal].filter(Boolean))});
      let job = await api(sourceMediaPath(item,'/prepare',{absolute:false}), { ...sourceMediaQuery(item,epoch), quality,...audioPayload(item,audioSelection) },prepareFetch);
      // Prepare deduplicates jobs across clients: obsolete ACKs must never cancel a shared job.
      if (seq !== sequence) return;
      if(typeof job.id!=='string' || !job.id)throw Error('Source preparation returned an invalid job; reopen Source');
      const sourceVersion=job.source_version;
      if(sourceVersion!=null && (typeof sourceVersion!=='string' || !sourceVersion || sourceVersion.length>256))throw Error('Source identity is unavailable; reopen Source');
      if(expectedVersion!==undefined && sourceVersion!==expectedVersion)throw Error('Source identity changed; reopen Source');
      if(item.native_asset && sourceVersion!==item.native_asset.source_version)throw Error('Library Source identity changed; open its preview again');
      const id=job.id,asset=sourceAsset(job);
      if(!['source.mp4','source.png','source.jpg','source.webp'].includes(asset))throw Error('Source preparation returned an unsupported asset; reopen Source');
      const path=sourcePath(item,id,epoch);jobPath=path;jobState=job.state;
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
        if(sourceVersion!=null && job.source_version!==sourceVersion)throw Error('Source identity changed; reopen Source');
        jobState=job.state;
      }
      if (job.state !== "ready") throw new Error(`${job.error || `Source ${job.state}`} · reopen Source`);
      const still=asset!=='source.mp4';
      const url=sourceAssetURL(item,id,asset,epoch);
      if (still) {
        if (!image) throw new Error("Image viewer unavailable");
        image.src=url;
        image.alt = item.name; image.hidden = false; video.hidden = true;
      } else video.src=url;
      ready = !still;
      cancel.disabled = true;
      status.textContent = still ? `${item.name} · ORIGINAL STILL · embedded color profile and transparency preserved` : `${item.name} · SOURCE PROXY · ${quality} · ${audioSelection.mode==='all'?'all audio streams':audioSelection.explicit?`audio stream ${audioSelection.index} (zero-based)`:'first audio stream'}`;
      binding={sequence:seq,path:jobPath,signal,job:id,asset,epoch,url,element:still?image:video,item,quality,audioSelection,sourceVersion};preparing=false;scheduleHeartbeat(binding);
      const completed=binding;notify('ready');
      if(current(completed))onReady?.({ item, epoch, job:id,audio_mode:audioSelection.mode,audio_stream_index:audioSelection.mode==='all'?null:audioSelection.index });
    } catch (error) {
      if(seq===sequence && !signal.aborted)detach(error.message?.includes('reopen Source')?error.message:`${error.message} · reopen Source`);
    }
  }
  const validFPS=fps=>Number.isSafeInteger(fps?.num) && fps.num>0 && Number.isSafeInteger(fps?.den) && fps.den>0;
  function selectedAudio(item,options){
    const explicit=options?.audioStreamIndex!==undefined,index=explicit?options.audioStreamIndex:0,count=item.audio_stream_count,mode=options?.audioMode===undefined?'selected':options.audioMode;
    if(!['selected','all'].includes(mode) || mode==='all' && index!==0)throw Error('Choose selected or all Source audio streams; all streams cannot have a nonzero stream index');
    if(!Number.isSafeInteger(index) || index<0 || index>0xffffffff || (index>0 && (item.is_image || item.has_audio===false || !Number.isSafeInteger(count) || count<=index)))throw Error('Choose an available native Source audio stream index (zero-based)');
    return {index,explicit:explicit && !item.is_image,mode:item.is_image?'selected':mode,explicitMode:options?.audioMode!==undefined && !item.is_image};
  }
  const audioPayload=(item,audio)=>item.is_image?{}:{...(audio.explicitMode?{audio_mode:audio.mode}:{}),...(audio.explicit?{audio_stream_index:audio.index}:{})};
  const descriptorMode=value=>value?.audio_mode===undefined?'selected':value.audio_mode;
  const descriptorAudio=(value,audio)=>value?.audio_stream_index===undefined && !audio.explicit && audio.mode!=='all'?0:value?.audio_stream_index;
  const sameWindow=(a,b,audio)=>!!a && !!b && ['start_frame','end_frame','total_frames','source_version'].every(key=>a[key]===b[key]) && a.fps.num===b.fps?.num && a.fps.den===b.fps?.den && descriptorMode(b)===a.audio_mode && a.audio_stream_index===descriptorAudio(b,audio);
  function requestedWindow(item,start){
    if(!validFPS(item.fps) || !Number.isSafeInteger(item.duration_frames) || item.duration_frames<=0 || !Number.isSafeInteger(start) || start<0 || start>=item.duration_frames)throw Error('Source frame must be inside the media');
    const span=Number(60n*BigInt(item.fps.num)/BigInt(item.fps.den));
    if(!Number.isSafeInteger(span) || span<1)throw Error('Source frame rate cannot form a bounded window');
    return {start_frame:start,end_frame:start+Math.min(span,item.duration_frames-start)};
  }
  function checkedWindow(value,item,requested,version,audio){
    if(!value || !validFPS(value.fps) || value.fps.num!==item.fps.num || value.fps.den!==item.fps.den || value.total_frames!==item.duration_frames || !Number.isSafeInteger(value.start_frame) || !Number.isSafeInteger(value.end_frame) || value.start_frame<0 || value.start_frame>requested.start_frame || value.end_frame<requested.end_frame || value.end_frame>value.total_frames || value.end_frame<=value.start_frame || BigInt(value.end_frame-value.start_frame)*BigInt(value.fps.den)>60n*BigInt(value.fps.num) || typeof value.source_version!=='string' || !value.source_version.length || value.source_version.length>256 || (version!==undefined && value.source_version!==version))throw Error('Source window metadata changed or is invalid; reopen Source');
    if(descriptorMode(value)!==audio.mode || descriptorAudio(value,audio)!==(audio.mode==='all'?null:audio.index))throw Error('Source audio stream changed or is invalid; reopen Source');
    return {...value,audio_mode:audio.mode,audio_stream_index:audio.mode==='all'?null:audio.index,fps:{...value.fps}};
  }
  const prefetchState=()=>future?{state:future.state,jobId:future.id,range:structuredClone(future.range ?? future.request),error:future.error}:{state:'idle',jobId:null,range:null,error:null};
  const announcePrefetch=()=>onPrefetch(prefetchState());
  function clearFuture(){
    const old=future;future=null;if(!old)return;
    old.controller.abort();if(old.timer!==null)clearTimer(old.timer);old.timer=null;announcePrefetch();
  }
  function futureCurrent(ticket){
    if(disposed || future!==ticket || ticket.controller.signal.aborted || !playbackIntent)return false;
    if(ticket.promoted)return ticket.owner===sequence && !controller?.signal.aborted;
    return canPrefetch() && binding===ticket.from && ready && !preparing && !nativeSeeking && attached(ticket.from) && ticket.from.verified;
  }
  function invalidatePrefetch(){if(future && !futureCurrent(future))clearFuture();}
  function checkFuture(ticket,job){
    if(typeof job?.id!=='string' || !job.id || ticket.id && job.id!==ticket.id || sourceAsset(job)!=='source.mp4' || job.project_epoch!=null && job.project_epoch!==ticket.from.epoch)throw Error('The next Source job changed');
    const range=checkedWindow(job.source_window,ticket.item,ticket.request,ticket.from.window.source_version,ticket.audioSelection);
    if(ticket.range && !sameWindow(ticket.range,range,ticket.audioSelection))throw Error('The next Source window changed');
    ticket.id=job.id;ticket.range=range;ticket.path=sourcePath(ticket.item,job.id,ticket.from.epoch);
    return job;
  }
  async function readFuture(ticket,signal=ticket.controller.signal){
    const response=await fetcher(ticket.path,{signal:AbortSignal.any([signal,AbortSignal.timeout(5_000)]),cache:'no-store'});
    if(!response.ok)throw Error('The next Source window is no longer available');
    return response.json();
  }
  function futureDelay(ticket){
    return new Promise((resolve,reject)=>{
      const signal=ticket.controller.signal,abort=()=>{if(ticket.timer!==null)clearTimer(ticket.timer);ticket.timer=null;reject(new DOMException('Next Source window canceled','AbortError'));};
      ticket.timer=setTimer(()=>{ticket.timer=null;signal.removeEventListener('abort',abort);resolve();},1_000);
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
  }
  function heartbeatFuture(ticket){
    if(!futureCurrent(ticket) || ticket.promoted || ticket.state!=='ready')return;
    ticket.timer=setTimer(async()=>{
      ticket.timer=null;if(!futureCurrent(ticket)){if(future===ticket)clearFuture();return;}
      try{
        const job=await readFuture(ticket);
        if(!futureCurrent(ticket) || ticket.promoted)return;
        checkFuture(ticket,job);if(job.state!=='ready')throw Error(job.error || 'The next Source window is no longer ready');
        ticket.job=job;heartbeatFuture(ticket);
      }catch(error){if(futureCurrent(ticket) && !ticket.promoted){ticket.state='failed';ticket.error=String(error.message).slice(0,1024);ticket.job=null;announcePrefetch();}}
    },10_000);
  }
  async function prepareFuture(ticket){
    try{
      let job=await api(sourceMediaPath(ticket.item,'/prepare',{absolute:false}),{...sourceMediaQuery(ticket.item,ticket.from.epoch),quality:ticket.from.quality,window:ticket.request,...audioPayload(ticket.item,ticket.audioSelection)},(url,options={})=>fetcher(url,{...options,signal:AbortSignal.any([ticket.controller.signal,options.signal].filter(Boolean))}));
      if(!futureCurrent(ticket))return null;
      checkFuture(ticket,job);
      while(['queued','running'].includes(job.state)){
        ticket.state=job.state;announcePrefetch();await futureDelay(ticket);if(!futureCurrent(ticket))return null;
        job=await readFuture(ticket);if(!futureCurrent(ticket))return null;checkFuture(ticket,job);
      }
      if(job.state!=='ready')throw Error(job.error || `Next Source window ${job.state}`);
      ticket.job=job;ticket.state='ready';announcePrefetch();heartbeatFuture(ticket);return job;
    }catch(error){if(futureCurrent(ticket)){ticket.state='failed';ticket.error=String(error.message).slice(0,1024);announcePrefetch();}return null;}
  }
  function startPrefetch(){
    invalidatePrefetch();
    const value=binding;
    if(future || !windowed || !canPrefetch() || !playbackIntent || video.paused || !ready || preparing || nativeSeeking || !value?.window || !value.verified || !attached(value) || value.window.end_frame===value.window.total_frames)return;
    const ticket={from:value,item:structuredClone(value.item),audioSelection:{...value.audioSelection},request:requestedWindow(value.item,value.window.end_frame),controller:new AbortController(),timer:null,state:'preparing',id:null,path:null,error:null,range:null,job:null,promoted:false,owner:null};
    future=ticket;ticket.promise=prepareFuture(ticket);announcePrefetch();
  }
  function pauseVideo(){if(video.paused===false)ignoredPauses++;internalPause=true;try{video.pause();}finally{internalPause=false;}}
  function hold(){playbackIntent=false;clearFuture();pauseVideo();}
  function reportUserPause(reason){
    const owner=binding,seq=sequence;
    const isCurrent=()=>!disposed && binding===owner && seq===sequence && ready && !preparing && !nativeSeeking && !!owner?.window && owner.verified && attached(owner) && video.paused && !playbackIntent;
    if(isCurrent())onUserPause({reason,epoch:owner.epoch,media_id:owner.item.id,source_version:owner.window.source_version,isCurrent});
  }
  function pause(reason='pause'){
    const user=reason==='user' && playbackIntent;
    playbackIntent=false;clearFuture();
    if(windowed && (preparing || nativeSeeking)){
      const previous=stateContext;stateContext=null;nativeSeeking=false;
      sequence++;controller?.abort();stopHeartbeat();preparing=false;ready=false;binding=null;pendingPath=null;seekingTarget=null;startingPlayback=false;cancel.disabled=true;
      status.textContent='Source paused · press Play to prepare again';
      pauseVideo();
      if(previous && !disposed)onStateChange({...previous,state:'canceled',reason});
      return;
    }
    pauseVideo();
    if(user)reportUserPause('pause');
  }
  function localFrame(value){
    if(!Number.isFinite(video.currentTime) || video.currentTime<0)return null;
    if(video.ended)return value.window.end_frame-1;
    const frame=sourceFrameAtTime(video.currentTime,value.window.fps.num/value.window.fps.den),length=value.window.end_frame-value.window.start_frame;
    return frame<=length ? value.window.start_frame+Math.min(frame,length-1) : null;
  }
  function currentWindow(){
    const value=binding;
    if(!ready || !value?.window || !value.verified || !attached(value) || (video.seeking && !isInternalSeek()))return null;
    const frame=localFrame(value);if(frame===null)return null;
    return {epoch:value.epoch,media_id:value.item.id,job:value.job,fps:{...value.window.fps},start_frame:value.window.start_frame,end_frame:value.window.end_frame,frame,source_version:value.window.source_version,audio_mode:value.window.audio_mode,audio_stream_index:value.window.audio_stream_index};
  }
  function verifiedSource(){
    const value=binding;
    if(preparing || nativeSeeking || !value || !attached(value))return null;
    const clock=value.window?currentWindow():null;
    if(value.window && !clock)return null;
    if(!value.window && (value.element===image ? !image.complete || !(image.naturalWidth>0) : video.readyState<1 || video.seeking))return null;
    const version=clock?.source_version ?? value.sourceVersion;
    if(typeof version!=='string' || !version)return null;
    return {epoch:value.epoch,media_id:value.item.id,job:value.job,source_version:version};
  }
  async function seekMedia(seconds,signal){
    const wait=(event,complete)=>{
      signal.throwIfAborted();if(complete())return Promise.resolve();
      return new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimer(timer);video.removeEventListener(event,done);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);};
        const done=()=>{if(!complete())return;cleanup();resolve();},failed=()=>{if(video.error===null)return;cleanup();reject(Error('Source media load or seek failed'));},aborted=()=>{cleanup();reject(signal.reason);};
        const timer=setTimer(()=>{cleanup();reject(Error('Source media load or seek timed out'));},10_000);
        video.addEventListener(event,done);video.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});
      });
    };
    await wait('loadedmetadata',()=>video.readyState>=1);signal.throwIfAborted();seekingTarget=seconds;video.currentTime=seconds;
    await wait('seeked',()=>!video.seeking);
  }
  async function play(value){
    if(!attached(value) || !ready || !value.verified || !playbackIntent)return;
    startingPlayback=true;queueMicrotask(()=>{if(binding===value)startingPlayback=false;});
    try{await video.play();if(attached(value))startPrefetch();}catch(error){if(attached(value) && error.name!=='AbortError'){playbackIntent=false;clearFuture();status.textContent+=' · press Play';}}
  }
  async function prepareWindow(item,epoch,quality,startFrame,{continuation=false,autoplay=false,version,audioSelection={index:0,explicit:false,mode:'selected'},reason=continuation?'window':'open',candidate=null}={}){
    if(disposed)return;
    let requested;
    try{requested=requestedWindow(item,startFrame);}catch(error){status.textContent=error.message;return;}
    const previous=binding;
    if(!continuation){const resetSequence=sequence+1;reset();if(sequence!==resetSequence)return;}
    if(disposed)return;
    const seq=++sequence;controller?.abort();stopHeartbeat();controller=new AbortController();const signal=controller.signal;
    if(candidate){candidate.promoted=true;candidate.owner=seq;if(candidate.timer!==null && candidate.state==='ready'){clearTimer(candidate.timer);candidate.timer=null;}}
    else clearFuture();
    if(continuation && previous){binding={...previous,sequence:seq,signal};jobPath=previous.path;}
    preparing=true;playbackIntent=autoplay;pendingPath=null;seekingTarget=null;startingPlayback=false;cancel.disabled=false;
    windowContext={item,epoch,quality,startFrame,version,audioSelection};
    const active=()=>!disposed && seq===sequence && !signal.aborted;
    try{
      beginState(item,epoch,startFrame,reason,audioSelection);
      if(!active())return;
      pauseVideo();status.textContent=continuation?`${item.name} · Paused · preparing next Source window…`:`${item.name} · Preparing ${quality} Source window…`;
      const prepareFetch=(path,options={})=>fetcher(path,{...options,signal:AbortSignal.any([signal,options.signal].filter(Boolean))});
      let job;
      if(candidate){
        job=await candidate.promise;if(!active())return;
        if(!job || candidate.state!=='ready')throw Error(candidate.error || 'The next Source window is unavailable; press Play to retry');
        job=await readFuture(candidate,signal);if(!active())return;checkFuture(candidate,job);
        if(job.state!=='ready')throw Error(job.error || 'The next Source window is no longer ready');
      }else job=await api(sourceMediaPath(item,'/prepare',{absolute:false}),{...sourceMediaQuery(item,epoch),quality,window:requested,...audioPayload(item,audioSelection)},prepareFetch);
      if(!active())return;
      if(typeof job.id!=='string' || !job.id || sourceAsset(job)!=='source.mp4')throw Error('Source preparation returned an invalid window job');
      const id=job.id,path=sourcePath(item,id,epoch);pendingPath=path;jobState=job.state;
      while(['queued','running'].includes(job.state)){
        status.textContent=`${item.name} · ${job.state} · Source window`;
        await delay(signal,setTimer,clearTimer);if(!active())return;
        const response=await fetcher(path,{signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)]),cache:'no-store'});
        if(!active())return;if(!response.ok)throw Error('Source window is no longer available');
        job=await response.json();if(!active())return;
        if(job.id!==id || sourceAsset(job)!=='source.mp4')throw Error('Source preparation changed');jobState=job.state;
      }
      if(job.state!=='ready')throw Error(job.error || `Source ${job.state}`);
      if(job.project_epoch!=null && job.project_epoch!==epoch)throw Error('Source epoch changed');
      const range=checkedWindow(job.source_window,item,requested,version,audioSelection);
      if(continuation)await beforeWindowChange();
      if(!active())return;
      if(candidate)clearFuture();
      const url=sourceAssetURL(item,id,'source.mp4',epoch);ready=false;jobPath=path;video.src=url;
      if(image){image.hidden=true;image.removeAttribute('src');}video.hidden=false;
      binding={sequence:seq,path,signal,job:id,asset:'source.mp4',epoch,url,element:video,item,quality,window:range,verified:false,audioSelection};
      await seekMedia((startFrame-range.start_frame)*range.fps.den/range.fps.num,signal);
      if(!active() || !attached(binding))return;
      if(localFrame(binding)!==startFrame)throw Error('Source seek did not reach the requested absolute frame');
      binding.verified=true;ready=true;preparing=false;pendingPath=null;seekingTarget=null;cancel.disabled=true;
      windowContext={item,epoch,quality,startFrame,version:range.source_version,audioSelection};
      status.textContent=`${item.name} · SOURCE WINDOW · ${range.start_frame}–${range.end_frame} / ${range.total_frames} frames · ${quality}${item.has_audio?audioSelection.mode==='all'?' · all audio streams':` · audio stream ${audioSelection.index} (zero-based)`:''}`;
      const completed=binding;scheduleHeartbeat(completed);notify('ready',stateContext?.reason,startFrame);
      if(!active() || binding!==completed)return;
      onReady?.({item,epoch,job:id,audio_mode:audioSelection.mode,audio_stream_index:audioSelection.mode==='all'?null:audioSelection.index,source_window:{...range,fps:{...range.fps}}});
      if(autoplay && active() && binding===completed)await play(completed);
    }catch(error){if(active() && error.name!=='AbortError'){const retry=windowContext;detach(`${error.message} · reopen Source`,'error',stateContext?.reason,retry);}}
  }
  async function open(item,epoch,quality='medium',startFrame=0,options){
    if(disposed)return;
    let audioSelection;try{audioSelection=selectedAudio(item,options);}catch(error){detach(error.message);return;}
    if(!windowed || item.is_image)return openLegacy(item,epoch,quality,audioSelection);
    return prepareWindow(item,epoch,quality,startFrame,{audioSelection,version:item.native_asset?.source_version});
  }
  // An owned preparation pause must not revoke the next queued seek's intent.
  const playing=()=>!!(playbackIntent && (video.playbackRate ?? 1)===1 && (preparing || nativeSeeking || ready && binding?.verified && attached(binding) && !video.paused && !video.ended));
  async function reopen(quality){
    const value=binding,context=value?{item:value.item,epoch:value.epoch,quality:value.quality,version:value.window?.source_version ?? value.sourceVersion,audioSelection:value.audioSelection}:windowContext;
    if(!context || disposed)return;
    const item=structuredClone(context.item),audioSelection={...context.audioSelection},frame=currentWindow()?.frame ?? stateContext?.frame ?? context.startFrame ?? 0,resume=playing();
    if(!windowed || item.is_image)return openLegacy(item,context.epoch,quality,audioSelection,context.version);
    return prepareWindow(item,context.epoch,quality,frame,{version:context.version,audioSelection,autoplay:resume,reason:'quality'});
  }
  async function seekFrame(frame,{retain=false,resume=false}={}){
    const value=binding,context=value?.window?{item:value.item,epoch:value.epoch,quality:value.quality,version:value.window.source_version,audioSelection:value.audioSelection}:windowContext;
    if(!windowed || !context || disposed)return;
    requestedWindow(context.item,frame);const autoplay=resume===true && playing();playbackIntent=autoplay;clearFuture();
    if(!value?.window || !attached(value) || frame<value.window.start_frame || frame>=value.window.end_frame)return prepareWindow(context.item,context.epoch,context.quality,frame,{version:context.version,audioSelection:context.audioSelection,autoplay,reason:'seek',continuation:retain===true && !!value?.window && attached(value)});
    const seq=++sequence;controller?.abort();stopHeartbeat();controller=new AbortController();const signal=controller.signal;
    binding={...value,sequence:seq,signal,verified:false};ready=false;preparing=true;nativeSeeking=false;seekingTarget=null;startingPlayback=false;
    try{
      beginState(context.item,context.epoch,frame,'seek',context.audioSelection);
      if(seq!==sequence || signal.aborted)return;
      pauseVideo();
      await seekMedia((frame-value.window.start_frame)*value.window.fps.den/value.window.fps.num,signal);
      if(seq!==sequence || signal.aborted || !attached(binding))return;
      if(localFrame(binding)!==frame)throw Error('Source seek did not reach the requested absolute frame');
      binding.verified=true;ready=true;preparing=false;seekingTarget=null;windowContext={...context,startFrame:frame};const completed=binding;scheduleHeartbeat(completed);notify('ready','seek',frame);
      if(autoplay && seq===sequence && binding===completed)await play(completed);
    }catch(error){if(seq===sequence && !signal.aborted){const retry=windowContext;detach(`${error.message} · reopen Source`,'error',stateContext?.reason,retry);}}
  }
  const cancelPreparation=async () => {
    const path=!windowed && ['queued','running'].includes(jobState)?pendingPath??jobPath:null;
    detach("Source preparation canceled","canceled","cancel");
    if (path) await fetcher(path, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
  };
  const videoError=() => {
    if(video.error===null)return;
    if(binding?.element===video && attached(binding))detach('Browser could not decode this proxy; reopen Source or choose another quality');
  };
  const imageError=()=>{if(image?.complete===false || image?.naturalWidth>0 || (image?.currentSrc && image.currentSrc!==image.src))return;if(binding?.element===image && attached(binding))detach('Browser could not load this original image; reopen Source');};
  const played=()=>{
    if(!windowed)return;
    if(preparing || nativeSeeking){if(!startingPlayback)pause();return;}
    if(!binding?.window)return;
    if(!currentWindow() || video.paused)return;
    playbackIntent=true;startingPlayback=true;const value=binding;queueMicrotask(()=>{if(binding===value)startingPlayback=false;});
    startPrefetch();
  };
  const paused=event=>{
    if(ignoredPauses>0){ignoredPauses--;internalPauseEvents.add(event);return;}
    if(internalPause || isInternalPause(event) || startingPlayback){internalPauseEvents.add(event);return;}
    if(!windowed || video.paused===false || video.ended)return;
    if(!binding?.window && !preparing)return;
    if(preparing || nativeSeeking)pause();else{const user=playbackIntent;playbackIntent=false;clearFuture();if(user && !video.seeking && !isInternalSeek())reportUserPause('pause');}
  };
  const seeking=()=>{
    if(!windowed || video.seeking===false || isInternalSeek() || (seekingTarget!==null && Math.abs(video.currentTime-seekingTarget)<1e-6))return;
    if(preparing){pause('native_seek');return;}
    if(!binding?.window)return;
    const resume=(nativeSeeking?playbackIntent:playing()) && (video.playbackRate ?? 1)===1,value=binding,frame=localFrame(value);
    playbackIntent=resume;clearFuture();controller?.abort();stopHeartbeat();controller=new AbortController();
    binding={...value,sequence:++sequence,signal:controller.signal,verified:false};ready=false;nativeSeeking=true;seekingTarget=null;startingPlayback=false;
    if(frame!==null && windowContext)windowContext={...windowContext,startFrame:frame};
    const owner=binding;beginState(value.item,value.epoch,frame,'native_seek',value.audioSelection);
    if(binding===owner && attached(owner) && nativeSeeking)pauseVideo();
  };
  const seeked=()=>{
    if(!preparing && binding?.window && attached(binding) && !video.seeking){
      const frame=localFrame(binding),resume=nativeSeeking && playbackIntent;
      if(frame===null || nativeSeeking && frame!==stateContext?.frame){if(nativeSeeking)detach('Source seek did not reach the requested absolute frame; reopen Source');return;}
      binding.verified=true;ready=true;nativeSeeking=false;const completed=binding;scheduleHeartbeat(completed);
      if(stateContext?.state==='preparing' && stateContext.reason==='native_seek')notify('ready','native_seek',frame);
      if(binding===completed && resume)void play(completed);
    }
  };
  const ended=()=>{
    const value=binding;
    if(!video.ended || !playbackIntent || preparing || !value?.window || !ready || !attached(value) || !value.verified)return;
    if(value.window.end_frame===value.window.total_frames){playbackIntent=false;clearFuture();status.textContent=`${value.item.name} · End of Source`;reportUserPause('ended');return;}
    invalidatePrefetch();const candidate=future?.from===value?future:null;
    void prepareWindow(value.item,value.epoch,value.quality,value.window.end_frame,{continuation:true,autoplay:true,version:value.window.source_version,audioSelection:value.audioSelection,candidate});
  };
  cancel.addEventListener('click',cancelPreparation);video.addEventListener('error',videoError);image?.addEventListener?.('error',imageError);
  const events=[['play',played],['pause',paused],['seeking',seeking],['seeked',seeked],['ended',ended],['timeupdate',startPrefetch],['ratechange',invalidatePrefetch]];
  for(const [name,callback] of events)video.addEventListener(name,callback);
  const playable=()=>ready && binding && attached(binding);
  return { open, reopen, playing, reset, stop:reset, pause, hold, prefetchState, invalidatePrefetch, internalPause:event=>internalPauseEvents.has(event), seekFrame, current:currentWindow, verifiedSource, preparing:()=>preparing || nativeSeeking,
    dispose(){if(disposed)return;disposed=true;reset();cancel.removeEventListener?.('click',cancelPreparation);video.removeEventListener?.('error',videoError);image?.removeEventListener?.('error',imageError);for(const [name,callback] of events)video.removeEventListener?.(name,callback);},
    async toggle() {
      if(windowed && (preparing || nativeSeeking)){pause();return;}
      if(windowed && binding?.window && playable()){
        if(video.paused){
          const position=currentWindow();
          if(position?.frame===binding.window.total_frames-1){
            const pending=seekFrame(0),owner=sequence;await pending;
            if(disposed || owner!==sequence || !playable() || currentWindow()?.frame!==0)return;
          }
          playbackIntent=true;await play(binding);
        }else pause('user');
        return;
      }
      if(windowed && windowContext && !preparing){const c=windowContext;return prepareWindow(c.item,c.epoch,c.quality,c.startFrame,{autoplay:true,version:c.version,audioSelection:c.audioSelection});}
      if(playable()){if(video.paused){try{await video.play();}catch(error){if(error.name!=="AbortError")throw error;}}else video.pause();}
    },
    step(delta, fps, totalFrames) {
      if(windowed){const value=currentWindow();if(!value || !Number.isSafeInteger(delta)){if(preparing || nativeSeeking)pause();return;}const frame=value.frame+delta;if(frame<0 || frame>=binding.window.total_frames){pause();return;}return seekFrame(frame);}
      if(playable()){video.pause();const frame=Math.max(0,Math.min(totalFrames-1,Math.round(video.currentTime*fps)+delta));video.currentTime=frame/fps;}
    },
  };
}
