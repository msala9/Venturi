import {request} from './api.js';
import {approvedSourceToken,createSourcePicker} from './source-picker.js';
import {folderPaths} from './catalog.js';

export const MAX_MEDIA_IMPORT=256;
const identity=context=>typeof context?.project_epoch==='string' && typeof context.generation==='string'?JSON.stringify([context.project_epoch,context.generation]):null;
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const token=value=>typeof value==='string' && value.length>0 && !value.startsWith('.') && new TextEncoder().encode(value).length<=128 && !/[\\/\u0000-\u001f\u007f-\u009f]/.test(value);
const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Import canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
const nativeId=value=>typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<=18_446_744_073_709_551_615n;
const nativeIds=(values,max)=>Array.isArray(values) && values.length<=max && values.every(nativeId) && new Set(values).size===values.length;

export function projectMediaSelection(value){
  if(!value || value.parent!==null && !nativeId(value.parent))throw Error('Choose a current project destination folder');
  if(Object.hasOwn(value,'path_tokens')===Object.hasOwn(value,'directory_token'))throw Error('Choose files or one source folder');
  if(Object.hasOwn(value,'path_tokens')){
    if(!Array.isArray(value.path_tokens) || value.path_tokens.length>4096 || value.path_tokens.some(path=>!approvedSourceToken(path)))throw Error('Choose approved source files');
    const paths=[...new Set(value.path_tokens)];if(!paths.length || paths.length>256)throw Error('Choose between 1 and 256 source files');
    return {path_tokens:paths,parent:value.parent};
  }
  if(!approvedSourceToken(value.directory_token,{directory:true}))throw Error('Choose an approved child source folder');
  return {directory_token:value.directory_token,parent:value.parent};
}

export function projectRelinkSelection(action){
  if(action?.kind==='chosen'){
    if(!Array.isArray(action.items) || !action.items.length || action.items.length>64 || !nativeIds(action.items.map(item=>item?.media_id),64) || action.items.some(item=>!approvedSourceToken(item.path_token)))throw Error('Choose distinct project media and approved replacement files');
    return {kind:'chosen',items:action.items.map(({media_id,path_token})=>({media_id,path_token}))};
  }
  if(action?.kind!=='by_name' || !approvedSourceToken(action.directory_token,{directory:true}))throw Error('Choose an approved replacement folder');
  return {kind:'by_name',directory_token:action.directory_token,scope:projectRelinkScope(action.scope)};
}
export function projectRelinkScope(scope){
  if(scope?.kind==='selected' && nativeIds(scope.media_ids,64) && scope.media_ids.length)return {kind:'selected',media_ids:[...scope.media_ids]};
  if(scope?.kind==='folder' && nativeId(scope.folder_id))return {kind:'folder',folder_id:scope.folder_id};
  throw Error('Choose selected project media or a project folder');
}

