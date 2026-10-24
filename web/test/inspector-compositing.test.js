import test from 'node:test';
import assert from 'node:assert/strict';
import {videoPropertySelection,renderBlendMatte,propertyOperation} from '../js/inspector.js';

const snapshot=()=>({project_epoch:'epoch-1',generation:'7',timeline:{id:'timeline-1',revision:'revision-3',tracks:[
  {id:'audio',kind:'audio',locked:false,clips:[{id:'audio-1',linked_group:'av'}]},
  {id:'video',kind:'video',locked:false,clips:[{id:'9007199254740995',start_frame:0,kind:'text',linked_group:'av'},{id:'9007199254740993',start_frame:20,kind:'solid'},{id:'9007199254740994',start_frame:40,kind:'adjustment'},{id:'unselected',start_frame:60,kind:'media',linked_group:'av'}]},
  {id:'locked',kind:'video',locked:true,clips:[{id:'locked-video',kind:'media',linked_group:'av'}]},
]},selection:['audio-1','9007199254740995','locked-video','9007199254740993','9007199254740994']});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function harness(t,{commit}={}){
  const priorDocument=globalThis.document,priorOption=globalThis.Option,commands=[],notices=[],previews=[],timers=new Map();let now=0,timerId=0;
  class Surface extends EventTarget{
    constructor(){super();this.listeners=new Map();}
    addEventListener(type,handler,options){super.addEventListener(type,handler,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
    removeEventListener(type,handler,options){super.removeEventListener(type,handler,options);this.listeners.get(type)?.delete(handler);}
    count(){return [...this.listeners.values()].reduce((sum,handlers)=>sum+handlers.size,0);}
  }
  const doc=new Surface(),view=new Surface();doc.defaultView=view;doc.querySelector=()=>null;
  class Element extends Surface{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.disabled=false;this.value='';this.ownerDocument=doc;this.dataset={};this.style={};this.attributes=new Map();}
    get parentNode(){return this.parent;}get parentElement(){return this.parent;}get isConnected(){return this===doc.body || Boolean(this.parent?.isConnected);}
    append(...items){for(const item of items){this.children.push(item);item.parent=this;}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
    contains(target){return this===target || this.children.some(item=>item.contains(target));}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}removeAttribute(name){this.attributes.delete(name);}
    closest(){for(let node=this;node;node=node.parent)if(node.hidden || node.inert || node.tagName==='DETAILS' && !node.open)return node;return null;}
    getClientRects(){return this.isConnected && !this.closest()?[{}]:[];}getBoundingClientRect(){return {left:500,bottom:350,width:180};}
    focus(){doc.activeElement=this;}scrollIntoView(){}showPopover(){}hidePopover(){}
  }
  doc.createElement=tag=>new Element(tag);doc.body=new Element('body');doc.activeElement=doc.body;globalThis.document=doc;
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=++timerId;timers.set(id,{callback,at:now+delay});return id;});t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  const state=snapshot(),root=new Element('div'),selection=videoPropertySelection(state);
  doc.body.append(root);
  const detail={clip_id:selection.clip_ids[0],video:true,locked:false,blend:'Multiply',blends:['Normal','Multiply','Screen'],matte:'AlphaInverted',mattes:['None','Alpha','AlphaInverted','Luma','LumaInverted']};
  let allowed=true;
  const controller=renderBlendMatte(root,detail,{selection,getSelection:()=>videoPropertySelection(state),canInteract:()=>allowed,primaryName:'Selected solid',visualState:new Map([['selected-compositing',true]]),previewInspectorChoice:value=>previews.push(value),notice:message=>notices.push(message),commit:operation=>{commands.push(operation);return commit?.(operation);}});
  const fields=Object.fromEntries(root.children[0].children.filter(node=>node.tagName==='LABEL').map(node=>[node.textContent,node.children[0]])),all=(node=doc.body)=>[node,...node.children.flatMap(all)],popup=()=>all().find(node=>node.getAttribute('role')==='listbox');
  const fire=(node,type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(values))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;};
  const open=label=>{fire(fields[label],'click');return popup();},option=value=>popup()?.children.find(node=>node.textContent===value);
  t.after(()=>{try{controller.dispose();assert.equal(doc.count(),0);assert.equal(view.count(),0);assert.equal(root.children[0].count(),0);assert.equal(timers.size,0);assert.equal(Boolean(popup()),false);}finally{globalThis.document=priorDocument;globalThis.Option=priorOption;}});
  return {state,root,detail,selection,fields,commands,notices,previews,controller,doc,view,popup,fire,open,option,block(){allowed=false;},allow(){allowed=true;},
    choose(label,value){if(!open(label))return false;const row=option(value);assert.ok(row,`Native option ${value}`);fire(row,'click');return true;},
    key(label,key){return fire(fields[label],'keydown',{key});},
    advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();}now=end;},
  };
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
  assert.equal(h.choose('Blend mode','Screen'),true);assert.equal(h.choose('Track matte','Luma'),false);await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties_batch',clip_ids:h.selection.clip_ids,patch:{blend:'Screen'}}]);
  assert.ok(Object.values(h.fields).every(field=>field.disabled));resolve();await settle();
  assert.deepEqual(propertyOperation('audio-1',{gain_db:-3}),{kind:'set_properties',clip_id:'audio-1',patch:{gain_db:-3}});
});

