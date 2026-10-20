import test from "node:test";
import assert from "node:assert/strict";
import { detailIdentity, propertyOperation, keyframeOperation } from "../js/inspector.js";

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
