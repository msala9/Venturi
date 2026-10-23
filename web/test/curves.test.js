import test from "node:test";
import assert from "node:assert/strict";
import {bindCurveGesture, curveGeometry, curveHandles, curveHandleOperation, renderCurves, curveKeyOperation, curveGroupOperation, curveGroupDraft, curveViewport,createZoomLink,zoomParameters,createKeyEditorGuard,createKeyPickSelection,keyPickIdentity,pointerKeyOperation,pointerCurveDraft} from "../js/curves.js";
import {renderEventKeys} from '../js/eventkeys.js';

test('native graph selection inserts additive picks, retains peers/pages and shares exact view identities',()=>{
  const state=new Map(),selection=createKeyPickSelection(state,'epoch:tl:clip'),a={target:{kind:'transform',param:'PositionX'},source_frame:10},b={target:{kind:'text'},source_frame:3000};let changes=0;
  const unsubscribe=selection.subscribe(()=>changes++);selection.select(a);selection.select(b,true);selection.select(a,true);selection.select(a);
  assert.deepEqual(selection.get(),[a,b]);assert.equal(changes,2);assert.deepEqual(state.get('all-keys:epoch:tl:clip').ids,[keyPickIdentity(a),keyPickIdentity(b)]);
  selection.replace([a],[{...a,source_frame:12}],{focus:true});assert.deepEqual(selection.get(),[b,{...a,source_frame:12}]);assert.equal(state.get('all-keys:epoch:tl:clip').focus,true);
  const copy=selection.get();copy[0].source_frame=99;assert.equal(selection.get()[0].source_frame,3000);unsubscribe();selection.set([]);assert.equal(changes,3);
  assert.throws(()=>selection.set([a,a]));assert.throws(()=>selection.set([{...a,source_frame:1.5}]));
});

test('native pointer payload moves complete cross-parameter picks but carries only the grabbed scalar value',()=>{
  const target={kind:'transform',param:'PositionX'},picks=[{target,source_frame:10},{target,source_frame:20},{target:{kind:'text'},source_frame:10}],grabbed={target,source_frame:10,value:7};
  assert.deepEqual(pointerKeyOperation('clip',picks,3,grabbed,true),{kind:'edit_key_selection',clip_id:'clip',edit:{picks,link_zoom:true,action:{kind:'drag',delta_source_frames:3,grabbed}}});
  assert.deepEqual(pointerKeyOperation('clip',picks,2).edit.action,{kind:'move',delta_source_frames:2});
  const curve={min:-10,max:10,keys:[{source_frame:10,value:2,interpolation:'Hold'},{source_frame:20,value:9,interpolation:'EaseIn'}]},draft=pointerCurveDraft(curve,[10,20],picks[0],{frame:13,value:20});
  assert.deepEqual(draft.keys,[{source_frame:13,value:10,interpolation:'Hold'},{source_frame:23,value:9,interpolation:'EaseIn'}]);assert.equal(curve.keys[0].source_frame,10);
  assert.throws(()=>pointerKeyOperation('clip',picks,1,{...grabbed,source_frame:99}));assert.throws(()=>pointerKeyOperation('clip',picks,1.5,grabbed));
});

test('native curve drag samples final release with relative time and absolute cursor value, rejecting changed peer selection or viewport',()=>{
  const events={},commands=[],resets=[];let stamp='original',left=0;
  const canvas={isConnected:true,addEventListener:(name,handler)=>events[name]=handler,focus(){},setPointerCapture(){},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({left,top:0,width:100,height:100})};
  bindCurveGesture(canvas,{getCurve:()=>({keys:[{source_frame:10,value:20}]}),getGeometry:()=>({x:x=>x,y:y=>100-y,frame:Math.round,value:y=>100-y}),getSelection:()=>[10],getSelectionIdentity:()=>stamp,isBusy:()=>false,canEdit:()=>true,select(){},draft(){},finish:point=>commands.push(point),reset:()=>resets.push(true)});
  const point=(x,y,extra={})=>({button:0,pointerId:1,buttons:1,clientX:x,clientY:y,...extra});
  events.pointerdown(point(11,82));events.pointermove(point(15,70));assert.deepEqual(commands,[]);events.pointerup(point(19,60));assert.deepEqual(commands,[{frame:18,value:40}]);
  events.pointerdown(point(11,82));events.pointerup(point(11,82));assert.equal(commands.length,1);
  events.pointerdown(point(10,80));events.pointermove(point(20,70));stamp='peer-changed';events.pointerup(point(25,60));assert.equal(commands.length,1);
  events.pointerdown(point(10,80));events.pointermove(point(20,70));left=1;events.pointerup(point(25,60));assert.equal(commands.length,1);assert.ok(resets.length>=3);
});

