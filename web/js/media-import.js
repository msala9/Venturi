import {request} from './api.js';

export const MAX_MEDIA_IMPORT=256;
const identity=context=>typeof context?.project_epoch==='string' && typeof context.generation==='string'?JSON.stringify([context.project_epoch,context.generation]):null;
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const token=value=>typeof value==='string' && value.length>0 && !value.startsWith('.') && new TextEncoder().encode(value).length<=128 && !/[\\/\u0000-\u001f\u007f-\u009f]/.test(value);
const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Import canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});

export function mediaImportTokens(values){
  if(!Array.isArray(values) || values.length>4096 || values.some(value=>!token(value)))throw Error('Choose files listed in the configured project folder');
  const unique=[...new Set(values)];
  if(!unique.length || unique.length>MAX_MEDIA_IMPORT)throw Error(`Choose between 1 and ${MAX_MEDIA_IMPORT} files for each import`);
  return unique;
}

export function checkedMediaImportJob(value,owner){
  if(!id(value?.id) || owner.job && value.id!==owner.job || value.project_epoch!==owner.epoch || value.generation!==owner.generation || value.kind!=='media_import' || !['queued','running','ready','failed','canceled'].includes(value.state))throw Error('The media import job no longer matches this request');
  const progress=value.progress;
  if(!Number.isSafeInteger(progress?.completed) || !Number.isSafeInteger(progress.total) || progress.total!==owner.tokens.length || progress.completed<0 || progress.completed>progress.total)throw Error('The media import progress is invalid');
  if(value.state==='ready'){
    const result=value.result;
    if(progress.completed!==progress.total || !Array.isArray(result?.items) || !Array.isArray(result.errors) || result.items.length+result.errors.length!==owner.tokens.length)throw Error('The media import results are incomplete');
    const seen=new Set();
    for(const [items,success] of [[result.items,true],[result.errors,false]]){
      let previous=-1;
      for(const item of items){
        const index=owner.tokens.indexOf(item?.path_token);
        if(index<0 || index<=previous || seen.has(item.path_token) || typeof item.name!=='string' || !token(item.name) || (success?item.state!=='ready':typeof item.code!=='string' || !item.code || item.code.length>80 || typeof item.message!=='string' || !item.message || item.message.length>2048 || !Number.isInteger(item.status) || item.status<400 || item.status>599))throw Error('The media import file results changed');
        seen.add(item.path_token);previous=index;
      }
    }
  }else if(value.result!==null && value.result!==undefined)throw Error('Unfinished media import returned unexpected results');
  return value;
}

