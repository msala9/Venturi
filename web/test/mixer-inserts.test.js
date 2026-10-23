import test from 'node:test';
import assert from 'node:assert/strict';
import {insertMoveTarget,editMixerEffects,remapMixerPaths,createMixerEditorState,notifyMixerMutation,createMixerInsertStack} from '../js/mixer-inserts.js';
import {renderMixer} from '../js/mixer.js';

const mono=()=>({enabled:true,kind:'Mono'});
const normalize=()=>({enabled:true,kind:{Normalize:{mode:'SamplePeak',target_db:-1,set_level:'Relative'}}});
const query={project_epoch:'epoch:1',if_generation:'4',timeline_id:'1',revision:'native-r4'};
const node=(path,open=true)=>({dataset:{mixerPath:path},open});
const body=(effects,channel='master')=>({command_id:'command',project_epoch:query.project_epoch,if_generation:query.if_generation,if_revision:query.revision,operation:{kind:'set_audio_effects',channel,effects}});
const receipt={command_id:'command',project_epoch:query.project_epoch,status:'applied',generation:'5'};

test('native insert slots and path permutations follow indices even for identical effects and nested panels',()=>{
  assert.equal(insertMoveTarget(0,1,3),null);assert.equal(insertMoveTarget(0,3,3),2);assert.equal(insertMoveTarget(2,0,3),0);assert.equal(insertMoveTarget(3,0,3),null);
  const effects=[mono(),mono(),normalize()],before=structuredClone(effects),plan=editMixerEffects(effects,{kind:'move',from:0,to:2});
  assert.deepEqual(plan.indices,[2,0,1]);assert.deepEqual(plan.effects,[effects[1],effects[2],effects[0]]);assert.deepEqual(effects,before);
  const paths=new Set(['master:effects','master:effects:0','master:effects:0:eq-band:2','master:effects:1','2:effects:0']);
  remapMixerPaths(paths,'master',plan.indices);
  assert.deepEqual([...paths].sort(),['2:effects:0','master:effects','master:effects:0','master:effects:2','master:effects:2:eq-band:2'].sort());
  remapMixerPaths(paths,'master',editMixerEffects(plan.effects,{kind:'remove',index:0}).indices);
  assert.equal(paths.has('master:effects:0'),false);assert.equal(paths.has('master:effects:1:eq-band:2'),true);
  assert.equal(editMixerEffects(effects,{kind:'move',from:0,to:0}),null);assert.equal(editMixerEffects(effects,{kind:'remove',index:3}),null);
  assert.equal(editMixerEffects(Array.from({length:32},mono),{kind:'add',effect:mono()}),null);
});

test('only an exact own ACK remaps captured editor paths before the authoritative rebuild',()=>{
  const paths=new Set(),state=createMixerEditorState(paths),effects=[mono(),mono(),normalize()];
  state.capture(query);state.capture(query,[node('master:effects:0'),node('master:effects:0:eq-band:2'),node('master:effects:1')]);
  const owner=state.begin(query,'master',effects,{kind:'move',from:0,to:2});
  state.capture(query,[node('master:effects:0')]);assert.equal(paths.has('master:effects:0:eq-band:2'),true);
  owner.onReceipt(receipt,body(owner.effects));
  state.capture({...query,if_generation:'5',revision:'native-r5'},[node('master:effects:0'),node('master:effects:1')],[{channel:'master',effects:owner.effects}]);
  assert.equal(paths.has('master:effects:2'),true);assert.equal(paths.has('master:effects:2:eq-band:2'),true);assert.equal(paths.has('master:effects:0'),true);
  assert.equal(state.begin(query,'master',owner.effects,{kind:'remove',index:0}),null,'Old generation callbacks cannot start another edit');
  state.capture({...query,timeline_id:'2'},[node('master:effects:2')]);assert.equal(paths.size,0);
  state.capture({...query,project_epoch:'epoch:2'},[node('master:effects:2')]);assert.equal(paths.size,0);
});