test("zoom link synchronizes all visible toggles without a native mutation and leaves other parameters independent",()=>{
  const state=new Map(),link=createZoomLink(state);
  const input=()=>({checked:false,addEventListener(name,fn){this.change=fn;}}),a=input(),b=input();link.register(a);link.register(b);
  a.checked=true;a.change();assert.equal(b.checked,true);assert.equal(link.get(),true);assert.equal(state.get("zoom-link"),true);
  const c=input();link.register(c);assert.equal(c.checked,true);b.checked=false;b.change();assert.equal(a.checked,false);assert.equal(c.checked,false);
  assert.deepEqual(zoomParameters("ZoomY",true),["ZoomY","ZoomX"]);assert.deepEqual(zoomParameters("PositionX",true),["PositionX"]);
  const target={kind:"transform",param:"ZoomX"};assert.equal(curveKeyOperation("1",target,0,2,1.5,"Hold",[],true).edit.link_zoom,true);
  assert.equal(curveGroupOperation("1",target,[0,10],2,0.5,false,true).edit.link_zoom,true);
  assert.equal(curveGroupOperation("1",{kind:"gain"},[0],0,1,false,true).edit.link_zoom,undefined);
});

test("group curve drafts share one clamped delta and retain exact source identities without native evaluation",()=>{
  const curve={min:0,max:100,keys:[{source_frame:10,value:20,interpolation:"Hold"},{source_frame:20,value:80,interpolation:"EaseIn"},{source_frame:30,value:50}]};
  const draft=curveGroupDraft(curve,{source_start:0,source_end:40},[10,20],30,50);
  assert.equal(draft.deltaFrame,20);assert.equal(draft.deltaValue,20);
  assert.deepEqual(draft.keys,[{source_frame:30,value:40,interpolation:"Hold"},{source_frame:40,value:100,interpolation:"EaseIn"}]);
  assert.equal(curve.keys[0].source_frame,10);
  assert.equal(curveGroupDraft(curve,{source_start:0,source_end:40},[],1,1),null);
  assert.deepEqual(curveGroupOperation("c",{kind:"gain"},[10,20],2,3),{kind:"edit_curve_keys",clip_id:"c",edit:{target:{kind:"gain"},source_frames:[10,20],delta_source_frames:2,delta_value:3,delete:false}});
  for(const frames of [[],[10,10],[1.5],[Number.MAX_SAFE_INTEGER+1]])assert.throws(()=>curveGroupOperation("c",{},frames,0,0));
  assert.throws(()=>curveGroupOperation("c",{},[1],1.5,0));assert.throws(()=>curveGroupOperation("c",{},[1],1,Infinity));
});

test("curve viewport zoom/pan stays inside source/native value bounds and supports a single-frame clip",()=>{
  const range={source_start:0,source_end:100},curve={min:0,max:100},g={min:0,max:100};
  const zoomed=curveViewport(range,range,curve,g,{zoomX:2,zoomY:2});
  assert.deepEqual(zoomed,{source_start:25,source_end:75,value_min:25,value_max:75});
  const panned=curveViewport(zoomed,range,curve,{min:25,max:75},{panX:1000,panY:-1000});
  assert.deepEqual(panned,{source_start:50,source_end:100,value_min:0,value_max:50});
  const single=curveViewport({source_start:7,source_end:7},{source_start:7,source_end:7},curve,g,{zoomX:2});
  assert.equal(single.source_start,7);assert.equal(single.source_end,7);
  assert.equal(curveViewport(range,range,curve,{min:-10,max:110},{zoomX:2}).value_min,undefined,"Time-only zoom preserves automatic value bounds");
});

test("box selection and group drag are local until release; pan never submits a key edit",()=>{
  const events={},boxes=[],drafts=[],commits=[],pans=[];let selection=[10,20];
  const canvas={addEventListener:(name,fn)=>events[name]=fn,focus(){},setPointerCapture(){},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({left:0,top:0})};
  bindCurveGesture(canvas,{getCurve:()=>({keys:[{source_frame:10,value:20},{source_frame:20,value:40}]}),getGeometry:()=>({x:x=>x,y:y=>y,frame:Math.round,value:y=>y}),getSelection:()=>selection,isBusy:()=>false,canEdit:()=>true,select(){},selectBox:box=>boxes.push(box),draftBox:box=>drafts.push(box),draft:(point,members)=>drafts.push({point,members}),finish:(point,members)=>commits.push({point,members}),pan:value=>pans.push(value),reset(){}});
  const event=(x,y,extra={})=>({button:0,pointerId:1,clientX:x,clientY:y,...extra});
  events.pointerdown(event(0,0));events.pointermove(event(30,60));assert.equal(boxes.length,0);events.pointerup(event(30,60));
  assert.deepEqual(boxes,[{start:0,end:30,min:0,max:60,append:undefined,moved:true}]);assert.equal(commits.length,0);
  events.pointerdown(event(10,20));events.pointermove(event(15,25));assert.equal(commits.length,0);events.pointerup(event(15,25));
  assert.deepEqual(commits,[{point:{frame:15,value:25},members:[10,20]}]);
  events.pointerdown(event(5,5,{button:1}));events.pointermove(event(15,25,{button:1}));events.pointerup(event(15,25,{button:1}));
  assert.equal(commits.length,1);assert.deepEqual(pans,[{frames:-10,value:-20,final:false},{final:true}]);
  selection=[];events.pointerdown(event(10,20,{shiftKey:true}));events.pointermove(event(15,25));events.pointerup(event(15,25));assert.equal(commits.length,1);
});

