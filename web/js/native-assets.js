import {request} from './api.js';
import {nativeFolderCatalog,nativeFolderChoices,nativeFolderFilter,nativeFolderOperation} from './native-asset-folders.js';
import {createSourcePicker} from './source-picker.js';

const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
export const nativeAssetIdentity=context=>context?.project_name?JSON.stringify([context.project_epoch,context.generation]):null;
const token=value=>typeof value==='string' && value.length>0 && value.length<=80 && [...value].every(char=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(char));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Preparation canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
export function nativeAssetMutation(context,clientId,operation,commandId){
  if(!nativeAssetIdentity(context) || ![context.command_epoch,context.project_epoch,context.generation,clientId,commandId].every(value=>typeof value==='string' && value.length))throw Error('Read the current project and writer before preparing a native library edit');
  return {command_id:commandId,client_id:clientId,command_epoch:context.command_epoch,project_epoch:context.project_epoch,if_generation:context.generation,if_revision:null,operation:structuredClone(operation)};
}
export function checkedNativeTreeReport(value,ready=false){
  if(!['imported_assets','skipped_files','error_count'].every(key=>Number.isSafeInteger(value?.[key]) && value[key]>=0 && value[key]<=64) || !Number.isSafeInteger(value.created_folders) || value.created_folders<0 || value.created_folders>128 || !(value.root_folder_id===null || token(value.root_folder_id)) || !(value.folders_revision==='absent' || typeof value.folders_revision==='string' && /^[a-f0-9]{64}$/.test(value.folders_revision)))throw Error('The native folder import report changed or is invalid');
  if(ready && (!Array.isArray(value.errors) || value.errors.length!==value.error_count || value.errors.length>64 || value.errors.some(error=>typeof error?.path_token!=='string' || !error.path_token || new TextEncoder().encode(error.path_token).length>1024 || typeof error.code!=='string' || !error.code || error.code.length>128 || typeof error.message!=='string' || !error.message || error.message.length>4096)))throw Error('The native folder import errors changed or are invalid');
  return value;
}

