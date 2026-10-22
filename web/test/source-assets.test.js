import test from "node:test";
import assert from "node:assert/strict";
import { createSourceAssets,createSourceAssetQueue,sourceAssetKey,mediaThumbnail } from "../js/source-assets.js";
import {visibleAssetDemand} from '../js/timeline/draw.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function png(width = 2, height = 2) {
  const bytes = new Uint8Array(33);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function harness(options = {}) {
  const item = { id: "media", name: "Source", content_hash: "hash", duration_frames: 24_000, fps: { num: 24, den: 1 }, has_video: true, has_audio: true };
  let state = { project_epoch: "epoch", media: [item] };
  const calls = [], ready = [], errors = [], statuses = [], timers = new Map(), bitmaps = [], created = [], revoked = [];
  let timerId = 0;
  const waveform = { scope: "full_source", duration_seconds: 997.5, peaks: [0, .25, 1] };
  const job = (status = "ready") => ({ id: "job", project_epoch: null, state: status, source_asset: null, source_window: null, program: null,
    source_assets: { source_version: "fd-version", total_frames: item.duration_frames, fps: { ...item.fps }, has_video: item.has_video, has_audio: item.has_audio,audio_stream_index:0,include_waveform:true } });
  const loader = createSourceAssets({
    getState: () => state,
    onReady: value => { ready.push(value); return options.onReady?.(value); },
    onError: error => errors.push(error), onStatus: message => statuses.push(message),
    api: async (path, body, fetcher) => { calls.push({ kind: "api", path, body }); return options.api ? options.api(path, body, fetcher, job) : job(); },
    fetcher: async (path, init) => {
      calls.push({ kind: "fetch", path, init });
      if (options.fetcher) return options.fetcher(path, init, job);
      return path.includes("waveform.json") ? Response.json(waveform) : new Response(png());
    },
    setTimer: callback => { timers.set(++timerId, callback); return timerId; }, clearTimer: id => timers.delete(id),
    decodeImage: async blob => {
      if (options.decodeImage) return options.decodeImage(blob);
      const bitmap = { width: 2, height: 2, closed: 0, close() { this.closed++; } }; bitmaps.push(bitmap); return bitmap;
    },
    createURL: blob => { const url = `blob:owned-${created.length}`; created.push({ url, blob }); return url; },
    revokeURL: url => revoked.push(url),
  });
  const load = (extra = {}) => loader.load(item, "epoch", { sourceVersion: "fd-version", ...extra });
  return { loader, load, item, calls, ready, errors, statuses, timers, bitmaps, created, revoked, waveform, job,
    setState: value => { state = value; }, tick: () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); } };
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

test("full-source analysis publishes only required assets with parent-owned bitmap and Blob URL", async () => {
  const h = harness();
  const result = await h.load();
  assert.equal(h.ready.length, 1); assert.equal(result, h.ready[0]);
  assert.equal(result.waveform.duration_seconds, 997.5);
  assert.equal(result.thumbnailURL, "blob:owned-0");
  assert.equal(result.sourceVersion, "fd-version");
  assert.equal(result.bytes, 16 + 33 + new TextEncoder().encode(JSON.stringify(h.waveform)).length + 24);
  assert.deepEqual(h.calls[0], { kind: "api", path: "/media/media/assets/prepare", body: { project_epoch: "epoch" } });
  assert.equal(h.calls.filter(call => call.kind === "fetch").length, 2);
  assert(h.calls.every(call => !call.path.includes("source.mp4")));
  h.loader.cancel(); h.loader.dispose();
  assert.equal(h.bitmaps[0].closed, 0); assert.deepEqual(h.revoked, []);
});

test("same pending identity reuses its Promise and attempts require explicit retry after completion", async () => {
  const ack = deferred(), h = harness({ api: () => ack.promise });
  const first = h.load(); assert.equal(h.load(), first); assert.equal(h.calls.length, 1);
  ack.resolve(h.job()); await first;
  assert.equal(await h.load(), null); assert.equal(h.calls.filter(call => call.kind === "api").length, 1);
  await h.load({ force: true });
  assert.equal(h.calls.filter(call => call.kind === "api").length, 2);
  h.loader.dispose();
});

