export function detailIdentity(state) {
  return state ? [state.project_epoch, state.generation, state.timeline, state.revision, state.clip, state.frame].join(":") : null;
}
export function propertyOperation(clip, patch) { return { kind: "set_properties", clip_id: clip, patch }; }
export function keyframeOperation(clip, target, frame, value, interpolation = "Linear") {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Choose an integer timeline frame");
  return { kind: "set_keyframe", clip_id: clip, edit: { target, timeline_frame: frame, value, interpolation } };
}
export function renderProperties(root, detail, { writable, getFrame, commit, reload, notice }) {
  const disabled = !writable || detail.locked;
  const report = (operation) => commit(operation).catch((error) => notice(error.message));
  const section = document.createElement("details"); section.open = true;
  const heading = document.createElement("summary"); heading.textContent = "Properties and keyframes"; section.append(heading);
  const note = document.createElement("p"); note.className = "muted";
  note.textContent = `Native evaluation at timeline frame ${detail.timeline_frame} / source frame ${detail.source_frame}. Apply sets the default; ◆ writes at the playhead.`;
  section.append(note);
  const refresh = document.createElement("button"); refresh.textContent = "Read at playhead"; refresh.addEventListener("click", reload); section.append(refresh);
  const interpolation = document.createElement("select"); interpolation.setAttribute("aria-label", "Keyframe interpolation");
  for (const name of ["Linear", "Hold", "EaseInOut", "EaseIn", "EaseOut"]) interpolation.append(new Option(name, name));
  section.append(interpolation);
  function number(label, value, min, max, patch, target = null, keys = []) {
    const form = document.createElement("form"); form.className = "property-row";
    const field = document.createElement("label"); field.className = "field"; field.textContent = label;
    const input = document.createElement("input"); input.type = "number"; input.step = "any"; input.min = min; input.max = max; input.value = value; input.disabled = disabled;
    field.append(input); form.append(field);
    const apply = document.createElement("button"); apply.textContent = "Apply"; apply.disabled = disabled;
    form.append(apply); form.addEventListener("submit", (event) => { event.preventDefault(); if (form.reportValidity()) report(propertyOperation(detail.clip_id, patch(Number(input.value)))); });
    if (target) for (const [text, remove] of [["◆", false], ["−◆", true]]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.disabled = disabled;
      button.setAttribute("aria-label", `${remove ? "Remove" : "Set"} ${label} keyframe at playhead`);
      button.addEventListener("click", () => { if (form.reportValidity()) report(keyframeOperation(detail.clip_id, target, getFrame(), remove ? null : Number(input.value), interpolation.value)); });
      form.append(button);
    }
    section.append(form);
    if (keys.length) {
      const list = document.createElement("p"); list.className = "muted keyframe-list";
      list.textContent = `Source keyframes: ${keys.map(([frame, value, mode]) => `${frame}: ${value} (${typeof mode === "string" ? mode : "Bezier"})`).join(", ")}`;
      section.append(list);
    }
  }
  if (detail.video) {
    for (const parameter of detail.transform) number(parameter.param, parameter.value, parameter.min, parameter.max, (value) => ({ transform: [{ param: parameter.param, value }] }), { kind: "transform", param: parameter.param }, parameter.keyframes);
    function choice(label, value, values, patch) {
      const field = document.createElement("label"); field.className = "field"; field.textContent = label;
      const select = document.createElement("select"); select.disabled = disabled;
      for (const name of values) select.append(new Option(name, name)); select.value = value;
      select.addEventListener("change", () => report(propertyOperation(detail.clip_id, patch(select.value)))); field.append(select); section.append(field);
    }
    choice("Blend mode", detail.blend, detail.blends, (blend) => ({ blend }));
    choice("Track matte", detail.matte, detail.mattes, (matte) => ({ matte }));
    for (const [index, label] of [[0, "Flip horizontal"], [1, "Flip vertical"]]) {
      const button = document.createElement("button"); button.textContent = label; button.disabled = disabled; button.setAttribute("aria-pressed", detail.flip[index]);
      button.addEventListener("click", () => { const flip = [...detail.flip]; flip[index] = !flip[index]; report(propertyOperation(detail.clip_id, { flip })); }); section.append(button);
    }
    if (detail.color) {
      const form = document.createElement("form"); const fields = {};
      for (const name of ["r", "g", "b", "a"]) {
        const label = document.createElement("label"); label.className = "field"; label.textContent = `Color ${name.toUpperCase()}`;
        const input = document.createElement("input"); input.type = "number"; input.min = 0; input.max = 1; input.step = "any"; input.value = detail.color[name]; input.disabled = disabled;
        fields[name] = input; label.append(input); form.append(label);
      }
      const apply = document.createElement("button"); apply.textContent = "Apply RGBA"; apply.disabled = disabled; form.append(apply);
      form.addEventListener("submit", (event) => { event.preventDefault(); report(propertyOperation(detail.clip_id, { color: Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,Number(input.value)])) })); }); section.append(form);
    }
  } else number("Gain dB", detail.gain.value, -100, 30, (gain_db) => ({ gain_db }), { kind: "gain" }, detail.gain.keyframes);
  number("Fade in frames", detail.fade_in, 0, detail.length_frames, (fade_in) => ({ fade_in }));
  number("Fade out frames", detail.fade_out, 0, detail.length_frames, (fade_out) => ({ fade_out }));
  root.append(section);
}

