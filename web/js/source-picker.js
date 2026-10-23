const bytes=value=>new TextEncoder().encode(value).length;
export const approvedSourceToken=(text,{directory=false,allowRoot=false}={})=>typeof text==='string' && (allowRoot && text==='' || text!=='' && bytes(text)<=1024 && !/[\\\p{Cc}]/u.test(text) && text.split('/').length<=(directory?16:17) && text.split('/').every((part,index,parts)=>part && part!=='.' && part!=='..' && bytes(part)<=128 && (!part.startsWith('.') || !directory && index===parts.length-1)));
export function checkedSourceDirectory(value,epoch,directory,page){
  const token=(text,allowRoot=false,media=false)=>approvedSourceToken(text,{directory:!media,allowRoot});
  const parent=directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'';
  if(!token(directory,true) || value?.project_epoch!==epoch || value.directory_token!==directory || value.parent_token!==(directory?parent:null) || !Number.isSafeInteger(page) || value.page!==page || !Number.isSafeInteger(value.pages) || value.pages<1 || value.pages>128 || page<0 || page>=value.pages || !Array.isArray(value.entries) || value.entries.length>32)throw Error('The approved source folder changed or is invalid; reopen the chooser');
  const seen=new Set();
  for(const entry of value.entries){
    if(!['directory','media'].includes(entry?.kind) || typeof entry.name!=='string' || !entry.name || /[\/\\\p{Cc}]/u.test(entry.name) || bytes(entry.name)>128 || !token(entry.path_token,false,entry.kind==='media') || entry.path_token!==(directory?`${directory}/`:'')+entry.name || seen.has(entry.path_token))throw Error('The approved source entries changed or are invalid; reopen the chooser');
    seen.add(entry.path_token);
  }
  return value;
}

