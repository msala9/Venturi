import { request } from "./api.js";
import { sourceAssetURL } from "./source.js";

const PNG_LIMIT = 1024 * 1024;
const WAVE_LIMIT = 4 * 1024 * 1024;
const ASSET_LIMIT = 16 * 1024 * 1024;
const PAUSED = "Media analysis paused for playback · Refresh when idle";

function abortError() { return new DOMException("Canceled", "AbortError"); }
function validateDescriptor(job, item, epoch, sourceVersion) {
  const descriptor = job.source_assets;
  if (!descriptor || (job.project_epoch != null && job.project_epoch !== epoch) || job.source_asset != null || job.program != null || job.source_window != null ||
      descriptor.source_version !== sourceVersion || descriptor.total_frames !== item.duration_frames ||
      !Number.isSafeInteger(descriptor.total_frames) || descriptor.total_frames <= 0 ||
      descriptor.fps?.num !== item.fps?.num || descriptor.fps?.den !== item.fps?.den ||
      !Number.isSafeInteger(descriptor.fps?.num) || descriptor.fps.num <= 0 ||
      !Number.isSafeInteger(descriptor.fps?.den) || descriptor.fps.den <= 0 ||
      typeof descriptor.has_video !== "boolean" || typeof descriptor.has_audio !== "boolean" ||
      descriptor.has_video !== item.has_video || descriptor.has_audio !== item.has_audio ||
      (!descriptor.has_video && !descriptor.has_audio)) throw Error("Media analysis identity changed · Refresh when idle");
  return descriptor;
}

async function readBounded(response, limit, signal) {
  if (!response.ok) throw Error("Media analysis asset is unavailable · Refresh when idle");
  const size = response.headers?.get("Content-Length");
  if (size !== null && size !== undefined && (!/^\d+$/.test(size) || Number(size) > limit)) {
    await response.body?.cancel();
    throw Error("Media analysis asset exceeds its memory limit");
  }
  if (!response.body?.getReader) throw Error("Media analysis streaming response is unavailable");
  const reader = response.body.getReader(), parts = [];
  let total = 0, complete = false;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) { complete = true; break; }
      total += value.byteLength;
      if (total > limit) throw Error("Media analysis asset exceeds its memory limit");
      parts.push(value);
    }
    if (!total) throw Error("Media analysis returned an empty asset");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function pngDimensions(bytes) {
  const signature = [137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) throw Error("Media analysis returned an invalid PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12,16)) !== "IHDR") throw Error("Media analysis returned an invalid PNG");
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height * 4 > ASSET_LIMIT) throw Error("Media thumbnail exceeds its decoded memory limit");
  return { width, height };
}

function parseWaveform(bytes) {
  const waveform = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (waveform.scope !== "full_source" || !Number.isFinite(waveform.duration_seconds) || waveform.duration_seconds <= 0 ||
      !Array.isArray(waveform.peaks) || !waveform.peaks.length || waveform.peaks.length > 65_536 ||
      waveform.peaks.some(peak => !Number.isFinite(peak) || peak < 0 || peak > 1)) throw Error("Media waveform does not describe the full source");
  return waveform;
}

