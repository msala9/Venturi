import { createViewer, matchesFrame } from "./viewer.js";

export function matchesScope(request, current) {
  return matchesFrame(request, current) && ["clip", "first", "second"].every((key) => request[key] === current[key]);
}
export function scopeURL({ clip, first, second, ...frame }) {
  return `/api/v1/preview/scopes/${encodeURIComponent(clip)}/${encodeURIComponent(first)}/${encodeURIComponent(second)}?${new URLSearchParams(frame)}`;
}
export function scopeTarget(document, timeline, selection, frame) {
  if (!document?.capabilities.scopes || !timeline) return null;
  const clips = timeline.tracks.filter((track) => track.kind === "video").flatMap((track) => track.clips).filter((clip) => selection.includes(clip.id));
  if (clips.length !== 1 || frame < clips[0].start_frame || frame >= clips[0].start_frame + clips[0].length_frames) return null;
  return { project_epoch: document.project_epoch, if_generation: document.generation, timeline_id: timeline.id, revision: timeline.revision, frame, width: 960, clip: clips[0].id };
}
export function createScopes({ panel, getTarget }) {
  const image = panel.querySelector("img"), status = panel.querySelector("output"), empty = panel.querySelector("p");
  const selects = panel.querySelectorAll("select");
  const viewer = createViewer({ image, status, empty, matches: matchesScope, endpoint: scopeURL, getState: () => {
    const target = !panel.hidden && getTarget();
    return target ? { ...target, first: selects[0].value, second: selects[1].value } : null;
  } });
  function refresh() {
    if (panel.hidden) return;
    if (!getTarget()) {
      viewer.invalidate(); status.textContent = "Select one video clip containing the playhead";
      return;
    }
    const target = getTarget();
    panel.querySelector("[data-scope-context]").textContent = `Clip ${target.clip} · timeline frame ${target.frame} · native isolated stack`;
    return viewer.seek();
  }
  for (const select of selects) select.addEventListener("change", refresh);
  panel.querySelector("button").addEventListener("click", refresh);
  return { refresh, invalidate(message) { viewer.invalidate(); status.textContent = message; }, setVisible(visible) { panel.hidden = !visible; if (visible) refresh(); else viewer.invalidate(); } };
}
