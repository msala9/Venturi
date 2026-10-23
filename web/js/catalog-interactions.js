export const CATALOG_DRAG_TYPE='application/x-venturi-catalog';
const id=value=>typeof value==='string' && value.length>0 && value.length<=80 && !/[\u0000-\u001f\u007f]/.test(value);
const binding=context=>context && typeof context.project_epoch==='string' && context.project_epoch.length>0 && context.project_epoch.length<=256 && typeof context.generation==='string' && context.generation.length>0 && context.generation.length<=80 && Array.isArray(context.snapshot?.media) && Array.isArray(context.snapshot.folders);
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));

export function makeCatalogDrag(kind,idsOrId,context){
  if(!binding(context))return null;
  const value={version:1,kind,project_epoch:context.project_epoch,generation:context.generation};
  if(kind==='media'){
    if(!Array.isArray(idsOrId) || !idsOrId.length || idsOrId.length>256 || idsOrId.some(value=>!id(value)) || new Set(idsOrId).size!==idsOrId.length)return null;
    const media=new Map(context.snapshot.media.map(item=>[item.id,item]));if(idsOrId.some(id=>!media.has(id)))return null;
    value.media_ids=[...idsOrId];value.source_folders=idsOrId.map(media_id=>({media_id,folder_id:media.get(media_id).folder ?? null}));
  }else if(kind==='folder'){
    const folder=context.snapshot.folders.find(folder=>folder.id===idsOrId);if(!id(idsOrId) || !folder)return null;value.folder_id=folder.id;value.source_parent=folder.parent ?? null;
  }else return null;
  const serialized=JSON.stringify(value);return parseCatalogDrag(serialized,context)?serialized:null;
}

export function parseCatalogDrag(text,context){
  if(!binding(context) || typeof text!=='string' || text.length>131072 || new TextEncoder().encode(text).length>131072)return null;
  try{
    const value=JSON.parse(text);
    if(value?.version!==1 || value.project_epoch!==context.project_epoch || value.generation!==context.generation)return null;
    if(value.kind==='media'){
      if(!exact(value,['version','kind','project_epoch','generation','media_ids','source_folders']) || !Array.isArray(value.media_ids) || !value.media_ids.length || value.media_ids.length>256 || value.media_ids.some(value=>!id(value)) || new Set(value.media_ids).size!==value.media_ids.length || !Array.isArray(value.source_folders) || value.source_folders.length!==value.media_ids.length)return null;
      const media=new Map(context.snapshot.media.map(item=>[item.id,item]));
      if(value.source_folders.some((source,index)=>!exact(source,['media_id','folder_id']) || source.media_id!==value.media_ids[index] || !media.has(source.media_id) || source.folder_id!==(media.get(source.media_id).folder ?? null)))return null;
      return {...value,media_ids:[...value.media_ids],source_folders:value.source_folders.map(source=>({...source}))};
    }
    if(value.kind==='folder' && exact(value,['version','kind','project_epoch','generation','folder_id','source_parent']) && id(value.folder_id)){
      const folder=context.snapshot.folders.find(folder=>folder.id===value.folder_id);if(folder && value.source_parent===(folder.parent ?? null))return {...value};
    }
  }catch{}
  return null;
}

const rectangle=value=>value && [value.left,value.top,value.right,value.bottom].every(Number.isFinite) && value.right>value.left && value.bottom>value.top?{left:value.left,top:value.top,right:value.right,bottom:value.bottom}:null;
const intersects=(a,b)=>a.left<=b.right && a.right>=b.left && a.top<=b.bottom && a.bottom>=b.top;
const inside=(node,parent)=>{while(node){if(node===parent)return true;node=node.parentElement;}return false;};