export function createSourceAssets({ getState, onReady, onStatus = () => {}, onError = () => {}, api = request, fetcher = fetch,
  setTimer = setTimeout, clearTimer = clearTimeout, decodeImage = blob => createImageBitmap(blob),
  createURL = blob => URL.createObjectURL(blob), revokeURL = url => URL.revokeObjectURL(url) }) {
  let current = null, disposed = false;
  const attempted = new Set();
  const identity = (item, epoch) => JSON.stringify([epoch, item.id, item.content_hash]);
  function owns(attempt) {
    const state = getState();
    return !disposed && current === attempt && !attempt.controller.signal.aborted && state?.project_epoch === attempt.epoch &&
      state.media?.some(item => item.id === attempt.item.id && item.content_hash === attempt.item.content_hash &&
        item.duration_frames === attempt.item.duration_frames && item.fps?.num === attempt.item.fps?.num && item.fps?.den === attempt.item.fps?.den &&
        item.has_video === attempt.item.has_video && item.has_audio === attempt.item.has_audio && item.is_image === attempt.item.is_image);
  }
  function cancel() {
    const previous = current;
    current = null;
    previous?.controller.abort();
    if (!disposed && previous?.pending) onStatus("Media analysis status disconnected · Refresh when idle");
  }
  function delay(attempt) {
    return new Promise((resolve, reject) => {
      const signal = attempt.controller.signal;
      const abort = () => { clearTimer(timer); reject(abortError()); };
      const timer = setTimer(() => { signal.removeEventListener("abort", abort); resolve(); }, 300);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  async function run(attempt) {
    const { item, epoch, sourceVersion } = attempt, signal = attempt.controller.signal;
    let thumbnail = null, thumbnailURL = null, transferred = false;
    const alive = () => { if (!owns(attempt)) throw abortError(); };
    const guardedFetch = (url, options = {}) => fetcher(url, { ...options, cache: "no-store", signal: AbortSignal.any([signal, options.signal, AbortSignal.timeout(20_000)].filter(Boolean)) });
    try {
      alive();
      onStatus(`${item.name} · Analyzing full-source media`);
      alive();
      let job = await api(`/media/${encodeURIComponent(item.id)}/assets/prepare`, { project_epoch: epoch }, guardedFetch);
      alive();
      if (typeof job.id !== "string" || !job.id) throw Error("Media analysis returned an invalid job");
      const jobId = job.id;
      const path = `/api/v1/media/${encodeURIComponent(item.id)}/jobs/${encodeURIComponent(jobId)}?${new URLSearchParams({ project_epoch: epoch })}`;
      while (true) {
        alive();
        if (job.id !== jobId) throw Error("Media analysis job changed");
        const descriptor = validateDescriptor(job, item, epoch, sourceVersion);
        if (job.state === "canceled") { onStatus(PAUSED); return null; }
        if (job.state === "failed") throw Error(`${job.error || "Media analysis failed"} · Refresh when idle`);
        if (job.state === "ready") {
          let waveform = null, waveBytes = 0, png = null, dimensions = null;
          if (descriptor.has_audio) {
            const response = await guardedFetch(sourceAssetURL(item.id, jobId, "waveform.json", epoch));
            alive();
            const bytes = await readBounded(response, WAVE_LIMIT, signal);
            alive();
            waveform = parseWaveform(bytes);
            waveBytes = bytes.byteLength + waveform.peaks.length * 8;
          }
          if (descriptor.has_video) {
            const response = await guardedFetch(sourceAssetURL(item.id, jobId, "thumb.png", epoch));
            alive();
            const bytes = await readBounded(response, PNG_LIMIT, signal);
            alive();
            dimensions = pngDimensions(bytes);
            png = new Blob([bytes], { type: "image/png" });
          }
          const bytes = waveBytes + (png ? png.size + dimensions.width * dimensions.height * 4 : 0);
          if (bytes > ASSET_LIMIT) throw Error("Media analysis exceeds its memory limit");
          if (png) {
            thumbnail = await decodeImage(png);
            alive();
            if (thumbnail.width !== dimensions.width || thumbnail.height !== dimensions.height) throw Error("Media thumbnail dimensions changed");
            thumbnailURL = createURL(png);
          }
          alive();
          const result = { item, epoch, sourceVersion, thumbnail, thumbnailURL, waveform, bytes };
          if (onReady(result) === false) return null;
          transferred = true;
          if (owns(attempt)) onStatus(`${item.name} · Full-source media analysis ready`);
          return result;
        }
        if (job.state !== "queued" && job.state !== "running") throw Error("Media analysis returned an invalid state");
        await delay(attempt);
        alive();
        const response = await guardedFetch(path);
        alive();
        if (!response.ok) throw Error("Media analysis job is unavailable · Refresh when idle");
        job = await response.json();
      }
    } catch (error) {
      if (owns(attempt) && error.name !== "AbortError") {
        const message = error.message || "Media analysis failed";
        onStatus(message.includes("Refresh") ? message : `${message} · Refresh when idle`);
        onError(error);
      }
      return null;
    } finally {
      if (!transferred) { thumbnail?.close(); if (thumbnailURL !== null) revokeURL(thumbnailURL); }
      attempt.pending = false;
    }
  }
  function load(item, epoch, { sourceVersion, force = false } = {}) {
    if (disposed) return Promise.resolve(null);
    const key = identity(item, epoch);
    if (!force && current?.key === key && current.sourceVersion === sourceVersion && current.pending) return current.promise;
    if (!force && attempted.has(key)) {
      if (current && (current.key !== key || current.sourceVersion !== sourceVersion)) cancel();
      return Promise.resolve(null);
    }
    cancel();
    attempted.add(key);
    while (attempted.size > 32) attempted.delete(attempted.values().next().value);
    if (item.is_image || typeof sourceVersion !== "string" || !sourceVersion) {
      const error = Error("Full-source analysis requires a video or audio source identity");
      onStatus(`${error.message} · Refresh when idle`);
      onError(error);
      return Promise.resolve(null);
    }
    const attempt = { key, item: { ...item, fps: item.fps && { ...item.fps } }, epoch, sourceVersion, controller: new AbortController(), pending: true, promise: null };
    current = attempt;
    attempt.promise = run(attempt);
    return attempt.promise;
  }
  return { load, cancel, dispose() { disposed = true; cancel(); attempted.clear(); } };
}
