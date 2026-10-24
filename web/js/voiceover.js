import {ApiFailure,request} from "./api.js";
import {captureWav,createCapture,microphoneInput} from "./capture.js";
import {CapturePeaks} from './capture-buffer.js';

export function voiceoverIdentity(target) {
  return target?JSON.stringify([target.project_epoch,target.generation,target.timeline_id,target.revision,[...target.tracks].sort()]):null;
}
export function voiceoverPlacement(id,target,start,latency,overwrite) {
  if(!target?.tracks.length || !Number.isSafeInteger(start) || start<0 || start>1_000_000_000 || !Number.isSafeInteger(latency) || Math.abs(latency)>240)throw new Error("Choose armed audio tracks, an integer start and latency correction");
  return {kind:"place_recording",placement:{recording_id:id,tracks:[...target.tracks],start_frame:start,latency_frames:latency,overwrite:!!overwrite}};
}
export function voiceoverPlaybackClock(clock,target){
  if(!clock || !target || !['playing','holding','stopped'].includes(clock.state) || ['project_epoch','generation','timeline_id','revision'].some(key=>typeof clock[key]!=='string' || !clock[key] || clock[key]!==target[key]))return null;
  if(['sample','window_start_sample','window_end_sample','audio_origin_frame','sequence'].some(key=>!Number.isSafeInteger(clock[key]) || clock[key]<0) || clock.window_end_sample<=clock.window_start_sample || clock.sample<clock.window_start_sample || clock.sample>clock.window_end_sample)return null;
  return clock;
}
export function createVoiceover({root,getTarget,getClientId,canCommit,commit,playback,notice,onProgress=()=>{},getInput=microphoneInput,captureFactory=createCapture,api=request,fetcher=fetch,confirmDiscard=(message)=>window.confirm(message)}) {
  const status=root.querySelector("output"),start=root.querySelector("[data-voice-start]"),stop=root.querySelector("[data-voice-stop]"),save=root.querySelector("[data-voice-save]"),apply=root.querySelector("[data-voice-apply]"),rebind=root.querySelector("[data-voice-rebind]"),close=root.querySelector("[data-voice-close]"),form=root.querySelector("form"),audio=root.querySelector("audio"),download=root.querySelector("[data-voice-download]"),backup=root.querySelector("[data-voice-backup]"),meter=root.querySelector("meter");
  let take=null,controller=null,sequence=0,phase="idle",stopping=false,preferredFormat=null;
  const discard=root.querySelector("[data-voice-discard]");
  function formats(target){
    const available=Array.isArray(target?.formats)?target.formats.filter(format=>typeof format?.id==='string' && format.id && typeof format.label==='string'):[];
    return available.length?available:[{id:'wav',label:'WAV'}];
  }
  function refreshFormat(target){
    const available=formats(target),choice=available.find(format=>format.id===preferredFormat) || available.find(format=>format.id==='wav') || available[0];
    form.elements.format.replaceChildren(...available.map(format=>new Option(format.label,format.id)));form.elements.format.value=choice.id;
  }
  form.elements.format.addEventListener('change',()=>{if(!form.elements.format.disabled && formats(getTarget()).some(format=>format.id===form.elements.format.value))preferredFormat=form.elements.format.value;});
  form.addEventListener("submit",(event)=>event.preventDefault());
  const current=()=>take && voiceoverIdentity(getTarget())===take.identity;
  function resetPreview(){audio.pause();audio.hidden=true;audio.removeAttribute("src");download.hidden=true;backup.hidden=true;meter.value=0;}
  function controls() {
    const active=["opening","preparing","waiting","recording","holding","stopping","saving"].includes(phase);
    start.disabled=active || !canCommit() || !getTarget()?.tracks.length || (!!take?.blob && !take.receipt);
    start.textContent=phase==="waiting"?"Start prepared playback and record":"Start recording";if(phase==="waiting")start.disabled=false;
    stop.disabled=!["opening","preparing","waiting","recording","holding"].includes(phase);save.disabled=active || !take?.blob || !canCommit();
    apply.disabled=active || !take?.receipt || !current() || !canCommit();rebind.disabled=active || !take?.blob || !canCommit() || !getTarget()?.tracks.length;
    discard.disabled=active || !take?.blob;
    for(const name of ["device","channels","format","playback","monitor"])form.elements[name].disabled=active;
    close.disabled=phase==="saving" || phase==="stopping";
  }
  async function upload() {
    if(!take?.blob || !canCommit() || phase==="saving")return;
    const captured=take,seq=sequence,target=getTarget();if(!target){status.textContent="Open a saved project to save this retained take";return;}
    phase="saving";controls();status.textContent="Saving the captured take with the native audio encoder…";
    const query=new URLSearchParams({project_epoch:target.project_epoch,client_id:getClientId(),sample_rate:captured.sampleRate,channels:captured.channels,format:captured.format});
    try {
      let receipt;
      try {
        const response=await fetcher(`/api/v1/recordings/${captured.id}?${query}`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:captured.blob,signal:AbortSignal.timeout(120000)});
        const result=await response.json();if(!response.ok)throw new ApiFailure(result.error?.message || "Could not save recording",result.error?.code,response.status);receipt=result;
      }catch(error){if(error instanceof ApiFailure)throw error;receipt=await api(`/recordings/${captured.id}`).catch(()=>{throw error;});}
      if(seq!==sequence || captured!==take)return;
      if(receipt.id!==captured.id || receipt.frames!==captured.frames || receipt.sample_rate!==captured.sampleRate || receipt.channels!==captured.channels || receipt.format!==captured.format)throw new Error("The saved take does not match the captured audio; the local take is retained");
      captured.receipt=receipt;audio.src=`/api/v1/recordings/${captured.id}/audio`;audio.hidden=false;download.href=audio.src;download.download=receipt.path_token;download.hidden=false;
      status.textContent=`Saved ${(captured.frames/captured.sampleRate).toFixed(2)} s · ${captured.channels} channel(s) · ${captured.sampleRate} Hz. Review, then place on the armed tracks.`;
    }catch(error){status.textContent=`${error.message} · take retained locally; reconnect and retry saving`;notice(status.textContent);}
    finally{if(seq===sequence){phase="ready";controls();}}
  }
  async function finish(message="Recording stopped",{pausePlayback=true}={}) {
    if(stopping || !take || !["opening","preparing","waiting","recording","holding"].includes(phase))return;
    stopping=true;const captured=take;phase="stopping";controls();
    if(pausePlayback && captured.followsPlayback && current())playback.pause();
    try {if(captured.capture)await captured.capture.stop();}catch(error){message=error.message;}
    finally {
      await captured.capture?.close();controller?.abort();controller=null;onProgress(null);stopping=false;
      captured.blob=captured.chunks.length?new Blob(captured.chunks,{type:"application/octet-stream"}):null;
      captured.chunks=[];captured.peaks=null;
      if(captured.blob){captured.backup=URL.createObjectURL(captureWav(captured.blob,captured.sampleRate,captured.channels,captured.frames));backup.href=captured.backup;backup.download=`Voiceover-${captured.id}.wav`;backup.hidden=false;}
      phase=captured.blob?"ready":"idle";controls();status.textContent=message;
    }
    if(captured.blob)await upload();
  }
  function hold(captured,alreadyHeld=false){
    if(take!==captured || !['recording','holding'].includes(phase) || controller?.signal.aborted)return;
    const changed=phase!=='holding';phase='holding';meter.value=0;
    if(changed && !alreadyHeld)captured.capture.hold();
    controls();status.textContent='Recording held at the native playback boundary · waiting for composed playback; preparation time is excluded';
  }
  function syncPlayback(){
    const captured=take;
    if(!captured?.capture || !captured.followsPlayback || !['preparing','waiting','recording','holding'].includes(phase) || typeof playback.clock!=='function')return;
    const clock=voiceoverPlaybackClock(playback.clock(),captured.target);
    if(!clock || clock.state==='stopped'){
      if(captured.started)void finish('Composed playback stopped or changed; captured audio is retained',{pausePlayback:false});return;
    }
    if(clock.state==='holding'){if(captured.started)hold(captured);return;}
    if(!current() || controller?.signal.aborted)return;
    if(captured.originSample===null){captured.originSample=clock.sample;captured.audioOrigin=clock.audio_origin_frame;}
    const expected=captured.originSample+captured.frames*48000/captured.sampleRate;
    if(clock.audio_origin_frame!==captured.audioOrigin || clock.sequence<(captured.clockSequence ?? 0) || Math.abs(clock.sample-expected)>24000){void finish('Playback jumped; captured audio is retained',{pausePlayback:false});return;}
    captured.clockSequence=clock.sequence;
    const untilFrames=Math.floor((clock.window_end_sample-captured.originSample)*captured.sampleRate/48000);
    if(untilFrames<=captured.frames){if(captured.started)hold(captured);return;}
    if(phase==='recording')return;
    const resumed=captured.started;captured.started=true;phase='recording';
    if(resumed)captured.capture.resume({untilFrames});else captured.capture.start({untilFrames});
    controls();status.textContent='Recording in this browser · native playback windows exclude preparation waits · stop to save the take';
  }
  function begin(captured) {
    if(take!==captured || !["opening","preparing","waiting"].includes(phase) || controller?.signal.aborted)return;
    if(captured.followsPlayback && typeof playback.clock==='function'){syncPlayback();return;}
    captured.capture.start();captured.started=true;phase="recording";controls();status.textContent="Recording in this browser · stop to save the take";
  }
  async function record() {
    if(phase==="waiting"){const captured=take,seq=sequence;await playback.start();if(seq===sequence && take===captured && phase==='waiting' && !playback.video.paused)begin(captured);return;}
    const currentTarget=getTarget(),target=currentTarget?{...currentTarget,tracks:[...currentTarget.tracks]}:null;if(!canCommit() || !target?.tracks.length)return;
    if(take?.blob && !take.receipt)return;
    refreshFormat(target);
    if(take?.backup)URL.revokeObjectURL(take.backup);
    const seq=++sequence;controller=new AbortController();const signal=controller.signal;
    take={id:crypto.randomUUID(),target,identity:voiceoverIdentity(target),format:form.elements.format.value,channels:Number(form.elements.channels.value),chunks:[],frames:0,blob:null,receipt:null,capture:null,started:false,originSample:null,followsPlayback:form.elements.playback.checked && target.canPlayback};const captured=take;
    resetPreview();form.elements.start.value=target.start_frame;
    phase="opening";controls();status.textContent="Waiting for browser audio input permission…";
    try {
      const capture=await captureFactory({signal,getInput,deviceId:form.elements.device.value,channels:captured.channels,monitor:form.elements.monitor.checked,onChunk:(value)=>{
        if(take!==captured || signal.aborted)return;captured.chunks.push(value.buffer);captured.frames=value.frames;captured.peaks.append(new Float32Array(value.buffer));if(!['recording','holding'].includes(phase) || !current())return;const peak=Number.isFinite(value.peak)?value.peak:0;meter.value=phase==='holding'?0:Math.min(1,peak);
        if(phase==='recording')status.textContent=`Recording ${(value.frames/captured.sampleRate).toFixed(1)} s · input ${value.peak>0?(20*Math.log10(value.peak)).toFixed(1):"−∞"} dBFS`;
        onProgress({project_epoch:captured.target.project_epoch,generation:captured.target.generation,timeline_id:captured.target.timeline_id,revision:captured.target.revision,tracks:captured.target.tracks,start_frame:captured.target.start_frame,seconds:value.frames/captured.sampleRate,peaks:captured.peaks.values(),withoutPlayback:!captured.followsPlayback});
      },onHold:()=>{if(take===captured && !signal.aborted)hold(captured,true);},onDone:()=>{if(['recording','holding'].includes(phase) && !stopping)finish("Recording limit reached");},onError:(message)=>{notice(message);finish(message);}});
      if(seq!==sequence || signal.aborted){await capture.close();return;}
      captured.capture=capture;captured.sampleRate=capture.sampleRate;captured.channels=capture.channels;captured.peaks=new CapturePeaks(capture.sampleRate,capture.channels);
      if(!current())throw new Error("Project changed while opening the input; start again on the intended timeline");
      if(captured.followsPlayback) {
        phase="preparing";controls();status.textContent="Preparing composed playback before recording begins…";
        await playback.start();if(seq!==sequence || signal.aborted || take!==captured || !["preparing","waiting","recording","holding"].includes(phase))return;
        if(!playback.video.paused)begin(captured);else {phase="waiting";status.textContent="Playback is prepared. Press Start prepared playback and record.";controls();}
      }else begin(captured);
    }catch(error){if(seq===sequence){if(['recording','holding'].includes(phase)){await finish(error.message);return;}await captured.capture?.close();controller?.abort();controller=null;phase="idle";controls();if(error.name!=="AbortError")status.textContent=error.message;}}
  }
  start.addEventListener("click",()=>record().catch((error)=>{status.textContent=error.message;}));stop.addEventListener("click",()=>finish());save.addEventListener("click",upload);
  playback.video.addEventListener("playing",()=>{if(typeof playback.clock==='function')syncPlayback();else if(["preparing","waiting"].includes(phase))begin(take);});
  for(const event of ["pause","ended"])playback.video.addEventListener(event,()=>{
    if(event==='pause' && playback.video.paused===false || event==='ended' && playback.video.ended===false)return;
    if(!take?.followsPlayback)return;
    if(typeof playback.clock==='function')syncPlayback();else if(phase==='recording')void finish('Composed playback stopped; captured audio is retained');
  });
  for(const event of ['waiting','stalled'])playback.video.addEventListener(event,()=>{if(take?.followsPlayback && typeof playback.clock==='function' && playback.video.readyState<3)hold(take);});
  playback.video.addEventListener('error',()=>{if(playback.video.error!==null && ['recording','holding'].includes(phase))void finish('Composed playback failed; captured audio is retained',{pausePlayback:false});});
  playback.video.addEventListener("ratechange",()=>{if(['recording','holding'].includes(phase) && playback.video.playbackRate!==1)finish("Playback rate changed; captured audio is retained",{pausePlayback:false});});
  apply.addEventListener("click",async()=>{
    if(!take?.receipt || !current() || !canCommit() || !form.reportValidity())return;
    apply.disabled=true;audio.pause();
    try{await commit(voiceoverPlacement(take.id,take.target,Number(form.elements.start.value),Number(form.elements.latency.value),form.elements.overwrite.checked));if(take?.backup)URL.revokeObjectURL(take.backup);take=null;phase="idle";root.close();notice("Native voiceover placed · tracks disarmed · one Undo step");}
    catch(error){status.textContent=error.message;notice(error.message);}finally{controls();}
  });
  rebind.addEventListener("click",()=>{const target=getTarget();if(!take || !target?.tracks.length)return;take.target=target;take.identity=voiceoverIdentity(target);form.elements.start.value=target.start_frame;status.textContent="Placement now targets the current timeline and armed tracks; review the start before applying";controls();});
  discard.addEventListener("click",()=>{if(discard.disabled || !take?.blob)return;if(!take.receipt && !confirmDiscard("Discard this unsaved take? Download the local WAV backup first if you need to keep it."))return;const saved=!!take.receipt;if(take.backup)URL.revokeObjectURL(take.backup);take=null;sequence++;phase="idle";resetPreview();controls();status.textContent=saved?"Local take released; the saved audio remains in the server media picker":"Unsaved take discarded";});
  async function dismiss(){if(["opening","preparing","waiting","recording","holding"].includes(phase))await finish();if(phase!=="saving" && phase!=="stopping"){controller?.abort();audio.pause();root.close();}}
  close.addEventListener("click",dismiss);root.addEventListener("cancel",(event)=>{event.preventDefault();dismiss();});
  window.addEventListener("beforeunload",(event)=>{if(["opening","preparing","waiting","recording","holding","saving"].includes(phase) || (take?.blob && !take.receipt)){event.preventDefault();event.returnValue="";}});
  return {
    syncPlayback,
    async open(){
      root.showModal();const target=getTarget();
      if(!take){resetPreview();refreshFormat(target);form.elements.playback.checked=!!target?.canPlayback;form.elements.start.value=target?.start_frame || 0;status.textContent=target?.tracks.length?`Ready · armed tracks ${target.tracks.join(", ")} · recordings save to this server project`:"Save the project and arm unlocked audio tracks in the Inspector first";}
      controls();
      try {const devices=await navigator.mediaDevices?.enumerateDevices();if(devices){const old=form.elements.device.value;form.elements.device.replaceChildren(new Option("Default microphone",""));devices.filter((device)=>device.kind==="audioinput" && device.deviceId!=="default").forEach((device,index)=>form.elements.device.append(new Option(device.label || `Audio input ${index+1}`,device.deviceId)));form.elements.device.value=old;}}catch{}
    },
    invalidate(){if(take && !current()){if(["opening","preparing","waiting","recording","holding"].includes(phase)){onProgress(null);finish("Document changed; captured take is retained for explicit placement");}else if(phase==="ready")status.textContent="Project or armed tracks changed; use the current timeline explicitly before placing this retained take";}controls();},
  };
}