test("curve edits retain exact source frames, outgoing Bezier and deletion identity", () => {
  const target = {kind: "transform", param: "Opacity"};
  const operation = curveKeyOperation("3", target, 25, 27, 30, "Bezier", [0.2, -0.5, 0.8, 1.5]);
  assert.deepEqual(operation, {kind: "edit_curve_key", clip_id: "3", edit: {target, previous_source_frame: 25, source_frame: 27, value: 30, interpolation: {Bezier: {c1: [0.2, -0.5], c2: [0.8, 1.5]}}}});
  assert.equal(curveKeyOperation("3", target, 25, 25, null, "Hold", []).edit.value, null);
  assert.equal(curveKeyOperation("3", target, -2, -2, null, "Hold", []).edit.previous_source_frame, -2);
  for (const frame of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => curveKeyOperation("3", target, null, frame, 20, "Linear", []));
  assert.throws(() => curveKeyOperation("3", target, null, 25, Infinity, "Linear", []));
  assert.throws(() => curveKeyOperation("3", target, null, 25, 20, "Bezier", [1.1, 0, 0.5, 1]));
});

test("curve drags stay local until one release; Escape, capture loss and disposal cancel", () => {
  const events = {}, commits = [], drafts = [];
  let resets = 0, busy = false, writable = true;
  const canvas = {addEventListener: (name, action) => { events[name] = action; }, focus() {}, setPointerCapture() {}, releasePointerCapture() { events.lostpointercapture(); }, getBoundingClientRect: () => ({left: 0, top: 0})};
  const control = bindCurveGesture(canvas, {
    getCurve: () => ({keys: [{source_frame: 10, value: 20}]}),
    getGeometry: () => ({x: (x) => x, y: (y) => y, frame: Math.round, value: (y) => y}),
    isBusy: () => busy, canEdit: () => writable, select() {},
    draft: (point) => drafts.push(point), finish: (point) => commits.push(point), reset: () => resets++,
  });
  const point = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y});
  events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); events.pointermove(point(25, 40));
  assert.equal(commits.length, 0); assert.equal(drafts.length, 2);
  events.pointerup(point(25, 40)); assert.deepEqual(commits, [{frame: 25, value: 40}]);
  for (const cancel of [() => events.keydown({key: "Escape", stopPropagation() {}, preventDefault() {}}), events.lostpointercapture, events.pointercancel, control.cancel]) {
    events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); cancel(); events.pointerup(point(20, 30));
    assert.equal(commits.length, 1);
  }
  assert.equal(resets, 4);
  busy = true; events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); events.pointerup(point(20, 30));
  busy = false; writable = false; events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); events.pointerup(point(20, 30));
  assert.equal(commits.length, 1);
});

test("curve geometry plots supplied native samples without evaluating interpolation", () => {
  const range = {source_start: 24, source_end: 120};
  const curve = {min: 0, max: 100, samples: [[24, 30], [70, 47.123], [120, 80]], keys: [{source_frame: 25, value: 20}]};
  const g = curveGeometry(curve, range, 300, 190);
  assert.equal(g.frame(g.x(70)), 70);
  assert.equal(g.frame(-1000), 24); assert.equal(g.frame(1000), 120);
  assert.equal(g.value(-1000), 100); assert.equal(g.value(1000), 0);
  assert.ok(Math.abs(g.value(g.y(47.123)) - 47.123) < 1e-9);
  assert.ok(g.min < 20 && g.max > 80);
});

