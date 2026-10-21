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

export function exportRequest(state, values) {
  if (!state) throw new Error("Open a nonempty native timeline first");
  const start = Number(values.start), end = Number(values.end), width = Number(values.width), quality = Number(values.quality);
  if ([values.start, values.end, values.width, values.quality].some((value) => String(value).trim() === "") || ![start, end, width, quality].every(Number.isSafeInteger) || typeof values.audio !== "boolean" || start < 0 || end <= start || end > state.end_frame || ![640, 960, 1280, 1920].includes(width) || quality < 0 || quality > 51) throw new Error("Choose an integer range within the timeline and CRF 0–51");
  const { fps, ...range } = state;
  return { range: { ...range, start_frame: start, end_frame: end, width }, settings: { quality, preset: values.preset, audio: values.audio } };
}

export function createExportPanel({ form, status, cancel, refresh, download, getState, history=null,discard=null, api = request, storage = sessionStorage,uuid=()=>crypto.randomUUID() }) {
  let current = null, timer = null, historySequence=0,statusSequence=0,submitting=false;
  let selectedJob=null,discardReading=false,discardPending=false,discardTarget=null;
  const start = form.querySelector("button[type=submit],#export-start");
  const path = (reference=current) => `/exports/${encodeURIComponent(reference.id)}?${new URLSearchParams({ project_epoch: reference.epoch })}`;
  const same=reference=>reference?.id===current?.id && reference?.epoch===current?.epoch;
  function persist() { try { storage.setItem("venturi-export-job", JSON.stringify(current)); } catch {} }
  function discardControls(){if(!discard)return;discard.button.disabled=discardReading || discardPending || submitting || !exportCanDiscard(selectedJob);discard.confirm.disabled=discardPending || !discardTarget || !same(discardTarget);discard.keep.disabled=discardPending;}
  function closeDiscard(){if(discardPending)return;discardTarget=null;if(discard?.dialog.open)discard.dialog.close();discardControls();}
  function display(job) {
    selectedJob=job;
    if(discardTarget && !discardPending && (!same(discardTarget) || job.export_revision!==discardTarget.body.revision || !exportCanDiscard(job)))closeDiscard();
    const busy = ["queued", "running"].includes(job.state);
    cancel.disabled = !busy || Boolean(job.cancel_requested); start.disabled = busy; refresh.disabled = false;
    const progress = job.progress;
    status.textContent = `${job.state.toUpperCase()}${busy && job.cancel_requested?' · cancel requested':''} · ${progress?.current_frame || 0}/${progress?.total_frames || "…"} frames${job.error ? ` · ${job.error}` : ""}${job.previous_state?` · previous state: ${job.previous_state}`:''}${job.durability_error?' · export persistence failed; refresh status before proceeding':''}${progress?.compositor ? ` · ${progress.compositor} · ${progress.encoder}` : ""}`;
    download.hidden = job.state !== "ready" || Boolean(job.durability_error);
    if(job.program) {
      const output=job.program,settings=output.export_settings;
      status.textContent+=` · snapshot frames ${output.start_frame}–${output.end_frame} · ${output.width}×${output.height}`;
      download.textContent=`Download MP4 · frames ${output.start_frame}–${output.end_frame}${settings ? ` · CRF ${settings.quality} ${settings.preset}${exportAudioLabel(output)}` : ""}`;
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
    catch (error) { if(token!==statusSequence || !same(reference))return;clearTimeout(timer); status.textContent = `Export status unavailable · ${error.message}`; start.disabled = false; cancel.disabled = true; download.hidden = true; }
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
        discardPending=false;discardControls();start.disabled=submitting || ['queued','running'].includes(selectedJob?.state);refresh.disabled=!current;cancel.disabled=true;if(history)history.select.disabled=history.refresh.disabled=false;
      }
      if(completed){discard.dialog.close();await loadHistory();}
    });
    discardControls();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if(submitting || discardPending)return;
    try {
      const values = Object.fromEntries(new FormData(form)); values.audio = form.elements.audio.checked;
      const body = exportRequest(getState(), values);
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
  return { open() { const state = getState(); if (state) { form.elements.start.value = 0; form.elements.end.value = state.end_frame; }loadHistory(); } };
}
