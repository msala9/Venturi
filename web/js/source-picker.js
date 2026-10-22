const bytes=value=>new TextEncoder().encode(value).length;
export function checkedSourceDirectory(value,epoch,directory,page){
  const token=(text,allowRoot=false,media=false)=>typeof text==='string' && (allowRoot && text==='' || text!=='' && bytes(text)<=1024 && !/[\\\p{Cc}]/u.test(text) && text.split('/').length<=(media?17:16) && text.split('/').every((part,index,parts)=>part && part!=='.' && part!=='..' && bytes(part)<=128 && (!part.startsWith('.') || media && index===parts.length-1)));
  const parent=directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'';
  if(!token(directory,true) || value?.project_epoch!==epoch || value.directory_token!==directory || value.parent_token!==(directory?parent:null) || !Number.isSafeInteger(page) || value.page!==page || !Number.isSafeInteger(value.pages) || value.pages<1 || value.pages>128 || page<0 || page>=value.pages || !Array.isArray(value.entries) || value.entries.length>32)throw Error('The approved source folder changed or is invalid; reopen the chooser');
  const seen=new Set();
  for(const entry of value.entries){
    if(!['directory','media'].includes(entry?.kind) || typeof entry.name!=='string' || !entry.name || /[\/\\\p{Cc}]/u.test(entry.name) || bytes(entry.name)>128 || !token(entry.path_token,false,entry.kind==='media') || entry.path_token!==(directory?`${directory}/`:'')+entry.name || seen.has(entry.path_token))throw Error('The approved source entries changed or are invalid; reopen the chooser');
    seen.add(entry.path_token);
  }
  return value;
}

export function createSourcePicker({root,getContext,isCurrent=()=>true,canChoose=()=>true,canCancel=()=>true,api,onChoose,onCancel=()=>{},onStatus=()=>{},returnFocus=document.activeElement}){
  const epoch=getContext()?.project_epoch,heading=document.createElement('p'),crumbs=document.createElement('nav'),entries=document.createElement('div'),pager=document.createElement('div'),actions=document.createElement('div'),status=document.createElement('p');
  crumbs.setAttribute('aria-label','Approved source folder breadcrumbs');entries.setAttribute('aria-label','Approved source entries');status.setAttribute('role','status');heading.textContent='Choose an approved source folder';root.append(heading,crumbs,entries,pager,actions,status);
  root.addEventListener('keydown',event=>{if(event.key==='Escape' && !event.defaultPrevented && current() && canCancel()){event.preventDefault();event.stopPropagation();cancelChoice();}else if(event.target?.tagName==='BUTTON' && [' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.stopPropagation();});
  let disposed=false,reading=false,chosen=false,sequence=0,controller=null,view=null,focusTarget=null;
  const controls=new Map(),current=()=>!disposed && root.isConnected!==false && epoch && getContext()?.project_epoch===epoch && isCurrent();
  const message=text=>{if(current()){status.textContent=text;onStatus(text);}};
  const sync=()=>{for(const [node,enabled] of controls)node.disabled=!current() || reading || chosen || !canChoose() || node.isConnected===false || !enabled();cancel.disabled=!current() || !canCancel();};
  const button=(parent,text,action,enabled=()=>true)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',()=>{if(!current() || reading || chosen || !canChoose() || !enabled() || node.isConnected===false)return;action();});parent.append(node);controls.set(node,enabled);return node;};
  const clearRows=()=>{for(const [node] of controls)if(node!==choose && node!==cancel)controls.delete(node);crumbs.replaceChildren();entries.replaceChildren();pager.replaceChildren();};
  const choose=button(actions,'Choose this source folder',()=>{
    if(!view?.directory_token)return;chosen=true;sync();
    Promise.resolve().then(()=>{if(!current() || !canChoose())throw new DOMException('Source folder selection changed','AbortError');return onChoose(view.directory_token);}).catch(error=>{if(current()){message(error.message);chosen=false;sync();}});
  },()=>Boolean(view?.directory_token));
  function cancelChoice(){if(!current() || !canCancel())return;dispose();onCancel();if(returnFocus?.isConnected!==false && !returnFocus?.disabled)returnFocus?.focus?.({preventScroll:true});}
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel source folder choice';cancel.addEventListener('click',cancelChoice);actions.append(cancel);
  async function load(directory='',page=0){
    if(!current() || chosen || !canChoose())return false;
    controller?.abort();controller=new AbortController();const signal=controller.signal,id=++sequence;reading=true;sync();message('Reading approved source folder…');
    try{
      const response=await api(`/media/sources?${new URLSearchParams({project_epoch:epoch,directory_token:directory,page:String(page)})}`,undefined,{signal});
      if(!current() || signal.aborted || id!==sequence)return false;
      const next=checkedSourceDirectory(response,epoch,directory,page);clearRows();view=next;
      button(crumbs,'Project source root',()=>void load(''));
      let path='';for(const part of directory.split('/').filter(Boolean)){path=path?`${path}/${part}`:part;const target=path;button(crumbs,part,()=>void load(target));}
      button(pager,'Parent source folder',()=>void load(next.parent_token),()=>next.parent_token!==null);
      focusTarget=null;for(const entry of next.entries){if(entry.kind==='directory'){const open=button(entries,`Open folder ${entry.name}`,()=>void load(entry.path_token));focusTarget ||= open;}else{const item=document.createElement('p');item.textContent=entry.name;entries.append(item);}}
      button(pager,'Previous source page',()=>void load(directory,page-1),()=>page>0);button(pager,'Next source page',()=>void load(directory,page+1),()=>page+1<next.pages);
      message(`${directory || 'Project source root'} · page ${page+1} of ${next.pages}${directory?'':' · open a folder to select it'}`);return true;
    }catch(error){if(current() && id===sequence && error.name!=='AbortError'){view=null;clearRows();message(error.message);}return false;}
    finally{if(id===sequence){reading=false;sync();if(current() && canChoose() && (document.activeElement===returnFocus || document.activeElement===document.body))(focusTarget || (view?.directory_token?choose:cancel)).focus?.({preventScroll:true});}}
  }
  function dispose(){disposed=true;sequence++;controller?.abort();controller=null;for(const [node] of controls)node.disabled=true;cancel.disabled=true;controls.clear();}
  sync();return {open:load,refresh:sync,dispose,current:()=>current()?view:null};
}
