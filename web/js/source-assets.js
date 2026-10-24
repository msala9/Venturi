import { request } from "./api.js";
import { sourceAssetURL, sourceMediaPath, sourceMediaQuery } from "./source.js";

const PNG_LIMIT = 1024 * 1024;
const WAVE_LIMIT = 4 * 1024 * 1024;
const ASSET_LIMIT = 16 * 1024 * 1024;
const PAUSED = "Media analysis paused for playback · Refresh when idle";

function abortError() { return new DOMException("Canceled", "AbortError"); }
export const sourceAssetKey=(id,index=0)=>JSON.stringify([id,index]);
export function nativeSourceIdentity(item){
  if(!item?.native_asset)return null;
  try{const query=sourceMediaQuery(item,'');return JSON.stringify([item.native_asset.id,query.revision,query.if_generation,query.source_version]);}catch{return null;}
}
export function mediaThumbnail(assets,id){const first=assets.get(sourceAssetKey(id));return first?.thumbnail?first:[...assets.values()].find(asset=>asset.mediaId===id && asset.thumbnail);}
export function nativeThumbnailItem(asset,context){
  const meta=asset?.presentation;
  if(meta?.has_video!==true || meta.kind==='timeline' || asset.archived || asset.error || asset.missing_count>0 || typeof asset.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(asset.id) || typeof asset.revision!=='string' || !/^[a-f0-9]{64}$/.test(asset.revision) || typeof context?.generation!=='string' || !/^(0|[1-9][0-9]*)$/.test(context.generation) || typeof context.project_epoch!=='string' || !context.project_epoch)return null;
  return {...meta,id:`native-asset:${asset.id}:${asset.revision}:${context.generation}`,name:asset.name,content_hash:null,audio_stream_count:meta.audio_streams,native_asset:{id:asset.id,revision:asset.revision,if_generation:context.generation}};
}
function validateDescriptor(job, item, epoch, sourceVersion, audioStreamIndex, explicitStream,includeWaveform,explicitWaveform) {
  const descriptor = job.source_assets;
  if (!descriptor || (job.project_epoch != null && job.project_epoch !== epoch) || job.source_asset != null || job.program != null || job.source_window != null ||
      typeof descriptor.source_version!=="string" || !descriptor.source_version || descriptor.source_version.length>512 || sourceVersion!=null && descriptor.source_version !== sourceVersion || descriptor.total_frames !== item.duration_frames ||
      (descriptor.audio_stream_index ?? (explicitStream?null:0))!==audioStreamIndex ||
      (descriptor.include_waveform ?? (explicitWaveform?null:true))!==includeWaveform ||
      !Number.isSafeInteger(descriptor.total_frames) || descriptor.total_frames <= 0 ||
      descriptor.fps?.num !== item.fps?.num || descriptor.fps?.den !== item.fps?.den ||
      !Number.isSafeInteger(descriptor.fps?.num) || descriptor.fps.num <= 0 ||
      !Number.isSafeInteger(descriptor.fps?.den) || descriptor.fps.den <= 0 ||
      typeof descriptor.has_video !== "boolean" || typeof descriptor.has_audio !== "boolean" ||
      descriptor.has_video !== item.has_video || descriptor.has_audio !== item.has_audio ||
      (!descriptor.has_video && !descriptor.has_audio)) throw Error("Media analysis identity changed · Refresh when idle");
  return descriptor;
}

