import { isTextTarget, installSplitter } from "./ui.js";
import { createTimeline, fixtureTimeline } from "./timeline/index.js";
import { linkedSelection } from "./timeline/geometry.js";
import { request, sendMutation, ApiFailure, persistentClientId } from "./api.js";
import { createViewer } from "./viewer.js";
import { createSourcePlayer, sourceAssetURL, sourceSelection } from "./source.js";
import { createProgramPlayer } from "./program.js";
import { detailIdentity, renderProperties, renderMarkers } from "./inspector.js";

const $ = (id) => document.getElementById(id);
const editor = $("editor");
$("search").addEventListener("input", () => {
  const query = $("search").value.toLowerCase();
  document.querySelectorAll(".media-item").forEach((card) => {
    card.hidden = !card.textContent.toLowerCase().includes(query);
  });
});
export const notice = (message) => {
  $("notice").textContent = message;
};
const panels = {
  Effects: [
    "Solid color",
    "Title",
    "Adjustment clip",
    "Transitions · Push / Cross dissolve / Smooth cut",
    "Masks · Rectangle / Ellipse / Path",
    "Filters · Exposure / Blur / Shadow",
  ],
  Library: ["Shared library", "Compound clips", "Import / Export OTIO"],
  Presets: [
    "Transform presets",
    "Color presets",
    "Equalizer presets",
    "Compressor presets",
  ],
  History: ["Undo history will appear after connecting to a project."],
};
const workspaceTools = {
  Edit: [],
  Color: [
    "Shadows / Midtones / Highlights / Offset",
    "Auto balance",
    "Waveform / RGB parade / Vectorscope / Histogram",
    "Curves",
  ],
  Audio: [
    "Track / Master mixer",
    "Six-band equalizer",
    "Three-band compressor",
    "Normalization / Mono",
    "Voiceover",
    "Analyze silence · VAD",
  ],
  Review: [
    "Shot / Take grouping",
    "Compare A/B",
    "Replace Take",
    "Prompt / Seed / Model metadata",
  ],
};

function showWorkspace(name) {
  editor.dataset.workspace = name;
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    if (button.tagName === "BUTTON")
      button.setAttribute("aria-pressed", button.dataset.workspace === name);
  });
  const area = $("workspace-tools");
  area.replaceChildren();
  area.hidden = name === "Edit";
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = `${name} tools · Native features awaiting web integration`;
  area.append(note);
  const tools = document.createElement("div");
  tools.className = "tools";
  for (const label of workspaceTools[name]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.disabled = true;
    button.title = "Not implemented in the web host";
    tools.append(button);
  }
  area.append(tools);
  try {
    localStorage.setItem("workspace", name);
  } catch {}
}

document
  .querySelectorAll("button[data-workspace]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      showWorkspace(button.dataset.workspace),
    ),
  );
document.querySelectorAll("[data-panel]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-panel]")
      .forEach((tab) => tab.setAttribute("aria-selected", tab === button));
    const name = button.dataset.panel;
    $("media-list").hidden = name !== "Media";
    $("search").parentElement.hidden = name !== "Media";
    $("panel-content").hidden = name === "Media";
    $("panel-content").replaceChildren();
    if (name === "History") { renderHistory(); return; }
    if (name === "Effects") for (const [label,generator] of [["Add title","title"],["Add adjustment clip","adjustment"]]) {
      const action=document.createElement("button");action.textContent=label;
      action.addEventListener("click",()=>addGenerator(generator));$("panel-content").append(action);
    }
    for (const label of panels[name] || []) {
      const item = document.createElement("p");
      item.textContent = label;
      $("panel-content").append(item);
    }
  }),
);
$("projects-button").addEventListener("click", () => $("projects").showModal());
$("palette-button").addEventListener("click", () => $("palette").showModal());
$("export-button").addEventListener("click", () => {
  $("export-panel").hidden = false;
});
$("close-export").addEventListener("click", () => {
  $("export-panel").hidden = true;
});
$("collapse-inspector").addEventListener("click", () => {
  editor.classList.toggle("inspector-collapsed");
});
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("viewer").requestFullscreen();
  } catch (error) {
    notice(error.message);
  }
});
for (const name of ["Edit", "Color", "Audio", "Review"]) {
  const button = document.createElement("button");
  button.textContent = `${name} workspace`;
  button.addEventListener("click", () => {
    showWorkspace(name);
    $("palette").close();
  });
  $("command-list").append(button);
}
const restoreInspector = document.createElement("button");
restoreInspector.textContent = "Show inspector";
restoreInspector.addEventListener("click", () => {
  editor.classList.remove("inspector-collapsed");
  $("palette").close();
});
$("command-list").append(restoreInspector);
installSplitter($("left-splitter"), editor, "--left", 260);
installSplitter($("right-splitter"), editor, "--right", 280, -1);
installSplitter($("timeline-splitter"), editor, "--bottom", 300, -1);
document.addEventListener("keydown", (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "k" &&
    !isTextTarget(event.target)
  ) {
    event.preventDefault();
    $("palette").showModal();
  }
});
try {
  const name = localStorage.getItem("workspace");
  if (workspaceTools[name]) showWorkspace(name);
} catch {}

