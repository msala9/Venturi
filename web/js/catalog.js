import {mediaThumbnail} from './source-assets.js';
import {CATALOG_DRAG_TYPE,makeCatalogDrag,createCatalogInteractions} from './catalog-interactions.js';
import {createCatalogMenu} from './catalog-menu.js';
function compareText(a,b){
  const left=a[Symbol.iterator](),right=b[Symbol.iterator]();
  while(true){const x=left.next(),y=right.next();if(x.done || y.done)return x.done===y.done?0:x.done?-1:1;const difference=x.value.codePointAt(0)-y.value.codePointAt(0);if(difference)return Math.sign(difference);}
}
export function compareMediaNames(a,b){return compareText(a.toLowerCase(),b.toLowerCase()) || compareText(a,b);}
export function sortMediaItems(items,{key='name',ascending=true}={}){
  const duration=item=>item.duration_frames/Math.max(item.fps?.num/item.fps?.den,1e-9);
  return [...items].sort((a,b)=>{const name=compareMediaNames(a.name,b.name),x=duration(a),y=duration(b),order=key==='duration'?((x<y?-1:x>y?1:0) || name):name;return ascending?order:-order;});
}
export function visibleMediaDemand(items,ids){return items.filter(item=>ids.has(item.id) && item.has_video && !item.offline && !item.compound_timeline_id).slice(0,64).map(item=>({media_id:item.id,audio_stream_index:0,include_waveform:false}));}
export function mediaSelection(items, selected, anchor, id, {toggle = false, extend = false} = {}) {
  if (!items.some((item) => item.id === id)) return {selected: [], anchor: null};
  if (extend && anchor && items.some((item) => item.id === anchor)) {
    const a = items.findIndex((item) => item.id === anchor), b = items.findIndex((item) => item.id === id);
    return {selected: items.slice(Math.min(a, b), Math.max(a, b) + 1).map((item) => item.id), anchor};
  }
  return {selected: toggle ? selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id] : [id], anchor: id};
}

export function folderPaths(folders) {
  const map = new Map(folders.map((folder) => [folder.id, folder]));
  return folders.map((folder) => {
    const seen = new Set([folder.id]), labels = [folder.name]; let parent = map.get(folder.parent);
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); labels.unshift(parent.name); parent = map.get(parent.parent); }
    return {...folder, path: labels.join(" / ")};
  }).sort((a, b) => a.path.localeCompare(b.path));
}

// Native pool_view uses a folder-first tree for List/Details, and immediate
// children for Grid. Search opens only the ancestors of matching media.
export function catalogRows(items,folders,{layout='details',expanded=[],query='',folder='*',gridFolder=null}={}){
  if(folder!=='*')return items.map(item=>({kind:'media',item,depth:0}));
  const map=new Map(folders.map(value=>[value.id,value])),parent=id=>map.has(id)?id:null;
  if(layout==='grid'){
    if(query.trim())return items.map(item=>({kind:'media',item,depth:0}));
    const base=parent(gridFolder);
    return [...folders.filter(value=>parent(value.parent)===base).sort((a,b)=>compareMediaNames(a.name,b.name)).map(value=>({kind:'folder',folder:value,depth:0,expanded:false})),...items.filter(item=>parent(item.folder)===base).map(item=>({kind:'media',item,depth:0}))];
  }
  const open=new Set(expanded),needed=query.trim()?new Set():null;
  if(needed)for(const item of items){let current=parent(item.folder);while(current!==null && !needed.has(current)){needed.add(current);current=parent(map.get(current).parent);}}
  const sorted=[...folders].sort((a,b)=>compareMediaNames(a.name,b.name)),rows=[],visited=new Set();
  function level(current,depth){
    for(const value of sorted){if(parent(value.parent)!==current || visited.has(value.id) || needed && !needed.has(value.id))continue;visited.add(value.id);const expanded=needed?true:open.has(value.id);rows.push({kind:'folder',folder:value,depth,expanded});if(expanded)level(value.id,depth+1);}
    for(const item of items)if(parent(item.folder)===current)rows.push({kind:'media',item,depth});
  }
  level(null,0);return rows;
}

export function mediaRowInfo(item) {
  const type=item.compound_timeline_id?"Timeline":item.is_image?"Still image":item.has_video?"Video":"Audio";
  const rate=item.fps?.num/item.fps?.den;
  const seconds=Number.isSafeInteger(item.duration_frames) && item.duration_frames>=0 && Number.isFinite(rate) && rate>0?Math.floor(item.duration_frames/rate):null;
  const duration=item.is_image?"Still":seconds===null?"—":seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
  const metadata=[type];
  const dimensions=Number.isSafeInteger(item.width) && item.width>0 && Number.isSafeInteger(item.height) && item.height>0?`${item.width}×${item.height}`:null;
  if(dimensions)metadata.push(dimensions);
  if(!item.has_video && item.has_audio){if(Number.isSafeInteger(item.sample_rate) && item.sample_rate>0)metadata.push(`${item.sample_rate} Hz`);if(Number.isSafeInteger(item.channels) && item.channels>0)metadata.push(`${item.channels} channels`);}
  if(item.has_audio && (item.has_video || item.compound_timeline_id))metadata.push(item.audio_stream_count>1?`${item.audio_stream_count} audio streams`:"Audio");
  if(!item.is_image && item.has_video && Number.isFinite(rate) && rate>0)metadata.push(`${rate.toFixed(3).replace(/\.?0+$/,"")} fps`);
  if(item.offline)metadata.push("Offline");
  return {metadata:metadata.join(" · "),duration,glyph:item.compound_timeline_id?"▤":item.is_image?"▣":item.has_video?"▻":"♪"};
}

