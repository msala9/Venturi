import { request } from "./api.js";

export function exportRequest(state, values) {
  if (!state) throw new Error("Open a nonempty native timeline first");
  const start = Number(values.start), end = Number(values.end), width = Number(values.width), quality = Number(values.quality);
  if ([values.start, values.end, values.width, values.quality].some((value) => String(value).trim() === "") || ![start, end, width, quality].every(Number.isSafeInteger) || typeof values.audio !== "boolean" || start < 0 || end <= start || end > state.end_frame || end - start > Math.floor(300 * state.fps.num / state.fps.den) || ![640, 960, 1280, 1920].includes(width) || quality < 0 || quality > 51) throw new Error("Choose an integer range up to five minutes within the timeline and CRF 0–51");
  const { fps, ...range } = state;
  return { range: { ...range, start_frame: start, end_frame: end, width }, settings: { quality, preset: values.preset, audio: values.audio } };
}

export function createExportPanel({ form, status, cancel, refresh, download, getState, api = request, storage = sessionStorage }) {
  let current = null, timer = null;
  const start = form.querySelector("button[type=submit],#export-start");
  const path = () => `/exports/${encodeURIComponent(current.id)}?${new URLSearchParams({ project_epoch: current.epoch })}`;
  function persist() { try { storage.setItem("venturi-export-job", JSON.stringify(current)); } catch {} }
  function display(job) {
    const busy = ["queued", "running"].includes(job.state);
    cancel.disabled = !busy; start.disabled = busy; refresh.disabled = false;
    const progress = job.progress;
    status.textContent = `${job.state.toUpperCase()} · ${progress?.current_frame || 0}/${progress?.total_frames || "…"} frames${job.error ? ` · ${job.error}` : ""}${progress?.compositor ? ` · ${progress.compositor} · ${progress.encoder}` : ""}`;
    download.hidden = job.state !== "ready";
    if(job.program) {
      const output=job.program,settings=output.export_settings;
      status.textContent+=` · snapshot frames ${output.start_frame}–${output.end_frame} · ${output.width}×${output.height}`;
      download.textContent=`Download MP4 · frames ${output.start_frame}–${output.end_frame}${settings ? ` · CRF ${settings.quality} ${settings.preset}${settings.audio ? " + AAC" : " · silent"}` : ""}`;
    }
    if (!download.hidden) download.href = `/api/v1/exports/${encodeURIComponent(current.id)}/export.mp4?${new URLSearchParams({ project_epoch: current.epoch })}`;
    clearTimeout(timer);
    if (busy) timer = setTimeout(poll, 500);
  }
  async function poll() {
    if (!current) return;
    try { display(await api(path())); }
    catch (error) { clearTimeout(timer); status.textContent = `Export status unavailable · ${error.message}`; start.disabled = false; cancel.disabled = true; download.hidden = true; }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(form)); values.audio = form.elements.audio.checked;
      const body = exportRequest(getState(), values);
      start.disabled = true; status.textContent = "Submitting native export…";
      const job = await api("/exports", body);
      current = { id: job.id, epoch: body.range.project_epoch }; persist(); display(job);
    } catch (error) { start.disabled = false; status.textContent = error.message; }
  });
  cancel.addEventListener("click", async () => {
    if (!current) return;
    try {
      const response = await fetch(`/api/v1${path()}`, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("Cancel request failed");
      display(await response.json());
    } catch (error) { status.textContent = error.message; }
  });
  refresh.addEventListener("click", poll);
  try { current = JSON.parse(storage.getItem("venturi-export-job")); if (current?.id && current?.epoch) poll(); else current = null; } catch { current = null; }
  return { open() { const state = getState(); if (state) { form.elements.start.value = 0; form.elements.end.value = state.end_frame; } } };
}
