import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCompoundNavigation,compoundTarget,compoundNavigationAction,MAX_COMPOUND_DEPTH} from '../js/compound-navigation.js';

function harness(){
  const timeline=(id,tracks)=>({id,name:`Timeline ${id}`,revision:`${id}-r1`,fps:{num:24,den:1},tracks:[{id:'v',clips:tracks}]});
  const a=timeline('a',[{id:'wrapper',media_id:'mb',kind:'media',start_frame:100,length_frames:50,freeze_source_frame:0},{id:'ordinary',media_id:'file',kind:'media'}]),b=timeline('b',[{id:'nested',media_id:'mc',kind:'media'}]),c=timeline('c',[]);
  let state={document:{project_epoch:'epoch',generation:'0',timelines:[a,b,c],media:[{id:'mb',compound_timeline_id:'b',content_hash:'mb1'},{id:'mc',compound_timeline_id:'c',content_hash:'mc1'},{id:'file',compound_timeline_id:null}]},timeline:a,frame:9999,selection:['wrapper','ordinary'],viewport:{origin:88,scale:240,scrollY:34,selection:['wrapper','ordinary']}};
  let allowed=true,stops=0;const requests=[],installed=[],notices=[];
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.attributes=new Map();this.listeners=new Map();this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(key,value){this.attributes.set(key,value);}addEventListener(key,fn){this.listeners.set(key,fn);}
  }
  const root=new Node('nav'),button=new Node('button'),documentRef={createElement:tag=>new Node(tag)};
  const nav=createCompoundNavigation({getState:()=>state,canNavigate:()=>allowed,stop:()=>stops++,root,openButton:button,documentRef,notice:text=>notices.push(text),install(timeline,frame,viewport){nav.invalidate();installed.push({timeline,frame,viewport:structuredClone(viewport)});state={...state,timeline,frame,selection:viewport?.selection || [],viewport:viewport || {origin:0,scale:240,scrollY:0,selection:[]}};nav.invalidate();},api:(path,body,options)=>new Promise((resolve,reject)=>requests.push({path,body:structuredClone(body),options,resolve,reject}))});
  const reply=(request,patch={})=>{
    const {query,action}=request.body,parent=state.document.timelines.find(item=>item.id===query.timeline_id),clip=parent.tracks.flatMap(track=>track.clips).find(clip=>action.clip_ids?.includes(clip.id) && state.document.media.some(item=>item.id===clip.media_id && item.compound_timeline_id));
    const id=action.kind==='enter'?state.document.media.find(item=>item.id===clip.media_id).compound_timeline_id:action.ancestors[0].timeline_id;
    return {project_epoch:query.project_epoch,generation:query.if_generation,source_timeline_id:query.timeline_id,source_revision:query.revision,source_frame:query.frame,timeline_id:id,revision:state.document.timelines.find(item=>item.id===id).revision,frame:7,via_clip_id:action.kind==='enter'?clip.id:null,...patch};
  };
  nav.invalidate();
  return {nav,requests,installed,notices,root,button,state:()=>state,set:next=>{state=next;},allowed:value=>allowed=value,stops:()=>stops,reply,
    async enter(ids,patch){const pending=nav.enter(ids),request=requests.at(-1);assert(request);request.resolve(reply(request,patch));assert.equal(await pending,true);return request;},
    refresh(revisions={}){const doc=structuredClone(state.document);for(const timeline of doc.timelines)if(revisions[timeline.id])timeline.revision=revisions[timeline.id];state={...state,document:doc,timeline:doc.timelines.find(item=>item.id===state.timeline.id)};nav.invalidate();},
  };
}

test('compound entry sends a readonly native query at the unchanged playhead and ignores ordinary selected clips',async()=>{
  const h=harness();assert.equal(h.button.disabled,false);const request=await h.enter(undefined,{frame:123});
  assert.equal(request.path,'/timelines/a/compound-navigation');assert.deepEqual(request.body,{query:{project_epoch:'epoch',if_generation:'0',timeline_id:'a',revision:'a-r1',frame:9999,width:320},action:{kind:'enter',clip_ids:['wrapper','ordinary']}});
  assert.equal(h.stops(),1);assert.equal(h.installed[0].frame,123);assert.equal(h.state().timeline.id,'b');assert.deepEqual(h.nav.state().ancestors,[{timeline_id:'a',clip_id:'wrapper',entry_playhead:9999,viewport:{origin:88,scale:240,scrollY:34,selection:['wrapper','ordinary']}}]);
  assert.equal(Object.hasOwn(request.body,'command_id'),false);assert.equal(Object.hasOwn(request.body,'client_id'),false);
});

