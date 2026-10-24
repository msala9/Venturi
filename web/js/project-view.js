import {request} from './api.js';

const MAX_FRAME=1_000_000_000,MAX_TIMELINES=64,MAX_OWN_REVISIONS=128;
const id=value=>typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<=18_446_744_073_709_551_615n;
const frame=value=>Number.isSafeInteger(value) && value>=0 && value<=MAX_FRAME;
const revision=value=>typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
const end=timeline=>{let result=0;for(const track of timeline.tracks)for(const clip of track.clips)result=Math.max(result,clip.start_frame+clip.length_frames);return result;};
const clamp=(timeline,value)=>Math.max(0,Math.min(end(timeline),value));
const restoreFrame=(timeline,value)=>Math.min(clamp(timeline,value),Math.max(0,end(timeline)-1));
const defaultApi=(path,body,{signal})=>request(path,body,(url,init)=>fetch(url,{...init,keepalive:body.persist===true,signal:AbortSignal.any([init.signal,signal])}));

export function nativeProjectView(value,document){
  if(!value || !document || !Array.isArray(document.timelines) || document.timelines.length>MAX_TIMELINES || typeof value.playheads!=='object' || value.playheads===null || Array.isArray(value.playheads) || Object.keys(value.playheads).length>MAX_TIMELINES || value.active_timeline!==null && !id(value.active_timeline))throw Error('The native project view is invalid');
  const timelines=new Map(document.timelines.map(timeline=>[timeline.id,timeline]));
  if(value.active_timeline!==null && !timelines.has(value.active_timeline))throw Error('The remembered timeline no longer exists');
  const playheads={};
  for(const [key,position] of Object.entries(value.playheads)){
    if(!id(key) || !timelines.has(key) || !frame(position))throw Error('The native remembered playhead is invalid');
    playheads[key]=clamp(timelines.get(key),position);
  }
  return {active_timeline:value.active_timeline,playheads};
}

