import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolPanels,createMixerRefresh} from '../js/tool-panels.js';
import {createMixerEditorState} from '../js/mixer-inserts.js';

function fixture(){
  const document={createElement:tag=>new Node(tag)};
  class Node{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.ownerDocument=document;this.isConnected=true;this.open=false;}
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    insertBefore(node,before){node.remove();node.parentNode=this;this.children.splice(this.children.indexOf(before),0,node);}
    remove(){if(this.parentNode){const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
    replaceChildren(...nodes){for(const child of [...this.children])child.remove();this.append(...nodes);}
  }
  const window=()=>({opened:false,element:new Node(),content:new Node(),isOpen(){return this.opened;}}),mixer=window(),color=window(),state={hidden:false,fullscreen:false};
  const panels=createToolPanels({mixer,color,getState:()=>state});
  return {Node,mixer,color,state,panels};
}

test('independent Color docking retains the one grade card and drafts, restoring closed Inspector ancestors on close',()=>{
  const h=fixture(),outer=new h.Node('details'),filters=new h.Node('details'),card=new h.Node('details'),host=new h.Node(),input=new h.Node('input');
  input.value='.375';outer.append(filters);filters.append(card);card.append(input);let canceled=0;
  h.panels.setGrade(card,host,()=>canceled++);assert.equal(card.parentNode,filters);assert.equal(outer.open,false);
  h.mixer.opened=true;h.color.opened=true;assert.deepEqual(h.panels.sync(),{mixer:true,color:true});
  assert.equal(card.parentNode,host);assert.equal(card.open,true);assert.equal(outer.open,true);assert.equal(filters.open,true);assert.equal(host.children.length,1);
  h.color.opened=false;h.panels.sync();assert.equal(h.panels.visible('mixer'),true);assert.equal(card.parentNode,filters);assert.equal(input.value,'.375');assert.equal(card.open,false);assert.equal(outer.open,false);assert.equal(filters.open,false);assert.ok(canceled>0);
  h.color.opened=true;h.panels.sync();assert.equal(host.children[0],card);assert.equal(card.children[0],input);
  h.panels.clearGrade();assert.equal(card.parentNode,filters);assert.equal(host.children.length,0);assert.deepEqual(filters.children,[card]);
});

test('hidden and fullscreen tools cancel owned gestures once and resume existing Mixer visibility without duplication',()=>{
  const h=fixture(),node=new h.Node();let canceled=0,synced=0;node.cancelGestures=()=>canceled++;node.syncVisibility=()=>synced++;
  h.panels.setMixer(node);assert.equal(synced,0);h.mixer.opened=true;h.panels.sync();assert.equal(synced,1);
  h.state.fullscreen=true;assert.equal(h.panels.sync().mixer,false);assert.equal(canceled,1);h.panels.sync();assert.equal(canceled,1);
  h.state.fullscreen=false;h.panels.sync();assert.equal(synced,2);assert.deepEqual(h.mixer.content.children,[node]);
  h.state.hidden=true;h.panels.sync();assert.equal(canceled,2);h.state.hidden=false;h.panels.sync();assert.equal(synced,3);
  h.panels.clearMixer();assert.equal(canceled,3);assert.equal(h.mixer.content.children.length,0);
  const replacement=new h.Node();let fresh=0;replacement.syncVisibility=()=>fresh++;h.panels.setMixer(replacement);assert.equal(fresh,1);assert.deepEqual(h.mixer.content.children,[replacement]);
});

test('a rebuilt Color selection removes the old docking slot and never resurrects the old card on reopen',()=>{
  const h=fixture(),inspector=new h.Node('details'),old=new h.Node('details'),fresh=new h.Node('details'),host=new h.Node();inspector.append(old);h.color.opened=true;
  h.panels.setGrade(old,host,()=>{});h.panels.clearGrade();inspector.replaceChildren(fresh);h.panels.setGrade(fresh,host,()=>{});
  assert.deepEqual(host.children,[fresh]);h.color.opened=false;h.panels.sync();h.color.opened=true;h.panels.sync();assert.deepEqual(host.children,[fresh]);assert.equal(old.parentNode,null);
});

function mixerContext(){return {project_epoch:'epoch:1',generation:'0',timeline:{id:'2',revision:'revision:1'},writable:true,catalog:{effects:['Equalizer','MultibandCompressor']}};}

test('Mixer refresh is deferred and preserves the same DOM, draft and subscription across selection/frame/layout and tool reopen',()=>{
  const h=fixture();let context=mixerContext(),node=null,reads=0,rebuilds=0,disposals=0;
  const subscriptions=new Set();
  const refresh=createMixerRefresh({getContext:()=>{reads++;return context;},getNode:()=>node,rebuild:()=>{
    rebuilds++;if(node){disposals++;subscriptions.delete(node);}
    node=new h.Node();node.draft='.375';subscriptions.add(node);h.panels.setMixer(node);
  }});
  assert.equal(reads,0);assert.equal(rebuilds,0);
  assert.equal(refresh.refresh(),true);const original=node;assert.equal(rebuilds,1);assert.equal(h.mixer.isOpen(),false);
  for(const patch of [{selection:['clip:1']},{frame:99},{layout:{width:900}},{selection:[],frame:0}]){
    context={...context,...patch};assert.equal(refresh.refresh(),false);
  }
  h.mixer.opened=true;h.panels.sync();assert.equal(refresh.refresh(),false);
  h.mixer.opened=false;h.panels.sync();assert.equal(refresh.refresh(),false);
  h.mixer.opened=true;h.panels.sync();assert.equal(refresh.refresh(),false);
  assert.equal(node,original);assert.equal(node.draft,'.375');assert.equal(disposals,0);assert.deepEqual([...subscriptions],[original]);
  assert.deepEqual(h.mixer.content.children,[original]);
});

test('native Mixer context changes replace exactly once, including revision, writer and catalog changes',()=>{
  let context=mixerContext(),node=null,rebuilds=0,disposals=0;
  const refresh=createMixerRefresh({getContext:()=>context,getNode:()=>node,rebuild:identity=>{
    if(node)disposals++;node={isConnected:true,identity};rebuilds++;
  }});
  refresh.refresh();
  const changes=[()=>context.generation='1',()=>context.project_epoch='epoch:2',()=>context.timeline={id:'3',revision:'revision:1'},()=>context.timeline.revision='revision:2',()=>context.writable=false,()=>context.catalog.effects.push('Mono')];
  for(const change of changes){
    const before=node;change();assert.equal(refresh.refresh(),true);assert.notEqual(node,before);assert.equal(refresh.refresh(),false);
  }
  assert.equal(rebuilds,7);assert.equal(disposals,6);
  assert.deepEqual(JSON.parse(node.identity),['epoch:2','1','3','revision:2',false,{effects:['Equalizer','MultibandCompressor','Mono']}]);
});

test('missing or disconnected mounted Mixer rebuilds while null and native fixture contexts clear only once',()=>{
  let context=null,node=null,rebuilds=0;
  const refresh=createMixerRefresh({getContext:()=>context,getNode:()=>node,rebuild:identity=>{rebuilds++;node=identity===null ? null : {};}});
  assert.equal(refresh.refresh(),true);assert.equal(refresh.refresh(),false);
  context={...mixerContext(),project_epoch:null};assert.equal(refresh.refresh(),false);
  context={...mixerContext(),timeline:{id:'fixture'}};assert.equal(refresh.refresh(),false);
  context=mixerContext();assert.equal(refresh.refresh(),true);assert.equal(refresh.refresh(),false);
  node.isConnected=false;assert.equal(refresh.refresh(),true);assert.equal(refresh.refresh(),false);
  node=null;assert.equal(refresh.refresh(),true);assert.equal(refresh.refresh(),false);
  context={...context,timeline:null};assert.equal(refresh.refresh(),true);assert.equal(refresh.refresh(),false);
  assert.equal(rebuilds,5);
});

test('a failed same-context rebuild invalidates prior success before callback and can be retried explicitly',()=>{
  const context=mixerContext();let node=null,rebuilds=0,fail=false;
  const refresh=createMixerRefresh({getContext:()=>context,getNode:()=>node,rebuild:()=>{
    rebuilds++;if(fail)throw new Error('render refused');node={isConnected:true};
  }});
  assert.equal(refresh.refresh(),true);const original=node;original.isConnected=false;fail=true;
  assert.throws(()=>refresh.refresh(),/render refused/);assert.equal(node,original);
  original.isConnected=true;fail=false;
  assert.equal(refresh.refresh(),true);assert.notEqual(node,original);assert.equal(refresh.refresh(),false);assert.equal(rebuilds,3);
});

function editorRefreshFixture(effects){
  const query={project_epoch:'epoch:1',if_generation:'0',timeline_id:'2',revision:'revision:1'};
  const editor=createMixerEditorState();let node=null,nodes=[],captures=0,disposals=0;
  const refresh=createMixerRefresh({getContext:()=>({...mixerContext(),generation:query.if_generation,timeline:{id:query.timeline_id,revision:query.revision}}),getNode:()=>node,rebuild:()=>{
    captures++;editor.capture(query,nodes,[{channel:'1',effects}]);if(node)disposals++;
    node={isConnected:true};nodes=effects.map((_,index)=>({dataset:{mixerPath:`1:effects:${index}`},open:editor.paths.has(`1:effects:${index}`)}));
  }});
  refresh.refresh();
  return {query,editor,effects,refresh,nodes:()=>nodes,node:()=>node,captures:()=>captures,disposals:()=>disposals};
}

test('own known failure can invalidate without immediate work, then same-generation capture releases the pending editor',()=>{
  const h=editorRefreshFixture([{enabled:true,kind:'Mono'}]);h.nodes()[0].open=true;
  const edit={kind:'toggle',index:0},plan=h.editor.begin(h.query,'1',h.effects,edit);
  assert.ok(plan);plan.onError({code:'INVALID_OPERATION'});
  assert.equal(h.editor.begin(h.query,'1',h.effects,edit),null);assert.equal(h.refresh.refresh(),false);
  const mounted=h.node();h.refresh.invalidate();
  assert.equal(h.node(),mounted);assert.equal(h.captures(),1);assert.equal(h.disposals(),0);
  assert.equal(h.refresh.refresh(),true);assert.equal(h.captures(),2);assert.equal(h.disposals(),1);
  assert.equal(h.nodes()[0].open,true);assert.ok(h.editor.begin(h.query,'1',h.effects,edit));
  assert.equal(h.refresh.refresh(),false);
});

test('a duplicate Mono move ACK with unchanged generation remaps settings exactly once after explicit invalidation',()=>{
  const h=editorRefreshFixture([{enabled:true,kind:'Mono'},{enabled:true,kind:'Mono'}]);h.nodes()[0].open=true;
  const plan=h.editor.begin(h.query,'1',h.effects,{kind:'move',from:0,to:1});assert.ok(plan);
  assert.deepEqual(plan.effects,h.effects);
  plan.onReceipt({status:'applied',project_epoch:h.query.project_epoch,generation:'0',command_id:'move:1'},{command_id:'move:1',project_epoch:h.query.project_epoch,if_generation:'0',if_revision:h.query.revision,operation:{kind:'set_audio_effects',channel:'1',effects:plan.effects}});
  assert.equal(h.refresh.refresh(),false);assert.equal(h.captures(),1);
  h.refresh.invalidate();assert.equal(h.captures(),1);assert.equal(h.disposals(),0);
  assert.equal(h.refresh.refresh(),true);assert.equal(h.captures(),2);assert.equal(h.disposals(),1);
  assert.deepEqual([...h.editor.paths],['1:effects:1']);assert.deepEqual(h.nodes().map(node=>node.open),[false,true]);
  const mounted=h.node();assert.equal(h.refresh.refresh(),false);assert.equal(h.node(),mounted);assert.equal(h.captures(),2);
  assert.ok(h.editor.begin(h.query,'1',h.effects,{kind:'toggle',index:1}));
});
