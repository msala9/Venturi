import {catalogRows,mediaRowInfo,mediaSelection} from './catalog.js';
import {makeCatalogDrag,createCatalogInteractions} from './catalog-interactions.js';
import {createTimelineContextMenu} from './timeline/context-menu.js';

export const NATIVE_POOL_DRAG_TYPE='application/x-venturi-native-library-folder-move';
export function nativePoolItem(asset){
  const value=asset.presentation || {};
  return {...value,id:asset.id,name:asset.name,folder:asset.effective_folder ?? asset.folder ?? null,offline:Boolean(asset.error || asset.missing_count>0),compound_timeline_id:value.kind==='timeline'?asset.id:null,audio_stream_count:value.audio_streams};
}
export function nativePoolInfo(asset){return asset.presentation && asset.presentation.kind!=='media'?mediaRowInfo(nativePoolItem(asset)):{metadata:asset.error || `${asset.media_count} media · ${asset.file_count} files`,duration:'—',glyph:asset.missing_count>0?'!':'◇'};}
export function nativePoolQuery({sort='name',descending=false,layout='details',folder=null,query=''}={}){
  return {sort:sort==='duration'?'duration':'name',descending:String(Boolean(descending)),...(!(layout==='grid' && query.trim()) && (layout==='grid' || folder!==null)?{folder:folder ?? ''}:{})};
}

