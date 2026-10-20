export function curveKeyOperation(clip, target, previous, frame, value, mode, handles) {
  if (!Number.isSafeInteger(frame) || (value !== null && frame < 0)) throw new Error("Choose a nonnegative integer source frame for a new or moved key");
  if (value !== null && !Number.isFinite(value)) throw new Error("Choose a finite keyframe value");
  let interpolation = mode;
  if (mode === "Bezier") {
    if (handles.length !== 4 || handles.some((v, i) => !Number.isFinite(v) || v < (i % 2 ? -10 : 0) || v > (i % 2 ? 10 : 1))) throw new Error("Bezier X must be 0–1 and Y must be −10–10");
    interpolation = {Bezier: {c1: handles.slice(0, 2), c2: handles.slice(2)}};
  } else if (!["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut"].includes(mode)) throw new Error("Choose a native interpolation");
  return {kind: "edit_curve_key", clip_id: clip, edit: {target, previous_source_frame: previous, source_frame: frame, value, interpolation}};
}

export function curveHandles(curve, selected) {
  const index = curve.keys.findIndex((k) => k.source_frame === selected), key = curve.keys[index], next = curve.keys[index + 1];
  if (!key?.controls || !next) return [];
  return key.controls.map((point, index) => ({index, point, start: key, end: next,
    frame: key.source_frame + (next.source_frame - key.source_frame) * point[0], value: key.value + (next.value - key.value) * point[1]}));
}

export function curveGeometry(curve, range, width, height, selected = null) {
  const values = [...curve.samples.map((p) => p[1]), ...curve.keys.filter((k) => k.source_frame >= range.source_start && k.source_frame <= range.source_end).map((k) => k.value)];
  values.push(...curveHandles(curve, selected).map((p) => p.value));
  let min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * 0.1, Math.abs(min) * 0.02, 0.01);
  min -= padding; max += padding;
  const left = 42, top = 12, plotWidth = Math.max(1, width - left - 12), plotHeight = Math.max(1, height - top - 28);
  return {min, max, left, top, plotWidth, plotHeight,
    x: (frame) => left + (frame - range.source_start) / Math.max(1, range.source_end - range.source_start) * plotWidth,
    y: (value) => top + (max - value) / (max - min) * plotHeight,
    frame: (x) => Math.round(range.source_start + Math.max(0, Math.min(1, (x - left) / plotWidth)) * (range.source_end - range.source_start)),
    value: (y) => Math.max(curve.min, Math.min(curve.max, max - (y - top) / plotHeight * (max - min))),
    control: (handle, x, y) => [Math.max(0, Math.min(1, (range.source_start + (x - left) / plotWidth * (range.source_end - range.source_start) - handle.start.source_frame) / (handle.end.source_frame - handle.start.source_frame))), Math.max(-10, Math.min(10, handle.end.value === handle.start.value ? handle.point[1] : (max - (y - top) / plotHeight * (max - min) - handle.start.value) / (handle.end.value - handle.start.value)))]};
}

export function bindCurveGesture(canvas, {getCurve, getGeometry, getHandles = () => [], isBusy, canEdit, select, draft, draftHandle, finish, reset}) {
  let gesture = null;
  const cancel = () => { if (gesture) { gesture = null; reset(); } };
  canvas.addEventListener("pointerdown", (event) => {
    const g = getGeometry(); if (isBusy() || event.button !== 0 || !g) return;
    const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    const handle = getHandles().find((h) => Math.hypot(g.x(h.frame) - x, g.y(h.value) - y) <= 9);
    if (handle && canEdit()) {
      canvas.focus(); canvas.setPointerCapture(event.pointerId);
      gesture = {id: event.pointerId, handle, g, x, y, moved: false, point: handle.point}; return;
    }
    const key = getCurve().keys.find((k) => Math.hypot(g.x(k.source_frame) - x, g.y(k.value) - y) <= 10);
    if (!key) return; canvas.focus(); select(key);
    if (!canEdit()) return;
    canvas.setPointerCapture(event.pointerId);
    gesture = {id: event.pointerId, key, g: getGeometry(), x, y, moved: false, point: {frame: key.source_frame, value: key.value}};
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    if (!gesture.moved && Math.hypot(x - gesture.x, y - gesture.y) < 3) return;
    gesture.moved = true;
    if (gesture.handle) { gesture.point = gesture.g.control(gesture.handle, x, y); draftHandle(gesture.handle.index, gesture.point); }
    else { gesture.point = {frame: gesture.g.frame(gesture.g.x(gesture.key.source_frame) + x - gesture.x), value: gesture.g.value(gesture.g.y(gesture.key.value) + y - gesture.y)}; draft(gesture.point); }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const before = gesture; gesture = null; canvas.releasePointerCapture(event.pointerId);
    const changed = before.handle ? before.point.some((v, i) => v !== before.handle.point[i]) : before.point.frame !== before.key.source_frame || before.point.value !== before.key.value;
    if (before.moved && changed) finish(before.point); else reset();
  });
  canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); cancel(); } });
  return {cancel};
}