export function createMediaImport({getContext,canCommit,commit,api=apiRequest,pause=delay,onChange=()=>{},onImported=()=>{},onSettled=()=>{}}){
  let owner=null,state={phase:'idle',job:null,message:''};
  const emit=(phase,job,message)=>{state={phase,job,message};onChange(state);};
  const current=ticket=>owner===ticket && !ticket.canceled && identity(getContext())===ticket.identity && canCommit() && ticket.sourceCurrent();
  const path=ticket=>`/media/imports/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  function cancelJob(ticket){
    if(!ticket.job)return Promise.resolve();
    return ticket.deletion??=api(path(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
  function cancel(){
    if(!owner || owner.canceled || owner.phase==='committing')return false;
    owner.canceled=true;owner.phase='canceling';owner.controller.abort();void cancelJob(owner);emit('canceling',state.job,'Canceling import…');return true;
  }
  async function run(values,sourceCurrent=()=>true){
    if(owner || !identity(getContext()) || !canCommit() || !sourceCurrent())return null;
    const tokens=mediaImportTokens(values),context=getContext(),ticket={tokens,identity:identity(context),epoch:context.project_epoch,generation:context.generation,job:null,phase:'preparing',controller:new AbortController(),canceled:false,deletion:null,sourceCurrent};owner=ticket;
    let receipt=null;
    try{
      emit('preparing',null,`Checking ${tokens.length} selected files…`);
      let job=checkedMediaImportJob(await api('/media/imports/prepare',{project_epoch:ticket.epoch,if_generation:ticket.generation,path_tokens:tokens}),ticket);ticket.job=job.id;
      if(!current(ticket))throw new DOMException('Import context changed','AbortError');
      let polls=0;
      while(['queued','running'].includes(job.state)){
        ticket.phase=job.state;emit(job.state,job,`Checking files · ${job.progress.completed}/${job.progress.total}`);
        if(++polls>2100)throw Error('Import checking timed out; choose files again after refreshing');
        await pause(300,ticket.controller.signal);job=checkedMediaImportJob(await api(path(ticket),undefined,{signal:ticket.controller.signal}),ticket);
        if(!current(ticket))throw new DOMException('Import context changed','AbortError');
      }
      if(job.state!=='ready')throw Error(job.error || `Media import ${job.state}`);
      if(!current(ticket))throw new DOMException('Import context changed','AbortError');
      if(!job.result.items.length){emit('failed',job,'No selected files could be imported; review the file errors');return null;}
      ticket.phase='committing';emit('committing',job,`Importing ${job.result.items.length} files…`);
      if(!current(ticket)){ticket.phase='preparing';throw new DOMException('Import context changed before applying','AbortError');}
      receipt=await commit({kind:'import_prepared_media',job_id:ticket.job});
      if(!id(receipt?.command_id) || receipt.project_epoch!==ticket.epoch || !Array.isArray(receipt.media_ids) || receipt.media_ids.length!==job.result.items.length || receipt.media_ids.some(value=>typeof value!=='string' || !/^[0-9]+$/.test(value)) || new Set(receipt.media_ids).size!==receipt.media_ids.length)throw Error('Import command outcome needs verification; reconnect before repeating it');
      if(ticket.sourceCurrent() && getContext()?.project_epoch===ticket.epoch){
        try{await onImported(receipt.media_ids,receipt);emit('applied',job,`${receipt.media_ids.length} files imported${job.result.errors.length?` · ${job.result.errors.length} could not be imported`:''}`);}
        catch(error){emit('applied',job,`Import applied · refresh failed: ${error.message}. Reconnect; do not repeat the import.`);}
      }
      return receipt;
    }catch(error){
      if(ticket.phase!=='committing'){ticket.canceled=true;await cancelJob(ticket);}
      if(error.name==='AbortError'){emit('canceled',state.job,'Import canceled · project unchanged');return null;}
      emit(ticket.phase==='committing'?'uncertain':'failed',state.job,ticket.phase==='committing'?`Import command needs review · ${error.message}. Check command status before repeating it.`:error.message);
      throw error;
    }finally{if(owner===ticket)owner=null;onSettled();}
  }
  return {run,cancel,state:()=>state,busy:()=>Boolean(owner),phase:()=>owner?.phase || state.phase,invalidate(){if(owner && owner.phase!=='committing' && !current(owner))cancel();}};
}

export function createMediaImportPanel({dialog,root,status,getContext,canCommit,commit,onImported=()=>{},api=apiRequest,pause=delay}){
  let active=false,session=0,operationSession=0,readSequence=0,reading=false,pendingReload=false,files=[],reader=null,consumed=null,filesEpoch=null;
  const closeButton=dialog.querySelector('form[method="dialog"] button');
  const label=document.createElement('label');label.className='field';label.textContent=`Choose files (up to ${MAX_MEDIA_IMPORT} per import)`;
  const list=document.createElement('select');list.multiple=true;list.size=12;list.setAttribute('aria-label','Files to import');label.append(list);
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',action);return node;};
  const failures=document.createElement('ul');failures.setAttribute('aria-label','Import file results');
  const selection=()=>Array.from(list.selectedOptions,option=>option.value);
  function update(){
    if(!active)return;transfer.invalidate();const working=reading || transfer.busy();list.disabled=working;reloadButton.disabled=working;
    if(closeButton)closeButton.disabled=transfer.busy() && transfer.phase()==='committing';
    start.disabled=working || !canCommit() || !identity(getContext()) || filesEpoch!==getContext()?.project_epoch || !selection().length || selection().length>MAX_MEDIA_IMPORT || consumed===JSON.stringify(selection());
    stop.disabled=!transfer.busy() || transfer.phase()==='committing' || transfer.phase()==='canceling';
  }
  function render(value){
    if(!active || operationSession!==session)return;
    if(['committing','applied','uncertain'].includes(value.phase))consumed=JSON.stringify(selection());
    status.textContent=value.message;
    if(value.job?.result){const byToken=new Map([...value.job.result.items.map(item=>[item.path_token,{...item,ok:true}]),...value.job.result.errors.map(item=>[item.path_token,item])]);failures.replaceChildren(...files.filter(item=>byToken.has(item.path_token)).map(item=>{const result=byToken.get(item.path_token),node=document.createElement('li');node.textContent=`${result.name} · ${result.ok?(value.phase==='applied'?'imported':'checked'):`${result.code}: ${result.message}`}`;return node;}));}
    update();
  }
  const transfer=createMediaImport({getContext,canCommit,commit,api,pause,onChange:render,onImported,onSettled(){update();if(active && pendingReload && !transfer.busy()){pendingReload=false;void reload();}}});
  async function reload(){
    if(!active)return;if(transfer.busy()){pendingReload=true;return;}
    const epoch=getContext()?.project_epoch,sequence=++readSequence;if(!identity(getContext())){status.textContent='Create or open a project before importing media';update();return;}
    reader?.abort();reader=new AbortController();reading=true;consumed=null;filesEpoch=null;list.replaceChildren();files=[];failures.replaceChildren();status.textContent='Reading project files…';update();
    try{
      const value=await api('/projects',undefined,{signal:reader.signal});
      if(!active || sequence!==readSequence || epoch!==getContext()?.project_epoch)return;
      if(!Array.isArray(value.importable_media) || value.importable_media.length>4096 || value.importable_media.some(item=>!token(item?.path_token) || !token(item.name)) || new Set(value.importable_media.map(item=>item.path_token)).size!==value.importable_media.length)throw Error('The project file list is invalid; refresh before importing');
      files=value.importable_media;filesEpoch=epoch;list.replaceChildren(...files.map(item=>new Option(item.name,item.path_token)));status.textContent=files.length?`${files.length} files available · select files, then Import selected files`:'No importable files in the configured project folder';
    }catch(error){if(active && sequence===readSequence && error.name!=='AbortError')status.textContent=error.message;}
    finally{if(sequence===readSequence){reading=false;update();}}
  }
  const reloadButton=button('Refresh import files',()=>void reload()),stop=button('Cancel import',()=>transfer.cancel());
  const start=button('Import selected files',async()=>{
    if(reading || transfer.busy() || !canCommit())return;
    let tokens;try{tokens=mediaImportTokens(selection());}catch(error){status.textContent=error.message;return;}
    const bound=session,chosen=JSON.stringify(tokens);operationSession=bound;failures.replaceChildren();
    try{await transfer.run(tokens,()=>active && session===bound && JSON.stringify(selection())===chosen);}catch{/* The controller retains the authoritative outcome message. */}
    update();
  });
  root.replaceChildren(label,reloadButton,start,stop,failures);list.addEventListener('change',()=>{transfer.invalidate();update();});
  const hide=()=>{active=false;session++;readSequence++;reader?.abort();reading=false;pendingReload=false;transfer.cancel();};
  dialog.addEventListener('close',()=>{if(transfer.busy() && transfer.phase()==='committing'){if(!dialog.open)dialog.showModal();update();return;}hide();});dialog.addEventListener('cancel',event=>{if(transfer.busy() && transfer.phase()==='committing')event.preventDefault();});
  update();
  return {async open(){if(transfer.busy() && transfer.phase()==='committing'){if(!dialog.open)dialog.showModal();update();return;}hide();active=true;session++;operationSession=session;list.replaceChildren();files=[];failures.replaceChildren();if(!dialog.open)dialog.showModal();if(transfer.busy()){pendingReload=true;status.textContent='Waiting for the preceding import to settle…';update();return;}await reload();},invalidate:update,hide};
}
