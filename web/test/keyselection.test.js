import {test} from "node:test";
import assert from "node:assert/strict";
import {keySelectionOperation,retainedCrossKeys,mergeCrossSelection,renderKeySelection} from "../js/keyselection.js";
import {createKeyPickSelection} from '../js/curves.js';

test("cross-page selection retains hidden native picks and changes only the displayed list",()=>{
  const a={target:{kind:"transform",param:"ZoomX"},source_frame:2},b={target:{kind:"text"},source_frame:2200},c={target:{kind:"gain"},source_frame:2};
  const id=p=>JSON.stringify([p.target,p.source_frame]);
  let selection=mergeCrossSelection([], [a,c], [a,c]);
  selection=mergeCrossSelection(selection,[b],[b]);assert.deepEqual(selection,[id(a),id(c),id(b)]);
  selection=mergeCrossSelection(selection,[a,c],[c]);assert.deepEqual(selection,[id(b),id(c)]);
  assert.deepEqual(mergeCrossSelection(selection,[],[]),selection);
  assert.deepEqual(mergeCrossSelection(selection,[b],[]),[id(c)]);
  assert.throws(()=>mergeCrossSelection(Array.from({length:2048},(_,index)=>id({...a,source_frame:index})),[b],[b]));
});

test("cross-parameter operations preserve native target identities and source coordinates",()=>{
  const picks=[{target:{kind:"transform",param:"ZoomX"},source_frame:10},{target:{kind:"text"},source_frame:10}];
  const action={kind:"move",delta_source_frames:2};
  assert.deepEqual(keySelectionOperation("c",picks,action,true),{kind:"edit_key_selection",clip_id:"c",edit:{picks,link_zoom:true,action}});
  assert.equal(keySelectionOperation("c",picks,{kind:"delete"}).edit.link_zoom,false);
  for(const invalid of [[],[picks[0],picks[0]],[{...picks[0],source_frame:1.5}],Array(2049).fill(picks[0])])assert.throws(()=>keySelectionOperation("c",invalid,action));
  assert.throws(()=>keySelectionOperation("c",picks,{kind:"move",delta_source_frames:Infinity}));
  assert.throws(()=>keySelectionOperation("c",picks,{kind:"unknown"}));
});
test("selection survives rejection and tracks confirmed movement without confusing same-frame targets",()=>{
  const before=[{target:{kind:"gain"},source_frame:10},{target:{kind:"text"},source_frame:10}];
  const after=before.map(p=>({...p,source_frame:12}));
  const ids=keys=>keys.map(p=>JSON.stringify([p.target,p.source_frame]));
  const pending={before:ids(before),after:ids(after)};
  assert.deepEqual(retainedCrossKeys(pending,before),ids(before));
  assert.deepEqual(retainedCrossKeys(pending,after),ids(after));
  assert.deepEqual(retainedCrossKeys(ids(before),[before[1]]),[ids(before)[1]]);
  assert.deepEqual(retainedCrossKeys(pending,[]),[]);
});