test('return uses Rust frozen-frame mapping and current parent revisions while restoring parent viewport',async()=>{
  const h=harness();await h.enter();h.refresh({a:'a-edited',b:'b-edited'});h.state().frame=5000;
  const pending=h.nav.exit(),request=h.requests.at(-1);assert.deepEqual(request.body.action,{kind:'exit',ancestors:[{timeline_id:'a',revision:'a-edited',clip_id:'wrapper',entry_playhead:9999}]});
  request.resolve(h.reply(request,{frame:149}));assert.equal(await pending,true);assert.equal(h.installed.at(-1).frame,149);assert.deepEqual(h.installed.at(-1).viewport,{origin:88,scale:240,scrollY:34,selection:['wrapper','ordinary']});assert.deepEqual(h.nav.state().ancestors,[]);
});

test('nested breadcrumbs preserve exact parent names and send chosen ancestor through immediate parent in order',async()=>{
  const h=harness();await h.enter();h.state().selection=['nested'];h.state().frame=80;h.nav.invalidate();await h.enter();h.refresh({a:'a2',b:'b2',c:'c2'});
  assert.deepEqual(h.root.children.filter(node=>node.tag==='button').map(node=>node.textContent),['Timeline a','Timeline b']);
  const pending=h.nav.exit(0),request=h.requests.at(-1);assert.deepEqual(request.body.action.ancestors,[{timeline_id:'a',revision:'a2',clip_id:'wrapper',entry_playhead:9999},{timeline_id:'b',revision:'b2',clip_id:'nested',entry_playhead:80}]);
  request.resolve(h.reply(request,{frame:145}));assert.equal(await pending,true);assert.equal(h.state().timeline.id,'a');assert.deepEqual(h.nav.state().ancestors,[]);
});

test('stale async navigation cannot replace a newer frame, selection, viewport, document or source identity',async()=>{
  for(const change of [s=>s.frame++,s=>s.selection.push('new'),s=>s.viewport.scale++,s=>s.document.generation='1',s=>s.document.project_epoch='other',s=>s.timeline.revision='new',s=>s.document.media[0].content_hash='replaced',s=>s.timeline.tracks[0].clips[0].freeze_source_frame=25]){
    const h=harness(),pending=h.nav.enter(),request=h.requests[0],response=h.reply(request);change(h.state());request.resolve(response);assert.equal(await pending,false);assert.equal(h.installed.length,0);assert.equal(h.notices.length,0);
  }
  const h=harness(),pending=h.nav.enter(['wrapper']),request=h.requests[0],response=h.reply(request);h.state().selection=[];h.nav.invalidate();assert.equal(request.options.signal.aborted,true);request.resolve(response);assert.equal(await pending,false);assert.equal(h.installed.length,0);
  const refreshed=harness(),loading=refreshed.nav.enter(),read=refreshed.requests[0],old=refreshed.reply(read);refreshed.refresh();read.resolve(old);assert.equal(await loading,false);assert.equal(refreshed.installed.length,0);
});

test('an unselected double-click source is guarded independently of the existing selection',async()=>{
  const h=harness();h.state().selection=['ordinary'];const pending=h.nav.enter(['wrapper']),request=h.requests[0],response=h.reply(request);h.state().document.media[0].compound_timeline_id='c';request.resolve(response);assert.equal(await pending,false);assert.equal(h.installed.length,0);
});

test('newer navigation, modal or gesture cancellation and late errors never publish or clear a newer owner',async()=>{
  const h=harness(),first=h.nav.enter(),old=h.requests[0],oldReply=h.reply(old),second=h.nav.enter(),fresh=h.requests[1];assert.equal(old.options.signal.aborted,true);old.resolve(oldReply);assert.equal(await first,false);assert.equal(h.nav.state().pending,true);fresh.resolve(h.reply(fresh));assert.equal(await second,true);assert.equal(h.installed.length,1);
  for(const explicit of [false,true]){const h=harness(),pending=h.nav.enter(),request=h.requests[0];if(explicit)h.nav.cancel();else{h.allowed(false);h.nav.invalidate();}assert.equal(request.options.signal.aborted,true);request.reject(Error('Late error'));assert.equal(await pending,false);assert.equal(h.installed.length,0);assert.equal(h.notices.length,0);}
});

test('response source identity, destination, revision and frame must match the current native snapshot',async()=>{
  for(const patch of [{project_epoch:'other'},{generation:'other'},{source_timeline_id:'other'},{source_revision:'other'},{source_frame:0},{timeline_id:'c'},{revision:'other'},{frame:-1},{frame:1.5},{frame:1_000_000_001},{via_clip_id:'ordinary'}]){
    const h=harness(),pending=h.nav.enter(),request=h.requests[0];request.resolve(h.reply(request,patch));assert.equal(await pending,false);assert.equal(h.installed.length,0);assert.equal(h.notices.length,1);assert.equal(h.nav.state().pending,false);assert.equal(h.nav.state().ancestors.length,0);
  }
});

