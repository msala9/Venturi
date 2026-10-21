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

export function createAudioMeters({root,getTarget,isPlaying,onTransport,getPlayback,fetcher}) {
  const select=root.querySelector("select"),status=root.querySelector("[data-meter-status]"),rows=root.querySelector("[data-meter-rows]"),svg=root.querySelector("svg"),context=root.querySelector("[data-meter-context]");
  const live=root.querySelector("input[type=checkbox]");
  const ns="http://www.w3.org/2000/svg";
  let optionsKey=null,timer=null,channelKey=null,channelViews=[];
  function element(tag,attrs,text) { const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);if(text)node.textContent=text;svg.append(node);return node; }
  for(const db of [0,-24,-48,-72,-96]) {const y=12-db/96*140;element("line",{x1:38,x2:595,y1:y,y2:y,stroke:"var(--border)"});element("text",{x:1,y:y+4,fill:"var(--muted)","font-size":10},`${db}`);}
  for(const hz of [20,100,1000,10000,20000])element("text",{x:38+Math.log10(hz/20)/3*550,y:176,fill:"var(--muted)","font-size":10},hz>=1000?`${hz/1000}k`:`${hz}`);
  const before=element("polyline",{fill:"none",stroke:"var(--violet)","stroke-width":1.5}),after=element("polyline",{fill:"none",stroke:"var(--success)","stroke-width":1.5});
  const points=(values,result)=>values.map((db,index)=>({db,hz:index*result.sample_rate/result.samples})).filter(({hz})=>hz>=20 && hz<=20000).map(({db,hz})=>`${38+Math.log10(hz/20)/3*550},${12-Math.max(-96,Math.min(0,db))/96*140}`).join(" ");
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
      row.readout.textContent=`L ${db(value.db[0])} · R ${db(value.db[1])} dBFS${value.clipped.some(Boolean)?" · CLIP":""}`;
    }
    before.setAttribute("points",result.insert?points(result.insert.before_db,result):"");
    after.setAttribute("points",points(result.insert?.after_db || result.master_spectrum_db,result));
    const band=result.insert?.reduction_db;
    context.textContent=result.insert?`Violet: before ${result.insert.kind} · green: after.${result.insert.kind==="MultibandCompressor"?` Band reduction L/M/H: ${band.map(value=>value.toFixed(1)).join(" / ")} dB`:""}` : `Green: native post-fader master output · 20 Hz–20 kHz / 0 to −96 dBFS.${result.master_peak_hz===null?" Silence":` Peak bin ${result.master_peak_hz.toFixed(1)} Hz`}`;
  }
  const reader=createMeterReader({getTarget:target,onRead:draw,onStatus:message=>{if(message!=="Reading native audio…" || !status.textContent.startsWith("Native"))status.textContent=message;if(!message.startsWith("Native") && message!=="Reading native audio…")root.dataset.stale="true";},fetcher});
  const play=root.querySelector("[data-meter-play]"),playback=root.querySelector("[data-meter-playback]");
  function syncTransport(){const state=getPlayback();play.textContent=state.label;playback.textContent=state.status;}
  select.addEventListener("change",()=>{reader.invalidate();reader.refresh();});
  root.querySelector("[data-meter-refresh]").addEventListener("click",()=>{reader.invalidate();reader.refresh();});
  play.addEventListener("click",()=>{onTransport();syncTransport();});
  root.querySelector("[data-meter-close]").addEventListener("click",()=>root.close());
  root.addEventListener("close",()=>{clearInterval(timer);reader.invalidate();});
  root.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();root.close();}});
  live.addEventListener("change",()=>{if(live.checked)reader.refresh();else reader.invalidate();});
  return {
    open(){if(!root.open)root.show();syncTransport();reader.refresh();clearInterval(timer);timer=setInterval(()=>{if(!root.open)return;syncTransport();if(live.checked && !document.hidden && isPlaying())reader.refresh();},250);},
    invalidate:reader.invalidate,
    refresh(){if(root.open)reader.refresh();},
  };
}