export function renderMarkers(root, timeline, { writable, getFrame, commit, seek, notice }) {
  const section = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = `Timeline markers (${timeline.markers.length})`; section.append(summary);
  const form = document.createElement("form");
  const select = document.createElement("select"); select.setAttribute("aria-label","Marker to edit"); select.append(new Option("New marker at playhead", ""));
  for (const marker of timeline.markers) select.append(new Option(`${marker.start_frame} · ${marker.note.slice(0,60) || marker.id}`,marker.id));
  form.append(select);
  function field(name, type, value) {
    const label = document.createElement("label"); label.className = "field"; label.textContent = name;
    const input = document.createElement("input"); input.type = type; input.value = value; input.disabled = !writable;
    if (type === "number") { input.min = 0; input.max = 1_000_000_000; input.step = 1; } else input.maxLength = 4096;
    label.append(input); form.append(label); return input;
  }
  const start = field("Marker start frame","number",getFrame()), duration = field("Marker duration frames","number",0), note = field("Marker note","text","");
  const color = document.createElement("select"); color.setAttribute("aria-label","Marker color"); color.disabled = !writable;
  for (const name of timeline.marker_colors) color.append(new Option(name,name)); color.value = "Orange"; form.append(color);
  const submit = document.createElement("button"); submit.textContent = "Apply marker"; submit.disabled = !writable; form.append(submit);
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove marker"; remove.disabled = !writable || !select.value; form.append(remove);
  const jump = document.createElement("button"); jump.type = "button"; jump.textContent = "Go to marker"; jump.disabled = !select.value; form.append(jump);
  select.addEventListener("change", () => {
    const marker = timeline.markers.find((m) => m.id === select.value);
    start.value = marker?.start_frame ?? getFrame(); duration.value = marker?.duration_frames ?? 0; note.value = marker?.note ?? ""; color.value = marker?.color ?? "Orange";
    remove.disabled = !writable || !marker; jump.disabled = !marker;
  });
  const apply = (deleting) => commit({kind:"set_marker",marker:{id:select.value || null,delete:deleting,start_frame:Number(start.value),duration_frames:Number(duration.value),note:note.value,color:color.value}}).catch((error)=>notice(error.message));
  form.addEventListener("submit",(event)=>{event.preventDefault(); if (form.reportValidity()) apply(false);}); remove.addEventListener("click",()=>apply(true));
  jump.addEventListener("click",()=>seek(Number(start.value)));
  section.append(form); root.append(section);
}