test('Edit Delete can discover native key ownership without sending clip edits through readonly or canceled key controls',async()=>{
  const previousDocument=globalThis.document,previousOption=globalThis.Option;
  class Element extends EventTarget{constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.isConnected=true;this.value='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(){}reportValidity(){return true;}focus(){}}
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  const target={kind:'transform',param:'ZoomX'},picks=[{target,source_frame:10}],root=new Element('div'),commands=[],notices=[];let chosen=picks,listener,allowed=false,control;
  const selection={get:()=>chosen,set(value){chosen=value;listener?.();},subscribe(callback){listener=callback;return()=>{listener=null;};}};
  try{
    control=renderKeySelection(root,{clip_id:'clip',curves:{tracks:[{name:'Zoom X',target,key_count:1,keys:[{source_frame:10,timeline_frame:20}]}]}},{disabled:false,commit:async operation=>{commands.push(operation);},notice:message=>notices.push(message),openState:new Map(),canInteract:()=>allowed,keySelection:selection});
    assert.equal(control.hasSelectedKeys(),true);await control.removeSelected();assert.deepEqual(commands,[]);assert.equal(control.hasSelectedKeys(),true);
    allowed=true;const queued=control.removeSelected();control.cancel();await queued;assert.deepEqual(commands,[]);assert.deepEqual(chosen,picks);assert.deepEqual(notices,[]);
    await control.removeSelected();assert.deepEqual(commands,[{kind:'edit_key_selection',clip_id:'clip',edit:{picks,link_zoom:false,action:{kind:'delete'}}}]);assert.equal(control.hasSelectedKeys(),false);
    selection.set(picks);control.cancel();assert.equal(control.hasSelectedKeys(),true,'Cancel keeps the mounted key selection and its Delete ownership');await control.removeSelected();assert.equal(commands.length,2);
    selection.set(picks);control.dispose();assert.equal(control.hasSelectedKeys(),true);await control.removeSelected();assert.equal(commands.length,2);assert.equal(listener,null);
  }finally{control?.dispose();globalThis.document=previousDocument;globalThis.Option=previousOption;}
});

function presetHarness(t,{disabled=false,typedOnly=false,commit}={}){
  const previous={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.isConnected=true;this.value='';}
    append(...nodes){for(const node of nodes){if(typeof node==='object')node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    insertBefore(node,before){node.parentElement=this;this.children.splice(this.children.indexOf(before),0,node);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.isConnected=false;}
    setAttribute(name,value){this.attributes[name]=value;}
    querySelector(selector){return selector==='[data-key-interpolation-toolbar]'?this.children.find(node=>'keyInterpolationToolbar' in node.dataset):null;}
    reportValidity(){return true;}
    focus(){globalThis.document.activeElement=this;}
  }
  const root=new Element('div'),slot=new Element('div');slot.dataset.keyInterpolationToolbar='';if(!typedOnly)root.append(slot);
  globalThis.document={createElement:tag=>new Element(tag),body:new Element('body'),hasFocus:()=>true};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  const x={kind:'transform',param:'ZoomX'},y={kind:'transform',param:'ZoomY'},text={kind:'text'},commands=[],notices=[],state={allowed:true};
  const detail={clip_id:'clip',curves:{tracks:typedOnly?[]:[{target:x,name:'Zoom X',key_count:1,keys:[{source_frame:10,timeline_frame:30,interpolation:'Linear'}]},{target:y,name:'Zoom Y',key_count:1,keys:[{source_frame:10,timeline_frame:30,interpolation:'Hold'}]}]},event_keys:[{target:text,name:'Text',key_count:2,keys:[{source_frame:20,timeline_frame:40,interpolation:'Hold'}]}]};
  const selection=createKeyPickSelection(new Map(),'scope'),control=renderKeySelection(root,detail,{disabled,commit:operation=>{commands.push(operation);return commit?.(operation) ?? Promise.resolve();},notice:message=>notices.push(message),openState:new Map(),canInteract:()=>state.allowed,keySelection:selection});
  const all=()=>{const visit=node=>typeof node==='object'?[node,...node.children.flatMap(visit)]:[];return visit(root);},buttons=all().filter(node=>node.className==='key-interpolation-preset');
  const click=index=>buttons[index].dispatchEvent(new Event('click'));
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  t.after(()=>{control.dispose();globalThis.document=previous.document;globalThis.Option=previous.Option;});
  return {root,slot,control,selection,commands,notices,state,detail,x,y,text,buttons,all,click,flush};
}

test('five native interpolation presets act on shared mixed source picks without changing selection or Bezier controls',async t=>{
  const h=presetHarness(t),toolbar=h.all().find(node=>node.className==='key-interpolation-presets');
  assert.equal(toolbar.parentElement,h.slot);assert.equal(toolbar.attributes.role,'group');
  assert.deepEqual(h.buttons.map(button=>button.attributes['aria-label']),['Hold','Linear','EaseInOut','EaseIn','EaseOut'].map(mode=>`Set selected keys ${mode}`));
  assert.ok(h.buttons.every(button=>button.disabled));h.click(0);await h.flush();assert.deepEqual(h.commands,[]);
  const picks=[{target:h.x,source_frame:10},{target:h.text,source_frame:2400}];h.selection.set(picks);
  h.all().find(node=>node.tag==='input' && node.type==='checkbox').checked=true;
  h.click(2);h.click(3);await h.flush();
  assert.deepEqual(h.commands,[{kind:'edit_key_selection',clip_id:'clip',edit:{picks,link_zoom:true,action:{kind:'interpolation',interpolation:'EaseInOut'}}}]);
  assert.deepEqual(h.selection.get(),picks);assert.ok(h.all().some(node=>node.attributes['aria-label']==='Cross-parameter interpolation'));assert.ok(h.all().some(node=>node.textContent==='Cross-parameter Bezier controls'));
  h.buttons[0].dispatchEvent(new Event('pointermove'));await h.flush();assert.equal(h.commands.length,1);
});

test('preset no-ops include linked Zoom twins without suppressing their native edits',async t=>{
  const h=presetHarness(t);h.selection.set([{target:h.x,source_frame:10}]);h.click(1);await h.flush();assert.deepEqual(h.commands,[]);
  const linked=h.all().find(node=>node.tag==='input' && node.type==='checkbox');linked.checked=true;
  h.click(1);await h.flush();assert.equal(h.commands.length,1,'The different native Zoom Y twin must also become Linear');
  h.detail.curves.tracks[1].keys[0].interpolation='Linear';h.click(1);await h.flush();assert.equal(h.commands.length,1);
  h.selection.set([{target:h.text,source_frame:20}]);h.click(0);await h.flush();assert.equal(h.commands.length,1);
});

test('typed-only presets stay outside the collapsed advanced panel and consume modified keyboard activation',async t=>{
  const typed=presetHarness(t,{typedOnly:true});typed.selection.set([{target:typed.text,source_frame:20}]);
  const key=Object.assign(new Event('keydown',{cancelable:true}),{key:' ',ctrlKey:true});typed.buttons[4].dispatchEvent(key);assert.equal(key.defaultPrevented,true);
  typed.buttons[4].dispatchEvent(Object.assign(new Event('click'),{ctrlKey:true}));await typed.flush();assert.deepEqual(typed.commands,[]);
  typed.click(4);await typed.flush();
  assert.equal(typed.root.children[0].className,'key-interpolation-presets');assert.deepEqual(typed.commands[0].edit.action,{kind:'interpolation',interpolation:'EaseOut'});
});

test('preset guards cancel queued stale selections, recover after cancel and fence dispatched unknown outcomes',async t=>{
  let reject;const h=presetHarness(t,{commit:()=>new Promise((resolve,fail)=>{reject=fail;})}),pick={target:h.x,source_frame:10},other={target:h.text,source_frame:20};
  h.selection.set([pick]);h.click(3);h.selection.set([other]);await h.flush();assert.deepEqual(h.commands,[]);assert.deepEqual(h.selection.get(),[other]);assert.deepEqual(h.notices,[]);
  h.click(3);h.control.cancel();await h.flush();assert.deepEqual(h.commands,[]);
  h.state.allowed=false;h.click(3);await h.flush();assert.deepEqual(h.commands,[]);
  h.state.allowed=true;h.root.isConnected=false;h.click(3);await h.flush();assert.deepEqual(h.commands,[]);h.root.isConnected=true;
  h.click(3);await h.flush();assert.equal(h.commands.length,1);h.click(4);await h.flush();assert.equal(h.commands.length,1);
  reject(Object.assign(Error('Resolve this native command'),{code:'OUTCOME_UNKNOWN'}));await h.flush();h.control.cancel();h.click(4);await h.flush();assert.equal(h.commands.length,1);assert.ok(h.buttons.every(button=>button.disabled));assert.deepEqual(h.selection.get(),[other]);
  h.control.dispose();h.click(4);await h.flush();assert.equal(h.commands.length,1);
});

test('read-only presets refuse writes even through a synthetic default action',async t=>{
  const h=presetHarness(t,{disabled:true});h.selection.set([{target:h.text,source_frame:20}]);h.click(3);await h.flush();assert.deepEqual(h.commands,[]);assert.ok(h.buttons.every(button=>button.disabled));
});
