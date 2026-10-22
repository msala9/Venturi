import {request} from './api.js';

const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const token=value=>typeof value==='string' && !value.startsWith('.') && value.endsWith('.otio') && new TextEncoder().encode(value).length<=128 && !/[\\/\u0000-\u001f\u007f-\u009f]/.test(value);
const identity=context=>typeof context?.project_epoch==='string' && context.project_epoch.length>0 && typeof context.generation==='string' && context.generation.length>0?JSON.stringify([context.project_epoch,context.generation]):null;
const warnings=value=>Array.isArray(value) && value.length<=65 && value.every(item=>typeof item==='string' && item.length<=1024);
const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('OTIO import canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
export function otioImportName(value){
  const name=String(value??'').trim();
  if(!name || new TextEncoder().encode(name).length>128 || /[\u0000-\u001f\u007f-\u009f]/.test(name))throw Error('Choose a name of up to 128 UTF-8 bytes for the imported timelines and media folder');
  return name;
}
export function checkedOtioImportJob(value,owner){
  if(!id(value?.id) || owner.job && value.id!==owner.job || value.kind!=='otio_import' || value.project_epoch!==owner.epoch || value.generation!==owner.generation || !['queued','running','ready','failed','canceled'].includes(value.state))throw Error('The OTIO preparation no longer matches this import');
  if(value.progress!=null && (!Number.isSafeInteger(value.progress.completed) || !Number.isSafeInteger(value.progress.total) || value.progress.completed<0 || value.progress.total<0 || value.progress.total>64 || value.progress.completed>value.progress.total))throw Error('The native OTIO media progress is invalid');
  if(value.state==='ready'){
    const result=value.result;
    if(result?.path_token!==owner.path_token || !Number.isSafeInteger(result.timeline_count) || result.timeline_count<0 || result.timeline_count>64 || !Number.isSafeInteger(result.media_count) || result.media_count<0 || result.media_count>10000 || !warnings(result.warnings))throw Error('The native OTIO import summary is invalid');
  }else if(value.result!=null)throw Error('Unfinished OTIO import returned unexpected results');
  return value;
}
function checkedReceipt(receipt,ticket){
  const ids=value=>Array.isArray(value) && value.length<=20000 && value.every(item=>typeof item==='string' && /^[0-9]{1,20}$/.test(item)) && new Set(value).size===value.length;
  if(!id(receipt?.command_id) || receipt.project_epoch!==ticket.epoch || !ids(receipt.timeline_ids) || !receipt.timeline_ids.length || receipt.timeline_ids.length>ticket.summary.timeline_count || !ids(receipt.media_ids) || receipt.folder_id!==null && (typeof receipt.folder_id!=='string' || !/^[0-9]{1,20}$/.test(receipt.folder_id)) || !warnings(receipt.warnings))throw Error('The import was acknowledged with an unexpected result; refresh and do not repeat the command');
  return receipt;
}
export function createOtioImport({getContext,canCommit,commit,api=apiRequest,pause=delay,onChange=()=>{},onImported=()=>{}}){
  let owner=null,disposed=false,state={phase:'idle',job:null,message:''};
  const emit=(phase,job,message)=>{state={phase,job,message};onChange(state);};
  const current=ticket=>!disposed && owner===ticket && !ticket.canceled && identity(getContext())===ticket.identity && canCommit() && ticket.sourceCurrent();
  const path=ticket=>`/projects/otio/jobs/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  const cancelJob=ticket=>ticket.job?(ticket.deletion??=api(path(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)}).catch(()=>{})):Promise.resolve();
  async function release(ticket){await cancelJob(ticket);if(owner===ticket){owner=null;emit('idle',null,'OTIO import canceled');}}
  function cancel(){
    if(!owner || owner.canceled || owner.phase==='applying')return false;
    const ticket=owner;ticket.canceled=true;ticket.controller.abort();emit('canceling',state.job,'Canceling OTIO import…');
    if(ticket.phase==='ready')void release(ticket);
    return true;
  }
  async function prepare(path_token,sourceCurrent=()=>true){
    if(disposed || owner || !identity(getContext()) || !canCommit() || !sourceCurrent())return null;
    if(!token(path_token))throw Error('Choose an OTIO file listed in the server project folder');
    const context=getContext(),ticket={path_token,identity:identity(context),epoch:context.project_epoch,generation:context.generation,job:null,summary:null,phase:'preparing',controller:new AbortController(),canceled:false,deletion:null,sourceCurrent};owner=ticket;
    try{
      emit('preparing',null,`Preparing ${path_token} with the native importer…`);
      if(!current(ticket)){ticket.canceled=true;return null;}
      // Keep the acknowledgment observable after local cancellation so its exact job can be released.
      let job=checkedOtioImportJob(await api('/projects/otio/prepare',{project_epoch:ticket.epoch,if_generation:ticket.generation,path_token}),ticket);ticket.job=job.id;
      let polls=0;
      while(current(ticket) && ['queued','running'].includes(job.state)){
        if(++polls>2100)throw Error('OTIO preparation timed out; refresh before preparing again');
        emit('preparing',job,`${path_token} · ${job.state}${job.progress?.total?` · ${job.progress.completed}/${job.progress.total} media checked`:''}`);
        await pause(300,ticket.controller.signal);
        if(!current(ticket))break;
        job=checkedOtioImportJob(await api(path(ticket),undefined,{signal:ticket.controller.signal}),ticket);
      }
      if(!current(ticket)){ticket.canceled=true;return null;}
      if(job.state!=='ready')throw Error(job.error?`Native OTIO import failed: ${job.error}`:'Native OTIO preparation was canceled');
      ticket.phase='ready';ticket.summary=job.result;emit('ready',job,`${job.result.timeline_count} timelines · ${job.result.media_count} media ready for import`);
      if(!current(ticket)){cancel();return null;}return job.result;
    }catch(error){if(!ticket.canceled && current(ticket)){emit('error',state.job,error.message);throw error;}ticket.canceled=true;return null;}
    finally{if(ticket.phase!=='ready'){await cancelJob(ticket);if(owner===ticket){owner=null;if(ticket.canceled)emit('idle',null,'OTIO import canceled');else onChange(state);}}}
  }
  async function apply(name,reuse_existing){
    const ticket=owner;
    if(!ticket || ticket.phase!=='ready' || !current(ticket))return null;
    const label=otioImportName(name);
    if(typeof reuse_existing!=='boolean')throw Error('Choose whether to reuse existing media by native file name');
    if(!ticket.summary.timeline_count)throw Error('This OTIO has no timelines to import');
    ticket.phase='applying';emit('applying',state.job,'Importing timelines into the current project…');
    let receipt=null,submitted=false;
    try{
      if(!current(ticket)){ticket.canceled=true;return null;}
      submitted=true;receipt=await commit({kind:'import_prepared_otio',job_id:ticket.job,name:label,reuse_existing});
      checkedReceipt(receipt,ticket);
      let message='OTIO timelines imported into the current project · one Undo restores the previous project';
      if(!disposed && getContext()?.project_epoch===ticket.epoch && ticket.sourceCurrent()){
        try{await onImported(receipt);}catch(error){message=`OTIO import applied; view refresh failed: ${error.message}. Do not repeat the import.`;}
      }
      emit('applied',state.job,message);return receipt;
    }catch(error){emit(receipt?'applied':submitted?'uncertain':'error',state.job,receipt?error.message:`${error.message} · Check command status before repeating the import`);throw error;}
    finally{if(!submitted)await cancelJob(ticket);if(owner===ticket){owner=null;if(ticket.canceled)emit('idle',null,'OTIO import canceled');else onChange(state);}}
  }
  return {prepare,apply,cancel,state:()=>state,busy:()=>Boolean(owner),invalidate(){if(owner?.phase!=='applying' && owner && !current(owner))cancel();},dispose(){disposed=true;cancel();}};
}

export function createOtioImportPanel({root,isVisible=()=>true,getContext,canCommit,commit,onImported,notice,api,pause}){
  const file=root.querySelector('[data-otio-file]'),name=root.querySelector('[data-otio-name]'),reuse=root.querySelector('[data-otio-reuse]'),prepare=root.querySelector('[data-otio-prepare]'),apply=root.querySelector('[data-otio-apply]'),cancel=root.querySelector('[data-otio-cancel]'),status=root.querySelector('[data-otio-status]'),warningList=root.querySelector('[data-otio-warnings]');
  let visible=true,session=0;
  const transfer=createOtioImport({getContext,canCommit,commit,api,pause,onImported,onChange(state){
    const preparing=['preparing','canceling'].includes(state.phase),applying=state.phase==='applying',ready=state.phase==='ready';
    file.disabled=preparing || applying;name.disabled=applying;reuse.disabled=applying;
    prepare.disabled=transfer.busy() || !file.value || !canCommit() || !identity(getContext());
    apply.disabled=!ready || !state.job?.result?.timeline_count || !canCommit();cancel.disabled=!(preparing || ready) || state.phase==='canceling';
    status.textContent=state.message;warningList.replaceChildren();
    for(const warning of state.job?.result?.warnings || []){const line=document.createElement('li');line.textContent=warning;warningList.append(line);}
  }});
  prepare.addEventListener('click',()=>{const chosen=file.value,bound=session;void transfer.prepare(chosen,()=>visible && isVisible() && session===bound && file.value===chosen).catch(error=>notice(error.message));});
  apply.addEventListener('click',()=>void transfer.apply(name.value,reuse.value==='reuse').catch(error=>notice(error.message)));
  cancel.addEventListener('click',()=>transfer.cancel());
  file.addEventListener('change',()=>{session++;transfer.cancel();name.value=file.value.replace(/\.otio$/,'');reuse.value='import';transfer.invalidate();prepare.disabled=transfer.busy() || !file.value || !canCommit() || !identity(getContext());});
  return {setFiles(files){
    const previous=file.value;file.replaceChildren();
    for(const item of files || [])if(token(item.path_token)){const option=document.createElement('option');option.value=item.path_token;option.textContent=item.name;file.append(option);}
    if([...file.options].some(option=>option.value===previous))file.value=previous;
    if(file.value!==previous){session++;transfer.cancel();name.value=file.value.replace(/\.otio$/,'');reuse.value='import';}
    visible=true;transfer.invalidate();prepare.disabled=transfer.busy() || !file.value || !canCommit() || !identity(getContext());
  },hide(){visible=false;session++;transfer.cancel();},invalidate(){transfer.invalidate();prepare.disabled=transfer.busy() || !file.value || !canCommit() || !identity(getContext());},state:transfer.state};
}
