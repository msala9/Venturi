import { request } from "./api.js";
import {renderAudioPresets} from './audio-presets.js';
import {bindMixerControl,mixerGainPosition} from './mixer-controls.js';
import {createAudioGraph,compressorActivitySample,equalizerActivitySample} from './audio-graphs.js';
import {createCompressorControls} from './compressor-controls.js';
import {createEqControls} from './eq-controls.js';
import {createMixerInsertStack,editMixerEffects} from './mixer-inserts.js';

export function mixerDraftContext(query) {
  const params=new URLSearchParams(query),keys=['project_epoch','if_generation','timeline_id','revision'];
  return keys.every(key=>params.get(key))?JSON.stringify(keys.map(key=>params.get(key))):null;
}
export function renderMixer(root, timeline, { writable, commit, commitEffects=operation=>commit(operation), notice, open = false, catalog, openPaths = new Set(), query, onMeters, audioPresets, meters, mixDrafts, canInteract=()=>true, canRead=canInteract }) {
  const customPresets=audioPresets?{...audioPresets,expectedContext:{...audioPresets.getContext()}}:null;
  const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Audio mixer";section.open=open;section.append(summary);
  const console=document.createElement('div');console.className='mixer-console';section.append(console);
  const tracks=timeline.tracks.filter((track)=>track.kind === "audio").map((track)=>({channel:track.id,label:track.label || track.id,locked:track.locked,solo:track.solo,muted:track.muted,...track.mix}));
  tracks.push({channel:"master",label:"Master",locked:false,...timeline.master});
  const effectSlots=Math.max(0,...tracks.map(track=>track.effects.length));
  const meterViews=[],mixInputs=[],directControls=[],effectDisposers=[],effectCancels=[],effectSyncs=[],insertStacks=[],context=mixerDraftContext(query);
  const restored=context && mixDrafts?.context===context?mixDrafts.channels:[];
  let disposed=false;
  const submit=commit,submitEffects=commitEffects;
  commit=operation=>{if(disposed || !canInteract())return Promise.reject(Error('The Mixer window is hidden or its context changed'));return submit(operation);};
  commitEffects=(operation,edit)=>{if(disposed || !canInteract())return Promise.reject(Error('The Mixer window is hidden or its context changed'));return submitEffects(operation,edit);};
  for(const track of tracks) {
    const form=document.createElement("form"),heading=document.createElement("strong");form.className='mixer-strip';heading.textContent=track.label;form.append(heading);
    const insertHost=document.createElement('div');form.append(insertHost);
    if(track.channel!=='master'){
      const flags=document.createElement('div');flags.className='mixer-strip-flags';
      for(const [field,label] of [['solo','Solo'],['muted','Mute']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',`${track.label} ${label}`);button.setAttribute('aria-pressed',String(Boolean(track[field])));button.disabled=!writable || track.locked;
        button.addEventListener('click',async()=>{if(button.disabled || section.isConnected===false)return;button.disabled=true;try{await commit({kind:'set_track',track:track.channel,[field]:!track[field]});}catch(error){notice(error.message);}finally{button.disabled=!writable || track.locked;}});flags.append(button);
      }
      form.append(flags);
    }else{const spacer=document.createElement('div');spacer.className='mixer-strip-flags';spacer.setAttribute('aria-hidden','true');form.append(spacer);}
    const peak=document.createElement('div'),readout=document.createElement('output');peak.className='mixer-strip-peaks';
    const bars=['L','R'].map(side=>{const bar=document.createElement('meter');bar.min=-60;bar.max=6;bar.low=-18;bar.high=0;bar.optimum=-12;bar.value=-60;bar.setAttribute('aria-label',`${track.label} ${side} dBFS`);peak.append(bar);return bar;});
    readout.textContent='—';peak.append(readout);form.append(peak);meterViews.push({id:track.channel,bars,readout});
    const inputs={};
    for(const [key,label,min,max] of [["gain_db","Gain dB",-100,30],["pan","Balance L/R",-1,1]]) {
      const row=document.createElement("label");row.className="field";row.textContent=`${track.label} ${label}`;
      const input=document.createElement("input");input.type="number";input.step="any";input.min=min;input.max=max;input.value=restored?.find(row=>row.channel===track.channel)?.[key] ?? track[key];input.disabled=!writable || track.locked;input.required=true;inputs[key]=input;
      row.append(input);form.append(row);
    }
    const direct=document.createElement('div');direct.className='mixer-direct';
    const pan=document.createElement('button');pan.type='button';pan.className='mixer-pan';pan.disabled=!writable || track.locked;pan.setAttribute('aria-label',`${track.label} balance`);pan.title='Drag up/right to pan right · Shift for precision · double-click or Enter to center';
    const needle=document.createElement('span');needle.className='mixer-pan-needle';needle.setAttribute('aria-hidden','true');pan.append(needle);direct.append(pan);
    const fader=document.createElement('button');fader.type='button';fader.className='mixer-fader';fader.disabled=!writable || track.locked;fader.setAttribute('aria-label',`${track.label} gain fader`);fader.title='Drag vertically to adjust gain · Shift for precision · double-click or Enter for 0 dB';
    const rail=document.createElement('span');rail.className='mixer-fader-rail';rail.setAttribute('aria-hidden','true');
    for(const db of [12,6,0,-6,-12,-20,-30,-40,-60]){const tick=document.createElement('span');tick.className='mixer-fader-tick';tick.style?.setProperty('bottom',`${mixerGainPosition(db)*100}%`);tick.textContent=db>0?`+${db}`:String(db);rail.append(tick);}
    const cap=document.createElement('span');cap.className='mixer-fader-cap';rail.append(cap);fader.append(rail);direct.append(fader);form.append(direct);
    const button=document.createElement("button");button.textContent=`Apply ${track.label} mix`;button.disabled=!writable || track.locked;form.append(button);
    let waiting=false;
    const nativeState=()=>{const channel=track.channel==='master'?timeline.master:timeline.tracks.find(item=>item.id===track.channel);return JSON.stringify([audioPresets?.getContext?.() ?? context,channel?.locked,channel?.mix?.gain_db ?? channel?.gain_db,channel?.mix?.pan ?? channel?.pan]);};
    const expected=nativeState(),available=()=>!disposed && !waiting && canInteract() && writable && !track.locked && section.isConnected!==false && section.open && (section.getClientRects?.().length ?? 1)>0 && !document.querySelector?.('dialog[open]') && nativeState()===expected;
    for(const [kind,element] of [['gain_db',fader],['pan',pan]]){
      let previous;
      const control=bindMixerControl(element,{kind,value:track[kind],canInteract:available,getContext:nativeState,onStart:()=>{previous=String(inputs[kind].value);},onDraft:value=>{inputs[kind].value=String(value);},onCancel:()=>{if(previous!==undefined)inputs[kind].value=previous;},onCommit:async value=>{waiting=true;button.disabled=true;try{await commit({kind:'set_mixer',channel:track.channel,[kind]:value});}finally{waiting=false;button.disabled=!writable || track.locked;}},notice});
      directControls.push(control);inputs[kind].addEventListener('input',()=>{const value=inputs[kind].value;control.cancel();inputs[kind].value=value;});
    }
    form.addEventListener("submit",async(event)=>{event.preventDefault();if(disposed || waiting || button.disabled || !writable || track.locked || section.isConnected===false || !form.reportValidity())return;waiting=true;button.disabled=true;try{await commit({kind:"set_mixer",channel:track.channel,gain_db:Number(inputs.gain_db.value),pan:Number(inputs.pan.value)});}catch(error){notice(error.message);}finally{waiting=false;button.disabled=!writable || track.locked;}});
    mixInputs.push({channel:track.channel,inputs});
    console.append(form);
    if(catalog){
      const effects=renderEffects(section,track,catalog,!writable || track.locked,commit,commitEffects,notice,openPaths,timeline.id,query,customPresets,meters,canRead);
      const expected=JSON.stringify(audioPresets?.getContext?.() ?? query),current=()=>!disposed && section.isConnected!==false && section.open && JSON.stringify(audioPresets?.getContext?.() ?? query)===expected;
      const stack=createMixerInsertStack({root:insertHost,label:track.label,effects:track.effects,slots:effectSlots,catalog,isCurrent:current,getContext:()=>JSON.stringify(audioPresets?.getContext?.() ?? query),canInteract:()=>writable && !track.locked && current() && (audioPresets?.canCommit?.() ?? true),onOpen:index=>effects.open(index),onEdit:edit=>effects.edit(edit),notice});
      insertStacks.push(stack);effectCancels.push(()=>{stack.cancel();effects.cancel();});effectSyncs.push(effects.sync);effectDisposers.push(()=>{stack.dispose();effects();});
    }
  }
  if(onMeters){const meters=document.createElement("button");meters.textContent="Open native meters / spectrum";meters.addEventListener("click",onMeters);section.append(meters);}
  const note=document.createElement("p");note.className="muted";note.textContent="Native timeline mix. Source playback uses the original source audio.";section.append(note);
  const meterStatus=document.createElement('p');meterStatus.className='muted mixer-meter-status';meterStatus.textContent='No current prepared audio';section.append(meterStatus);
  root.append(section);
  for(const stack of insertStacks)stack.sync();
  const visible=()=>section.open && section.isConnected!==false && (section.getClientRects?.().length ?? 1)>0 && meters.visible();
  const clear=()=>{for(const row of meterViews){for(const bar of row.bars)bar.value=-60;row.readout.textContent='—';}meterStatus.textContent='No current prepared audio';};
  const unsubscribe=meters?.subscribe({query:Object.fromEntries(new URLSearchParams(query)),visible,isCurrent:()=>section.isConnected!==false,onClear:clear,onStatus:message=>{if(!message.startsWith('Native prepared playback'))meterStatus.textContent=message;},onRead:result=>{
    if(!visible())return;
    for(const row of meterViews){const channel=result.channels.find(channel=>channel.channel===row.id);if(!channel)continue;channel.db.forEach((db,index)=>row.bars[index].value=db===null?-60:db);const db=value=>value===null?'−∞':value.toFixed(1);row.readout.textContent=`${db(channel.db[0])} / ${db(channel.db[1])} dBFS${channel.clipped.some(Boolean)?' · CLIP':''}`;}
    meterStatus.textContent=`${result.frozen?'FROZEN':'PLAYING'} · native prepared audio · sample ${result.end_sample}`;
  }});
  const syncMeters=()=>{if(!section.open)for(const control of directControls)control.cancel();meters?.sync();};section.addEventListener('toggle',syncMeters);
  section.captureMixDrafts=()=>{for(const control of directControls)control.cancel();return context?{context,channels:mixInputs.map(({channel,inputs})=>({channel,gain_db:String(inputs.gain_db.value),pan:String(inputs.pan.value)}))}:null;};
  section.cancelGestures=()=>{for(const control of directControls)control.cancel();for(const cancel of effectCancels)cancel();};
  section.syncVisibility=()=>{for(const stack of insertStacks)stack.sync();if(canRead())for(const sync of effectSyncs)sync();};
  section.disposeMeters=()=>{for(const control of directControls)control.dispose();for(const dispose of effectDisposers)dispose();disposed=true;unsubscribe?.();section.removeEventListener('toggle',syncMeters);};
  return section;
}
export function effectName(effect) {return typeof effect.kind === "string" ? effect.kind : Object.keys(effect.kind)[0];}
export function chainOperation(channel,effects) {return {kind:"set_audio_effects",channel,effects};}
export function normalizationModeTarget(previousMode,nextMode,target,catalog) {
  const next=catalog.find(value=>value.mode===nextMode);
  if(!next || !catalog.some(value=>value.mode===previousMode))throw new Error("Choose a native normalization mode");
  return (previousMode==='Loudness')!==(nextMode==='Loudness')?next.default:target;
}
function renderEffects(root,track,catalog,disabled,commit,commitEffects,notice,openPaths,timeline,query,audioPresets,meters,isVisible=()=>true) {
  const graphs=[],cleanups=[],visibilityRefresh=[];let disposed=false;
  const expectedContext=JSON.stringify(audioPresets?.getContext?.() ?? query),cards=[];
  const available=()=>!disposed && !disabled && root.isConnected!==false && root.open && !document.hidden && !document.querySelector?.('dialog[open]') && JSON.stringify(audioPresets?.getContext?.() ?? query)===expectedContext && (audioPresets?.canCommit?.() ?? true);
  const edit=async action=>{const plan=editMixerEffects(track.effects,action);if(!plan)return;if(!available())throw Error('The native insert context changed');return commitEffects(chainOperation(track.channel,plan.effects),action);};
  const section=document.createElement("details"),summary=document.createElement("summary");section.dataset.mixerPath=`${track.channel}:effects`;section.open=openPaths.has(section.dataset.mixerPath);summary.textContent=`${track.label} inserts (${track.effects.length})`;section.append(summary);root.append(section);
  let built=false;
  const build=()=>{
    if(!section.open || built) return;built=true;
    const report=(effects)=>{if(!available())return;return commit(chainOperation(track.channel,effects)).catch((error)=>notice(error.message));};
    const choices=document.createElement("select");choices.setAttribute("aria-label",`${track.label} insert type`);choices.disabled=disabled;
    for(const key of Object.keys(catalog.defaults)) choices.append(new Option(key,key));section.append(choices);
    const add=document.createElement("button");add.textContent=`Add ${track.label} insert`;add.disabled=disabled || track.effects.length>=32;add.addEventListener("click",()=>{if(!add.disabled && section.open)void edit({kind:'add',effect:catalog.defaults[choices.value]}).catch(error=>notice(error.message));});section.append(add);
    for(const [index,effect] of track.effects.entries()) {
      const card=document.createElement("details"),heading=document.createElement("summary");card.dataset.mixerPath=`${track.channel}:effects:${index}`;card.open=openPaths.has(card.dataset.mixerPath);heading.textContent=`${index+1} · ${effectName(effect)}${effect.enabled ? "" : " · bypassed"}`;card.append(heading);section.append(card);
      heading.addEventListener('keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
      let ready=false;
      const buildCard=()=>{
        if(!card.open || ready)return;ready=true;
        const draft=structuredClone(effect),form=document.createElement("form"),bindings=[];let graph=null,dynamics=null,fields=form,clearActivity=()=>{};card.append(form);
        const refreshBindings=except=>{for(const {input,object,key,type} of bindings){if(input===except)continue;if(type==='check')input.checked=object[key];else if(type!=='number' || Number(input.value)!==object[key])input.value=object[key];}};
        const synchronize=except=>{clearActivity();graph?.sync();dynamics?.sync();refreshBindings(except);meters?.sync();};
        function check(label,object,key) {
          const row=document.createElement("label");row.className="field";row.textContent=label;
          const input=document.createElement("input");input.type="checkbox";input.checked=object[key];input.disabled=disabled;
          input.addEventListener("change",()=>{object[key]=input.checked;synchronize();});bindings.push({input,object,key,type:'check'});row.append(input);fields.append(row);
        }
        function number(label,object,key,range) {
          const row=document.createElement("label");row.className="field";row.textContent=label;
          const input=document.createElement("input");input.type="number";input.step="any";input.required=true;input.min=range[0];input.max=range[1];input.value=object[key];input.disabled=disabled;
          input.addEventListener("input",()=>{object[key]=Number(input.value);synchronize(input);});bindings.push({input,object,key,type:'number'});row.append(input);fields.append(row);return input;
        }
        function select(label,object,key,values) {
          const row=document.createElement("label");row.className="field";row.textContent=label;
          const input=document.createElement("select");input.disabled=disabled;for(const value of values)input.append(new Option(value,value));input.value=object[key];
          input.addEventListener("change",()=>{object[key]=input.value;synchronize();});bindings.push({input,object,key,type:'select'});row.append(input);fields.append(row);return input;
        }
        function parameterGroup(name,path,build){const group=document.createElement('details'),summary=document.createElement('summary');group.className='audio-graph-parameters';group.dataset.mixerPath=`${track.channel}:effects:${index}:${path}`;group.open=openPaths.has(group.dataset.mixerPath);summary.textContent=name;group.append(summary);form.append(group);fields=group;build();fields=form;}
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
        if(['Equalizer','MultibandCompressor'].includes(kind)){
          const context=()=>JSON.stringify(audioPresets?.getContext?.() ?? query),expected=context();
          const current=()=>!disposed && isVisible() && card.isConnected!==false && card.open && section.open && root.open && context()===expected;
          const canInteract=()=>!disabled && current() && !document.hidden && (card.getClientRects?.().length ?? 1)>0 && !document.querySelector?.('dialog[open]') && (form.checkValidity?.() ?? true) && (audioPresets?.canCommit?.() ?? true);
          const merge=(target,source)=>{for(const [key,value] of Object.entries(source)){if(value && typeof value==='object' && target[key] && typeof target[key]==='object'){merge(target[key],value);}else target[key]=structuredClone(value);}};
          const applyParameters=async parameters=>{const next=structuredClone(draft);next.kind[kind]=parameters;await commit(chainOperation(track.channel,track.effects.map((entry,own)=>own===index?next:entry)));merge(data,parameters);refreshBindings();graph?.sync();dynamics?.sync();};
          graph=createAudioGraph({root:form,kind,label:`${track.label} insert ${index+1}`,getParameters:()=>data,getEnabled:()=>draft.enabled,defaults:catalog.defaults[kind].kind[kind],catalog:kind==='Equalizer'?catalog.eq:catalog.compressor,canInteract,isCurrent:current,isValid:()=>form.reportValidity(),getContext:context,notice,
            onCommit:applyParameters,onDraft:()=>clearActivity(),
            readResponse:()=>request(`/timelines/${encodeURIComponent(timeline)}/audio/${encodeURIComponent(track.channel)}/${kind==='Equalizer'?'eq':'compressor'}/${index}?${query}`)});
          if(kind==='Equalizer'){
            let previousInputs=[];
            dynamics=createEqControls({root:form,label:`${track.label} insert ${index+1}`,getParameters:()=>data,defaults:catalog.defaults[kind].kind[kind],catalog:catalog.eq,canInteract,isCurrent:current,isValid:()=>form.reportValidity(),getContext:context,notice,
              onStart:()=>{clearActivity();graph.cancel();previousInputs=bindings.filter(binding=>data.bands.includes(binding.object)).map(({input})=>[input,input.value,input.checked]);},
              onDraft:parameters=>{graph.setDraft?.(parameters);for(const {input,object,key,type} of bindings){const band=data.bands.indexOf(object);if(band>=0){if(type==='check')input.checked=parameters.bands[band][key];else input.value=parameters.bands[band][key];}}},
              onCancel:()=>{for(const [input,value,checked] of previousInputs){input.value=value;input.checked=checked;}graph.sync();},onCommit:applyParameters});
            graphs.push(dynamics);
          }else{
            let previousInputs=[];
            dynamics=createCompressorControls({root:form,label:`${track.label} insert ${index+1}`,getParameters:()=>data,defaults:catalog.defaults[kind].kind[kind],catalog:catalog.compressor,canInteract,isCurrent:current,isValid:()=>form.reportValidity(),getContext:context,notice,
              onStart:()=>{clearActivity();graph.cancel();previousInputs=bindings.filter(binding=>binding.type==='number').map(({input})=>[input,input.value]);},
              onDraft:parameters=>{for(const {input,object,key,type} of bindings){const band=data.bands.indexOf(object);if(type==='number' && band>=0)input.value=parameters.bands[band][key];}},
              onCancel:()=>{for(const [input,value] of previousInputs)input.value=value;},onCommit:applyParameters});
            graphs.push(dynamics);
          }
          {
            clearActivity=(message='')=>{graph?.setActivity(null,message);if(kind==='MultibandCompressor')dynamics?.setActivity(null);};
            const nativeParameters=JSON.stringify(data),sampleCurrent=()=>current() && !document.hidden && (card.getClientRects?.().length ?? 1)>0 && (meters?.visible?.() ?? false) && JSON.stringify(data)===nativeParameters && draft.enabled===effect.enabled;
            const unsubscribe=meters?.subscribe({query:Object.fromEntries(new URLSearchParams(query)),insert:{channel:track.channel,index},visible:sampleCurrent,isCurrent:()=>!disposed && card.isConnected!==false && context()===expected,onClear:clearActivity,onStatus:message=>{if(!message.startsWith('Native prepared'))clearActivity(message);},onRead:result=>{
              if(!sampleCurrent()){clearActivity();return;}
              const sample=(kind==='Equalizer'?equalizerActivitySample:compressorActivitySample)(result,{channel:track.channel,index,parameters:data});if(!sample){clearActivity(result.inserts_error || 'No matching native insert sample');return;}graph.setActivity(sample);if(kind==='MultibandCompressor')dynamics.setActivity(sample);
            }});
            if(unsubscribe)cleanups.push(unsubscribe);
          }
          graphs.push(graph);for(const details of [card,section,root]){const toggle=()=>{if(current()){graph.sync();dynamics?.sync();refreshBindings();void graph.refresh();}else{clearActivity();graph.cancel();dynamics?.cancel();}meters?.sync();};details.addEventListener('toggle',toggle);cleanups.push(()=>details.removeEventListener?.('toggle',toggle));}
        }
        if(kind === "Equalizer") {
          for(const [bandIndex,band] of data.bands.entries()) {
            parameterGroup(`Band ${bandIndex+1} · exact values`,`eq-band:${bandIndex}`,()=>{
              const prefix=`${track.label} EQ band ${bandIndex+1}`;check(`${prefix} enabled`,band,"enabled");select(`${prefix} shape`,band,"shape",catalog.eq.shapes);
              for(const [key,label] of [["freq_hz","Hz"],["gain_db","gain dB"],["q","Q"]])number(`${prefix} ${label}`,band,key,catalog.eq[key]);
              const reset=document.createElement('button');reset.type='button';reset.textContent='Reset band';reset.setAttribute('aria-label',`Reset ${prefix}`);reset.disabled=disabled || !catalog.eq.graph;reset.addEventListener('click',()=>graph?.resetBand(bandIndex));fields.append(reset);
            });
          }
        }
        if(kind === "MultibandCompressor") {
          parameterGroup('Crossovers · exact values','crossovers',()=>{for(const index of [0,1])number(`${track.label} crossover ${index+1} Hz`,data.crossovers_hz,index,catalog.compressor.crossovers_hz);});
          for(const [bandIndex,band] of data.bands.entries())parameterGroup(`${['Low','Mid','High'][bandIndex]} band · exact values`,`compressor-band:${bandIndex}`,()=>{for(const key of ["threshold_db","ratio","attack_ms","release_ms","makeup_db"])number(`${track.label} compressor band ${bandIndex+1} ${key}`,band,key,catalog.compressor[key]);});
        }
        if(audioPresets && ['Equalizer','MultibandCompressor'].includes(kind)){
          const visible=()=>isVisible() && card.isConnected && card.open && section.open && root.open && section.isConnected;
          const custom=renderAudioPresets(form,{...audioPresets,kind,channel:track.channel,index,label:`${track.label} insert ${index+1}`,getParameters:()=>draft.kind,validateDraft:()=>form.reportValidity(),isCurrent:visible,canCommit:()=>!disabled && audioPresets.canCommit(),commit,notice});
          const refresh=()=>{if(visible())void custom.load().catch(error=>{if(custom.current())notice(error.message);});else custom.suspend();};
          visibilityRefresh.push(refresh);cleanups.push(()=>custom.dispose());
          for(const details of [card,section,root]){details.addEventListener('toggle',refresh);cleanups.push(()=>details.removeEventListener('toggle',refresh));}
        }
        if(kind === "Normalize") {
          let previousMode=data.mode;
          const mode=select(`${track.label} normalization mode`,data,"mode",catalog.normalization.map((value)=>value.mode));
          const range=()=>catalog.normalization.find((value)=>value.mode===data.mode);
          const target=number(`${track.label} normalization target`,data,"target_db",range().range);
          if(track.channel!=="master")select(`${track.label} clip level policy`,data,"set_level",["Independent","Relative"]);
          const presets=document.createElement('div');presets.className='normalization-presets';form.append(presets);const buttons=[];let waiting=false,unknown=false;
          const expected=JSON.stringify(audioPresets?.getContext?.() ?? query),available=()=>!disposed && !disabled && !waiting && !unknown && card.isConnected!==false && card.open && section.open && root.open && !document.hidden && !document.querySelector?.('dialog[open]') && JSON.stringify(audioPresets?.getContext?.() ?? query)===expected && (audioPresets?.canCommit?.() ?? true);
          const syncPresets=()=>{presets.hidden=data.mode!=='Loudness' || range().unit!=='LUFS';for(const {button,value} of buttons){button.disabled=!available() || presets.hidden;button.setAttribute('aria-pressed',String(data.target_db===value));}};
          const loudness=catalog.normalization.find(value=>value.mode==='Loudness');
          for(const preset of Array.isArray(loudness?.presets)?loudness.presets:[]){
            if(typeof preset?.name!=='string' || !preset.name || !Number.isFinite(preset.target) || preset.target<loudness.range[0] || preset.target>loudness.range[1])continue;
            const button=document.createElement('button');button.type='button';button.textContent=`${preset.name} (${preset.target} LUFS)`;buttons.push({button,value:preset.target});presets.append(button);
            button.addEventListener('click',async()=>{
              if(!available() || button.disabled || button.isConnected===false || presets.hidden || !form.reportValidity() || data.target_db===preset.target)return;
              const next=structuredClone(draft);next.kind.Normalize.target_db=preset.target;waiting=true;syncPresets();
              try{await commit(chainOperation(track.channel,track.effects.map((entry,own)=>own===index?next:entry)));if(!disposed){data.target_db=preset.target;target.value=data.target_db;}}
              catch(error){if(error.code==='OUTCOME_UNKNOWN')unknown=true;notice(error.message);}finally{waiting=false;if(!disposed)syncPresets();}
            });
          }
          target.addEventListener('input',syncPresets);
          for(const details of [card,section,root]){details.addEventListener('toggle',syncPresets);cleanups.push(()=>details.removeEventListener?.('toggle',syncPresets));}
          mode.addEventListener("change",()=>{const value=range();data.target_db=normalizationModeTarget(previousMode,data.mode,data.target_db,catalog.normalization);previousMode=data.mode;target.min=value.range[0];target.max=value.range[1];target.value=data.target_db;syncPresets();});syncPresets();
        }
        const apply=document.createElement("button");apply.textContent=`Apply ${track.label} insert ${index+1}`;apply.disabled=disabled;form.append(apply);
        form.addEventListener("submit",(event)=>{event.preventDefault();graph?.cancel();dynamics?.cancel();if(!disposed && !disabled && card.open && section.open && form.isConnected!==false && form.reportValidity())report(track.effects.map((entry,i)=>i===index ? draft : entry));});
        for(const [label,delta] of [["Move up",-1],["Move down",1],["Remove",0]]) {
          const button=document.createElement("button");button.type="button";button.textContent=`${label} ${track.label} insert ${index+1}`;button.disabled=disabled || (delta && (index+delta<0 || index+delta>=track.effects.length));
          button.addEventListener("click",()=>{if(!button.disabled && card.open && section.open && form.isConnected!==false)void edit(delta?{kind:'move',from:index,to:index+delta}:{kind:'remove',index}).catch(error=>notice(error.message));});form.append(button);
        }
      };
      card.addEventListener('toggle',buildCard);cards.push({card,heading,build:buildCard});
    }
  };
  section.addEventListener('toggle',build);
  const dispose=()=>{disposed=true;for(const cleanup of cleanups)cleanup();for(const graph of graphs)graph.dispose();};
  dispose.cancel=()=>{for(const graph of graphs)graph.cancel();};
  dispose.sync=()=>{if(disposed)return;for(const graph of graphs){graph.sync();void graph.refresh?.();}for(const refresh of visibilityRefresh)refresh();};
  dispose.edit=edit;
  dispose.open=index=>{if(disposed || root.isConnected===false || JSON.stringify(audioPresets?.getContext?.() ?? query)!==expectedContext)return;section.open=true;build();const target=cards[index];if(!target)return;target.card.open=true;target.build();target.heading.tabIndex=-1;target.heading.focus?.({preventScroll:true});target.card.scrollIntoView?.({block:'nearest'});};
  return dispose;
}
