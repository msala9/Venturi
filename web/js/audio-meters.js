import {sameComposition} from "./program.js";
import {effectName} from "./mixer.js";

export function createMeterReader({getTarget, onRead, onStatus, fetcher = fetch}) {
  let sequence = 0, controller = null, pending = false;
  function invalidate() { sequence++;controller?.abort();pending=false;onStatus("STALE · read the current Program frame"); }
  async function refresh() {
    if (pending) return;
    const target=getTarget();
    if (!target) { invalidate();onStatus("Select a native Program timeline");return; }
    const seq=++sequence;pending=true;controller=new AbortController();onStatus("Reading native audio…");
    try {
      const response=await fetcher("/api/v1/preview/audio/meters",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:target.query,insert:target.insert}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5_000)]),cache:"no-store"});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error?.code || "Audio meters unavailable");
      const current=getTarget();
      if(seq!==sequence || !current || !sameComposition(target.query,current.query) || JSON.stringify(target.insert)!==JSON.stringify(current.insert))return;
      onRead(result,target);onStatus(`Native ${Math.round(result.samples/result.sample_rate*1000)} ms window · Program frame ${result.frame}`);
    } catch(error) { if(seq===sequence && error.name!=="AbortError")onStatus(error.message); }
    finally { if(seq===sequence)pending=false; }
  }
  return {refresh,invalidate};
}

const finiteSample=value=>Number.isSafeInteger(value) && value>=0;
const programQuery=value=>Object.fromEntries(['project_epoch','if_generation','timeline_id','revision','start_frame','end_frame','width','audio_origin_frame'].filter(key=>value[key]!==undefined && value[key]!==null).map(key=>[key,value[key]]));
const sameProgramQuery=(a,b)=>JSON.stringify(programQuery(a || {}))===JSON.stringify(programQuery(b || {}));
const playbackIdentity=target=>target?.playback && JSON.stringify([target.playback.job_id,programQuery(target.playback.query),target.insert]);
const db=peak=>peak>0?20*Math.log10(peak):null;

export function createPeakEnvelope({now=()=>performance.now()}={}) {
  const levels=new Map();let previous=now();
  return {
    clear(){levels.clear();previous=now();},
    read(channels=[]){
      const at=now(),decay=Math.pow(.85,Math.max(0,at-previous)*60/1000);previous=at;
      for(const value of channels){
        const old=levels.get(value.channel) || {channel:value.channel,peak:[0,0],hold:[0,0],until:[0,0],clipUntil:[0,0]};
        old.peak=old.peak.map((peak,index)=>Math.max(peak*decay,value.peak[index]));
        value.peak.forEach((peak,index)=>{if(at>=old.until[index] || peak>=old.hold[index]){old.hold[index]=peak;old.until[index]=at+1000;}if(peak>1)old.clipUntil[index]=at+1000;});
        levels.set(value.channel,old);
      }
      for(const value of levels.values())if(!channels.some(channel=>channel.channel===value.channel))value.peak=value.peak.map(peak=>peak*decay);
      return [...levels.values()].map(value=>({channel:value.channel,peak:[...value.peak],db:value.peak.map(db),hold_db:value.hold.map((peak,index)=>db(at<value.until[index]?peak:value.peak[index])),clipped:value.clipUntil.map(until=>at<until)}));
    },
  };
}

