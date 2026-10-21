import { request } from "./api.js";

export function sourceFrameAtTime(seconds, fps) {
  // Media clocks round requested seeks to microseconds.
  return Math.max(0, Math.floor((seconds + 1e-6) * fps));
}

export function sourceSelection(start, end, duration) {
  if (![start,end,duration].every(Number.isSafeInteger) || start < 0 || end <= start || end > duration) throw new Error("Source in/out must be integer frames inside the media; out is exclusive");
  return { source_in:start, source_out:end };
}

export function sourceAssetURL(media, job, name, epoch) {
  return `/api/v1/media/${encodeURIComponent(media)}/jobs/${encodeURIComponent(job)}/${name}?${new URLSearchParams({ project_epoch: epoch })}`;
}
function delay(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Canceled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 300);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function createSourcePlayer({ video, image, status, cancel, onReady, api = request }) {
  let sequence = 0, controller = null, jobPath = null, ready = false;
  const reset = () => {
    sequence++;
    controller?.abort();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = false;
    if (image) { image.hidden = true; image.removeAttribute("src"); }
    ready = false;
    cancel.disabled = true;
    jobPath = null;
    status.textContent = "Select media and open Source";
  };
  async function open(item, epoch, quality = "medium") {
    reset();
    const seq = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    status.textContent = `${item.name} · Preparing ${item.is_image ? "original image" : `${quality} source proxy`}`;
    try {
      let job = await api(`/media/${encodeURIComponent(item.id)}/prepare`, { project_epoch: epoch, quality });
      if (seq !== sequence) return;
      jobPath = `/api/v1/media/${encodeURIComponent(item.id)}/jobs/${encodeURIComponent(job.id)}?${new URLSearchParams({ project_epoch: epoch })}`;
      cancel.disabled = false;
      while (job.state === "queued" || job.state === "running") {
        status.textContent = `${item.name} · ${job.state} · ${job.frames} frames`;
        await delay(signal);
        const response = await fetch(jobPath, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
        if (!response.ok) throw new Error("Source job is no longer available; reopen Source");
        job = await response.json();
        if (seq !== sequence) return;
      }
      if (job.state !== "ready") throw new Error(job.error || `Source ${job.state}`);
      const still = ["source.png", "source.jpg", "source.webp"].includes(job.source_asset);
      if (still) {
        if (!image) throw new Error("Image viewer unavailable");
        image.src = sourceAssetURL(item.id, job.id, job.source_asset, epoch);
        image.alt = item.name; image.hidden = false; video.hidden = true;
      } else video.src = sourceAssetURL(item.id, job.id, "source.mp4", epoch);
      ready = !still;
      cancel.disabled = true;
      status.textContent = still ? `${item.name} · ORIGINAL STILL · embedded color profile and transparency preserved` : `${item.name} · SOURCE PROXY · ${quality} · first audio stream`;
      onReady?.({ item, epoch, job: job.id });
    } catch (error) {
      if (seq === sequence && error.name !== "AbortError") {
        status.textContent = error.message;
        cancel.disabled = true;
      }
    }
  }
  cancel.addEventListener("click", async () => {
    const path = jobPath;
    reset();
    status.textContent = "Source preparation canceled";
    if (path) await fetch(path, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
  });
  video.addEventListener("error", () => {
    if (video.getAttribute("src")) status.textContent = "Browser could not decode this proxy; reopen Source or choose another quality";
  });
  return { open, reset, pause: () => video.pause(),
    async toggle() { if (ready) { if (video.paused) await video.play(); else video.pause(); } },
    step(delta, fps, totalFrames) { if (ready) { video.pause(); const frame = Math.max(0, Math.min(totalFrames - 1, Math.round(video.currentTime * fps) + delta)); video.currentTime = frame / fps; } },
  };
}
