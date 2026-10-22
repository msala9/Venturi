import test from 'node:test';
import assert from 'node:assert/strict';
import {videoPropertySelection,renderBlendMatte,propertyOperation} from '../js/inspector.js';

const snapshot=()=>({project_epoch:'epoch-1',generation:'7',timeline:{id:'timeline-1',revision:'revision-3',tracks:[
  {id:'audio',kind:'audio',locked:false,clips:[{id:'audio-1',linked_group:'av'}]},
  {id:'video',kind:'video',locked:false,clips:[{id:'9007199254740995',start_frame:0,kind:'text',linked_group:'av'},{id:'9007199254740993',start_frame:20,kind:'solid'},{id:'9007199254740994',start_frame:40,kind:'adjustment'},{id:'unselected',start_frame:60,kind:'media',linked_group:'av'}]},
  {id:'locked',kind:'video',locked:true,clips:[{id:'locked-video',kind:'media',linked_group:'av'}]},
]},selection:['audio-1','9007199254740995','locked-video','9007199254740993','9007199254740994']});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

function harness(t,{commit}={}){
  const priorDocument=globalThis.document,priorOption=globalThis.Option,commands=[],notices=[];
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.disabled=false;this.value='';this.isConnected=true;}
    append(...items){this.children.push(...items);}
    setAttribute(name,value){this[name]=String(value);}
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.after(()=>{globalThis.document=priorDocument;globalThis.Option=priorOption;});
  const state=snapshot(),root=new Element('div'),selection=videoPropertySelection(state);
  const detail={clip_id:selection.clip_ids[0],video:true,locked:false,blend:'Multiply',blends:['Normal','Multiply','Screen'],matte:'AlphaInverted',mattes:['None','Alpha','AlphaInverted','Luma','LumaInverted']};
  let allowed=true;
  renderBlendMatte(root,detail,{selection,getSelection:()=>videoPropertySelection(state),canInteract:()=>allowed,primaryName:'Selected solid',notice:message=>notices.push(message),commit:operation=>{commands.push(operation);return commit?.(operation);}});
  const fields=Object.fromEntries(root.children[0].children.filter(node=>node.tagName==='label').map(node=>[node.textContent,node.children[0]]));
  return {state,root,detail,selection,fields,commands,notices,block(){allowed=false;},allow(){allowed=true;},change(label,value){fields[label].value=value;fields[label].dispatchEvent(new Event('change'));}};
}

test('compositing targets every selected unlocked video kind, excludes audio and linked/unselected peers, and retains native ID precision',()=>{
  const state=snapshot(),before=structuredClone(state),selection=videoPropertySelection(state);
  assert.deepEqual(selection.clip_ids,['9007199254740995','9007199254740993','9007199254740994']);
  assert.deepEqual(state,before);
  assert.equal(selection.timeline_id,'timeline-1');assert.equal(selection.revision,'revision-3');
  assert.ok(selection.selection.includes('audio-1') && selection.selection.includes('locked-video'));
  assert.ok(!selection.clip_ids.includes('unselected'));
});

test('native panel chronology chooses id9 at frame0 before id2 at frame48, with track order before chronology',()=>{
  const state=snapshot();state.timeline.tracks=[
    {id:'v1',kind:'video',locked:false,clips:[{id:'2',start_frame:48},{id:'9',start_frame:0}]},
    {id:'v2',kind:'video',locked:false,clips:[{id:'1',start_frame:0}]},
  ];state.selection=['2','1','9'];
  assert.deepEqual(videoPropertySelection(state).clip_ids,['9','2','1']);
});

test('equal-start panel targets retain native ClipKey ordering and opaque fixture IDs stay stable',()=>{
  const state=snapshot();state.timeline.tracks=[{id:'v',kind:'video',locked:false,clips:[{id:'9',start_frame:0},{id:'2',start_frame:0}]}];state.selection=['9','2'];
  assert.deepEqual(videoPropertySelection(state).clip_ids,['2','9']);
  state.timeline.tracks[0].clips=[{id:'clip-b',start_frame:0},{id:'clip-a',start_frame:0}];state.selection=['clip-a','clip-b'];
  assert.deepEqual(videoPropertySelection(state).clip_ids,['clip-b','clip-a']);
});

test('500 selected video clips remain one complete batch rather than a 256-target subset',()=>{
  const state=snapshot(),clips=Array.from({length:500},(_,index)=>({id:String(index+1),start_frame:index,kind:index%2?'solid':'text'}));
  state.timeline.tracks=[{id:'v',kind:'video',locked:false,clips}];state.selection=clips.map(clip=>clip.id);
  const selected=videoPropertySelection(state);assert.equal(selected.clip_ids.length,500);assert.deepEqual(selected.clip_ids,state.selection);
  state.timeline.tracks[0].clips=Array.from({length:4097},(_,index)=>({id:String(index+1),start_frame:index}));state.selection=state.timeline.tracks[0].clips.map(clip=>clip.id);
  assert.equal(videoPropertySelection(state),null);
});