for (const [shot, take] of [
  ["01 · Coast", "A"],
  ["01 · Coast", "B"],
  ["02 · Arrival", "A"],
]) {
  const card = document.createElement("button");
  card.className = "media-item";
  card.textContent = `Fixture · Shot ${shot} / Take ${take}`;
  card.addEventListener("click", (event) => {
    if (!event.ctrlKey)
      document
        .querySelectorAll(".media-item")
        .forEach((item) => item.classList.remove("selected"));
    card.classList.toggle("selected");
  });
  $("media-list").append(card);
}
$("media-note").textContent =
  "Demo Shot / Take labels · no media or server attached";

let timeline = null;
const view = {
  origin: 0,
  scale: 100,
  scrollY: 0,
  playhead: 0,
  selection: [],
  snap: true,
  draft: null,
};
let commit = async () => {
  throw new Error("Fixture only · no edit was saved");
};
let seek = () => {};
let viewer = null, viewerMode = "program", sourcePlayer = null, programPlayer = null;
let sourceOpenId = null;
const sourceRanges = new Map();
const mediaAssets = new Map();
function updatePlayAvailability() {
  const still = viewerMode === "source" && documentState?.media.find((m) => m.id === sourceOpenId)?.is_image;
  $("play").disabled = still || (viewerMode === "program" && (!documentState?.capabilities.playback || !timeline?.tracks.some((t) => t.clips.length)));
  $("step-back").disabled = !!still;
  $("step-forward").disabled = !!still;
  $("source-quality").disabled = !!still;
  $("play").title = viewerMode === "source" ? "Play source media" : "Play composed timeline · requires an available render GPU";
}
function viewerModeSet(mode) {
  viewerMode = mode;
  if (mode === "source") programPlayer?.stop();
  $("screen").dataset.viewerMode = mode;
  $("source-view").hidden = mode !== "source";
  $("program-mode").setAttribute("aria-pressed", mode === "program");
  $("source-mode").setAttribute("aria-pressed", mode === "source");
  updatePlayAvailability();
  $("viewer-caption").textContent = mode === "source" ? "Source proxy · independent of timeline edits" : "Exact timeline frame";
  if (mode === "program") { sourcePlayer?.pause(); updateTime(); seek(); }
}
function openSource() {
  const item = documentState?.media.find((m) => m.id === selectedMedia);
  if (!item) return notice("Select a media file first");
  sourceOpenId = item.id;
  const range = sourceRanges.get(item.id) || { source_in:0, source_out:item.is_image ? Math.round(5*item.fps.num/item.fps.den) : item.duration_frames };
  $("source-in").value = range.source_in; $("source-out").value = range.source_out;
  $("source-mark-in").disabled = !!item.is_image; $("source-mark-out").disabled = !!item.is_image;
  viewerModeSet("source");
  sourcePlayer.open(item, documentState.project_epoch, $("source-quality").value);
}
$("source-mode").addEventListener("click", openSource);
$("program-mode").addEventListener("click", () => viewerModeSet("program"));
$("source-quality").addEventListener("change", openSource);
function rememberSourceRange() { if (sourceOpenId) sourceRanges.set(sourceOpenId,{source_in:Number($("source-in").value),source_out:Number($("source-out").value)}); }
for (const id of ["source-in","source-out"]) $(id).addEventListener("input",rememberSourceRange);
for (const [id,out] of [["source-mark-in",false],["source-mark-out",true]]) $(id).addEventListener("click",()=>{
  const item = documentState?.media.find((m)=>m.id===sourceOpenId);
  if (!item || item.is_image) return;
  const frame = Math.floor($("source-video").currentTime*item.fps.num/item.fps.den + 1e-6);
  $(out ? "source-out" : "source-in").value = Math.min(item.duration_frames - (out ? 0 : 1),frame+(out ? 1 : 0)); rememberSourceRange();
});
$("play").addEventListener("click", () => {
  if (viewerMode === "program") { viewer?.invalidate(); programPlayer.toggle().catch((error) => notice(error.message)); }
  else sourcePlayer.toggle().catch((error) => notice(error.message));
});
let inspectorSequence = 0;
function inspectorState(clip) {
  return documentState && timeline && clip ? { project_epoch: documentState.project_epoch, generation: documentState.generation, timeline: timeline.id, revision: timeline.revision, clip, frame: view.playhead } : null;
}
function selected() {
  const inspectorSeq = ++inspectorSequence;
  const clip = timeline?.tracks
    .flatMap((track) => track.clips)
    .find((item) => view.selection.includes(item.id));
  $("inspector-content").replaceChildren();
  const title = document.createElement("strong");
  title.textContent = clip?.name || "No clip selected";
  $("inspector-content").append(title);
  if (clip && documentState && timeline.id !== "fixture") {
    const target = document.createElement("div"); target.textContent = "Reading native properties…";
    $("inspector-content").append(target);
    const state = inspectorState(clip.id), identity = detailIdentity(state);
    const end = Math.max(1, ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start_frame + c.length_frames)));
    const query = new URLSearchParams({ project_epoch: state.project_epoch, if_generation: state.generation, timeline_id: state.timeline, revision: state.revision, frame: Math.min(view.playhead, end - 1) });
    request(`/timelines/${encodeURIComponent(timeline.id)}/clips/${encodeURIComponent(clip.id)}?${query}`).then((detail) => {
      if (inspectorSeq !== inspectorSequence || identity !== detailIdentity(inspectorState(clip.id))) return;
      target.replaceChildren();
      renderProperties(target, detail, { writable: writable && !busy && !unresolved, getFrame: () => view.playhead, commit, reload: selected, notice });
    }).catch((error) => { if (inspectorSeq === inspectorSequence) target.textContent = error.message; });
  }
  if (clip)
    for (const [label, value] of [
      ["Clip ID", clip.id],
      ["Start", clip.start_frame],
      ["Length", clip.length_frames],
      ["Source in", clip.source_in_frames ?? "—"],
      ["Source out", clip.source_out_frames ?? "—"],
    ]) {
      const row = document.createElement("p");
      row.textContent = `${label}: ${value}`;
      $("inspector-content").append(row);
    }
  if (clip && timeline.id !== "fixture") {
    for (const [label, initial, edge] of [
      ["Trim start frame", clip.start_frame, "start"],
      ["Trim end frame", clip.start_frame + clip.length_frames, "end"],
    ]) {
      const form = document.createElement("form");
      const row = document.createElement("label");
      row.className = "field";
      row.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.min = 0;
      input.max = 1_000_000_000;
      input.step = 1;
      input.value = initial;
      input.disabled = !writable;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const frame = Number(input.value);
        if (!Number.isSafeInteger(frame)) {
          notice("Enter an integer frame");
          return;
        }
        commit({ kind: "trim", clip_id: clip.id, edge, frame }).catch((error) =>
          notice(error.message),
        );
      });
      row.append(input);
      const apply = document.createElement("button");
      apply.textContent = `Apply ${label.toLowerCase()}`;
      apply.disabled = !writable;
      form.append(row, apply);
      $("inspector-content").append(form);
    }
  }
  if (timeline?.id !== "fixture" && timeline)
    for (const track of timeline.tracks) {
      const heading = document.createElement("p");
      heading.className = "section-title";
      heading.textContent = `${track.label || track.id} · ${track.kind}`;
      $("inspector-content").append(heading);
      for (const flag of ["muted", "solo", "locked"]) {
        const button = document.createElement("button");
        button.textContent = flag;
        button.setAttribute("aria-pressed", track[flag]);
        button.disabled = !writable;
        button.addEventListener("click", () =>
          commit({
            kind: "set_track",
            track: track.id,
            [flag]: !track[flag],
          }).catch((error) => notice(error.message)),
        );
        $("inspector-content").append(button);
      }
    }
  if (timeline?.id !== "fixture" && timeline && documentState) {
    const fieldset = document.createElement("fieldset"); fieldset.disabled = !writable || busy || !!unresolved; const legend = document.createElement("legend"); legend.textContent = "Selected clips"; fieldset.append(legend);
    for (const [label, operation] of [
      ["Link", {kind:"link_clips",clip_ids:view.selection,unlink:false}],
      ["Unlink", {kind:"link_clips",clip_ids:view.selection,unlink:true}],
      ["Disable", {kind:"set_disabled",clip_ids:view.selection,disabled:true}],
      ["Enable", {kind:"set_disabled",clip_ids:view.selection,disabled:false}],
    ]) {
      const button = document.createElement("button"); button.textContent = label; button.disabled = !view.selection.length;
      button.addEventListener("click",()=>commit(operation).catch((error)=>notice(error.message))); fieldset.append(button);
    }
    const form = document.createElement("form"), label = document.createElement("label"); label.className = "field"; label.textContent = "Slip delta frames";
    const delta = document.createElement("input"); delta.type = "number"; delta.step = 1; delta.value = 1; delta.min = -1_000_000_000; delta.max = 1_000_000_000; label.append(delta);
    const slip = document.createElement("button"); slip.textContent = "Apply linked slip"; slip.disabled = !view.selection.length;
    form.append(label,slip); form.addEventListener("submit",(event)=>{event.preventDefault();commit({kind:"slip",clip_ids:view.selection,delta_frames:Number(delta.value)}).catch((error)=>notice(error.message));}); fieldset.append(form); $("inspector-content").append(fieldset);
    renderMarkers($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,getFrame:()=>view.playhead,commit,notice,seek:(frame)=>{view.playhead=frame;updateTime();seek();selected();}});
  }
}
const canvasTimeline = createTimeline({
  canvas: $("timeline"),
  getTimeline: () => timeline,
  view,
  getAssets: () => mediaAssets,
  onSelect: selected,
  onSeek: (final) => {
    programPlayer?.pauseLocal();
    updateTime();
    if (final) { seek(); if (view.selection.length) selected(); }
  },
  onCommand: (operation) => commit(operation),
  onNotice: notice,
});
function updateTime() {
  if (viewerMode === "source") { canvasTimeline.invalidate(); return; }
  const fps = Math.round(timeline?.fps.num / timeline?.fps.den || 24),
    frame = view.playhead;
  $("timecode").textContent = [
    Math.floor(frame / fps / 3600),
    Math.floor(frame / fps / 60) % 60,
    Math.floor(frame / fps) % 60,
    frame % fps,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  canvasTimeline.invalidate();
}
function installTimeline(next) {
  canvasTimeline.cancel();
  timeline = next;
  updatePlayAvailability();
  view.selection = [];
  selected();
  $("format").textContent = `${next.fps.num}/${next.fps.den} fps`;
  $("clip-list").replaceChildren();
  for (const track of next.tracks)
    for (const clip of track.clips) {
      const button = document.createElement("button");
      button.textContent = `${track.id} · ${clip.name || clip.id}`;
      button.addEventListener("click", () => {
        view.selection = [clip.id];
        selected();
        canvasTimeline.invalidate();
      });
      $("clip-list").append(button);
    }
  updateTime();
}
$("demo-button").addEventListener("click", () => {
  installTimeline(fixtureTimeline());
  $("connection").textContent = "Demo / no server · fixture";
  $("timeline-select").replaceChildren(new Option(timeline.name, timeline.id));
  notice("500 fixture clips · gestures are local drafts, no project writes");
});
$("snap").addEventListener("click", () => {
  view.snap = !view.snap;
  $("snap").setAttribute("aria-pressed", view.snap);
});
for (const [id, factor] of [
  ["zoom-in", 1.4],
  ["zoom-out", 1 / 1.4],
])
  $(id).addEventListener("click", () => {
    view.scale = Math.max(3, Math.min(2000, view.scale * factor));
    canvasTimeline.invalidate();
  });
$("fit").addEventListener("click", () => {
  if (!timeline) return;
  const end = Math.max(
    240,
    ...timeline.tracks.flatMap((t) =>
      t.clips.map((c) => c.start_frame + c.length_frames),
    ),
  );
  view.origin = 0;
  view.scale =
    (($("timeline").clientWidth - 170) * timeline.fps.num) /
    timeline.fps.den /
    end;
  canvasTimeline.invalidate();
});
function step(delta) {
  if (viewerMode === "source") {
    const media = documentState?.media.find((m) => m.id === sourceOpenId);
    const fps = media?.fps;
    sourcePlayer.step(delta, fps ? fps.num / fps.den : 24, media?.duration_frames || 1);
    return;
  }
  view.playhead = Math.max(0, view.playhead + delta);
  updateTime();
  seek();
  if (view.selection.length) selected();
}
$("step-back").addEventListener("click", () => step(-1));
$("step-forward").addEventListener("click", () => step(1));
document.addEventListener("keydown", (event) => {
  if (isTextTarget(event.target)) return;
  if (event.altKey) return;
  if (viewerMode === "source" && ["i","o"].includes(event.key.toLowerCase())) { event.preventDefault(); $(event.key.toLowerCase() === "i" ? "source-mark-in" : "source-mark-out").click(); }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  }
});

