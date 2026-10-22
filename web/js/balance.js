import { matchesFrame } from "./viewer.js";

const pendingOwners = new WeakSet();

export function balanceTarget(document, timeline, selection, frame) {
  if (!document?.capabilities?.scopes || !timeline || !Array.isArray(selection) || !Number.isSafeInteger(frame)) return null;
  const selected = new Set(selection);
  const targets = timeline.tracks.filter((track) => track.kind === "video")
    .flatMap((track) => track.clips.filter((clip) => selected.has(clip.id)).map((clip) => ({track,clip})));
  if (targets.length !== 1) return null;
  const {track,clip} = targets[0];
  if (track.locked || frame < clip.start_frame || frame >= clip.start_frame + clip.length_frames) return null;
  return {project_epoch:document.project_epoch,if_generation:document.generation,timeline_id:timeline.id,revision:timeline.revision,frame,width:960,clip:clip.id};
}

export async function balanceSelected({owner, getTarget, canInteract = () => true, api, commit}) {
  if (!owner || !["object","function"].includes(typeof owner)) throw new Error("Balance requires a stable interaction owner");
  if (pendingOwners.has(owner)) throw new Error("Auto Balance is already running");
  pendingOwners.add(owner);
  try {
    if (!canInteract()) throw new Error("Auto Balance is unavailable in the current workspace");
    const target = getTarget();
    if (!target) throw new Error("Select one video clip containing the stopped playhead");
    const current = {...target};
    const {clip, ...frame} = current;
    const result = await api(`/preview/balance/${encodeURIComponent(clip)}?${new URLSearchParams(frame)}`);
    if (!canInteract()) throw new Error("Auto Balance is unavailable in the current workspace");
    const next = getTarget();
    if (!next || next.clip !== clip || !matchesFrame(current,next) || result?.clip !== clip || !result.query || !matchesFrame(result.query,current))
      throw new Error("Balance result is stale; the selection, playhead or project changed");
    if (result.operation?.kind !== "apply_grade_at_frame" || result.operation.clip_id !== clip || result.operation.frame !== current.frame)
      throw new Error("Native balance operation does not match the captured clip frame");
    if (!Array.isArray(result.operation.values)) throw new Error("Native balance operation has invalid grade values");
    if (!result.operation.values.length) return false;
    await commit(result.operation);
    return true;
  } finally {
    pendingOwners.delete(owner);
  }
}
