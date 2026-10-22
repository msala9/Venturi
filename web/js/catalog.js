import {mediaThumbnail} from './source-assets.js';
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

export function renderCatalog(root, documentState, state, {writable, assets, commit, getFiles, onSelection, onOpen, notice,onDemand=()=>{},intersectionObserver=globalThis.IntersectionObserver}) {
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
  const count = document.createElement("p"); count.className = "muted"; count.setAttribute("aria-live", "polite"); root.append(count);
  const list = document.createElement("div"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Project media"); list.tabIndex=0;list.dataset.clipboardOwner='pool';root.append(list);
  let visible = [],disposed=false;
  const intersecting=new Set(),observer=intersectionObserver?new intersectionObserver(entries=>{
    if(disposed || root.isConnected===false)return;
    for(const entry of entries){if(entry.target.parentElement!==list)continue;if(entry.isIntersecting)intersecting.add(entry.target.dataset.mediaId);else intersecting.delete(entry.target.dataset.mediaId);}
    onDemand(visibleMediaDemand(visible,intersecting));
  },{root}):null;
  const button = (text, parent, action, disabled = !writable) => {
    const node = document.createElement("button"); node.type = "button"; node.textContent = text; node.disabled = disabled;
    node.addEventListener("click", action); parent.append(node); return node;
  };
  const operations = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Media and folders";
  operations.open = !!state.open; operations.addEventListener("toggle", () => { state.open = operations.open; }); operations.append(summary); root.insertBefore(operations, list);
  const help = document.createElement("p"); help.className = "muted"; help.textContent = "Ctrl toggles selection; Shift selects a range. Catalog changes support Undo. Removing media keeps its clips offline and preserves source files."; operations.append(help);
  const destination = document.createElement("select"); destination.setAttribute("aria-label", "Destination folder"); destination.append(new Option("Project root", ""));
  folders.forEach((f) => destination.append(new Option(f.path, f.id))); operations.append(destination);
  const ids = () => [...state.selected];
  const run = async (edit) => { try { await commit({kind: "edit_catalog", edit}); } catch (error) { notice(error.message); } };
  const move = button("Move selected media", operations, () => run({kind: "move_media", media_ids: ids(), folder: destination.value || null}));
  const remove = button("Remove selected from project", operations, () => run({kind: "remove_media", media_ids: ids()}));
  const relink = button("Relink selected media", operations, async () => {
    relinkForm.replaceChildren();
    try {
      const files = await getFiles();
      if (!files.length) return notice("No replacement media files are listed in the server project root");
      const mappings = [];
      for (const id of ids()) {
        const item = documentState.media.find((m) => m.id === id);
        if (item.compound_timeline_id) throw new Error("Select file media to relink; compound timelines use native project editing");
        const label = document.createElement("label"); label.className = "field"; label.textContent = `Replacement for ${item.name}`;
        const select = document.createElement("select"); select.required = true; select.append(new Option("Choose replacement…", ""));
        files.forEach((file) => select.append(new Option(file.name, file.path_token))); label.append(select); relinkForm.append(label); mappings.push([id, select]);
      }
      const note = document.createElement("p"); note.className = "muted"; note.textContent = "Native relink adapts FPS, crop and keys. All replacements must retain used streams and cover existing clip source ranges. One Apply is one Undo."; relinkForm.append(note);
      const apply = document.createElement("button"); apply.textContent = "Apply media relink"; relinkForm.append(apply);
      relinkForm.onsubmit = (event) => { event.preventDefault(); if (relinkForm.reportValidity()) run({kind: "relink", items: mappings.map(([media_id, select]) => ({media_id, path_token: select.value}))}); };
    } catch (error) { notice(error.message); }
  });
  const relinkForm = document.createElement("form"); operations.append(relinkForm);
  const form = document.createElement("form"), nameLabel = document.createElement("label"); nameLabel.className = "field"; nameLabel.textContent = "Folder name";
  const name = document.createElement("input"); name.required = true; name.maxLength = 128; name.disabled = !writable; nameLabel.append(name); form.append(nameLabel);
  const create = document.createElement("button"); create.textContent = "Create media folder"; create.disabled = !writable; form.append(create); operations.append(form);
  form.addEventListener("submit", (event) => { event.preventDefault(); if (form.reportValidity()) run({kind: "new_folder", name: name.value, parent: filter.value === "*" ? null : filter.value || null}); });
  const rename = button("Rename current folder", operations, () => { if (form.reportValidity()) run({kind: "rename_folder", folder: filter.value, name: name.value}); });
  const moveFolder = button("Move current folder", operations, () => run({kind: "move_folder", folder: filter.value, parent: destination.value || null}));
  const deleteFolder = button("Remove folder, keep contents", operations, () => run({kind: "delete_folder", folder: filter.value}));
  function update() {
    list.querySelectorAll(".media-item").forEach((card) => { const selected = state.selected.includes(card.dataset.mediaId); card.classList.toggle("selected", selected); card.setAttribute("aria-pressed", selected); });
    count.textContent = `${visible.length} shown · ${state.selected.length} selected`;
    move.disabled = remove.disabled = relink.disabled = !writable || !state.selected.length;
    rename.disabled = moveFolder.disabled = deleteFolder.disabled = !writable || ["", "*"].includes(filter.value);
    onSelection(state.selected.at(-1) || null, [...state.selected]);
  }
  function render() {
    observer?.disconnect();intersecting.clear();onDemand([]);
    state.folder = filter.value; state.kind = kind.value; list.replaceChildren();
    visible = documentState.media.filter((item) => (!state.query || item.name.toLowerCase().includes(state.query)) && (filter.value === "*" || (item.folder || "") === filter.value) && (kind.value === "all" || (kind.value === "compound" ? !!item.compound_timeline_id : kind.value === "offline" ? item.offline : kind.value === "image" ? item.is_image : kind.value === "audio" ? item.has_audio && !item.has_video : item.has_video && !item.is_image && !item.compound_timeline_id)));
    for (const item of visible) {
      const card = document.createElement("button"); card.className = "media-item"; card.dataset.mediaId = item.id; card.textContent = `${item.name}${item.offline ? " · OFFLINE" : ""}`;
      card.addEventListener("click", (event) => { const selection = mediaSelection(visible, state.selected, state.anchor, item.id, {toggle: event.ctrlKey || event.metaKey, extend: event.shiftKey}); Object.assign(state, selection); update(); });
      card.addEventListener("dblclick", () => onOpen(item.id));
      const thumbnail=mediaThumbnail(assets,item.id);if(thumbnail?.thumbnailURL){const image = document.createElement("img"); image.alt = ""; image.src = thumbnail.thumbnailURL; card.prepend(image);}
      list.append(card);
      observer?.observe(card);
    }
    update();
  }
  list.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); event.stopPropagation(); state.selected = visible.map((m) => m.id); update(); return; }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = visible.findIndex((m) => m.id === event.target.dataset.mediaId), next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    if (!visible[next]) return;
    if (!event.ctrlKey && !event.metaKey) Object.assign(state, mediaSelection(visible, state.selected, state.anchor, visible[next].id, {extend: event.shiftKey}));
    list.querySelectorAll(".media-item")[next]?.focus(); update();
  });
  filter.addEventListener("change", render); kind.addEventListener("change", render); render();
  return {search(query) {if(disposed)return;state.query = query; render();},dispose(){disposed=true;observer?.disconnect();intersecting.clear();onDemand([]);}};
}
