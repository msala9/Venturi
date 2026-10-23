import {request} from './api.js';
import {createSourcePicker} from './source-picker.js';
import {createProjectMediaTransfer,projectRelinkScope} from './media-import.js';

const apiRequest=(path,body,{signal,method}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Relink canceled','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});

export function createMediaRelinkPanel({dialog,root,status,getContext,canCommit,commit,onRelinked=()=>{},api=apiRequest,pause=delay}){
  let active=false,session=0,operationSession=0,scope=null,scopeCurrent=()=>true,epoch=null,picker=null,consumed=false,pendingOpen=null;
  const replacements=new Map(),controls=[],closeButton=dialog.querySelector('form[method="dialog"] button');
  const note=document.createElement('p'),browser=document.createElement('div'),manual=document.createElement('details'),manualTitle=document.createElement('summary'),manualRows=document.createElement('div'),results=document.createElement('details'),resultTitle=document.createElement('summary'),report=document.createElement('ul');
  note.className='muted';note.textContent='Search an approved source folder and its subfolders for missing media. Readable media stay unchanged. Choose explicit replacements below to force a different file.';manualTitle.textContent='Choose explicit replacement files';manual.append(manualTitle,manualRows);resultTitle.textContent='Relink results';results.append(resultTitle,report);report.setAttribute('aria-label','Project relink results');
  const current=()=>active && root.isConnected!==false && getContext()?.project_epoch===epoch && scopeCurrent();
  const button=(text,action,parent=root)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',()=>{if(node.isConnected!==false && current() && canCommit() && !transfer.busy() && !consumed)action();});parent.append(node);controls.push(node);return node;};
  function update(){
    if(!active)return;transfer.invalidate();for(const node of controls)node.disabled=!current() || !canCommit() || transfer.busy() || consumed;
    applyChosen.disabled ||= replacements.size===0;stop.disabled=!transfer.busy() || transfer.phase()==='committing' || transfer.phase()==='canceling';
    restart.disabled=!current() || !canCommit() || transfer.busy();if(closeButton)closeButton.disabled=transfer.busy() && transfer.phase()==='committing';picker?.refresh();
  }
  function render(value){
    if(!active || operationSession!==session)return;if(['committing','applied','uncertain'].includes(value.phase))consumed=true;status.textContent=value.message;
    const result=value.job?.result;if(result){
      resultTitle.textContent=`Relink results · ${result.items.length} ready · ${result.not_found.length} missing · ${result.skipped.length} unchanged · ${result.ambiguous_count} ambiguous · ${result.errors.length} errors`;
      const names=new Map(getContext()?.media?.map(item=>[item.id,item.name]) || []),rows=[...result.not_found.map(id=>`${names.get(id) || id} · not found`),...result.skipped.map(id=>`${names.get(id) || id} · readable source kept`),...result.errors.map(item=>`${item.name} · ${item.code}: ${item.message}`)];
      if(result.ambiguous_count)rows.unshift('Ambiguous names use the native shallowest match and lexical tie order.');report.replaceChildren(...rows.map(text=>{const row=document.createElement('li');row.textContent=text;return row;}));
    }
    update();
  }
  const transfer=createProjectMediaTransfer({kind:'project_relink',getContext,canCommit,commit,api,pause,onChange:render,onApplied:(receipt,job)=>onRelinked(receipt.relinked_media_ids,receipt,job.result)});
  async function begin(action){
    if(!current() || consumed || transfer.busy() || !canCommit())return;
    const bound=session,mapping=JSON.stringify([...replacements]);operationSession=bound;
    try{return await transfer.run(action,()=>current() && session===bound && mapping===JSON.stringify([...replacements]));}
    finally{update();if(pendingOpen && active && !transfer.busy()){const next=pendingOpen;pendingOpen=null;void open(...next);}}
  }
  function sourceFolder(){
    if(!current() || consumed || transfer.busy())return;picker?.dispose();browser.replaceChildren();const bound=session;
    picker=createSourcePicker({root:browser,getContext,isCurrent:()=>current() && session===bound,canChoose:()=>canCommit() && !consumed && !transfer.busy(),canCancel:()=>transfer.phase()!=='committing',api,folderLabel:'Search this folder and subfolders',onChoose:directory_token=>begin({kind:'by_name',directory_token,scope}),onCancel:()=>{hide();dialog.close?.();},onStatus:message=>{if(current() && !transfer.busy())status.textContent=message;}});void picker.open();
  }
  function replacement(media){
    picker?.dispose();browser.replaceChildren();const bound=session;
    picker=createSourcePicker({root:browser,getContext,isCurrent:()=>current() && session===bound,canChoose:()=>canCommit() && !consumed && !transfer.busy(),canCancel:()=>transfer.phase()!=='committing',api,maxFiles:1,filesLabel:`Use replacement for ${media.name}`,onChooseFiles:entries=>{
      if(!current() || bound!==session || entries.length!==1)return;replacements.set(media.id,entries[0].path_token);picker.dispose();picker=null;browser.replaceChildren();status.textContent=`${media.name} → ${entries[0].path_token} · Apply chosen replacements to confirm`;update();
    },onCancel:()=>{picker=null;browser.replaceChildren();status.textContent='Replacement file choice canceled';update();}});void picker.open();
  }
  root.replaceChildren(note,browser,manual,results);
  const search=button('Search replacement folder',sourceFolder),applyChosen=button('Apply chosen replacements',()=>void begin({kind:'chosen',items:[...replacements].map(([media_id,path_token])=>({media_id,path_token}))}).catch(()=>{}),manual);
  const stop=document.createElement('button');stop.type='button';stop.textContent='Cancel relink preparation';stop.addEventListener('click',()=>transfer.cancel());root.append(stop);
  const restart=document.createElement('button');restart.type='button';restart.textContent='Choose relink sources again';restart.addEventListener('click',()=>{if(current() && canCommit() && !transfer.busy())void open(scope,scopeCurrent);});root.append(restart);
  async function open(value,isCurrent=()=>true){
    if(transfer.busy() && transfer.phase()==='committing'){if(!dialog.open)dialog.showModal();update();return;}
    const checked=projectRelinkScope(value);
    hide();active=true;session++;operationSession=session;scope=checked;scopeCurrent=isCurrent;epoch=getContext()?.project_epoch;consumed=false;replacements.clear();resultTitle.textContent='Relink results';results.open=false;report.replaceChildren();manualRows.replaceChildren();controls.splice(2);browser.replaceChildren();
    if(!dialog.open)dialog.showModal();if(transfer.busy()){pendingOpen=[scope,scopeCurrent];status.textContent='Waiting for the preceding relink to settle…';update();return;}
    const ids=new Set(scope.kind==='selected'?scope.media_ids:[]),media=(getContext()?.media || []).filter(item=>ids.has(item.id) && !item.compound_timeline_id);manual.hidden=scope.kind!=='selected';
    for(const item of media)button(`Choose replacement for ${item.name}`,()=>replacement(item),manualRows);
    sourceFolder();update();
  }
  function hide(){active=false;session++;pendingOpen=null;picker?.dispose();picker=null;transfer.cancel();}
  dialog.addEventListener('close',()=>{if(transfer.busy() && transfer.phase()==='committing'){if(!dialog.open)dialog.showModal();update();return;}hide();});dialog.addEventListener('cancel',event=>{if(transfer.busy() && transfer.phase()==='committing')event.preventDefault();});
  return {open,hide,invalidate:update};
}
