const RATE=48000;
export function windowPayload(target,start,seconds,tempo,version) {
  if(!Number.isSafeInteger(start) || start<0)throw new Error("Audio position exceeds its safe range");
  const frame=Math.floor(start/RATE*(target.fps.num/target.fps.den));
  return {query:{...target.query,frame},window:{start_sample:start,end_sample:target.end,seconds,tempo,source_version:version}};
}
export function createFastTransport({videos,select,status,getTarget,getVideo,notice,onState=()=>{},fetcher=fetch,contextFactory=()=>new AudioContext(),frame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}) {
  let context=null,active=null,sequence=0;
  const routes=new Map(),blocked=new Map(),ignoredPauses=new WeakMap();
  const rate=()=>Number(select.value);
  function pauseInternal(video) {
    if(video.paused)return;
    ignoredPauses.set(video,(ignoredPauses.get(video) || 0)+1);video.pause();
  }
  function route(video) {
    context ??=contextFactory();
    if(!routes.has(video)) {
      const gain=context.createGain();gain.connect(context.destination);
      const media=context.createMediaElementSource(video);media.connect(gain);
      routes.set(video,{media,gain});
    }
    return routes.get(video);
  }
  function clear(pause=false) {
    sequence++;
    const old=active;active=null;
    if(old) {
      if(old.video.dataset)old.video.dataset.fastPlaybackMetrics=JSON.stringify({...JSON.parse(old.video.dataset.fastPlaybackMetrics || "{}"),tempo:old.tempo,windows:old.windows,max_drift_seconds:old.maxDrift,video_time:old.video.currentTime,stopped:true,stop_reason:old.reason || "replaced",audio_complete:old.last && (!old.sources.size || context.currentTime>=old.baseTime+(old.next-old.baseSample)/RATE/old.tempo)});
      old.controller.abort();clearTimeout(old.timer);cancelFrame(old.frame);
      for(const source of old.sources) {source.onended=null;source.stop();source.disconnect();}
      old.gain?.disconnect();
      if(pause)pauseInternal(old.video);
      onState("stopped");
    }
    for(const {gain} of routes.values())gain.gain.value=rate()===1?1:0;
  }
  function stop(reason="stopped") {if(active)active.reason=reason;clear(true);status.textContent="";}
  function ended(run) {
    if(run.last && run.sources.size) {
      run.draining=true;cancelFrame(run.frame);clearTimeout(run.timer);
      run.timer=setTimeout(()=>{if(current(run))fail(run,new Error("Audio output did not finish its queued tail · play to retry"));},250);return;
    }
    stop("ended");
  }
  function current(run) {return active===run && run.sequence===sequence && getTarget(run.video)?.identity===run.target.identity && rate()===run.tempo;}
  function fail(run,error) {
    if(!current(run))return;
    if(error.code==="SOURCE_CHANGED")blocked.set(run.video,run.target.identity);
    clear(true);status.textContent=error.message;notice?.(error.message);
  }
  function volume(run) {if(run.gain)run.gain.gain.value=run.video.muted?0:run.video.volume;}
  function clock(run) {
    if(!current(run)) {if(active===run)stop();return;}
    const elapsed=Math.max(0,context.currentTime-run.baseTime);
    const expected=Math.min(run.video.duration,(run.baseSample-run.target.origin)/RATE+elapsed*run.tempo);
    const drift=(run.video.currentTime-expected)/run.tempo;
    run.maxDrift=Math.max(run.maxDrift,Math.abs(drift));
    if(context.currentTime>=run.baseTime && !run.video.paused && Math.abs(drift)>.08 && !run.correcting) {
      run.correcting=true;run.video.currentTime=expected;
    }
    if(run.video.dataset)run.video.dataset.fastPlaybackMetrics=JSON.stringify({tempo:run.tempo,windows:run.windows,audio_time:elapsed,video_time:run.video.currentTime,drift_seconds:drift,max_drift_seconds:run.maxDrift,queued_buffers:run.sources.size});
    run.frame=frame(()=>clock(run));
  }
  async function prepare(run,start,seconds,first=false) {
    if(!current(run) || run.fetching)return;
    run.fetching=true;
    try {
      let response;
      for(let attempt=0;attempt<5;attempt++) {
        response=await fetcher(run.target.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(windowPayload(run.target,start,seconds,run.tempo,run.version)),signal:AbortSignal.any([run.controller.signal,AbortSignal.timeout(6000)]),cache:"no-store"});
        if(response.ok)break;
        const result=await response.json(),error=new Error(result.error?.message || "Native fast audio unavailable");error.code=result.error?.code;
        if(error.code!=="AUDIO_BUSY" || attempt===4)throw error;
        await new Promise((resolve,reject)=>{
          const aborted=()=>{clearTimeout(timer);reject(new DOMException("Canceled","AbortError"));};
          const timer=setTimeout(()=>{run.controller.signal.removeEventListener("abort",aborted);resolve();},80);
          run.controller.signal.addEventListener("abort",aborted,{once:true});
        });
      }
      if(!current(run)){if(active===run)stop();return;}
      const begin=Number(response.headers.get("x-audio-start-sample")),end=Number(response.headers.get("x-audio-end-sample")),tempo=Number(response.headers.get("x-audio-tempo")),version=response.headers.get("x-audio-source-version"),last=response.headers.get("x-audio-last")==="true";
      if(response.headers.get("x-audio-start-sample")===null || !["true","false"].includes(response.headers.get("x-audio-last")) || begin!==start || !Number.isSafeInteger(end) || end<=begin || end-begin>seconds*RATE || tempo!==run.tempo || !/^[0-9a-f]{64}$/.test(version || "") || (run.version && version!==run.version))throw new Error("Invalid or changed native audio window");
      if(Number.isSafeInteger(run.target.end) && (end>run.target.end || (last && end!==run.target.end)))throw new Error("Native audio exceeded the playback range");
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>800000)throw new Error("Audio window exceeded its budget");
      const buffer=await context.decodeAudioData(bytes);
      if(!current(run)){if(active===run)stop();return;}
      if(Math.abs(buffer.duration-(end-begin)/RATE/tempo)>.002)throw new Error("Native audio duration disagrees with its clock");
      run.version=version;run.next=end;run.last=last;run.seconds=Math.min(8,seconds*2);run.windows++;
      if(first){run.baseSample=begin;run.baseTime=context.currentTime+.05;}
      const when=run.baseTime+(begin-run.baseSample)/RATE/tempo;
      if(!first && when<context.currentTime+.005)throw new Error("Audio preparation fell behind · play to retry");
      const source=context.createBufferSource();source.buffer=buffer;source.connect(run.gain);run.sources.add(source);
      source.onended=()=>{run.sources.delete(source);source.disconnect();if(current(run)){if(run.last && !run.sources.size && (run.video.ended || run.draining))stop("ended");else extend(run);}};
      source.start(when);run.fetching=false;
      if(first) {
        status.textContent=`${tempo}× · native pitch-preserving audio`;
        run.frame=frame(()=>clock(run));
        run.timer=setTimeout(()=>{
          if(!current(run))return;
          run.starting=true;
          run.video.play().catch(error=>fail(run,error));
        },Math.max(0,(run.baseTime-context.currentTime)*1000));
      }
      extend(run);
    } catch(error) {if(error.name!=="AbortError")fail(run,error);}
  }
  function extend(run) {if(current(run) && !run.last && !run.fetching && run.sources.size<2)prepare(run,run.next,run.seconds);}
  async function start(video) {
    clear();
    const target=getTarget(video),tempo=rate();
    if(tempo===1){routes.get(video)?.gain.gain.setValueAtTime(1,context.currentTime);await context?.resume();return;}
    if(!target){video.pause();status.textContent="Prepare Source or Program playback first";return;}
    if(blocked.get(video)===target.identity){video.pause();status.textContent="Source changed · reopen the Source or prepare Program again";return;}
    if(target.audio===false){video.playbackRate=tempo;try{await video.play();}catch(error){status.textContent=error.message;}return;}
    let bridge;
    try {bridge=route(video);bridge.gain.gain.value=0;} catch(error){video.pause();status.textContent=error.message;return;}
    pauseInternal(video);
    const run={sequence,target,video,tempo,controller:new AbortController(),sources:new Set(),version:null,next:0,last:false,seconds:2,windows:0,maxDrift:0,fetching:false,starting:false,started:false,correcting:false,gain:context.createGain(),frame:null,timer:null};
    active=run;run.gain.connect(context.destination);volume(run);video.playbackRate=tempo;video.preservesPitch=true;
    status.textContent=`Preparing native ${tempo}× audio…`;
    onState("preparing");
    try {
      await context.resume();
      if(!current(run)){if(active===run)stop();return;}
      if(context.state!=="running")throw new Error("Audio output is suspended · press Play again");
      if(video.readyState<1)await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);video.removeEventListener("loadedmetadata",ready);video.removeEventListener("error",failed);run.controller.signal.removeEventListener("abort",aborted);};
        const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error("Video metadata unavailable"));},aborted=()=>{cleanup();reject(new DOMException("Canceled","AbortError"));};
        const timer=setTimeout(failed,5000);video.addEventListener("loadedmetadata",ready);video.addEventListener("error",failed);run.controller.signal.addEventListener("abort",aborted,{once:true});
      });
      if(!current(run)){if(active===run)stop();return;}
      const sample=target.origin+Math.round(video.currentTime*RATE);
      await prepare(run,sample,2,true);
    } catch(error){fail(run,error);}
  }
  function normal() {
    select.value="1";stop();
    for(const video of videos)video.playbackRate=1;
  }
  select.addEventListener("change",()=>{
    const video=getVideo(),playing=video && (!video.paused || active?.video===video);
    stop();
    if(![1,2,4,8].includes(rate())){normal();return;}
    if(video) {
      video.playbackRate=rate();
      if(playing) {if(rate()===1)video.play().catch(error=>notice?.(error.message));else start(video);}
    }
  });
  for(const video of videos) {
    video.addEventListener("play",()=>{
      if(active?.video===video && active.starting){active.starting=false;active.started=true;onState("playing");return;}
      if(rate()!==1)start(video);else context?.resume().catch(()=>{});
    });
    video.addEventListener("pause",()=>{
      const ignored=ignoredPauses.get(video) || 0;
      if(ignored){ignoredPauses.set(video,ignored-1);return;}
      if(active?.video===video){if(video.ended || (Number.isFinite(video.duration) && video.currentTime>=video.duration-.00001))ended(active);else stop("pause");}
    });
    video.addEventListener("seeking",()=>{
      if(active?.video!==video || active.correcting)return;
      const resume=!video.paused;stop();
      if(resume)status.textContent="Seek complete · press Play to resume fast audio";
    });
    video.addEventListener("seeked",()=>{if(active?.video===video)active.correcting=false;});
    video.addEventListener("ended",()=>{if(active?.video===video)ended(active);});
    for(const event of ["error","emptied"])video.addEventListener(event,()=>{if(active?.video===video)stop();});
    video.addEventListener("volumechange",()=>{if(active?.video===video)volume(active);});
    video.addEventListener("ratechange",()=>{if(active?.video===video && video.playbackRate!==active.tempo)stop();});
  }
  return {stop,normal,active:()=>!!active,cancelPreparation(){if(active && !active.started){stop();return true;}return false;}};
}
