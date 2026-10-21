import { request,ApiFailure } from "./api.js";
export function exportAudioLabel(output) {return output.audio_present?" + AAC":" · silent";}
export function exportReference(job){
  if(typeof job?.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(job.id) || typeof job.project_epoch!=='string' || !job.project_epoch || job.project_epoch.length>160)throw Error('Invalid saved export reference');
  return {id:job.id,epoch:job.project_epoch};
}
export function savedExportJobs(value){
  if(!Array.isArray(value?.jobs) || value.jobs.length>64)throw Error('Saved export history exceeds its browsing budget');
  for(const job of value.jobs){exportReference(job);if(!['queued','running','ready','failed','canceled','interrupted','discarding'].includes(job.state))throw Error('Unsupported saved export state');}
  return value.jobs;
}
export function exportCanDiscard(job){return Boolean(job?.durable===true && !job.durability_error && ['ready','failed','canceled','interrupted'].includes(job.state));}
export function exportDiscardRequest(reference,job,commandId){
  const actual=exportReference(job);
  if(actual.id!==reference?.id || actual.epoch!==reference?.epoch || !exportCanDiscard(job))throw Error('Refresh and select a terminal saved export before discarding');
  if(typeof job.export_revision!=='string' || !/^[a-f0-9]{64}$/.test(job.export_revision))throw Error('Read the current saved export revision before discarding');
  if(typeof commandId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(commandId))throw Error('A valid discard command UUID is required');
  return {project_epoch:reference.epoch,revision:job.export_revision,command_id:commandId};
}

const codecStates=['not_checked','checking','available','unavailable','disabled'];
const softwareCodec={id:'x264',label:'H.264 · x264 (CPU)',status:'available',quality:{min:0,max:51,rises:false,default:20,label:'CRF'},presets:['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'],default_preset:'superfast'};
const qualityLabels={x264:'CRF',nvenc:'CQ',vulkan:'QP',videotoolbox:'Quality'};
const encoderLabels={x264:'x264',nvenc:'NVENC',vulkan:'Vulkan',videotoolbox:'VideoToolbox'};
export function checkedExportCatalog(value){
  if(typeof value?.identity!=='string' || !value.identity || value.identity.length>512)throw Error('Native codec identity is unavailable');
  for(const [key,ids] of [['encoders',['x264','nvenc','vulkan','videotoolbox']],['decoders',['software','nvdec','vulkan','videotoolbox']]]){
    const entries=value[key];if(!Array.isArray(entries) || !entries.length || entries.length>4 || new Set(entries.map(entry=>entry?.id)).size!==entries.length)throw Error('Native codec list is invalid');
    for(const entry of entries){
      if(!ids.includes(entry?.id) || typeof entry.label!=='string' || !entry.label || entry.label.length>256 || !codecStates.includes(entry.status) || (entry.reason!=null && (typeof entry.reason!=='string' || entry.reason.length>2048)))throw Error('Native codec option is invalid');
      if(key==='encoders'){
        const q=entry.quality;if(![q?.min,q?.max,q?.default].every(Number.isSafeInteger) || q.min<0 || q.max>100 || q.min>q.max || q.default<q.min || q.default>q.max || typeof q.rises!=='boolean' || typeof q.label!=='string' || !q.label || q.label.length>32 || !Array.isArray(entry.presets) || entry.presets.length>16 || entry.presets.some(preset=>typeof preset!=='string' || !preset || preset.length>32) || new Set(entry.presets).size!==entry.presets.length || (entry.presets.length?!entry.presets.includes(entry.default_preset):entry.default_preset!==''))throw Error('Native codec quality or presets are invalid');
      }
    }
  }
  if(!value.encoders.some(entry=>entry.id==='x264') || !value.decoders.some(entry=>entry.id==='software'))throw Error('Native software codecs are missing');
  return value;
}
export function exportSettingsLabel(settings){
  const encoder=settings.encoder??'x264',decoder=settings.decoder??'software';
  return `${encoderLabels[encoder] || 'Unknown encoder'} · ${qualityLabels[encoder] || 'Quality'} ${settings.quality}${settings.preset?` ${settings.preset}`:''} · requested decode ${decoder==='software'?'CPU':decoder}`;
}
export function exportPipelineLabel(progress){
  const decoders=Array.isArray(progress?.decoders) && progress.decoders.length<=8?progress.decoders.map(device=>device?.label).filter(label=>typeof label==='string' && label.length<=256):[];
  return `Actual encode ${progress?.encoder || 'not yet reported'} · actual decode ${decoders.length?decoders.join(' + '):'not yet observed'}${progress?.decoder_fallback?' · CPU decoder fallback':''}${progress?.compositor?` · compose ${progress.compositor}`:''}`;
}

