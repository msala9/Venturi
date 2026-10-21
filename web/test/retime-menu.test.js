import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRetimeMenu,retimeMenuIdentity,retimePresetOperation,RETIME_PRESETS} from '../js/retime-menu.js';

function fakeDocument(){
  const document={hidden:false,activeElement:null,handlers:new Map(),addEventListener(type,handler){this.handlers.set(type,handler);},removeEventListener(type){this.handlers.delete(type);}};
  class Node {
    constructor(tag){this.tagName=tag;this.children=[];this.handlers=new Map();this.attributes=new Map();this.open=false;this.isConnected=true;}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    setAttribute(name,value){this.attributes.set(name,value);}
    addEventListener(type,handler){this.handlers.set(type,handler);}
    emit(type,event={}){return this.handlers.get(type)?.({preventDefault(){},stopPropagation(){},...event});}
    focus(){document.activeElement=this;}
    contains(node){return this===node || this.children.some(child=>child.contains(node));}
    showModal(){this.open=true;}
    close(){this.open=false;this.emit('close');}
    remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
  }
  document.createElement=tag=>new Node(tag);document.body=new Node('body');
  document.querySelector=()=>document.body.children.find(node=>node.tagName==='dialog' && node.open);
  document.defaultView={handlers:new Map(),addEventListener(type,handler){this.handlers.set(type,handler);},removeEventListener(type){this.handlers.delete(type);}};
  return document;
}
function harness({commit}={}){
  const document=fakeDocument(),commands=[],notices=[],advanced=[],hidden=[];
  let context={project_epoch:'epoch',generation:'2',timeline_id:'timeline',revision:'revision',track_id:'track',editable:true,overwrite:false,viewIdentity:'viewport',linked:[{track_id:'track',locked:false}],
    clip:{id:'9007199254740993',name:'Primary <literal>',retime:{speed_percent:150,pitch_correction:true}}};
  const returnFocus=document.createElement('canvas');returnFocus.focus();
  const menu=createRetimeMenu({document,getContext:target=>target.clip_id===context.clip.id && target.track_id===context.track_id?context:null,
    commit:async operation=>{commands.push(operation);return commit?.(operation);},notice:message=>notices.push(message),onAdvanced:target=>advanced.push(target),onHide:target=>hidden.push(target)});
  const target={clip_id:context.clip.id,track_id:context.track_id,returnFocus};
  const dialog=()=>document.querySelector('dialog[open]'),buttons=()=>dialog().children.filter(node=>node.tagName==='button');
  return {menu,document,commands,notices,advanced,hidden,returnFocus,target,dialog,buttons,context:()=>context,setContext:value=>{context=value;},open:()=>menu.open(target)};
}

test('native preset menu opens without edits and preserves exact native percentages and primary identity',async()=>{
  const h=harness();try{
    assert.equal(h.open(),true);assert.equal(h.commands.length,0);assert.equal(h.dialog().children[0].textContent,'Primary <literal> · 150%');
    assert.deepEqual(h.buttons().slice(0,10).map(button=>button.textContent),RETIME_PRESETS.map(percent=>`${percent}%`));
    assert.equal(h.document.activeElement.textContent,'150%');assert.equal(h.document.activeElement.attributes.get('aria-current'),'true');
    assert.match(h.dialog().children[1].textContent,/overlaps are refused/);
    await h.buttons()[7].emit('click');assert.deepEqual(h.commands,[{kind:'retime_preset',clip_id:h.target.clip_id,percent:200,overwrite:false}]);
    assert.equal(h.dialog(),undefined);assert.equal(h.document.activeElement,h.returnFocus);
  }finally{h.menu.dispose();}
});

test('explicit overwrite is captured and never enabled by opening a preset menu',async()=>{
  const h=harness();try{
    h.setContext({...h.context(),overwrite:true});h.open();assert.match(h.dialog().children[1].textContent,/OVERWRITE clips enabled/);
    await h.buttons()[0].emit('click');assert.equal(h.commands[0].overwrite,true);assert.equal(h.commands[0].percent,10);
  }finally{h.menu.dispose();}
});

test('preset operation refuses unsupported percentages, malformed metadata and readonly contexts',()=>{
  const h=harness();try{
    for(const percent of [0,1,99,100.001,NaN,Infinity])assert.throws(()=>retimePresetOperation(h.context(),percent));
    assert.throws(()=>retimePresetOperation({...h.context(),editable:false},100));
    assert.throws(()=>retimePresetOperation({...h.context(),overwrite:undefined},100));
    assert.throws(()=>retimePresetOperation({...h.context(),clip:{id:'clip',retime:{}}},100));
    for(const field of ['project_epoch','generation','timeline_id','revision','track_id','viewIdentity'])assert.notEqual(retimeMenuIdentity(h.context()),retimeMenuIdentity({...h.context(),[field]:'changed'}));
    assert.notEqual(retimeMenuIdentity(h.context()),retimeMenuIdentity({...h.context(),overwrite:true}));
  }finally{h.menu.dispose();}
});

