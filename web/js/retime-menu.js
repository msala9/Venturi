import { retimeSpeedLabel } from "./timeline/geometry.js";

export const RETIME_PRESETS = Object.freeze([10,25,50,75,100,125,150,200,400,1000]);

export function retimeMenuIdentity(context) {
  if (!context) return null;
  return JSON.stringify([context.project_epoch,context.generation,context.timeline_id,context.revision,context.track_id,
    context.clip,context.linked,context.overwrite,context.viewIdentity]);
}

export function retimePresetOperation(context, percent) {
  if (!context?.editable || typeof context.clip?.id !== "string" || !context.clip.id || !context.clip.retime || !Number.isFinite(context.clip.retime.speed_percent) || context.clip.retime.speed_percent <= 0 ||
      !RETIME_PRESETS.includes(percent) || typeof context.overwrite !== "boolean") throw Error("A current writable speed strip is required");
  return { kind: "retime_preset", clip_id: context.clip.id, percent, overwrite: context.overwrite };
}

export function createRetimeMenu({ getContext, commit, onAdvanced, onHide, notice = () => {}, document: documentRef = document }) {
  let active = null, pending = false, disposed = false;
  const windowRef = documentRef.defaultView;
  const current = value => active === value && !disposed && getContext(value.target)?.editable &&
    retimeMenuIdentity(getContext(value.target)) === value.identity;
  function close(restore = true) {
    const previous = active;
    active = null;
    if (!previous) return;
    previous.dialog.close(); previous.dialog.remove();
    if (restore && previous.returnFocus?.isConnected !== false) previous.returnFocus?.focus({ preventScroll: true });
  }
  function validate(value) {
    if (active !== value || disposed) return false;
    if (current(value)) return true;
    close(); notice("Speed menu closed because the clip, viewport or editing session changed"); return false;
  }
  async function choose(value, percent) {
    if (pending || !validate(value)) return;
    const operation = retimePresetOperation(getContext(value.target), percent);
    pending = true; close();
    try { await commit(operation); } catch (error) { notice(error.message); } finally { pending = false; }
  }
  function open(target) {
    if (disposed || pending) return false;
    close(false);
    const context = getContext(target);
    if (!context?.editable || !Number.isFinite(context.clip?.retime?.speed_percent) || context.clip.retime.speed_percent <= 0) {
      notice("A current unlocked speed strip and writable idle session are required"); return false;
    }
    if (documentRef.querySelector?.("dialog[open]")) return false;
    const dialog = documentRef.createElement("dialog"), heading = documentRef.createElement("h2"), status = documentRef.createElement("p"), buttons = [];
    dialog.setAttribute("aria-label", "Clip speed presets");
    heading.textContent = `${context.clip.name || `Clip ${context.clip.id}`} · ${retimeSpeedLabel(context.clip.retime.speed_percent)}`;
    status.textContent = context.overwrite ? "OVERWRITE clips enabled · Growing clips can replace overlaps; Undo restores them" : "Resize at native speed · Shorter clips leave a gap; overlaps are refused";
    dialog.append(heading, status);
    const value = { target: { clip_id: target.clip_id, track_id: target.track_id }, returnFocus: target.returnFocus || documentRef.activeElement, identity: retimeMenuIdentity(context), dialog, buttons };
    const button = (label, action) => {
      const node = documentRef.createElement("button"); node.type = "button"; node.textContent = label;
      node.addEventListener("click", action); buttons.push(node); dialog.append(node); return node;
    };
    for (const percent of RETIME_PRESETS) {
      const node = button(`${percent}%`, () => choose(value, percent));
      if (context.clip.retime.speed_percent === percent) node.setAttribute("aria-current", "true");
    }
    button("Change clip speed…", () => { if (!pending && validate(value)) { close(false); onAdvanced(value.target); } });
    button("Hide this clip’s speed strip", () => { if (!pending && validate(value)) { close(); onHide(value.target); } });
    button("Cancel", () => { if (active === value) close(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (active === value) close(); });
    dialog.addEventListener("close", () => { if (active === value) close(); });
    dialog.addEventListener("keydown", event => {
      if (active !== value) return;
      if (["ArrowDown","ArrowRight","ArrowUp","ArrowLeft","Home","End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = buttons.indexOf(documentRef.activeElement), backwards = ["ArrowUp","ArrowLeft"].includes(event.key);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (backwards ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    });
    active = value; documentRef.body.append(dialog); dialog.showModal();
    const currentIndex = RETIME_PRESETS.indexOf(context.clip.retime.speed_percent);
    buttons[currentIndex < 0 ? 0 : currentIndex].focus();
    return true;
  }
  const viewportChanged = event => {
    if (event?.type === "scroll" && active?.dialog.contains?.(event.target)) return;
    close();
  };
  const visibilityChanged = () => { if (documentRef.hidden) close(false); };
  windowRef?.addEventListener("resize", viewportChanged);
  windowRef?.addEventListener("scroll", viewportChanged, true);
  windowRef?.addEventListener("blur", viewportChanged);
  documentRef.addEventListener("visibilitychange", visibilityChanged);
  return { open, close, invalidate() { if (active && !current(active)) close(); }, dispose() {
    disposed = true; close(false);
    windowRef?.removeEventListener("resize", viewportChanged);
    windowRef?.removeEventListener("scroll", viewportChanged, true);
    windowRef?.removeEventListener("blur", viewportChanged);
    documentRef.removeEventListener("visibilitychange", visibilityChanged);
  } };
}