test('known failure preserves paths, unknown or foreign completion closes only the affected editors without replay',()=>{
  for(const mode of ['known','known-changed-generation','unknown','foreign-generation','wrong-command','wrong-body']){
    const paths=new Set(),state=createMixerEditorState(paths),effects=[mono(),normalize()];state.capture(query);
    const old=[node('master:effects:1'),node('master:effects:1:crossovers'),node('2:effects:0')];state.capture(query,old);
    const owner=state.begin(query,'master',effects,{kind:'remove',index:0});
    if(mode.startsWith('known') || mode==='unknown')owner.onError({code:mode.startsWith('known')?'REVISION_CONFLICT':'OUTCOME_UNKNOWN'});
    else owner.onReceipt(mode==='wrong-command'?{...receipt,command_id:'foreign'}:receipt,mode==='wrong-body'?body([mono()]):body(owner.effects));
    state.capture(mode==='known'?query:{...query,if_generation:mode==='foreign-generation'?'6':'5',revision:'r5'},old,[{channel:'master',effects:owner.effects}]);
    assert.equal(paths.has('master:effects:1'),mode==='known',mode);assert.equal(paths.has('2:effects:0'),true,mode);
  }
  const state=createMixerEditorState();state.capture(query);const owner=state.begin(query,'master',[mono(),mono()],{kind:'move',from:0,to:1});
  state.capture({...query,timeline_id:'other'});owner.onReceipt(receipt,body(owner.effects));state.capture({...query,timeline_id:'other'},[],[{channel:'master',effects:owner.effects}]);assert.equal(state.paths.size,0);
  assert.equal(notifyMixerMutation({onReceipt(){throw Error('UI callback failed');}},'onReceipt',receipt,{}),false);
});

test('identical-value acknowledged moves follow the explicit permutation even when native generation is unchanged',()=>{
  const state=createMixerEditorState();state.capture(query);state.capture(query,[node('master:effects:0')]);
  const owner=state.begin(query,'master',[mono(),mono()],{kind:'move',from:0,to:1});owner.onReceipt({...receipt,generation:query.if_generation},body(owner.effects));
  state.capture(query,[node('master:effects:0')],[{channel:'master',effects:owner.effects}]);assert.deepEqual([...state.paths],['master:effects:1']);
});

test('Undo or foreign chain reorders close obsolete editors while parameter-only changes retain the same native slot',()=>{
  const state=createMixerEditorState(),effects=[mono(),normalize()],open=[node('master:effects:0'),node('2:effects:0')];
  state.capture(query,[],[{channel:'master',effects}]);
  state.capture({...query,if_generation:'5',revision:'undo'},open,[{channel:'master',effects:[effects[1],effects[0]]}]);
  assert.equal(state.paths.has('master:effects:0'),false);assert.equal(state.paths.has('2:effects:0'),true);
  const sameKind=[normalize(),{...normalize(),enabled:false}];state.capture({...query,timeline_id:'2'},[],[{channel:'master',effects:sameKind}]);
  state.capture({...query,timeline_id:'2',if_generation:'5'},open,[{channel:'master',effects:[sameKind[1],sameKind[0]]}]);assert.equal(state.paths.has('master:effects:0'),false,'Distinct same-type inserts also lose obsolete index ownership');
  const adjusted=structuredClone(sameKind);adjusted[0].kind.Normalize.target_db=-3;
  state.capture({...query,timeline_id:'2',if_generation:'6'},open,[{channel:'master',effects:adjusted}]);assert.equal(state.paths.has('master:effects:0'),true,'Editing parameters does not hide the current insert');
});

class Element extends EventTarget{
  constructor(tag,doc){super();this.tag=tag;this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.style={setProperty(){}};this._connected=true;this.rect={left:10,top:20,width:84,height:80,bottom:100};this.value='';this.disabled=false;this.open=false;}
  get isConnected(){return this._connected && (!this.parentElement || this.parentElement.isConnected);}set isConnected(value){this._connected=value;}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;this._connected=false;}
  contains(node){return this===node || this.children.some(child=>child.contains(node));}
  setAttribute(key,value){this.attributes[key]=String(value);}getBoundingClientRect(){return {...this.rect};}getClientRects(){return this._visible===false?[]:[this.rect];}
  focus(){this.doc.activeElement=this;}scrollIntoView(){}reportValidity(){return true;}checkValidity(){return true;}
  querySelector(selector){return this.querySelectorAll(selector)[0] ?? null;}
  querySelectorAll(selector){return all(this).slice(1).filter(node=>selector==='details[data-mixer-path]'?node.tag==='details' && node.dataset.mixerPath:selector.startsWith('.')?node.className===selector.slice(1):node.tag===selector);}
}
const all=root=>[root,...root.children.flatMap(all)];
const send=(target,type,values={})=>{const event=new Event(type,{cancelable:true});const stop=event.stopPropagation.bind(event);event.stopPropagation=()=>{event.stopped=true;stop();};for(const [key,value] of Object.entries(values))Object.defineProperty(event,key,{value});target.dispatchEvent(event);return event;};
function environment(){const doc=new EventTarget(),win=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.querySelector=()=>doc.modal?{}:null;doc.body=new Element('body',doc);doc.hidden=false;win.innerWidth=1280;win.innerHeight=720;return {doc,win};}
const transfer=()=>({effectAllowed:'',dropEffect:'',setData(){}});
const settle=async()=>{await Promise.resolve();await Promise.resolve();};

