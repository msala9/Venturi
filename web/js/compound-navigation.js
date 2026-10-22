import {request} from './api.js';
import {isTextTarget} from './ui.js';

export const MAX_COMPOUND_DEPTH=16;
const validFrame=value=>Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000;
const clips=timeline=>timeline?.tracks.flatMap(track=>track.clips) || [];
export function compoundTarget(state,ids=state?.selection || []){
  if(!state?.document || !state.timeline || !Array.isArray(ids))return null;
  const compounds=clips(state.timeline).filter(clip=>ids.includes(clip.id)).flatMap(clip=>{
    const media=state.document.media.find(item=>item.id===clip.media_id);
    return media?.compound_timeline_id?[{clip,child:media.compound_timeline_id}]:[];
  });
  if(!compounds.length || new Set(compounds.map(item=>item.child)).size!==1)return null;
  return state.document.timelines.some(item=>item.id===compounds[0].child)?{timeline_id:compounds[0].child,clip_ids:compounds.map(item=>item.clip.id)}:null;
}
export function compoundNavigationAction(event,{dialogOpen=false,idle=true,hasAncestors=false}={}){
  const back=event.key==='ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  if(!idle || dialogOpen || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey || isTextTarget(event.target))return back && hasAncestors && !event.defaultPrevented?'reserve_exit':null;
  if(event.key==='Enter' && !event.altKey && !event.target?.closest?.('button,a,[role="button"]'))return 'enter';
  return back?'exit':null;
}
export function createCompoundNavigation({getState,canNavigate=()=>true,install,stop=()=>{},beforeNavigate=()=>{},notice=()=>{},root=null,openButton=null,documentRef=globalThis.document,api=(path,body,options)=>request(path,body,(url,init)=>fetch(url,{...init,signal:AbortSignal.any([init.signal,options.signal])}))}){
  let ancestry=[],epoch=null,pending=null,serial=0,navigationIntent=0,renderKey=null,installing=false;
  const available=state=>Boolean(state?.document && state.timeline && state.timeline.id!=='fixture' && state.document.timelines.includes(state.timeline) && validFrame(state.frame) && Array.isArray(state.selection) && canNavigate());
  const stamp=(state,sourceIds=state.selection)=>JSON.stringify([state.document.project_epoch,state.document.generation,state.timeline.id,state.timeline.revision,state.frame,[...state.selection].sort(),state.viewport,
    clips(state.timeline).filter(clip=>state.selection.includes(clip.id) || sourceIds.includes(clip.id)).map(clip=>[clip,state.document.media.find(item=>item.id===clip.media_id)])]);
  function cancel(){navigationIntent++;if(!pending)return;const old=pending;pending=null;old.controller.abort();renderKey=null;}
  function reconcile(state){
    const next=state?.document?.project_epoch ?? null;
    if(epoch!==next){cancel();ancestry=[];epoch=next;}
    const ids=ancestry.map(item=>item.timeline_id);
    if(new Set(ids).size!==ids.length || ids.includes(state?.timeline?.id) || ids.some(id=>!state?.document?.timelines.some(item=>item.id===id))){cancel();ancestry=[];}
  }
  function current(ticket){
    const state=getState();
    return pending===ticket && available(state) && state.document===ticket.state.document && state.timeline===ticket.state.timeline && stamp(state,ticket.ids)===ticket.stamp;
  }
  function render(){
    if(installing)return;
    const state=getState();reconcile(state);const target=compoundTarget(state),enabled=available(state),parents=ancestry.map(item=>state?.document?.timelines.find(timeline=>timeline.id===item.timeline_id));
    const key=JSON.stringify([parents.map(item=>[item?.id,item?.name]),state?.timeline?.id,state?.timeline?.name,Boolean(pending),enabled,target?.timeline_id,ancestry.length]);
    if(key===renderKey)return;renderKey=key;
    if(openButton)openButton.disabled=!enabled || Boolean(pending) || !target || ancestry.length>=MAX_COMPOUND_DEPTH || target.timeline_id===state.timeline.id || ancestry.some(item=>item.timeline_id===target.timeline_id);
    if(!root)return;
    root.replaceChildren();
    for(const [index,parent] of parents.entries()){
      const button=documentRef.createElement('button');button.type='button';button.textContent=parent.name;button.disabled=!enabled || Boolean(pending);button.addEventListener('click',()=>exit(index));root.append(button);
      const separator=documentRef.createElement('span');separator.textContent=' / ';separator.setAttribute('aria-hidden','true');root.append(separator);
    }
    const label=documentRef.createElement('span');label.textContent=state?.timeline?.name || 'No timeline';label.setAttribute('aria-current','page');root.append(label);
    if(pending){const status=documentRef.createElement('span');status.textContent=' · Opening timeline…';status.setAttribute('role','status');root.append(status);}
  }
  function invalidate(){
    if(installing)return;
    const state=getState();reconcile(state);if(pending && !current(pending))cancel();render();
  }
  async function navigate(action,ids,index){
    cancel();let state=getState();reconcile(state);const intent=navigationIntent;
    if(!available(state)){render();return false;}
    const target=action==='enter'?compoundTarget(state,ids ?? state.selection):null;
    if(action==='enter' && (!target || ancestry.length>=MAX_COMPOUND_DEPTH || target.timeline_id===state.timeline.id || ancestry.some(item=>item.timeline_id===target.timeline_id))){render();return false;}
    if(action==='exit' && (!Number.isInteger(index) || index<0 || index>=ancestry.length)){render();return false;}
    stop();try{const remembered=beforeNavigate();if(remembered?.then)await remembered;}catch(error){notice(error.message);return false;}if(intent!==navigationIntent)return false;state=getState();
    if(!available(state)){render();return false;}
    const selected=action==='enter'?compoundTarget(state,ids ?? state.selection):null;
    if(action==='enter' && (!selected || selected.timeline_id!==target.timeline_id || JSON.stringify(selected.clip_ids)!==JSON.stringify(target.clip_ids))){render();return false;}
    const destination=action==='enter'?target.timeline_id:ancestry[index].timeline_id;
    const query={project_epoch:state.document.project_epoch,if_generation:state.document.generation,timeline_id:state.timeline.id,revision:state.timeline.revision,frame:state.frame,width:320};
    const operation=action==='enter'?{kind:'enter',clip_ids:[...(ids ?? state.selection)]}:{kind:'exit',ancestors:ancestry.slice(index).map(item=>({timeline_id:item.timeline_id,revision:state.document.timelines.find(timeline=>timeline.id===item.timeline_id).revision,clip_id:item.clip_id,entry_playhead:item.entry_playhead}))};
    const sourceIds=[...(ids ?? state.selection)],ticket={serial:++serial,state,ids:sourceIds,stamp:stamp(state,sourceIds),controller:new AbortController()};pending=ticket;render();
    try{
      const value=await api(`/timelines/${encodeURIComponent(state.timeline.id)}/compound-navigation`,{query,action:operation},{signal:ticket.controller.signal});
      if(!current(ticket))return false;
      const now=getState(),timeline=now.document.timelines.find(item=>item.id===destination);
      if(value?.project_epoch!==query.project_epoch || value.generation!==query.if_generation || value.source_timeline_id!==query.timeline_id || value.source_revision!==query.revision || value.source_frame!==query.frame || value.timeline_id!==destination || value.revision!==timeline?.revision || !validFrame(value.frame) || action==='enter' && !selected.clip_ids.includes(value.via_clip_id) || action==='exit' && value.via_clip_id!==null)throw Error('The compound navigation response no longer matches this timeline');
      const viewport=action==='exit'?ancestry[index].viewport:null;
      if(action==='enter')ancestry.push({timeline_id:state.timeline.id,clip_id:value.via_clip_id,entry_playhead:query.frame,viewport:structuredClone(state.viewport || {})});
      else ancestry=ancestry.slice(0,index);
      pending=null;installing=true;try{install(timeline,value.frame,viewport);}finally{installing=false;}renderKey=null;render();return true;
    }catch(error){if(pending===ticket && current(ticket) && error.name!=='AbortError')notice(error.message);return false;}
    finally{if(pending===ticket)pending=null;renderKey=null;render();}
  }
  function exit(index=ancestry.length-1){return navigate('exit',null,index);}
  return {enter:ids=>navigate('enter',ids),exit,invalidate,cancel(){cancel();render();},reset(){cancel();ancestry=[];epoch=getState()?.document?.project_epoch ?? null;renderKey=null;render();},state:()=>({pending:Boolean(pending),ancestors:ancestry.map(item=>({...item,viewport:structuredClone(item.viewport)}))})};
}
