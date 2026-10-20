import test from "node:test";
import assert from "node:assert/strict";
import { createSourcePlayer, sourceAssetURL, sourceSelection } from "../js/source.js";

test("source selection preserves exclusive integer bounds and refuses invalid values before JSON encoding", () => {
  assert.deepEqual(sourceSelection(6,18,48),{source_in:6,source_out:18});
  for (const values of [[-1,18,48],[6,6,48],[6,49,48],[6.5,18,48],[NaN,18,48],[6,Infinity,48]]) assert.throws(()=>sourceSelection(...values));
});

test("still Source uses the original image without playing or stepping a media clock", async () => {
  for (const asset of ["source.png","source.jpg","source.webp"]) {
  let plays = 0;
  const image = { src: "", hidden: true, removeAttribute() { this.src = ""; } };
  const video = { hidden: false, pause() {}, load() {}, removeAttribute() {}, addEventListener() {}, play() { plays++; } };
  const player = createSourcePlayer({ video, image, status: {}, cancel: { addEventListener() {} }, api: async () => ({ id: "still", state: "ready", source_asset: asset }) });
  await player.open({ id: "1", name: "Transparent", is_image: true }, "image:1");
  assert.equal(image.src, sourceAssetURL("1", "still", asset, "image:1"));
  assert.equal(image.hidden, false); assert.equal(video.hidden, true);
  await player.toggle(); player.step(1, 24, 48); assert.equal(plays, 0);
  player.reset(); assert.equal(image.src, ""); assert.equal(image.hidden, true);
  }
});

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