test("attempt history retains only the latest 32 identities while suppressing their automatic retries", async () => {
  const h = harness({ api: (_path, _body, _fetcher, job) => job("canceled") });
  const items = Array.from({ length: 33 }, (_, index) => ({ ...h.item, id: `media-${index}` }));
  for (const item of items) {
    h.setState({ project_epoch: "epoch", media: [item] });
    await h.loader.load(item, "epoch", { sourceVersion: "fd-version" });
  }
  assert.equal(h.calls.length, 33);
  for (const item of items.slice(1)) {
    h.setState({ project_epoch: "epoch", media: [item] });
    await h.loader.load(item, "epoch", { sourceVersion: "fd-version" });
  }
  assert.equal(h.calls.length, 33);
  h.setState({ project_epoch: "epoch", media: [items[0]] });
  await h.loader.load(items[0], "epoch", { sourceVersion: "fd-version" });
  assert.equal(h.calls.length, 34); assert.equal(h.errors.length, 0); h.loader.dispose();
});

test("foreground cancellation reports paused and never deletes the shared analysis job or retries automatically", async () => {
  const h = harness({ api: (_path, _body, _fetcher, job) => job("canceled") });
  assert.equal(await h.load(), null);
  assert.equal(h.statuses.at(-1), "Media analysis paused for playback · Refresh when idle");
  assert.equal(h.errors.length, 0); assert.equal(h.ready.length, 0);
  await h.load(); assert.equal(h.calls.length, 1);
  assert(h.calls.every(call => call.init?.method !== "DELETE"));
  h.loader.dispose();
});

test("failed analysis needs explicit refresh and has no playback side effects", async () => {
  const h = harness({ api: (_path, _body, _fetcher, job) => ({ ...job("failed"), error: "SOURCE_CACHE_FULL" }) });
  await h.load(); await h.load();
  assert.equal(h.calls.length, 1); assert.match(h.errors[0].message, /SOURCE_CACHE_FULL.*Refresh/);
  assert.match(h.statuses.at(-1), /SOURCE_CACHE_FULL.*Refresh/);
  assert.equal(h.ready.length, 0); assert.equal(h.timers.size, 0);
  h.loader.dispose();
});

test("polling has one pending timer/request and local cancel aborts it without DELETE", async () => {
  const poll = deferred();
  const h = harness({ api: (_path, _body, _fetcher, job) => job("queued"), fetcher: () => poll.promise });
  const pending = h.load(); await flush(); assert.equal(h.timers.size, 1);
  h.tick(); await flush(); assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 0);
  const signal = h.calls[1].init.signal;
  h.loader.cancel(); assert.equal(signal.aborted, true);
  assert.equal(h.statuses.at(-1), "Media analysis status disconnected · Refresh when idle");
  poll.resolve(Response.json(h.job("running"))); await pending;
  assert.equal(h.timers.size, 0); assert.equal(h.ready.length, 0); assert.equal(h.errors.length, 0);
  assert.equal(await h.load(), null); assert.equal(h.calls.length, 2);
  h.loader.dispose();
});

test("cancel clears a pending poll timer and disposal prevents future preparation", async () => {
  const h = harness({ api: (_path, _body, _fetcher, job) => job("running") });
  const pending = h.load(); await flush(); assert.equal(h.timers.size, 1);
  h.loader.cancel(); await pending; assert.equal(h.timers.size, 0);
  h.loader.dispose(); assert.equal(await h.load({ force: true }), null); assert.equal(h.calls.length, 1);
});

test("obsolete prepare acknowledgments never fetch, publish or cancel shared jobs", async () => {
  const ack = deferred(), h = harness({ api: () => ack.promise });
  const pending = h.load(); h.loader.cancel(); ack.resolve(h.job()); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.ready.length, 0); assert.equal(h.errors.length, 0);
  h.loader.dispose();
});

test("epoch, content hash and native media metadata changes suppress late job JSON", async t => {
  for (const changed of ["epoch", "hash", "duration", "fps", "removed"]) await t.test(changed, async () => {
    const json = deferred();
    const h = harness({ api: (_path, _body, _fetcher, job) => job("queued"), fetcher: () => ({ ok: true, json: () => json.promise }) });
    const pending = h.load(); await flush(); h.tick(); await flush();
    const media = { ...h.item, fps: { ...h.item.fps } };
    if (changed === "hash") media.content_hash = "replacement";
    if (changed === "duration") media.duration_frames++;
    if (changed === "fps") media.fps.den++;
    h.setState({ project_epoch: changed === "epoch" ? "other" : "epoch", media: changed === "removed" ? [] : [media] });
    json.resolve(h.job()); await pending;
    assert.equal(h.ready.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.calls.length, 2);
    h.loader.dispose();
  });
});

