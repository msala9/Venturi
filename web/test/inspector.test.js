import test from "node:test";
import assert from "node:assert/strict";
import { detailIdentity, propertyOperation, keyframeOperation,transformPatch,keyPageIndex } from "../js/inspector.js";

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