export function exportRequest(state, values, catalog=null) {
  if (!state) throw new Error("Open a nonempty native timeline first");
  const start = Number(values.start), end = Number(values.end), width = Number(values.width), quality = Number(values.quality);
  if ([values.start, values.end, values.width, values.quality].some((value) => String(value).trim() === "") || ![start, end, width, quality].every(Number.isSafeInteger) || typeof values.audio !== "boolean" || start < 0 || end <= start || end > state.end_frame || ![640, 960, 1280, 1920].includes(width)) throw new Error("Choose an integer range within the timeline and a supported output width");
  const encoder=values.encoder??'x264',decoder=values.decoder??'software',native=catalog?checkedExportCatalog(catalog):null;
  const codec=native?.encoders.find(entry=>entry.id===encoder) || (!native && encoder==='x264'?softwareCodec:null),decode=native?.decoders.find(entry=>entry.id===decoder);
  if(!codec || codec.status!=='available' || (decoder!=='software' && decode?.status!=='available') || (native && decode?.status!=='available'))throw Error('Choose available native codecs; explicitly check selected hardware before export');
  const preset=values.preset??'';
  if(quality<codec.quality.min || quality>codec.quality.max || (codec.presets.length?!codec.presets.includes(preset):preset!==''))throw Error(`Choose ${codec.quality.label} ${codec.quality.min}–${codec.quality.max} and a supported ${encoderLabels[encoder]} preset`);
  const { fps, ...range } = state;
  return { range: { ...range, start_frame: start, end_frame: end, width }, settings: { quality, preset, audio: values.audio,...(encoder==='x264'?{}:{encoder}),...(decoder==='software'?{}:{decoder}) } };
}