test("Bezier handle coordinates use native controls and one command per completed drag", () => {
  const curve = {min: 0, max: 100, samples: [[7, 20], [18, 90]], keys: [{source_frame: 7, value: 20, controls: [[0.2, -0.5], [0.8, 1.5]]}, {source_frame: 18, value: 90, controls: null}]};
  const handles = curveHandles(curve, 7), g = curveGeometry(curve, {source_start: 7, source_end: 18}, 300, 190, 7);
  assert.equal(handles.length, 2); assert.equal(handles[0].frame, 9.2); assert.equal(handles[0].value, -15);
  assert.ok(g.min < -15 && g.max > 125);
  const normalized = g.control(handles[0], g.x(9.2), g.y(-15));
  assert.ok(Math.abs(normalized[0] - 0.2) < 1e-10); assert.equal(normalized[1], -0.5);
  assert.deepEqual(curveHandles(curve,18),handles);
  const events = {}, drafts = [], commits = [];
  const canvas = {addEventListener: (name, action) => { events[name] = action; }, focus() {}, setPointerCapture() {}, releasePointerCapture() { events.lostpointercapture(); }, getBoundingClientRect: () => ({left: 0, top: 0})};
  bindCurveGesture(canvas, {getCurve: () => curve, getGeometry: () => g, getHandles: () => handles, isBusy: () => false, canEdit: () => true, select() {}, draft() { assert.fail("A handle cannot move a key"); }, draftHandle: (index, point) => drafts.push({index, point}), finish: (point) => commits.push(point), reset() {}});
  const point = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y});
  events.pointerdown(point(g.x(9.2), g.y(-15)));
  events.pointermove(point(g.x(10), g.y(5))); events.pointermove(point(g.x(11), g.y(8)));
  assert.equal(commits.length, 0); assert.equal(drafts.length, 2);
  events.pointerup(point(g.x(11), g.y(8))); assert.equal(commits.length, 1);
});

test('native selected keys show the union of incoming and outgoing segments, including off-page and negative neighbours',()=>{
  const key=(source_frame,value)=>({source_frame,value,controls:[[.2,.3],[.8,.7]],interpolation:{Bezier:{c1:[.2,.3],c2:[.8,.7]}}});
  const before=key(-20,1),first=key(10,3),last=key(30,8),after=key(80,9);
  first.previous_key=before;first.next_key=last;last.previous_key=first;last.next_key=after;
  const curve={keys:[first,last]},handles=curveHandles(curve,new Set([10,30]));
  assert.deepEqual(handles.map(handle=>[handle.segment_frame,handle.index]),[[-20,0],[-20,1],[10,0],[10,1],[30,0],[30,1]]);
  assert.deepEqual(curveHandles(curve,[30]).map(handle=>handle.segment_frame),[10,10,30,30]);assert.equal(curveHandles(curve,[]).length,0);
  const target={kind:'transform',param:'ZoomX'},selection=[{target,source_frame:10},{target:{kind:'text'},source_frame:30}],snapshot=structuredClone(selection),operation=curveHandleOperation('clip',target,handles[1],[.75,1.5],true);
  assert.deepEqual(operation,{kind:'edit_key_selection',clip_id:'clip',edit:{picks:[{target,source_frame:-20}],link_zoom:true,action:{kind:'interpolation',interpolation:{Bezier:{c1:[.2,.3],c2:[.75,1.5]}}}}});assert.deepEqual(selection,snapshot);assert.deepEqual(before.controls,[[.2,.3],[.8,.7]]);
});

test('incoming tangent releases preserve segment identity and current mixed selection, with final release coordinates and Escape cancellation',()=>{
  const curve={min:0,max:100,samples:[[0,0],[20,20]],keys:[{source_frame:0,value:0,controls:[[.2,.2],[.8,.8]]},{source_frame:20,value:20}]},handle=curveHandles(curve,[20])[1],events={},commands=[];let identity='mixed';
  const canvas={isConnected:true,addEventListener:(name,fn)=>events[name]=fn,focus(){},setPointerCapture(){},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({left:0,top:0})},g={x:x=>x,y:y=>y,frame:Math.round,value:y=>y,control:(h,x,y)=>[x/20,y/20]};
  bindCurveGesture(canvas,{getCurve:()=>curve,getGeometry:()=>g,getHandles:()=>[handle],getSelectionIdentity:()=>identity,isBusy:()=>false,canEdit:()=>true,select(){assert.fail('Handle must not replace picks');},draft(){},draftHandle(){},finish:(point,members,segment)=>commands.push(curveHandleOperation('clip',{kind:'gain'},segment,point)),reset(){}});
  const point=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y});events.pointerdown(point(16,16));events.pointermove(point(18,20));events.pointerup(point(19,24));assert.equal(commands.length,1);assert.equal(commands[0].edit.picks[0].source_frame,0);assert.deepEqual(commands[0].edit.action.interpolation.Bezier.c2,[.95,1.2]);
  events.pointerdown(point(16,16));events.pointermove(point(18,20));identity='changed peer';events.pointerup(point(19,24));assert.equal(commands.length,1);
  events.pointerdown(point(16,16));events.pointermove(point(18,20));events.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});events.pointerup(point(19,24));assert.equal(commands.length,1);
});

