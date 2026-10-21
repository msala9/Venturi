import test from "node:test";
import assert from "node:assert/strict";
import {
  frameToX,
  xToFrame,
  snapFrame,
  hitTest,
  validateDraft,
  linkedSelection,
  playheadSelection,
} from "../js/timeline/geometry.js";
import { fixtureTimeline } from "../js/timeline/index.js";
import { createInput } from "../js/timeline/input.js";
const view = { scale: 120, origin: 17, scrollY: 0 };
test("playhead selection matches visible native video order, linked groups and locked targets",()=>{
  const clip=(id,start,length,group=null)=>({id,start_frame:start,length_frames:length,linked_group:group});
  const timeline={tracks:[{kind:"video",clips:[clip("bottom",0,30,"pair")]},{kind:"audio",clips:[clip("audio",0,30,"pair")]},{kind:"video",clips:[clip("top",10,10)]}]};
  assert.deepEqual(playheadSelection(timeline,5),["bottom","audio"]);assert.deepEqual(playheadSelection(timeline,10),["top"]);assert.deepEqual(playheadSelection(timeline,20),["bottom","audio"]);assert.deepEqual(playheadSelection(timeline,30),[]);
  timeline.tracks[2].muted=true;assert.deepEqual(playheadSelection(timeline,15),["bottom","audio"]);timeline.tracks[2].muted=false;timeline.tracks[2].clips[0].disabled=true;assert.deepEqual(playheadSelection(timeline,15),["bottom","audio"]);
  timeline.tracks[0].locked=true;assert.deepEqual(playheadSelection(timeline,15),["audio"]);timeline.tracks[1].locked=true;assert.deepEqual(playheadSelection(timeline,15),[]);assert.deepEqual(playheadSelection(null,0),[]);
});
for (const fps of [
  { num: 24000, den: 1001 },
  { num: 30000, den: 1001 },
])
  test(`frame coordinates roundtrip at ${fps.num}/${fps.den}`, () => {
    for (const frame of [0, 1, 17, 200, 999999])
      assert.equal(xToFrame(frameToX(frame, view, fps), view, fps), frame);
    assert.equal(snapFrame(101, [100], view, fps), 100);
    assert.equal(snapFrame(140, [100], view, fps), 140);
  });
test("safe move rejects occupied destinations, allows adjacency, checks locks", () => {
  const timeline = fixtureTimeline(),
    track = timeline.tracks[0],
    clip = track.clips[0];
  const change = {
    clip_id: clip.id,
    to_track: track.id,
    to_start_frame: 150,
    length_frames: 120,
  };
  assert.match(validateDraft(timeline, [change]), /Overlap/);
  assert.equal(
    validateDraft(timeline, [{ ...change, to_start_frame: 9450 }]),
    null,
  );
  track.locked = true;
  assert.match(validateDraft(timeline, [change]), /locked/);
});
test("fixture has 500 clips, hit zones and linked selection use string IDs", () => {
  const timeline = fixtureTimeline();
  assert.equal(timeline.tracks.flatMap((t) => t.clips).length, 500);
  const v = { ...view, origin: 0 };
  assert.equal(hitTest(152, 45, timeline, v).kind, "trim_start");
  timeline.tracks[0].clips[0].linked_group = "g";
  timeline.tracks[4].clips[0].linked_group = "g";
  assert.equal(
    linkedSelection(timeline, [timeline.tracks[0].clips[0].id]).length,
    2,
  );
});
test("pointer gesture commits once after release; Escape and capture loss cancel", async () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const handlers = new Map();
  let calls = 0,
    captured = false;
  const canvas = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    focus() {},
    setPointerCapture() {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture() {
      captured = false;
    },
  };
  const timeline = fixtureTimeline(),
    view = {
      origin: 0,
      scale: 100,
      scrollY: 0,
      playhead: 0,
      selection: [],
      snap: false,
      draft: null,
    };
  const input = createInput({
    canvas,
    getTimeline: () => timeline,
    view,
    invalidate() {},
    onSelect() {},
    onSeek() {},
    onCommand: async () => {
      calls++;
    },
    onNotice() {},
  });
  const event = (x, y = 50) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    preventDefault() {},
  });
  handlers.get("pointerdown")(event(190));
  handlers.get("pointermove")(event(198));
  assert.equal(calls, 0);
  await handlers.get("pointerup")(event(198));
  assert.equal(calls, 1);
  handlers.get("pointerdown")(event(190));
  handlers.get("pointermove")(event(198));
  handlers.get("keydown")({ key: "Escape" });
  await handlers.get("pointerup")(event(198));
  assert.equal(calls, 1);
  handlers.get("pointerdown")(event(190));
  handlers.get("pointermove")(event(198));
  handlers.get("lostpointercapture")();
  await handlers.get("pointerup")(event(198));
  assert.equal(calls, 1);
  input.destroy();
  delete globalThis.window;
});