test('audio-only, locked-only, empty and stale/malformed selections cannot target an unrelated video',()=>{
  for(const selection of [[],['audio-1'],['locked-video'],['missing'],['audio-1','missing'],['9007199254740993','9007199254740993']])assert.equal(videoPropertySelection({...snapshot(),selection}),null);
  assert.equal(videoPropertySelection({...snapshot(),project_epoch:null}),null);
  assert.equal(videoPropertySelection({...snapshot(),generation:null}),null);
  assert.equal(videoPropertySelection(),null);
});

test('selection identity includes all selected peers and session context, and is insensitive to set ordering',()=>{
  const state=snapshot(),before=videoPropertySelection(state);
  assert.deepEqual(videoPropertySelection({...state,selection:[...state.selection].reverse()}),before);
  for(const key of ['project_epoch','generation'])assert.notDeepEqual(videoPropertySelection({...state,[key]:'new'}),before);
  for(const key of ['id','revision'])assert.notDeepEqual(videoPropertySelection({...state,timeline:{...state.timeline,[key]:'new'}}),before);
  assert.notDeepEqual(videoPropertySelection({...state,selection:state.selection.filter(id=>id!=='audio-1')}),before);
});

test('one Blend change sends one native batch for the captured video selection and disables duplicate changes',async t=>{
  let resolve;const gate=new Promise(done=>{resolve=done;});const h=harness(t,{commit:()=>gate});
  assert.equal(h.fields['Blend mode'].value,'Multiply');assert.equal(h.fields['Track matte'].value,'AlphaInverted');
  h.change('Blend mode','Screen');h.change('Track matte','Luma');await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties_batch',clip_ids:h.selection.clip_ids,patch:{blend:'Screen'}}]);
  assert.ok(Object.values(h.fields).every(field=>field.disabled));resolve();await settle();
  assert.deepEqual(propertyOperation('audio-1',{gain_db:-3}),{kind:'set_properties',clip_id:'audio-1',patch:{gain_db:-3}});
});

test('matte None is sent as an explicit native string without changing other properties',async t=>{
  const h=harness(t);h.change('Track matte','None');await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties_batch',clip_ids:h.selection.clip_ids,patch:{matte:'None'}}]);
  assert.equal(h.detail.blend,'Multiply');assert.equal(h.detail.matte,'AlphaInverted');
});

test('project, generation, timeline, revision and any selected-peer change refuse stale chooser commands',async t=>{
  const h=harness(t),original=structuredClone(h.state);
  const changes=[state=>{state.project_epoch='new';},state=>{state.generation='8';},state=>{state.timeline.id='other';},state=>{state.timeline.revision='other';},state=>{state.selection=state.selection.filter(id=>id!=='audio-1');},state=>{state.timeline.tracks[1].locked=true;}];
  for(const change of changes){Object.assign(h.state,structuredClone(original));change(h.state);h.change('Blend mode','Screen');await settle();}
  assert.deepEqual(h.commands,[]);assert.equal(h.notices.length,changes.length);
});

test('a selection/context change between change dispatch and commit microtask cancels the command',async t=>{
  const h=harness(t);h.change('Blend mode','Screen');h.state.selection=['audio-1'];await settle();
  assert.deepEqual(h.commands,[]);assert.match(h.notices[0],/changed/);assert.ok(Object.values(h.fields).every(field=>field.disabled));
});

test('read-only, busy, modal or playback guards and detached cards refuse changes',async t=>{
  const h=harness(t);h.block();h.change('Blend mode','Screen');await settle();assert.deepEqual(h.commands,[]);
  h.allow();h.root.isConnected=false;h.change('Track matte','Luma');await settle();assert.deepEqual(h.commands,[]);
});

test('unknown command outcome is surfaced once and never automatically replays or enables an unresolved editor',async t=>{
  let h;h=harness(t,{commit:()=>{h.block();return Promise.reject(Error('Command outcome unknown; reconnect'));}});
  h.change('Blend mode','Screen');await settle();h.change('Blend mode','Screen');await settle();
  assert.equal(h.commands.length,1);assert.match(h.notices[0],/outcome unknown/);assert.ok(Object.values(h.fields).every(field=>field.disabled));
});

test('a known failed native command does not retry and the owner may explicitly choose another value',async t=>{
  let attempts=0;const h=harness(t,{commit:()=>++attempts===1?Promise.reject(Error('Native selection changed')):Promise.resolve()});
  h.change('Blend mode','Screen');await settle();assert.equal(h.commands.length,1);assert.equal(h.fields['Blend mode'].disabled,false);
  h.change('Track matte','LumaInverted');await settle();assert.equal(h.commands.length,2);assert.deepEqual(h.commands[1].patch,{matte:'LumaInverted'});
});

test('only native catalog values and the authoritative first eligible detail can create choosers',async t=>{
  const h=harness(t);h.change('Blend mode','InventedMode');await settle();assert.deepEqual(h.commands,[]);assert.match(h.notices[0],/native/);
  const empty={children:[],append(...nodes){this.children.push(...nodes);}};
  for(const detail of [{...h.detail,clip_id:'audio-1'},{...h.detail,video:false},{...h.detail,locked:true}])renderBlendMatte(empty,detail,{selection:h.selection,getSelection:()=>h.selection,canInteract:()=>true,commit:()=>assert.fail('No command'),notice:()=>{}});
  assert.deepEqual(empty.children,[]);
});
