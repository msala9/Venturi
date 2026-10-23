import {mediaThumbnail} from './source-assets.js';
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

export function mediaRowInfo(item) {
  const type=item.compound_timeline_id?"Timeline":item.is_image?"Still image":item.has_video?"Video":"Audio";
  const rate=item.fps?.num/item.fps?.den;
  const seconds=Number.isSafeInteger(item.duration_frames) && item.duration_frames>=0 && Number.isFinite(rate) && rate>0?Math.floor(item.duration_frames/rate):null;
  const duration=item.is_image?"Still":seconds===null?"—":seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
  const metadata=[type];
  if(item.has_audio && (item.has_video || item.compound_timeline_id))metadata.push(item.audio_stream_count>1?`${item.audio_stream_count} audio streams`:"Audio");
  if(!item.is_image && item.has_video && Number.isFinite(rate) && rate>0)metadata.push(`${rate.toFixed(3).replace(/\.?0+$/,"")} fps`);
  if(item.offline)metadata.push("Offline");
  return {metadata:metadata.join(" · "),duration,glyph:item.compound_timeline_id?"▤":item.is_image?"▣":item.has_video?"▻":"♪"};
}

export function renderCatalog(root, documentState, state, {writable, assets, commit, getFiles, onSelection, onOpen, notice,onDemand=()=>{},onDragStart=()=>{},onDragEnd=()=>{},onRelink,intersectionObserver=globalThis.IntersectionObserver}) {
  root.replaceChildren();
  state.selected = (state.selected || []).filter((id) => documentState.media.some((item) => item.id === id));
  const folders = folderPaths(documentState.folders || []);
  const toolbar = document.createElement("div"); toolbar.className = "catalog-toolbar";
  const filter = document.createElement("select"); filter.setAttribute("aria-label", "Media folder");
  filter.append(new Option("All project media", "*"), new Option("Project root", ""));
  folders.forEach((folder) => filter.append(new Option(folder.path, folder.id)));
  filter.value = [...filter.options].some((o) => o.value === state.folder) ? state.folder : "*";
  const kind = document.createElement("select"); kind.setAttribute("aria-label", "Media type");
  for (const [id, name] of [["all", "All types"], ["video", "Video"], ["audio", "Audio"], ["image", "Stills"], ["compound", "Timelines / compounds"], ["offline", "Offline"]]) kind.append(new Option(name, id));
  kind.value = state.kind || "all"; toolbar.append(filter, kind); root.append(toolbar);
  const count = document.createElement("p"); count.className = "catalog-count muted"; count.setAttribute("aria-live", "polite"); root.append(count);
  const list = document.createElement("div"); list.className="catalog-rows";list.setAttribute("role", "group"); list.setAttribute("aria-label", "Project media"); list.tabIndex=0;list.dataset.clipboardOwner='pool';root.append(list);
  let visible = [],disposed=false,relinkSequence=0,dragging=null;
  state.sort={key:state.sort?.key==='duration'?'duration':'name',ascending:state.sort?.ascending!==false};
  const sortHeader=document.createElement('div');sortHeader.className='catalog-sort-header';sortHeader.setAttribute('role','group');sortHeader.setAttribute('aria-label','Sort project media');
  const sortButtons=new Map();
  for(const [key,label] of [['name','Name'],['duration','Duration']]){
    const node=document.createElement('button');node.type='button';node.className=`catalog-sort-${key}`;node.setAttribute('aria-label',`Sort media by ${label.toLowerCase()}`);sortHeader.append(node);sortButtons.set(key,node);
    node.addEventListener('click',()=>{if(disposed || root.isConnected===false)return;state.sort=state.sort.key===key?{key,ascending:!state.sort.ascending}:{key,ascending:true};render(false,false);});
  }
  const selectedItems=()=>disposed?[]:visible.filter(item=>state.selected.includes(item.id));
  const clearRelink=()=>{relinkSequence++;relinkForm.replaceChildren();relinkForm.onsubmit=null;};
  const intersecting=new Set(),observer=intersectionObserver?new intersectionObserver(entries=>{
    if(disposed || root.isConnected===false)return;
    for(const entry of entries){if(entry.target.parentElement!==list)continue;if(entry.isIntersecting)intersecting.add(entry.target.dataset.mediaId);else intersecting.delete(entry.target.dataset.mediaId);}
    onDemand(visibleMediaDemand(visible,intersecting));
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
  const run = async (edit) => { if(disposed || !writable || root.isConnected===false || edit.media_ids?.length===0 || edit.items?.length===0)return;try { await commit({kind: "edit_catalog", edit}); } catch (error) { notice(error.message); } };
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
  form.addEventListener("submit", (event) => { event.preventDefault(); if (form.reportValidity()) run({kind: "new_folder", name: name.value, parent: filter.value === "*" ? null : filter.value || null}); });
  const rename = button("Rename current folder", operations, () => { if (form.reportValidity()) run({kind: "rename_folder", folder: filter.value, name: name.value}); });
  const moveFolder = button("Move current folder", operations, () => run({kind: "move_folder", folder: filter.value, parent: destination.value || null}));
  const deleteFolder = button("Remove folder, keep contents", operations, () => run({kind: "delete_folder", folder: filter.value}));
  const relinkFolder=button('Relink current project folder',operations,()=>{try{Promise.resolve(onRelink({kind:'folder',folder_id:filter.value})).catch(error=>{if(!disposed)notice(error.message);});}catch(error){notice(error.message);}});relinkFolder.hidden=typeof onRelink!=='function';
  function update(userIntent = false,notify=true) {
    list.querySelectorAll(".media-item").forEach((card) => { const selected = state.selected.includes(card.dataset.mediaId); card.classList.toggle("selected", selected); card.setAttribute("aria-pressed", selected); });
    count.textContent = `${visible.length} shown · ${state.selected.length} selected`;
    move.disabled = remove.disabled = relink.disabled = !writable || !state.selected.length;
    rename.disabled = moveFolder.disabled = deleteFolder.disabled = !writable || ["", "*"].includes(filter.value);
    relinkFolder.disabled=!writable || typeof onRelink!=='function' || ["", "*"].includes(filter.value);
    if(notify)onSelection(state.selected.at(-1) || null, [...state.selected], {userIntent});
  }
  function render(userIntent=false,notify=true) {
    if(disposed)return;
    observer?.disconnect();intersecting.clear();onDemand([]);
    state.folder = filter.value; state.kind = kind.value; list.replaceChildren();
    const query=(state.query || '').trim().toLowerCase();
    visible = sortMediaItems(documentState.media.filter((item) => (!query || item.name.toLowerCase().includes(query)) && (filter.value === "*" || (item.folder || "") === filter.value) && (kind.value === "all" || (kind.value === "compound" ? !!item.compound_timeline_id : kind.value === "offline" ? item.offline : kind.value === "image" ? item.is_image : kind.value === "audio" ? item.has_audio && !item.has_video : item.has_video && !item.is_image && !item.compound_timeline_id))),state.sort);
    const shown=new Set(visible.map(item=>item.id)),before=state.selected;state.selected=state.selected.filter(id=>shown.has(id));
    if(state.selected.length!==before.length)clearRelink();if(!shown.has(state.anchor))state.anchor=null;
    for(const [key,node] of sortButtons){const active=state.sort.key===key;node.textContent=`${key==='name'?'Name':'Duration'}${active?state.sort.ascending?' ▴':' ▾':''}`;node.setAttribute('aria-pressed',String(active));node.dataset.sortDirection=active?(state.sort.ascending?'ascending':'descending'):'none';node.title=active?`${state.sort.ascending?'Ascending':'Descending'} · click to reverse`:'Click to sort ascending';}
    for (const item of visible) {
      const card = document.createElement("button"); card.type="button";card.className = "media-item"; card.dataset.mediaId = item.id;card.classList.toggle("offline",!!item.offline);
      const info=mediaRowInfo(item),thumbnailSlot=document.createElement("span"),copy=document.createElement("span"),filename=document.createElement("span"),metadata=document.createElement("small"),duration=document.createElement("span");
      thumbnailSlot.className="catalog-thumbnail";thumbnailSlot.setAttribute("aria-hidden","true");thumbnailSlot.textContent=info.glyph;
      copy.className="catalog-copy";filename.className="catalog-filename";filename.textContent=item.name;metadata.className="catalog-metadata";metadata.textContent=info.metadata;copy.append(filename,metadata);
      duration.className="catalog-duration";duration.textContent=info.duration;card.title=`${item.name} · ${info.metadata} · ${info.duration}`;card.append(thumbnailSlot,copy,duration);
      const current=()=>!disposed && root.isConnected!==false && card.parentElement===list;
      card.addEventListener("click", (event) => { if(!current())return;const selection = mediaSelection(visible, state.selected, state.anchor, item.id, {toggle: event.ctrlKey || event.metaKey, extend: event.shiftKey});if(JSON.stringify(selection.selected)!==JSON.stringify(state.selected))clearRelink(); Object.assign(state, selection); update(true); });
      card.addEventListener("dblclick", () => {if(current())onOpen(item.id);});
      card.draggable=Boolean(writable);
      card.addEventListener('dragstart',event=>{
        if(!writable || !current()){event.preventDefault();return;}
        if(!state.selected.includes(item.id)){clearRelink();Object.assign(state,{selected:[item.id],anchor:item.id});update(true);}
        if(!current()){event.preventDefault();return;}
        dragging=card;try{if(onDragStart(event,selectedItems())===false){dragging=null;event.preventDefault();}}catch(error){dragging=null;event.preventDefault();notice(error.message);}
      });
      card.addEventListener('dragend',event=>{if(dragging===card){dragging=null;onDragEnd(event);}});
      const thumbnail=mediaThumbnail(assets,item.id);if(thumbnail?.thumbnailURL){const image = document.createElement("img"); image.alt = ""; image.src = thumbnail.thumbnailURL;thumbnailSlot.replaceChildren(image);}
      list.append(card);
      observer?.observe(card);
    }
    update(userIntent,notify);
  }
  list.addEventListener("keydown", (event) => {
    if(disposed || event.defaultPrevented || event.isComposing || event.keyCode===229 || event.altKey || event.getModifierState?.('AltGraph'))return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); event.stopPropagation(); clearRelink();state.selected = visible.map((m) => m.id); update(true); return; }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = visible.findIndex((m) => m.id === event.target.dataset.mediaId), next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    if (!visible[next]) return;
    if (!event.ctrlKey && !event.metaKey) {clearRelink();Object.assign(state, mediaSelection(visible, state.selected, state.anchor, visible[next].id, {extend: event.shiftKey}));}
    list.querySelectorAll(".media-item")[next]?.focus(); update(true);
  });
  const filterChanged=()=>{clearRelink();render(true);};filter.addEventListener("change", filterChanged); kind.addEventListener("change", filterChanged); render();
  return {selectedItems,search(query) {if(disposed)return;const changed=query!==(state.query || '');if(changed)clearRelink();state.query = query; render(changed);},dispose(){disposed=true;relinkSequence++;relinkForm.onsubmit=null;observer?.disconnect();intersecting.clear();onDemand([]);}};
}
