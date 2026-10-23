import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryCaptureDrop,stageLibraryCaptureDrag} from '../js/library-capture-drop.js';
import {PROJECT_POOL_DRAG_TYPE,createProjectPoolDrop,projectPoolItems} from '../js/project-pool-placement.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const payload=token=>JSON.stringify({version:1,token});
class Node extends EventTarget{
  constructor(){super();this.isConnected=true;this.hidden=false;this.shown=true;this.dataset={};}
  getClientRects(){return this.shown?[{}]:[];}
  contains(node){return node===this;}
}
function harness(options={}){
  const tab=new Node(),panel=new Node(),source=new Node(),documentRef=new EventTarget(),windowRef=new EventTarget(),opened=[],captured=[],notices=[];let allowed=true,sourceValid=true,modal=false;
  let context={project_epoch:'epoch',generation:'7',command_epoch:'commands',timeline_id:'1',timeline_revision:'r',project_name:'Project.vvproj',media:Array.from({length:256},(_,i)=>({id:String(i)}))};documentRef.querySelector=()=>modal?{}:null;
  const controller=createLibraryCaptureDrop({getContext:()=>context,canCommit:()=>allowed,documentRef,windowRef,notice:message=>notices.push(message),openLibrary:async(current,signal)=>{opened.push({current,signal});source.shown=false;await options.open?.(current,signal);},captureSelection:async(ids,owner)=>{captured.push({ids,owner});await options.capture?.(ids,owner);}});
  controller.bind(tab);controller.bind(panel);const start=(ids=['2','1'],value=payload('local-token'))=>controller.start({payload:value,media_ids:ids,source,sourceCurrent:()=>sourceValid});
  const event=(value=payload('local-token'),types=[PROJECT_POOL_DRAG_TYPE])=>({dataTransfer:{types,getData:()=>value,dropEffect:'none'},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});
  return {tab,panel,source,documentRef,windowRef,controller,opened,captured,notices,start,event,context:()=>context,setContext:value=>{context=value;},setAllowed:value=>{allowed=value;},setSourceValid:value=>{sourceValid=value;},setModal:value=>{modal=value;},dispose:()=>controller.dispose()};
}

test('project media Library drop consumes the existing opaque witness once, preserves order and never captures on hover',async()=>{
  const h=harness();try{
    assert.equal(h.start(),true);const hover=h.event();assert.equal(h.controller.over(hover,h.tab),true);assert.equal(hover.prevented,true);assert.equal(hover.dataTransfer.dropEffect,'copy');assert.equal(h.tab.dataset.libraryCaptureDrop,'ready');assert.deepEqual(h.opened,[]);assert.deepEqual(h.captured,[]);
    const released=h.event();await h.controller.drop(released,h.tab);assert.equal(released.stopped,true);assert.equal(h.opened.length,1);assert.equal(h.captured.length,1);assert.deepEqual(h.captured[0].ids,['2','1']);assert.equal(h.captured[0].owner.isCurrent(),false,'The local token is consumed after completion');
    await h.controller.drop(h.event(),h.panel);assert.equal(h.captured.length,1);assert.equal(h.controller.active(),false);assert.equal(h.tab.dataset.libraryCaptureDrop,undefined);
    assert.equal(h.start(['3']),false,'A hidden project row cannot start a new gesture');
  }finally{h.dispose();}
});

test('Library targets are bound while hidden and checked when used; source hiding and refresh detachment after release do not cancel capture',async()=>{
  const capture=deferred();const h=harness({capture:async(_ids,owner)=>{h.source.isConnected=false;h.setAllowed(false);assert.equal(owner.isCurrent(),true,'The native capture command can own busy while refreshing its source DOM');await capture.promise;}});try{
    h.tab.shown=false;assert.equal(h.start(),true);assert.equal(h.controller.over(h.event(),h.tab),false);assert.equal(await h.controller.drop(h.event(),h.tab),false);assert.equal(h.captured.length,0);
    h.tab.shown=true;const dropping=h.controller.drop(h.event(),h.tab);await Promise.resolve();await Promise.resolve();assert.equal(h.captured.length,1);h.controller.end();h.windowRef.dispatchEvent(new Event('dragend'));assert.equal(h.captured[0].owner.isCurrent(),true);capture.resolve();await dropping;assert.equal(h.controller.active(),false);
  }finally{capture.resolve();h.dispose();}
});