export function renderCurves(root, detail, {disabled, commit, notice, openState}) {
  const range = detail.curves;
  if (!range?.tracks.length) return null;
  const section = document.createElement("details"), summary = document.createElement("summary");
  section.className = "curve-editor";
  section.dataset.visualPath = "curves"; section.open = openState?.get("curves") || false;
  summary.textContent = "Curves and keyframe editor"; section.append(summary);
  const note = document.createElement("p"); note.className = "muted";
  note.textContent = `Source frames ${range.source_start}–${range.source_end}. Native sampled curves; interpolation belongs to the outgoing key. Drag keys or Bezier handles, or edit fields. Each Apply or completed drag is one Undo. Escape cancels a drag.`;
  section.append(note);
  const tracks = document.createElement("select"); tracks.setAttribute("aria-label", "Curve parameter");
  range.tracks.forEach((curve, index) => tracks.append(new Option(`${curve.name} (${curve.key_count} keys)`, String(index))));
  tracks.value = String(Math.max(0, range.tracks.findIndex((c) => JSON.stringify(c.target) === openState?.get("curves-target"))));
  section.append(tracks);
  const canvas = document.createElement("canvas"); canvas.className = "curve-graph"; canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Native keyframe curve. Select keys below for keyboard editing."); section.append(canvas);
  const status = document.createElement("p"); status.className = "muted"; status.setAttribute("aria-live", "polite"); section.append(status);
  const select = document.createElement("select"); select.setAttribute("aria-label", "Curve keyframe"); section.append(select);
  const form = document.createElement("form"), fields = {};
  function number(name, key, min, max, step = "any") {
    const label = document.createElement("label"); label.className = "field"; label.textContent = name;
    const input = document.createElement("input"); input.type = "number"; input.required = true;
    input.min = min; input.max = max; input.step = step; input.disabled = disabled; fields[key] = input;
    label.append(input); form.append(label); return input;
  }
  const frame = number("Key source frame", "frame", range.source_start, range.source_end, 1);
  const value = number("Key value", "value", 0, 1);
  const mode = document.createElement("select"); mode.setAttribute("aria-label", "Curve interpolation"); mode.disabled = disabled;
  for (const name of ["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut", "Bezier"]) mode.append(new Option(name, name)); form.append(mode);
  const handles = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = "Normalized Bezier controls"; handles.append(legend);
  for (const [i, key] of ["c1x", "c1y", "c2x", "c2y"].entries()) {
    const input = number(`Bezier ${key}`, key, i % 2 ? -10 : 0, i % 2 ? 10 : 1);
    handles.append(input.parentElement);
  }
  form.append(handles);
  const apply = document.createElement("button"); apply.textContent = "Apply curve key"; apply.disabled = disabled; form.append(apply);
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete curve key"; form.append(remove);
  const duplicate = document.createElement("button"); duplicate.type = "button"; duplicate.textContent = "Duplicate as new key"; form.append(duplicate);
  section.append(form); root.append(section);
  let drafting = false, handleDraft = null, geometry = null, waiting = false, disposed = false;
  const events = new AbortController();
  const current = () => range.tracks[Number(tracks.value)];
  const previous = () => select.value === "" ? null : Number(select.value);
  function draw() {
    if (disposed || !section.open) return;
    const box = canvas.getBoundingClientRect(); if (!box.width) return;
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext("2d"), style = getComputedStyle(canvas); ctx.scale(ratio, ratio);
    const color = (key) => style.getPropertyValue(key).trim();
    ctx.fillStyle = color("--bg"); ctx.fillRect(0, 0, box.width, box.height);
    geometry = handleDraft ? geometry : curveGeometry(current(), range, box.width, box.height, previous());
    const g = geometry; ctx.font = "10px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const y = g.top + g.plotHeight * i / 4;
      ctx.strokeStyle = color("--border"); ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.left + g.plotWidth, y); ctx.stroke();
      ctx.fillStyle = color("--muted"); ctx.fillText((g.max - (g.max - g.min) * i / 4).toPrecision(3), 1, y + 4);
    }
    ctx.fillStyle = color("--muted"); ctx.fillText(String(range.source_start), g.left, box.height - 6);
    ctx.textAlign = "right"; ctx.fillText(String(range.source_end), g.left + g.plotWidth, box.height - 6); ctx.textAlign = "left";
    ctx.strokeStyle = color("--primary"); ctx.lineWidth = 1.5; ctx.beginPath();
    current().samples.forEach(([frame, value], index) => { if (index) ctx.lineTo(g.x(frame), g.y(value)); else ctx.moveTo(g.x(frame), g.y(value)); }); ctx.stroke();
    for (const handle of curveHandles(current(), previous())) {
      if (handle.start.source_frame < range.source_start || handle.end.source_frame > range.source_end) continue;
      const point = handleDraft?.index === handle.index ? handleDraft.point : handle.point;
      const x = g.x(handle.start.source_frame + (handle.end.source_frame - handle.start.source_frame) * point[0]);
      const y = g.y(handle.start.value + (handle.end.value - handle.start.value) * point[1]);
      const end = handle.index ? handle.end : handle.start;
      ctx.strokeStyle = color("--violet"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.x(end.source_frame), g.y(end.value)); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = color("--violet"); ctx.fill();
    }
    for (const key of current().keys) {
      if (key.source_frame < range.source_start || key.source_frame > range.source_end) continue;
      ctx.fillStyle = color(key.source_frame === previous() ? "--text" : "--primary");
      ctx.beginPath(); ctx.arc(g.x(key.source_frame), g.y(key.value), 4, 0, Math.PI * 2); ctx.fill();
    }
    if (drafting) {
      ctx.strokeStyle = color("--amber"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x(Number(frame.value)), g.y(Number(value.value)), 6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function load() {
    const key = current().keys.find((k) => k.source_frame === previous());
    frame.value = key?.source_frame ?? Math.max(range.source_start, Math.min(range.source_end, detail.source_frame));
    value.min = current().min; value.max = current().max; value.value = key?.value ?? current().default;
    const interpolation = key?.interpolation || "Linear";
    mode.value = typeof interpolation === "string" ? interpolation : "Bezier";
    const points = key?.controls?.flat() || [1/3, 1/3, 2/3, 2/3];
    ["c1x", "c1y", "c2x", "c2y"].forEach((key, index) => { fields[key].value = points[index]; });
    handles.hidden = mode.value !== "Bezier"; handles.disabled = mode.value !== "Bezier" || disabled;
    remove.disabled = duplicate.disabled = disabled || !key;
    status.textContent = key ? `Source ${key.source_frame} · timeline ${key.timeline_frame} · ${current().name}` : "New keyframe · choose a free source frame";
    openState?.set("curves-key", select.value); draw();
  }
  function chooseCurve() {
    select.replaceChildren(new Option("New keyframe", ""));
    current().keys.forEach((key) => select.append(new Option(`Source ${key.source_frame} · ${key.value} · timeline ${key.timeline_frame}`, String(key.source_frame))));
    select.value = [...select.options].some((o) => o.value === openState?.get("curves-key")) ? openState.get("curves-key") : "";
    openState?.set("curves-target", JSON.stringify(current().target));
    load();
    if (current().key_count > current().keys.length) status.textContent += " · first 2048 keys shown";
  }
  async function save(deleting = false) {
    if (waiting || disabled || (!deleting && !form.reportValidity())) return;
    try {
      const operation = curveKeyOperation(detail.clip_id, current().target, previous(), Number(frame.value), deleting ? null : Number(value.value), mode.value, ["c1x", "c1y", "c2x", "c2y"].map((key) => Number(fields[key].value)));
      waiting = true; form.inert = true; tracks.disabled = select.disabled = true;
      openState?.set("curves-key", deleting ? "" : frame.value);
      await commit(operation);
    } catch (error) { notice(error.message); load(); }
    finally { waiting = false; form.inert = false; tracks.disabled = select.disabled = false; }
  }
  const drag = bindCurveGesture(canvas, {
    getCurve: () => ({keys: current().keys.filter((k) => k.source_frame >= range.source_start && k.source_frame <= range.source_end)}),
    getGeometry: () => geometry, isBusy: () => waiting, canEdit: () => !disabled,
    getHandles: () => curveHandles(current(), previous()).filter((h) => h.start.source_frame >= range.source_start && h.end.source_frame <= range.source_end),
    select: (key) => { select.value = String(key.source_frame); load(); },
    draft: (point) => { drafting = true; frame.value = point.frame; value.value = point.value; status.textContent = `Draft source ${frame.value} · value ${Number(value.value).toPrecision(5)} · release to apply`; draw(); },
    draftHandle: (index, point) => { handleDraft = {index, point}; mode.value = "Bezier"; handles.hidden = handles.disabled = false; fields[index ? "c2x" : "c1x"].value = point[0]; fields[index ? "c2y" : "c1y"].value = point[1]; status.textContent = "Draft Bezier control · release to apply"; draw(); },
    finish: () => { drafting = false; handleDraft = null; draw(); save(); },
    reset: () => { drafting = false; handleDraft = null; load(); },
  });
  tracks.addEventListener("change", () => { drag.cancel(); chooseCurve(); });
  select.addEventListener("change", () => { drag.cancel(); load(); });
  mode.addEventListener("change", () => { handles.hidden = mode.value !== "Bezier"; handles.disabled = handles.hidden || disabled; });
  form.addEventListener("submit", (event) => { event.preventDefault(); save(); });
  remove.addEventListener("click", () => save(true));
  duplicate.addEventListener("click", () => { select.value = ""; frame.value = Math.min(range.source_end, Number(frame.value) + 1); remove.disabled = duplicate.disabled = true; status.textContent = "Duplicate draft · choose a free source frame and Apply"; draw(); });
  window.addEventListener("blur", drag.cancel, {signal: events.signal});
  section.addEventListener("toggle", draw);
  const observer = new ResizeObserver(draw); observer.observe(canvas); chooseCurve();
  return {cancel() { drag.cancel(); disposed = true; events.abort(); observer.disconnect(); }};
}
