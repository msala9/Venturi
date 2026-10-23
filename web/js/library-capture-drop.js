import {PROJECT_POOL_DRAG_TYPE} from './project-pool-placement.js';

const id=value=>typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<=18_446_744_073_709_551_615n;
const text=value=>typeof value==='string' && value.length>0 && value.length<=256 && !/[\u0000-\u001f\u007f]/.test(value);
const visible=node=>node?.isConnected===true && !node.hidden && (node.getClientRects?.().length ?? 1)>0;
let serial=0;
function opaquePayload(value){
  if(typeof value!=='string' || value.length>512)return false;
  try{const parsed=JSON.parse(value);return parsed?.version===1 && text(parsed.token) && Object.keys(parsed).length===2 && Object.hasOwn(parsed,'version') && Object.hasOwn(parsed,'token');}catch{return false;}
}
function identity(context){
  const keys=['project_epoch','generation','command_epoch','timeline_id','timeline_revision'];
  return context && keys.every(key=>text(context[key])) && id(context.timeline_id) && Array.isArray(context.media)?JSON.stringify([...keys.map(key=>context[key]),context.project_name ?? null]):null;
}
export function stageLibraryCaptureDrag({controller,event,media,sourceCurrent,timelinePayload=null}){
  if(!controller || event?.defaultPrevented || !event?.dataTransfer?.setData || !Array.isArray(media) || timelinePayload!==null && !opaquePayload(timelinePayload))return null;
  const payload=timelinePayload ?? JSON.stringify({version:1,token:globalThis.crypto?.randomUUID?.() ?? `library:${++serial}:${Math.random().toString(36).slice(2)}`});
  if(!controller.start({payload,media_ids:media.map(item=>item?.id),source:event.currentTarget,sourceCurrent}))return null;
  try{event.dataTransfer.setData(PROJECT_POOL_DRAG_TYPE,payload);return payload;}catch{controller.cancel();return null;}
}
export function createLibraryCaptureDrop({getContext,canCommit,openLibrary,captureSelection,notice=()=>{},documentRef=globalThis.document,windowRef=globalThis.window}){
  let owner=null,disposed=false;
  const bindings=new Map(),listeners=[];
  const listen=(node,type,callback,options)=>{node?.addEventListener?.(type,callback,options);return ()=>node?.removeEventListener?.(type,callback,options);};
  const carries=event=>{try{return Array.from(event.dataTransfer?.types || []).includes(PROJECT_POOL_DRAG_TYPE);}catch{return false;}};
  const modal=()=>Boolean(documentRef?.querySelector?.('dialog[open]'));
  function clearHighlight(){for(const node of bindings.keys())if(node.dataset)delete node.dataset.libraryCaptureDrop;}
  function cancel(){const bound=owner;owner=null;clearHighlight();bound?.controller.abort();}
  function current(bound=owner){
    if(!bound)return false;
    try{
      const context=getContext(),media=new Set(context?.media?.map(item=>item.id));
      const sourceOwned=bound.phase==='capturing' || (bound.phase==='dragging'?visible(bound.source):bound.source.isConnected===true);
      const allowed=!disposed && owner===bound && !bound.controller.signal.aborted && !documentRef?.hidden && !modal() && sourceOwned && identity(context)===bound.identity && bound.ids.every(id=>media.has(id)) && (!bound.target || visible(bound.target));
      // The capture controller owns writer checks while its own command is busy.
      if(allowed && (bound.phase==='capturing' || canCommit()) && bound.sourceCurrent()===true && identity(getContext())===bound.identity)return true;
    }catch{}
    if(owner===bound)cancel();return false;
  }
  function start({payload,media_ids,source,sourceCurrent}){
    if(owner && owner.phase!=='dragging')return false;cancel();
    const context=getContext(),stamp=identity(context);
    if(disposed || !stamp || !canCommit() || documentRef?.hidden || modal() || !visible(source) || !opaquePayload(payload) || typeof sourceCurrent!=='function' || !Array.isArray(media_ids) || !media_ids.length || media_ids.length>256 || media_ids.some(value=>!id(value)) || new Set(media_ids).size!==media_ids.length)return false;
    const bound={payload,ids:[...media_ids],source,sourceCurrent,identity:stamp,phase:'dragging',target:null,controller:new AbortController(),error:media_ids.length>64?'Save up to 64 project media as native assets in one Library drop':null};owner=bound;
    return current(bound);
  }
  function over(event,node){
    if(!carries(event) || !owner || owner.phase!=='dragging' || !bindings.has(node) || !visible(node))return false;
    if(!current())return false;event.preventDefault();event.stopPropagation();clearHighlight();if(node.dataset)node.dataset.libraryCaptureDrop=owner.error?'blocked':'ready';event.dataTransfer.dropEffect=owner.error?'none':'copy';if(owner.error && !owner.notified){owner.notified=true;notice(owner.error);}return true;
  }
  async function drop(event,node){
    if(!carries(event) || !owner || owner.phase!=='dragging' || !bindings.has(node) || !visible(node))return false;
    event.preventDefault();event.stopPropagation();const bound=owner;if(!current(bound))return true;
    let payload;try{payload=event.dataTransfer.getData(PROJECT_POOL_DRAG_TYPE);}catch{cancel();return true;}
    if(payload!==bound.payload){cancel();return true;}
    if(bound.error){const message=bound.error,notified=bound.notified;cancel();if(!notified)notice(message);return true;}
    bound.phase='opening';bound.target=node;clearHighlight();
    try{
      if(!current(bound))return true;
      await openLibrary(()=>current(bound),bound.controller.signal);
      if(!current(bound) || !canCommit())return true;
      bound.phase='capturing';
      await captureSelection([...bound.ids],{isCurrent:()=>current(bound),signal:bound.controller.signal});
    }catch(error){if(owner===bound && !bound.controller.signal.aborted && error.name!=='AbortError')notice(error.message);}
    finally{if(owner===bound)owner=null;clearHighlight();}
    return true;
  }
  function bind(node){
    if(disposed || !node?.addEventListener)return ()=>{};if(bindings.has(node))return bindings.get(node);
    const removers=[listen(node,'dragover',event=>over(event,node)),listen(node,'drop',event=>{void drop(event,node);}),listen(node,'dragleave',event=>{if(!node.contains?.(event.relatedTarget) && node.dataset)delete node.dataset.libraryCaptureDrop;})];
    const remove=()=>{for(const unlisten of removers)unlisten();bindings.delete(node);if(node.dataset)delete node.dataset.libraryCaptureDrop;if(owner?.target===node)cancel();};bindings.set(node,remove);return remove;
  }
  const end=()=>{if(owner?.phase==='dragging')cancel();};
  listeners.push(listen(windowRef,'dragend',end),listen(windowRef,'blur',cancel),listen(windowRef,'keydown',event=>{if(event.key==='Escape' && owner){event.preventDefault();event.stopPropagation();cancel();}}),listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();}));
  return {start,bind,over,drop,current,end,cancel,invalidate(){if(owner)current();},active:()=>Boolean(owner),dispose(){disposed=true;cancel();for(const remove of [...bindings.values()])remove();for(const remove of listeners)remove();}};
}
