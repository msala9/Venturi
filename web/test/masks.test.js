import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maskPathKeyDestination,maskPathKeyOperation,renderMasks} from '../js/masks.js';

function fixture(onKey=false){
  const path={points:[[0,0],[100,0],[0,100]].map(point=>({point,in_handle:[0,0],out_handle:[0,0]}))};
  const mask={index:0,shape:'Path',enabled:true,invert:false,mode:'Add',parameters:[],path:structuredClone(path),evaluated_path:structuredClone(path),path_keyframes:100,path_keys:[],path_navigation:{on_keyframe:onKey,previous:{source_frame:185,timeline_frame:42},next:{source_frame:205,timeline_frame:47}}};
  return {clip_id:'9007199254740993',timeline_frame:45,source_frame:197,masks:{shapes:['Path'],modes:['Add'],items:[mask]}};
}
const emit=(target,type,properties={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});let stopped=false;event.stopPropagation=()=>{stopped=true;};target.dispatchEvent(event);return {event,stopped};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness(t,{detail=fixture(),disabled=false,seekEnabled=true,openState=new Map([['masks',true]]),commit}={}){
  const priorDocument=globalThis.document,priorOption=globalThis.Option,commands=[],frames=[],notices=[];
  let frame=detail.timeline_frame,allowed=true,dialog=false;
  const document={activeElement:null,querySelector:()=>dialog?{}:null};
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.dataset={};this.children=[];this.attributes=new Map();this.disabled=false;this.textContent='';this.value='';this.open=false;}
    append(...children){for(const child of children){if(typeof child==='string')continue;child.parent=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
    get isConnected(){return this===document.body || Boolean(this.parent?.isConnected);}
    reportValidity(){return true;}focus(){document.activeElement=this;}
  }
  document.createElement=tag=>new Element(tag);document.body=new Element('body');document.activeElement=document.body;
  globalThis.document=document;globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.after(()=>{globalThis.document=priorDocument;globalThis.Option=priorOption;});
  const root=new Element('div');document.body.append(root);
  const options={disabled,getFrame:()=>frame,canInteract:()=>allowed,seek:seekEnabled?value=>{frames.push(value);frame=value;}:undefined,commit:async operation=>{commands.push(operation);return commit?.(operation);},notice:value=>notices.push(value),openState};
  renderMasks(root,detail,options);
  const all=(node=root)=>[node,...node.children.flatMap(child=>all(child))];
  const button=action=>all().find(element=>element.dataset.pathKeyAction===action);
  return {detail,root,document,commands,frames,notices,openState,options,all,button,setFrame:value=>frame=value,setAllowed:value=>allowed=value,setDialog:value=>dialog=value,click:action=>emit(button(action),'click')};
}

test('path navigation uses native full-track timeline destinations and strict source neighbours',()=>{
  const detail=fixture(),mask=detail.masks.items[0];
  assert.equal(maskPathKeyDestination(detail,mask,45,'previous'),42);assert.equal(maskPathKeyDestination(detail,mask,45,'next'),47);
  mask.path_navigation.previous=null;assert.equal(maskPathKeyDestination(detail,mask,45,'previous'),null);
  for(const direction of ['previous','next']){
    mask.path_navigation[direction]={source_frame:197,timeline_frame:45};assert.throws(()=>maskPathKeyDestination(detail,mask,45,direction),/valid native/);
  }
  assert.throws(()=>maskPathKeyDestination(detail,mask,46,'next'),/current playhead/);
});

test('path diamond clones the evaluated path and removes only a native exact current key',()=>{
  const detail=fixture(),mask=detail.masks.items[0];mask.path.points[0].point=[999,999];
  const operation=maskPathKeyOperation(detail,mask,45);
  assert.deepEqual(operation,{kind:'edit_mask',clip_id:detail.clip_id,edit:{action:'path_key',index:0,timeline_frame:45,path:mask.evaluated_path}});
  operation.edit.path.points[0].point[0]=50;assert.equal(mask.evaluated_path.points[0].point[0],0);
  mask.path_navigation.on_keyframe=true;assert.equal(maskPathKeyOperation(detail,mask,45).edit.path,null);
  assert.throws(()=>maskPathKeyOperation(detail,mask,44),/current playhead/);
  delete mask.path_navigation;assert.throws(()=>maskPathKeyOperation(detail,mask,45),/native path-key navigation/);
});