test('compact native rows dispatch one reorder only on drop, reject foreign lane drags and expose keyboard actions',async()=>{
  const {doc,win}=environment(),root=doc.createElement('div'),other=doc.createElement('div'),writes=[],opened=[];let context='r4';
  const effects=[mono(),normalize(),mono()],stack=createMixerInsertStack({root,label:'A1',effects,slots:4,catalog:{defaults:{Mono:mono()}},canInteract:()=>true,getContext:()=>context,onOpen:index=>opened.push(index),onEdit:async edit=>writes.push(edit),documentRef:doc,windowRef:win});
  const peer=createMixerInsertStack({root:other,label:'A2',effects,canInteract:()=>true,onOpen(){},onEdit:async edit=>writes.push(edit),documentRef:doc,windowRef:win});
  const rows=all(root).filter(node=>node.className==='mixer-insert-row'),peerRow=all(other).find(node=>node.className==='mixer-insert-row');
  assert.equal(all(root).filter(node=>node.className==='mixer-insert-spacer').length,1);
  for(const button of [rows[0].children[0],rows[0].children[1],all(root).find(node=>node.className==='mixer-insert-add')]){
    const key=send(button,'keydown',{key:' '});assert.equal(key.stopped,true);assert.equal(key.defaultPrevented,false,'Native button activation remains available without Program Play bubbling');
  }
  send(rows[0],'dragstart',{dataTransfer:transfer()});send(rows[2],'dragover',{clientY:90,dataTransfer:transfer()});assert.deepEqual(writes,[]);
  send(peerRow,'drop',{clientY:90});assert.deepEqual(writes,[]);
  send(rows[2],'drop',{clientY:90});await settle();assert.deepEqual(writes,[{kind:'move',from:0,to:2}]);
  send(rows[1],'contextmenu',{clientX:30,clientY:40});const menu=doc.body.children[0];assert.equal(menu.attributes.role,'menu');
  send(menu,'keydown',{key:'End'});assert.equal(doc.activeElement.textContent,'Remove');
  send(menu.children.find(button=>button.textContent==='Disable'),'click');await settle();assert.deepEqual(writes[1],{kind:'toggle',index:1});
  send(rows[0].children[0],'click');assert.deepEqual(opened,[0]);
  send(rows[0],'dragstart',{dataTransfer:transfer()});context='r5';send(rows[2],'drop',{clientY:90});assert.equal(writes.length,2);
  stack.dispose();peer.dispose();
});

test('insert gestures cancel on hidden, modal, geometry, Escape or detached ownership and never write',async t=>{
  for(const reason of ['hidden','modal','geometry','escape','detached','readonly','blur'])await t.test(reason,async()=>{
    const {doc,win}=environment(),root=doc.createElement('div'),writes=[];let writable=true;
    const stack=createMixerInsertStack({root,label:'Master',effects:[mono(),normalize()],canInteract:()=>writable,onOpen(){},onEdit:async edit=>writes.push(edit),documentRef:doc,windowRef:win});
    const rows=all(root).filter(node=>node.className==='mixer-insert-row');send(rows[0],'dragstart',{dataTransfer:transfer()});
    if(reason==='hidden')doc.hidden=true;if(reason==='modal')doc.modal=true;if(reason==='geometry')root.rect.left++;
    if(reason==='escape')send(doc,'keydown',{key:'Escape'});if(reason==='detached')root.isConnected=false;if(reason==='readonly')writable=false;if(reason==='blur')send(win,'blur');
    send(rows[1],'drop',{clientY:90});await settle();assert.deepEqual(writes,[]);stack.dispose();
  });
});