export function createPlaybackMeterReader({getTarget,onRead,onStatus,onClear=()=>{},fetcher=fetch,now}) {
  let sequence=0,controller=null,pending=false,binding=null,metadata=null,cursor=0,page=null,lastSample=null,lastResult=null,unavailable=false,terminal=null;
  const envelope=createPeakEnvelope({now});
  function invalidate(){sequence++;controller?.abort();terminal?.controller.abort();terminal=null;pending=false;binding=null;metadata=null;cursor=0;page=null;lastSample=null;lastResult=null;unavailable=false;envelope.clear();onClear();}
  function terminalTarget(){
    const target=getTarget();
    if(!terminal || !terminal.isCurrent() || !target || terminal.controller.signal.aborted || ['project_epoch','if_generation','timeline_id','revision','width'].some(key=>target.query[key]!==terminal.playback.query[key]) || JSON.stringify(target.insert)!==terminal.insert || target.playback && playbackIdentity(target)!==terminal.identity)return null;
    return {...target,playback:terminal.playback};
  }
  function current(identity){const target=terminal?terminalTarget():getTarget();return target?.playback && playbackIdentity(target)===identity?target:null;}
  function checked(value,identity,from){
    const target=current(identity),playback=target?.playback;
    if(!playback || value?.job_id!==playback.job_id || !sameProgramQuery(value.query,playback.query))throw Error('Prepared audio telemetry belongs to a different Program');
    const next=value.next_bin===null?value.bin_count:value.next_bin;
    if(value.sample_rate!==48000 || value.bin_frames!==4096 || !finiteSample(value.start_sample) || !finiteSample(value.end_sample) || value.start_sample>=value.end_sample || !finiteSample(value.first_bin_sample) || value.first_bin_sample>value.start_sample || !finiteSample(value.bin_count) || value.bin_count>3517 || value.from_bin!==from || !finiteSample(next) || next<from || next>value.bin_count || !Array.isArray(value.bins) || value.bins.length>64 || next!==from+value.bins.length || !Array.isArray(value.spectrum_hz) || value.spectrum_hz.length!==128 || value.spectrum_hz.some(hz=>!Number.isFinite(hz) || hz<0 || hz>24000))throw Error('Invalid prepared audio telemetry page');
    if(metadata && ['start_sample','end_sample','first_bin_sample','bin_frames','bin_count'].some(key=>metadata[key]!==value[key]))throw Error('Prepared audio telemetry changed');
    let end=value.first_bin_sample+from*value.bin_frames;
    for(const bin of value.bins){
      if(bin.start_sample!==end || !finiteSample(bin.end_sample) || bin.end_sample<=end || bin.end_sample>end+value.bin_frames || !Array.isArray(bin.channels) || bin.channels.length>129 || !Array.isArray(bin.master_spectrum_db) || bin.master_spectrum_db.length!==128 || bin.master_spectrum_db.some(db=>!Number.isFinite(db)))throw Error('Invalid native audio telemetry bin');
      const seen=new Set();for(const channel of bin.channels){if(typeof channel.channel!=='string' || seen.has(channel.channel) || !Array.isArray(channel.peak) || channel.peak.length!==2 || channel.peak.some(peak=>!Number.isFinite(peak) || peak<0))throw Error('Invalid native audio channel peak');seen.add(channel.channel);}
      if(Array.isArray(target.channels) && (target.channels.length!==seen.size || target.channels.some(channel=>!seen.has(channel.id))))throw Error('Native audio telemetry channels changed');
      if(target.insert && value.inserts_available===true && !bin.insert)throw Error('The requested native insert telemetry is missing');
      if(bin.insert && (!target.insert || bin.insert.channel!==target.insert.channel || bin.insert.index!==target.insert.index || !['Equalizer','MultibandCompressor'].includes(bin.insert.kind) || ['before_db','after_db'].some(key=>!Array.isArray(bin.insert[key]) || bin.insert[key].length!==128 || bin.insert[key].some(db=>!Number.isFinite(db))) || ['band_level','reduction_db'].some(key=>!Array.isArray(bin.insert[key]) || bin.insert[key].length!==3 || bin.insert[key].some(value=>!Number.isFinite(value)))))throw Error('Invalid native insert telemetry');
      end=bin.end_sample;
    }
    return {...value,next_bin:next};
  }
  async function readPage(target,from,signal){
    const query=new URLSearchParams({...programQuery(target.playback.query),from_bin:from,limit:16});
    if(target.insert){query.set('insert_channel',target.insert.channel);query.set('insert_index',target.insert.index);}
    const response=await fetcher(`/api/v1/preview/program/${encodeURIComponent(target.playback.job_id)}/meters?${query}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),cache:'no-store'});
    const value=await response.json();if(!response.ok)throw Error(value.error?.message || value.error?.code || 'Prepared audio telemetry unavailable');return value;
  }
  async function refresh(final=false){
    if(terminal && !final)return;
    const target=final?terminalTarget():getTarget(),playback=target?.playback;
    if(!playback || !finiteSample(playback.sample)){invalidate();onStatus('STALE · no verified prepared Program audio');return;}
    const identity=playbackIdentity(target);
    if(binding!==identity || lastSample!==null && playback.sample<lastSample){invalidate();binding=identity;}
    if(unavailable)return;
    if(!playback.playing && !final){if(lastResult)onRead({...lastResult,channels:envelope.read()},target);return;}
    if(pending)return;
    const seq=sequence;pending=true;controller=new AbortController();const signal=terminal?AbortSignal.any([controller.signal,terminal.controller.signal]):controller.signal;
    try{
      const peaks=new Map();let selected=null,insertMax=null;
      let reads=0;
      while(reads<4){
        const live=current(identity);if(seq!==sequence || !live || !live.playback.playing && !final)return;
        if(!metadata){reads++;page=checked(await readPage(live,0,signal),identity,0);if(seq!==sequence)return;metadata=page;cursor=Math.max(0,Math.floor((live.playback.sample-metadata.first_bin_sample)/4096)-1);if(cursor!==0)page=null;}
        if(final){
          if(live.playback.sample!==metadata.end_sample)throw Error('The final Program clock does not match its prepared audio end');
          const tail=Math.max(0,metadata.bin_count-(4-reads)*16);
          if(cursor<tail){cursor=tail;page=null;terminal.tailOnly=true;}
        }
        if(cursor>=metadata.bin_count)break;
        if(!page || cursor<page.from_bin || cursor>=page.next_bin){if(reads>=4)break;reads++;page=checked(await readPage(live,cursor,signal),identity,cursor);if(seq!==sequence)return;}
        let progressed=false;
        for(const bin of page.bins.slice(cursor-page.from_bin)){
          if(bin.end_sample>current(identity)?.playback.sample)break;
          selected=bin;cursor++;progressed=true;
          for(const channel of bin.channels){const old=peaks.get(channel.channel) || [0,0];peaks.set(channel.channel,old.map((peak,index)=>Math.max(peak,channel.peak[index])));}
          if(bin.insert){if(!insertMax)insertMax={band_level:[0,0,0],reduction_db:[0,0,0]};for(const key of ['band_level','reduction_db'])insertMax[key]=insertMax[key].map((value,index)=>Math.max(value,bin.insert[key][index]));}
        }
        if(!progressed || cursor<page.next_bin)break;
        page=null;
      }
      if(seq!==sequence || !current(identity))return;
      lastSample=current(identity).playback.sample;
      const channels=envelope.read([...peaks].map(([channel,peak])=>({channel,peak})));
      if(selected){lastResult={...selected,insert:selected.insert?{...selected.insert,...insertMax}:null,sample_rate:metadata.sample_rate,samples:metadata.bin_frames,spectrum_hz:metadata.spectrum_hz,channels,telemetry:true,inserts_available:metadata.inserts_available,inserts_error:metadata.inserts_error,tail_only:Boolean(terminal?.tailOnly)};onRead(lastResult,current(identity));}
      else if(lastResult)onRead({...lastResult,channels},current(identity));
      onStatus((metadata.inserts_available===false && target.insert?`Native prepared playback peaks · ${metadata.inserts_error || 'Insert telemetry unavailable; use Read for a static window'}`:lastResult?`Native prepared playback · audio sample ${lastResult.end_sample}`:'Native prepared audio · waiting for a completed bin')+(terminal?.tailOnly?' · Final tail only':''));
      return Boolean(selected || lastResult && lastResult.end_sample===metadata.end_sample);
    }catch(error){if(seq===sequence && current(identity) && error.name!=='AbortError'){unavailable=true;lastResult=null;envelope.clear();onClear();onStatus(`Telemetry unavailable · ${error.message}`);}}
    finally{if(seq===sequence)pending=false;}
  }
  async function finishPlayback(playback,isCurrent=()=>true){
    const base=getTarget();if(terminal || !base || !playback || !finiteSample(playback.sample) || !isCurrent())return false;
    const identity=playbackIdentity({...base,playback});
    if(binding!==identity){invalidate();binding=identity;}
    else {sequence++;controller?.abort();pending=false;}
    const owner={playback:structuredClone(playback),identity,insert:JSON.stringify(base.insert),isCurrent,controller:new AbortController(),tailOnly:false};terminal=owner;
    let timer;
    try{
      return Boolean(await Promise.race([refresh(true),new Promise(resolve=>{timer=setTimeout(()=>{if(terminal===owner){sequence++;owner.controller.abort();pending=false;if(owner.isCurrent())onStatus('Final prepared audio telemetry timed out');}resolve(false);},1000);})]) && terminal===owner && terminalTarget());
    }finally{clearTimeout(timer);if(terminal===owner){owner.controller.abort();terminal=null;}}
  }
  return {refresh,invalidate,finishPlayback,active:()=>binding!==null};
}

export function createAudioMeters({root,getTarget,isPlaying,onTransport,getPlayback,fetcher}) {
  const select=root.querySelector("select"),status=root.querySelector("[data-meter-status]"),rows=root.querySelector("[data-meter-rows]"),svg=root.querySelector("svg"),context=root.querySelector("[data-meter-context]");
  const live=root.querySelector("input[type=checkbox]");
  const ns="http://www.w3.org/2000/svg";
  let optionsKey=null,timer=null,channelKey=null,channelViews=[];
  function element(tag,attrs,text) { const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);if(text)node.textContent=text;svg.append(node);return node; }
  for(const db of [0,-24,-48,-72,-96]) {const y=12-db/96*140;element("line",{x1:38,x2:595,y1:y,y2:y,stroke:"var(--border)"});element("text",{x:1,y:y+4,fill:"var(--muted)","font-size":10},`${db}`);}
  for(const hz of [20,100,1000,10000,20000])element("text",{x:38+Math.log10(hz/20)/3*550,y:176,fill:"var(--muted)","font-size":10},hz>=1000?`${hz/1000}k`:`${hz}`);
  const before=element("polyline",{fill:"none",stroke:"var(--violet)","stroke-width":1.5}),after=element("polyline",{fill:"none",stroke:"var(--success)","stroke-width":1.5});
  const points=(values,result)=>values.map((db,index)=>({db,hz:result.spectrum_hz?.[index] ?? index*result.sample_rate/result.samples})).filter(({hz})=>hz>=20 && hz<=20000).map(({db,hz})=>`${38+Math.log10(hz/20)/3*550},${12-Math.max(-96,Math.min(0,db))/96*140}`).join(" ");
  function target() {
    const current=getTarget();if(!current)return null;
    const key=JSON.stringify([current.query.project_epoch,current.query.if_generation,current.query.timeline_id,current.query.revision]);
    if(key!==optionsKey) {
      optionsKey=key;const previous=select.value;select.replaceChildren(new Option("Master output",""));
      for(const channel of current.channels)for(const [index,effect] of channel.effects.entries()) {
        if(effect.enabled && ["Equalizer","MultibandCompressor"].includes(effectName(effect)))select.append(new Option(`${channel.label} · ${index+1} ${effectName(effect)}`,JSON.stringify({channel:channel.id,index})));
      }
      if([...select.options].some(option=>option.value===previous))select.value=previous;
    }
    return {...current,insert:select.value?JSON.parse(select.value):null};
  }
  function draw(result,current) {
    root.dataset.stale="false";
    const key=JSON.stringify(current.channels.map(channel=>[channel.id,channel.label]));
    if(key!==channelKey) {
      channelKey=key;rows.replaceChildren();channelViews=[];
      for(const channel of current.channels) {
        const row=document.createElement("div"),label=document.createElement("strong"),readout=document.createElement("span");label.textContent=channel.label;row.className="audio-meter-row";row.append(label);
        const meters=["L","R"].map(side=>{const meter=document.createElement("meter");meter.min=-60;meter.max=6;meter.low=-18;meter.high=0;meter.optimum=-12;meter.value=-60;meter.setAttribute("aria-label",`${channel.label} ${side} dBFS`);row.append(meter);return meter;});
        row.append(readout);rows.append(row);channelViews.push({id:channel.id,meters,readout});
      }
    }
    const db=value=>value===null?"−∞":value.toFixed(1);
    for(const row of channelViews) {
      const value=result.channels.find(channel=>channel.channel===row.id);if(!value)continue;
      value.db.forEach((reading,index)=>{row.meters[index].value=reading===null?-60:reading;});
      row.readout.textContent=`L ${db(value.db[0])} · R ${db(value.db[1])} dBFS${value.hold_db?` · Peak ${db(value.hold_db[0])} / ${db(value.hold_db[1])}`:''}${value.clipped.some(Boolean)?" · CLIP":""}`;
    }
    before.setAttribute("points",result.insert?points(result.insert.before_db,result):"");
    after.setAttribute("points",points(result.insert?.after_db || result.master_spectrum_db,result));
    const band=result.insert?.reduction_db;
    context.textContent=(result.insert?`Violet: before ${result.insert.kind} · green: after.${result.insert.kind==="MultibandCompressor"?` Band reduction L/M/H: ${band.map(value=>value.toFixed(1)).join(" / ")} dB`:""}${result.insert.inactive?' · Native insert inactive in this bin':''}` : `Green: native post-fader master output · 20 Hz–20 kHz / 0 to −96 dBFS.${result.master_peak_hz===null?" Silence":` Peak bin ${result.master_peak_hz.toFixed(1)} Hz`}`)+(result.telemetry?' · 128 logarithmic display bands from the prepared native mix':' · Static analysis window');
  }
  function clearDisplay(){root.dataset.stale='true';for(const row of channelViews){for(const meter of row.meters)meter.value=-60;row.readout.textContent='';}before.setAttribute('points','');after.setAttribute('points','');}
  const reader=createMeterReader({getTarget:target,onRead:draw,onStatus:message=>{if(message!=="Reading native audio…" || !status.textContent.startsWith("Native"))status.textContent=message;if(!message.startsWith("Native") && message!=="Reading native audio…")root.dataset.stale="true";},fetcher});
  const playbackReader=createPlaybackMeterReader({getTarget:target,onRead:draw,onClear:clearDisplay,onStatus:message=>{status.textContent=message;if(!message.startsWith('Native prepared playback'))root.dataset.stale='true';},fetcher});
  function invalidate(){reader.invalidate();playbackReader.invalidate();clearDisplay();}
  function readCurrent(){reader.invalidate();playbackReader.invalidate();reader.refresh();}
  function followPlayback(){if(!playbackReader.active())reader.invalidate();playbackReader.refresh();}
  const play=root.querySelector("[data-meter-play]"),playback=root.querySelector("[data-meter-playback]");
  function syncTransport(){const state=getPlayback();play.textContent=state.label;playback.textContent=state.status;}
  select.addEventListener("change",()=>{invalidate();if(live.checked && isPlaying())followPlayback();else reader.refresh();});
  root.querySelector("[data-meter-refresh]").addEventListener("click",()=>{live.checked=false;readCurrent();});
  play.addEventListener("click",()=>{onTransport();syncTransport();});
  root.querySelector("[data-meter-close]").addEventListener("click",()=>root.close());
  root.addEventListener("close",()=>{clearInterval(timer);invalidate();});
  root.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();root.close();}});
  live.addEventListener("change",()=>{invalidate();if(live.checked)followPlayback();});
  return {
    open(){if(!root.open)root.show();syncTransport();if(live.checked && isPlaying())followPlayback();else readCurrent();clearInterval(timer);timer=setInterval(()=>{if(!root.open)return;syncTransport();if(live.checked && !document.hidden && (isPlaying() || playbackReader.active()))followPlayback();},250);},
    invalidate,
    finishPlayback(playback,isCurrent=()=>true){if(!root.open || !live.checked)return Promise.resolve(false);reader.invalidate();return playbackReader.finishPlayback(playback,()=>root.open && live.checked && isCurrent());},
    refresh(){if(root.open){if(live.checked && isPlaying())followPlayback();else readCurrent();}},
  };
}
