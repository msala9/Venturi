import test from "node:test";
import assert from "node:assert/strict";
import { createViewer, matchesFrame } from "../js/viewer.js";
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
    ["width", 640],
  ])
    assert.equal(matchesFrame(frame, { ...frame, [key]: value }), false, key);
  assert.equal(matchesFrame(frame, null), false);
});

test("out-of-order HTTP frames never replace the latest frame; busy GPU marks it stale", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => requests.push(resolve)));
  let current = { project_epoch: "server:1", if_generation: "0", timeline_id: "1", revision: "r", frame: 0, width: 960 };
  const classes = new Set();
  const image = { hidden: true, src: "", decode: async () => {}, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const status = { textContent: "" }, empty = { hidden: false };
  const viewer = createViewer({ image, status, empty, getState: () => current });
  const first = viewer.seek();
  assert.equal(viewer.current(),null);
  current = { ...current, frame: 12 };
  const second = viewer.seek();
  requests[1](new Response(new Blob(["latest"], { type: "image/png" })));
  await second;
  const latestURL = image.src;
  assert.equal(status.textContent, "CURRENT");
  assert.deepEqual(viewer.current(),current);
  requests[0](new Response(new Blob(["old"], { type: "image/png" })));
  await first;
  assert.equal(image.src, latestURL);
  assert.equal(status.textContent, "CURRENT");
  current = { ...current, frame: 13 };
  assert.equal(viewer.current(),null);
  const busy = viewer.seek();
  requests[2](Response.json({ error: { code: "GPU_BUSY" } }, { status: 503 }));
  await busy;
  assert.equal(status.textContent, "STALE · GPU_BUSY");
  assert.equal(image.src, latestURL);
  assert.equal(classes.has("stale"), true);
  assert.equal(viewer.current(),null);
  viewer.destroy();
});