test("descriptors refuse fd versions, fps, duration, media flags and windowed-source jobs", async t => {
  for (const changed of ["version", "fps", "duration", "flags", "window", "asset", "epoch", "missing"]) await t.test(changed, async () => {
    const h = harness({ api: (_path, _body, _fetcher, job) => {
      const value = job();
      if (changed === "version") value.source_assets.source_version = "other";
      if (changed === "fps") value.source_assets.fps.den = 0;
      if (changed === "duration") value.source_assets.total_frames--;
      if (changed === "flags") value.source_assets.has_audio = false;
      if (changed === "window") value.source_window = { start_frame: 0 };
      if (changed === "asset") value.source_asset = "source.mp4";
      if (changed === "epoch") value.project_epoch = "other";
      if (changed === "missing") delete value.source_assets;
      return value;
    } });
    assert.equal(await h.load(), null); assert.equal(h.ready.length, 0); assert.equal(h.errors.length, 1); assert.equal(h.calls.length, 1);
    h.loader.dispose();
  });
});

test("audio-only and silent video fetch only assets present in their native descriptor", async t => {
  for (const audio of [true, false]) await t.test(audio ? "audio" : "silent video", async () => {
    const h = harness(); h.item.has_audio = audio; h.item.has_video = !audio;
    const result = await h.load();
    assert.equal(h.calls.length, 2); assert.equal(Boolean(result.waveform), audio); assert.equal(Boolean(result.thumbnail), !audio);
    assert.match(h.calls[1].path, audio ? /waveform\.json/ : /thumb\.png/);
    h.loader.dispose();
  });
});

test("waveforms require full-source scope and finite bounded peaks with positive duration", async t => {
  for (const changed of ["scope", "zero", "infinite", "negative", "nan", "large", "empty"]) await t.test(changed, async () => {
    const h = harness(); h.item.has_video = false;
    if (changed === "scope") h.waveform.scope = "source_window";
    if (changed === "zero") h.waveform.duration_seconds = 0;
    if (changed === "infinite") h.waveform.duration_seconds = Infinity;
    if (changed === "negative") h.waveform.peaks = [-.1];
    if (changed === "nan") h.waveform.peaks = [NaN];
    if (changed === "large") h.waveform.peaks = Array(65_537).fill(0);
    if (changed === "empty") h.waveform.peaks = [];
    assert.equal(await h.load(), null); assert.equal(h.errors.length, 1); assert.equal(h.ready.length, 0);
    h.loader.dispose();
  });
});

test("actual streamed body and declared size are bounded before decoding", async t => {
  for (const declared of [true, false]) await t.test(declared ? "declared" : "streamed", async () => {
    const h = harness({ fetcher: () => declared ? new Response("x", { headers: { "Content-Length": String(1024 * 1024 + 1) } }) : new Response(new Uint8Array(1024 * 1024 + 1)) });
    h.item.has_audio = false;
    assert.equal(await h.load(), null); assert.equal(h.bitmaps.length, 0); assert.match(h.errors[0].message, /memory limit/);
    h.loader.dispose();
  });
});

test("PNG dimensions prevent decompression above the asset budget before decode", async () => {
  let decodes = 0;
  const h = harness({ fetcher: () => new Response(png(8192, 8192)), decodeImage: () => { decodes++; } }); h.item.has_audio = false;
  await h.load(); assert.equal(decodes, 0); assert.match(h.errors[0].message, /memory limit/); h.loader.dispose();
});

test("the combined budget includes compressed bytes and waveform storage before thumbnail decoding", async () => {
  let decodes = 0;
  const h = harness({ fetcher: path => path.includes("waveform.json") ? Response.json({ scope: "full_source", duration_seconds: 1000, peaks: [0] }) : new Response(png(2048, 2048)),
    decodeImage: () => { decodes++; } });
  await h.load(); assert.equal(decodes, 0); assert.match(h.errors[0].message, /memory limit/); h.loader.dispose();
});

test("the waveform declared limit and PNG signature are validated before decoding", async t => {
  await t.test("waveform", async () => {
    const h = harness({ fetcher: () => new Response("x", { headers: { "Content-Length": String(4 * 1024 * 1024 + 1) } }) });
    h.item.has_video = false; await h.load(); assert.match(h.errors[0].message, /memory limit/); h.loader.dispose();
  });
  await t.test("PNG", async () => {
    const h = harness({ fetcher: () => new Response("invalid PNG") }); h.item.has_audio = false;
    await h.load(); assert.match(h.errors[0].message, /invalid PNG/); assert.equal(h.bitmaps.length, 0); h.loader.dispose();
  });
});

