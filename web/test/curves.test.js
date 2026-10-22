import test from "node:test";
import assert from "node:assert/strict";
import {bindCurveGesture, curveGeometry, curveHandles, curveKeyOperation, curveGroupOperation, curveGroupDraft, curveViewport,createZoomLink,zoomParameters,createKeyEditorGuard,createKeyPickSelection,keyPickIdentity,pointerKeyOperation,pointerCurveDraft} from "../js/curves.js";

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
  assert.deepEqual(curveHandles(curve, 18), []);
  const events = {}, drafts = [], commits = [];
  const canvas = {addEventListener: (name, action) => { events[name] = action; }, focus() {}, setPointerCapture() {}, releasePointerCapture() { events.lostpointercapture(); }, getBoundingClientRect: () => ({left: 0, top: 0})};
  bindCurveGesture(canvas, {getCurve: () => curve, getGeometry: () => g, getHandles: () => handles, isBusy: () => false, canEdit: () => true, select() {}, draft() { assert.fail("A handle cannot move a key"); }, draftHandle: (index, point) => drafts.push({index, point}), finish: (point) => commits.push(point), reset() {}});
  const point = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y});
  events.pointerdown(point(g.x(9.2), g.y(-15)));
  events.pointermove(point(g.x(10), g.y(5))); events.pointermove(point(g.x(11), g.y(8)));
  assert.equal(commits.length, 0); assert.equal(drafts.length, 2);
  events.pointerup(point(g.x(11), g.y(8))); assert.equal(commits.length, 1);
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
