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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function png({ draft = true, type = "image/png", size = 12, length = null } = {}) {
  return {
    ok: true,
    headers: new Headers({ ...(draft ? { "x-venturi-preview-draft": "1" } : {}),
      ...(length === null ? {} : { "content-length": String(length) }) }),
    blob: async () => ({ type, size }),
  };
}
function draftHarness(t) {
  const requests = [], created = [], revoked = [], decodes = [], classes = new Set();
  let state = { project_epoch: "server:1", if_generation: "3", timeline_id: "1",
    revision: "title", frame: 12, width: 960 };
  t.mock.method(globalThis, "fetch", (path, options) => {
    const reply = deferred();
    requests.push({ path, options, respond: reply.resolve });
    return reply.promise;
  });
  t.mock.method(URL, "createObjectURL", () => {
    const next = `blob:viewer-${created.length + 1}`;
    created.push(next);
    return next;
  });
  t.mock.method(URL, "revokeObjectURL", (value) => { revoked.push(value); });
  const image = { hidden: true, src: "", decode: () => decodes.shift()?.() || Promise.resolve(),
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const status = { textContent: "" }, empty = { hidden: false };
  const viewer = createViewer({ image, status, empty, getState: () => state });
  return { viewer, image, status, empty, requests, created, revoked, classes,
    state: () => state,
    change: (patch) => { state = { ...state, ...patch }; },
    body: () => ({ query: { ...state }, clip_ids: ["7"], font_family: "Native Font" }),
    async committed() {
      const pending = viewer.seek();
      requests.at(-1).respond(png({ draft: false }));
      await pending;
      return image.src;
    },
    holdDecode() {
      const started = deferred(), finished = deferred();
      decodes.push(() => { started.resolve(); return finished.promise; });
      return { started: started.promise, finish: finished.resolve };
    },
  };
}

test("font drafts retain the committed frame, suppress overlays and cancel without HTTP or writes", async (t) => {
  const h = draftHarness(t), base = await h.committed(), body = h.body();
  const draft = h.viewer.previewDraft(body);
  const request = h.requests.at(-1);
  assert.equal(request.path, "/api/v1/preview/title-font");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), body);
  assert.equal(h.viewer.current(), null);
  request.respond(png());
  assert.equal(await draft, true);
  assert.equal(h.status.textContent, "FONT PREVIEW");
  assert.equal(h.viewer.current(), null);
  assert.equal(h.revoked.includes(base), false);
  const firstURL = h.image.src;
  const second = h.viewer.previewDraft({ ...body, italic: true });
  assert.equal(h.requests.length, 3);
  assert.equal(h.revoked.includes(firstURL), true);
  h.requests.at(-1).respond(png());
  assert.equal(await second, true);
  const count = h.requests.length, secondURL = h.image.src;
  h.viewer.cancelDraft();
  assert.equal(h.requests.length, count);
  assert.equal(h.image.src, base);
  assert.equal(h.status.textContent, "CURRENT");
  assert.deepEqual(h.viewer.current(), h.state());
  assert.equal(h.revoked.includes(secondURL), true);
  h.viewer.destroy();
  assert.deepEqual([...h.revoked].sort(), [...h.created].sort());
});

test("obsolete font HTTP and image decoding cannot replace a newer draft or a canceled committed frame", async (t) => {
  const h = draftHarness(t), base = await h.committed();
  const first = h.viewer.previewDraft(h.body()), firstRequest = h.requests.at(-1);
  const second = h.viewer.previewDraft({ ...h.body(), font_weight: 700 });
  assert.equal(firstRequest.options.signal.aborted, true);
  h.requests.at(-1).respond(png());
  assert.equal(await second, true);
  const latest = h.image.src;
  firstRequest.respond(png());
  assert.equal(await first, false);
  assert.equal(h.image.src, latest);
  const decode = h.holdDecode(), third = h.viewer.previewDraft(h.body());
  h.requests.at(-1).respond(png());
  await decode.started;
  const pendingURL = h.image.src;
  h.viewer.cancelDraft();
  assert.equal(h.image.src, base);
  assert.equal(h.revoked.includes(pendingURL), true);
  decode.finish();
  assert.equal(await third, false);
  assert.equal(h.image.src, base);
  assert.deepEqual(h.viewer.current(), h.state());
  h.viewer.destroy();
  assert.deepEqual([...h.revoked].sort(), [...h.created].sort());
});