export function createSourcePicker({root,getContext,isCurrent=()=>true,canChoose=()=>true,canCancel=()=>true,api,onChoose,onChooseFiles,maxFiles=256,onSelectionChange=()=>{},folderLabel='Choose this source folder',filesLabel='Choose selected source files',onCancel=()=>{},onStatus=()=>{},returnFocus=document.activeElement}){
  const fileMode=typeof onChooseFiles==='function';
  if(fileMode && (!Number.isSafeInteger(maxFiles) || maxFiles<1 || maxFiles>256))throw Error('Choose a source file selection limit between 1 and 256');
  const epoch=getContext()?.project_epoch,heading=document.createElement('p'),crumbs=document.createElement('nav'),entries=document.createElement('div'),pager=document.createElement('div'),actions=document.createElement('div'),status=document.createElement('p');
  root.className='native-source-picker';heading.className='native-source-heading';crumbs.className='native-source-crumbs';entries.className='native-source-entries';pager.className='native-source-paging';actions.className='native-source-actions';status.className='native-source-status';
  crumbs.setAttribute('aria-label','Approved source folder breadcrumbs');entries.setAttribute('aria-label','Approved source entries');status.setAttribute('role','status');heading.textContent=fileMode?'Choose approved source files or a folder':'Choose an approved source folder';root.append(heading,crumbs,entries,pager,actions,status);
  const keydown=event=>{if(event.key==='Escape' && !event.defaultPrevented && current() && canCancel()){event.preventDefault();event.stopPropagation();cancelChoice();}else if(event.target?.tagName==='BUTTON' && [' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.stopPropagation();};root.addEventListener('keydown',keydown);
  let disposed=false,reading=false,chosen=false,sequence=0,controller=null,view=null,focusTarget=null;
  const controls=new Map(),selected=new Map(),fileButtons=new Map(),permanent=new Set(),current=()=>!disposed && root.isConnected!==false && epoch && getContext()?.project_epoch===epoch && isCurrent();
  const selectedFiles=()=>current()?[...selected.values()].map(entry=>({...entry})):[];
  const message=text=>{if(current()){status.textContent=text;onStatus(text);}};
  const sync=()=>{if(!current())selected.clear();for(const [node,enabled] of controls)node.disabled=!current() || reading || chosen || !canChoose() || node.isConnected===false || !enabled();for(const [node,token] of fileButtons)node.setAttribute('aria-pressed',String(selected.has(token)));if(selectionCount)selectionCount.textContent=`${selected.size} of ${maxFiles} source files selected`;cancel.disabled=!current() || !canCancel();};
  const button=(parent,text,action,enabled=()=>true,short=null)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.setAttribute('aria-label',text);node.title=text;if(short!==null)node.setAttribute('data-compact-label',short);node.addEventListener('click',()=>{if(!current() || reading || chosen || !canChoose() || !enabled() || node.isConnected===false)return;action();});parent.append(node);controls.set(node,enabled);return node;};
  const clearRows=()=>{for(const [node] of controls)if(!permanent.has(node))controls.delete(node);fileButtons.clear();crumbs.replaceChildren();entries.replaceChildren();pager.replaceChildren();};
  function chooseAction(action){
    const read=sequence;chosen=true;sync();
    Promise.resolve().then(()=>{if(!current() || !canChoose() || read!==sequence)throw new DOMException('Source selection changed','AbortError');return action();}).catch(error=>{if(current()){message(error.message);chosen=false;sync();}});
  }
  const choose=button(actions,folderLabel,()=>{const directory=view?.directory_token;if(directory)chooseAction(()=>onChoose(directory));},()=>Boolean(view?.directory_token) && typeof onChoose==='function',folderLabel==='Choose this source folder'?'Use folder':folderLabel);permanent.add(choose);
  if(typeof onChoose!=='function')choose.hidden=true;
  const selectionCount=fileMode?document.createElement('p'):null;
  if(fileMode){
    selectionCount.className='native-source-selection-count';selectionCount.setAttribute('role','status');selectionCount.setAttribute('aria-label','Selected source files');actions.append(selectionCount);
    const chooseFiles=button(actions,filesLabel,()=>{const files=selectedFiles();if(files.length)chooseAction(()=>onChooseFiles(files));},()=>selected.size>0,filesLabel);permanent.add(chooseFiles);
    const clearFiles=button(actions,'Clear selected source files',()=>{selected.clear();onSelectionChange(selectedFiles());sync();},()=>selected.size>0,'Clear files');permanent.add(clearFiles);
  }
  function cancelChoice(){if(!current() || !canCancel())return;dispose();onCancel();if(returnFocus?.isConnected!==false && !returnFocus?.disabled)returnFocus?.focus?.({preventScroll:true});}
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel source folder choice';cancel.setAttribute('aria-label',cancel.textContent);cancel.title=cancel.textContent;cancel.setAttribute('data-compact-label','Cancel');cancel.addEventListener('click',cancelChoice);actions.append(cancel);
  async function load(directory='',page=0){
    if(!current() || chosen || !canChoose())return false;
    controller?.abort();controller=new AbortController();const signal=controller.signal,id=++sequence;reading=true;sync();message('Reading approved source folder…');
    try{
      const response=await api(`/media/sources?${new URLSearchParams({project_epoch:epoch,directory_token:directory,page:String(page)})}`,undefined,{signal});
      if(!current() || signal.aborted || id!==sequence)return false;
      const next=checkedSourceDirectory(response,epoch,directory,page);clearRows();view=next;
      button(crumbs,'Project source root',()=>void load(''),()=>true,'Root');
      let path='';for(const part of directory.split('/').filter(Boolean)){path=path?`${path}/${part}`:part;const target=path;button(crumbs,part,()=>void load(target));}
      button(pager,'Parent source folder',()=>void load(next.parent_token),()=>next.parent_token!==null,'Up');
      focusTarget=null;for(const entry of next.entries){if(entry.kind==='directory'){const open=button(entries,`Open folder ${entry.name}`,()=>void load(entry.path_token),()=>true,entry.name);open.className='native-source-directory';focusTarget ||= open;}else if(fileMode){
        const snapshot={...entry},item=button(entries,`Select source file ${entry.name}`,()=>{if(selected.has(entry.path_token))selected.delete(entry.path_token);else if(selected.size<maxFiles)selected.set(entry.path_token,snapshot);onSelectionChange(selectedFiles());sync();},()=>selected.has(entry.path_token) || selected.size<maxFiles,entry.name);
        item.className='native-source-media';item.title=entry.path_token;item.setAttribute('aria-pressed',String(selected.has(entry.path_token)));fileButtons.set(item,entry.path_token);focusTarget ||= item;
      }else{const item=document.createElement('p');item.textContent=entry.name;entries.append(item);}}
      button(pager,'Previous source page',()=>void load(directory,page-1),()=>page>0,'‹');button(pager,'Next source page',()=>void load(directory,page+1),()=>page+1<next.pages,'›');
      message(`${directory || 'Project source root'} · page ${page+1} of ${next.pages}${directory?'':fileMode?' · select files or open a folder':' · open a folder to select it'}`);return true;
    }catch(error){if(current() && id===sequence && error.name!=='AbortError'){view=null;clearRows();message(error.message);}return false;}
    finally{if(id===sequence){reading=false;sync();if(current() && canChoose() && (document.activeElement===returnFocus || document.activeElement===document.body))(focusTarget || (view?.directory_token?choose:cancel)).focus?.({preventScroll:true});}}
  }
  function dispose(){if(disposed)return;disposed=true;sequence++;controller?.abort();controller=null;root.removeEventListener('keydown',keydown);for(const [node] of controls)node.disabled=true;cancel.disabled=true;controls.clear();fileButtons.clear();selected.clear();}
  sync();return {open:load,refresh:sync,dispose,selectedFiles,current:()=>current()?view:null};
}