test('Library drop refuses foreign payloads, duplicate IDs, malformed context and the explicit64 limit without partial capture',async()=>{
  const h=harness();try{
    for(const ids of [[],['1','1'],['01'],['18446744073709551616']])assert.equal(h.start(ids),false);
    assert.equal(h.start(['1'],'{"version":1,"token":"x","media_ids":["1"]}'),false);
    assert.equal(h.start(),true);await h.controller.drop(h.event(payload('foreign')),h.tab);assert.deepEqual(h.opened,[]);assert.deepEqual(h.captured,[]);
    assert.equal(h.start(Array.from({length:65},(_,i)=>String(i))),true);const hover=h.event();h.controller.over(hover,h.panel);assert.equal(hover.dataTransfer.dropEffect,'none');assert.match(h.notices.at(-1),/up to 64/);h.controller.over(h.event(),h.panel);await h.controller.drop(h.event(),h.panel);assert.equal(h.notices.length,1);assert.deepEqual(h.captured,[]);assert.deepEqual(h.opened,[]);
    const before=h.context();h.setContext({...before,command_epoch:''});assert.equal(h.start(),false);h.setContext({...before,timeline_id:'01'});assert.equal(h.start(),false);h.setContext(before);
    const maximum=Array.from({length:64},(_,i)=>String(i));assert.equal(h.start(maximum),true);await h.controller.drop(h.event(),h.tab);assert.equal(h.captured.length,1);assert.deepEqual(h.captured[0].ids,maximum);
  }finally{h.dispose();}
});

test('changed native context, selection, writer, modal, hidden or detached targets invalidate Library capture before any write',async t=>{
  const changes={epoch:h=>h.setContext({...h.context(),project_epoch:'other'}),generation:h=>h.setContext({...h.context(),generation:'8'}),commands:h=>h.setContext({...h.context(),command_epoch:'other'}),timeline:h=>h.setContext({...h.context(),timeline_id:'2'}),revision:h=>h.setContext({...h.context(),timeline_revision:'new'}),missing:h=>h.setContext({...h.context(),media:[]}),selection:h=>h.setSourceValid(false),writer:h=>h.setAllowed(false),modal:h=>h.setModal(true),hidden:h=>{h.documentRef.hidden=true;},source:h=>{h.source.isConnected=false;},sourcehidden:h=>{h.source.shown=false;},target:h=>{h.tab.isConnected=false;}};
  for(const [name,change] of Object.entries(changes))await t.test(name,async()=>{const h=harness();try{assert.equal(h.start(),true);change(h);await h.controller.drop(h.event(),h.tab);assert.deepEqual(h.captured,[]);assert.deepEqual(h.opened,[]);}finally{h.dispose();}});
});

test('late Library opening rechecks the owner and Escape, blur, visibility or dispose abort preparation without a new capture',async t=>{
  for(const reason of ['context','selection','escape','blur','hidden','dispose'])await t.test(reason,async()=>{
    const gate=deferred(),h=harness({open:()=>gate.promise});try{
      h.start();const dropping=h.controller.drop(h.event(),h.tab);assert.equal(h.opened.length,1);
      if(reason==='context')h.setContext({...h.context(),generation:'8'});if(reason==='selection')h.setSourceValid(false);if(reason==='escape'){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});h.windowRef.dispatchEvent(event);}if(reason==='blur')h.windowRef.dispatchEvent(new Event('blur'));if(reason==='hidden'){h.documentRef.hidden=true;h.documentRef.dispatchEvent(new Event('visibilitychange'));}if(reason==='dispose')h.dispose();
      gate.resolve();await dropping;assert.deepEqual(h.captured,[]);assert.equal(h.opened[0].signal.aborted,true);
    }finally{gate.resolve();h.dispose();}
  });
});

test('accepted Library capture keeps a live cancellation signal and refuses a second drag until it settles',async()=>{
  const gate=deferred(),h=harness({capture:()=>gate.promise});try{
    h.start();const dropping=h.controller.drop(h.event(),h.panel);await Promise.resolve();await Promise.resolve();assert.equal(h.captured.length,1);assert.equal(h.start(['3']),false);h.controller.end();assert.equal(h.captured[0].owner.isCurrent(),true);
    h.setContext({...h.context(),generation:'8'});h.controller.invalidate();assert.equal(h.captured[0].owner.signal.aborted,true);assert.equal(h.captured[0].owner.isCurrent(),false);gate.resolve();await dropping;assert.equal(h.captured.length,1);assert.deepEqual(h.notices,[]);
  }finally{gate.resolve();h.dispose();}
});

