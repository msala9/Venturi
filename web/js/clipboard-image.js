import {request,ApiFailure} from './api.js';
import {clipboardIdentity} from './clipboard.js';

export const MAX_CLIPBOARD_IMAGE_BYTES=32*1024*1024;
export const CLIPBOARD_IMAGE_TYPES={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp','image/tiff':'tif'};
const key=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const identity=context=>context?.project_name && clipboardIdentity(context)?JSON.stringify([clipboardIdentity(context),context.project_name]):null;
const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Image paste canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});

export function clipboardImageName(value){
  const name=String(value??'').trim();
  if(!name || name==='.' || name==='..' || new TextEncoder().encode(name).length>120 || /[\\/\u0000-\u001f\u007f-\u009f]/.test(name))throw Error('Choose an image name of up to 120 UTF-8 bytes without path separators or control characters');
  return name;
}
export function checkedClipboardImage(blob){
  if(!blob || !Object.hasOwn(CLIPBOARD_IMAGE_TYPES,blob.type) || !Number.isSafeInteger(blob.size) || blob.size<=0 || blob.size>MAX_CLIPBOARD_IMAGE_BYTES)throw Error('Paste a PNG, JPEG, WebP, GIF, BMP or TIFF image of up to 32 MiB');
  return blob;
}
export function clipboardEventImage(data){
  const items=Array.from(data?.items || []);
  for(const mime of Object.keys(CLIPBOARD_IMAGE_TYPES))for(const item of items)if(item.kind==='file' && item.type===mime){const blob=item.getAsFile();if(blob)return checkedClipboardImage(blob);}
  return null;
}
export async function readSystemClipboardImage({clipboard=globalThis.navigator?.clipboard}={}){
  if(!clipboard?.read)throw Error('System image clipboard access is unavailable');
  const items=await clipboard.read();
  for(const mime of Object.keys(CLIPBOARD_IMAGE_TYPES))for(const item of items)if(item.types?.includes(mime))return checkedClipboardImage(await item.getType(mime));
  throw Error('The system clipboard has no supported image');
}
export async function uploadClipboardImage(blob,context,{fetcher=fetch}={}){
  checkedClipboardImage(blob);
  const response=await fetcher(`/api/v1/clipboard/images/prepare?${new URLSearchParams({project_epoch:context.project_epoch,if_generation:context.generation})}`,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal:AbortSignal.timeout(120000)});
  let value;try{value=await response.json();}catch{throw new ApiFailure('Image preparation returned an invalid response','INVALID_RESPONSE',response.status);}
  if(!response.ok)throw new ApiFailure(value.error?.message || 'Image preparation failed',value.error?.code || 'REQUEST_FAILED',response.status);
  return value;
}
const ownedJob=(value,ticket)=>key(value?.id) && (!ticket.job || value.id===ticket.job) && value.kind==='clipboard_image' && value.project_epoch===ticket.epoch && value.generation===ticket.generation && ['queued','running','ready','failed','canceled'].includes(value.state);
function checkedJob(value,ticket){
  if(!ownedJob(value,ticket))throw Error('Image preparation no longer matches this paste');
  if(value.state==='ready'){
    const result=value.result;
    if(!result || result.mime!==ticket.mime || result.extension!==CLIPBOARD_IMAGE_TYPES[ticket.mime] || result.bytes!==ticket.bytes || !Number.isSafeInteger(result.width) || result.width<1 || result.width>32768 || !Number.isSafeInteger(result.height) || result.height<1 || result.height>32768 || clipboardImageName(result.suggested_name)!==result.suggested_name)throw Error('The native clipboard image summary is invalid');
  }else if(value.result!=null)throw Error('Unfinished image preparation returned a result');
  return value;
}

