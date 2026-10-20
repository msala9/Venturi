import { fixtureTimeline } from "../js/timeline/index.js";
import { createDraw } from "../js/timeline/draw.js";

const timeline = fixtureTimeline();
const view = { origin: 0, scale: 30, scrollY: 0, playhead: 0, selection: [], draft: null };
const thumbnail = document.createElement("canvas");
thumbnail.width = 80; thumbnail.height = 48;
const context = thumbnail.getContext("2d");
context.fillStyle = "#75556d"; context.fillRect(0, 0, 80, 48);
context.fillStyle = "#e8b878"; context.fillRect(20, 10, 40, 28);
const assets = new Map([["fixture-media", { thumbnail, fps: timeline.fps, waveform: { duration_seconds: 500, peaks: Array.from({ length: 2048 }, (_, i) => (Math.sin(i * 1.31) + 1) / 2) } }]]);
for (const track of timeline.tracks) for (const clip of track.clips) {
  clip.media_id = "fixture-media";
  clip.source_in_frames = 0; clip.source_out_frames = clip.length_frames;
}
const output = document.querySelector("#result"), start = document.querySelector("#start");
let samples = [], intervals = [], previous = 0, frame = 0, active = false, hidden = false;
const draw = createDraw(document.querySelector("canvas"), () => timeline, view, () => assets, (duration) => {
  if (!active) return;
  const now = performance.now();
  if (frame >= 60) { samples.push(duration); intervals.push(now - previous); }
  previous = now;
  hidden ||= document.visibilityState !== "visible";
  frame++;
  if (frame >= 720) {
    active = false; start.disabled = false;
    const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
    const report = { clips: timeline.tracks.reduce((n, t) => n + t.clips.length, 0), tracks: timeline.tracks.length, frames: frame, warmup_frames: 60, samples: samples.length, device_pixel_ratio: devicePixelRatio, viewport: [innerWidth, innerHeight], canvas_css: [document.querySelector("canvas").clientWidth, 540], user_agent: navigator.userAgent, hidden_during_run: hidden, paint_ms: { p50: percentile(samples, .5), p95: percentile(samples, .95), max: Math.max(...samples) }, raf_interval_ms: { p50: percentile(intervals, .5), p95: percentile(intervals, .95), max: Math.max(...intervals) }, over_25ms: intervals.filter((v) => v > 25).length, scope: "Windows browser, actual reported DPR only; not an OS 100/125/150% scaling matrix or hardware Program playback" };
    output.textContent = JSON.stringify(report, null, 2);
    output.dataset.complete = "true";
    return;
  }
  view.origin = Math.round((Math.sin(frame / 85) + 1) * 2600);
  view.scale = 20 + (Math.sin(frame / 110) + 1) * 28;
  view.scrollY = Math.round((Math.sin(frame / 90) + 1) * 80);
  view.playhead = view.origin + 180;
  const clip = timeline.tracks[1].clips[Math.min(62, Math.floor(view.origin / 150) + 1)];
  view.selection = [clip.id];
  view.draft = { changes: [{ to_track: timeline.tracks[1].id, to_start_frame: clip.start_frame + (frame % 40), length_frames: clip.length_frames }] };
  draw.invalidate();
});
start.addEventListener("click", () => { samples = []; intervals = []; previous = 0; frame = 0; hidden = false; active = true; start.disabled = true; output.dataset.complete = "false"; output.textContent = "Running…"; draw.invalidate(); });
