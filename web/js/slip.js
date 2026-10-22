import {request} from './api.js';
import {sourceAssetURL} from './source.js';

export function slipIdentity(target){return target?JSON.stringify([target.project_epoch,target.if_generation,target.timeline_id,target.revision,target.clip_id]):null;}
export function slipFrames(manifest,delta){
  if(!Number.isSafeInteger(delta) || delta<manifest.window_start || delta>manifest.window_end)return null;
  return manifest.frames[delta-manifest.window_start] || null;
}
const validFPS=fps=>Number.isSafeInteger(fps?.num) && fps.num>0 && Number.isSafeInteger(fps?.den) && fps.den>0;
export function slipWindows(manifest,delta){
  const frames=slipFrames(manifest,delta);
  if(!frames || !validFPS(manifest.fps) || !Number.isSafeInteger(manifest.total_frames) || manifest.total_frames<=0)throw Error('Native Slip source dimensions are invalid');
  const span=Number(60n*BigInt(manifest.fps.num)/BigInt(manifest.fps.den)),total=manifest.total_frames;
  if(!Number.isSafeInteger(span) || span<1 || frames.slice(1).some(frame=>!Number.isSafeInteger(frame) || frame<0 || frame>=total))throw Error('Native Slip source frames are outside the media');
  const range=(low,high)=>{const start=Math.max(0,Math.min(total-span,low+Math.floor((high-low)/2)-Math.floor(span/2)));return {start_frame:start,end_frame:Math.min(total,start+span)};};
  const low=Math.min(frames[1],frames[2]),high=Math.max(frames[1],frames[2]);
  if(high-low<span){const shared=range(low,high);return [shared,shared];}
  return [range(frames[1],frames[1]),range(frames[2],frames[2])];
}
export function checkedSlipManifest(value,target,center){
  if(!Number.isSafeInteger(center))throw Error('Choose an integer Slip delta');
  if(!value || value.project_epoch!==target.project_epoch || value.generation!==target.if_generation || value.revision!==target.revision || value.clip_id!==target.clip_id || (value.timeline_id!=null && value.timeline_id!==target.timeline_id))throw Error('Native Slip manifest is obsolete');
  if(typeof value.media_id!=='string' || !/^\d{1,20}$/.test(value.media_id) || typeof value.source_version!=='string' || !value.source_version.length || value.source_version.length>256 || !validFPS(value.fps) || !Number.isSafeInteger(value.total_frames) || value.total_frames<=0 || typeof value.locked!=='boolean' || typeof value.preview_available!=='boolean')throw Error('Native Slip source metadata is invalid');
  if(!Array.isArray(value.clip_ids) || !value.clip_ids.includes(target.clip_id) || value.clip_ids.length>4096 || value.clip_ids.some(id=>typeof id!=='string' || !/^\d{1,20}$/.test(id)) || new Set(value.clip_ids).size!==value.clip_ids.length)throw Error('Native linked Slip selection changed');
  if(![value.min_delta,value.max_delta,value.window_start,value.window_end].every(Number.isSafeInteger) || value.min_delta>value.window_start || value.max_delta<value.window_end || value.window_start>center || value.window_end<center || !Array.isArray(value.frames) || value.frames.length!==value.window_end-value.window_start+1 || value.frames.length>65537)throw Error('Native Slip frame map is invalid');
  if(value.frames.some((row,index)=>!Array.isArray(row) || row.length!==3 || row[0]!==value.window_start+index || row.some(frame=>!Number.isSafeInteger(frame)) || (value.preview_available && row.slice(1).some(frame=>frame<0 || frame>=value.total_frames))))throw Error('Native Slip frame map is outside the source');
  return value;
}
export function checkedSlipWindow(job,manifest,requested,epoch){
  const value=job.source_window;
  if(typeof job.id!=='string' || !job.id || job.id.length>256 || job.source_asset!=='source.mp4' || (job.project_epoch!=null && job.project_epoch!==epoch) || !value || value.source_version!==manifest.source_version || !validFPS(value.fps) || value.fps.num!==manifest.fps.num || value.fps.den!==manifest.fps.den || value.total_frames!==manifest.total_frames || !Number.isSafeInteger(value.start_frame) || !Number.isSafeInteger(value.end_frame) || value.start_frame<0 || value.start_frame>requested.start_frame || value.end_frame<requested.end_frame || value.end_frame>value.total_frames || value.end_frame<=value.start_frame || BigInt(value.end_frame-value.start_frame)*BigInt(value.fps.den)>60n*BigInt(value.fps.num) || (value.audio_stream_index!=null && value.audio_stream_index!==0))throw Error('Slip Source window changed or is invalid; Refresh edges');
  return {...value,fps:{...value.fps}};
}
export async function boundedProxy(url,signal,fetcher=fetch){
  const response=await fetcher(url,{signal,cache:'no-store'});if(!response.ok)throw Error('Slip Source window is no longer available');
  const limit=32*1024*1024;
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Slip local Source window exceeds 32 MiB');}
  if(!response.body)throw Error('Slip Source window has no media body');
  const reader=response.body.getReader(),parts=[];let bytes=0;
  try{while(true){if(signal.aborted)throw new DOMException('Canceled','AbortError');const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw Error('Slip local Source window exceeds 32 MiB');}parts.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(!bytes)throw Error('Slip Source window is empty');return new Blob(parts,{type:'video/mp4'});
}

export function createSlipView({root,getTarget,commit,notice,onVisible=()=>{},api=request,fetcher=fetch,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),setTimer=setTimeout,clearTimer=clearTimeout}){
  const videos=[...root.querySelectorAll('video')],labels=[...root.querySelectorAll('[data-slip-label]')],status=root.querySelector('output'),input=root.querySelector('input'),apply=root.querySelector('[data-slip-apply]'),refresh=root.querySelector('[data-slip-refresh]'),close=root.querySelector('[data-slip-close]');
  let controller=null,sequence=0,manifest=null,target=null,delta=0,numericValid=false,ready=false,previewReady=false,disposed=false,applying=false;
  const urls=new Set(),bindings=[null,null],listeners=[];
  const current=()=>!disposed && target && slipIdentity(target)===slipIdentity(getTarget(target.clip_id));
  const active=(seq,signal)=>seq===sequence && !signal.aborted && current();
  const on=(node,type,handler)=>{node.addEventListener(type,handler);listeners.push(()=>node.removeEventListener?.(type,handler));};
  function show(visible){if(root.hidden===!visible)return;root.hidden=!visible;root.parentElement.dataset.slipPreview=String(visible);onVisible(visible);}
  function release(){
    bindings.fill(null);previewReady=false;
    for(const video of videos){video.pause();video.hidden=true;video.removeAttribute('src');video.load();}
    for(const url of urls)revokeURL(url);urls.clear();
  }
  function paint(){
    apply.disabled=applying || !numericValid || !ready || !current() || manifest?.locked || delta===0;
    if(!manifest)return;
    if(!current()){status.textContent='STALE · reopen Slip after the project or selection changes';controller?.abort();release();return;}
    if(!numericValid){status.textContent='Choose an integer delta inside the native linked source handles';return;}
    const frames=slipFrames(manifest,delta);
    if(!frames){status.textContent='Draft outside cached native frame map · Refresh edges to inspect this range';videos.forEach(video=>video.hidden=true);return;}
    labels.forEach((label,index)=>label.textContent=`${index?'Last':'First'} source frame ${frames[index+1]}`);
    if(!manifest.preview_available){status.textContent='Native slip handles ready · dual video preview is available for movie sources';return;}
    if(!previewReady)return;
    for(const [index,video] of videos.entries()){
      const binding=bindings[index],frame=frames[index+1];
      if(!binding || binding.seq!==sequence || video.src!==binding.url || frame<binding.range.start_frame || frame>=binding.range.end_frame){videos.forEach(item=>item.hidden=true);status.textContent='Source edge outside local windows · Refresh edges to inspect this range';return;}
    }
    let seeking=false;
    for(const [index,video] of videos.entries()){
      const binding=bindings[index],time=(frames[index+1]-binding.range.start_frame)*manifest.fps.den/manifest.fps.num;
      if(video.readyState<1 || video.currentSrc!==binding.url){video.hidden=true;seeking=true;continue;}
      if(Math.abs(video.currentTime-time)>1e-6){binding.time=time;video.currentTime=time;}
      const verified=!video.seeking && Math.abs(video.currentTime-time)<1e-6;video.hidden=!verified;seeking ||= !verified;
    }
    status.textContent=seeking?'SEEKING · local Source edges':`DRAFT · ${delta>=0?'+':''}${delta} timeline frames · raw source edges · Apply commits one Undo`;
  }
  function reset(message='Slip closed'){
    sequence++;controller?.abort();controller=null;manifest=null;target=null;numericValid=false;ready=false;release();apply.disabled=true;refresh.disabled=false;
    labels.forEach(label=>label.textContent='Preparing source edge…');show(false);status.textContent=message;
  }
  const delay=signal=>new Promise((resolve,reject)=>{
    const cancel=()=>{clearTimer(timer);reject(new DOMException('Canceled','AbortError'));};
    const timer=setTimer(()=>{signal.removeEventListener('abort',cancel);resolve();},300);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  });
  async function attach(video,index,binding,seq,signal){
    bindings[index]=binding;video.src=binding.url;video.load();
    await new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimer(timer);for(const type of ['loadedmetadata','seeked','error'])video.removeEventListener(type,event);signal.removeEventListener('abort',cancel);};
      const cancel=()=>{cleanup();reject(new DOMException('Canceled','AbortError'));};
      const event=value=>{
        if(!active(seq,signal) || bindings[index]!==binding || video.src!==binding.url)return cancel();
        if(video.currentSrc!==binding.url)return;
        if(value?.type==='error'){cleanup();reject(Error('Slip Source window could not be decoded'));return;}
        if(video.readyState<1)return;
        if(Math.abs(video.currentTime-binding.time)>1e-6){video.currentTime=binding.time;if(video.seeking)return;}
        if(!video.seeking && Math.abs(video.currentTime-binding.time)<1e-6){cleanup();resolve();}
      };
      for(const type of ['loadedmetadata','seeked','error'])video.addEventListener(type,event);signal.addEventListener('abort',cancel,{once:true});
      timer=setTimer(()=>{cleanup();reject(Error('Slip Source window seek timed out; Refresh edges'));},10000);event();
    });
  }
  async function open(clip,center=0){
    if(disposed || applying)return;reset();target=getTarget(clip);if(!target)return notice('Select a writable source clip first');
    const wanted={...target},seq=sequence;target=wanted;delta=center;numericValid=Number.isSafeInteger(center);input.value=center;show(true);controller=new AbortController();const signal=controller.signal;
    const apiCall=(path,body)=>api(path,body,(url,init={})=>fetcher(url,{...init,signal:AbortSignal.any([signal,init.signal].filter(Boolean))}));
    status.textContent='Reading native linked Slip handles…';refresh.disabled=true;
    try{
      const {clip_id,...query}=wanted;
      const value=await apiCall(`/timelines/${encodeURIComponent(wanted.timeline_id)}/clips/${encodeURIComponent(clip)}/slip/${center}?${new URLSearchParams(query)}`);
      if(!active(seq,signal))return;manifest=checkedSlipManifest(value,wanted,center);ready=true;input.min=manifest.min_delta;input.max=manifest.max_delta;paint();
      if(manifest.preview_available){
        const windows=slipWindows(manifest,center),assets=new Map(),edgeAssets=[];
        for(const range of windows){
          const key=JSON.stringify(range);if(assets.has(key)){edgeAssets.push(assets.get(key));continue;}
          let job=await apiCall(`/media/${encodeURIComponent(manifest.media_id)}/prepare`,{project_epoch:wanted.project_epoch,quality:'low',window:range});
          if(!active(seq,signal))return;
          const id=job.id;if(typeof id!=='string' || !id || job.source_asset!=='source.mp4')throw Error('Slip preparation returned an invalid Source window job');
          const path=`/media/${encodeURIComponent(manifest.media_id)}/jobs/${encodeURIComponent(id)}?${new URLSearchParams({project_epoch:wanted.project_epoch})}`;
          while(['queued','running'].includes(job.state)){status.textContent=`Preparing bounded Slip Source window · ${job.state}`;await delay(signal);if(!active(seq,signal))return;job=await apiCall(path);if(!active(seq,signal))return;if(job.id!==id)throw Error('Slip Source window job changed');}
          if(job.state!=='ready')throw Error(job.error || `Slip Source window ${job.state}`);
          const actual=checkedSlipWindow(job,manifest,range,wanted.project_epoch);status.textContent='Caching bounded local Slip Source window…';
          const blob=await boundedProxy(sourceAssetURL(manifest.media_id,id,'source.mp4',wanted.project_epoch),signal,fetcher);if(!active(seq,signal))return;
          const asset={url:createURL(blob),range:actual};urls.add(asset.url);assets.set(key,asset);edgeAssets.push(asset);
        }
        if(!active(seq,signal))return;
        const frames=slipFrames(manifest,center);
        await Promise.all(videos.map((video,index)=>attach(video,index,{...edgeAssets[index],seq,time:(frames[index+1]-edgeAssets[index].range.start_frame)*manifest.fps.den/manifest.fps.num},seq,signal)));
        if(!active(seq,signal))return;previewReady=true;paint();
      }
    }catch(error){if(seq===sequence && error.name!=='AbortError'){controller?.abort();release();status.textContent=error.message;ready=!!manifest && current();apply.disabled=!numericValid || !ready || !delta || manifest.locked;}}
    finally{if(seq===sequence){refresh.disabled=false;if(!current() && !disposed){release();status.textContent='STALE · reopen Slip after the project or selection changes';}}}
  }
  for(const [index,video] of videos.entries())for(const type of ['loadedmetadata','seeked','error'])on(video,type,event=>{
    const binding=bindings[index];if(!binding || binding.seq!==sequence || video.src!==binding.url || video.currentSrc!==binding.url || !current())return;
    if(event.type==='error'){previewReady=false;videos.forEach(item=>item.hidden=true);status.textContent='Slip Source window could not be decoded · Refresh edges';}else if(previewReady)paint();
  });
  on(input,'input',()=>{const value=Number(input.value);numericValid=input.value.trim()!=='' && Number.isSafeInteger(value) && !!manifest && value>=manifest.min_delta && value<=manifest.max_delta;if(numericValid){delta=value;paint();}else{apply.disabled=true;status.textContent='Choose an integer delta inside the native linked source handles';}});
  on(input,'change',()=>{
    if(!numericValid || !current() || !manifest || !Number.isSafeInteger(Number(input.value)) || Number(input.value)!==delta || delta<manifest.min_delta || delta>manifest.max_delta)return;
    const frames=slipFrames(manifest,delta);
    if(!frames || (manifest.preview_available && (!previewReady || bindings.some((binding,index)=>!binding || frames[index+1]<binding.range.start_frame || frames[index+1]>=binding.range.end_frame))))void open(target.clip_id,delta);
  });
  on(refresh,'click',()=>{if(target && numericValid)void open(target.clip_id,delta);});on(close,'click',()=>reset());
  on(apply,'click',async()=>{if(applying || !numericValid || !ready || !current() || manifest.locked || !delta || Number(input.value)!==delta || !input.reportValidity())return;applying=true;apply.disabled=true;refresh.disabled=true;try{await commit({kind:'slip',clip_ids:[...manifest.clip_ids],delta_frames:delta});reset();}catch(error){notice(error.message);reset();}finally{applying=false;}});
  return {open,reset,invalidate(){if(target && !current())reset('STALE · reopen Slip after the project or selection changes');else paint();},draft(event){if(event.phase==='begin')void open(event.clip_id,event.delta);else if(event.phase==='draft'){delta=event.delta;numericValid=Number.isSafeInteger(delta) && (!manifest || (delta>=manifest.min_delta && delta<=manifest.max_delta));input.value=String(delta);paint();}else reset();},destroy(){reset();disposed=true;for(const remove of listeners)remove();}};
}
