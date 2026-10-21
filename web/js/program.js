import { request } from "./api.js";

export function sameComposition(a, b) {
  return !!a && !!b && ["project_epoch", "if_generation", "timeline_id", "revision", "width"].every((key) => a[key] === b[key]);
}
export function createProgramPlayer({ video, status, cancel, getState, onFrame, onState, onError, onStop, api = request }) {
  let sequence = 0, controller = null, query = null, jobURL = null, state = "stopped", monitor = null, frameCallback = null, suspended = true, presented = 0;
  const setState = (next) => { state = next; cancel.disabled = next === "stopped"; cancel.textContent = next === "preparing" ? "Cancel preparation" : "Stop playback"; onState(next); };
  function pauseLocal() {
    suspended = true;
    controller?.abort();
    video.pause();
    clearInterval(monitor);
    if (frameCallback !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = null;
    if (state === "preparing") sequence++;
  }
  function stop() {
    const path = state === "preparing" ? jobURL : null;
    sequence++;
    pauseLocal();
    query = null;
    presented = 0;
    jobURL = null;
    video.removeAttribute("src"); video.load();
    setState("stopped");
    if (path) fetch(path, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
  function present(seconds = video.currentTime) {
    if (suspended || !query || !sameComposition(query, getState())) return;
    const fps = query.fps.num / query.fps.den;
    onFrame(Math.max(query.start_frame, Math.min(query.end_frame - 1, query.start_frame + Math.floor((seconds + 1e-6) * fps))));
  }
  function scheduleFrame() {
    if (!video.requestVideoFrameCallback || video.paused || frameCallback !== null) return;
    frameCallback = video.requestVideoFrameCallback((_, metadata) => { frameCallback = null; presented = metadata.presentedFrames; present(metadata.mediaTime); scheduleFrame(); });
  }
  function metrics() {
    if (!video.dataset) return;
    const quality = video.getVideoPlaybackQuality?.();
    video.dataset.playbackMetrics = JSON.stringify({ presented_frames: presented, total_frames: quality?.totalVideoFrames ?? null, dropped_frames: quality?.droppedVideoFrames ?? null, media_time: video.currentTime, duration: video.duration, frame_callback: !!video.requestVideoFrameCallback });
  }
  function monitorDocument(seq) {
    clearInterval(monitor);
    monitor = setInterval(async () => {
      if (seq !== sequence) return;
      try {
        const response = await fetch(jobURL, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
        if (seq === sequence && !response.ok) { pauseLocal(); status.textContent = "STALE_REVISION · reconnect before playback"; setState("failed"); }
      } catch { if (seq === sequence) { pauseLocal(); status.textContent = "Playback connection lost · reconnect"; setState("failed"); } }
    }, 2_000);
  }
  video.addEventListener("timeupdate", () => {present();metrics();});
  video.addEventListener("play", () => {suspended=false;scheduleFrame();});
  video.addEventListener("pause", () => {
    if (frameCallback !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = null;
    metrics();
  });
  video.addEventListener("ended",metrics);
  video.addEventListener("error", () => {
    if (video.getAttribute("src")) { status.textContent = "Program media unavailable or changed · prepare again"; setState("failed"); }
  });
  cancel.addEventListener("click", () => {stop();onStop?.();});
  async function toggle() {
    if (state === "preparing") { stop(); return; }
    if (state === "ready" && sameComposition(query, getState())) {
      monitorDocument(sequence);
      if (video.paused) {suspended=false;try{await video.play();}catch(error){if(error.name!=="AbortError")throw error;}} else video.pause();
      return;
    }
    stop();
    const current = getState();
    if (!current) return;
    const seq = ++sequence;
    controller = new AbortController();
    const signal = controller.signal;
    setState("preparing"); status.textContent = "Preparing native composition and audio…";
    try {
      let job = await api("/preview/program/prepare", current);
      if (seq !== sequence || !sameComposition(current, getState())) {
        const obsolete = `/api/v1/preview/program/${encodeURIComponent(job.id)}?${new URLSearchParams(current)}`;
        fetch(obsolete,{method:"DELETE",signal:AbortSignal.timeout(5_000)}).catch(()=>{});return;
      }
      jobURL = `/api/v1/preview/program/${encodeURIComponent(job.id)}?${new URLSearchParams(current)}`;
      while (job.state === "queued" || job.state === "running") {
        status.textContent = `Preparing composition · ${job.progress?.current_frame || 0}/${job.progress?.total_frames || "…"} frames`;
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (signal.aborted) return;
        const response = await fetch(jobURL, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
        if (!response.ok) throw new Error("Composition changed or became unavailable");
        job = await response.json();
        if (seq !== sequence || !sameComposition(current, getState())) return;
      }
      if (job.state !== "ready") throw new Error(job.error === "GPU_BUSY" ? "GPU_BUSY · retry after the inference workload releases the GPU" : job.error === "RENDER_BUSY" ? "The CPU compositor is preparing another job · wait or cancel it" : (job.error || `Composition ${job.state}`));
      query = { ...current, fps: job.program.fps };
      video.src = `/api/v1/preview/program/${encodeURIComponent(job.id)}/program.mp4?${new URLSearchParams(current)}`;
      setState("ready"); status.textContent = `COMPOSED PREVIEW · ${job.program.width}×${job.program.height} · revision ${current.revision.slice(0, 8)}`;
      monitorDocument(seq);
      try { suspended=false;await video.play(); } catch(error) { if (seq === sequence && error.name!=="AbortError") status.textContent += " · press Play"; }
    } catch (error) {
      if (seq === sequence && error.name !== "AbortError") { status.textContent = error.message; setState("failed"); onError?.(error.message); }
    }
  }
  return { toggle, stop, pauseLocal, state: () => state, range: () => query };
}
