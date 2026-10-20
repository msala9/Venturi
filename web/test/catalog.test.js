import test from "node:test";
import assert from "node:assert/strict";
import {folderPaths, mediaSelection} from "../js/catalog.js";

test("media selection supports toggle, anchored ranges and stale IDs without project edits", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({id}));
  assert.deepEqual(mediaSelection(items, [], null, "b"), {selected: ["b"], anchor: "b"});
  assert.deepEqual(mediaSelection(items, ["b"], "b", "d", {extend: true}), {selected: ["b", "c", "d"], anchor: "b"});
  assert.deepEqual(mediaSelection(items, ["b", "c", "d"], "b", "c", {toggle: true}), {selected: ["b", "d"], anchor: "c"});
  assert.deepEqual(mediaSelection(items, ["b"], "b", "gone"), {selected: [], anchor: null});
});

test("folder paths preserve native IDs and terminate on malformed ancestry", () => {
  const folders = [{id: "1", name: "Scene", parent: null}, {id: "2", name: "Takes", parent: "1"}, {id: "3", name: "Cycle", parent: "3"}];
  const paths = folderPaths(folders);
  assert.equal(paths.find((f) => f.id === "2").path, "Scene / Takes");
  assert.equal(paths.find((f) => f.id === "3").path, "Cycle");
  assert.equal(folders[1].name, "Takes");
});
