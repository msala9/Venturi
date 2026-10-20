import test from "node:test";
import assert from "node:assert/strict";
import { createProgramPlayer, sameComposition } from "../js/program.js";

test("composed playback identity follows the document and ignores its advancing clock", () => {
  const value = { project_epoch: "p:1", if_generation: "2", timeline_id: "1", revision: "r", width: 960, start_frame: 0 };
  assert.equal(sameComposition(value, { ...value, start_frame: 120 }), true);
  for (const key of ["project_epoch", "if_generation", "timeline_id", "revision", "width"]) assert.equal(sameComposition(value, { ...value, [key]: "changed" }), false);
  assert.equal(sameComposition(value, null), false);
});

test("an old composed range cannot replace a later seek; native media time drives the playhead", async () => {
  const requests = [], events = {}, frames = [];
  const video = { src: "", currentTime: 0, paused: true, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {}, removeAttribute() { this.src = ""; }, addEventListener(name, callback) { events[name] = callback; } };
  let state = { project_epoch: "p:1", if_generation: "2", timeline_id: "1", revision: "revision", width: 960, start_frame: 0, end_frame: 48 };
  const player = createProgramPlayer({ video, status: { textContent: "" }, cancel: { addEventListener() {} }, getState: () => state, onFrame: (frame) => frames.push(frame), onState() {}, api: () => new Promise((resolve) => requests.push(resolve)) });
  const old = player.toggle(); player.stop(); state = { ...state, start_frame: 12 };
  const latest = player.toggle();
  requests[1]({ id: "latest", state: "ready", program: { width: 320, height: 180, fps: { num: 24, den: 1 } } }); await latest;
  const url = video.src;
  requests[0]({ id: "old", state: "ready", program: { width: 960, height: 540, fps: { num: 24, den: 1 } } }); await old;
  assert.equal(video.src, url);
  assert.match(url, /latest\/program.mp4/);
  video.currentTime = 0.5; events.timeupdate(); assert.equal(frames.at(-1), 24);
  player.pauseLocal();video.currentTime=1;events.timeupdate();assert.equal(frames.at(-1),24,"a delayed pause clock cannot override a manual seek");
  await player.toggle();video.currentTime=0.75;events.timeupdate();assert.equal(frames.at(-1),30,"resuming reattaches the media clock");
  state = { ...state, revision: "next" }; video.currentTime = 1; events.timeupdate(); assert.equal(frames.at(-1), 30);
  player.stop(); assert.equal(video.src, ""); assert.equal(video.paused, true);
});