function renderedCurveHarness(t,{disabled=false,readCurveViewport,presentation='inline',eventEditor=false}={}){
  const prior={document:globalThis.document,window:globalThis.window,Option:globalThis.Option,ResizeObserver:globalThis.ResizeObserver,getComputedStyle:globalThis.getComputedStyle,devicePixelRatio:globalThis.devicePixelRatio};
  class Node{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.events=new Map();this.attributes={};this.isConnected=true;this.value='';this.open=false;this.rect={left:0,top:0,width:400,height:190};this.classList={contains:name=>(this.className || '').split(' ').includes(name)};this.captured=new Set();}
    append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(item=>item!==node);this.children.push(node);node.parentNode=this;node.parentElement=this;}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    remove(){this.isConnected=false;}
    get options(){return this.children;}
    get selectedOptions(){return this.children.filter(node=>node.selected);}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(key,fn){this.events.set(key,[...(this.events.get(key)||[]),fn]);}
    removeEventListener(key,fn){this.events.set(key,(this.events.get(key)||[]).filter(value=>value!==fn));}
    emit(key,patch={}){const event={target:this,currentTarget:this,pointerId:1,button:0,clientX:180,clientY:20,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...patch};for(const fn of this.events.get(key)||[])fn(event);return event;}
    getBoundingClientRect(){return {...this.rect,height:Number.parseFloat(this.style.height)||this.rect.height};}
    getContext(){return this.ctx??=new Proxy({}, {get:(obj,key)=>obj[key]??((...args)=>{(this.calls??=[]).push([key,...args]);})});}
    reportValidity(){return true;}
    focus(){globalThis.document.activeElement=this;}
    setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);this.emit('lostpointercapture',{pointerId:id});}
  }
  const document=new Node('document'),window=new Node('window');document.createElement=tag=>new Node(tag);document.querySelector=()=>null;document.defaultView=window;document.body=new Node('body');document.activeElement=document.body;window.devicePixelRatio=1;window.ResizeObserver=class{observe(){}disconnect(){}};window.getComputedStyle=()=>({getPropertyValue:()=>''});
  Object.assign(globalThis,{document,window,ResizeObserver:window.ResizeObserver,getComputedStyle:window.getComputedStyle,devicePixelRatio:1,Option:class extends Node{constructor(label,value){super('option');this.textContent=label;this.value=value;}}});
  const root=new Node('root'),selection=createKeyPickSelection(),commands=[],notices=[],state=new Map([['curves',true],['event-keys',true]]),target={kind:'transform',param:'PositionX'},detail={project_epoch:'epoch',generation:'7',timeline_id:'tl',revision:'rev',clip_id:'clip',source_frame:10,timeline_frame:10,video:false,curves:{source_start:0,source_end:20,tracks:[{name:'Position X',target,key_count:2,min:-100,max:100,default:0,samples:[[0,0],[20,20]],keys:[{source_frame:0,timeline_frame:0,value:0,controls:[[.2,.2],[.8,.8]]},{source_frame:20,timeline_frame:20,value:20}]}]},event_keys:[{name:'Text',target:{kind:'text'},default:'Native text',key_count:1,keys:[{source_frame:10,timeline_frame:10,value:'Native text'}]}]};
  let available=true;const control=(eventEditor?renderEventKeys:renderCurves)(root,detail,{disabled,commit:operation=>commands.push(operation),notice:message=>notices.push(message),openState:state,keySelection:selection,canInteract:()=>available,canNavigate:()=>available,readCurveViewport,presentation});
  t.after(()=>{control.dispose();Object.assign(globalThis,prior);});
  const all=node=>[node,...node.children.flatMap(all)],find=label=>all(root).find(node=>node.attributes['aria-label']===label),graph=find(eventEditor?'Native RGBA text and direction key times':'Native keyframe curve. Select keys below for keyboard editing.');
  return {root,selection,commands,notices,state,control,target,detail,graph,window,document,all:()=>all(root),find,setAvailable:value=>available=value};
}

test('typed row activation blanks only scalar controls, keeps mixed deletion and restores manual scalar choice',async t=>{
  const h=renderedCurveHarness(t);h.selection.set([{target:h.target,source_frame:0},{target:{kind:'text'},source_frame:10}]);h.selection.activate({kind:'text'});
  assert.ok(h.all().some(node=>node.textContent?.startsWith('No scalar curve for text')));const key=h.find('Curve keyframe');assert.equal(key.hidden,true);
  const before=h.selection.get();h.graph.emit('keydown',{key:'a',ctrlKey:true});assert.deepEqual(h.selection.get(),before);h.graph.emit('pointerdown');h.graph.emit('pointerup',{clientX:240});assert.deepEqual(h.commands,[]);
  h.graph.emit('keydown',{key:'Delete'});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit.picks,before);assert.deepEqual(h.commands[0].edit.action,{kind:'delete'});
  h.find('Curve parameter').value='0';h.find('Curve parameter').emit('change');assert.equal(key.hidden,false);assert.ok(!h.all().some(node=>node.textContent?.startsWith('No scalar curve for text')));
});