test('matte None is sent as an explicit native string without changing other properties',async t=>{
  const h=harness(t);h.choose('Track matte','None');await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties_batch',clip_ids:h.selection.clip_ids,patch:{matte:'None'}}]);
  assert.equal(h.detail.blend,'Multiply');assert.equal(h.detail.matte,'AlphaInverted');
});

test('native combobox keyboard preview and Escape preserve the original selection before one explicit confirmation',async t=>{
  const h=harness(t),before=structuredClone({state:h.state,detail:h.detail});
  assert.equal(h.fields['Blend mode'].getAttribute('role'),'combobox');h.key('Blend mode','ArrowDown');h.advance(129);assert.deepEqual(h.previews,[]);h.advance(1);
  assert.deepEqual(h.previews,[{kind:'blend_mode',blend:'Screen'}]);assert.deepEqual(h.commands,[]);h.key('Blend mode','Escape');
  assert.equal(h.previews.at(-1),null);assert.equal(h.fields['Blend mode'].value,'Multiply');assert.equal(Boolean(h.popup()),false);assert.deepEqual({state:h.state,detail:h.detail},before);
  h.key('Blend mode','Home');h.advance(130);assert.deepEqual(h.previews.at(-1),{kind:'blend_mode',blend:'Normal'});h.key('Blend mode','Enter');h.key('Blend mode','Enter');await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties_batch',clip_ids:h.selection.clip_ids,patch:{blend:'Normal'}}]);assert.equal(h.previews.at(-1),null);assert.deepEqual({state:h.state,detail:h.detail},before);
  h.choose('Blend mode','Normal');await settle();assert.equal(h.commands.length,1,'An unchanged local choice does not replay the native batch');
});

test('reusable compositing cancellation invalidates an undispatched keyboard confirmation without disabling a fresh edit',async t=>{
  const h=harness(t);h.key('Track matte','Home');h.key('Track matte','Enter');h.controller.cancel();await settle();
  assert.deepEqual(h.commands,[]);assert.equal(h.fields['Track matte'].value,'AlphaInverted');h.choose('Track matte','None');await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties_batch',clip_ids:h.selection.clip_ids,patch:{matte:'None'}}]);h.controller.dispose();h.key('Blend mode','ArrowDown');assert.equal(Boolean(h.popup()),false);
});

