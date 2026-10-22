import {request} from './api.js';

export const MAX_CLIPBOARD_BYTES=4*1024*1024;
const key=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const entityIds=value=>Array.isArray(value) && value.length<=10000 && value.every(id=>typeof id==='string' && /^[0-9]{1,20}$/.test(id)) && new Set(value).size===value.length;
const boundedText=value=>typeof value==='string' && new TextEncoder().encode(value).length<=MAX_CLIPBOARD_BYTES;
const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Clipboard preparation canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});

export function clipboardBlocked(event,{dialogOpen=false}={}){
  const target=event.target,editable=target?.closest?.('[contenteditable]');
  return dialogOpen || event.defaultPrevented || event.repeat || event.isComposing || event.getModifierState?.('AltGraph') || target?.isContentEditable || editable && editable.getAttribute('contenteditable')!=='false' || Boolean(target?.closest?.('input,textarea,select,video,audio,dialog'));
}
export function clipboardAction(event,options={}){
  if(clipboardBlocked(event,options))return null;
  if(event.type==='paste')return 'paste';
  if(event.type==='copy')return 'copy';
  if(event.type==='cut')return options.owner==='pool'?null:'cut';
  if(event.type!=='keydown' || event.altKey || event.shiftKey || Boolean(event.ctrlKey)===Boolean(event.metaKey))return null;
  const key=event.key?.toLowerCase();return key==='c'?'copy':key==='x' && options.owner!=='pool'?'cut':null;
}
export function bindClipboardEvents({target,getOwner,isDialogOpen=()=>false,copy,paste,onError=()=>{}}){
  let pending=false,disposed=false;
  const handle=event=>{
    const action=clipboardAction(event,{owner:getOwner(),dialogOpen:isDialogOpen()});
    if(disposed || !action || action==='paste' && typeof event.clipboardData?.getData!=='function')return;
    event.preventDefault();if(pending)return;pending=true;
    try{
      // Native Edit menu events can arrive without a keydown; keep clipboard access in this gesture.
      const operation=action==='paste'?paste(event.clipboardData.getData('text/plain')):copy({cut:action==='cut'});
      void Promise.resolve(operation).catch(onError).finally(()=>{pending=false;});
    }catch(error){pending=false;onError(error);}
  };
  const types=['keydown','copy','cut','paste'];for(const type of types)target.addEventListener(type,handle);
  return {dispose(){disposed=true;for(const type of types)target.removeEventListener(type,handle);}};
}
export function clipboardIdentity(context){
  if(!context || typeof context.project_epoch!=='string' || !context.project_epoch || typeof context.generation!=='string' || !context.generation || !['pool','timeline'].includes(context.owner))return null;
  return JSON.stringify([context.project_epoch,context.generation,context.owner,context.timeline_id,context.timeline_revision,context.frame,[...context.clip_ids].sort(),[...context.media_ids].sort(),context.view_stamp,context.source_stamp]);
}
export function writeSystemClipboard(textPromise,{clipboard=globalThis.navigator?.clipboard,Item=globalThis.ClipboardItem}={}){
  if(clipboard?.write && Item)return clipboard.write([new Item({'text/plain':Promise.resolve(textPromise).then(text=>new Blob([text],{type:'text/plain'}))})]);
  return Promise.resolve(textPromise).then(text=>{if(!clipboard?.writeText)throw Error('System clipboard access is unavailable');return clipboard.writeText(text);});
}

function checkedJob(value,ticket){
  if(!key(value?.id) || ticket.job && value.id!==ticket.job || value.kind!=='clipboard_import' || value.project_epoch!==ticket.epoch || value.generation!==ticket.generation || !['queued','running','ready','failed','canceled'].includes(value.state))throw Error('Clipboard preparation no longer matches this destination');
  if(value.state==='ready'){
    const result=value.result;
    if(!Number.isSafeInteger(result?.clip_count) || result.clip_count<0 || result.clip_count>4096 || !Number.isSafeInteger(result.media_count) || result.media_count<0 || result.media_count>10000 || !Array.isArray(result.warnings) || result.warnings.length>65 || result.warnings.some(item=>typeof item!=='string' || item.length>2048))throw Error('The native clipboard summary is invalid');
  }else if(value.result!=null)throw Error('Unfinished clipboard preparation returned results');
  return value;
}