export function nativePoolThumbnailEligible(asset){return Boolean(asset?.presentation?.has_video && asset.presentation.kind!=='timeline' && !asset.archived && !asset.error && !(asset.missing_count>0));}
export function createNativeAssetPool({root,list,state,getContext,getAssets,getFolders,getSelection,canWrite,onSelection,onNavigate,onPresentation,onRename,onAction,onMove,getThumbnail=()=>null,onDemand=()=>{},notice=()=>{}}){
  const doc=root.ownerDocument ?? document,toolbar=doc.createElement('div'),breadcrumbs=doc.createElement('nav'),header=doc.createElement('div');
  toolbar.className='catalog-presentation native-pool-presentation';breadcrumbs.className='catalog-breadcrumbs';breadcrumbs.setAttribute('aria-label','Native library folder breadcrumbs');header.className='catalog-sort-header native-pool-sort-header';header.setAttribute('aria-label','Sort native assets');header.setAttribute('role','group');
  root.append(toolbar,breadcrumbs,header,list);list.className='catalog-rows native-pool-rows';list.tabIndex=0;list.setAttribute('aria-label','Native library pool');list.setAttribute('role','group');
  let disposed=false,selectedFolder=null,snapshot=null,visible=[],buttons=[],rename=null,witness=null,interactions;
  const layoutButtons=new Map(),sortButtons=new Map(),listen=(node,type,callback)=>node.addEventListener(type,callback),button=(parent,text,callback,label=text)=>{const node=doc.createElement('button');node.type='button';node.textContent=text;node.setAttribute('aria-label',label);listen(node,'click',callback);parent.append(node);return node;};
  const context=()=>{
    const owner=getContext();if(!snapshot || !owner || owner.available===false)return null;
    return {...owner,snapshot,selected:getSelection().map(item=>item.id),selectedFolder,presentation:JSON.stringify([state.layout,state.sort,state.descending,state.folder,state.query,state.expanded,owner.identity]),backgroundFolder:state.folder,rows:[...list.children].map(element=>({kind:element.dataset.mediaId!==undefined?'media':'folder',id:element.dataset.mediaId ?? element.dataset.folderId,element}))};
  };
  const current=()=>!disposed && root.isConnected!==false && !doc.hidden && !doc.querySelector?.('dialog[open]') && getContext()?.available!==false && Boolean(getContext());
  const writable=()=>current() && canWrite();
  const intersections=new Set(),Observer=doc.defaultView?.IntersectionObserver ?? globalThis.IntersectionObserver;
  const observer=typeof Observer==='function'?new Observer(entries=>{for(const entry of entries){if(entry.target.parentElement!==list)continue;if(entry.isIntersecting)intersections.add(entry.target);else intersections.delete(entry.target);}demand();}):null;
  function demand(){
    const items=current() && state.layout!=='list'?visible.filter(item=>{const row=buttons.find(value=>value.item.id===item.id)?.row;if(!row || !nativePoolThumbnailEligible(item))return false;if(observer)return intersections.has(row);const rect=row.getBoundingClientRect?.();return Boolean(rect && rect.width>0 && rect.height>0 && rect.bottom>0 && rect.right>0 && rect.top<(doc.defaultView?.innerHeight ?? globalThis.innerHeight ?? 0) && rect.left<(doc.defaultView?.innerWidth ?? globalThis.innerWidth ?? 0));}):[];
    onDemand(items,getContext());
  }
  function refreshThumbnails(){
    for(const {row,item}of buttons){const slot=[...row.children].find(node=>node.className==='catalog-thumbnail');if(!slot)continue;const asset=state.layout!=='list' && nativePoolThumbnailEligible(item)?getThumbnail(item):null;if(asset?.thumbnailURL && slot.children[0]?.src===asset.thumbnailURL)continue;slot.replaceChildren();slot.textContent=item.error || item.missing_count>0?'!':nativePoolInfo(item).glyph;if(asset?.thumbnailURL){const image=doc.createElement('img');image.alt='';image.src=asset.thumbnailURL;slot.replaceChildren(image);}}
  }
  const changed=()=>{cancelRename();menu.close(false);interactions?.cancel();witness=null;onPresentation();};
  for(const [id,label,glyph]of [['grid','Grid','▦'],['list','List','☰'],['details','Details','▤']])layoutButtons.set(id,button(toolbar,glyph,()=>{if(!current() || state.layout===id)return;state.layout=id;changed();},`Show native assets ${label.toLowerCase()} view`));
  for(const key of ['name','duration']){const node=button(header,key==='name'?'Name':'Duration',()=>{if(!current())return;if(state.sort===key)state.descending=!state.descending;else{state.sort=key;state.descending=false;}changed();},`Sort native assets by ${key}`);node.className=`catalog-sort-${key}`;sortButtons.set(key,node);}
  function sync(){
    const owner=getContext();if(snapshot && (!owner || snapshot.identity!==owner.identity)){cancelRename();interactions?.cancel();witness=null;}menu.invalidate();
    for(const [layout,node]of layoutButtons){node.disabled=!current();node.setAttribute('aria-pressed',String(layout===state.layout));}
    for(const [key,node]of sortButtons){node.disabled=!current();node.textContent=`${key==='name'?'Name':'Duration'}${state.sort===key?state.descending?' ▾':' ▴':''}`;node.setAttribute('aria-pressed',String(state.sort===key));}
    for(const row of list.children)if(row.dataset.folderId!==undefined){row.draggable=writable();for(const node of row.children)if(node.className==='catalog-folder-name'){node.disabled=!current();node.draggable=row.draggable;node.setAttribute('aria-pressed',String(row.dataset.folderId===selectedFolder));}}
    refreshThumbnails();demand();
  }
  function cancelRename(){if(!rename)return;const before=rename;rename=null;before.input.remove();before.wrapper?.remove();before.label.hidden=false;}
  function beginRename(kind,id){
    if(!writable())return;cancelRename();
    const element=[...list.children].find(node=>kind==='folder'?node.dataset.folderId===id:node.dataset.mediaId===id),item=(kind==='folder'?getFolders():getAssets()).find(item=>item.id===id);
    if(!element || !item || kind!=='folder' && (item.archived || item.error))return;
    const label=kind==='folder'?[...element.children].find(node=>node.className==='catalog-folder-name'):element;if(!label)return;
    const input=doc.createElement('input'),identity=getContext().identity,initial=item.name;input.type='text';input.value=initial;input.maxLength=128;input.setAttribute('aria-label',`Rename native ${kind==='folder'?'folder':'asset'}`);label.hidden=true;
    let wrapper;if(kind==='folder')element.append(input);else{wrapper=doc.createElement('div');wrapper.className='native-pool-rename';wrapper.append(input);list.insertBefore(wrapper,element);}rename={input,label,wrapper};
    const finish=async()=>{if(rename?.input!==input)return;const next=input.value.trim();cancelRename();if(!next || next===initial || !writable() || getContext().identity!==identity)return;try{await onRename(kind,id,next);}catch(error){notice(error.message);}};
    listen(input,'keydown',event=>{event.stopPropagation();if(event.isComposing || event.keyCode===229 || event.repeat)return;if(event.key==='Escape'){event.preventDefault();cancelRename();element.focus?.();}else if(event.key==='Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey){event.preventDefault();void finish();}});
    listen(input,'click',event=>event.stopPropagation());listen(input,'blur',cancelRename);input.focus?.();input.select?.();
  }
  const menu=createTimelineContextMenu({document:doc,notice,getContext:target=>{
    if(!current())return null;const owner=getContext(),kind=target.kind==='clip'?'asset':target.kind==='track'?'folder':'background',asset=getAssets().find(item=>item.id===target.clip_id),folder=getFolders().find(item=>item.id===target.track_id);if(kind==='asset' && !asset || kind==='folder' && !folder)return null;
    return {identity:JSON.stringify([owner.identity,getSelection().map(item=>[item.id,item.revision]),state.layout,state.folder,kind,target.clip_id,target.track_id]),kind,id:asset?.id ?? folder?.id ?? null,writable:writable(),asset,folder};
  },getItems:owner=>owner.kind==='asset'?[{id:'import',label:'Add selected assets to project',enabled:owner.writable && getSelection().length>0 && getSelection().length<=32},{id:'preview',label:'Preview native asset',enabled:!owner.asset.archived && !owner.asset.error},{id:'rename',label:'Rename',enabled:owner.writable && !owner.asset.archived},{id:'relink',label:'Relink missing files…',enabled:owner.writable && owner.asset.missing_count>0},{separator:true},{id:'delete',label:'Permanently delete selected assets…',enabled:owner.writable && getSelection().length>0 && getSelection().length<=32}]:owner.kind==='folder'?[{id:'new_folder',label:'New folder',enabled:owner.writable},{id:'rename',label:'Rename folder',enabled:owner.writable},{id:'delete_folder',label:'Remove folder, keep contents',enabled:owner.writable}]:[{id:'new_folder',label:'New folder',enabled:owner.writable}],onAction:(id,owner)=>id==='rename'?beginRename(owner.kind,owner.id):onAction(id,owner)});
  function beginDrag(event,kind,ids){
    if(!writable() || !event.dataTransfer){event.preventDefault();return;}
    const owner=context(),payload=makeCatalogDrag(kind,ids,owner);if(!payload){event.preventDefault();return;}
    witness={payload,key:owner.presentation,snapshot};try{event.dataTransfer.setData(NATIVE_POOL_DRAG_TYPE,payload);event.dataTransfer.effectAllowed=kind==='media'?'copyMove':'move';}catch(error){witness=null;event.preventDefault();notice(error.message);}
  }
  function endDrag(){const before=witness;queueMicrotask(()=>{if(witness===before)witness=null;});}
  function render(rowButtons){
    if(disposed)return;cancelRename();menu.close(false);interactions?.cancel();witness=null;buttons=rowButtons;
    const assets=getAssets(),folders=getFolders(),owner=getContext();snapshot={identity:owner?.identity,media:assets.map(nativePoolItem),folders};
    if(selectedFolder && !folders.some(item=>item.id===selectedFolder))selectedFolder=null;
    state.expanded=[...new Set(state.expanded || [])].filter(id=>folders.some(item=>item.id===id));
    const needed=new Set(state.expanded);for(const item of snapshot.media){let id=item.folder;const seen=new Set();while(id && !seen.has(id)){seen.add(id);needed.add(id);id=folders.find(value=>value.id===id)?.parent;}}
    if(state.autoExpand!==false && snapshot.media.length){state.expanded=[...needed];state.autoExpand=false;}
    root.dataset.layout=list.dataset.layout=state.layout;
    breadcrumbs.replaceChildren();button(breadcrumbs,'Library root',()=>{if(current())onNavigate(null);});
    const ancestors=[],visited=new Set();let folder=folders.find(item=>item.id===state.folder);while(folder && !visited.has(folder.id)){visited.add(folder.id);ancestors.unshift(folder);folder=folders.find(item=>item.id===folder.parent);}for(const item of ancestors)button(breadcrumbs,item.name,()=>{if(current())onNavigate(item.id);});
    const rows=catalogRows(snapshot.media,folders,{layout:state.layout,expanded:state.expanded,query:state.query || '',folder:'*',gridFolder:state.folder}),nodes=[];visible=[];
    for(const row of rows){
      if(row.kind==='folder'){
        const item=row.folder,entry=doc.createElement('div');entry.className='catalog-folder-row';entry.dataset.folderId=item.id;entry.dataset.catalogDropFolder=item.id;entry.style?.setProperty?.('--catalog-depth',String(row.depth));
        const toggle=button(entry,state.layout==='grid'?'▸':row.expanded?'▾':'▸',event=>{event.stopPropagation();if(!current())return;if(state.layout==='grid'){onNavigate(item.id);return;}const open=new Set(state.expanded);if(open.has(item.id))open.delete(item.id);else open.add(item.id);state.expanded=[...open];render(buttons);},`Expand native folder ${item.name}`);toggle.setAttribute('aria-expanded',String(row.expanded));
        const label=button(entry,item.name,()=>{if(!current())return;selectedFolder=item.id;onSelection([]);sync();},`Native folder ${item.name}`);label.className='catalog-folder-name';label.setAttribute('aria-pressed',String(selectedFolder===item.id));listen(label,'dblclick',event=>{event.preventDefault();event.stopPropagation();if(current())onNavigate(item.id);});entry.draggable=writable();label.draggable=entry.draggable;listen(entry,'dragstart',event=>beginDrag(event,'folder',item.id));listen(entry,'dragend',endDrag);nodes.push(entry);continue;
      }
      const item=assets.find(item=>item.id===row.item.id),record=rowButtons.find(value=>value.item.id===item.id);if(!record)continue;const node=record.row,info=nativePoolInfo(item);
      node.className='native-asset-drag-row media-item';node.dataset.mediaId=item.id;node.dataset.depth=String(row.depth);node.style?.setProperty?.('--catalog-depth',String(row.depth));node.setAttribute('aria-label',`Native asset ${item.name}`);node.setAttribute('aria-pressed',String(getSelection().some(value=>value.id===item.id)));
      const thumb=doc.createElement('span'),copy=doc.createElement('span'),name=doc.createElement('span'),meta=doc.createElement('small'),duration=doc.createElement('span');thumb.className='catalog-thumbnail';thumb.setAttribute('aria-hidden','true');thumb.textContent=row.item.offline?'!':info.glyph;copy.className='catalog-copy';name.className='catalog-filename';name.textContent=item.name;meta.className='catalog-metadata';meta.textContent=info.metadata;meta.hidden=state.layout!=='details';copy.append(name,meta);duration.className='catalog-duration';duration.textContent=info.duration;duration.hidden=state.layout==='grid';node.replaceChildren(thumb,copy,duration);node.title=`${item.name} · ${info.metadata} · ${info.duration}`;
      if(!node.dataset.nativePoolBound){node.dataset.nativePoolBound='true';listen(node,'dragstart',event=>{if(event.defaultPrevented)return;beginDrag(event,'media',getSelection().map(item=>item.id));});listen(node,'dragend',endDrag);}
      visible.push(item);nodes.push(node);
    }
    observer?.disconnect();intersections.clear();list.replaceChildren(...nodes);for(const {row}of buttons)if(row.parentElement===list)observer?.observe(row);refreshThumbnails();sync();
  }
  function key(event){
    if(event.defaultPrevented || event.isComposing || event.keyCode===229 || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.('input,textarea,select,[contenteditable]') || !current())return;
    if(event.key==='F2' && !event.shiftKey){event.preventDefault();event.stopPropagation();if(selectedFolder)beginRename('folder',selectedFolder);else if(getSelection().length===1)beginRename('asset',getSelection()[0].id);return;}
    const rows=[...list.children],focused=rows.findIndex(node=>node===event.target || [...node.children].includes(event.target));
    if(event.key==='Enter' && !event.shiftKey && rows[focused]?.dataset.folderId!==undefined){event.preventDefault();event.stopPropagation();onNavigate(rows[focused].dataset.folderId);return;}
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,focused+(event.key==='ArrowDown'?1:-1))),row=rows[next];if(!row)return;event.preventDefault();event.stopPropagation();
    if(row.dataset.folderId!==undefined){selectedFolder=row.dataset.folderId;onSelection([]);[...row.children].find(node=>node.className==='catalog-folder-name')?.focus?.();}else{selectedFolder=null;const owner=getContext(),selection=mediaSelection(visible,getSelection().map(item=>item.id),owner.anchor,row.dataset.mediaId,{extend:event.shiftKey});onSelection(selection.selected,selection.anchor);row.focus?.();}sync();
  }
  listen(list,'keydown',key);
  interactions=createCatalogInteractions({root,list,getContext:context,dragType:NATIVE_POOL_DRAG_TYPE,canWrite:writable,notice,onMarquee:({media_ids})=>{selectedFolder=null;onSelection(media_ids);sync();},onContextMenu:hit=>{
    if(hit.kind==='media'){selectedFolder=null;if(!getSelection().some(item=>item.id===hit.id))onSelection([hit.id]);}if(hit.kind==='folder'){selectedFolder=hit.id;onSelection([]);}
    menu.open({kind:hit.kind==='media'?'clip':hit.kind==='folder'?'track':'background',clip_id:hit.kind==='media'?hit.id:undefined,track_id:hit.kind==='folder'?hit.id:undefined,clientX:hit.x,clientY:hit.y,returnFocus:hit.event.target});
  },onDrop:async({payload,target,isCurrent})=>{if(!witness || witness.payload!==JSON.stringify(payload) || witness.snapshot!==snapshot || witness.key!==context()?.presentation || !isCurrent())return;witness=null;await onMove(payload,target.folder_id ?? null,isCurrent);}});
  const clicked=event=>{if(event.defaultPrevented || !current())return;if(event.target===list){selectedFolder=null;onSelection([]);sync();return;}for(let node=event.target;node && node!==list;node=node.parentElement)if(node.dataset?.mediaId!==undefined){selectedFolder=null;sync();break;}};listen(list,'click',clicked);
  const scroll=()=>demand();doc.addEventListener?.('scroll',scroll,true);
  const resume=()=>sync();doc.addEventListener?.('close',resume,true);doc.addEventListener?.('visibilitychange',resume);
  return {render,sync,refreshThumbnails,beginRename,visible:()=>[...visible],cancel(){cancelRename();menu.close(false);interactions.cancel();witness=null;},dispose(){if(disposed)return;disposed=true;observer?.disconnect();intersections.clear();onDemand([],null);doc.removeEventListener?.('scroll',scroll,true);doc.removeEventListener?.('close',resume,true);doc.removeEventListener?.('visibilitychange',resume);cancelRename();menu.dispose();interactions.dispose();list.removeEventListener('keydown',key);list.removeEventListener('click',clicked);}};
}