test('floating presentation leaves graph and animated lanes primary while preserving collapsed numeric and view controls',t=>{
  const h=renderedCurveHarness(t,{presentation:'window'}),section=h.all().find(node=>node.dataset.visualPath==='curves'),values=h.all().find(node=>node.dataset.visualPath==='curve-key-values'),viewport=h.all().find(node=>node.dataset.visualPath==='curve-view-controls');
  assert.equal(section.open,true);assert.equal(values.open,false);assert.equal(viewport.open,false);
  assert.ok(values.children.includes(h.find('Curve keyframe')));assert.ok(values.children.some(node=>node.tagName==='form'));
  assert.ok(viewport.children.some(node=>node.className==='tools curve-viewport-tools'));
  assert.ok(section.children.includes(h.graph));assert.ok(section.children.some(node=>node.className==='keyframe-lanes'));
  h.selection.activate({kind:'text'});assert.equal(values.hidden,true);h.selection.activate(h.target);assert.equal(values.hidden,false);
});

test('curve and lane wheel share one time viewport, keep readonly navigation and never send edit commands',t=>{
  const h=renderedCurveHarness(t,{disabled:true});const zoom=h.graph.emit('wheel',{deltaY:-100,deltaX:0,altKey:true,clientX:280});assert.equal(zoom.defaultPrevented,true);assert.equal(zoom.stopped,true);
  const saved=()=>[...h.state].find(([key])=>key.startsWith('curves-viewport:'))?.[1],first=saved();assert.ok(first.source_end-first.source_start<20);
  const lanes=h.all().find(node=>node.className==='keyframe-lanes-canvas'),pan=lanes.emit('wheel',{deltaX:30,deltaY:0});assert.equal(pan.defaultPrevented,true);assert.ok(saved().source_start>=first.source_start);assert.equal(h.commands.length,0);
  const plain=lanes.emit('wheel',{deltaX:0,deltaY:20});assert.equal(plain.defaultPrevented,undefined);h.setAvailable(false);const captured=structuredClone(saved());h.graph.emit('wheel',{deltaY:-100,altKey:true});assert.deepEqual(saved(),captured);
});

test('accepted native overshoot samples survive selection and horizontal pointer drafts without shifting the grabbed value',async t=>{
  const reads=[];let h;
  h=renderedCurveHarness(t,{readCurveViewport:async query=>{const samples=Array.from({length:query.points},(_,index)=>[query.source_start+(query.source_end-query.source_start)*index/(query.points-1),index===Math.floor(query.points/2)?500:index===query.points-1?20:0]);const value={...h.detail,...query,samples};reads.push(value);return value;}});
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(reads.length,1);
  const g=curveGeometry({...h.detail.curves.tracks[0],samples:reads[0].samples},{source_start:0,source_end:20},400,190,[],110),point={clientX:g.x(0),clientY:g.y(0)};
  h.graph.emit('pointerdown',point);assert.deepEqual(h.selection.get(),[{target:h.target,source_frame:0}]);assert.equal(reads.length,1);
  h.graph.calls=[];h.graph.emit('pointermove',{clientX:point.clientX+15,clientY:point.clientY});assert.equal(h.commands.length,0);
  const peak=reads[0].samples.find(sample=>sample[1]===500);assert.ok(h.graph.calls.some(([kind,x,y])=>kind==='lineTo' && Math.abs(x-g.x(peak[0]))<1e-8 && Math.abs(y-g.y(500))<1e-8));
  h.graph.emit('pointerup',{clientX:point.clientX+15,clientY:point.clientY});for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(h.commands.length,1);assert.equal(h.commands[0].edit.action.delta_source_frames,1);assert.ok(Math.abs(h.commands[0].edit.action.grabbed.value)<1e-8);assert.equal(reads.length,1);
});