test('project, generation, timeline, revision and any selected-peer change refuse stale chooser commands',async t=>{
  const h=harness(t),original=structuredClone(h.state);
  const changes=[state=>{state.project_epoch='new';},state=>{state.generation='8';},state=>{state.timeline.id='other';},state=>{state.timeline.revision='other';},state=>{state.selection=state.selection.filter(id=>id!=='audio-1');},state=>{state.timeline.tracks[1].locked=true;}];
  for(const change of changes){Object.assign(h.state,structuredClone(original));h.open('Blend mode');const row=h.option('Screen');assert.ok(row);change(h.state);h.fire(row,'click');h.key('Blend mode','Enter');await settle();assert.equal(h.fields['Blend mode'].value,'Multiply');assert.equal(Boolean(h.popup()),false);}
  assert.deepEqual(h.commands,[]);assert.deepEqual(h.previews,[]);
});

test('a selection/context change between change dispatch and commit microtask cancels the command',async t=>{
  const h=harness(t);h.choose('Blend mode','Screen');h.state.selection=['audio-1'];await settle();
  assert.deepEqual(h.commands,[]);assert.match(h.notices[0],/changed/);assert.equal(h.fields['Blend mode'].value,'Multiply');assert.equal(h.choose('Track matte','Luma'),false);
});

test('read-only, busy, modal or playback guards and detached cards refuse changes',async t=>{
  const h=harness(t);h.block();assert.equal(h.choose('Blend mode','Screen'),false);await settle();assert.deepEqual(h.commands,[]);
  h.allow();h.doc.querySelector=()=>({});assert.equal(h.choose('Blend mode','Screen'),false);h.doc.querySelector=()=>null;h.doc.hidden=true;assert.equal(h.choose('Blend mode','Screen'),false);h.doc.hidden=false;
  h.root.remove();assert.equal(h.choose('Track matte','Luma'),false);await settle();assert.deepEqual(h.commands,[]);assert.deepEqual(h.previews,[]);
});

test('unknown command outcome is surfaced once and never automatically replays or enables an unresolved editor',async t=>{
  const h=harness(t,{commit:()=>Promise.reject(Object.assign(Error('Command outcome unknown; reconnect'),{code:'OUTCOME_UNKNOWN'}))});
  h.choose('Blend mode','Screen');await settle();assert.equal(h.choose('Blend mode','Screen'),false);await settle();
  assert.equal(h.commands.length,1);assert.match(h.notices[0],/outcome unknown/);assert.ok(Object.values(h.fields).every(field=>field.disabled));
});

test('a known failed native command does not retry and the owner may explicitly choose another value',async t=>{
  let attempts=0;const h=harness(t,{commit:()=>++attempts===1?Promise.reject(Error('Native selection changed')):Promise.resolve()});
  h.choose('Blend mode','Screen');await settle();assert.equal(h.commands.length,1);assert.equal(h.fields['Blend mode'].disabled,false);assert.equal(h.fields['Blend mode'].value,'Multiply');
  h.choose('Track matte','LumaInverted');await settle();assert.equal(h.commands.length,2);assert.deepEqual(h.commands[1].patch,{matte:'LumaInverted'});
});

test('only native catalog values and the authoritative first eligible detail can create choosers',async t=>{
  const h=harness(t);h.open('Blend mode');assert.deepEqual(h.popup().children.map(node=>node.textContent),h.detail.blends);assert.equal(h.option('InventedMode'),undefined);h.key('Blend mode','Escape');
  h.fields['Blend mode'].value='InventedMode';h.fire(h.fields['Blend mode'],'change');await settle();assert.deepEqual(h.commands,[]);assert.deepEqual(h.previews,[]);h.fields['Blend mode'].value=h.detail.blend;
  const empty={children:[],append(...nodes){this.children.push(...nodes);}};
  for(const detail of [{...h.detail,clip_id:'audio-1'},{...h.detail,video:false},{...h.detail,locked:true}])renderBlendMatte(empty,detail,{selection:h.selection,getSelection:()=>h.selection,canInteract:()=>true,commit:()=>assert.fail('No command'),notice:()=>{}});
  assert.deepEqual(empty.children,[]);
});