export function renderMediaProxyStatus(card,job){
  card.querySelectorAll('.catalog-proxy-status')[0]?.remove();if(!job)return;
  const badge=document.createElement('span');badge.className='catalog-proxy-status';badge.textContent=job.state==='ready'?'P':job.state==='failed'?'!':job.label.startsWith('Paused')?'II':'...';badge.title=`Proxy ${job.label}`;badge.setAttribute('aria-label',badge.title);card.title+=` · ${badge.title}`;card.querySelectorAll('.catalog-thumbnail')[0]?.append(badge);
}

export function renderCatalog(root, documentState, state, {writable, assets, commit, getFiles, onSelection, onOpen, notice,onDemand=()=>{},onDragStart=()=>{},onDragEnd=()=>{},onRelink,onAction=()=>{},onPresentationChange=()=>{},proxyStatus=()=>null,intersectionObserver=globalThis.IntersectionObserver}) {
  root.replaceChildren();
  state.selected = (state.selected || []).filter((id) => documentState.media.some((item) => item.id === id));
  const folders = folderPaths(documentState.folders || []);
  state.layout=['list','details','grid'].includes(state.layout)?state.layout:'details';
  state.expanded=[...new Set(Array.isArray(state.expanded)?state.expanded:[])].filter(id=>folders.some(folder=>folder.id===id));
  if(!folders.some(folder=>folder.id===state.gridFolder))state.gridFolder=null;
  if(!folders.some(folder=>folder.id===state.selectedFolder))state.selectedFolder=null;
  const toolbar = document.createElement("div"); toolbar.className = "catalog-toolbar";
  const filter = document.createElement("select"); filter.setAttribute("aria-label", "Media folder");
  filter.append(new Option("All project media", "*"), new Option("Project root", ""));
  folders.forEach((folder) => filter.append(new Option(folder.path, folder.id)));
  filter.value = [...filter.options].some((o) => o.value === state.folder) ? state.folder : "*";
  const kind = document.createElement("select"); kind.setAttribute("aria-label", "Media type");
  for (const [id, name] of [["all", "All types"], ["video", "Video"], ["audio", "Audio"], ["image", "Stills"], ["compound", "Timelines / compounds"], ["offline", "Offline"]]) kind.append(new Option(name, id));
  kind.value = state.kind || "all"; toolbar.append(filter, kind); root.append(toolbar);
  const presentation=document.createElement('div');presentation.className='catalog-presentation';
  const count = document.createElement("p"); count.className = "catalog-count muted"; count.setAttribute("aria-live", "polite"); presentation.append(count);root.append(presentation);
  const layoutButtons=new Map(),changedPresentation=()=>onPresentationChange({layout:state.layout,expanded:[...state.expanded]});
  for(const [layout,label,glyph]of [['grid','Grid','▦'],['list','List','☰'],['details','Details','▤']]){
    const node=document.createElement('button');node.type='button';node.textContent=glyph;node.title=`${label} view`;node.setAttribute('aria-label',`Show media ${label.toLowerCase()} view`);presentation.append(node);layoutButtons.set(layout,node);
    node.addEventListener('click',()=>{if(disposed || root.isConnected===false || state.layout===layout)return;state.layout=layout;render(false,false);changedPresentation();});
  }
  const breadcrumbs=document.createElement('nav');breadcrumbs.className='catalog-breadcrumbs';breadcrumbs.setAttribute('aria-label','Project media folder breadcrumbs');root.append(breadcrumbs);
  const list = document.createElement("div"); list.className="catalog-rows";list.setAttribute("role", "group"); list.setAttribute("aria-label", "Project media"); list.tabIndex=0;list.dataset.clipboardOwner='pool';root.append(list);
  let visible = [],disposed=false,relinkSequence=0,dragging=null,dragWitness=null,renameTimer=null,interactions=null,contextMenu=null;
  const cancelRename=()=>{if(renameTimer!==null)clearTimeout(renameTimer);renameTimer=null;};
  const backgroundFolder=()=>state.layout==='grid' && filter.value==='*' && !(state.query || '').trim()?state.gridFolder:null;
  const presentationKey=()=>JSON.stringify([state.layout,state.expanded,state.gridFolder,filter.value,kind.value,state.query,state.sort]);
  const context=()=>({project_epoch:documentState.project_epoch,generation:documentState.generation,snapshot:documentState,selected:[...state.selected],anchor:state.anchor,selectedFolder:state.selectedFolder,writable,presentation:presentationKey(),backgroundFolder:backgroundFolder(),rows:[...list.children].map(element=>({kind:element.dataset.mediaId!==undefined?'media':'folder',id:element.dataset.mediaId ?? element.dataset.folderId,element}))});
  const dragKey=()=>JSON.stringify([documentState.project_epoch,documentState.generation,state.selected,state.anchor,state.selectedFolder,presentationKey()]);
  function beginDrag(event,node,dragKind,targets){
    cancelRename();contextMenu?.close();
    const payload=makeCatalogDrag(dragKind,targets,context());
    if(payload && event.dataTransfer){event.dataTransfer.setData(CATALOG_DRAG_TYPE,payload);dragWitness={payload,key:dragKey()};}
    dragging=node;
    if(dragKind==='media' && onDragStart(event,selectedItems(),{catalogFallback:Boolean(payload)})===false){dragging=null;dragWitness=null;event.preventDefault();return;}
    if(event.dataTransfer && payload)event.dataTransfer.effectAllowed=dragKind==='media'?'copyMove':'move';
  }
  function endDrag(event,node){
    if(dragging!==node)return;
    const witness=dragWitness;dragging=null;
    // Drop dispatch can precede dragend in the same browser task.
    queueMicrotask(()=>{if(dragWitness===witness)dragWitness=null;});
    onDragEnd(event);
  }
  state.sort={key:state.sort?.key==='duration'?'duration':'name',ascending:state.sort?.ascending!==false};
  const sortHeader=document.createElement('div');sortHeader.className='catalog-sort-header';sortHeader.setAttribute('role','group');sortHeader.setAttribute('aria-label','Sort project media');
  const sortButtons=new Map();
  for(const [key,label] of [['name','Name'],['duration','Duration']]){
    const node=document.createElement('button');node.type='button';node.className=`catalog-sort-${key}`;node.setAttribute('aria-label',`Sort media by ${label.toLowerCase()}`);sortHeader.append(node);sortButtons.set(key,node);
    node.addEventListener('click',()=>{if(disposed || root.isConnected===false)return;state.sort=state.sort.key===key?{key,ascending:!state.sort.ascending}:{key,ascending:true};render(false,false);});
  }
  const divider=document.createElement('span');divider.className='catalog-name-divider';divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-label','Media name column width');divider.title='Drag or use Left/Right to resize the name column; double-click or Home to reset';sortHeader.insertBefore(divider,sortButtons.get('duration'));
  let columnDraft=null;
  const headerWidth=()=>sortHeader.getBoundingClientRect?.().width || root.clientWidth || 210;
  const boundedName=width=>Math.max(80,Math.min(Math.max(80,headerWidth()-70),width));
  const syncNameWidth=()=>{if(Number.isFinite(state.nameWidth)){state.nameWidth=boundedName(state.nameWidth);root.style?.setProperty('--catalog-name-width',`${state.nameWidth}px`);}else{state.nameWidth=null;root.style?.removeProperty('--catalog-name-width');}divider.setAttribute('aria-valuemin','80');divider.setAttribute('aria-valuemax',String(Math.max(80,headerWidth()-70)));divider.setAttribute('aria-valuenow',String(state.nameWidth ?? Math.max(80,headerWidth()-70)));};
  const finishColumn=accept=>{const draft=columnDraft;if(!draft)return;columnDraft=null;if(!accept)state.nameWidth=draft.before;syncNameWidth();if(divider.hasPointerCapture?.(draft.pointer))divider.releasePointerCapture?.(draft.pointer);};
  const columnCurrent=()=>!disposed && root.isConnected!==false && columnDraft && headerWidth()===columnDraft.width;
  divider.addEventListener('pointerdown',event=>{if(disposed || event.button!==0 || columnDraft || root.isConnected===false)return;event.preventDefault();event.stopPropagation();columnDraft={pointer:event.pointerId,x:event.clientX,width:headerWidth(),initial:state.nameWidth ?? headerWidth()-70,before:state.nameWidth};divider.setPointerCapture?.(event.pointerId);});
  divider.addEventListener('pointermove',event=>{if(!columnDraft || event.pointerId!==columnDraft.pointer)return;if(!columnCurrent()){finishColumn(false);return;}state.nameWidth=boundedName(columnDraft.initial+event.clientX-columnDraft.x);syncNameWidth();});
  divider.addEventListener('pointerup',event=>{if(!columnDraft || event.pointerId!==columnDraft.pointer)return;if(columnCurrent())state.nameWidth=boundedName(columnDraft.initial+event.clientX-columnDraft.x);finishColumn(Boolean(columnCurrent()));});
  const abortColumn=()=>finishColumn(false);divider.addEventListener('pointercancel',abortColumn);divider.addEventListener('lostpointercapture',abortColumn);globalThis.addEventListener?.('blur',abortColumn);
  divider.addEventListener('dblclick',()=>{if(disposed || root.isConnected===false)return;finishColumn(false);state.nameWidth=null;syncNameWidth();});
  divider.addEventListener('keydown',event=>{if(disposed || event.defaultPrevented || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey)return;if(event.key==='Escape' && columnDraft){event.preventDefault();event.stopPropagation();finishColumn(false);}else if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();event.stopPropagation();finishColumn(false);state.nameWidth=event.key==='Home'?null:boundedName((state.nameWidth ?? headerWidth()-70)+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?1:8));syncNameWidth();}});
  const selectedItems=()=>disposed?[]:visible.filter(item=>state.selected.includes(item.id));
  const clearRelink=()=>{relinkSequence++;relinkForm.replaceChildren();relinkForm.onsubmit=null;};
  const intersecting=new Set(),observer=intersectionObserver?new intersectionObserver(entries=>{
    if(disposed || root.isConnected===false)return;
    for(const entry of entries){if(entry.target.parentElement!==list)continue;if(entry.isIntersecting)intersecting.add(entry.target.dataset.mediaId);else intersecting.delete(entry.target.dataset.mediaId);}
    onDemand(state.layout==='list'?[]:visibleMediaDemand(visible,intersecting));
  },{root}):null;
  const button = (text, parent, action, disabled = !writable) => {
    const node = document.createElement("button"); node.type = "button"; node.textContent = text; node.disabled = disabled;
    node.addEventListener("click",()=>{if(!disposed && !node.disabled && root.isConnected!==false)action();}); parent.append(node); return node;
  };
  const operations = document.createElement("details"), summary = document.createElement("summary"); operations.className="catalog-operations";summary.textContent = "Media and folders";
  operations.open = !!state.open; operations.addEventListener("toggle", () => { state.open = operations.open; }); operations.append(summary); root.insertBefore(operations, list);
  root.insertBefore(sortHeader,list);
  const help = document.createElement("p"); help.className = "muted"; help.textContent = "Ctrl toggles selection; Shift selects a range. Catalog changes support Undo. Removing media keeps its clips offline and preserves source files."; operations.append(help);
  const destination = document.createElement("select"); destination.setAttribute("aria-label", "Destination folder"); destination.append(new Option("Project root", ""));
  folders.forEach((f) => destination.append(new Option(f.path, f.id))); operations.append(destination);
  const ids = () => selectedItems().map(item=>item.id);
  const currentFolder=()=>state.selectedFolder || (!['','*'].includes(filter.value)?filter.value:filter.value==='*' && state.layout==='grid' && !(state.query || '').trim()?state.gridFolder:null);
  const run = async (edit) => { if(disposed || !writable || root.isConnected===false || edit.media_ids?.length===0 || edit.items?.length===0)return false;try { await commit({kind: "edit_catalog", edit});return true; } catch (error) { notice(error.message);return false; } };
  async function presentEdit(edit,view){
    const pending={...view,project_epoch:documentState.project_epoch,generation:documentState.generation};state.pendingCatalog=pending;
    try{return await run(edit);}finally{if(state.pendingCatalog===pending)delete state.pendingCatalog;}
  }
  function expandDestination(id){
    const expanded=new Set(state.expanded),seen=new Set();let folder=folders.find(folder=>folder.id===id);
    while(folder && !seen.has(folder.id)){seen.add(folder.id);expanded.add(folder.id);folder=folders.find(value=>value.id===folder.parent);}
    state.expanded=[...expanded];
  }
  function renameEntry(targetKind,id){
    cancelRename();
    const item=targetKind==='folder'?folders.find(folder=>folder.id===id):documentState.media.find(item=>item.id===id && item.compound_timeline_id);
    const row=[...list.children].find(row=>targetKind==='folder'?row.dataset.folderId===id:row.dataset.mediaId===id);
    if(!writable || !item || !row)return;
    const element=row.querySelectorAll(targetKind==='folder'?'.catalog-folder-name':'.catalog-filename')[0];
    contextMenu.rename({kind:targetKind,id,element,name:item.name});
  }
  async function contextAction(action){
    if(disposed || !writable || root.isConnected===false)return;
    if(action.kind==='begin_rename'){renameEntry(action.target_kind,action.id);return;}
    if(action.kind==='rename'){
      if(action.target_kind==='folder')return run({kind:'rename_folder',folder:action.id,name:action.name});
      const item=documentState.media.find(item=>item.id===action.id && item.compound_timeline_id);if(!item)return;
      return onAction({kind:'rename_timeline',media_id:item.id,timeline_id:item.compound_timeline_id,name:action.name});
    }
    if(action.kind==='new_folder'){
      const parent=action.parent ?? null;let name='New folder',suffix=2;
      while(folders.some(folder=>folder.name===name))name=`New folder ${suffix++}`;
      expandDestination(parent);
      return presentEdit({kind:'new_folder',name,parent},{kind:'new_folder',name,parent,before:folders.map(folder=>folder.id)});
    }
    if(action.kind==='delete_folder')return run({kind:'delete_folder',folder:action.id});
    if(action.kind==='relink_folder')return onRelink?.({kind:'folder',folder_id:action.id});
    if(action.kind==='relink')return onRelink?onRelink({kind:'selected',media_ids:action.media_ids}):relink.click?.();
    if(action.kind==='duplicate_timeline'){
      const item=documentState.media.find(item=>item.id===action.id && item.compound_timeline_id);if(!item)return;
      return onAction({kind:action.kind,media_id:item.id,timeline_id:item.compound_timeline_id});
    }
    return onAction(action);
  }
  async function catalogDrop({payload,target,isCurrent}){
    if(!dragWitness || dragWitness.payload!==JSON.stringify(payload) || dragWitness.key!==dragKey() || !isCurrent())return;
    dragWitness=null;cancelRename();contextMenu.close();
    const destination=target.folder_id ?? null;
    if(payload.kind==='media'){
      const changed=payload.media_ids.filter(id=>(documentState.media.find(item=>item.id===id).folder ?? null)!==destination);
      if(!changed.length)return;
      expandDestination(destination);
      await presentEdit({kind:'move_media',media_ids:changed,folder:destination},{kind:'move_media',media_ids:payload.media_ids,folder:destination});
    }else{
      const folder=folders.find(folder=>folder.id===payload.folder_id);if(!folder || (folder.parent ?? null)===destination)return;
      const seen=new Set();let ancestor=destination;
      while(ancestor!==null && !seen.has(ancestor)){if(ancestor===folder.id)return;seen.add(ancestor);ancestor=folders.find(folder=>folder.id===ancestor)?.parent ?? null;}
      if(ancestor!==null)return;
      expandDestination(destination);await run({kind:'move_folder',folder:folder.id,parent:destination});
    }
  }
  const move = button("Move selected media", operations, () => run({kind: "move_media", media_ids: ids(), folder: destination.value || null}));
  const remove = button("Remove selected from project", operations, () => run({kind: "remove_media", media_ids: ids()}));
  const relink = button("Relink selected media", operations, async () => {
    clearRelink();const owner=relinkSequence,selection=JSON.stringify(state.selected),targets=ids();
    try {
      if(typeof onRelink==='function'){await onRelink({kind:'selected',media_ids:targets});return;}
      const files = await getFiles();
      if(disposed || root.isConnected===false || owner!==relinkSequence || selection!==JSON.stringify(state.selected))return;
      if (!files.length) return notice("No replacement media files are listed in the server project root");
      const mappings = [];
      for (const id of targets) {
        const item = documentState.media.find((m) => m.id === id);
        if (item.compound_timeline_id) throw new Error("Select file media to relink; compound timelines use native project editing");
        const label = document.createElement("label"); label.className = "field"; label.textContent = `Replacement for ${item.name}`;
        const select = document.createElement("select"); select.required = true; select.append(new Option("Choose replacement…", ""));
        files.forEach((file) => select.append(new Option(file.name, file.path_token))); label.append(select); relinkForm.append(label); mappings.push([id, select]);
      }
      const note = document.createElement("p"); note.className = "muted"; note.textContent = "Native relink adapts FPS, crop and keys. All replacements must retain used streams and cover existing clip source ranges. One Apply is one Undo."; relinkForm.append(note);
      const apply = document.createElement("button"); apply.textContent = "Apply media relink"; relinkForm.append(apply);
      relinkForm.onsubmit = (event) => { event.preventDefault(); if (!disposed && owner===relinkSequence && selection===JSON.stringify(state.selected) && relinkForm.reportValidity()) run({kind: "relink", items: mappings.map(([media_id, select]) => ({media_id, path_token: select.value}))}); };
    } catch (error) { if(!disposed && owner===relinkSequence && selection===JSON.stringify(state.selected))notice(error.message); }
  });
  const relinkForm = document.createElement("form"); relinkForm.className="catalog-relink-form";operations.append(relinkForm);
  const form = document.createElement("form"), nameLabel = document.createElement("label"); form.className="catalog-folder-form";nameLabel.className = "field"; nameLabel.textContent = "Folder name";
  const name = document.createElement("input"); name.required = true; name.maxLength = 128; name.disabled = !writable; nameLabel.append(name); form.append(nameLabel);
  const create = document.createElement("button"); create.textContent = "Create media folder"; create.disabled = !writable; form.append(create); operations.append(form);
  form.addEventListener("submit", (event) => { event.preventDefault(); if (form.reportValidity()) run({kind: "new_folder", name: name.value, parent: currentFolder()}); });
  const rename = button("Rename current folder", operations, () => { if (form.reportValidity()) run({kind: "rename_folder", folder: currentFolder(), name: name.value}); });
  const moveFolder = button("Move current folder", operations, () => run({kind: "move_folder", folder: currentFolder(), parent: destination.value || null}));
  const deleteFolder = button("Remove folder, keep contents", operations, () => run({kind: "delete_folder", folder: currentFolder()}));
  const relinkFolder=button('Relink current project folder',operations,()=>{try{Promise.resolve(onRelink({kind:'folder',folder_id:currentFolder()})).catch(error=>{if(!disposed)notice(error.message);});}catch(error){notice(error.message);}});relinkFolder.hidden=typeof onRelink!=='function';
  function update(userIntent = false,notify=true) {
    list.querySelectorAll(".media-item").forEach((card) => { const selected = state.selected.includes(card.dataset.mediaId); card.classList.toggle("selected", selected); card.setAttribute("aria-pressed", selected); });
    list.querySelectorAll('.catalog-folder-row').forEach(row=>{row.classList.toggle('selected',state.selectedFolder===row.dataset.folderId);const label=[...row.children].find(node=>node.className==='catalog-folder-name');label?.setAttribute('aria-pressed',String(state.selectedFolder===row.dataset.folderId));});
    count.textContent = `${visible.length} shown · ${state.selected.length} selected`;
    move.disabled = remove.disabled = relink.disabled = !writable || !state.selected.length;
    rename.disabled = moveFolder.disabled = deleteFolder.disabled = !writable || !currentFolder();
    relinkFolder.disabled=!writable || typeof onRelink!=='function' || !currentFolder();
    if(notify)onSelection(state.selected.at(-1) || null, [...state.selected], {userIntent});
  }
  function render(userIntent=false,notify=true) {
    if(disposed)return;
    cancelRename();contextMenu?.close();interactions?.cancel();dragWitness=null;
    observer?.disconnect();intersecting.clear();onDemand([]);
    state.folder = filter.value; state.kind = kind.value; list.replaceChildren();breadcrumbs.replaceChildren();
    root.dataset.layout=list.dataset.layout=state.layout;
    syncNameWidth();
    for(const [layout,node]of layoutButtons)node.setAttribute('aria-pressed',String(state.layout===layout));
    const query=(state.query || '').trim().toLowerCase();
    const matches=sortMediaItems(documentState.media.filter((item) => (!query || item.name.toLowerCase().includes(query)) && (filter.value === "*" || (item.folder || "") === filter.value) && (kind.value === "all" || (kind.value === "compound" ? !!item.compound_timeline_id : kind.value === "offline" ? item.offline : kind.value === "image" ? item.is_image : kind.value === "audio" ? item.has_audio && !item.has_video : item.has_video && !item.is_image && !item.compound_timeline_id))),state.sort);
    const rows=catalogRows(matches,folders,{layout:state.layout,expanded:state.expanded,query,folder:filter.value,gridFolder:state.gridFolder});
    visible=rows.filter(row=>row.kind==='media').map(row=>row.item);
    const shown=new Set(visible.map(item=>item.id)),before=state.selected,beforeFolder=state.selectedFolder;state.selected=state.selected.filter(id=>shown.has(id));
    if(state.selectedFolder && !rows.some(row=>row.kind==='folder' && row.folder.id===state.selectedFolder))state.selectedFolder=null;
    const pruned=state.selected.length!==before.length || state.selectedFolder!==beforeFolder;if(pruned)clearRelink();if(!shown.has(state.anchor))state.anchor=null;
    const localCurrent=node=>!disposed && root.isConnected!==false && node.parentElement===list;
    const focusFolder=(id,className)=>[...list.querySelectorAll('.catalog-folder-row')].find(row=>row.dataset.folderId===id)?.querySelectorAll(`.${className}`)[0]?.focus();
    const navigateGrid=id=>{state.gridFolder=id;state.selectedFolder=null;clearRelink();render(true);};
    breadcrumbs.hidden=state.layout!=='grid' || Boolean(query) || filter.value!=='*' || !state.gridFolder;
    if(!breadcrumbs.hidden){
      button('Project media root',breadcrumbs,()=>navigateGrid(null),false).dataset.catalogDropFolder='';
      const chain=[],seen=new Set();let folder=folders.find(value=>value.id===state.gridFolder);
      while(folder && !seen.has(folder.id)){seen.add(folder.id);chain.unshift(folder);folder=folders.find(value=>value.id===folder.parent);}
      for(const folder of chain)button(folder.name,breadcrumbs,()=>navigateGrid(folder.id),false).dataset.catalogDropFolder=folder.id;
    }
    for(const [key,node] of sortButtons){const active=state.sort.key===key;node.textContent=`${key==='name'?'Name':'Duration'}${active?state.sort.ascending?' ▴':' ▾':''}`;node.setAttribute('aria-pressed',String(active));node.dataset.sortDirection=active?(state.sort.ascending?'ascending':'descending'):'none';node.title=active?`${state.sort.ascending?'Ascending':'Descending'} · click to reverse`:'Click to sort ascending';}
    for (const row of rows) {
      if(row.kind==='folder'){
        const folder=row.folder,entry=document.createElement('div');entry.className='catalog-folder-row';entry.dataset.folderId=folder.id;entry.dataset.depth=String(row.depth);entry.dataset.layout=state.layout;entry.style?.setProperty('--catalog-depth',String(row.depth));entry.setAttribute('role','group');entry.setAttribute('aria-label',`Project folder ${folder.name}`);
        const current=()=>localCurrent(entry),toggle=()=>{const expanded=new Set(state.expanded);if(expanded.has(folder.id))expanded.delete(folder.id);else expanded.add(folder.id);state.expanded=[...expanded];};
        if(state.layout!=='grid'){
          const arrow=button(row.expanded?'▾':'▸',entry,()=>{if(!current())return;toggle();render(false,false);focusFolder(folder.id,'catalog-folder-toggle');changedPresentation();},false);arrow.className='catalog-folder-toggle';arrow.setAttribute('aria-label',`${row.expanded?'Collapse':'Expand'} folder ${folder.name}`);arrow.setAttribute('aria-expanded',String(row.expanded));
        }
        const label=button(folder.name,entry,()=>{if(!current())return;clearRelink();state.selected=[];state.anchor=null;state.selectedFolder=folder.id;if(state.layout!=='grid'){toggle();render(true);focusFolder(folder.id,'catalog-folder-name');changedPresentation();}else update(true);},false);label.className='catalog-folder-name';label.setAttribute('aria-label',`Select project folder ${folder.name}`);label.setAttribute('aria-pressed',String(state.selectedFolder===folder.id));label.title=folder.path;
        entry.draggable=Boolean(writable);
        label.draggable=Boolean(writable);
        entry.addEventListener('dragstart',event=>{if(!writable || !current()){event.preventDefault();return;}try{beginDrag(event,entry,'folder',folder.id);}catch(error){dragging=null;dragWitness=null;event.preventDefault();notice(error.message);}});
        entry.addEventListener('dragend',event=>endDrag(event,entry));
        if(state.layout==='grid'){label.addEventListener('dblclick',()=>{if(current())navigateGrid(folder.id);});label.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.defaultPrevented && !event.isComposing && event.keyCode!==229 && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey){event.preventDefault();event.stopPropagation();if(current())navigateGrid(folder.id);}});}
        list.append(entry);continue;
      }
      const item=row.item;
      const card = document.createElement("button"); card.type="button";card.className = "media-item"; card.dataset.mediaId = item.id;card.classList.toggle("offline",!!item.offline);
      card.dataset.layout=state.layout;card.dataset.depth=String(row.depth);card.style?.setProperty('--catalog-depth',String(row.depth));
      const info=mediaRowInfo(item),thumbnailSlot=document.createElement("span"),copy=document.createElement("span"),filename=document.createElement("span"),metadata=document.createElement("small"),duration=document.createElement("span");
      thumbnailSlot.className="catalog-thumbnail";thumbnailSlot.setAttribute("aria-hidden","true");thumbnailSlot.textContent=info.glyph;
      copy.className="catalog-copy";filename.className="catalog-filename";filename.textContent=item.name;metadata.className="catalog-metadata";metadata.textContent=info.metadata;copy.append(filename,metadata);
      duration.className="catalog-duration";duration.textContent=info.duration;card.title=`${item.name} · ${info.metadata} · ${info.duration}`;card.append(thumbnailSlot,copy,duration);
      metadata.hidden=state.layout!=='details';duration.hidden=state.layout==='grid';
      const current=()=>!disposed && root.isConnected!==false && card.parentElement===list;
      card.addEventListener("click", (event) => {
        if(!current())return;cancelRename();contextMenu?.close();
        const slowRename=item.compound_timeline_id && state.selected.length===1 && state.selected[0]===item.id && event.target===filename && event.detail===1 && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        const selection=mediaSelection(visible,state.selected,state.anchor,item.id,{toggle:event.ctrlKey || event.metaKey,extend:event.shiftKey});
        if(JSON.stringify(selection.selected)!==JSON.stringify(state.selected))clearRelink();state.selectedFolder=null;Object.assign(state,selection);update(true);
        if(slowRename)renameTimer=setTimeout(()=>{renameTimer=null;if(current() && state.selected.length===1 && state.selected[0]===item.id)renameEntry('media',item.id);},500);
      });
      card.addEventListener("dblclick", () => {cancelRename();if(current())onOpen(item.id);});
      card.draggable=Boolean(writable);
      card.addEventListener('dragstart',event=>{
        if(!writable || !current()){event.preventDefault();return;}
        if(!state.selected.includes(item.id)){clearRelink();Object.assign(state,{selected:[item.id],anchor:item.id,selectedFolder:null});update(true);}
        if(!current()){event.preventDefault();return;}
        try{beginDrag(event,card,'media',selectedItems().map(item=>item.id));}catch(error){dragging=null;dragWitness=null;event.preventDefault();notice(error.message);}
      });
      card.addEventListener('dragend',event=>endDrag(event,card));
      const thumbnail=state.layout==='list'?null:mediaThumbnail(assets,item.id);if(thumbnail?.thumbnailURL){const image = document.createElement("img"); image.alt = ""; image.src = thumbnail.thumbnailURL;thumbnailSlot.replaceChildren(image);}
      renderMediaProxyStatus(card,proxyStatus(item.id));
      list.append(card);
      if(state.layout!=='list')observer?.observe(card);
    }
    update(userIntent || pruned,notify || pruned);
  }
  list.addEventListener("keydown", (event) => {
    if(disposed || event.defaultPrevented || event.isComposing || event.keyCode===229 || event.altKey || event.getModifierState?.('AltGraph'))return;
    if(event.key==='F2' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey){event.preventDefault();event.stopPropagation();if(state.selectedFolder)renameEntry('folder',state.selectedFolder);else if(state.selected.length===1)renameEntry('media',state.selected[0]);return;}
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); event.stopPropagation(); clearRelink();state.selectedFolder=null;state.selected = visible.map((m) => m.id); update(true); return; }
    if(event.key==='Enter' && !event.repeat && !event.ctrlKey && !event.metaKey && event.target.parentElement===list && visible.some(item=>item.id===event.target.dataset.mediaId)){event.preventDefault();event.stopPropagation();onOpen(event.target.dataset.mediaId);return;}
    if(event.target.parentElement!==list && event.target!==list)return;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = visible.findIndex((m) => m.id === event.target.dataset.mediaId), next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    if (!visible[next]) return;
    if (!event.ctrlKey && !event.metaKey) {clearRelink();state.selectedFolder=null;Object.assign(state, mediaSelection(visible, state.selected, state.anchor, visible[next].id, {extend: event.shiftKey}));}
    list.querySelectorAll(".media-item")[next]?.focus(); update(true);
  });
  list.addEventListener('click',event=>{if(disposed || event.target!==list || root.isConnected===false)return;clearRelink();state.selected=[];state.anchor=null;state.selectedFolder=null;update(true);});
  contextMenu=createCatalogMenu({root,getContext:context,onAction:contextAction,notice});
  interactions=createCatalogInteractions({root,list,getContext:context,canWrite:()=>writable && !disposed,onDrop:catalogDrop,notice,
    onMarquee:({media_ids})=>{cancelRename();contextMenu.close();clearRelink();state.selected=[...media_ids];state.anchor=media_ids[0] ?? null;state.selectedFolder=null;update(true);},
    onContextMenu:hit=>{cancelRename();if(hit.kind==='media' && !state.selected.includes(hit.id)){clearRelink();state.selected=[hit.id];state.anchor=hit.id;state.selectedFolder=null;update(true);}contextMenu.open(hit);}
  });
  const filterChanged=()=>{state.selectedFolder=null;clearRelink();render(true);};filter.addEventListener("change", filterChanged); kind.addEventListener("change", filterChanged); render();
  function acceptReceipt(receipt){
    const pending=state.pendingCatalog;
    if(disposed || !pending || !receipt || receipt.project_epoch!==documentState.project_epoch || receipt.generation!==documentState.generation || pending.project_epoch!==documentState.project_epoch || pending.generation===documentState.generation)return false;
    delete state.pendingCatalog;
    if(pending.kind==='move_media' && pending.media_ids.every(id=>documentState.media.some(item=>item.id===id && (item.folder ?? null)===pending.folder))){
      state.selected=[...pending.media_ids];state.anchor=pending.media_ids[0];state.selectedFolder=null;state.query='';state.gridFolder=pending.folder;filter.value='*';kind.value='all';
      render(true);changedPresentation();[...list.querySelectorAll('.media-item')].find(row=>row.dataset.mediaId===pending.media_ids[0])?.scrollIntoView?.({block:'center'});return true;
    }
    if(pending.kind==='new_folder'){
      const added=folders.filter(folder=>!pending.before.includes(folder.id) && folder.name===pending.name && (folder.parent ?? null)===pending.parent);
      if(added.length!==1)return false;
      state.selected=[];state.anchor=null;state.selectedFolder=added[0].id;state.query='';state.gridFolder=pending.parent;filter.value='*';kind.value='all';
      render(true);changedPresentation();renameEntry('folder',added[0].id);return true;
    }
    return false;
  }
  return {acceptReceipt,selectedItems,search(query) {if(disposed)return;const changed=query!==(state.query || '');if(changed)clearRelink();state.query = query; render(changed);},reveal(ids){
    if(disposed || root.isConnected===false || !Array.isArray(ids))return;
    const wanted=[...new Set(ids)].filter(id=>documentState.media.some(item=>item.id===id));if(!wanted.length)return;
    const targets=wanted.map(id=>documentState.media.find(item=>item.id===id)),open=new Set(state.expanded),map=new Map(folders.map(folder=>[folder.id,folder]));
    for(const item of targets){let folder=map.get(item.folder),seen=new Set();while(folder && !seen.has(folder.id)){seen.add(folder.id);open.add(folder.id);folder=map.get(folder.parent);}}
    state.expanded=[...open];state.gridFolder=map.has(targets.at(-1).folder)?targets.at(-1).folder:null;state.selectedFolder=null;state.selected=wanted;state.anchor=state.layout==='grid'?wanted.at(-1):wanted[0];filter.value='*';kind.value='all';
    if(targets.some(item=>!item.name.toLowerCase().includes((state.query || '').trim().toLowerCase())))state.query='';
    clearRelink();render();changedPresentation();[...list.querySelectorAll('.media-item')].find(row=>row.dataset.mediaId===wanted.at(-1))?.scrollIntoView?.({block:'center'});
  },dispose(){finishColumn(false);cancelRename();contextMenu.dispose();interactions.dispose();dragWitness=null;disposed=true;relinkSequence++;relinkForm.onsubmit=null;observer?.disconnect();intersecting.clear();globalThis.removeEventListener?.('blur',abortColumn);onDemand([]);}};
}