async function readBounded(response, limit, signal) {
  if (!response.ok) throw Error("Media analysis asset is unavailable · Refresh when idle");
  const size = response.headers?.get("Content-Length");
  if (size !== null && size !== undefined && (!/^\d+$/.test(size) || Number(size) > limit)) {
    await response.body?.cancel();
    throw Error("Media analysis asset exceeds its memory limit");
  }
  if (!response.body?.getReader) throw Error("Media analysis streaming response is unavailable");
  const reader = response.body.getReader(), parts = [];
  let total = 0, complete = false;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) { complete = true; break; }
      total += value.byteLength;
      if (total > limit) throw Error("Media analysis asset exceeds its memory limit");
      parts.push(value);
    }
    if (!total) throw Error("Media analysis returned an empty asset");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function pngDimensions(bytes) {
  const signature = [137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) throw Error("Media analysis returned an invalid PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12,16)) !== "IHDR") throw Error("Media analysis returned an invalid PNG");
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height * 4 > ASSET_LIMIT) throw Error("Media thumbnail exceeds its decoded memory limit");
  return { width, height };
}

function parseWaveform(bytes) {
  const waveform = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (waveform.scope !== "full_source" || !Number.isFinite(waveform.duration_seconds) || waveform.duration_seconds <= 0 ||
      !Array.isArray(waveform.peaks) || !waveform.peaks.length || waveform.peaks.length > 65_536 ||
      waveform.peaks.some(peak => !Number.isFinite(peak) || peak < 0 || peak > 1)) throw Error("Media waveform does not describe the full source");
  return waveform;
}