test('dedicated key editor ownership rejects detached, disposed, read-only and changed Inspector scopes',async()=>{
  const root={isConnected:true},section={isConnected:true},commands=[];let scope='captured';
  const owner=createKeyEditorGuard({root,section,disabled:false,canInteract:()=>scope==='captured',commit:async operation=>commands.push(operation)});
  const operation=curveKeyOperation('clip',{kind:'transform',param:'Opacity'},12,13,75,'EaseOut',[]);
  for(const change of [()=>{root.isConnected=false;},()=>{section.isConnected=false;},()=>{scope='playback/modal/busy/selection/epoch changed';}]){
    root.isConnected=section.isConnected=true;scope='captured';change();await assert.rejects(owner.commit(operation),/context changed/);
  }
  root.isConnected=section.isConnected=true;scope='captured';owner.dispose();await assert.rejects(owner.commit(operation),/context changed/);
  const readOnly=createKeyEditorGuard({root,section,disabled:true,canInteract:()=>true,commit:async operation=>commands.push(operation)});await assert.rejects(readOnly.commit(operation),/context changed/);assert.deepEqual(commands,[]);
});

test('key editor rechecks its captured owner before committing, including cancellation between dispatch and microtask',async()=>{
  let current=true;const commands=[],root={isConnected:true},section={isConnected:true};
  const owner=createKeyEditorGuard({root,section,disabled:false,canInteract:()=>current,commit:async operation=>commands.push(operation)});
  const operation=curveGroupOperation('clip',{kind:'gain'},[3,12],2,-1);
  const pending=owner.commit(operation);current=false;await assert.rejects(pending,/context changed/);assert.deepEqual(commands,[]);
  current=true;const canceled=owner.commit(operation);owner.dispose();await assert.rejects(canceled,/context changed/);assert.deepEqual(commands,[]);
});

test('dedicated key editor permits one exact native request at a time and never replays an unknown result',async()=>{
  let resolve,current=true;const commands=[],root={isConnected:true},section={isConnected:true};
  const operation=curveKeyOperation('clip',{kind:'transform',param:'Rotation'},40,41,35,'Bezier',[.2,-.5,.8,1.5]);
  const owner=createKeyEditorGuard({root,section,disabled:false,canInteract:()=>current,commit:request=>{commands.push(request);return new Promise(done=>{resolve=done;});}});
  const pending=owner.commit(operation);await assert.rejects(owner.commit(operation),/context changed/);assert.deepEqual(commands,[operation]);resolve({command_id:'ack'});assert.deepEqual(await pending,{command_id:'ack'});
  const uncertain=createKeyEditorGuard({root,section,disabled:false,canInteract:()=>current,commit:async request=>{commands.push(request);current=false;throw Error('Command outcome unknown');}});
  await assert.rejects(uncertain.commit(operation),/outcome unknown/);await assert.rejects(uncertain.commit(operation),/context changed/);assert.equal(commands.length,2);
});

test('key guard reusable cancellation drops only undispatched edits and retains the dispatched unknown-outcome fence',async()=>{
  const root={isConnected:true},section={isConnected:true},commands=[],operation=curveGroupOperation('clip',{kind:'gain'},[3,12],2,-1);
  const owner=createKeyEditorGuard({root,section,disabled:false,commit:async value=>commands.push(value)});
  const canceled=owner.commit(operation);owner.cancel();await assert.rejects(canceled,error=>error.code==='KEY_EDIT_CANCELED');assert.deepEqual(commands,[]);assert.equal(owner.current(),true);
  await owner.commit(operation);assert.deepEqual(commands,[operation]);owner.dispose();await assert.rejects(owner.commit(operation),/context changed/);
  let reject;const pending=createKeyEditorGuard({root,section,disabled:false,commit:value=>{commands.push(value);return new Promise((resolve,fail)=>{reject=fail;});}}),flight=pending.commit(operation);
  await Promise.resolve();pending.cancel();await assert.rejects(pending.commit(operation),/context changed/);assert.equal(commands.length,2);
  reject(Object.assign(Error('Resolve this exact native command before editing'),{code:'OUTCOME_UNKNOWN'}));await assert.rejects(flight,/exact native command/);pending.cancel();assert.equal(pending.current(),false);await assert.rejects(pending.commit(operation),/context changed/);assert.equal(commands.length,2);pending.dispose();
});