export function createNativeAssetTransfer({getContext,canCommit,libraryCommit,projectCommit,timelineCommit,makeLibraryMutation,api=apiRequest,pause=delay,onStatus=()=>{},onApplied=()=>{}}){
  let owner=null;
  const report=text=>onStatus(text);
  const checkedLibraryReceipt=(receipt,ticket,tree)=>{if(receipt?.command_id!==ticket.mutation.command_id || receipt.project_epoch!==ticket.epoch)throw Error('The recovered native library receipt does not match this command');if(tree)checkedNativeTreeReport(receipt);else if(![receipt.missing_count,receipt.relinked_files].every(value=>Number.isSafeInteger(value) && value>=0 && value<=64))throw Error('The recovered native relink receipt does not match this command');};
  const appliedMessage=(receipt,tree)=>tree?`Native folder imported · ${receipt.imported_assets} assets · ${receipt.skipped_files} skipped · ${receipt.error_count} errors · timeline unchanged`:`Native asset relinked · ${receipt.relinked_files} files restored · ${receipt.missing_count} still missing · timeline unchanged`;
  const jobPath=ticket=>`/native-assets/jobs/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  async function cancelJob(ticket){if(!ticket.job || ticket.cancelSent)return;ticket.cancelSent=true;try{await api(jobPath(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)});}catch{report('Cancellation requested; refresh the library before starting another preparation');}}
  function cancel(){if(!owner || owner.canceled || owner.phase==='committing')return false;owner.canceled=true;if(owner.job){owner.controller.abort();void cancelJob(owner);}report('Canceling native asset preparation…');return true;}
  const current=ticket=>owner===ticket && !ticket.canceled && nativeAssetIdentity(getContext())===ticket.identity && (!ticket.mutation || getContext()?.command_epoch===ticket.mutation.command_epoch) && canCommit() && ticket.sourceCurrent();
  async function run(action,sourceCurrent=()=>true,placement=null){
    action=structuredClone(action);placement=placement?structuredClone(placement):null;
    const placing=action.kind==='import_set';
    if(placing && (!placement || typeof timelineCommit!=='function' || !Array.isArray(action.assets) || !action.assets.length || action.assets.length>32 || new Set(action.assets.map(item=>item.asset_id)).size!==action.assets.length || action.assets.some(item=>!token(item.asset_id) || typeof item.revision!=='string' || !item.revision) || !Number.isSafeInteger(placement.start_frame) || placement.start_frame<0 || placement.start_frame>1_000_000_000 || !['track','new_video_track','new_audio_track'].includes(placement.target?.kind) || placement.target.kind==='track' && typeof placement.target.track_id!=='string'))return null;
    const tree=action.kind==='import_tree',relinking=['relink','relink_folder'].includes(action.kind),prepared=tree || relinking;
    if(owner || prepared && typeof makeLibraryMutation!=='function' || !canCommit() || !nativeAssetIdentity(getContext()) || !sourceCurrent())return null;
    const context=getContext(),ticket={identity:nativeAssetIdentity(context),epoch:context.project_epoch,generation:context.generation,controller:new AbortController(),phase:'preparing',sourceCurrent,canceled:false,job:null,cancelSent:false};owner=ticket;
    let receipt=null;
    try{
      if(prepared){const edit=tree?{action:'import_tree',directory_token:action.directory_token,parent:action.parent,folders_revision:action.folders_revision}:action.kind==='relink_folder'?{action:'relink_folder',id:action.asset_id,revision:action.revision,directory_token:action.directory_token}:{action:'relink',id:action.asset_id,revision:action.revision,path_tokens:[...action.path_tokens]};ticket.mutation=makeLibraryMutation({kind:'edit_native_asset_library',edit});}
      report(tree?'Preparing native source folder import…':relinking?'Preparing native asset relink…':'Preparing native asset files…');
      let job=await api(prepared?'/native-assets/commands/prepare':'/native-assets/prepare',prepared?ticket.mutation:{project_epoch:ticket.epoch,if_generation:ticket.generation,action});
      if(prepared && job?.state==='applied'){
        ticket.phase='committing';receipt=job.receipt;
        checkedLibraryReceipt(receipt,ticket,tree);
        if(current(ticket)){try{await onApplied(receipt,action,null);report(appliedMessage(receipt,tree));}catch(error){report(`Command applied · refresh failed: ${error.message}. Refresh the library; do not repeat the command.`);}}return receipt;
      }
      if(!token(job?.id))throw Error('The native asset preparation returned an invalid job ID');ticket.job=job.id;
      const validateJob=()=>{if(job.id!==ticket.job || job.project_epoch!==ticket.epoch || job.generation!==ticket.generation || job.kind!==(prepared?'library_edit':action.kind))throw Error('The native asset job no longer matches this preparation');};validateJob();
      if(!current(ticket))throw new DOMException('Project or selection changed during preparation','AbortError');
      while(['queued','running'].includes(job.state)){
        ticket.phase=job.state;report(`Native asset ${job.state} · ${job.bytes} / ${job.total_bytes} bytes`);
        await pause(300,ticket.controller.signal);job=await api(jobPath(ticket),undefined,{signal:ticket.controller.signal});validateJob();
        if(!current(ticket))throw new DOMException('Project or selection changed during preparation','AbortError');
      }
      if(job.state!=='ready')throw Error(job.error || `Native asset preparation ${job.state}`);
      if(action.kind==='import' && (job.result?.asset_id!==action.asset_id || job.result.revision!==action.revision))throw Error('The prepared asset revision changed');
      if(placing && (!Array.isArray(job.result?.assets) || job.result.assets.length!==action.assets.length || job.result.assets.some((item,index)=>item.asset_id!==action.assets[index].asset_id || item.revision!==action.assets[index].revision)))throw Error('The prepared asset set or order changed');
      if(relinking && (job.result?.asset_id!==action.asset_id || job.result.revision!==action.revision || ![job.result.missing_count,job.result.relinked_files].every(value=>Number.isSafeInteger(value) && value>=0 && value<=64)))throw Error('The prepared native relink revision or report changed');
      if(tree)checkedNativeTreeReport(job.result,true);
      if(!current(ticket))throw new DOMException('Project or selection changed before applying the asset','AbortError');
      ticket.phase='committing';report(tree?'Importing native source folder…':relinking?'Applying native asset relink…':action.kind==='capture'?'Publishing native asset…':'Importing native asset with one Undo…');
      receipt=await (placing?timelineCommit({kind:'place_native_assets',job_id:ticket.job,assets:action.assets,start_frame:placement.start_frame,target:placement.target,overwrite:Boolean(placement.overwrite)}):prepared?libraryCommit(ticket.mutation.operation,ticket.mutation):action.kind==='capture'?libraryCommit({kind:'publish_native_asset',job_id:ticket.job}):projectCommit({kind:'import_native_asset',job_id:ticket.job,asset_id:action.asset_id,revision:action.revision}));
      if(prepared)checkedLibraryReceipt(receipt,ticket,tree);
      try{await onApplied(receipt,action,tree?structuredClone(job.result):undefined);report(placing?'Native assets placed on timeline · one Undo available':prepared?appliedMessage(receipt,tree):action.kind==='capture'?'Native asset saved · timeline unchanged':'Native asset imported · project copy · Undo available');}
      catch(error){report(`Command applied · refresh failed: ${error.message}. Refresh the library; do not repeat the command.`);}
      return receipt;
    }catch(error){
      if(ticket.phase!=='committing'){ticket.canceled=true;await cancelJob(ticket);}
      if(error.name==='AbortError')report('Native asset preparation canceled · project unchanged');else report(ticket.phase==='committing'?`Native asset command failed: ${error.message}. Check command status before repeating it.`:error.message);
      if(error.name!=='AbortError')throw error;return null;
    }finally{if(owner===ticket)owner=null;}
  }
  return {run,cancel,busy:()=>Boolean(owner),phase:()=>owner?.phase || 'idle',invalidate(){if(owner && owner.phase!=='committing' && !current(owner))cancel();}};
}

export function createNativeAssetPanel({root,getContext,canCommit,libraryCommit,projectCommit,timelineCommit,assetDnd,makeLibraryMutation,onImported=()=>{},onPlaced=()=>{},notice=()=>{},api=apiRequest,pause=delay}){
  root.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});
  let active=false,sequence=0,panelSession=0,transferSession=0,readController=null,pendingReload=false,transferRefreshFailed=false,page=0,pages=1,search='',archived=false,selected=null,busy=false,batch=false,stopped=false,reading=false,readEpoch=null,rows=[],chosen=[],catalog=null,folder=null,folderLabels=new Map(),controls=[],folderControls=[],list,status,caption,name,capture,stop,importButton,rename,archive,previous,next,restore,download,folderFilter,folderName,folderCreateParent,folderParent,assetDestination,createFolder,renameFolder,moveFolder,removeFolder,moveAssets,relinkMenu,relinkButton,relinkArea,relinkDraft=null,relinkReader=null,relinkReading=false,relinkFiles,relinkApply,relinkCancel;
  let sourcePicker=null,sourceDraft=null,sourceArea,sourceReport,sourceDestination,importTree,relinkFolder;
  let dragRows=null,dragButtons=[],rowAnchor=null,readGeneration=null,placementAttempt=null;
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',action);return node;};
  const compact=(node,text)=>{node.setAttribute('aria-label',node.textContent);node.title=node.textContent;node.setAttribute('data-compact-label',text);return node;};
  const message=text=>{if(active && status?.isConnected)status.textContent=text;};
  const selection=()=>{const context=getContext();return (context?.media || []).filter(item=>(context.selected_ids || []).includes(item.id));};
  const transferring=()=>busy || batch || transfer.busy();
  const dragSelection=()=>rows.filter(item=>chosen.some(chosen=>chosen.id===item.id));
  const dragIdentity=()=>JSON.stringify([panelSession,nativeAssetIdentity(getContext()),getContext()?.command_epoch,folder,search,archived,dragSelection()]);
  const draggable=items=>Boolean(assetDnd && typeof timelineCommit==='function' && items.length && items.length<=32 && items.every(item=>!item.archived && !item.error && item.placement?.error==null && item.placement?.project_epoch===getContext()?.project_epoch && item.placement?.generation===getContext()?.generation && item.placement?.items?.length===1));
  function chooseRow(item,event={}){
    if(!active || root.isConnected===false || !rows.includes(item) || transferring() || reading)return;
    assetDnd?.end();
    if(event.shiftKey){const from=rows.findIndex(row=>row.id===rowAnchor),to=rows.indexOf(item);chosen=from<0?[item]:rows.slice(Math.min(from,to),Math.max(from,to)+1);rowAnchor??=item.id;}
    else{if(event.ctrlKey || event.metaKey)chosen=rows.filter(row=>row.id===item.id?!chosen.some(value=>value.id===row.id):chosen.some(value=>value.id===row.id));else chosen=[item];rowAnchor=item.id;}
    selected=chosen.length===1?chosen[0]:null;
    for(const option of list.children)option.selected=chosen.some(row=>row.id===rows[Number(option.value)]?.id);
    name.value=selected?.name || '';update();
  }
  function renderDragRows(){
    if(!dragRows)return;dragRows.replaceChildren();dragButtons=[];
    for(const item of rows){
      const row=button(item.name,event=>chooseRow(item,event));row.className='native-asset-drag-row';row.title=`${item.name} · Drag to the timeline. Selected rows drag together in library order.`;row.draggable=true;row.setAttribute('aria-label',`Native asset ${item.name}`);row.setAttribute('aria-pressed',String(chosen.some(value=>value.id===item.id)));
      row.addEventListener('dragstart',event=>{
        if(!active || row.isConnected===false || !rows.includes(item) || transferring() || reading || !canCommit() || readEpoch!==getContext()?.project_epoch){event.preventDefault();return;}
        if(!chosen.some(value=>value.id===item.id))chooseRow(item);
        const items=dragSelection(),identity=dragIdentity(),session=panelSession;
        const sourceCurrent=snapshot=>active && root.isConnected!==false && session===panelSession && readEpoch===getContext()?.project_epoch && dragIdentity()===identity && JSON.stringify(snapshot)===JSON.stringify(items.map(value=>({id:value.id,revision:value.revision,name:value.name,placement:value.placement})));
        const payload=draggable(items)?assetDnd.start(items,sourceCurrent,async(draft,targetCurrent,signal)=>{
          if(!sourceCurrent(items.map(value=>({id:value.id,revision:value.revision,name:value.name,placement:value.placement}))) || !targetCurrent() || signal.aborted || transfer.busy())return null;
          transferSession=session;transferRefreshFailed=false;const cancel=()=>transfer.cancel();signal.addEventListener('abort',cancel,{once:true});
          try{return await transfer.run({kind:'import_set',assets:draft.assets},()=>!signal.aborted && targetCurrent() && sourceCurrent(items.map(value=>({id:value.id,revision:value.revision,name:value.name,placement:value.placement}))),{start_frame:draft.start_frame,target:draft.target,overwrite:draft.overwrite});}
          finally{signal.removeEventListener('abort',cancel);settled();}
        }):null;
        if(!payload || !event.dataTransfer){event.preventDefault();assetDnd?.end();return;}
        try{event.dataTransfer.setData(assetDnd.type,payload);event.dataTransfer.effectAllowed='copy';}
        catch(error){event.preventDefault();assetDnd.end();notice(error.message);}
      });
      row.addEventListener('dragend',()=>assetDnd?.end());dragButtons.push({row,item});dragRows.append(row);
    }
  }
  root.addEventListener('keydown',event=>{
    if(!active || root.isConnected===false || !dragButtons.some(({row})=>event.target===row) || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 || event.getModifierState?.('AltGraph') || event.altKey || event.shiftKey || Boolean(event.ctrlKey)===Boolean(event.metaKey) || event.key?.toLowerCase()!=='a')return;
    event.preventDefault();event.stopPropagation();if(transferring() || reading)return;assetDnd?.end();chosen=[...rows];rowAnchor=rows[0]?.id??null;selected=chosen.length===1?chosen[0]:null;for(const option of list.children)option.selected=true;name.value=selected?.name || '';update();
  });
  const currentCatalog=()=>Boolean(catalog && catalog.project_epoch===getContext()?.project_epoch);
  const relinkIdentity=()=>JSON.stringify([panelSession,nativeAssetIdentity(getContext()),getContext()?.command_epoch,selected?.id,selected?.revision]);
  const relinkCurrent=draft=>active && Boolean(draft) && relinkDraft===draft && draft.identity===relinkIdentity() && !selected?.archived && !selected?.error;
  const sourceIdentity=()=>JSON.stringify([relinkIdentity(),catalog?.folders_revision,folder]);
  const sourceCurrent=draft=>active && sourceArea?.isConnected!==false && Boolean(draft) && sourceDraft===draft && draft.identity===sourceIdentity();
  function clearSourceChoice(){sourcePicker?.dispose();sourcePicker=null;sourceDraft=null;sourceDestination=null;sourceArea?.replaceChildren();}
  function clearRelink(){relinkReader?.abort();relinkReader=null;relinkDraft=null;relinkReading=false;relinkArea?.replaceChildren();relinkFiles=null;relinkApply=null;relinkCancel=null;}
  function options(node,choices,value){node.replaceChildren(...choices.map(item=>new Option(item.label,item.value)));node.value=choices.some(item=>item.value===value)?value:choices[0]?.value || '';}
  function folderFields(){
    const valid=currentCatalog(),current=valid && catalog.folders.find(item=>item.id===folder),choices=valid?nativeFolderChoices(catalog):[{value:'',label:'Library root'}];
    folderLabels=new Map(choices.map(item=>[item.value,item.label]));
    options(folderFilter,[{value:'*',label:'All native assets'},...choices],folder===null?'*':folder);if(valid)folder=folderFilter.value==='*'?null:folderFilter.value;
    options(folderCreateParent,choices,current?.id || '');options(folderParent,current?nativeFolderChoices(catalog,current.id):choices,current?.parent || '');options(assetDestination,choices,assetDestination.value);
    folderName.value=current?.name || '';
  }
  function clearSelection(){assetDnd?.end();clearRelink();clearSourceChoice();selected=null;chosen=[];rows=[];rowAnchor=null;list.replaceChildren();dragRows?.replaceChildren();dragButtons=[];name.value='';}
  function settled(){update();if(active && pendingReload && !transferring() && !reading){pendingReload=false;void reload(page);}}
  function update(){
    if(!active)return;if(relinkDraft && !relinkCurrent(relinkDraft))clearRelink();if(sourceDraft && !sourceCurrent(sourceDraft))clearSourceChoice();transfer.invalidate();const working=transferring() || reading || relinkReading,writable=canCommit() && !working,fresh=readEpoch===getContext()?.project_epoch,valid=fresh && selected && !selected.error && !selected.archived;
    for(const {row,item} of dragButtons){row.disabled=working;row.draggable=Boolean(writable && fresh && draggable([item]));row.setAttribute('aria-pressed',String(chosen.some(value=>value.id===item.id)));}
    for(const control of controls)control.disabled=working;list.disabled=working;previous.disabled=working || page===0;next.disabled=working || page+1>=pages;
    stop.disabled=!transfer.busy() || transfer.phase()==='committing';stop.hidden=!transfer.busy();
    capture.disabled=!writable || !nativeAssetIdentity(getContext()) || !selection().length || selection().length>64;capture.textContent=`Save ${selection().length || ''} selected media as native assets`.replace('  ',' ');
    importButton.disabled=!writable || !valid;rename.disabled=!writable || !valid;archive.disabled=!writable || !fresh || !selected?.revision;archive.textContent=selected?.archived?'Restore native asset':'Archive native asset';restore.disabled=!writable || !valid || !selected.can_restore_previous;
    caption.textContent=chosen.length>1?`${chosen.length} native assets selected`:selected?`${selected.name}${selected.archived?' · archived':''}${selected.error?` · ${selected.error}`:` · ${folderLabels.get(selected.effective_folder || '') || 'Library root'} · ${selected.media_count} media entities · ${selected.file_count} media files${Number.isSafeInteger(selected.missing_count)?` · ${selected.missing_count} missing`:''}`}`:'No native asset selected';
    download.hidden=!valid;if(valid)download.href=`/api/v1/native-assets/items/${encodeURIComponent(selected.id)}/download?${new URLSearchParams({project_epoch:getContext().project_epoch})}`;
    name.disabled=!writable || !valid;
    const foldersReady=writable && currentCatalog(),current=foldersReady && catalog.folders.some(item=>item.id===folder);
    for(const control of folderControls)control.disabled=!foldersReady;
    folderFilter.disabled=working || !currentCatalog();createFolder.disabled=!foldersReady;renameFolder.disabled=!current;moveFolder.disabled=!current;removeFolder.disabled=!current;
    moveAssets.disabled=!foldersReady || !fresh || !chosen.length || chosen.some(item=>item.error || item.archived || !item.revision);
    moveAssets.textContent=`Move ${chosen.length || ''} native assets to folder`.replace('  ',' ');
    relinkMenu.hidden=!valid || !Number.isSafeInteger(selected.missing_count) || selected.missing_count<1 || selected.missing_count>64;
    relinkButton.disabled=!writable || relinkMenu.hidden || typeof makeLibraryMutation!=='function';
    relinkFolder.disabled=relinkButton.disabled;importTree.disabled=!writable || !currentCatalog() || typeof makeLibraryMutation!=='function';
    if(relinkFiles){relinkFiles.disabled=!writable;const count=relinkFiles.selectedOptions.length;relinkApply.disabled=!writable || !relinkCurrent(relinkDraft) || count<1 || count>64;}
    if(relinkCancel)relinkCancel.disabled=transfer.phase()==='committing';
    if(sourceDestination)sourceDestination.disabled=!writable;sourcePicker?.refresh();
    const context=getContext(),attempt=JSON.stringify([context?.project_epoch,context?.generation]);
    if(assetDnd && readEpoch===context?.project_epoch && readGeneration!==null && readGeneration!==context?.generation && placementAttempt!==attempt && !working){placementAttempt=attempt;pendingReload=false;void reload(page,selected?.id,false,1,true);}
  }
  async function reload(wanted=page,preferred=selected?.id,afterWrite=false,direction=1,keepSelection=false){
    if(!active)return false;if(transferring() && !afterWrite){pendingReload=true;return false;}const context={...getContext()};if(!nativeAssetIdentity(context)){message('Create or open a project to use native assets');return false;}
    const selectionIds=keepSelection?chosen.map(item=>item.id):null,oldAnchor=rowAnchor,nameDraft=keepSelection?{id:selected?.id,revision:selected?.revision,value:name.value}:null;
    assetDnd?.end();clearRelink();clearSourceChoice();readController?.abort();readController=new AbortController();const id=++sequence;reading=true;update();message('Reading native assets…');
    try{
      const folders=await api(`/native-assets/folders?${new URLSearchParams({project_epoch:context.project_epoch})}`,undefined,{signal:readController.signal});
      if(!active || id!==sequence || context.project_epoch!==getContext()?.project_epoch || assetDnd && context.generation!==getContext()?.generation)return false;
      catalog=nativeFolderCatalog(folders,context.project_epoch);if(folder!==null && folder!=='' && !catalog.folders.some(item=>item.id===folder))folder='';folderFields();
      let result,scan=wanted;
      while(true){
        result=await api(`/native-assets/pages/${scan}?${new URLSearchParams({project_epoch:context.project_epoch,search,archived:String(archived),...nativeFolderFilter(catalog,folder)})}`,undefined,{signal:readController.signal});
        if(!active || id!==sequence || context.project_epoch!==getContext()?.project_epoch || assetDnd && context.generation!==getContext()?.generation)return false;
        const following=scan+direction;if(!search && folder===null || result.items.length || following<0 || following>=result.pages)break;
        message(`Searching native asset page ${scan+1} of ${result.pages}…`);scan=following;
      }
      page=result.page;pages=result.pages;list.replaceChildren(...result.items.map((item,index)=>new Option(`${item.name}${item.error?' · invalid':''}`,String(index))));
      const found=result.items.findIndex(item=>item.id===preferred),keepOutside=selected?.id===preferred && selected?.archived===archived && found<0 && folder===null,index=keepOutside?-1:Math.max(0,found);if(!keepOutside)selected=result.items[index] || null;rows=result.items;chosen=selected?[selected]:[];readEpoch=context.project_epoch;list.value=String(index);name.value=selected?.name || '';
      readGeneration=context.generation;
      if(selectionIds){chosen=rows.filter(item=>selectionIds.includes(item.id));selected=chosen.length===1?chosen[0]:null;for(const option of list.children)option.selected=chosen.some(item=>item.id===rows[Number(option.value)]?.id);name.value=selected?.id===nameDraft.id && selected?.revision===nameDraft.revision?nameDraft.value:selected?.name || '';}
      rowAnchor=keepSelection && rows.some(item=>item.id===oldAnchor)?oldAnchor:selected?.id??null;renderDragRows();list.onchange=()=>{assetDnd?.end();const indexes=list.selectedOptions?Array.from(list.selectedOptions,item=>Number(item.value)):[Number(list.value)];chosen=indexes.map(index=>rows[index]).filter(Boolean);rowAnchor=chosen[0]?.id??null;selected=chosen.length===1?chosen[0]:null;name.value=selected?.name || '';update();};message(`Page ${page+1} of ${pages} · ${result.total} ${archived?'archived':'native'} assets in library`);return true;
    }catch(error){if(active && id===sequence && error.name!=='AbortError'){if(wanted>0 && /last page|out of range/i.test(error.message))return reload(0,preferred,afterWrite,direction);clearSelection();readEpoch=null;catalog=null;message(error.message);}return false;}
    finally{if(id===sequence){reading=false;update();}}
  }
  const transfer=createNativeAssetTransfer({getContext,canCommit,libraryCommit,projectCommit,timelineCommit,makeLibraryMutation,api,pause,onStatus:text=>{if(transferSession===panelSession)message(text);update();},onApplied:async(receipt,action,report)=>{
    if(!active || transferSession!==panelSession)return;
    if(['relink','relink_folder','import_tree'].includes(action.kind) && receipt.project_epoch!==getContext()?.project_epoch)return;
    if(action.kind==='import' && receipt.project_epoch===getContext()?.project_epoch)onImported(receipt.media_ids || []);
    if(action.kind==='import_set'){onPlaced(receipt);return;}
    try{
      if(action.kind==='capture'){
        const session=panelSession,epoch=getContext()?.project_epoch;
        const created=await api(`/native-assets/items/${encodeURIComponent(receipt.command_id)}?${new URLSearchParams({project_epoch:epoch})}`);
        if(!active || session!==panelSession || epoch!==getContext()?.project_epoch)return;selected=created;folder=null;
      }
      const session=panelSession;
      if(action.kind==='import_tree' && receipt.root_folder_id!==null){folder=receipt.root_folder_id;selected=null;chosen=[];}
      if(!await reload(action.kind==='import_tree'?0:page,action.kind==='capture'?receipt.command_id:selected?.id,true))throw Error('The native asset list could not be refreshed');
      if(action.kind==='import_tree' && active && session===panelSession && receipt.project_epoch===getContext()?.project_epoch){
        sourceReport.replaceChildren();const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent=`Folder import result · ${receipt.error_count} errors`;text.textContent=`${receipt.imported_assets} assets imported · ${receipt.skipped_files} files skipped · ${receipt.created_folders} folders created`;details.append(summary,text);
        if(report)for(const error of report.errors){const row=document.createElement('p');row.textContent=`${error.path_token} · ${error.code}: ${error.message}`;details.append(row);}else if(receipt.error_count){const row=document.createElement('p');row.textContent='This command was already applied. Per-file details are unavailable; do not repeat the import to recover them.';details.append(row);}
        sourceReport.append(details);
      }
    }catch(error){transferRefreshFailed=true;throw error;}
  }});
  async function openRelink(){
    if(transferring() || reading || relinkReading || !canCommit() || readEpoch!==getContext()?.project_epoch || !selected?.revision || !Number.isSafeInteger(selected.missing_count) || selected.missing_count<1 || selected.missing_count>64 || selected.archived || selected.error || typeof makeLibraryMutation!=='function')return;
    clearSourceChoice();clearRelink();const draft={identity:relinkIdentity(),item:{...selected},paths:[]};relinkDraft=draft;relinkReader=new AbortController();const signal=relinkReader.signal;relinkReading=true;
    relinkCancel=button('Cancel native asset relink',()=>{if(transfer.phase()==='committing')return;const canceling=transfer.busy();transfer.cancel();clearRelink();message(canceling?'Cancellation requested · waiting for native asset status':'Native asset relink canceled · library unchanged');update();});relinkArea.append(relinkCancel);update();message('Reading approved source files…');
    try{
      const files=(await api('/projects',undefined,{signal})).importable_media;
      if(!relinkCurrent(draft) || signal.aborted)return;
      if(!Array.isArray(files) || files.length>4096 || files.some(item=>typeof item?.name!=='string' || !item.name || typeof item.path_token!=='string' || !item.path_token || item.path_token.length>128 || /[\\/\u0000-\u001f]/.test(item.path_token)) || new Set(files.map(item=>item.path_token)).size!==files.length)throw Error('The approved source file list is invalid; refresh before relinking');
      draft.paths=files.map(item=>item.path_token);const note=document.createElement('p');note.className='muted';note.textContent='Choose existing files from the approved project root. Native Relink matches missing filenames, preserves readable files and reports files still missing. No recursive folder search.';
      const label=document.createElement('label');label.className='field';label.textContent='Approved source files';relinkFiles=document.createElement('select');relinkFiles.multiple=true;relinkFiles.size=6;relinkFiles.setAttribute('aria-label','Approved source files');relinkFiles.append(...files.map(item=>new Option(item.name,item.path_token)));relinkFiles.addEventListener('change',update);label.append(relinkFiles);
      relinkApply=button('Relink selected source files',()=>void applyRelink(draft));relinkArea.replaceChildren(note,label,relinkApply,relinkCancel);message(`${draft.item.missing_count} missing native asset files · select up to 64 approved source files`);
    }catch(error){if(relinkCurrent(draft) && error.name!=='AbortError'){clearRelink();update();message(error.message);}}
    finally{if(relinkDraft===draft){relinkReading=false;relinkReader=null;update();}}
  }
  async function applyRelink(draft){
    if(!relinkCurrent(draft) || transferring() || reading || relinkReading || !canCommit() || !relinkFiles)return;
    const paths=Array.from(relinkFiles.selectedOptions,option=>option.value);if(!paths.length || paths.length>64 || new Set(paths).size!==paths.length || paths.some(path=>!draft.paths.includes(path)))return;
    const session=panelSession;transferSession=session;transferRefreshFailed=false;
    try{await transfer.run({kind:'relink',asset_id:draft.item.id,revision:draft.item.revision,path_tokens:paths},()=>relinkCurrent(draft) && JSON.stringify(Array.from(relinkFiles?.selectedOptions || [],option=>option.value))===JSON.stringify(paths));}
    catch(error){if(active && session===panelSession)notice(error.message);}
    finally{if(active && session===panelSession)clearRelink();settled();}
  }
  function openSourceChoice(kind){
    if(transferring() || reading || relinkReading || !canCommit() || !currentCatalog() || typeof makeLibraryMutation!=='function' || kind==='relink_folder' && (relinkMenu.hidden || !selected?.revision))return;
    clearRelink();clearSourceChoice();sourceReport.replaceChildren();const draft={kind,identity:sourceIdentity(),item:selected?{...selected}:null,folders_revision:catalog.folders_revision};sourceDraft=draft;
    const note=document.createElement('p');note.className='muted';note.textContent=kind==='import_tree'?'Import the selected folder and its subfolders into the native library. Native matching merges folders, skips duplicates and reports per-file errors. The project timeline stays unchanged.':'Search the selected folder and its subfolders for missing native asset filenames. Readable library files stay unchanged.';sourceArea.append(note);
    if(kind==='import_tree'){const label=document.createElement('label');label.className='field';label.textContent='Import into native library folder';sourceDestination=document.createElement('select');sourceDestination.setAttribute('aria-label','Import into native library folder');options(sourceDestination,nativeFolderChoices(catalog),folder || '');label.append(sourceDestination);sourceArea.append(label);}
    const chooser=document.createElement('div');sourceArea.append(chooser);
    sourcePicker=createSourcePicker({root:chooser,getContext,isCurrent:()=>sourceCurrent(draft),canChoose:()=>canCommit() && !transferring() && !reading && sourceCurrent(draft),canCancel:()=>transfer.phase()!=='committing',api,onCancel:()=>{const canceling=transfer.busy();transfer.cancel();clearSourceChoice();message(canceling?'Cancellation requested · waiting for native asset status':'Source folder choice canceled · library unchanged');update();},onChoose:async directory=>{
      if(!sourceCurrent(draft) || !canCommit() || transferring())return;
      const parent=sourceDestination?.value || null,action=kind==='import_tree'?{kind,directory_token:directory,parent,folders_revision:draft.folders_revision}:{kind,asset_id:draft.item.id,revision:draft.item.revision,directory_token:directory},session=panelSession;transferSession=session;transferRefreshFailed=false;
      try{await transfer.run(action,()=>sourceCurrent(draft) && (kind!=='import_tree' || (sourceDestination?.value || null)===parent));}catch(error){if(active && session===panelSession)notice(error.message);}finally{if(active && session===panelSession)clearSourceChoice();settled();}
    }});update();void sourcePicker.open();
  }
  async function edit(action){
    if(transferring() || reading || !canCommit() || readEpoch!==getContext()?.project_epoch || !selected?.revision)return;busy=true;update();const item={...selected},session=panelSession;let applied=false;
    try{await libraryCommit({kind:'edit_native_asset_library',edit:{action,id:item.id,revision:item.revision,...(action==='update'?{name:name.value.trim()}:{})}});applied=true;if(!active || session!==panelSession)return;selected=null;if(!await reload(page,item.id,true))throw Error('The native asset list could not be refreshed');message('Native asset library updated · timeline unchanged');}
    catch(error){const text=applied?`Command applied · ${error.message}. Refresh before doing anything else; do not repeat it.`:error.message;message(text);notice(text);}
    finally{busy=false;settled();}
  }
  async function editFolders(action){
    if(transferring() || reading || !canCommit() || !currentCatalog())return;
    let edit;try{edit=nativeFolderOperation(action,catalog,{id:folder,name:folderName.value,parent:action==='create_folder'?folderCreateParent.value:folderParent.value,folder:assetDestination.value,items:chosen});}catch(error){message(error.message);return;}
    const session=panelSession,epoch=getContext()?.project_epoch,parent=catalog.folders.find(item=>item.id===folder)?.parent || '';busy=true;update();let applied=false;
    try{
      const receipt=await libraryCommit({kind:'edit_native_asset_library',edit});applied=true;
      if(!active || session!==panelSession || epoch!==getContext()?.project_epoch)return;
      if(action==='create_folder')folder=receipt.command_id;else if(action==='remove_folder')folder=parent;
      clearSelection();if(!await reload(0,undefined,true))throw Error('The native folder catalog could not be refreshed');message('Native library folders updated · timeline unchanged');
    }catch(error){const text=applied?`Command applied · ${error.message}. Refresh before doing anything else; do not repeat it.`:error.message;message(text);notice(text);}
    finally{busy=false;settled();}
  }
  async function captureSelection(requestedIds=null){
    if(!active || transferring() || reading || !canCommit())return;
    const context=getContext();
    if(requestedIds!==null && (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length>64 || new Set(requestedIds).size!==requestedIds.length || requestedIds.some(id=>!context?.media.some(item=>item.id===id))))throw Error('Choose 1 to 64 distinct current project media for native asset capture');
    if(requestedIds!==null)requestedIds=[...requestedIds];
    const currentSelection=()=>requestedIds===null?selection():requestedIds.map(id=>getContext()?.media.find(item=>item.id===id)).filter(Boolean);
    const items=currentSelection().map(item=>({...item})),identity=nativeAssetIdentity(context),ids=JSON.stringify(items.map(item=>item.id)),session=panelSession;if(!items.length || items.length>64)return;
    batch=true;stopped=false;transferSession=session;transferRefreshFailed=false;update();let saved=0;
    try{for(const item of items){if(stopped || !active || session!==panelSession)break;const sourceCurrent=()=>active && session===panelSession && !stopped && nativeAssetIdentity(getContext())===identity && JSON.stringify(currentSelection().map(item=>item.id))===ids;const receipt=await transfer.run({kind:'capture',media_id:item.id,name:item.name},sourceCurrent);if(!receipt)break;saved++;if(transferRefreshFailed)break;}if(session===panelSession && !transferRefreshFailed)message(`${saved} native asset${saved===1?'':'s'} saved · timeline unchanged`);}
    catch(error){message(`${saved} assets saved · ${error.message}`);notice(error.message);}
    finally{batch=false;settled();}
  }
  return {
    captureSelection,
    async open(){
      this.hide();active=true;selected=null;chosen=[];rows=[];catalog=null;readEpoch=null;reading=false;root.className='native-asset-panel';root.replaceChildren();const heading=document.createElement('h3');heading.textContent='Native asset library';const note=document.createElement('p');note.className='muted';note.textContent='Reusable media and compound timelines. Files are copied into the library, then into each importing project. The shared archive remains available in Shared media archive.';
      const help=document.createElement('details'),helpHeading=document.createElement('summary');helpHeading.textContent='About native assets';help.append(helpHeading,note);
      const form=document.createElement('form'),query=document.createElement('input');form.className='native-asset-search';query.type='search';query.value=search;query.setAttribute('aria-label','Search native assets');const submit=document.createElement('button');submit.textContent='Search native assets';compact(submit,'Search');form.append(query,submit);form.addEventListener('submit',event=>{event.preventDefault();if(transferring())return;search=query.value;reload(0);});
      const archivedLabel=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=archived;toggle.setAttribute('aria-label','Show archived native assets');archivedLabel.append(toggle,' Show archived native assets');toggle.addEventListener('change',()=>{if(transferring())return;archived=toggle.checked;reload(0);});
      list=document.createElement('select');list.className='native-asset-list';list.size=7;list.multiple=true;list.setAttribute('aria-label','Native assets');dragRows=document.createElement('div');dragRows.className='native-asset-drag-list';dragRows.setAttribute('aria-label','Draggable native assets');status=document.createElement('p');status.className='native-asset-status';status.setAttribute('role','status');caption=document.createElement('p');caption.className='native-asset-caption';capture=button('Save selected media as native assets',()=>void captureSelection());stop=compact(button('Cancel native asset preparation',()=>{stopped=true;transfer.cancel();update();}),'Cancel');
      previous=compact(button('Previous native assets',()=>reload(page-1,selected?.id,false,-1)),'‹');next=compact(button('Next native assets',()=>reload(page+1)),'›');const refresh=compact(button('Refresh native assets',()=>reload()),'Refresh');
      importButton=button('Import native asset into project',async()=>{if(!selected || transferring())return;const item={...selected},session=panelSession;transferSession=session;transferRefreshFailed=false;try{await transfer.run({kind:'import',asset_id:item.id,revision:item.revision},()=>active && session===panelSession && selected?.id===item.id && selected?.revision===item.revision && !selected.archived && !selected.error);}catch(error){notice(error.message);}finally{settled();}});
      compact(importButton,'Add to project');
      const nameLabel=document.createElement('label');nameLabel.className='field';nameLabel.textContent='Native asset name';name=document.createElement('input');name.setAttribute('aria-label','Native asset name');nameLabel.append(name);rename=button('Rename native asset',()=>edit('update'));archive=button('Archive native asset',()=>edit(selected?.archived?'restore':'archive'));restore=button('Restore previous native asset settings',()=>edit('restore_previous'));download=document.createElement('a');download.textContent='Download desktop asset JSON';
      relinkMenu=document.createElement('div');relinkMenu.className='native-asset-relink';relinkButton=compact(button('Relink missing native asset files',()=>void openRelink()),'Choose replacement files…');relinkFolder=compact(button('Search folder for missing files',()=>openSourceChoice('relink_folder')),'Search source folder…');relinkArea=document.createElement('div');relinkMenu.append(relinkButton,relinkFolder,relinkArea);
      const libraryActions=document.createElement('details'),librarySummary=document.createElement('summary');libraryActions.className='native-asset-actions';librarySummary.textContent='Library actions';libraryActions.append(librarySummary);importTree=compact(button('Import source folder',()=>openSourceChoice('import_tree')),'Import folder…');libraryActions.append(importTree);sourceArea=document.createElement('div');sourceArea.className='native-asset-source';sourceReport=document.createElement('div');sourceReport.className='native-asset-report';
      const field=(label,node)=>{const wrapper=document.createElement('label');wrapper.className='field';wrapper.textContent=label;node.setAttribute('aria-label',label);wrapper.append(node);return wrapper;};
      folderFilter=document.createElement('select');folderFilter.addEventListener('change',()=>{if(transferring() || reading)return;folder=folderFilter.value==='*'?null:folderFilter.value;clearSelection();void reload(0);});
      const folders=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Organize native library folders';const explanation=document.createElement('p');explanation.className='muted';explanation.textContent='Choose a folder in the filter to rename, move or remove it. Removing it moves its direct contents to its parent and keeps all media files.';
      folderName=document.createElement('input');folderCreateParent=document.createElement('select');folderParent=document.createElement('select');assetDestination=document.createElement('select');
      createFolder=button('Create native folder',()=>editFolders('create_folder'));renameFolder=button('Rename native folder',()=>editFolders('rename_folder'));moveFolder=button('Move native folder',()=>editFolders('move_folder'));removeFolder=button('Remove folder and move contents up',()=>editFolders('remove_folder'));moveAssets=button('Move native assets to folder',()=>editFolders('move_assets'));
      folders.append(summary,explanation,field('Native folder name',folderName),field('New native folder parent',folderCreateParent),createFolder,renameFolder,field('Native folder parent',folderParent),moveFolder,removeFolder,field('Move native assets to',assetDestination),moveAssets);
      libraryActions.append(capture,folders,archivedLabel,help);
      const assetActions=document.createElement('details'),assetSummary=document.createElement('summary');assetActions.className='native-asset-actions';assetSummary.textContent='Asset actions';assetActions.append(assetSummary,nameLabel,rename,archive,restore,download,relinkMenu);
      const paging=document.createElement('div'),primary=document.createElement('div');paging.className='native-asset-paging';paging.append(previous,next,refresh);primary.className='native-asset-primary';primary.append(importButton,stop);
      let assetList=list;
      if(assetDnd){const selectionMenu=document.createElement('details'),selectionSummary=document.createElement('summary'),listGroup=document.createElement('div');selectionSummary.textContent='Multiple selection';selectionMenu.append(selectionSummary,list);listGroup.append(dragRows,selectionMenu);assetList=listGroup;}
      controls=[query,submit,toggle,refresh];folderControls=[folderName,folderCreateParent,folderParent,assetDestination];root.append(heading,field('Native asset folder',folderFilter),form,assetList,paging,caption,primary,libraryActions,assetActions,sourceArea,sourceReport,status);folderFields();update();await reload(page);
    },
    invalidate(){update();},
    hide(){assetDnd?.end();active=false;stopped=true;pendingReload=false;sequence++;panelSession++;readController?.abort();readController=null;reading=false;clearRelink();clearSourceChoice();transfer.cancel();},
  };
}