export function createClipboard({getContext,canCommit,commit,api=apiRequest,writeText=writeSystemClipboard,readText=()=>{if(!globalThis.navigator?.clipboard?.readText)throw Error('System clipboard read access is unavailable');return globalThis.navigator.clipboard.readText();},pause=delay,onChange=()=>{},onPasted=()=>{}}){
  let owner=null,cached=null,disposed=false,state={phase:'idle',message:'Native clips and media can be copied between projects',job:null};
  const emit=(phase,message,job=null)=>{state={phase,message,job};onChange(state);};
  const current=ticket=>!disposed && owner===ticket && !ticket.canceled && canCommit() && clipboardIdentity(getContext())===ticket.identity;
  const ticketFor=context=>({identity:clipboardIdentity(context),epoch:context.project_epoch,generation:context.generation,target:context.owner,timeline:context.timeline_id,context:{...context,clip_ids:[...context.clip_ids],media_ids:[...context.media_ids]},job:null,controller:new AbortController(),phase:'copying',canceled:false,deletion:null});
  const jobPath=ticket=>`/clipboard/jobs/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  const release=ticket=>ticket.job?(ticket.deletion??=api(jobPath(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)}).catch(()=>{})):Promise.resolve();
  const canStart=()=>!disposed && !owner && canCommit() && Boolean(clipboardIdentity(getContext()));
  const validCopy=context=>context.owner==='pool'?context.media_ids.length>0:context.timeline_id!=null && context.clip_ids.length>0;
  const callbackCurrent=ticket=>!disposed && getContext()?.project_epoch===ticket.epoch && getContext().owner===ticket.target && (ticket.target==='pool' || getContext().timeline_id===ticket.timeline) && canCommit();
  async function capture(ticket){
    const context=ticket.context,operation=ticket.target==='pool'?{kind:'copy_media',media_ids:context.media_ids}:{kind:'copy_clips',clip_ids:context.clip_ids};
    const receipt=await commit(operation,ticket.target==='pool');
    if(!current(ticket))throw Error('Native copy completed, but its selection or destination changed; nothing was cut');
    const revision=receipt?.clipboard_revision || getContext().clipboard_revision;
    if(!key(revision))throw Error('The copied native clipboard is unavailable; refresh before copying again');
    const value=await api(`/clipboard?${new URLSearchParams({project_epoch:ticket.epoch,if_generation:ticket.generation,clipboard_revision:revision})}`);
    if(!current(ticket) || value?.project_epoch!==ticket.epoch || value.generation!==ticket.generation || value.clipboard_revision!==revision || getContext().clipboard_revision!==revision || !boundedText(value.text) || !Number.isSafeInteger(value.clip_count) || value.clip_count<0 || value.clip_count>4096 || !Number.isSafeInteger(value.media_count) || value.media_count<0 || value.media_count>4096)throw Error('The copied native clipboard changed; nothing was cut');
    cached={text:value.text,revision};return value.text;
  }
  async function copy({cut=false}={}){
    if(!canStart())return null;
    const context=getContext();if(!validCopy(context) || cut && context.owner==='pool')return null;
    const ticket=ticketFor(context);owner=ticket;emit('copying',cut?'Copying selected clips before Cut…':'Copying native clips or media…');
    try{
      if(!current(ticket))throw Error('Clipboard context changed before copying; nothing was cut');
      const text=capture(ticket);
      // Invoke the clipboard adapter in the original user gesture, before awaiting native capture.
      let writing;try{writing=writeText(text);}catch(error){writing=Promise.reject(error);}
      const [captured,written]=await Promise.allSettled([text,writing]);
      if(captured.status==='rejected')throw captured.reason;
      if(written.status==='rejected'){emit('copied',`Copied in Venturi · system clipboard unavailable: ${written.reason?.message || written.reason}. Use Copy to system clipboard to retry. Nothing was cut.`);return {copied:true,system:false};}
      if(!current(ticket)){emit('copied','Copied to system clipboard · context changed, so nothing was cut');return {copied:true,system:true};}
      if(cut){
        ticket.phase='committing';emit('committing','Cutting the copied clips · one Undo…');
        if(!current(ticket)){emit('copied','Copied to system clipboard · context changed, so nothing was cut');return null;}
        await commit({kind:'cut_clips',clip_ids:ticket.context.clip_ids,clipboard_revision:cached.revision},false);
        emit('applied','Selected clips cut · one Undo restores them');
      }else emit('copied','Native selection copied to system clipboard');
      return {copied:true,system:true};
    }catch(error){emit(error.code==='OUTCOME_UNKNOWN'?'uncertain':'error',`${error.message}${ticket.phase==='committing'?' · Check command status before repeating Cut':''}`);throw error;}
    finally{if(owner===ticket){owner=null;onChange(state);}}
  }
  async function retrySystem(){
    if(!canStart() || !cached || getContext().clipboard_revision!==cached.revision)return false;
    const value=cached,ticket=ticketFor(getContext());owner=ticket;ticket.phase='writing';emit('copying','Writing the retained native copy to system clipboard…');
    try{await writeText(Promise.resolve(value.text));emit('copied','Retained native copy written to system clipboard · no clips cut');return true;}
    catch(error){emit('copied',`Native copy retained · ${error.message}`);return false;}
    finally{if(owner===ticket){owner=null;onChange(state);}}
  }
  function cancel(){
    if(!owner || !['preparing','reading'].includes(owner.phase) || owner.canceled)return false;
    owner.canceled=true;owner.controller.abort();void release(owner);emit('canceling','Canceling clipboard preparation…',state.job);return true;
  }
  async function paste(text=null,reading=null){
    if(reading?!current(reading):!canStart())return null;
    if(text!==null && !boundedText(text))throw Error('Clipboard text exceeds the native 4 MiB limit');
    const context=getContext();if(context.owner==='timeline' && !context.timeline_id)return null;
    const ticket=reading || ticketFor(context);owner=ticket;ticket.phase='preparing';let submitted=false;
    try{
      emit('preparing','Preparing native clipboard for this destination…');if(!current(ticket))return null;
      let job=checkedJob(await api('/clipboard/prepare',{project_epoch:ticket.epoch,if_generation:ticket.generation,text,to_pool:ticket.target==='pool'}),ticket);ticket.job=job.id;
      let polls=0;
      while(current(ticket) && ['queued','running'].includes(job.state)){
        if(++polls>2100)throw Error('Clipboard preparation timed out; refresh before pasting again');
        emit('preparing',`Native clipboard · ${job.state}`,job);await pause(300,ticket.controller.signal);if(!current(ticket))break;
        job=checkedJob(await api(jobPath(ticket),undefined,{signal:ticket.controller.signal}),ticket);
      }
      if(!current(ticket))return null;
      if(job.state!=='ready')throw Error(job.error || `Native clipboard ${job.state}`);
      ticket.phase='committing';emit('committing','Pasting native clipboard · one Undo…',job);if(!current(ticket))return null;
      submitted=true;const receipt=await commit({kind:'paste_prepared_clipboard',job_id:ticket.job,to_pool:ticket.target==='pool',timeline_id:ticket.target==='pool'?null:context.timeline_id,timeline_revision:ticket.target==='pool'?null:context.timeline_revision,frame:ticket.target==='pool'?0:context.frame},true);
      if(!key(receipt?.command_id) || receipt.project_epoch!==ticket.epoch || !entityIds(receipt.media_ids) || !entityIds(receipt.clip_ids) || typeof receipt.changed!=='boolean')throw Error('Paste was acknowledged with an unexpected result; refresh and do not repeat it');
      let message=receipt.changed?'Native clipboard pasted · one Undo restores the previous edit':'Nothing to paste for this destination';
      const toPool=ticket.target==='pool' || receipt.media_ids.length>0 && receipt.clip_ids.length===0;
      if(callbackCurrent(ticket))try{await onPasted(receipt,{to_pool:toPool,timeline_id:ticket.timeline});}catch(error){message=`Paste applied · view refresh failed: ${error.message}. Do not repeat Paste.`;}
      if(job.result.warnings.length)message+=` · ${job.result.warnings.join(' · ')}`;
      emit('applied',message,job);return receipt;
    }catch(error){
      if(!submitted && (ticket.canceled || !current(ticket) || error.name==='AbortError')){emit('canceled','Clipboard preparation canceled');return null;}
      emit(submitted?'uncertain':'error',`${error.message}${submitted?' · Check command status before repeating Paste':''}`,state.job);throw error;
    }finally{if(!submitted)await release(ticket);if(owner===ticket){owner=null;if(!submitted && !['error','canceled'].includes(state.phase))emit('canceled','Clipboard preparation canceled');else onChange(state);}}
  }
  async function pasteSystem(){
    if(!canStart())return null;
    const context=getContext();if(context.owner==='timeline' && !context.timeline_id)return null;
    const ticket=ticketFor(context);owner=ticket;ticket.phase='reading';let handedOff=false;
    try{
      emit('reading','Reading system clipboard for the captured destination…');if(!current(ticket))return null;
      const text=await readText();if(!current(ticket))return null;
      if(typeof text!=='string')throw Error('System clipboard did not return text');
      if(!boundedText(text))throw Error('Clipboard text exceeds the native 4 MiB limit');
      handedOff=true;return await paste(text,ticket);
    }catch(error){
      if(handedOff)throw error;
      if(ticket.canceled || !current(ticket)){emit('canceled','System clipboard paste canceled');return null;}
      emit('error',`System clipboard paste unavailable: ${error.message}. The retained Venturi copy was not pasted.`);throw error;
    }finally{if(owner===ticket){owner=null;if(['reading','canceling'].includes(state.phase))emit('canceled','System clipboard paste canceled');else onChange(state);}}
  }
  return {copy,paste:text=>paste(text),pasteSystem,retrySystem,cancel,state:()=>state,busy:()=>Boolean(owner),canRetry:()=>!owner && Boolean(cached) && getContext()?.clipboard_revision===cached.revision && canCommit(),invalidate(){if(owner && ['preparing','reading'].includes(owner.phase) && !current(owner))cancel();},dispose(){disposed=true;cancel();cached=null;}};
}
