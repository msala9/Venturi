import test from "node:test";
import assert from "node:assert/strict";
import {bindCurveGesture, curveGeometry, curveHandles, curveKeyOperation, curveGroupOperation, curveGroupDraft, curveViewport} from "../js/curves.js";

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