test('compound navigation is available in a read-only project but refuses invalid frames, ordinary selection and mixed children',async()=>{
  const h=harness();assert.equal(compoundTarget(h.state()).timeline_id,'b');assert.equal(await h.nav.exit(),false);assert.equal(h.requests.length,0);
  h.state().selection=['ordinary'];h.nav.invalidate();assert.equal(h.button.disabled,true);assert.equal(await h.nav.enter(),false);
  h.state().timeline.tracks[0].clips.push({id:'different',media_id:'mc'});h.state().selection=['wrapper','different'];assert.equal(compoundTarget(h.state()),null);assert.equal(await h.nav.enter(),false);
  h.state().selection=['wrapper'];for(const frame of [-1,1.5,1_000_000_001]){h.state().frame=frame;assert.equal(await h.nav.enter(),false);}assert.equal(h.requests.length,0);
});

test('ancestry survives edits and deleted wrapper clips, but resets for missing parents, project changes and direct opening',async()=>{
  for(const change of ['wrapper','parent','epoch','root']){
    const h=harness();await h.enter();if(change==='wrapper'){h.state().document.timelines[0].tracks[0].clips=[];h.nav.invalidate();assert.equal(h.nav.state().ancestors.length,1);const pending=h.nav.exit(),request=h.requests.at(-1);request.resolve(h.reply(request,{frame:9999}));assert.equal(await pending,true);assert.equal(h.state().frame,9999);}
    else{if(change==='parent')h.state().document.timelines=h.state().document.timelines.filter(item=>item.id!=='a');if(change==='epoch')h.state().document.project_epoch='other';if(change==='root')h.nav.reset();h.nav.invalidate();assert.deepEqual(h.nav.state().ancestors,[]);}
  }
});

test('cycles and native depth limit refuse navigation without issuing a request',async()=>{
  const h=harness();await h.enter();h.state().document.media[1].compound_timeline_id='a';h.state().selection=['nested'];assert.equal(await h.nav.enter(),false);assert.equal(h.requests.length,1);
  h.nav.reset();const doc=h.state().document;doc.timelines=[];doc.media=[];
  for(let n=0;n<MAX_COMPOUND_DEPTH+2;n++){doc.timelines.push({id:`t${n}`,name:`Level ${n}`,revision:'r',tracks:[{clips:[{id:`c${n}`,media_id:`m${n}`}]}]});doc.media.push({id:`m${n}`,compound_timeline_id:`t${n+1}`});}
  h.state().timeline=doc.timelines[0];h.state().selection=['c0'];h.nav.invalidate();
  for(let n=0;n<MAX_COMPOUND_DEPTH;n++){h.state().selection=[`c${n}`];await h.enter();}
  h.state().selection=[`c${MAX_COMPOUND_DEPTH}`];const count=h.requests.length;assert.equal(await h.nav.enter(),false);assert.equal(h.requests.length,count);assert.equal(h.nav.state().ancestors.length,MAX_COMPOUND_DEPTH);
});

test('compound shortcuts exclude modal, text, buttons, composition, repeat, modifiers and active editing gestures',()=>{
  const enter={key:'Enter'},back={key:'ArrowLeft',altKey:true};assert.equal(compoundNavigationAction(enter),'enter');assert.equal(compoundNavigationAction(back),'exit');
  for(const patch of [{defaultPrevented:true},{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true},{shiftKey:true},{target:{closest:()=>({})}}]){assert.equal(compoundNavigationAction({...enter,...patch}),null);assert.equal(compoundNavigationAction({...back,...patch}),null);}
  assert.equal(compoundNavigationAction(enter,{dialogOpen:true}),null);assert.equal(compoundNavigationAction(back,{idle:false}),null);assert.equal(compoundNavigationAction({...enter,altKey:true}),null);assert.equal(compoundNavigationAction({key:'ArrowRight',altKey:true}),null);
  const button={closest:selector=>selector==='button,a,[role="button"]'?{}:null};assert.equal(compoundNavigationAction({...back,target:button}),'exit');assert.equal(compoundNavigationAction({...enter,target:button}),null);
  for(const options of [{dialogOpen:true},{idle:false}])assert.equal(compoundNavigationAction({...back,target:button},{...options,hasAncestors:true}),'reserve_exit');
});

test('late replies reconcile project changes even when no explicit invalidate occurred',async()=>{
  const h=harness();await h.enter();h.state().selection=['nested'];const pending=h.nav.enter(),request=h.requests.at(-1),response=h.reply(request);h.state().document.project_epoch='new';h.state().document.timelines=[h.state().timeline];request.resolve(response);assert.equal(await pending,false);assert.equal(h.nav.state().ancestors.length,0);assert.equal(h.root.children.some(node=>node.tag==='button'),false);assert.equal(h.installed.length,1);
});
