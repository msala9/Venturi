import test from "node:test";
import assert from "node:assert/strict";
import { createSourcePlayer, sourceAssetURL } from "../js/source.js";

test("obsolete source preparations cannot select another project's media or autoplay", async () => {
  const pending = [];
  let plays = 0;
  const video = { src: "", paused: true, pause() {}, load() {}, removeAttribute() { this.src = ""; }, addEventListener() {}, play() { plays++; return Promise.resolve(); } };
  const status = { textContent: "" }, cancel = { disabled: false, addEventListener() {} };
  const ready = [];
  const player = createSourcePlayer({ video, status, cancel, onReady: (value) => ready.push(value), api: () => new Promise((resolve) => pending.push(resolve)) });
  const old = player.open({ id: "1", name: "Old" }, "old:1");
  const latest = player.open({ id: "1", name: "New" }, "new:2");
  pending[1]({ state: "ready", id: "new-job" }); await latest;
  pending[0]({ state: "ready", id: "old-job" }); await old;
  assert.equal(video.src, sourceAssetURL("1", "new-job", "source.mp4", "new:2"));
  assert.equal(ready.length, 1);
  assert.equal(plays, 0);
  await player.toggle(); assert.equal(plays, 1);
  video.currentTime = 1.99;
  player.step(1, 24, 48);
  assert.equal(video.currentTime, 47 / 24);
  player.reset(); assert.equal(video.src, "");
  await player.toggle(); assert.equal(plays, 1);
});