test('scalar editor blur cancels its draft and queued edit while keeping lanes, mixed selection and a fresh gesture mounted',async t=>{
  const h=renderedCurveHarness(t,{presentation:'window'}),picks=[{target:h.target,source_frame:0},{target:{kind:'text'},source_frame:10}];h.selection.set(picks);
  const lanes=h.all().find(node=>node.className==='keyframe-lanes'),g=curveGeometry(h.detail.curves.tracks[0],{source_start:0,source_end:20},400,190,[0],110),point={clientX:g.x(0),clientY:g.y(0)};
  h.graph.emit('pointerdown',point);h.graph.emit('pointermove',{clientX:point.clientX+15,clientY:point.clientY});h.window.emit('blur');h.graph.emit('pointerup',{clientX:point.clientX+15,clientY:point.clientY});
  assert.deepEqual(h.commands,[]);assert.deepEqual(h.selection.get(),picks);assert.equal(h.graph.captured.size,0);assert.equal(lanes.isConnected,true);
  const source=h.all().find(node=>node.tagName==='input' && node.parentElement?.textContent==='Key source frame');source.value=1;const value=h.all().find(node=>node.tagName==='input' && node.parentElement?.textContent==='Key value');value.value=5;source.parentElement.parentElement.emit('submit');h.control.cancel();
  for(let i=0;i<8;i++)await Promise.resolve();assert.deepEqual(h.commands,[]);assert.deepEqual(h.selection.get(),picks);assert.deepEqual(h.notices,[]);
  h.document.activeElement=h.document.body;h.graph.emit('pointerdown',point);h.graph.emit('pointerup',{clientX:point.clientX+15,clientY:point.clientY});for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(h.commands.length,1);assert.equal(h.commands[0].edit.picks.length,2);assert.equal(h.commands[0].edit.action.delta_source_frames,1);assert.equal(lanes.isConnected,true);
  h.control.dispose();assert.equal(lanes.isConnected,false);h.graph.emit('pointerdown',point);h.graph.emit('pointerup',{clientX:point.clientX+30,clientY:point.clientY});assert.equal(h.commands.length,1);assert.equal((h.graph.events.get('pointerdown') || []).length,0);
});

test('typed event editor survives blur and shared selection changes, cancels queued native values and disposes permanently',async t=>{
  const h=renderedCurveHarness(t,{eventEditor:true}),pick={target:{kind:'text'},source_frame:10};h.selection.set([pick]);
  h.graph.emit('pointerdown',{clientX:200,clientY:34});h.graph.emit('pointermove',{clientX:218,clientY:34});h.window.emit('blur');h.graph.emit('pointerup',{clientX:218,clientY:34});assert.deepEqual(h.commands,[]);assert.deepEqual(h.selection.get(),[pick]);assert.equal(h.graph.captured.size,0);
  const source=h.all().find(node=>node.tagName==='input' && node.parentElement?.textContent==='Value key source frame'),text=h.all().find(node=>node.tagName==='textarea');source.value=11;text.value='Unconfirmed text';source.parentElement.parentElement.emit('submit');h.control.cancel();for(let i=0;i<8;i++)await Promise.resolve();assert.deepEqual(h.commands,[]);assert.deepEqual(h.selection.get(),[pick]);assert.deepEqual(h.notices,[]);
  h.selection.set([]);h.selection.set([pick]);assert.equal(h.find('Value keyframe').value,'10');h.graph.emit('pointerdown',{clientX:200,clientY:34});h.graph.emit('pointerup',{clientX:218,clientY:34});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit.picks,[pick]);assert.equal(h.commands[0].edit.action.delta_source_frames,1);
  h.control.dispose();h.graph.emit('pointerdown',{clientX:200,clientY:34});h.graph.emit('pointerup',{clientX:230,clientY:34});source.parentElement.parentElement.emit('submit');for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.commands.length,1);assert.equal((h.graph.events.get('pointerdown') || []).length,0);
});

test('key pointer begin, drafts and release are scoped to live ownership and release capture on cancellation',()=>{
  const events={},commits=[],drafts=[],captures=[],releases=[];let current=true,busy=false;
  const canvas={isConnected:true,addEventListener:(name,handler)=>events[name]=handler,focus(){},setPointerCapture:id=>captures.push(id),releasePointerCapture(id){releases.push(id);events.lostpointercapture();},getBoundingClientRect:()=>({left:0,top:0})};
  bindCurveGesture(canvas,{getCurve:()=>({keys:[{source_frame:10,value:20}]}),getGeometry:()=>({x:x=>x,y:y=>y,frame:Math.round,value:y=>y}),isBusy:()=>busy,canEdit:()=>true,canInteract:()=>current,select(){},draft:point=>drafts.push(point),draftBox:box=>drafts.push(box),pan:point=>drafts.push(point),finish:point=>commits.push(point),reset(){}});
  const point=(x,y,extra={})=>({button:0,pointerId:1,clientX:x,clientY:y,...extra});
  current=false;events.pointerdown(point(10,20));assert.deepEqual(captures,[]);
  for(const origin of [point(10,20),point(0,0),point(0,0,{button:1})]){
    current=true;events.pointerdown(origin);current=false;events.pointermove(point(25,35));events.pointerup(point(25,35));
  }
  current=true;events.pointerdown(point(10,20));events.pointermove(point(25,35));const draftsBefore=drafts.length;canvas.isConnected=false;events.pointerup(point(25,35));assert.equal(drafts.length,draftsBefore);
  canvas.isConnected=true;events.pointerdown(point(10,20));busy=true;events.pointerup(point(25,35));
  assert.deepEqual(commits,[]);assert.equal(releases.length,captures.length);
});
