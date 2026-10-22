import { request } from "./api.js";
import {renderAudioPresets} from './audio-presets.js';

export function mixerDraftContext(query) {
  const params=new URLSearchParams(query),keys=['project_epoch','if_generation','timeline_id','revision'];
  return keys.every(key=>params.get(key))?JSON.stringify(keys.map(key=>params.get(key))):null;
}
export function renderMixer(root, timeline, { writable, commit, notice, open = false, catalog, openPaths = new Set(), query, onMeters, audioPresets, meters, mixDrafts }) {
  const customPresets=audioPresets?{...audioPresets,expectedContext:{...audioPresets.getContext()}}:null;
  const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Audio mixer";section.open=open;section.append(summary);
  const tracks=timeline.tracks.filter((track)=>track.kind === "audio").map((track)=>({channel:track.id,label:track.label || track.id,locked:track.locked,solo:track.solo,muted:track.muted,...track.mix}));
  tracks.push({channel:"master",label:"Master",locked:false,...timeline.master});
  const meterViews=[],mixInputs=[],context=mixerDraftContext(query);
  const restored=context && mixDrafts?.context===context?mixDrafts.channels:[];
  let disposed=false;
  for(const track of tracks) {
    const form=document.createElement("form"),heading=document.createElement("strong");form.className='mixer-strip';heading.textContent=track.label;form.append(heading);
    if(track.channel!=='master'){
      const flags=document.createElement('div');flags.className='mixer-strip-flags';
      for(const [field,label] of [['solo','Solo'],['muted','Mute']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',`${track.label} ${label}`);button.setAttribute('aria-pressed',String(Boolean(track[field])));button.disabled=!writable || track.locked;
        button.addEventListener('click',async()=>{if(button.disabled || section.isConnected===false)return;button.disabled=true;try{await commit({kind:'set_track',track:track.channel,[field]:!track[field]});}catch(error){notice(error.message);}finally{button.disabled=!writable || track.locked;}});flags.append(button);
      }
      form.append(flags);
    }
    const peak=document.createElement('div'),readout=document.createElement('output');peak.className='mixer-strip-peaks';
    const bars=['L','R'].map(side=>{const bar=document.createElement('meter');bar.min=-60;bar.max=6;bar.low=-18;bar.high=0;bar.optimum=-12;bar.value=-60;bar.setAttribute('aria-label',`${track.label} ${side} dBFS`);peak.append(bar);return bar;});
    readout.textContent='—';peak.append(readout);form.append(peak);meterViews.push({id:track.channel,bars,readout});
    const inputs={};
    for(const [key,label,min,max] of [["gain_db","Gain dB",-100,30],["pan","Balance L/R",-1,1]]) {
      const row=document.createElement("label");row.className="field";row.textContent=`${track.label} ${label}`;
      const input=document.createElement("input");input.type="number";input.step="any";input.min=min;input.max=max;input.value=restored?.find(row=>row.channel===track.channel)?.[key] ?? track[key];input.disabled=!writable || track.locked;input.required=true;inputs[key]=input;
      row.append(input);form.append(row);
    }
    const button=document.createElement("button");button.textContent=`Apply ${track.label} mix`;button.disabled=!writable || track.locked;form.append(button);
    let waiting=false;
    form.addEventListener("submit",async(event)=>{event.preventDefault();if(disposed || waiting || button.disabled || !writable || track.locked || section.isConnected===false || !form.reportValidity())return;waiting=true;button.disabled=true;try{await commit({kind:"set_mixer",channel:track.channel,gain_db:Number(inputs.gain_db.value),pan:Number(inputs.pan.value)});}catch(error){notice(error.message);}finally{waiting=false;button.disabled=!writable || track.locked;}});
    mixInputs.push({channel:track.channel,inputs});
    section.append(form);
    if(catalog) renderEffects(section,track,catalog,!writable || track.locked,commit,notice,openPaths,timeline.id,query,customPresets);
  }
  if(onMeters){const meters=document.createElement("button");meters.textContent="Open native meters / spectrum";meters.addEventListener("click",onMeters);section.append(meters);}
  const note=document.createElement("p");note.className="muted";note.textContent="Native timeline mix. Source playback uses the original source audio.";section.append(note);
  const meterStatus=document.createElement('p');meterStatus.className='muted mixer-meter-status';meterStatus.textContent='No current prepared audio';section.append(meterStatus);
  root.append(section);
  const visible=()=>section.open && section.isConnected!==false && (section.getClientRects?.().length ?? 1)>0 && meters.visible();
  const clear=()=>{for(const row of meterViews){for(const bar of row.bars)bar.value=-60;row.readout.textContent='—';}meterStatus.textContent='No current prepared audio';};
  const unsubscribe=meters?.subscribe({query:Object.fromEntries(new URLSearchParams(query)),visible,isCurrent:()=>section.isConnected!==false,onClear:clear,onStatus:message=>{if(!message.startsWith('Native prepared playback'))meterStatus.textContent=message;},onRead:result=>{
    if(!visible())return;
    for(const row of meterViews){const channel=result.channels.find(channel=>channel.channel===row.id);if(!channel)continue;channel.db.forEach((db,index)=>row.bars[index].value=db===null?-60:db);const db=value=>value===null?'−∞':value.toFixed(1);row.readout.textContent=`${db(channel.db[0])} / ${db(channel.db[1])} dBFS${channel.clipped.some(Boolean)?' · CLIP':''}`;}
    meterStatus.textContent=`LIVE · native prepared audio · sample ${result.end_sample}`;
  }});
  const syncMeters=()=>meters?.sync();section.addEventListener('toggle',syncMeters);
  section.captureMixDrafts=()=>context?{context,channels:mixInputs.map(({channel,inputs})=>({channel,gain_db:String(inputs.gain_db.value),pan:String(inputs.pan.value)}))}:null;
  section.disposeMeters=()=>{disposed=true;unsubscribe?.();section.removeEventListener('toggle',syncMeters);};
  return section;
}
export function effectName(effect) {return typeof effect.kind === "string" ? effect.kind : Object.keys(effect.kind)[0];}
export function chainOperation(channel,effects) {return {kind:"set_audio_effects",channel,effects};}
export function normalizationModeTarget(previousMode,nextMode,target,catalog) {
  const next=catalog.find(value=>value.mode===nextMode);
  if(!next || !catalog.some(value=>value.mode===previousMode))throw new Error("Choose a native normalization mode");
  return (previousMode==='Loudness')!==(nextMode==='Loudness')?next.default:target;
}
function renderEffects(root,track,catalog,disabled,commit,notice,openPaths,timeline,query,audioPresets) {
  const section=document.createElement("details"),summary=document.createElement("summary");section.dataset.mixerPath=`${track.channel}:effects`;section.open=openPaths.has(section.dataset.mixerPath);summary.textContent=`${track.label} inserts (${track.effects.length})`;section.append(summary);root.append(section);
  let built=false;
  section.addEventListener("toggle",()=>{
    if(!section.open || built) return;built=true;
    const report=(effects)=>commit(chainOperation(track.channel,effects)).catch((error)=>notice(error.message));
    const choices=document.createElement("select");choices.setAttribute("aria-label",`${track.label} insert type`);choices.disabled=disabled;
    for(const key of Object.keys(catalog.defaults)) choices.append(new Option(key,key));section.append(choices);
    const add=document.createElement("button");add.textContent=`Add ${track.label} insert`;add.disabled=disabled || track.effects.length>=32;add.addEventListener("click",()=>report([...track.effects,structuredClone(catalog.defaults[choices.value])]));section.append(add);
    for(const [index,effect] of track.effects.entries()) {
      const card=document.createElement("details"),heading=document.createElement("summary");card.dataset.mixerPath=`${track.channel}:effects:${index}`;card.open=openPaths.has(card.dataset.mixerPath);heading.textContent=`${index+1} · ${effectName(effect)}${effect.enabled ? "" : " · bypassed"}`;card.append(heading);section.append(card);
      let ready=false;
      card.addEventListener("toggle",()=>{
        if(!card.open || ready)return;ready=true;
        const draft=structuredClone(effect),form=document.createElement("form");card.append(form);
        function check(label,object,key) {
          const row=document.createElement("label");row.className="field";row.textContent=label;
          const input=document.createElement("input");input.type="checkbox";input.checked=object[key];input.disabled=disabled;
          input.addEventListener("change",()=>{object[key]=input.checked;});row.append(input);form.append(row);
        }
        function number(label,object,key,range) {
          const row=document.createElement("label");row.className="field";row.textContent=label;
          const input=document.createElement("input");input.type="number";input.step="any";input.required=true;input.min=range[0];input.max=range[1];input.value=object[key];input.disabled=disabled;
          input.addEventListener("input",()=>{object[key]=Number(input.value);});row.append(input);form.append(row);return input;
        }
        function select(label,object,key,values) {
          const row=document.createElement("label");row.className="field";row.textContent=label;
          const input=document.createElement("select");input.disabled=disabled;for(const value of values)input.append(new Option(value,value));input.value=object[key];
          input.addEventListener("change",()=>{object[key]=input.value;});row.append(input);form.append(row);return input;
        }
        check(`${track.label} insert ${index+1} enabled`,draft,"enabled");
        const kind=effectName(effect),data=typeof draft.kind === "string" ? null : draft.kind[kind];
        if(catalog.presets?.[kind]) {
          const heading=document.createElement('p');heading.className='muted';heading.textContent='Built-in presets';form.append(heading);
          const presets=document.createElement("select");presets.setAttribute("aria-label",`${track.label} ${kind} preset`);presets.disabled=disabled;
          presets.append(new Option("Choose a preset…",""));
          for(const name of catalog.presets[kind])presets.append(new Option(name.split("preset_")[1].replaceAll("_"," "),name));
          const apply=document.createElement("button");apply.type="button";apply.textContent=`Apply ${track.label} ${kind} preset`;apply.disabled=true;presets.addEventListener("change",()=>{apply.disabled=disabled || !presets.value;});
          apply.addEventListener("click",()=>commit({kind:"apply_audio_preset",channel:track.channel,index,preset:presets.value}).catch((error)=>notice(error.message)));
          form.append(presets,apply);
        }
        if(kind === "Equalizer") {
          const graph=document.createElement("div");graph.textContent="Reading committed native EQ response…";form.append(graph);
          request(`/timelines/${encodeURIComponent(timeline)}/audio/${encodeURIComponent(track.channel)}/eq/${index}?${query}`).then((response)=>{if(card.isConnected)drawEq(graph,response);}).catch((error)=>{if(card.isConnected)graph.textContent=error.message;});
          for(const [bandIndex,band] of data.bands.entries()) {
          const prefix=`${track.label} EQ band ${bandIndex+1}`;check(`${prefix} enabled`,band,"enabled");select(`${prefix} shape`,band,"shape",catalog.eq.shapes);
          for(const [key,label] of [["freq_hz","Hz"],["gain_db","gain dB"],["q","Q"]])number(`${prefix} ${label}`,band,key,catalog.eq[key]);
          }
        }
        if(kind === "MultibandCompressor") {
          for(const index of [0,1])number(`${track.label} crossover ${index+1} Hz`,data.crossovers_hz,index,catalog.compressor.crossovers_hz);
          for(const [bandIndex,band] of data.bands.entries()) for(const key of ["threshold_db","ratio","attack_ms","release_ms","makeup_db"])number(`${track.label} compressor band ${bandIndex+1} ${key}`,band,key,catalog.compressor[key]);
        }
        if(audioPresets && ['Equalizer','MultibandCompressor'].includes(kind)){
          const visible=()=>card.isConnected && card.open && section.open && root.open && section.isConnected;
          const custom=renderAudioPresets(form,{...audioPresets,kind,channel:track.channel,index,label:`${track.label} insert ${index+1}`,getParameters:()=>draft.kind,validateDraft:()=>form.reportValidity(),isCurrent:visible,canCommit:()=>!disabled && audioPresets.canCommit(),commit,notice});
          const refresh=()=>{if(visible())void custom.load().catch(error=>{if(custom.current())notice(error.message);});else custom.suspend();};
          for(const details of [card,section,root])details.addEventListener('toggle',refresh);
        }
        if(kind === "Normalize") {
          let previousMode=data.mode;
          const mode=select(`${track.label} normalization mode`,data,"mode",catalog.normalization.map((value)=>value.mode));
          const range=()=>catalog.normalization.find((value)=>value.mode===data.mode);
          const target=number(`${track.label} normalization target`,data,"target_db",range().range);
          if(track.channel!=="master")select(`${track.label} clip level policy`,data,"set_level",["Independent","Relative"]);
          mode.addEventListener("change",()=>{const value=range();data.target_db=normalizationModeTarget(previousMode,data.mode,data.target_db,catalog.normalization);previousMode=data.mode;target.min=value.range[0];target.max=value.range[1];target.value=data.target_db;});
        }
        const apply=document.createElement("button");apply.textContent=`Apply ${track.label} insert ${index+1}`;apply.disabled=disabled;form.append(apply);
        form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())report(track.effects.map((entry,i)=>i===index ? draft : entry));});
        for(const [label,delta] of [["Move up",-1],["Move down",1],["Remove",0]]) {
          const button=document.createElement("button");button.type="button";button.textContent=`${label} ${track.label} insert ${index+1}`;button.disabled=disabled || (delta && (index+delta<0 || index+delta>=track.effects.length));
          button.addEventListener("click",()=>{const effects=[...track.effects];const [entry]=effects.splice(index,1);if(delta)effects.splice(index+delta,0,entry);report(effects);});form.append(button);
        }
      });
    }
  });
}
function drawEq(root,response) {
  const canvas=document.createElement("canvas"),note=document.createElement("p");canvas.className="eq-response";canvas.width=480;canvas.height=240;canvas.setAttribute("role","img");canvas.setAttribute("aria-label","Native equalizer frequency response from 20 Hz to 20 kHz, displayed within -24 to +24 dB");
  const ctx=canvas.getContext("2d");ctx.fillStyle="#100d14";ctx.fillRect(0,0,480,240);ctx.strokeStyle="#5a4e60";ctx.beginPath();ctx.moveTo(0,120);ctx.lineTo(480,120);ctx.stroke();
  ctx.strokeStyle="#ffad45";ctx.beginPath();
  for(const [index,[frequency,gain]] of response.points.entries()) {const x=Math.log10(frequency/20)/3*480,y=120-Math.max(-24,Math.min(24,gain))*5;if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();
  note.className="muted";note.textContent=`Committed native response · ${response.sample_rate} Hz · 20–20k Hz · ±24dB display${response.enabled ? "" : " · bypassed"}`;root.replaceChildren(canvas,note);
}