test('Library staging works when actual timeline drag admission rejects a zero-width or hidden canvas',async()=>{
  for(const rect of [{left:0,top:0,width:0,height:300},{left:0,top:0,width:0,height:0}]){
    const h=harness(),tl={id:'1',revision:'r',fps:{num:24,den:1},tracks:[]},media=[{id:'2',name:'Original',content_hash:'12',fps:{num:24,den:1},duration_frames:48,has_video:true,has_audio:false,audio_stream_count:0}],view={scale:100,origin:0,playhead:0,selection:[]};
    const canvas={ownerDocument:h.documentRef,getBoundingClientRect:()=>rect},timelineDrop=createProjectPoolDrop({canvas,getTimeline:()=>tl,getAssetContext:()=>({epoch:'epoch',generation:'7',timeline:'1',revision:'r'}),view,invalidate(){},canEdit:()=>true,cancelGesture(){}});
    try{
      const items=projectPoolItems(h.context(),media);assert.ok(items);const timelinePayload=timelineDrop.dnd.start(items,()=>true,assert.fail);assert.equal(timelinePayload,null,'The existing native timeline geometry guard remains strict');
      const values=new Map(),event={currentTarget:h.source,dataTransfer:{setData:(type,value)=>values.set(type,value)}};
      const staged=stageLibraryCaptureDrag({controller:h.controller,event,media,sourceCurrent:()=>true,timelinePayload});assert.ok(staged);assert.equal(values.get(PROJECT_POOL_DRAG_TYPE),staged);assert.deepEqual(Object.keys(JSON.parse(staged)).sort(),['token','version']);
      assert.deepEqual(h.captured,[]);h.controller.over(h.event(staged),h.tab);assert.deepEqual(h.opened,[]);await h.controller.drop(h.event(staged),h.tab);assert.deepEqual(h.captured.map(value=>value.ids),[['2']]);assert.equal(timelineDrop.active(),false);
    }finally{timelineDrop.destroy();h.dispose();}
  }
});

test('Library staging does not require timeline media metadata, reuses an admitted opaque token and retains native source ownership',async()=>{
  const h=harness();try{
    const media=[{id:'2',name:'Current original'}];assert.equal(projectPoolItems(h.context(),media),null);
    const values=new Map(),event={currentTarget:h.source,dataTransfer:{setData:(type,value)=>values.set(type,value)}};let selected=media;
    const staged=stageLibraryCaptureDrag({controller:h.controller,event,media,sourceCurrent:()=>selected===media});assert.ok(staged);selected=[];await h.controller.drop(h.event(staged),h.tab);assert.deepEqual(h.captured,[]);
    selected=media;const admitted=payload('timeline-token'),reused=stageLibraryCaptureDrag({controller:h.controller,event,media,sourceCurrent:()=>selected===media,timelinePayload:admitted});assert.equal(reused,admitted);await h.controller.drop(h.event(reused),h.tab);assert.deepEqual(h.captured.map(value=>value.ids),[['2']]);
  }finally{h.dispose();}
});

test('Library fallback staging refuses foreign IDs, malformed existing tokens and a failed transfer without retaining an owner',()=>{
  const h=harness();try{
    const event={currentTarget:h.source,dataTransfer:{setData(){}}};
    assert.equal(stageLibraryCaptureDrag({controller:h.controller,event,media:[{id:'999'}],sourceCurrent:()=>true}),null);assert.equal(h.controller.active(),false);
    assert.equal(stageLibraryCaptureDrag({controller:h.controller,event,media:[{id:'1'}],sourceCurrent:()=>true,timelinePayload:'{"media_ids":["1"]}'}),null);
    assert.equal(stageLibraryCaptureDrag({controller:h.controller,event:{...event,defaultPrevented:true},media:[{id:'1'}],sourceCurrent:()=>true}),null);
    const broken={...event,dataTransfer:{setData(){throw Error('Drag transfer closed');}}};assert.equal(stageLibraryCaptureDrag({controller:h.controller,event:broken,media:[{id:'1'}],sourceCurrent:()=>true}),null);assert.equal(h.controller.active(),false);assert.deepEqual(h.captured,[]);
  }finally{h.dispose();}
});