let documentState = null,
  writable = false,
  busy = false,
  unresolved = null,
  selectedMedia = null;
const clientId = persistentClientId();
async function refresh() {
  programPlayer?.stop();
  viewer?.invalidate();
  const next = await request("/session");
  if (documentState?.project_epoch !== next.project_epoch) {
    sourcePlayer?.reset();
    sourceOpenId = null; sourceRanges.clear();
    selectedMedia = null;
    for (const asset of mediaAssets.values()) asset.thumbnail?.close();
    mediaAssets.clear();
    viewerModeSet("program");
  }
  const previousId = timeline?.id,
    selection = view.selection;
  documentState = next;
  $("play").disabled = viewerMode === "program" && !next.capabilities.playback;
  $("timeline-select").replaceChildren(
    ...next.timelines.map((t) => new Option(t.name, t.id)),
  );
  const active =
    next.timelines.find((t) => t.id === previousId) || next.timelines[0];
  if (active) {
    $("timeline-select").value = active.id;
    installTimeline(active);
    view.selection = selection.filter((id) =>
      active.tracks.some((t) => t.clips.some((c) => c.id === id)),
    );
    selected();
    canvasTimeline.invalidate();
  } else {
    timeline = null;
    selected();
    canvasTimeline.invalidate();
  }
  $("project-name").textContent = next.project_name || "Untitled project";
  $("save-state").textContent = next.unsaved ? "Unsaved changes" : "Saved";
  $("revision").textContent = active
    ? `Revision ${active.revision.slice(0, 8)}`
    : "No timeline";
  $("connection").textContent = writable
    ? "Connected · writer"
    : "Connected · read only";
  for (const id of [
    "save",
    "undo",
    "redo",
    "split",
    "delete",
    "add-solid",
    "insert-media",
    "import-button",
  ])
    $(id).disabled = !writable || busy || (!active && !["save","undo","redo"].includes(id)) || !!unresolved;
  $("undo").disabled ||= next.history.position === 0;
  $("redo").disabled ||= next.history.position === next.history.labels.length;
  $("demo-button").hidden = true;
  $("media-list").replaceChildren();
  $("media-note").textContent = "Project media · authoritative Rust session";
  for (const item of next.media) {
    const card = document.createElement("button");
    card.className = "media-item";
    card.dataset.mediaId = item.id;
    card.textContent = `${item.name}${item.offline ? " · OFFLINE" : ""}`;
    card.addEventListener("click", () => {
      selectedMedia = item.id;
      document
        .querySelectorAll(".media-item")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      notice("Media selected · use Insert media to place at the playhead");
    });
    card.addEventListener("dblclick", openSource);
    if (mediaAssets.has(item.id)) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = mediaAssets.get(item.id).thumbnailURL;
      card.prepend(image);
    }
    $("media-list").append(card);
  }
  if (document.querySelector('[data-panel="History"]').getAttribute("aria-selected") === "true") renderHistory();
  $("viewer-message").textContent = next.capabilities.preview
    ? "Seek a timeline frame"
    : "Exact preview is not available on this host";
  if (next.capabilities.preview) seek();
}
async function mutate(operation, project = false) {
  if (!writable || busy || unresolved)
    throw new Error("Editing is read only or a command is pending");
  programPlayer?.stop();
  if (!project && (!timeline || timeline.id === "fixture"))
    throw new Error("Open a real project before editing");
  const body = {
    command_id: crypto.randomUUID(),
    client_id: clientId,
    project_epoch: documentState.project_epoch,
    if_generation: documentState.generation,
    if_revision: project ? null : timeline.revision,
    operation,
  };
  busy = true;
  notice("Applying command…");
  try {
    await sendMutation(
      project
        ? "/projects/commands"
        : `/timelines/${encodeURIComponent(timeline.id)}/commands`,
      body,
    );
    notice("Command applied");
  } catch (error) {
    if (error.code === "OUTCOME_UNKNOWN") {
      unresolved = body.command_id;
      writable = false;
    }
    $("connection").textContent =
      error.code === "OUTCOME_UNKNOWN"
        ? "Disconnected · command outcome unknown"
        : "Connected · command rejected";
    throw error;
  } finally {
    busy = false;
    await refresh().catch(() => {
      $("connection").textContent = "Disconnected";
    });
  }
}
commit = (operation) => mutate(operation);
const run = (operation) =>
  mutate(operation,["undo","redo","history_jump"].includes(operation.kind)).catch((error) => notice(error.message));
