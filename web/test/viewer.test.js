import test from "node:test";
import assert from "node:assert/strict";
import { matchesFrame } from "../js/viewer.js";
test("old epochs, generations, revisions and seeks cannot become current", () => {
  const frame = {
    project_epoch: "server:1",
    if_generation: "5",
    timeline_id: "0",
    revision: "abc",
    frame: 24,
    width: 960,
  };
  assert.equal(matchesFrame(frame, { ...frame }), true);
  for (const [key, value] of [
    ["project_epoch", "other:1"],
    ["if_generation", "6"],
    ["timeline_id", "1"],
    ["revision", "old"],
    ["frame", 25],
  ])
    assert.equal(matchesFrame(frame, { ...frame, [key]: value }), false, key);
  assert.equal(matchesFrame(frame, null), false);
});