test("late thumbnail decoding closes its bitmap without creating or publishing a URL", async () => {
  const decode = deferred(), entered = deferred(), bitmap = { width: 2, height: 2, closed: 0, close() { this.closed++; } };
  const h = harness({ decodeImage: () => { entered.resolve(); return decode.promise; } });
  const pending = h.load(); await entered.promise; h.loader.cancel(); decode.resolve(bitmap); await pending;
  assert.equal(bitmap.closed, 1); assert.equal(h.created.length, 0); assert.equal(h.ready.length, 0); assert.equal(h.errors.length, 0);
  h.loader.dispose();
});

test("failed publication and decoded dimension mismatch reclaim all untransferred assets", async t => {
  await t.test("publication", async () => {
    const h = harness({ onReady: () => false });
    assert.equal(await h.load(), null); assert.equal(h.bitmaps[0].closed, 1); assert.deepEqual(h.revoked, ["blob:owned-0"]);
    h.loader.dispose();
  });
  await t.test("dimensions", async () => {
    const bitmap = { width: 3, height: 2, closed: 0, close() { this.closed++; } };
    const h = harness({ decodeImage: () => bitmap }); await h.load();
    assert.equal(bitmap.closed, 1); assert.equal(h.created.length, 0); assert.match(h.errors[0].message, /dimensions changed/);
    h.loader.dispose();
  });
  await t.test("callback error", async () => {
    const h = harness({ onReady: () => { throw Error("Publication rejected"); } }); await h.load();
    assert.equal(h.bitmaps[0].closed, 1); assert.deepEqual(h.revoked, ["blob:owned-0"]); assert.match(h.errors[0].message, /Publication rejected/);
    h.loader.dispose();
  });
});

test("an obsolete decoded result cannot close or replace a newer published asset", async () => {
  const oldDecode = deferred(), entered = deferred();
  const oldBitmap = { width: 2, height: 2, closed: 0, close() { this.closed++; } };
  const latestBitmap = { width: 2, height: 2, closed: 0, close() { this.closed++; } };
  let decodes = 0;
  const h = harness({ decodeImage: () => { if (++decodes === 1) { entered.resolve(); return oldDecode.promise; } return latestBitmap; } });
  const old = h.load(); await entered.promise;
  const latest = await h.load({ force: true }); oldDecode.resolve(oldBitmap); await old;
  assert.equal(h.ready.length, 1); assert.equal(latest.thumbnail, latestBitmap); assert.equal(oldBitmap.closed, 1); assert.equal(latestBitmap.closed, 0);
  assert.equal(h.created.length, 1); assert.deepEqual(h.revoked, []); h.loader.dispose();
});

test("a previously attempted selection cancels a different active selection before returning", async () => {
  let calls = 0; const ack = deferred();
  const h = harness({ api: (_path, _body, _fetcher, job) => ++calls === 1 ? job("canceled") : ack.promise });
  await h.load();
  const other = { ...h.item, id: "other" };
  h.setState({ project_epoch: "epoch", media: [h.item, other] });
  const pending = h.loader.load(other, "epoch", { sourceVersion: "fd-version" });
  assert.equal(await h.load(), null); ack.resolve(h.job()); await pending;
  assert.equal(h.ready.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.calls.length, 2);
  h.loader.dispose();
});

test('visible derivative preparation establishes a pinned FD version without opening Source or downloading MP4',async()=>{
  const h=harness({api:(_path,body,_fetcher,job)=>{assert.deepEqual(body,{project_epoch:'epoch',audio_stream_index:0,include_waveform:false});const value=job();value.source_assets.include_waveform=false;return value;}});
  const result=await h.loader.load(h.item,'epoch',{audioStreamIndex:0,includeWaveform:false});
  assert.equal(result.sourceVersion,'fd-version');assert.equal(result.waveform,null);assert.equal(result.waveformBytes,0);
  assert.equal(h.calls.filter(call=>call.kind==='fetch').length,1);assert.ok(h.calls.every(call=>!call.path.includes('source.mp4') && !call.path.includes('waveform.json')));h.loader.dispose();
});

