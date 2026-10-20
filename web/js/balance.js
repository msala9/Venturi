import { matchesFrame } from "./viewer.js";

export async function balanceSelected({getTarget, api, commit}) {
  const current = getTarget();
  if (!current) throw new Error("Select one video clip containing the stopped playhead");
  const {clip, ...frame} = current;
  const result = await api(`/preview/balance/${encodeURIComponent(clip)}?${new URLSearchParams(frame)}`);
  const next = getTarget();
  if (!next || next.clip !== clip || !matchesFrame(current,next) || result.clip !== clip || !matchesFrame(result.query,current))
    throw new Error("Balance result is stale; the selection, playhead or project changed");
  if (result.operation?.kind !== "apply_grade_at_frame" || result.operation.clip_id !== clip || result.operation.frame !== current.frame)
    throw new Error("Native balance operation does not match the captured clip frame");
  if (!result.operation?.values?.length) return false;
  await commit(result.operation);
  return true;
}
