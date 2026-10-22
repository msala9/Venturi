import test from "node:test";
import assert from "node:assert/strict";
import {folderPaths, mediaSelection,visibleMediaDemand} from "../js/catalog.js";

test('pool derivative demand contains only intersecting native video/still thumbnails, never hidden, offline or compound media',()=>{
  const items=[{id:'video',has_video:true},{id:'still',has_video:true,is_image:true},{id:'audio',has_audio:true},{id:'hidden',has_video:true},{id:'offline',has_video:true,offline:true},{id:'compound',has_video:true,compound_timeline_id:'nested'}];
  assert.deepEqual(visibleMediaDemand(items,new Set(['video','still','audio','offline','compound'])),[{media_id:'video',audio_stream_index:0,include_waveform:false},{media_id:'still',audio_stream_index:0,include_waveform:false}]);
  assert.deepEqual(visibleMediaDemand(items,new Set()),[]);
});

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