export function createExportPanel({ form, status, cancel, refresh, download, getState, history=null,discard=null, api = request, storage = sessionStorage,uuid=()=>crypto.randomUUID() }) {
  let current = null, timer = null, historySequence=0,statusSequence=0,submitting=false;
  let selectedJob=null,discardReading=false,discardPending=false,discardTarget=null;
  const start = form.querySelector("button[type=submit],#export-start");
  const codecUI=form.elements.encoder && form.elements.decoder?{encoder:form.elements.encoder,decoder:form.elements.decoder,status:form.querySelector('[data-export-codec-status]'),encoderProbe:form.querySelector('[data-export-probe="encoder"]'),decoderProbe:form.querySelector('[data-export-probe="decoder"]'),refresh:form.querySelector('[data-export-codecs-refresh]'),qualityLabel:form.querySelector('[data-export-quality-label]'),qualityHint:form.querySelector('[data-export-quality-hint]'),presetField:form.querySelector('[data-export-preset-field]')}:null;
  let catalog=null,catalogSequence=0,catalogContext=null,codecVisible=false,probeTicket=null,codecMessage='';
  const contextKey=()=>{const state=getState();return JSON.stringify(state?[state.project_epoch,state.if_generation,state.timeline_id,state.revision]:null);};
  const catalogCurrent=()=>catalog && catalogContext===contextKey();
  const codecOption=kind=>catalog?.[`${kind}s`].find(entry=>entry.id===codecUI[kind].value);
  const selectedAvailable=()=>!codecUI || ((!catalog || !catalogCurrent())?codecUI.encoder.value==='x264' && codecUI.decoder.value==='software':['encoder','decoder'].every(kind=>codecOption(kind)?.status==='available'));
  function codecControls(){
    if(!codecUI)return;
    const busy=submitting || discardPending || ['queued','running'].includes(selectedJob?.state);
    start.disabled=busy || !selectedAvailable();codecUI.encoder.disabled=codecUI.decoder.disabled=busy;
    codecUI.refresh.disabled=busy || Boolean(probeTicket);
    for(const kind of ['encoder','decoder']){const option=codecOption(kind),button=codecUI[`${kind}Probe`];button.disabled=busy || Boolean(probeTicket) || !catalogCurrent() || !option || option.status==='disabled' || option.status==='checking';button.textContent=option?.status==='available' || option?.status==='unavailable'?`Recheck selected ${kind}`:`Check selected ${kind}`;}
    const labels=['encoder','decoder'].map(kind=>{const option=codecOption(kind);return `${kind}: ${option?.label || codecUI[kind].value} · ${option?.status?.replaceAll('_',' ') || 'catalog unavailable'}${option?.reason?` · ${option.reason}`:''}`;});
    const build=catalog?.build?.version,adapter=catalog?.adapter?.name;
    codecUI.status.textContent=[codecMessage,...labels,typeof build==='string'?`Native build ${build.slice(0,128)}`:'',typeof adapter==='string'?`Adapter ${adapter.slice(0,128)}`:'',...(catalog && !catalogCurrent()?['Timeline changed · refresh codec list before using hardware']:[])].filter(Boolean).join(' · ');
  }
  function codecFields(reset=false){
    if(!codecUI)return;const codec=codecOption('encoder') || (codecUI.encoder.value==='x264'?softwareCodec:null);if(!codec){codecControls();return;}
    const quality=form.elements.quality,preset=form.elements.preset,previous=preset.value;
    quality.min=String(codec.quality.min);quality.max=String(codec.quality.max);codecUI.qualityLabel.textContent=`${codec.label} · ${codec.quality.label}`;codecUI.qualityHint.textContent=`${codec.quality.min}–${codec.quality.max} · ${codec.quality.rises?'Higher':'Lower'} values improve quality`;
    preset.replaceChildren(...codec.presets.map(value=>new Option(value,value)));preset.value=reset?codec.default_preset:(codec.presets.includes(previous)?previous:codec.default_preset);if(!codec.presets.length)preset.value='';codecUI.presetField.hidden=!codec.presets.length;preset.disabled=!codec.presets.length;
    if(reset)quality.value=String(codec.quality.default);codecControls();
  }
  function installCatalog(value){
    catalog=checkedExportCatalog(value);for(const kind of ['encoder','decoder']){const select=codecUI[kind],previous=select.value;select.replaceChildren(...catalog[`${kind}s`].map(entry=>{const option=new Option(`${entry.label} · ${entry.status.replaceAll('_',' ')}`,entry.id);option.disabled=entry.status==='disabled';return option;}));select.value=previous;}
    codecFields();
  }
  async function loadCatalog(){
    if(!codecUI)return;const token=++catalogSequence,bound=contextKey();catalog=null;catalogContext=null;codecMessage='Reading native codec choices · hardware checks require an explicit button';codecControls();
    try{const result=await api('/exports/codecs');if(token!==catalogSequence || !codecVisible || bound!==contextKey())return;catalogContext=bound;installCatalog(result);codecMessage='Hardware is checked only on request';}
    catch(error){if(token===catalogSequence && codecVisible && bound===contextKey()){catalog=null;codecMessage=`Codec choices unavailable · ${error.message} · software export remains available`;}}
    finally{if(token===catalogSequence && codecVisible){if(bound!==contextKey())codecMessage='Timeline changed · refresh native codec choices';codecControls();}}
  }
  async function probe(kind){
    const option=codecOption(kind);if(!codecVisible || probeTicket || submitting || discardPending || ['queued','running'].includes(selectedJob?.state) || !catalogCurrent() || !option || ['disabled','checking'].includes(option.status))return;
    const ticket={kind,id:option.id,identity:catalog.identity,context:contextKey(),sequence:catalogSequence};probeTicket=ticket;codecMessage=`Checking ${option.label} · one bounded native check`;codecControls();
    try{const result=await api('/exports/codecs/probe',{kind,id:option.id,...(['available','unavailable'].includes(option.status)?{force:true}:{})});
      if(!codecVisible || ticket.sequence!==catalogSequence || ticket.context!==contextKey() || codecUI[kind].value!==ticket.id)return;
      if(result?.identity!==ticket.identity){catalog=null;codecMessage='Server configuration changed · refresh native codec choices';return;}
      installCatalog(result);codecMessage=`Explicit ${kind} check completed`;
    }catch(error){if(codecVisible && ticket.sequence===catalogSequence && ticket.context===contextKey() && codecUI[kind].value===ticket.id)codecMessage=`${error.code || 'Check unavailable'} · ${error.message} · no automatic retry`;}
    finally{if(probeTicket===ticket)probeTicket=null;if(codecVisible){if(ticket.sequence===catalogSequence && ticket.context!==contextKey())codecMessage='Timeline changed · refresh native codec choices';codecControls();}}
  }
  if(codecUI){codecUI.encoder.addEventListener('change',()=>{codecMessage='';codecFields(true);});codecUI.decoder.addEventListener('change',()=>{codecMessage='';codecControls();});codecUI.encoderProbe.addEventListener('click',()=>probe('encoder'));codecUI.decoderProbe.addEventListener('click',()=>probe('decoder'));codecUI.refresh.addEventListener('click',()=>{if(!probeTicket && !submitting && !discardPending)void loadCatalog();});codecFields();}
  const path = (reference=current) => `/exports/${encodeURIComponent(reference.id)}?${new URLSearchParams({ project_epoch: reference.epoch })}`;
  const same=reference=>reference?.id===current?.id && reference?.epoch===current?.epoch;
  function persist() { try { storage.setItem("venturi-export-job", JSON.stringify(current)); } catch {} }
  function discardControls(){codecControls();if(!discard)return;discard.button.disabled=discardReading || discardPending || submitting || !exportCanDiscard(selectedJob);discard.confirm.disabled=discardPending || !discardTarget || !same(discardTarget);discard.keep.disabled=discardPending;}
  function closeDiscard(){if(discardPending)return;discardTarget=null;if(discard?.dialog.open)discard.dialog.close();discardControls();}
  function display(job) {
    selectedJob=job;
    if(discardTarget && !discardPending && (!same(discardTarget) || job.export_revision!==discardTarget.body.revision || !exportCanDiscard(job)))closeDiscard();
    const busy = ["queued", "running"].includes(job.state);
    cancel.disabled = !busy || Boolean(job.cancel_requested); start.disabled = busy; refresh.disabled = false;
    const progress = job.progress;
    status.textContent = `${job.state.toUpperCase()}${busy && job.cancel_requested?' · cancel requested':''} · ${progress?.current_frame || 0}/${progress?.total_frames || "…"} frames${job.error ? ` · ${job.error}` : ""}${job.previous_state?` · previous state: ${job.previous_state}`:''}${job.durability_error?' · export persistence failed; refresh status before proceeding':''} · ${exportPipelineLabel(progress)}`;
    download.hidden = job.state !== "ready" || Boolean(job.durability_error);
    if(job.program) {
      const output=job.program,settings=output.export_settings;
      status.textContent+=` · snapshot frames ${output.start_frame}–${output.end_frame} · ${output.width}×${output.height}`;
      if(settings)status.textContent+=` · requested ${exportSettingsLabel(settings)}`;
      download.textContent=`Download MP4 · frames ${output.start_frame}–${output.end_frame}${settings ? ` · ${exportSettingsLabel(settings)}${exportAudioLabel(output)}` : ""}`;
    }
    if (!download.hidden) download.href = `/api/v1/exports/${encodeURIComponent(current.id)}/export.mp4?${new URLSearchParams({ project_epoch: current.epoch })}`;
    clearTimeout(timer);
    if (busy) timer = setTimeout(poll, 500);
    discardControls();
  }
  async function poll() {
    if (!current || discardPending) return;
    const reference={...current},token=++statusSequence;
    try { const job=await api(path(reference));if(token===statusSequence && same(reference))display(job); }
    catch (error) { if(token!==statusSequence || !same(reference))return;clearTimeout(timer); status.textContent = `Export status unavailable · ${error.message}`; start.disabled = false; cancel.disabled = true; download.hidden = true;codecControls(); }
  }
  async function loadHistory(){
    if(!history || discardPending)return;const token=++historySequence;history.refresh.disabled=true;history.status.textContent='Reading saved exports…';
    try{
      const result=await api('/exports'),jobs=savedExportJobs(result);if(token!==historySequence)return;
      history.select.replaceChildren(new Option('Choose a saved export',''),...jobs.map((job,index)=>new Option(`${job.id} · ${job.state}${job.program?` · frames ${job.program.start_frame}–${job.program.end_frame}`:''}`,String(index))));
      const index=jobs.findIndex(job=>same(exportReference(job)));history.select.value=index<0?'':String(index);
      history.select.onchange=()=>{if(submitting || discardPending)return;const job=jobs[Number(history.select.value)];if(history.select.value==='' || !job)return;closeDiscard();statusSequence++;clearTimeout(timer);current=exportReference(job);persist();display(job);};
      history.status.textContent=`${jobs.length} saved exports${result.capacity?` · ${result.capacity.used_jobs}/${result.capacity.max_jobs} history slots`:''}`;
    }catch(error){if(token===historySequence)history.status.textContent=`Saved exports unavailable · ${error.message}`;}
    finally{if(token===historySequence)history.refresh.disabled=discardPending;}
  }
  history?.refresh.addEventListener('click',loadHistory);
  if(discard){
    discard.button.addEventListener('click',async()=>{
      if(discardReading || discardPending || submitting || !current || !exportCanDiscard(selectedJob))return;
      const reference={...current},token=++statusSequence;discardReading=true;discardControls();
      try{
        const job=await api(path(reference));if(token!==statusSequence || !same(reference))return;
        const body=exportDiscardRequest(reference,job,uuid());display(job);discardTarget={...reference,body};
        discard.summary.textContent=`Discard export ${reference.id} (${job.state})${job.program?` · frames ${job.program.start_frame}–${job.program.end_frame}`:''}?`;
        discard.status.textContent='';discard.dialog.showModal();discard.keep.focus();
      }catch(error){if(token===statusSequence && same(reference))status.textContent=`Discard unavailable · ${error.message}`;}
      finally{discardReading=false;discardControls();}
    });
    discard.keep.addEventListener('click',closeDiscard);
    discard.dialog.addEventListener('cancel',event=>{if(discardPending)event.preventDefault();else discardTarget=null;});
    discard.dialog.addEventListener('close',()=>{discardTarget=null;discardControls();(discard.button.disabled?(history?.select || start):discard.button).focus();});
    discard.confirm.addEventListener('click',async()=>{
      if(!discardTarget || discardPending || !same(discardTarget))return;
      const target=discardTarget;discardPending=true;statusSequence++;historySequence++;clearTimeout(timer);discardControls();
      start.disabled=cancel.disabled=refresh.disabled=true;if(history)history.select.disabled=history.refresh.disabled=true;discard.status.textContent='Discarding saved export…';
      let completed=false;
      try{
        const result=await api(`/exports/${encodeURIComponent(target.id)}/discard`,target.body);
        if(result?.id!==target.id || result.status!=='discarded' || result.project_epoch!==target.epoch)throw Error('The server returned an unrecognized discard receipt');
        completed=true;statusSequence++;discardTarget=null;
        if(same(target)){current=null;selectedJob=null;persist();download.hidden=true;download.href='';cancel.disabled=refresh.disabled=true;status.textContent=`Export ${target.id} discarded · output and history removed`;}
      }catch(error){
        discardTarget=null;
        discard.status.textContent=error instanceof ApiFailure && error.status>=400 && error.status<500?`Discard response · ${error.message}. Close and refresh the export before another action.`:`Discard outcome unknown for ${target.id} · refresh the export to check. This request will not be repeated automatically.`;
      }finally{
        discardPending=false;start.disabled=submitting || ['queued','running'].includes(selectedJob?.state);refresh.disabled=!current;cancel.disabled=true;if(history)history.select.disabled=history.refresh.disabled=false;discardControls();
      }
      if(completed){discard.dialog.close();await loadHistory();}
    });
    discardControls();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if(submitting || discardPending || ['queued','running'].includes(selectedJob?.state))return;
    try {
      const values = Object.fromEntries(new FormData(form)); values.audio = form.elements.audio.checked;
      const body = exportRequest(getState(), values,codecUI && catalogCurrent()?catalog:null);
      closeDiscard();submitting=true;statusSequence++;clearTimeout(timer);if(history)history.select.disabled=true;discardControls();
      start.disabled = true; status.textContent = "Submitting native export…";
      const job = await api("/exports", body);
      current = { id: job.id, epoch: body.range.project_epoch }; persist(); display(job);
      loadHistory();
    } catch (error) { start.disabled = false; status.textContent = error.message; }
    finally{submitting=false;if(history)history.select.disabled=false;discardControls();}
  });
  cancel.addEventListener("click", async () => {
    if (!current || discardPending) return;
    const reference={...current},token=++statusSequence;
    try {
      const response = await fetch(`/api/v1${path(reference)}`, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("Cancel request failed");
      const job=await response.json();if(token===statusSequence && same(reference))display(job);
    } catch (error) { if(token===statusSequence && same(reference))status.textContent = error.message; }
  });
  refresh.addEventListener("click", poll);
  try { current = JSON.parse(storage.getItem("venturi-export-job")); if (current?.id && current?.epoch) poll(); else current = null; } catch { current = null; }
  return { open() { codecVisible=true;const state = getState(); if (state) { form.elements.start.value = 0; form.elements.end.value = state.end_frame; }loadHistory();void loadCatalog(); },close(){codecVisible=false;catalogSequence++;} };
}