test('path arrows navigate beyond summarized keys without mutation and suppress global viewer shortcuts',t=>{
  const h=harness(t);assert.equal(h.detail.masks.items[0].path_keys.length,0);assert.equal(h.button('next').disabled,false);
  for(const key of [' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])assert.equal(emit(h.button('next'),'keydown',{key}).stopped,true,key);
  h.click('next');assert.deepEqual(h.frames,[47]);assert.deepEqual(h.commands,[]);
  h.click('previous');assert.deepEqual(h.frames,[47]);assert.match(h.notices[0],/current playhead/);assert.equal(h.button('previous').disabled,true);
});

test('path diamond sends one Linear-native command from the evaluated geometry and then awaits refreshed detail',async t=>{
  let release;const h=harness(t,{commit:()=>new Promise(resolve=>{release=resolve;})});
  h.click('toggle');h.click('toggle');await settle();assert.equal(h.commands.length,1);assert.equal(h.commands[0].edit.path.points[0].point[0],0);
  assert.ok(['previous','toggle','next'].every(action=>h.button(action).disabled));release();await settle();assert.equal(h.button('toggle').disabled,true);
});

test('path controls reject read-only, modal, stale and live permission changes',async t=>{
  for(const mode of ['readonly','dialog','stale','permission']){
    await t.test(mode,async child=>{
      const h=harness(child,{disabled:mode==='readonly'});
      if(mode==='dialog')h.setDialog(true);if(mode==='stale')h.setFrame(46);if(mode==='permission')h.setAllowed(false);
      h.click('next');h.click('toggle');await settle();assert.deepEqual(h.commands,[],mode);assert.deepEqual(h.frames,[],mode);
    });
  }
});

test('unavailable native neighbours and absent seek glue stay disabled while default path editing remains',t=>{
  const detail=fixture();detail.masks.items[0].path_navigation.previous=null;
  const h=harness(t,{detail,seekEnabled:false});assert.equal(h.button('previous').disabled,true);assert.equal(h.button('next').disabled,true);assert.equal(h.button('toggle').disabled,false);
  assert.ok(h.all().some(element=>element.textContent==='Apply path'));assert.ok(h.all().some(element=>element.textContent==='Append vertex'));
});

test('native exact-key diamond removes rather than rewriting evaluated path and a rejected request permits retry',async t=>{
  let count=0;const h=harness(t,{detail:fixture(true),commit:()=>{if(++count===1)throw Error('Native revision changed');}});
  assert.equal(h.button('toggle').getAttribute('aria-pressed'),'true');h.click('toggle');await settle();assert.equal(h.commands[0].edit.path,null);assert.equal(h.button('toggle').disabled,false);assert.deepEqual(h.notices,['Native revision changed']);
  h.click('toggle');await settle();assert.equal(h.commands.length,2);assert.equal(h.commands[1].edit.path,null);
});

test('path navigation restores its focused native control after a refreshed inspector without stealing dialog focus',async t=>{
  const h=harness(t);h.button('next').focus();h.click('next');assert.equal(h.openState.get(`mask-path-key-focus:${h.detail.clip_id}:0`),'next');
  h.document.activeElement=h.document.body;const fresh=structuredClone(h.detail);fresh.timeline_frame=47;fresh.source_frame=205;fresh.masks.items[0].path_navigation={on_keyframe:true,previous:{source_frame:197,timeline_frame:45},next:{source_frame:220,timeline_frame:51}};
  h.root.replaceChildren();renderMasks(h.root,fresh,h.options);await settle();assert.equal(h.document.activeElement.dataset.pathKeyAction,'next');
  h.openState.set(`mask-path-key-focus:${h.detail.clip_id}:0`,'previous');h.document.activeElement=h.document.body;h.setDialog(true);h.root.replaceChildren();renderMasks(h.root,fresh,h.options);await settle();assert.equal(h.document.activeElement,h.document.body);
});