test('owned menu scrolling stays open while outside scroll and Escape close it with appropriate focus',()=>{
  const {doc,win}=environment(),root=doc.createElement('div');
  const stack=createMixerInsertStack({root,label:'Master',effects:[mono()],canInteract:()=>true,onOpen(){},onEdit:async()=>{},documentRef:doc,windowRef:win});
  const actions=all(root).find(node=>node.className==='mixer-insert-actions');
  send(actions,'click');let menu=doc.body.children[0];send(win,'scroll',{target:menu});assert.equal(doc.body.children[0],menu);
  send(win,'blur',{target:actions});assert.equal(doc.body.children[0],menu,'Moving focus from an insert action to its menu is not a window blur');
  send(all(root).find(node=>node.className==='mixer-insert-open'),'click');assert.equal(doc.body.children.length,0,'Opening settings dismisses an older menu in the same strip');
  send(actions,'click');menu=doc.body.children[0];
  send(win,'scroll',{target:doc.body});assert.equal(doc.body.children.length,0);
  send(actions,'click');menu=doc.body.children[0];send(doc,'keydown',{key:'Escape'});assert.equal(doc.body.children.length,0);assert.equal(doc.activeElement,actions);
  stack.dispose();
});

test('detached and collapsed insert stacks become draggable and accessible after mounting and opening',()=>{
  const {doc,win}=environment(),root=doc.createElement('div');let open=false;root.isConnected=false;
  const stack=createMixerInsertStack({root,label:'Master',effects:[mono()],canInteract:()=>true,isCurrent:()=>open,onOpen(){},onEdit:async()=>{},documentRef:doc,windowRef:win});
  const row=all(root).find(node=>node.className==='mixer-insert-row'),actions=row.children[1];
  assert.equal(row.draggable,false);assert.equal(actions.attributes['aria-disabled'],'true');
  root.isConnected=true;open=true;send(doc,'toggle');
  assert.equal(row.draggable,true);assert.equal(actions.attributes['aria-disabled'],'false');
  open=false;send(doc,'toggle');assert.equal(row.draggable,false);assert.equal(actions.attributes['aria-disabled'],'true');
  open=true;stack.sync();assert.equal(row.draggable,true);stack.dispose();
});

test('actual rendered Mixer rows open existing editors and reuse one native ordered-chain command with readonly guards',async()=>{
  const {doc,win}=environment(),previous={document:globalThis.document,window:globalThis.window,Option:globalThis.Option};globalThis.document=doc;globalThis.window=win;globalThis.Option=class extends Element{constructor(text,value){super('option',doc);this.textContent=text;this.value=value;}};
  const timeline={id:'1',tracks:[{id:'2',kind:'audio',label:'A1',locked:false,mix:{gain_db:0,pan:0,effects:[mono(),normalize()]}}],master:{gain_db:0,pan:0,effects:[]}},before=structuredClone(timeline),writes=[];
  try{
    for(const writable of [true,false]){
      const root=doc.createElement('div'),section=renderMixer(root,timeline,{writable,open:true,query:new URLSearchParams(query),catalog:{defaults:{Mono:mono()},normalization:[]},notice(){},commit:async operation=>writes.push(operation)});
      const row=all(section).find(node=>node.className==='mixer-insert-row');send(row.children[0],'click');
      assert.equal(all(section).find(node=>node.dataset.mixerPath==='2:effects:0').open,true,'Row click opens the existing native editor');
      send(row.children[1],'click');const menu=doc.body.children.find(node=>node.className==='mixer-insert-menu'),down=menu.children.find(node=>node.textContent==='Move down');
      assert.equal(down.disabled,!writable);send(down,'click');await settle();
      if(writable)assert.deepEqual(writes,[{kind:'set_audio_effects',channel:'2',effects:[normalize(),mono()]}]);else assert.equal(writes.length,1);
      section.disposeMeters();
    }
    assert.deepEqual(timeline,before);
  }finally{globalThis.document=previous.document;globalThis.window=previous.window;globalThis.Option=previous.Option;}
});