export function checkedProjectMediaJob(value,owner){
  const limit=owner.kind==='project_import'?256:64;
  if(!id(value?.id) || owner.job && value.id!==owner.job || value.kind!==owner.kind || value.project_epoch!==owner.epoch || value.generation!==owner.generation || !['queued','running','ready','failed','canceled'].includes(value.state) || !Number.isSafeInteger(value.progress?.completed) || !Number.isSafeInteger(value.progress.total) || value.progress.completed<0 || value.progress.total>limit || value.progress.completed>value.progress.total)throw Error('The prepared media job no longer matches this project');
  if(value.state!=='ready'){if(value.result!=null)throw Error('Unfinished media preparation returned results');return value;}
  const result=value.result;
  if(!result || !Array.isArray(result.items) || result.items.length>limit || !Array.isArray(result.errors) || result.errors.length>limit || value.progress.completed!==value.progress.total || result.errors.some(error=>typeof error?.name!=='string' || typeof error.code!=='string' || !error.code || error.code.length>80 || typeof error.message!=='string' || error.message.length>2048 || !Number.isInteger(error.status) || error.status<400 || error.status>599))throw Error('The prepared media results are invalid');
  if(owner.kind==='project_import'){
    const files=owner.selection.path_tokens,mode=files?'files':'tree';
    if(result.mode!==mode || result.parent!==owner.selection.parent || result.directory_token!==(files?null:owner.selection.directory_token) || !Array.isArray(result.folders) || result.folders.length>128 || result.folders.some((folder,index)=>typeof folder.name!=='string' || !folder.name || folder.parent_index!==null && (!Number.isSafeInteger(folder.parent_index) || folder.parent_index<0 || folder.parent_index>=index)) || result.items.some(item=>!approvedSourceToken(item?.path_token) || typeof item.name!=='string' || item.state!=='ready' || item.folder_index!==null && (!Number.isSafeInteger(item.folder_index) || item.folder_index<0 || item.folder_index>=result.folders.length)))throw Error('The prepared import tree changed');
    const tokens=[...result.items,...result.errors].map(item=>item.path_token);if(tokens.some(path=>!approvedSourceToken(path) || !files && !path.startsWith(`${owner.selection.directory_token}/`)) || new Set(tokens).size!==tokens.length || files && (tokens.length!==files.length || tokens.some(path=>!files.includes(path))))throw Error('The prepared import file results are incomplete');
    if(files)for(const partition of [result.items,result.errors]){let previous=-1;for(const item of partition){const index=files.indexOf(item.path_token);if(index<=previous)throw Error('The prepared import file order changed');previous=index;}}
  }else{
    const action=owner.selection;
    if(result.mode!==action.kind || result.directory_token!==(action.kind==='by_name'?action.directory_token:null) || !nativeIds(result.not_found,64) || !nativeIds(result.skipped,64) || !Number.isSafeInteger(result.ambiguous_count) || result.ambiguous_count<0 || result.ambiguous_count>64 || result.items.some(item=>!nativeId(item?.media_id) || !approvedSourceToken(item.path_token) || typeof item.name!=='string' || item.state!=='ready') || result.errors.some(item=>item.path_token!==null && !approvedSourceToken(item.path_token)))throw Error('The prepared relink results changed');
    const ids=[...result.items,...result.errors].map(item=>item.media_id).concat(result.not_found,result.skipped);if(!nativeIds(ids,64))throw Error('The prepared relink targets are invalid');
    const requested=action.kind==='chosen'?action.items.map(item=>item.media_id):action.scope.kind==='selected'?action.scope.media_ids:null;
    if(requested && (ids.length!==requested.length || ids.some(id=>!requested.includes(id))))throw Error('The prepared relink targets are incomplete');
    if(action.kind==='chosen' && result.items.some(item=>action.items.find(target=>target.media_id===item.media_id)?.path_token!==item.path_token))throw Error('The chosen replacement path changed');
  }
  return value;
}