export function createCatalogInteractions({root,list,getContext,onMarquee=()=>{},onContextMenu,onDrop,notice=()=>{},canWrite=()=>false,dragType=CATALOG_DRAG_TYPE}){
  const doc=root.ownerDocument || document,window=doc.defaultView || globalThis,overlay=doc.createElement('div');overlay.className='catalog-marquee';overlay.hidden=true;overlay.setAttribute('aria-hidden','true');overlay.style.position='fixed';overlay.style.pointerEvents='none';root.append(overlay);
  let disposed=false,gesture=null,suppressClick=false,dropping=false;
  const available=()=>!disposed && root.isConnected!==false && list.isConnected!==false && !doc.hidden && !doc.querySelector?.('dialog[open]');
  function stamp(){
    try{if(!available())return null;const context=getContext(),bounds=rectangle(list.getBoundingClientRect());if(!binding(context) || !bounds)return null;
      return {context,bounds,key:JSON.stringify([context.project_epoch,context.generation,context.selected,context.anchor,context.selectedFolder,context.presentation,context.backgroundFolder,bounds,list.scrollLeft || 0,list.scrollTop || 0,root.scrollLeft || 0,root.scrollTop || 0])};
    }catch{return null;}
  }
  const current=owner=>{const value=stamp();return value && value.key===owner.key && value.context.snapshot===owner.context.snapshot?value:null;};
  function cancel(){const previous=gesture;gesture=null;overlay.hidden=true;if(previous){suppressClick=true;if(list.hasPointerCapture?.(previous.pointer))list.releasePointerCapture?.(previous.pointer);}return Boolean(previous);}
  const rows=context=>Array.isArray(context.rows)?context.rows:[...list.querySelectorAll('.media-item, .catalog-folder-row')].map(element=>({kind:element.dataset.mediaId!==undefined?'media':'folder',id:element.dataset.mediaId ?? element.dataset.folderId,element}));
  function paint(owner,x,y){
    owner.x=x;owner.y=y;owner.moved ||= Math.hypot(x-owner.startX,y-owner.startY)>=4;
    if(!owner.moved)return;overlay.hidden=false;overlay.style.left=`${Math.min(owner.startX,x)}px`;overlay.style.top=`${Math.min(owner.startY,y)}px`;overlay.style.width=`${Math.abs(x-owner.startX)}px`;overlay.style.height=`${Math.abs(y-owner.startY)}px`;
  }
  function down(event){
    suppressClick=false;if(event.defaultPrevented || event.button!==0 || event.target!==list || gesture || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY))return;
    const owner=stamp();if(!owner)return;event.preventDefault();list.focus?.({preventScroll:true});gesture={...owner,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false};list.setPointerCapture?.(event.pointerId);
  }
  function move(event){if(!gesture || event.pointerId!==gesture.pointer)return;if(!current(gesture)){cancel();return;}if(Number.isFinite(event.clientX) && Number.isFinite(event.clientY))paint(gesture,event.clientX,event.clientY);}
  function up(event){
    if(!gesture || event.pointerId!==gesture.pointer)return;const owner=gesture,live=current(owner);
    if(!live || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)){cancel();return;}paint(owner,event.clientX,event.clientY);
    gesture=null;overlay.hidden=true;if(list.hasPointerCapture?.(owner.pointer))list.releasePointerCapture?.(owner.pointer);if(!owner.moved)return;
    suppressClick=true;event.preventDefault();const rect={left:Math.min(owner.startX,owner.x),right:Math.max(owner.startX,owner.x),top:Math.min(owner.startY,owner.y),bottom:Math.max(owner.startY,owner.y)},known=new Set(live.context.snapshot.media.map(item=>item.id)),seen=new Set(),media_ids=[];
    for(const row of rows(live.context)){if(row.kind!=='media' || !known.has(row.id) || seen.has(row.id) || row.element?.isConnected===false)continue;const bounds=rectangle(row.element?.getBoundingClientRect?.() || row.rect);if(bounds && intersects(bounds,rect)){seen.add(row.id);media_ids.push(row.id);}}
    try{onMarquee({media_ids,rect,additive:false,selected:[...(owner.context.selected || [])],anchor:owner.context.anchor ?? null,project_epoch:owner.context.project_epoch,generation:owner.context.generation});}catch(error){notice(error.message);}
  }
  function target(node,context){
    if(!inside(node,root))return null;let interactive=false;
    for(let current=node;current;current=current.parentElement){
      if(['INPUT','SELECT','TEXTAREA','FORM'].includes(current.tagName) || current.isContentEditable===true)return null;
      if(current.dataset?.catalogDropFolder!==undefined){const folder_id=current.dataset.catalogDropFolder || null;if(folder_id!==null && !context.snapshot.folders.some(folder=>folder.id===folder_id))return null;return {kind:folder_id===null?'background':'folder',id:folder_id,folder_id};}
      if(current.dataset?.mediaId!==undefined && inside(current,list)){const item=context.snapshot.media.find(item=>item.id===current.dataset.mediaId);return item?{kind:'media',id:item.id,folder_id:context.snapshot.folders.some(folder=>folder.id===item.folder)?item.folder:null}:null;}
      if(current.dataset?.folderId!==undefined && inside(current,list)){const folder=context.snapshot.folders.find(folder=>folder.id===current.dataset.folderId);return folder?{kind:'folder',id:folder.id,folder_id:folder.id}:null;}
      interactive ||= ['BUTTON','INPUT','SELECT','TEXTAREA','A','SUMMARY'].includes(current.tagName) || current.isContentEditable===true;
      if(current===root)break;
    }
    if(interactive || node!==root && !inside(node,list))return null;const folder_id=context.backgroundFolder ?? null;
    return folder_id===null || context.snapshot.folders.some(folder=>folder.id===folder_id)?{kind:'background',id:null,folder_id}:null;
  }
  function menu(event,keyboard=false){
    if(event.defaultPrevented || typeof onContextMenu!=='function')return;const owner=stamp();if(!owner)return;const hit=target(event.target,owner.context);if(!hit)return;
    const bounds=rectangle(event.target.getBoundingClientRect?.()) || owner.bounds,x=keyboard?bounds.left+8:event.clientX,y=keyboard?bounds.bottom:event.clientY;if(!Number.isFinite(x) || !Number.isFinite(y))return;
    cancel();event.preventDefault();event.stopPropagation();try{onContextMenu({kind:hit.kind,id:hit.id,x,y,keyboard,event});}catch(error){notice(error.message);}
  }
  function key(event){
    if(event.defaultPrevented || event.isComposing || event.keyCode===229 || event.repeat || event.getModifierState?.('AltGraph'))return;
    if(event.key==='Escape' && gesture){event.preventDefault();event.stopPropagation();cancel();return;}
    if(inside(event.target,root) && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key==='ContextMenu' || event.key==='F10' && event.shiftKey))menu(event,true);
  }
  const carries=event=>[...(event.dataTransfer?.types || [])].includes(dragType);
  function over(event){if(event.defaultPrevented || !carries(event) || !canWrite())return;const owner=stamp();if(owner && target(event.target,owner.context)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}}
  function drop(event){
    if(event.defaultPrevented || !carries(event) || typeof onDrop!=='function')return;const owner=stamp();if(!owner)return;const hit=target(event.target,owner.context);if(!hit)return;event.preventDefault();event.stopPropagation();if(dropping || !canWrite())return;
    let payload;try{payload=parseCatalogDrag(event.dataTransfer.getData(dragType),owner.context);}catch{}
    if(!payload){notice('The project media or source folder changed; start the drag again');return;}
    cancel();dropping=true;Promise.resolve().then(()=>{if(!current(owner) || !canWrite())return;return onDrop({payload,target:hit,event,isCurrent:()=>Boolean(current(owner)) && canWrite()});}).catch(error=>{if(available() && getContext()?.project_epoch===owner.context.project_epoch)notice(error.message);}).finally(()=>{dropping=false;});
  }
  const abort=()=>cancel(),click=event=>{if(suppressClick && event.detail!==0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
  const bindings=[[list,'pointerdown',down],[doc,'pointermove',move,true],[doc,'pointerup',up,true],[doc,'pointercancel',event=>{if(gesture && event.pointerId===gesture.pointer)cancel();},true],[list,'lostpointercapture',event=>{if(gesture && event.pointerId===gesture.pointer)cancel();}],[doc,'keydown',key,true],[doc,'scroll',abort,true],[window,'blur',abort],[window,'resize',abort],[root,'contextmenu',menu],[root,'dragover',over],[root,'drop',drop],[list,'click',click,true]];
  for(const [node,type,handler,capture]of bindings)node.addEventListener?.(type,handler,capture);
  return {cancel,dispose(){if(disposed)return;cancel();disposed=true;for(const [node,type,handler,capture]of bindings)node.removeEventListener?.(type,handler,capture);overlay.remove();}};
}