test('native selected-stream waveform is bound to the descriptor and unavailable streams never enqueue',async()=>{
  const h=harness({api:(_path,body,_fetcher,job)=>{const value=job();value.source_assets.audio_stream_index=body.audio_stream_index;return value;}});h.item.has_video=false;h.item.audio_stream_count=2;
  const result=await h.loader.load(h.item,'epoch',{audioStreamIndex:1,includeWaveform:true});assert.equal(result.audioStreamIndex,1);assert.equal(result.thumbnail,null);assert.equal(result.waveform.duration_seconds,997.5);
  for(const index of [-1,2,1.5])await h.loader.load(h.item,'epoch',{audioStreamIndex:index,force:true});assert.equal(h.calls.filter(call=>call.kind==='api').length,1);h.loader.dispose();
});

test('mismatched stream, waveform scope and late FD changes cannot publish a cached derivative',async()=>{
  for(const patch of [{audio_stream_index:0},{include_waveform:false}]){
    const h=harness({api:(_path,_body,_fetcher,job)=>{const value=job();Object.assign(value.source_assets,{audio_stream_index:1},patch);return value;}});h.item.audio_stream_count=2;
    await h.loader.load(h.item,'epoch',{audioStreamIndex:1,includeWaveform:true});assert.equal(h.ready.length,0);assert.match(h.errors[0].message,/identity/);h.loader.dispose();
  }
  const h=harness({api:(_path,_body,_fetcher,job)=>job('running'),fetcher:(_path,_init,job)=>{const value=job();value.source_assets.source_version='replacement-fd';return Response.json(value);}});
  const pending=h.loader.load(h.item,'epoch');await flush();h.tick();await pending;assert.equal(h.ready.length,0);assert.match(h.errors[0].message,/identity/);h.loader.dispose();
});

test('native still sentinel metadata is preserved and default omitted descriptor fields remain compatible',async()=>{
  const h=harness({api:(_path,_body,_fetcher,job)=>{const value=job();delete value.source_assets.audio_stream_index;delete value.source_assets.include_waveform;return value;}});
  h.item.is_image=true;h.item.has_audio=false;h.item.duration_frames=1_000_000_000;h.item.fps={num:1,den:1};
  const result=await h.loader.load(h.item,'epoch');assert.equal(result.item.duration_frames,1_000_000_000);assert.ok(result.thumbnail);assert.equal(result.waveform,null);h.loader.dispose();
});

function queueHarness({complete=true}={}){
  const items=Array.from({length:70},(_,index)=>({id:`m${index}`,name:`Media ${index}`,content_hash:`hash${index}`,duration_frames:240,fps:{num:24,den:1},has_video:true,has_audio:true,audio_stream_count:2}));
  let state={project_epoch:'epoch',media:items},idle=true,timerId=0,cancels=0;
  const calls=[],cache=new Set(),timers=new Map(),pending=[];
  const identity=(item,index,wave)=>JSON.stringify([item.id,index,wave]);
  const loader={load(item,epoch,options){calls.push({item,epoch,options});if(complete){cache.add(identity(item,options.audioStreamIndex,options.includeWaveform));return Promise.resolve({item});}const gate=deferred();pending.push(gate);return gate.promise;},cancel(){cancels++;},dispose(){}};
  const queue=createSourceAssetQueue({loader,getState:()=>state,isIdle:()=>idle,hasAsset:entry=>cache.has(identity(entry.item,entry.audioStreamIndex,entry.includeWaveform)),setTimer:callback=>{timers.set(++timerId,callback);return timerId;},clearTimer:id=>timers.delete(id)});
  const entry=(index,stream=0,wave=false)=>({item:items[index],audioStreamIndex:stream,includeWaveform:wave});
  return {queue,items,calls,pending,cache,timers,entry,get cancels(){return cancels;},setIdle(value){idle=value;queue.refresh();},setState(value){state=value;queue.refresh();},tick(){const next=timers.entries().next().value;assert.ok(next,'One scheduled derivative task');timers.delete(next[0]);next[1]();},clearCache(){cache.clear();},identity};
}

test('visible pool/timeline derivative demand coalesces and runs exactly one client preparation at a time',async()=>{
  const h=queueHarness({complete:false});h.queue.demand('pool',[h.entry(0),h.entry(1)]);h.queue.demand('timeline',[h.entry(0,1,true)]);assert.equal(h.timers.size,1);h.tick();await flush();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.audioStreamIndex,1);assert.equal(h.calls[0].options.includeWaveform,true);assert.equal(h.timers.size,0);
  h.queue.demand('pool',[h.entry(0),h.entry(1)]);assert.equal(h.calls.length,1);h.pending[0].resolve({item:h.items[0]});await flush();assert.equal(h.timers.size,1);h.tick();await flush();assert.equal(h.calls.length,2);
  h.pending[1].resolve(null);await flush();h.queue.dispose();
});