function renderHistory() {
  const root=$("panel-content");root.replaceChildren();
  if (!documentState) {root.textContent="Open a project to view native history";return;}
  for (const [position,label] of ["Initial state",...documentState.history.labels].entries()) {
    const button=document.createElement("button");button.textContent=`${position} · ${label}`;
    button.setAttribute("aria-pressed",position === documentState.history.position);
    button.disabled=!writable || busy || !!unresolved || position === documentState.history.position;
    button.addEventListener("click",()=>run({kind:"history_jump",position}));root.append(button);
  }
}
function addGenerator(generator) {
  const track=timeline?.tracks.find((t)=>t.kind === "video" && !t.locked);
  if (!track) return notice("Add or unlock a video track first");
  run({kind:"add_generator",generator,track:track.id,start_frame:view.playhead,length_frames:Math.round(5*timeline.fps.num/timeline.fps.den)});
}
function moveSelection(delta) {
  if (!timeline || !view.selection.length) return;
  const ids = linkedSelection(timeline, view.selection),
    moves = [];
  for (const track of timeline.tracks)
    for (const clip of track.clips)
      if (ids.includes(clip.id))
        moves.push({
          clip_id: clip.id,
          to_track: track.id,
          to_start_frame: clip.start_frame + delta,
        });
  run({ kind: "safe_move", moves });
}
for (const [label, audio] of [
  ["Add video track", false],
  ["Add audio track", true],
]) {
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", () => {
    run({ kind: "add_track", audio });
    $("palette").close();
  });
  $("command-list").append(button);
}
const ripple = document.createElement("button");
ripple.textContent = "Ripple delete selected clips";
ripple.addEventListener("click", () => {
  run({ kind: "delete", clip_ids: view.selection, ripple: true });
  $("palette").close();
});
$("command-list").append(ripple);
$("add-solid").addEventListener("click", () => {
  const track = timeline?.tracks.find((t) => t.kind === "video" && !t.locked);
  if (track)
    run({
      kind: "add_solid",
      track: track.id,
      start_frame: view.playhead,
      length_frames: Math.round((5 * timeline.fps.num) / timeline.fps.den),
    });
});
$("split").addEventListener("click", () =>
  run({ kind: "split", clip_ids: view.selection, frame: view.playhead }),
);
$("insert-media").addEventListener("click", () => {
  if (selectedMedia) {
    if (sourceOpenId === selectedMedia) rememberSourceRange();
    const range = sourceRanges.get(selectedMedia);
    let selection = {};
    try { if (range) selection = sourceSelection(range.source_in,range.source_out,documentState.media.find((m)=>m.id===selectedMedia).duration_frames); }
    catch (error) { notice(error.message); return; }
    run({
      kind: "insert_media",
      media_id: selectedMedia,
      start_frame: view.playhead,
      ...selection,
    });
  }
  else notice("Select an imported media first");
});
$("import-button").addEventListener("click", async () => {
  $("imports").showModal();
  $("import-list").replaceChildren();
  $("import-error").textContent = "";
  try {
    const data = await request("/projects");
    for (const item of data.importable_media) {
      const button = document.createElement("button");
      button.textContent = item.name;
      button.addEventListener("click", async () => {
        try {
          await mutate(
            { kind: "import_media", path_token: item.path_token },
            true,
          );
          $("imports").close();
        } catch (error) {
          $("import-error").textContent = error.message;
        }
      });
      $("import-list").append(button);
    }
    if (!data.importable_media.length)
      $("import-error").textContent =
        "No importable media in the configured root.";
  } catch (error) {
    $("import-error").textContent = error.message;
  }
});
$("delete").addEventListener("click", () =>
  run({ kind: "delete", clip_ids: view.selection, ripple: false }),
);
$("undo").addEventListener("click", () => run({ kind: "undo" }));
$("redo").addEventListener("click", () => run({ kind: "redo" }));
$("save").addEventListener("click", () =>
  mutate({ kind: "save" }, true).catch((error) => notice(error.message)),
);
$("timeline-select").addEventListener("change", () => {
  const next = documentState?.timelines.find(
    (t) => t.id === $("timeline-select").value,
  );
  if (next) installTimeline(next);
});
async function projects() {
  try {
    const data = await request("/projects");
    $("project-list").replaceChildren();
    for (const item of data.projects) {
      const button = document.createElement("button");
      button.textContent = item.name;
      button.addEventListener("click", async () => {
        try {
          await mutate(
            { kind: "open_project", path_token: item.path_token },
            true,
          );
          $("projects").close();
        } catch (error) {
          $("project-error").textContent = error.message;
        }
      });
      $("project-list").append(button);
    }
    if (!data.projects.length) {
      const p = document.createElement("p");
      p.textContent = "No projects yet. Create your first timeline below.";
      $("project-list").append(p);
    }
  } catch (error) {
    $("project-error").textContent = error.message;
  }
}
$("projects-button").addEventListener("click", projects);
$("new-project").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await mutate(
      { kind: "new_project", name: new FormData(event.target).get("name") },
      true,
    );
    $("projects").close();
  } catch (error) {
    $("project-error").textContent = error.message;
  }
});
async function connect() {
  try {
    if (unresolved) {
      try {
        await request(`/commands/${encodeURIComponent(unresolved)}`);
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
      }
      unresolved = null;
    }
    await request("/lease", { client_id: clientId });
    writable = true;
    await refresh();
    notice("Connected to native Venturi session");
  } catch (error) {
    writable = false;
    await refresh().catch(() => {
      $("connection").textContent = "Demo / no server";
    });
    notice(error.message);
  }
}
$("reconnect").addEventListener("click", connect);
setInterval(() => {
  if (writable)
    request("/lease", { client_id: clientId }).catch(() => {
      writable = false;
      $("connection").textContent = "Disconnected · read only";
    });
}, 30_000);
document.addEventListener("keydown", (event) => {
  if (isTextTarget(event.target)) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (
    event.altKey &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    event.preventDefault();
    moveSelection(
      (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1),
    );
  } else if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    $("save").click();
  } else if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    $(event.shiftKey ? "redo" : "undo").click();
  } else if (event.key.toLowerCase() === "t" && !modifier) $("split").click();
  else if (event.key === "Delete") $("delete").click();
});
viewer = createViewer({
  image: $("preview"),
  empty: $("viewer-empty"),
  status: $("preview-state"),
  getState: () =>
    documentState?.capabilities.preview && timeline
      ? {
          project_epoch: documentState.project_epoch,
          if_generation: documentState.generation,
          timeline_id: timeline.id,
          revision: timeline.revision,
          frame: view.playhead,
          width: 960,
        }
      : null,
});
seek = () => { if (viewerMode === "program") { programPlayer?.stop(); return viewer.seek(); } };
programPlayer = createProgramPlayer({
  video: $("program-video"), status: $("program-status"), cancel: $("program-cancel"),
  getState: () => {
    if (!documentState?.capabilities.playback || !timeline || viewerMode !== "program") return null;
    const end = Math.max(0, ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start_frame + c.length_frames)));
    const start = Math.min(view.playhead, Math.max(0, end - 1));
    return end ? { project_epoch: documentState.project_epoch, if_generation: documentState.generation, timeline_id: timeline.id, revision: timeline.revision, start_frame: start, end_frame: Math.min(end, start + Math.floor(300 * timeline.fps.num / timeline.fps.den)), width: 960 } : null;
  },
  onFrame: (frame) => { if (viewerMode === "program") { view.playhead = frame; updateTime(); } },
  onState: (state) => { const active = state !== "stopped" && viewerMode === "program"; $("program-view").hidden = !active; $("screen").dataset.programPlayback = String(active); if (viewerMode === "program") $("play").textContent = state === "preparing" ? "Cancel preparation" : state === "failed" ? "Retry playback" : "▶ Play"; },
  onError: notice,
});
sourcePlayer = createSourcePlayer({
  video: $("source-video"), image: $("source-image"), status: $("source-status"), cancel: $("source-cancel"),
  onReady: async ({ item, epoch, job }) => {
    const urls = (name) => sourceAssetURL(item.id, job, name, epoch);
    const [thumb, wave] = await Promise.allSettled([
      fetch(urls("thumb.png")).then((r) => { if (!r.ok) throw new Error("No thumbnail"); return r.blob(); }).then(createImageBitmap),
      item.has_audio === false ? Promise.resolve(null) : fetch(urls("waveform.json")).then((r) => { if (!r.ok) throw new Error("No waveform"); return r.json(); }),
    ]);
    if (documentState?.project_epoch !== epoch) { if (thumb.status === "fulfilled") thumb.value.close(); return; }
    const thumbnail = thumb.status === "fulfilled" ? thumb.value : null;
    const waveform = wave.status === "fulfilled" ? wave.value : null;
    const bytes = (thumbnail ? thumbnail.width * thumbnail.height * 4 : 0) + (waveform?.peaks.length || 0) * 8;
    if (bytes > 16 * 1024 * 1024) { thumbnail?.close(); return; }
    mediaAssets.get(item.id)?.thumbnail?.close();
    mediaAssets.delete(item.id);
    mediaAssets.set(item.id, { thumbnail, waveform, bytes, fps: item.fps, thumbnailURL: urls("thumb.png") });
    if (thumbnail) for (const card of document.querySelectorAll(".media-item")) {
      if (card.dataset.mediaId !== item.id) continue;
      card.querySelector("img")?.remove();
      const image = document.createElement("img"); image.alt = ""; image.src = urls("thumb.png"); card.prepend(image);
    }
    while (mediaAssets.size > 16 || [...mediaAssets.values()].reduce((n, a) => n + a.bytes, 0) > 32 * 1024 * 1024) {
      const oldest = mediaAssets.keys().next().value;
      mediaAssets.get(oldest).thumbnail?.close(); mediaAssets.delete(oldest);
    }
    canvasTimeline.invalidate();
  },
});
$("source-video").addEventListener("timeupdate", () => {
  if (viewerMode !== "source") return;
  const rate = documentState?.media.find((m) => m.id === sourceOpenId)?.fps;
  const fps = rate ? rate.num / rate.den : 24;
  const frames = Math.floor($("source-video").currentTime * fps);
  const seconds = Math.floor(frames / fps);
  $("timecode").textContent = `Source ${[Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frames % Math.round(fps)].map((n) => String(n).padStart(2, "0")).join(":")}`;
});
for (const event of ["play", "pause", "ended"]) $("source-video").addEventListener(event, () => {
  $("play").textContent = $("source-video").paused ? "▶ Play" : "❚❚ Pause";
});
for (const event of ["play", "pause", "ended"]) $("program-video").addEventListener(event, () => {
  if (viewerMode === "program") $("play").textContent = $("program-video").paused ? "▶ Play" : "❚❚ Pause";
});
async function diagnostics() {
  try {
    const d = await request("/diagnostics");
    $("gpu-status").textContent = d.preview.available
      ? `${d.preview.name} · Vulkan`
      : "GPU preview unavailable";
  } catch {}
}
connect().then(diagnostics);
