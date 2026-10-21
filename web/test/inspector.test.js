import test from "node:test";
import assert from "node:assert/strict";
import { detailIdentity, propertyOperation, keyframeOperation,transformPatch,keyPageIndex,transitionSelectionOperation } from "../js/inspector.js";

test('selected transition edits preserve native fields and canonical cut anchor without mutating the snapshot',()=>{
  const target={track_id:'0',clip_id:'9007199254740993',slot:'cut_after',max:48,transition:{kind:'Push',duration:13,direction:'Up',ease:'InOut',curve:0.625}},before=structuredClone(target);
  assert.deepEqual(transitionSelectionOperation(target,{duration:17}),{kind:'set_transition',clip_id:target.clip_id,slot:'cut_after',transition:{...target.transition,duration:17}});
  assert.deepEqual(target,before);assert.equal(transitionSelectionOperation(target,{}),null);assert.equal(transitionSelectionOperation(target,{duration:13,curve:0.625}),null);
  assert.deepEqual(transitionSelectionOperation(target,null),{kind:'set_transition',clip_id:target.clip_id,slot:'cut_after',transition:null});
});

test('selected transition inspector refuses malformed edits before a command is produced',()=>{
  const target={clip_id:'3',slot:'in',max:20,transition:{kind:'SmoothCut',duration:5,direction:'Right',ease:'None',curve:0.5}};
  for(const patch of [{duration:0},{duration:21},{duration:1.5},{curve:NaN},{curve:1.01},{direction:'Diagonal'},{ease:'Invalid'},{kind:'Push'}])assert.throws(()=>transitionSelectionOperation(target,patch));
  assert.throws(()=>transitionSelectionOperation(null,{}));assert.deepEqual(transitionSelectionOperation(target,{ease:'Out',curve:0.75}).transition,{...target.transition,ease:'Out',curve:0.75});
});

test("native key pages validate bounds and distinguish otherwise identical inspector requests",()=>{
  assert.equal(keyPageIndex("10",10),9);
  for(const value of ["",0,11,1.5,Infinity,"bad"])assert.throws(()=>keyPageIndex(value,10));
  assert.notEqual(detailIdentity({clip:"1",key_page:0}),detailIdentity({clip:"1",key_page:1}));
});

test("linked zoom defaults and playhead keys use one existing atomic native request",()=>{
  assert.deepEqual(transformPatch("ZoomX",1.5,true),{transform:[{param:"ZoomX",value:1.5},{param:"ZoomY",value:1.5}]});
  assert.deepEqual(transformPatch("PositionX",10,true),{transform:[{param:"PositionX",value:10}]});
  const request=keyframeOperation("4",{kind:"transform",param:"ZoomY"},48,1.7,"Hold",true);assert.equal(request.kind,"set_keyframes");
  assert.deepEqual(request.edits.map(edit=>edit.target.param),["ZoomY","ZoomX"]);assert.ok(request.edits.every(edit=>edit.timeline_frame===48 && edit.value===1.7 && edit.interpolation==="Hold"));
  assert.ok(keyframeOperation("4",{kind:"transform",param:"ZoomX"},48,null,"Linear",true).edits.every(edit=>edit.value===null));
  assert.equal(keyframeOperation("4",{kind:"transform",param:"Opacity"},48,50,"Hold",true).kind,"set_keyframe");
});

test("inspector reads are isolated by project, revision, selection and playhead", () => {
  const state = { project_epoch: "e:1", generation: "2", timeline: "1", revision: "r", clip: "17", frame: 24 };
  for (const key of Object.keys(state)) assert.notEqual(detailIdentity(state), detailIdentity({ ...state, [key]: "changed" }));
  assert.equal(detailIdentity(null), null);
});
test("property and keyframe commands retain native parameter names and integer timeline frames", () => {
  assert.deepEqual(propertyOperation("17", { blend: "ColorDodge" }), { kind: "set_properties", clip_id: "17", patch: { blend: "ColorDodge" } });
  const operation = keyframeOperation("17", { kind: "transform", param: "PositionX" }, 108, 35, "EaseInOut");
  assert.equal(operation.edit.timeline_frame, 108); assert.equal(operation.edit.value,35);
  assert.equal(keyframeOperation("17", {kind:"gain"}, 24, null).edit.value, null);
  for (const frame of [-1, 1.5, NaN, Infinity]) assert.throws(() => keyframeOperation("17", {kind:"gain"}, frame, 0));
});