test('foreground playback drops queued work, aborts its active observer and resumes only unattempted visible entries',async()=>{
  const h=queueHarness({complete:false});h.queue.demand('timeline',[h.entry(0,0,true),h.entry(1,0,true)]);h.tick();await flush();h.setIdle(false);
  assert.equal(h.cancels,1);assert.equal(h.timers.size,0);h.pending[0].resolve(null);await flush();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  h.setIdle(true);h.tick();await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].item.id,'m1');h.pending[1].resolve(null);await flush();h.queue.dispose();
});

test('obsolete epoch or removed demand cannot publish another client request and never DELETEs shared jobs',async()=>{
  const h=queueHarness({complete:false});h.queue.demand('pool',[h.entry(0),h.entry(1)]);h.tick();await flush();h.setState({project_epoch:'new',media:h.items});assert.equal(h.cancels,1);
  h.pending[0].resolve({item:h.items[0]});await flush();if(h.timers.size){h.tick();await flush();}assert.equal(h.calls.length,1);
  h.queue.demand('pool',[h.entry(1)],'epoch');if(h.timers.size){h.tick();await flush();}assert.equal(h.calls.length,1);h.queue.dispose();
});

test('successful eviction cannot thrash a still-visible demand, but a return to view can reload the bounded native cache',async()=>{
  const h=queueHarness();h.queue.demand('pool',[h.entry(0)]);h.tick();await flush();h.clearCache();h.queue.demand('pool',[h.entry(0)]);h.tick();await flush();assert.equal(h.calls.length,1);
  h.queue.demand('pool',[]);h.queue.demand('pool',[h.entry(0)]);h.tick();await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.force,true);h.queue.dispose();
});

test('failed media is not retried by repaint and an explicit Refresh bypasses even a populated cache',async()=>{
  const h=queueHarness({complete:false});h.queue.demand('pool',[h.entry(0)]);h.tick();await flush();h.pending[0].resolve(null);await flush();h.queue.demand('pool',[h.entry(0)]);h.tick();await flush();assert.equal(h.calls.length,1);
  h.cache.add(h.identity(h.items[0],0,false));const refreshed=h.queue.load(h.items[0],'epoch',{includeWaveform:false,force:true});h.tick();await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.force,true);h.pending[1].resolve({item:h.items[0]});await refreshed;h.queue.dispose();
});

test('visible demand is bounded and a full waveform upgrades a same-media thumbnail-only request',async()=>{
  const h=queueHarness();h.queue.demand('pool',h.items.map((_,index)=>h.entry(index)));h.queue.demand('timeline',[h.entry(0,0,true)]);h.tick();await flush();
  assert.equal(h.calls[0].options.includeWaveform,true);assert.equal(h.calls[0].item.id,'m0');
  for(let index=1;index<64;index++){h.tick();await flush();}if(h.timers.size){h.tick();await flush();}
  assert.equal(h.calls.length,64);assert.ok(h.calls.every(call=>Number(call.item.id.slice(1))<64));h.queue.dispose();assert.equal(h.timers.size,0);
});

test('timeline visible geometry requests only on-screen file derivatives and binds the actual audio stream',()=>{
  const timeline={id:'t',revision:'r',fps:{num:24,den:1},tracks:[
    {id:'v',kind:'video',clips:[{id:'v0',media_id:'media',start_frame:0,length_frames:24},{id:'far',media_id:'offscreen',start_frame:1000,length_frames:24},{id:'generated',media_id:null,start_frame:0,length_frames:24}]},
    {id:'a',kind:'audio',clips:[{id:'a1',media_id:'media',audio_stream_index:1,start_frame:0,length_frames:24},{id:'a0',media_id:'media',audio_stream_index:0,start_frame:24,length_frames:24}]},
  ]};
  const entries=visibleAssetDemand(timeline,{origin:0,scale:100,rowHeight:62,videoScroll:0,audioScroll:0},800,400);
  assert.deepEqual(entries,[{media_id:'media',audio_stream_index:0,include_waveform:true},{media_id:'media',audio_stream_index:1,include_waveform:true}]);
  assert.deepEqual(visibleAssetDemand(timeline,{},0,400),[]);
  const assets=new Map([[sourceAssetKey('media',1),{mediaId:'media',thumbnail:{},thumbnailURL:'blob:selected'}]]);assert.equal(mediaThumbnail(assets,'media').thumbnailURL,'blob:selected');assert.equal(assets.get(sourceAssetKey('media',0)),undefined);
});