export function createClipboardImage({getContext,canCommit,commit,api=apiRequest,upload=uploadClipboardImage,readImage=readSystemClipboardImage,pause=delay,onChange=()=>{},onImported=()=>{}}){
  let owner=null,disposed=false,state={phase:'idle',job:null,message:'Paste an image into a saved project'};
  const emit=(phase,message,job=null)=>{state={phase,message,job};onChange(state);};
  const current=ticket=>!disposed && owner===ticket && !ticket.canceled && canCommit() && identity(getContext())===ticket.identity;
  const path=ticket=>`/clipboard/images/jobs/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  const release=ticket=>ticket.job?(ticket.deletion??=api(path(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)}).catch(()=>{})):Promise.resolve();
  function start(){
    if(disposed || owner || !canCommit())return null;
    const context=getContext();if(!identity(context)){emit('save_required','Save the current project before pasting an image');throw Error('Save the current project before pasting an image');}
    const ticket={identity:identity(context),context:{...context,clip_ids:[...context.clip_ids],media_ids:[...context.media_ids]},epoch:context.project_epoch,generation:context.generation,job:null,mime:null,bytes:null,summary:null,phase:'reading',controller:new AbortController(),canceled:false,deletion:null};owner=ticket;return ticket;
  }
  async function prepare(ticket,blob){
    checkedClipboardImage(blob);ticket.mime=blob.type;ticket.bytes=blob.size;ticket.phase='preparing';emit('preparing','Preparing clipboard image with the native importer…');
    try{
      if(!current(ticket))return null;
      // Observe the upload acknowledgment after Cancel to release its exact temporary native job.
      const acknowledgment=await upload(blob,{project_epoch:ticket.epoch,generation:ticket.generation});if(ownedJob(acknowledgment,ticket))ticket.job=acknowledgment.id;
      let job=checkedJob(acknowledgment,ticket);let polls=0;
      while(current(ticket) && ['queued','running'].includes(job.state)){
        if(++polls>2100)throw Error('Image preparation timed out');emit('preparing',`Clipboard image · ${job.state}`,job);await pause(300,ticket.controller.signal);if(!current(ticket))break;
        job=checkedJob(await api(path(ticket),undefined,{signal:ticket.controller.signal}),ticket);
      }
      if(!current(ticket))return null;
      if(job.state!=='ready')throw Error(job.error || `Image preparation ${job.state}`);
      ticket.summary=job.result;ticket.phase='ready';emit('ready',`${job.result.width} × ${job.result.height} · ${job.result.extension.toUpperCase()} · ready to add`,job);
      if(!current(ticket)){cancel();return null;}return job.result;
    }catch(error){if(!ticket.canceled && current(ticket)){emit('error',error.message,state.job);throw error;}return null;}
    finally{if(ticket.phase!=='ready'){await release(ticket);if(owner===ticket){owner=null;if(ticket.canceled || state.phase!=='error')emit('canceled','Image paste canceled');else onChange(state);}}}
  }
  async function paste(blob){
    checkedClipboardImage(blob);const ticket=start();if(!ticket)return null;
    try{return await prepare(ticket,blob);}finally{if(owner===ticket && ticket.phase==='reading'){owner=null;onChange(state);}}
  }
  async function pasteSystem(){
    const ticket=start();if(!ticket)return null;let handedOff=false;
    try{emit('reading','Reading an image from system clipboard…');if(!current(ticket))return null;const blob=await readImage();if(!current(ticket))return null;handedOff=true;return await prepare(ticket,blob);}
    catch(error){if(handedOff)throw error;if(ticket.canceled || !current(ticket))return null;emit('error',error.message);throw error;}
    finally{if(owner===ticket && ticket.phase==='reading'){owner=null;if(state.phase==='reading' || state.phase==='canceling')emit('canceled','Image paste canceled');else onChange(state);}}
  }
  function cancel(){
    const ticket=owner;if(!ticket || ticket.phase==='committing' || ticket.canceled)return false;ticket.canceled=true;ticket.controller.abort();emit('canceling','Canceling image paste…',state.job);
    if(ticket.phase==='ready')void release(ticket).then(()=>{if(owner===ticket){owner=null;emit('canceled','Image paste canceled');}});
    return true;
  }
  async function add(value){
    const ticket=owner;if(!ticket || ticket.phase!=='ready' || !current(ticket))return null;
    const name=clipboardImageName(value);ticket.phase='committing';let submitted=false;
    try{
      emit('committing','Adding image to Pasted Images · one Undo…',state.job);if(!current(ticket))return null;
      submitted=true;const receipt=await commit({kind:'import_clipboard_image',job_id:ticket.job,name});
      if(!key(receipt?.command_id) || receipt.project_epoch!==ticket.epoch || !Array.isArray(receipt.media_ids) || receipt.media_ids.length!==1 || typeof receipt.media_ids[0]!=='string' || !/^[0-9]{1,20}$/.test(receipt.media_ids[0]) || !Array.isArray(receipt.errors) || receipt.errors.length)throw Error('Image import was acknowledged with an unexpected result; refresh and do not repeat Add');
      let message='Clipboard image added to Pasted Images · one Undo removes it from the project';
      const latest=getContext(),sameScope=latest && identity({...latest,generation:ticket.generation,timeline_revision:ticket.context.timeline_revision})===ticket.identity;
      if(!disposed && sameScope && canCommit())try{await onImported(receipt.media_ids,receipt);}catch(error){message=`Image added · view refresh failed: ${error.message}. Do not repeat Add.`;}
      emit('applied',message,state.job);return receipt;
    }catch(error){
      if(error.code==='IMAGE_NAME_TAKEN' && current(ticket)){ticket.phase='ready';emit('ready',`${error.message} · choose another image name`,state.job);throw error;}
      emit(submitted?'uncertain':'error',`${error.message}${submitted?' · Check command status before repeating Add':''}`,state.job);throw error;
    }finally{
      if(ticket.phase!=='ready'){if(!submitted)await release(ticket);if(owner===ticket){owner=null;if(!submitted && state.phase==='committing')emit('canceled','Image paste canceled');else onChange(state);}}
    }
  }
  return {paste,pasteSystem,add,cancel,state:()=>state,busy:()=>Boolean(owner),invalidate(){if(owner && owner.phase!=='committing' && !current(owner))cancel();},dispose(){disposed=true;cancel();}};
}

export function createClipboardImagePanel({getContext,canCommit,commit,onImported,onSaveRequired,notice=()=>{},...dependencies}){
  const dialog=document.createElement('dialog'),heading=document.createElement('h2'),form=document.createElement('form'),label=document.createElement('label'),name=document.createElement('input'),summary=document.createElement('p'),status=document.createElement('output'),add=document.createElement('button'),save=document.createElement('button'),cancel=document.createElement('button');
  dialog.id='clipboard-image-dialog';dialog.setAttribute('aria-label','Paste image');heading.textContent='Paste image';label.textContent='Image name';label.className='field';name.setAttribute('aria-label','Pasted image name');name.maxLength=120;name.required=true;label.append(name);summary.textContent='Added images are saved in Pasted Images beside the project. Cancel keeps the project unchanged.';status.setAttribute('role','status');status.setAttribute('data-clipboard-image-status','');add.type='submit';add.textContent='Add image';save.type='button';save.textContent='Save project';save.hidden=true;cancel.type='button';cancel.textContent='Cancel image paste';form.append(label,summary,status,add,save,cancel);dialog.append(heading,form);document.body.append(dialog);let shownJob=null;
  function controls(){const state=transfer.state();add.disabled=state.phase!=='ready' || !canCommit();try{clipboardImageName(name.value);}catch{add.disabled=true;}name.disabled=state.phase!=='ready';cancel.disabled=state.phase==='committing' || state.phase==='canceling';save.hidden=state.phase!=='save_required';}
  const transfer=createClipboardImage({getContext,canCommit,commit,...dependencies,onImported:async(ids,receipt)=>{dialog.close();return onImported?.(ids,receipt);},onChange(state){
    if(['reading','preparing','ready','committing','save_required'].includes(state.phase) && !dialog.open)dialog.showModal();
    if(state.phase==='ready' && state.job.id!==shownJob){shownJob=state.job.id;name.value=state.job.result.suggested_name;name.disabled=false;name.focus();name.select();}
    status.textContent=state.message;notice(state.message);controls();if(['applied','canceled'].includes(state.phase) && dialog.open)dialog.close();
  }});
  form.addEventListener('submit',event=>{event.preventDefault();if(!add.disabled)void transfer.add(name.value).catch(error=>{status.textContent=error.message;controls();});});name.addEventListener('input',controls);
  save.addEventListener('click',()=>{if(transfer.state().phase==='save_required' && !transfer.busy()){dialog.close();onSaveRequired?.();}});
  cancel.addEventListener('click',()=>{if(!transfer.busy())dialog.close();else transfer.cancel();});dialog.addEventListener('cancel',event=>{event.preventDefault();if(!transfer.busy())dialog.close();else transfer.cancel();});dialog.addEventListener('close',()=>transfer.cancel());
  return {...transfer,dialog,invalidate(){transfer.invalidate();controls();}};
}