export function createProjectView({getState,onView=()=>{},notice=()=>{},api=defaultApi}){
  let epoch=null,documentRef=null,observedRevision=null,viewRevision=null,active=null,serverRoot=null,sequence=0,running=false,disposed=false,blocked=false,inflight=null;
  const memory=new Map(),latest=new Map(),acknowledged=new Map(),queue=new Map();
  // Session snapshots can finish after a successful view write. Their known
  // predecessor tokens must not rewind our CAS; the server still guards every
  // write, and a conflict requires a fresh snapshot before another user intent.
  const ownPredecessors=new Set();
  function cancelQueued(){for(const ticket of queue.values())ticket.resolve(false);queue.clear();if(inflight){inflight.canceled=true;inflight.controller?.abort();inflight.resolve(false);}}
  function reset(){cancelQueued();epoch=null;documentRef=null;observedRevision=viewRevision=null;active=serverRoot=null;sequence=0;memory.clear();latest.clear();acknowledged.clear();ownPredecessors.clear();blocked=false;}
  function refresh(){
    if(disposed)return false;
    const state=getState(),document=state?.document;if(!document)return false;
    if(epoch!==document.project_epoch){
      reset();epoch=document.project_epoch;
      const view=nativeProjectView(document.view || {active_timeline:null,playheads:{}},document);
      active=serverRoot=view.active_timeline;for(const [key,value] of Object.entries(view.playheads))memory.set(key,restoreFrame(document.timelines.find(timeline=>timeline.id===key),value));
      viewRevision=document.view_revision;observedRevision=document.view_revision;
    }else if(document!==documentRef){
      if(blocked || document.view_revision!==observedRevision && !ownPredecessors.has(document.view_revision)){
        if(document.view_revision!==viewRevision){acknowledged.clear();serverRoot=nativeProjectView(document.view,document).active_timeline;ownPredecessors.clear();}
        viewRevision=document.view_revision;
      }
      observedRevision=document.view_revision;
      blocked=false;
    }
    documentRef=document;
    const timelines=new Map(document.timelines.map(timeline=>[timeline.id,timeline]));
    for(const [key,value] of memory){if(timelines.has(key))memory.set(key,clamp(timelines.get(key),value));else{memory.delete(key);latest.delete(key);acknowledged.delete(key);}}
    if(active!==null && !timelines.has(active))active=null;
    return true;
  }
  function capture(persist){
    if(!refresh())return null;
    const state=getState(),document=state.document,timeline=state.timeline,ancestors=state.ancestors || [];
    if(state.stopped!==true || !timeline || !id(timeline.id) || !document.timelines.some(item=>item.id===timeline.id && item.revision===timeline.revision) || !frame(state.frame) || typeof document.generation!=='string' || !revision(viewRevision) || !Array.isArray(ancestors) || ancestors.length>16)return null;
    const seen=new Set([timeline.id]),parents=[];
    for(const parent of ancestors){
      if(!id(parent.timeline_id) || seen.has(parent.timeline_id) || !document.timelines.some(item=>item.id===parent.timeline_id && item.revision===parent.revision) || parent.clip_id!==null && !id(parent.clip_id) || !frame(parent.entry_playhead))return null;
      seen.add(parent.timeline_id);parents.push({timeline_id:parent.timeline_id,revision:parent.revision,clip_id:parent.clip_id,entry_playhead:parent.entry_playhead});
    }
    const root=parents[0]?.timeline_id || timeline.id,writable=state.writable===true;
    if(writable && (typeof state.client_id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(state.client_id)))return null;
    const query={project_epoch:document.project_epoch,if_generation:document.generation,timeline_id:timeline.id,revision:timeline.revision,frame:state.frame,width:16};
    const signature=JSON.stringify([query,parents,writable,Boolean(document.unsaved),document.project_name]);
    const ticket={root,query,ancestors:parents,writable,client_id:state.client_id,persist:Boolean(persist),signature,sequence:++sequence,canceled:false,document:{timelines:document.timelines},displayDocument:document};
    latest.set(root,ticket.sequence);active=root;if(!parents.length)memory.set(root,clamp(timeline,state.frame));
    return ticket;
  }
  function current(ticket){
    if(disposed || ticket.canceled || epoch!==ticket.query.project_epoch)return false;
    const state=getState(),document=state?.document;
    return document?.project_epoch===ticket.query.project_epoch && document.generation===ticket.query.if_generation && state.stopped===true && (state.writable===true)===ticket.writable && state.client_id===ticket.client_id && document.timelines.some(timeline=>timeline.id===ticket.query.timeline_id && timeline.revision===ticket.query.revision) && ticket.ancestors.every(parent=>document.timelines.some(timeline=>timeline.id===parent.timeline_id && timeline.revision===parent.revision));
  }
  async function drain(){
    if(running || disposed)return;running=true;
    try{while(queue.size){
      const [key,ticket]=queue.entries().next().value;queue.delete(key);
      if(blocked || !current(ticket)){ticket.resolve(false);continue;}
      inflight=ticket;ticket.controller=new AbortController();
      try{
        let position=memory.get(ticket.root) || 0,persisted=false;
        if(ticket.writable){
          ticket.baseRevision=viewRevision;
          const value=await api('/projects/view',{client_id:ticket.client_id,query:ticket.query,if_view_revision:viewRevision,ancestors:ticket.ancestors,persist:ticket.persist},{signal:ticket.controller.signal});
          if(disposed || ticket.canceled || epoch!==ticket.query.project_epoch || getState()?.document?.project_epoch!==ticket.query.project_epoch){ticket.resolve(false);continue;}
          const view=nativeProjectView(value?.view,ticket.document);
          if(value.project_epoch!==ticket.query.project_epoch || value.generation!==ticket.query.if_generation || !revision(value.view_revision) || view.active_timeline!==ticket.root || !Object.hasOwn(view.playheads,ticket.root) || !['changed','persisted','saved'].every(key=>typeof value[key]==='boolean') || value.saved && !ticket.persist)throw Error('The remembered project view response no longer matches this request');
          refresh();
          if(viewRevision!==ticket.baseRevision && viewRevision!==value.view_revision){ticket.resolve(false);continue;}
          if(viewRevision!==value.view_revision){ownPredecessors.add(viewRevision);if(ownPredecessors.size>MAX_OWN_REVISIONS)ownPredecessors.delete(ownPredecessors.values().next().value);}
          viewRevision=value.view_revision;serverRoot=view.active_timeline;position=view.playheads[ticket.root];persisted=value.persisted;
          // Playback or a project edit may supersede the visible position while
          // the native write succeeds. Retain its CAS, but never publish its old
          // view/generation into the current display or acknowledge that intent.
          if(!current(ticket) || getState().document!==ticket.displayDocument){ticket.resolve(false);continue;}
          try{onView(value);}catch{notice('The project view was remembered, but its display could not refresh');}
          if(value.persistence_notice)notice(value.persistence_notice);
        }else if(ticket.ancestors.length){
          const value=await api(`/timelines/${encodeURIComponent(ticket.query.timeline_id)}/compound-navigation`,{query:ticket.query,action:{kind:'exit',ancestors:ticket.ancestors}},{signal:ticket.controller.signal});
          if(!current(ticket)){ticket.resolve(false);continue;}
          if(value?.project_epoch!==ticket.query.project_epoch || value.generation!==ticket.query.if_generation || value.source_timeline_id!==ticket.query.timeline_id || value.source_revision!==ticket.query.revision || value.source_frame!==ticket.query.frame || value.timeline_id!==ticket.root || value.revision!==ticket.ancestors[0].revision || !frame(value.frame))throw Error('The remembered compound position no longer matches its root timeline');
          position=clamp(getState().document.timelines.find(item=>item.id===ticket.root),value.frame);
        }
        if(latest.get(ticket.root)===ticket.sequence)memory.set(ticket.root,position);
        acknowledged.set(ticket.root,{signature:ticket.signature,persisted});ticket.resolve(true);
      }catch(error){
        if(current(ticket)){blocked=true;cancelQueued();notice(error.message);}
        ticket.resolve(false);
      }finally{if(inflight===ticket)inflight=null;}
    }}finally{running=false;}
  }
  function update({persist=false}={}){
    if(disposed)return Promise.resolve(false);
    let ticket;try{ticket=capture(persist);}catch(error){notice(error.message);return Promise.resolve(false);}
    if(!ticket || blocked)return Promise.resolve(false);
    if(inflight && current(inflight) && inflight.signature===ticket.signature && (!ticket.persist || inflight.persist)){
      const obsolete=queue.get(ticket.root);if(obsolete){queue.delete(ticket.root);obsolete.resolve(false);}
      latest.set(ticket.root,inflight.sequence);return inflight.promise;
    }
    const previous=acknowledged.get(ticket.root),state=getState();
    if((!inflight || inflight.root!==ticket.root) && (!ticket.writable || serverRoot===ticket.root) && previous?.signature===ticket.signature && (!ticket.persist || previous.persisted || state.document.unsaved || !state.document.project_name)){
      const obsolete=queue.get(ticket.root);if(obsolete){queue.delete(ticket.root);obsolete.resolve(false);}
      return Promise.resolve(true);
    }
    ticket.promise=new Promise(resolve=>ticket.resolve=resolve);const old=queue.get(ticket.root);
    if(old){ticket.persist ||= old.persist;old.resolve(false);}
    if(!old && queue.size>=MAX_TIMELINES){ticket.resolve(false);return ticket.promise;}
    queue.set(ticket.root,ticket);queueMicrotask(drain);return ticket.promise;
  }
  return {refresh,update,flush:update,
    activeTimeline(){return refresh()?active:null;},
    frame(timelineId){return refresh()?memory.get(timelineId) || 0:0;},
    reset,
    dispose(){if(disposed)return;reset();disposed=true;},
  };
}