export function createProjectMediaTransfer({kind,getContext,canCommit,commit,api=apiRequest,pause=delay,onChange=()=>{},onApplied=()=>{}}){
  if(!['project_import','project_relink'].includes(kind))throw Error('Choose a native project media operation');
  let owner=null,state={phase:'idle',job:null,message:''};
  const emit=(phase,job,message)=>{state={phase,job,message};onChange(state);};
  const current=ticket=>owner===ticket && !ticket.canceled && identity(getContext())===ticket.identity && canCommit() && ticket.sourceCurrent();
  const path=ticket=>`/media/jobs/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  const cancelJob=ticket=>!ticket.job?Promise.resolve():(ticket.deletion??=api(path(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)}).catch(()=>{}));
  function cancel(){if(!owner || owner.canceled || owner.phase==='committing')return false;owner.canceled=true;owner.phase='canceling';owner.controller.abort();void cancelJob(owner);emit('canceling',state.job,'Canceling media preparation…');return true;}
  async function run(value,sourceCurrent=()=>true){
    if(owner || !identity(getContext()) || !canCommit() || !sourceCurrent())return null;
    const selection=kind==='project_import'?projectMediaSelection(value):projectRelinkSelection(value),context=getContext(),ticket={kind,selection,identity:identity(context),epoch:context.project_epoch,generation:context.generation,job:null,phase:'preparing',canceled:false,controller:new AbortController(),sourceCurrent};owner=ticket;
    try{
      emit('preparing',null,'Preparing project media…');
      if(!current(ticket))throw new DOMException('Media preparation context changed','AbortError');
      const body={project_epoch:ticket.epoch,if_generation:ticket.generation,...(kind==='project_import'?selection:{action:selection})};
      let job=checkedProjectMediaJob(await api(kind==='project_import'?'/media/project-imports/prepare':'/media/relinks/prepare',body),ticket);ticket.job=job.id;
      if(!current(ticket))throw new DOMException('Media preparation context changed','AbortError');
      let polls=0;while(['queued','running'].includes(job.state)){
        emit(job.state,job,`Checking media · ${job.progress.completed}/${job.progress.total}`);if(++polls>2100)throw Error('Media preparation timed out; refresh before trying again');
        await pause(300,ticket.controller.signal);job=checkedProjectMediaJob(await api(path(ticket),undefined,{signal:ticket.controller.signal}),ticket);if(!current(ticket))throw new DOMException('Media preparation context changed','AbortError');
      }
      if(job.state!=='ready')throw Error(job.error || `Media preparation ${job.state}`);
      if(!current(ticket))throw new DOMException('Media preparation context changed','AbortError');
      if(!job.result.items.length && (kind==='project_relink' || !job.result.folders.length)){emit('applied',job,kind==='project_import'?'No source files could be imported; review the results':'No media needed relinking; review missing and skipped results');return null;}
      ticket.phase='committing';emit('committing',job,'Applying prepared project media…');if(!current(ticket)){ticket.phase='preparing';throw new DOMException('Media context changed before applying','AbortError');}
      const receipt=await commit({kind:kind==='project_import'?'import_prepared_project_media':'relink_prepared_media',job_id:ticket.job});
      if(!id(receipt?.command_id) || receipt.project_epoch!==ticket.epoch || typeof receipt.changed!=='boolean' || kind==='project_import' && (!nativeIds(receipt.media_ids,256) || receipt.media_ids.length!==job.result.items.length || !nativeIds(receipt.folder_ids,128) || !Array.isArray(receipt.errors)) || kind==='project_relink' && (!nativeIds(receipt.relinked_media_ids,64) || receipt.relinked_media_ids.some(id=>!job.result.items.some(item=>item.media_id===id)) || !nativeIds(receipt.not_found,64) || JSON.stringify(receipt.not_found)!==JSON.stringify(job.result.not_found) || !nativeIds(receipt.skipped,64) || JSON.stringify(receipt.skipped)!==JSON.stringify(job.result.skipped) || !Array.isArray(receipt.errors) || receipt.ambiguous_count!==job.result.ambiguous_count))throw Error('Media command outcome needs verification; reconnect before repeating it');
      if(ticket.sourceCurrent() && getContext()?.project_epoch===ticket.epoch){try{await onApplied(receipt,job);emit('applied',job,'Project media updated');}catch(error){emit('applied',job,`Command applied · ${error.message}. Refresh; do not repeat it.`);}}
      return receipt;
    }catch(error){
      if(ticket.phase!=='committing'){ticket.canceled=true;await cancelJob(ticket);}
      if(error.name==='AbortError'){emit('canceled',state.job,'Media preparation canceled · project unchanged');return null;}
      emit(ticket.phase==='committing'?'uncertain':'failed',state.job,error.message);throw error;
    }finally{if(owner===ticket)owner=null;}
  }
  return {run,cancel,state:()=>state,busy:()=>Boolean(owner),phase:()=>owner?.phase || state.phase,invalidate(){if(owner && owner.phase!=='committing' && !current(owner))cancel();}};
}

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
  let active=false,session=0,picker=null,consumed=false,pendingOpen=false,operationSession=0;
  const closeButton=dialog.querySelector('form[method="dialog"] button');
  const label=document.createElement('label');label.className='field';label.textContent='Import into project folder';const destination=document.createElement('select');destination.setAttribute('aria-label','Import into project folder');label.append(destination);
  const browser=document.createElement('div'),results=document.createElement('details'),summary=document.createElement('summary'),failures=document.createElement('ul');summary.textContent='Import file results';failures.setAttribute('aria-label','Import file results');results.append(summary,failures);
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',action);return node;};
  function update(){
    if(!active)return;transfer.invalidate();destination.disabled=transfer.busy() || consumed;reloadButton.disabled=transfer.busy() || !canCommit();picker?.refresh();
    if(closeButton)closeButton.disabled=transfer.busy() && transfer.phase()==='committing';
    stop.disabled=!transfer.busy() || transfer.phase()==='committing' || transfer.phase()==='canceling';
  }
  function render(value){
    if(!active || operationSession!==session)return;
    if(['committing','applied','uncertain'].includes(value.phase))consumed=true;
    status.textContent=value.message;
    if(value.job?.result){const result=value.job.result;summary.textContent=`Import results · ${result.items.length} files · ${result.folders.length} folders · ${result.errors.length} errors`;failures.replaceChildren(...result.errors.map(item=>{const node=document.createElement('li');node.textContent=`${item.path_token} · ${item.code}: ${item.message}`;return node;}));}
    update();
  }
  const transfer=createProjectMediaTransfer({kind:'project_import',getContext,canCommit,commit,api,pause,onChange:render,onApplied:(receipt,job)=>onImported(receipt.media_ids,receipt,job.result)});
  async function begin(selection){
    if(!active || consumed || transfer.busy() || !canCommit())return;
    const bound=session,parent=destination.value || null,files=JSON.stringify(picker.selectedFiles());operationSession=bound;
    try{return await transfer.run({...selection,parent},()=>active && session===bound && (destination.value || null)===parent && JSON.stringify(picker?.selectedFiles())===files);}
    finally{update();if(pendingOpen && active && !transfer.busy()){pendingOpen=false;void open();}}
  }
  async function open({parent=null}={}){
    if(transfer.busy() && transfer.phase()==='committing'){if(!dialog.open)dialog.showModal();update();return;}
    hide();active=true;session++;operationSession=session;consumed=false;summary.textContent='Import file results';results.open=false;failures.replaceChildren();browser.replaceChildren();
    destination.replaceChildren(new Option('Project root',''),...folderPaths(getContext()?.folders || []).map(folder=>new Option(folder.path,folder.id)));destination.value=[...destination.options].some(option=>option.value===parent)?parent || '':'';
    if(!dialog.open)dialog.showModal();if(transfer.busy()){pendingOpen=true;status.textContent='Waiting for the preceding import to settle…';update();return;}
    const epoch=getContext()?.project_epoch,bound=session;if(!identity(getContext())){status.textContent='Create or open a project before importing media';update();return;}
    picker=createSourcePicker({root:browser,getContext,isCurrent:()=>active && session===bound && getContext()?.project_epoch===epoch,canChoose:()=>canCommit() && !consumed && !transfer.busy(),canCancel:()=>transfer.phase()!=='committing',api,
      folderLabel:'Import this folder and subfolders',filesLabel:'Import selected files',onChoose:directory_token=>begin({directory_token}),onChooseFiles:entries=>begin({path_tokens:entries.map(entry=>entry.path_token)}),onCancel:()=>{hide();dialog.close?.();},onStatus:message=>{if(active && session===bound && !transfer.busy())status.textContent=message;}});
    update();await picker.open();
  }
  const reloadButton=button('Refresh import files',()=>{if(!transfer.busy() && canCommit())void open();}),stop=button('Cancel import',()=>transfer.cancel());
  root.replaceChildren(label,browser,reloadButton,stop,results);destination.addEventListener('change',update);
  function hide(){active=false;session++;pendingOpen=false;picker?.dispose();picker=null;transfer.cancel();}
  dialog.addEventListener('close',()=>{if(transfer.busy() && transfer.phase()==='committing'){if(!dialog.open)dialog.showModal();update();return;}hide();});dialog.addEventListener('cancel',event=>{if(transfer.busy() && transfer.phase()==='committing')event.preventDefault();});
  update();return {open,invalidate:update,hide};
}