export function createSourceAssets({ getState, onReady, onStatus = () => {}, onError = () => {}, api = request, fetcher = fetch,
  isNativeCurrent = () => false,
  setTimer = setTimeout, clearTimer = clearTimeout, decodeImage = blob => createImageBitmap(blob),
  createURL = blob => URL.createObjectURL(blob), revokeURL = url => URL.revokeObjectURL(url) }) {
  let current = null, disposed = false;
  const attempted = new Set();
  const identity = (item, epoch, index,waveform,version) => JSON.stringify([epoch, item.id, item.content_hash,index,waveform,version ?? null,nativeSourceIdentity(item)]);
  function owns(attempt) {
    const state = getState();
    return !disposed && current === attempt && !attempt.controller.signal.aborted && state?.project_epoch === attempt.epoch &&
      (attempt.item.native_asset ? isNativeCurrent(attempt.item,attempt.epoch) : state.media?.some(item => item.id === attempt.item.id && item.content_hash === attempt.item.content_hash &&
        item.duration_frames === attempt.item.duration_frames && item.fps?.num === attempt.item.fps?.num && item.fps?.den === attempt.item.fps?.den &&
        item.has_video === attempt.item.has_video && item.has_audio === attempt.item.has_audio && item.is_image === attempt.item.is_image && item.audio_stream_count===attempt.item.audio_stream_count && item.compound_timeline_id===attempt.item.compound_timeline_id));
  }
  function cancel() {
    const previous = current;
    current = null;
    previous?.controller.abort();
    if (!disposed && previous?.pending) onStatus(previous.item.native_asset?"Thumbnail preparation disconnected · Refresh when idle":"Media analysis status disconnected · Refresh when idle",previous.item);
  }
  function delay(attempt) {
    return new Promise((resolve, reject) => {
      const signal = attempt.controller.signal;
      const abort = () => { clearTimer(timer); reject(abortError()); };
      const timer = setTimer(() => { signal.removeEventListener("abort", abort); resolve(); }, 300);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  async function run(attempt) {
    const { epoch, audioStreamIndex, explicitStream,includeWaveform,explicitWaveform } = attempt, signal = attempt.controller.signal;
    let item=attempt.item;
    let thumbnail = null, thumbnailURL = null, transferred = false;
    const alive = () => { if (!owns(attempt)) throw abortError(); };
    const guardedFetch = (url, options = {}) => fetcher(url, { ...options, cache: "no-store", signal: AbortSignal.any([signal, options.signal, AbortSignal.timeout(20_000)].filter(Boolean)) });
    try {
      alive();
      if(item.native_asset && !nativeSourceIdentity(item)){
        onStatus(`${item.name} · Preparing thumbnail`,item);alive();
        const reference=item.native_asset;
        const resolved=await api(`/native-assets/items/${encodeURIComponent(reference.id)}/source`,{project_epoch:epoch,if_generation:reference.if_generation,revision:reference.revision},guardedFetch);
        alive();
        const next=resolved?.item,native=next?.native_asset;
        if(resolved.project_epoch!==epoch || resolved.generation!==reference.if_generation || next?.id!==item.id || native?.id!==reference.id || native.revision!==reference.revision || native.if_generation!==reference.if_generation || !native.source_version || attempt.sourceVersion!=null && native.source_version!==attempt.sourceVersion || next.compound_timeline_id || next.offline || !next.has_video || next.duration_frames!==item.duration_frames || next.fps?.num!==item.fps?.num || next.fps?.den!==item.fps?.den || next.has_audio!==item.has_audio || next.is_image!==item.is_image)throw Error('Library thumbnail identity changed · Refresh when idle');
        sourceMediaQuery(next,epoch);
        item=attempt.item={...next,fps:{...next.fps},native_asset:{...native}};attempt.sourceVersion=native.source_version;
      }
      if(item.native_asset && (attempt.sourceVersion!=null && attempt.sourceVersion!==item.native_asset.source_version || !nativeSourceIdentity(item)))throw Error('Library Source identity changed · Refresh when idle');
      if(item.native_asset)attempt.sourceVersion=item.native_asset.source_version;
      if(!item.native_asset || includeWaveform)onStatus(`${item.name} · Analyzing full-source media`,item);
      alive();
      let job = await api(sourceMediaPath(item,'/assets/prepare',{absolute:false}), { ...sourceMediaQuery(item,epoch),...(explicitStream || audioStreamIndex?{audio_stream_index:audioStreamIndex}:{}),...(explicitWaveform?{include_waveform:includeWaveform}:{}) }, guardedFetch);
      alive();
      if (typeof job.id !== "string" || !job.id) throw Error("Media analysis returned an invalid job");
      const jobId = job.id;
      const path = `${sourceMediaPath(item,`/jobs/${encodeURIComponent(jobId)}`)}?${new URLSearchParams(sourceMediaQuery(item,epoch))}`;
      while (true) {
        alive();
        if (job.id !== jobId) throw Error("Media analysis job changed");
        const descriptor = validateDescriptor(job, item, epoch, attempt.sourceVersion,audioStreamIndex,explicitStream,includeWaveform,explicitWaveform);
        if(item.native_asset && descriptor.thumbnail_width!==96)throw Error('Library media profile changed · Refresh when idle');
        attempt.sourceVersion=descriptor.source_version;
        if (job.state === "canceled") { onStatus(item.native_asset?'Thumbnail preparation paused · Refresh when idle':PAUSED,item); return null; }
        if (job.state === "failed") throw Error(`${job.error || "Media analysis failed"} · Refresh when idle`);
        if (job.state === "ready") {
          let waveform = null, waveBytes = 0, png = null, dimensions = null;
          if (descriptor.has_audio && includeWaveform) {
            const response = await guardedFetch(sourceAssetURL(item, jobId, "waveform.json", epoch));
            alive();
            const bytes = await readBounded(response, WAVE_LIMIT, signal);
            alive();
            waveform = parseWaveform(bytes);
            waveBytes = bytes.byteLength + waveform.peaks.length * 8;
          }
          if (descriptor.has_video) {
            const response = await guardedFetch(sourceAssetURL(item, jobId, "thumb.png", epoch));
            alive();
            const bytes = await readBounded(response, PNG_LIMIT, signal);
            alive();
            dimensions = pngDimensions(bytes);
            if(item.native_asset && dimensions.width>96)throw Error('Library thumbnail exceeds its native profile');
            png = new Blob([bytes], { type: "image/png" });
          }
          const bytes = waveBytes + (png ? png.size + dimensions.width * dimensions.height * 4 : 0);
          if (bytes > ASSET_LIMIT) throw Error("Media analysis exceeds its memory limit");
          if (png) {
            thumbnail = await decodeImage(png);
            alive();
            if (thumbnail.width !== dimensions.width || thumbnail.height !== dimensions.height) throw Error("Media thumbnail dimensions changed");
            thumbnailURL = createURL(png);
          }
          alive();
          const result = { item, epoch, sourceVersion:attempt.sourceVersion,audioStreamIndex,includeWaveform,waveformBytes:waveBytes, thumbnail, thumbnailURL, waveform, bytes };
          if (onReady(result) === false) return null;
          transferred = true;
          if (owns(attempt)) onStatus(`${item.name} · ${item.native_asset && !includeWaveform?'Thumbnail ready':'Full-source media analysis ready'}`,item);
          return result;
        }
        if (job.state !== "queued" && job.state !== "running") throw Error("Media analysis returned an invalid state");
        await delay(attempt);
        alive();
        const response = await guardedFetch(path);
        alive();
        if (!response.ok) throw Error("Media analysis job is unavailable · Refresh when idle");
        job = await response.json();
      }
    } catch (error) {
      if (owns(attempt) && error.name !== "AbortError") {
        const message = error.message || "Media analysis failed";
        onStatus(message.includes("Refresh") ? message : `${message} · Refresh when idle`,item);
        onError(error);
      }
      return null;
    } finally {
      if (!transferred) { thumbnail?.close(); if (thumbnailURL !== null) revokeURL(thumbnailURL); }
      attempt.pending = false;
    }
  }
  function load(item, epoch, options = {}) {
    if (disposed) return Promise.resolve(null);
    const {sourceVersion,force=false,audioStreamIndex=0,includeWaveform=true}=options,explicitStream=Object.hasOwn(options,'audioStreamIndex'),explicitWaveform=Object.hasOwn(options,'includeWaveform');
    if(typeof includeWaveform!=='boolean' || !includeWaveform && !item.has_video || item.native_asset && (!isNativeCurrent(item,epoch) || includeWaveform && (!item.has_audio || !nativeSourceIdentity(item))))return Promise.resolve(null);
    if(!Number.isSafeInteger(audioStreamIndex) || audioStreamIndex<0 || audioStreamIndex>0 && (!item.has_audio || !Number.isSafeInteger(item.audio_stream_count) || audioStreamIndex>=item.audio_stream_count))return Promise.resolve(null);
    const key = identity(item, epoch,audioStreamIndex,includeWaveform,sourceVersion);
    if (!force && current?.key === key && (sourceVersion==null || current.sourceVersion === sourceVersion) && current.pending) return current.promise;
    if (!force && attempted.has(key)) {
      if (current && (current.key !== key || current.sourceVersion !== sourceVersion)) cancel();
      return Promise.resolve(null);
    }
    cancel();
    attempted.add(key);
    while (attempted.size > 32) attempted.delete(attempted.values().next().value);
    if (item.compound_timeline_id || sourceVersion!=null && (typeof sourceVersion !== "string" || !sourceVersion)) {
      const error = Error("Full-source analysis requires original file media and a valid source identity");
      onStatus(`${error.message} · Refresh when idle`);
      onError(error);
      return Promise.resolve(null);
    }
    const attempt = { key, item: { ...item, ...(item.native_asset?{native_asset:{...item.native_asset}}:{}), fps: item.fps && { ...item.fps } }, epoch, sourceVersion,audioStreamIndex,explicitStream,includeWaveform,explicitWaveform, controller: new AbortController(), pending: true, promise: null };
    current = attempt;
    attempt.promise = run(attempt);
    return attempt.promise;
  }
  return { load, cancel, dispose() { disposed = true; cancel(); attempted.clear(); } };
}

export function createSourceAssetQueue({loader,getState,hasAsset=()=>false,isIdle=()=>true,isNativeCurrent=()=>false,setTimer=setTimeout,clearTimer=clearTimeout}){
  const scopes=new Map(),attempted=new Map();
  let epoch=null,active=null,timer=null,disposed=false,sourceRequest=null;
  const baseKey=entry=>JSON.stringify([entry.epoch,entry.item.id,entry.item.content_hash,entry.audioStreamIndex,entry.sourceVersion ?? null,nativeSourceIdentity(entry.item)]);
  const key=entry=>JSON.stringify([baseKey(entry),entry.includeWaveform]);
  const visibleWaveform=id=>(scopes.get('source_waveform') || []).some(entry=>key(entry)===id);
  const visibleNative=id=>(scopes.get('native_pool') || []).some(entry=>key(entry)===id);
  const retryable=(attempt,id)=>Boolean(attempt?.resumable && (visibleWaveform(id) || visibleNative(id)) || attempt?.ready && attempt.left);
  const valid=entry=>{
    const state=getState();if(entry.item.native_asset)return entry.epoch===state?.project_epoch && isNativeCurrent(entry.item,entry.epoch) && !entry.item.offline && !entry.item.compound_timeline_id && (entry.includeWaveform?entry.item.has_audio && Boolean(nativeSourceIdentity(entry.item)):entry.item.has_video) && Number.isSafeInteger(entry.audioStreamIndex) && entry.audioStreamIndex>=0 && (!entry.audioStreamIndex || entry.item.has_audio && Number.isSafeInteger(entry.item.audio_stream_count) && entry.audioStreamIndex<entry.item.audio_stream_count);
    const item=state?.media?.find(item=>item.id===entry.item.id);
    return entry.epoch===state?.project_epoch && item?.content_hash===entry.item.content_hash && !item.offline && !item.compound_timeline_id && (item.has_video || item.has_audio) && (entry.includeWaveform || item.has_video) && Number.isSafeInteger(entry.audioStreamIndex) && entry.audioStreamIndex>=0 && (!entry.audioStreamIndex || item.has_audio && Number.isSafeInteger(item.audio_stream_count) && entry.audioStreamIndex<item.audio_stream_count);
  };
  function cancel(){
    if(timer!==null){clearTimer(timer);timer=null;}
    scopes.clear();sourceRequest?.resolve(null);sourceRequest=null;
    if(active){active.canceled=true;loader.cancel();}
  }
  function currentEpoch(){
    const next=getState()?.project_epoch ?? null;
    if(next!==epoch){cancel();attempted.clear();epoch=next;}
    return next;
  }
  function wanted(){
    const entries=new Map();
    for(const scope of ['source','source_waveform','timeline','pool','native_pool'])for(const entry of scopes.get(scope) || []){
      if(entries.size>=64 && !entries.has(baseKey(entry)))continue;
      if(valid(entry) && (!entries.has(baseKey(entry)) || !entries.get(baseKey(entry)).includeWaveform && entry.includeWaveform))entries.set(baseKey(entry),entry);
    }
    return new Map([...entries.values()].map(entry=>[key(entry),entry]));
  }
  function settleSource(entry,result){
    if(sourceRequest?.entry!==entry)return;
    sourceRequest.resolve(result);sourceRequest=null;scopes.delete('source');
  }
  function schedule(){
    if(disposed || timer!==null || active || !isIdle())return;
    timer=setTimer(()=>{timer=null;void pump();},200);
  }
  function refresh(){
    if(disposed)return;currentEpoch();
    const entries=wanted();
    for(const [id,attempt] of attempted){if(!entries.has(id))attempt.left=true;else if(hasAsset(entries.get(id)))attempt.left=false;}
    if(active && !active.canceled && (!entries.has(active.key) || !isIdle())){active.canceled=true;loader.cancel();}
    if(!isIdle() && timer!==null){clearTimer(timer);timer=null;}
    while(attempted.size>128){const oldest=[...attempted.keys()].find(id=>!entries.has(id));if(oldest===undefined)break;attempted.delete(oldest);}
    schedule();
  }
  async function pump(){
    if(disposed || active || !currentEpoch() || !isIdle())return;
    const entries=wanted();
    for(const entry of entries.values())if(!entry.force && (hasAsset(entry) || attempted.has(key(entry)) && !retryable(attempted.get(key(entry)),key(entry)))){settleSource(entry,null);}
    const entry=[...entries.values()].find(entry=>entry.force || !hasAsset(entry) && (!attempted.has(key(entry)) || retryable(attempted.get(key(entry)),key(entry))));
    if(!entry)return;
    const token={key:key(entry),entry,canceled:false},reload=retryable(attempted.get(token.key),token.key);active=token;attempted.set(token.key,{ready:false,left:false});
    try{
      const result=await loader.load(entry.item,entry.epoch,{audioStreamIndex:entry.audioStreamIndex,includeWaveform:entry.includeWaveform,sourceVersion:entry.sourceVersion,force:Boolean(entry.force || reload)});
      if(!token.canceled && result)attempted.set(token.key,{ready:true,left:!wanted().has(token.key)});
      const nativeOwner=entry.item.native_asset,state=getState(),nativeCanceled=nativeOwner && entry.epoch===state?.project_epoch && nativeOwner.if_generation===state.generation;
      if(token.canceled && ((!entry.force && valid(entry)) || nativeCanceled))attempted.set(token.key,{ready:false,left:true,resumable:true});
      settleSource(entry,token.canceled?null:result);
    }finally{
      if(active===token)active=null;
      if(entry.force)entry.force=false;
      refresh();
    }
  }
  function demand(scope,items,demandEpoch=getState()?.project_epoch){
    if(disposed || !['pool','timeline','source_waveform','native_pool'].includes(scope))return;
    currentEpoch();
    const entries=items.slice(0,64).map(entry=>({item:{...entry.item,...(entry.item.native_asset?{native_asset:{...entry.item.native_asset}}:{}),fps:entry.item.fps && {...entry.item.fps}},epoch:demandEpoch,audioStreamIndex:entry.audioStreamIndex ?? 0,includeWaveform:entry.includeWaveform!==false,sourceVersion:entry.sourceVersion,force:entry.force===true}));
    if(scope==='native_pool')for(const entry of entries){const previous=scopes.get(scope)?.find(value=>key(value)===key(entry));if(previous?.force && active?.entry!==previous)entry.force=true;}
    scopes.set(scope,entries);
    for(const entry of entries)if(entry.force){const id=key(entry);attempted.delete(id);if(active?.key===id){active.canceled=true;loader.cancel();}}
    refresh();
  }
  function load(item,requestEpoch,options={}){
    if(disposed)return Promise.resolve(null);currentEpoch();
    const entry={item:{...item,...(item.native_asset?{native_asset:{...item.native_asset}}:{}),fps:item.fps && {...item.fps}},epoch:requestEpoch,audioStreamIndex:options.audioStreamIndex ?? 0,includeWaveform:options.includeWaveform!==false,sourceVersion:options.sourceVersion,force:Boolean(options.force)};
    if(!valid(entry))return Promise.resolve(null);
    const identity=key(entry);
    if(sourceRequest?.key===identity && !entry.force)return sourceRequest.promise;
    sourceRequest?.resolve(null);
    let resolve;const promise=new Promise(done=>{resolve=done;});sourceRequest={key:identity,entry,promise,resolve};
    scopes.set('source',[entry]);if(entry.force){attempted.delete(identity);if(active?.key===identity){active.canceled=true;loader.cancel();}}
    refresh();return promise;
  }
  return {load,demand,refresh,cancel,cancelSource(){scopes.delete('source');scopes.delete('source_waveform');sourceRequest?.resolve(null);sourceRequest=null;refresh();},dispose(){disposed=true;cancel();attempted.clear();loader.dispose();}};
}