test("font draft selection, readonly and frame owners are checked after HTTP and decoding", async (t) => {
  for (const phase of ["http", "decode"]) {
    for (const context of ["selection", "epoch", "generation"]) {
      await t.test(`${phase} ${context}`, async (t) => {
        const h = draftHarness(t), base = await h.committed();
        let owner = true;
        const decode = phase === "decode" ? h.holdDecode() : null;
        const pending = h.viewer.previewDraft(h.body(), { isCurrent: () => owner });
        if (decode) { h.requests.at(-1).respond(png()); await decode.started; }
        if (context === "selection") owner = false;
        else h.change(context === "epoch" ? { project_epoch: "other:1" } : { if_generation: "4" });
        if (decode) decode.finish(); else h.requests.at(-1).respond(png());
        assert.equal(await pending, false);
        if (context === "selection") {
          assert.equal(h.image.src, base);
          assert.deepEqual(h.viewer.current(), h.state());
        } else {
          assert.equal(h.image.hidden, true);
          assert.equal(h.viewer.current(), null);
          assert.equal(h.status.textContent, "PREVIEW UNAVAILABLE");
        }
        const count = h.requests.length;
        assert.equal(await h.viewer.previewDraft(h.body(), { isCurrent: () => false }), false);
        assert.equal(h.requests.length, count);
        h.viewer.destroy();
        assert.deepEqual([...h.revoked].sort(), [...h.created].sort());
      });
    }
  }
});

test("font preview accepts only bounded tagged native PNG and never replaces the base on refusal", async (t) => {
  const h = draftHarness(t), base = await h.committed();
  for (const response of [png({ draft: false }), png({ type: "image/jpeg" }),
    png({ size: 16 * 1024 * 1024 + 1 }), png({ length: 16 * 1024 * 1024 + 1 }), png({ size: 0 })]) {
    const pending = h.viewer.previewDraft(h.body());
    h.requests.at(-1).respond(response);
    assert.equal(await pending, false);
    assert.equal(h.image.src, base);
    assert.deepEqual(h.viewer.current(), h.state());
  }
  assert.equal(h.created.length, 1);
  h.viewer.destroy();
});

test("seek, invalidation and destruction discard drafts without restoring an obsolete committed frame", async (t) => {
  const h = draftHarness(t), base = await h.committed();
  const decode = h.holdDecode(), pending = h.viewer.previewDraft(h.body());
  h.requests.at(-1).respond(png());
  await decode.started;
  h.change({ frame: 24 });
  const seek = h.viewer.seek();
  assert.equal(h.viewer.current(), null);
  assert.equal(h.image.hidden, true);
  h.requests.at(-1).respond(png({ draft: false }));
  await seek;
  const fresh = h.image.src;
  decode.finish();
  assert.equal(await pending, false);
  assert.equal(h.image.src, fresh);
  assert.notEqual(fresh, base);
  const draft = h.viewer.previewDraft(h.body());
  h.requests.at(-1).respond(png());
  assert.equal(await draft, true);
  h.viewer.invalidate();
  h.viewer.cancelDraft();
  assert.equal(h.viewer.current(), null);
  assert.equal(h.image.hidden, true);
  const count = h.requests.length;
  h.viewer.destroy();
  assert.equal(await h.viewer.previewDraft(h.body()), false);
  assert.equal(h.requests.length, count);
  assert.deepEqual([...h.revoked].sort(), [...h.created].sort());
});
