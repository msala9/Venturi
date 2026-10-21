import {request} from './api.js';
import {nativeFolderCatalog,nativeFolderChoices,nativeFolderFilter,nativeFolderOperation} from './native-asset-folders.js';

const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
export const nativeAssetIdentity=context=>context?.project_name?JSON.stringify([context.project_epoch,context.generation]):null;
const token=value=>typeof value==='string' && value.length>0 && value.length<=80 && [...value].every(char=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(char));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Preparation canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});

export function createNativeAssetTransfer({getContext,canCommit,libraryCommit,projectCommit,api=apiRequest,pause=delay,onStatus=()=>{},onApplied=()=>{}}){
  let owner=null;
  const report=text=>onStatus(text);
  const jobPath=ticket=>`/native-assets/jobs/${encodeURIComponent(ticket.job)}?${new URLSearchParams({project_epoch:ticket.epoch})}`;
  async function cancelJob(ticket){if(!ticket.job || ticket.cancelSent)return;ticket.cancelSent=true;try{await api(jobPath(ticket),undefined,{method:'DELETE',signal:AbortSignal.timeout(5000)});}catch{report('Cancellation requested; refresh the library before starting another preparation');}}
  function cancel(){if(!owner || owner.canceled || owner.phase==='committing')return false;owner.canceled=true;if(owner.job){owner.controller.abort();void cancelJob(owner);}report('Canceling native asset preparation…');return true;}
  const current=ticket=>owner===ticket && !ticket.canceled && nativeAssetIdentity(getContext())===ticket.identity && canCommit() && ticket.sourceCurrent();
  async function run(action,sourceCurrent=()=>true){
    if(owner || !canCommit() || !nativeAssetIdentity(getContext()) || !sourceCurrent())return null;
    const context=getContext(),ticket={identity:nativeAssetIdentity(context),epoch:context.project_epoch,generation:context.generation,controller:new AbortController(),phase:'preparing',sourceCurrent,canceled:false,job:null,cancelSent:false};owner=ticket;
    let receipt=null;
    try{
      report('Preparing native asset files…');
      let job=await api('/native-assets/prepare',{project_epoch:ticket.epoch,if_generation:ticket.generation,action});
      if(!token(job?.id))throw Error('The native asset preparation returned an invalid job ID');ticket.job=job.id;
      const validateJob=()=>{if(job.id!==ticket.job || job.project_epoch!==ticket.epoch || job.generation!==ticket.generation || job.kind!==action.kind)throw Error('The native asset job no longer matches this preparation');};validateJob();
      if(!current(ticket))throw new DOMException('Project or selection changed during preparation','AbortError');
      while(['queued','running'].includes(job.state)){
        ticket.phase=job.state;report(`Native asset ${job.state} · ${job.bytes} / ${job.total_bytes} bytes`);
        await pause(300,ticket.controller.signal);job=await api(jobPath(ticket),undefined,{signal:ticket.controller.signal});validateJob();
        if(!current(ticket))throw new DOMException('Project or selection changed during preparation','AbortError');
      }
      if(job.state!=='ready')throw Error(job.error || `Native asset preparation ${job.state}`);
      if(action.kind==='import' && (job.result?.asset_id!==action.asset_id || job.result.revision!==action.revision))throw Error('The prepared asset revision changed');
      if(!current(ticket))throw new DOMException('Project or selection changed before applying the asset','AbortError');
      ticket.phase='committing';report(action.kind==='capture'?'Publishing native asset…':'Importing native asset with one Undo…');
      receipt=await (action.kind==='capture'?libraryCommit({kind:'publish_native_asset',job_id:ticket.job}):projectCommit({kind:'import_native_asset',job_id:ticket.job,asset_id:action.asset_id,revision:action.revision}));
      try{await onApplied(receipt,action);report(action.kind==='capture'?'Native asset saved · timeline unchanged':'Native asset imported · project copy · Undo available');}
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

export function createNativeAssetPanel({root,getContext,canCommit,libraryCommit,projectCommit,onImported=()=>{},notice=()=>{},api=apiRequest,pause=delay}){
  root.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});
  let active=false,sequence=0,panelSession=0,transferSession=0,readController=null,pendingReload=false,transferRefreshFailed=false,page=0,pages=1,search='',archived=false,selected=null,busy=false,batch=false,stopped=false,reading=false,readEpoch=null,rows=[],chosen=[],catalog=null,folder=null,folderLabels=new Map(),controls=[],folderControls=[],list,status,caption,name,capture,stop,importButton,rename,archive,previous,next,restore,download,folderFilter,folderName,folderCreateParent,folderParent,assetDestination,createFolder,renameFolder,moveFolder,removeFolder,moveAssets;
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',action);return node;};
  const message=text=>{if(active && status?.isConnected)status.textContent=text;};
  const selection=()=>{const context=getContext();return (context?.media || []).filter(item=>(context.selected_ids || []).includes(item.id));};
  const transferring=()=>busy || batch || transfer.busy();
  const currentCatalog=()=>Boolean(catalog && catalog.project_epoch===getContext()?.project_epoch);
  function options(node,choices,value){node.replaceChildren(...choices.map(item=>new Option(item.label,item.value)));node.value=choices.some(item=>item.value===value)?value:choices[0]?.value || '';}
  function folderFields(){
    const valid=currentCatalog(),current=valid && catalog.folders.find(item=>item.id===folder),choices=valid?nativeFolderChoices(catalog):[{value:'',label:'Library root'}];
    folderLabels=new Map(choices.map(item=>[item.value,item.label]));
    options(folderFilter,[{value:'*',label:'All native assets'},...choices],folder===null?'*':folder);if(valid)folder=folderFilter.value==='*'?null:folderFilter.value;
    options(folderCreateParent,choices,current?.id || '');options(folderParent,current?nativeFolderChoices(catalog,current.id):choices,current?.parent || '');options(assetDestination,choices,assetDestination.value);
    folderName.value=current?.name || '';
  }
  function clearSelection(){selected=null;chosen=[];rows=[];list.replaceChildren();name.value='';}
  function settled(){update();if(active && pendingReload && !transferring()){pendingReload=false;void reload(page);}}
  function update(){
    if(!active)return;transfer.invalidate();const working=transferring() || reading,writable=canCommit() && !working,fresh=readEpoch===getContext()?.project_epoch,valid=fresh && selected && !selected.error && !selected.archived;
    for(const control of controls)control.disabled=working;list.disabled=working;previous.disabled=working || page===0;next.disabled=working || page+1>=pages;
    stop.disabled=!transfer.busy() || transfer.phase()==='committing';
    capture.disabled=!writable || !nativeAssetIdentity(getContext()) || !selection().length || selection().length>64;capture.textContent=`Save ${selection().length || ''} selected media as native assets`.replace('  ',' ');
    importButton.disabled=!writable || !valid;rename.disabled=!writable || !valid;archive.disabled=!writable || !fresh || !selected?.revision;archive.textContent=selected?.archived?'Restore native asset':'Archive native asset';restore.disabled=!writable || !valid || !selected.can_restore_previous;
    caption.textContent=chosen.length>1?`${chosen.length} native assets selected`:selected?`${selected.name}${selected.archived?' · archived':''}${selected.error?` · ${selected.error}`:` · ${folderLabels.get(selected.effective_folder || '') || 'Library root'} · ${selected.media_count} media entities · ${selected.file_count} media files`}`:'No native asset selected';
    download.hidden=!valid;if(valid)download.href=`/api/v1/native-assets/items/${encodeURIComponent(selected.id)}/download?${new URLSearchParams({project_epoch:getContext().project_epoch})}`;
    name.disabled=!writable || !valid;
    const foldersReady=writable && currentCatalog(),current=foldersReady && catalog.folders.some(item=>item.id===folder);
    for(const control of folderControls)control.disabled=!foldersReady;
    folderFilter.disabled=working || !currentCatalog();createFolder.disabled=!foldersReady;renameFolder.disabled=!current;moveFolder.disabled=!current;removeFolder.disabled=!current;
    moveAssets.disabled=!foldersReady || !fresh || !chosen.length || chosen.some(item=>item.error || item.archived || !item.revision);
    moveAssets.textContent=`Move ${chosen.length || ''} native assets to folder`.replace('  ',' ');
  }
  async function reload(wanted=page,preferred=selected?.id,afterWrite=false,direction=1){
    if(!active)return false;if(transferring() && !afterWrite){pendingReload=true;return false;}const context=getContext();if(!nativeAssetIdentity(context)){message('Create or open a project to use native assets');return false;}
    readController?.abort();readController=new AbortController();const id=++sequence;reading=true;update();message('Reading native assets…');
    try{
      const folders=await api(`/native-assets/folders?${new URLSearchParams({project_epoch:context.project_epoch})}`,undefined,{signal:readController.signal});
      if(!active || id!==sequence || context.project_epoch!==getContext()?.project_epoch)return false;
      catalog=nativeFolderCatalog(folders,context.project_epoch);if(folder!==null && folder!=='' && !catalog.folders.some(item=>item.id===folder))folder='';folderFields();
      let result,scan=wanted;
      while(true){
        result=await api(`/native-assets/pages/${scan}?${new URLSearchParams({project_epoch:context.project_epoch,search,archived:String(archived),...nativeFolderFilter(catalog,folder)})}`,undefined,{signal:readController.signal});
        if(!active || id!==sequence || context.project_epoch!==getContext()?.project_epoch)return false;
        const following=scan+direction;if(!search && folder===null || result.items.length || following<0 || following>=result.pages)break;
        message(`Searching native asset page ${scan+1} of ${result.pages}…`);scan=following;
      }
      page=result.page;pages=result.pages;list.replaceChildren(...result.items.map((item,index)=>new Option(`${item.name}${item.error?' · invalid':''}`,String(index))));
      const found=result.items.findIndex(item=>item.id===preferred),keepOutside=selected?.id===preferred && selected?.archived===archived && found<0 && folder===null,index=keepOutside?-1:Math.max(0,found);if(!keepOutside)selected=result.items[index] || null;rows=result.items;chosen=selected?[selected]:[];readEpoch=context.project_epoch;list.value=String(index);name.value=selected?.name || '';
      list.onchange=()=>{const indexes=list.selectedOptions?Array.from(list.selectedOptions,item=>Number(item.value)):[Number(list.value)];chosen=indexes.map(index=>rows[index]).filter(Boolean);selected=chosen.length===1?chosen[0]:null;name.value=selected?.name || '';update();};message(`Page ${page+1} of ${pages} · ${result.total} ${archived?'archived':'native'} assets in library`);return true;
    }catch(error){if(active && id===sequence && error.name!=='AbortError'){if(wanted>0 && /last page|out of range/i.test(error.message))return reload(0,preferred,afterWrite,direction);clearSelection();readEpoch=null;catalog=null;message(error.message);}return false;}
    finally{if(id===sequence){reading=false;update();}}
  }
  const transfer=createNativeAssetTransfer({getContext,canCommit,libraryCommit,projectCommit,api,pause,onStatus:text=>{if(transferSession===panelSession)message(text);update();},onApplied:async(receipt,action)=>{
    if(!active || transferSession!==panelSession)return;
    if(action.kind==='import' && receipt.project_epoch===getContext()?.project_epoch)onImported(receipt.media_ids || []);
    try{
      if(action.kind==='capture'){
        const session=panelSession,epoch=getContext()?.project_epoch;
        const created=await api(`/native-assets/items/${encodeURIComponent(receipt.command_id)}?${new URLSearchParams({project_epoch:epoch})}`);
        if(!active || session!==panelSession || epoch!==getContext()?.project_epoch)return;selected=created;folder=null;
      }
      if(!await reload(page,action.kind==='capture'?receipt.command_id:selected?.id,true))throw Error('The native asset list could not be refreshed');
    }catch(error){transferRefreshFailed=true;throw error;}
  }});
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
  async function captureSelection(){
    if(transferring() || reading || !canCommit())return;const context=getContext(),items=selection().map(item=>({...item})),identity=nativeAssetIdentity(context),ids=JSON.stringify(items.map(item=>item.id)),session=panelSession;if(!items.length || items.length>64)return;
    batch=true;stopped=false;transferSession=session;transferRefreshFailed=false;update();let saved=0;
    try{for(const item of items){if(stopped || !active || session!==panelSession)break;const sourceCurrent=()=>active && session===panelSession && !stopped && nativeAssetIdentity(getContext())===identity && JSON.stringify(selection().map(item=>item.id))===ids;const receipt=await transfer.run({kind:'capture',media_id:item.id,name:item.name},sourceCurrent);if(!receipt)break;saved++;if(transferRefreshFailed)break;}if(session===panelSession && !transferRefreshFailed)message(`${saved} native asset${saved===1?'':'s'} saved · timeline unchanged`);}
    catch(error){message(`${saved} assets saved · ${error.message}`);notice(error.message);}
    finally{batch=false;settled();}
  }
  return {
    async open(){
      this.hide();active=true;selected=null;chosen=[];rows=[];catalog=null;readEpoch=null;reading=false;root.replaceChildren();const heading=document.createElement('h3');heading.textContent='Native asset library';const note=document.createElement('p');note.className='muted';note.textContent='Reusable media and compound timelines. Files are copied into the library, then into each importing project. The shared archive remains available in Shared media archive.';
      const form=document.createElement('form'),query=document.createElement('input');query.type='search';query.value=search;query.setAttribute('aria-label','Search native assets');const submit=document.createElement('button');submit.textContent='Search native assets';form.append(query,submit);form.addEventListener('submit',event=>{event.preventDefault();if(transferring())return;search=query.value;reload(0);});
      const archivedLabel=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=archived;toggle.setAttribute('aria-label','Show archived native assets');archivedLabel.append(toggle,' Show archived native assets');toggle.addEventListener('change',()=>{if(transferring())return;archived=toggle.checked;reload(0);});
      list=document.createElement('select');list.size=7;list.multiple=true;list.setAttribute('aria-label','Native assets');status=document.createElement('p');status.setAttribute('role','status');caption=document.createElement('p');capture=button('Save selected media as native assets',captureSelection);stop=button('Cancel native asset preparation',()=>{stopped=true;transfer.cancel();update();});
      previous=button('Previous native assets',()=>reload(page-1,selected?.id,false,-1));next=button('Next native assets',()=>reload(page+1));const refresh=button('Refresh native assets',()=>reload());
      importButton=button('Import native asset into project',async()=>{if(!selected || transferring())return;const item={...selected},session=panelSession;transferSession=session;transferRefreshFailed=false;try{await transfer.run({kind:'import',asset_id:item.id,revision:item.revision},()=>active && session===panelSession && selected?.id===item.id && selected?.revision===item.revision && !selected.archived && !selected.error);}catch(error){notice(error.message);}finally{settled();}});
      const nameLabel=document.createElement('label');nameLabel.className='field';nameLabel.textContent='Native asset name';name=document.createElement('input');name.setAttribute('aria-label','Native asset name');nameLabel.append(name);rename=button('Rename native asset',()=>edit('update'));archive=button('Archive native asset',()=>edit(selected?.archived?'restore':'archive'));restore=button('Restore previous native asset settings',()=>edit('restore_previous'));download=document.createElement('a');download.textContent='Download desktop asset JSON';
      const field=(label,node)=>{const wrapper=document.createElement('label');wrapper.className='field';wrapper.textContent=label;node.setAttribute('aria-label',label);wrapper.append(node);return wrapper;};
      folderFilter=document.createElement('select');folderFilter.addEventListener('change',()=>{if(transferring() || reading)return;folder=folderFilter.value==='*'?null:folderFilter.value;clearSelection();void reload(0);});
      const folders=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Organize native library folders';const explanation=document.createElement('p');explanation.className='muted';explanation.textContent='Choose a folder in the filter to rename, move or remove it. Removing it moves its direct contents to its parent and keeps all media files.';
      folderName=document.createElement('input');folderCreateParent=document.createElement('select');folderParent=document.createElement('select');assetDestination=document.createElement('select');
      createFolder=button('Create native folder',()=>editFolders('create_folder'));renameFolder=button('Rename native folder',()=>editFolders('rename_folder'));moveFolder=button('Move native folder',()=>editFolders('move_folder'));removeFolder=button('Remove folder and move contents up',()=>editFolders('remove_folder'));moveAssets=button('Move native assets to folder',()=>editFolders('move_assets'));
      folders.append(summary,explanation,field('Native folder name',folderName),field('New native folder parent',folderCreateParent),createFolder,renameFolder,field('Native folder parent',folderParent),moveFolder,removeFolder,field('Move native assets to',assetDestination),moveAssets);
      controls=[query,submit,toggle,refresh];folderControls=[folderName,folderCreateParent,folderParent,assetDestination];root.append(heading,note,capture,stop,field('Native asset folder',folderFilter),folders,form,archivedLabel,list,previous,next,refresh,caption,importButton,nameLabel,rename,archive,restore,download,status);folderFields();update();await reload(page);
    },
    invalidate(){update();},
    hide(){active=false;stopped=true;pendingReload=false;sequence++;panelSession++;readController?.abort();readController=null;reading=false;transfer.cancel();},
  };
}