test('every action validates project revision, source metadata, linked locks, viewport and lease immediately before submission',async()=>{
  for(const change of ['epoch','generation','revision','clip','linked','viewport','overwrite','readonly']){
    const h=harness();try{
      h.open();const preset=h.buttons()[0],next=structuredClone(h.context());
      if(change==='epoch')next.project_epoch='other';if(change==='generation')next.generation='3';if(change==='revision')next.revision='new';
      if(change==='clip')next.clip.retime.speed_percent=200;if(change==='linked')next.linked[0].locked=true;
      if(change==='viewport')next.viewIdentity='new';if(change==='overwrite')next.overwrite=true;if(change==='readonly')next.editable=false;
      h.setContext(next);await preset.emit('click');assert.equal(h.commands.length,0,change);assert.equal(h.dialog(),undefined,change);assert.match(h.notices.at(-1),/changed/,change);
    }finally{h.menu.dispose();}
  }
});

test('advanced speed and per-clip hide are local guarded actions with no command on opening',()=>{
  const h=harness();try{
    h.open();h.buttons()[10].emit('click');assert.deepEqual(h.advanced,[{clip_id:h.target.clip_id,track_id:'track'}]);assert.equal(h.commands.length,0);
    h.open();h.buttons()[11].emit('click');assert.deepEqual(h.hidden,[{clip_id:h.target.clip_id,track_id:'track'}]);assert.equal(h.commands.length,0);assert.equal(h.document.activeElement,h.returnFocus);
  }finally{h.menu.dispose();}
});

test('keyboard navigation, Escape and native cancel restore focus without edits',()=>{
  const h=harness();try{
    h.open();const dialog=h.dialog(),buttons=h.buttons();
    dialog.emit('keydown',{key:'End'});assert.equal(h.document.activeElement,buttons.at(-1));
    dialog.emit('keydown',{key:'ArrowDown'});assert.equal(h.document.activeElement,buttons[0]);
    dialog.emit('keydown',{key:'ArrowUp'});assert.equal(h.document.activeElement,buttons.at(-1));
    dialog.emit('keydown',{key:'Home'});assert.equal(h.document.activeElement,buttons[0]);
    dialog.emit('keydown',{key:'Escape'});assert.equal(h.dialog(),undefined);assert.equal(h.document.activeElement,h.returnFocus);
    h.open();h.dialog().emit('cancel');assert.equal(h.dialog(),undefined);assert.equal(h.commands.length,0);
  }finally{h.menu.dispose();}
});

test('pending requests submit once, preserve errors and cannot reopen before the request settles',async()=>{
  let reject;const pending=new Promise((_resolve,no)=>{reject=no;});
  const h=harness({commit:()=>pending});try{
    h.open();const preset=h.buttons()[0],first=preset.emit('click');
    await preset.emit('click');assert.equal(h.commands.length,1);assert.equal(h.open(),false);
    reject(Error('OVERLAP · explicit overwrite required'));await first;assert.match(h.notices.at(-1),/OVERLAP/);assert.equal(h.open(),true);
  }finally{h.menu.dispose();}
});

test('obsolete dialog callbacks cannot close or submit from a replacement menu',async()=>{
  const h=harness();try{
    h.open();const old=h.dialog(),buttons=h.buttons();h.menu.close();h.open();const latest=h.dialog();
    await buttons[0].emit('click');buttons[10].emit('click');buttons[11].emit('click');buttons[12].emit('click');
    old.emit('keydown',{key:'Escape'});old.emit('cancel');old.emit('close');
    assert.equal(h.dialog(),latest);assert.equal(h.commands.length,0);assert.equal(h.advanced.length,0);assert.equal(h.hidden.length,0);
  }finally{h.menu.dispose();}
});

test('viewport, visibility and snapshot invalidation close menus and disposal removes listeners',()=>{
  const h=harness();
  h.open();const internal=h.buttons()[0];h.document.defaultView.handlers.get('scroll')({type:'scroll',target:internal});assert(h.dialog());h.menu.close();
  for(const event of ['resize','scroll','blur']){h.open();h.document.defaultView.handlers.get(event)();assert.equal(h.dialog(),undefined);}
  h.open();h.document.hidden=true;h.document.handlers.get('visibilitychange')();assert.equal(h.dialog(),undefined);h.document.hidden=false;
  h.open();h.setContext({...h.context(),revision:'changed'});h.menu.invalidate();assert.equal(h.dialog(),undefined);
  h.open();h.menu.dispose();assert.equal(h.dialog(),undefined);assert.equal(h.document.defaultView.handlers.size,0);assert.equal(h.document.handlers.size,0);assert.equal(h.open(),false);
});
