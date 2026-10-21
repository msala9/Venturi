import { isTextTarget, installSplitter } from "./ui.js";
import { createTimeline, fixtureTimeline } from "./timeline/index.js";
import { linkedSelection, playheadSelection } from "./timeline/geometry.js";
import { request, sendMutation, ApiFailure, persistentClientId } from "./api.js";
import { createViewer } from "./viewer.js";
import { createSourcePlayer, sourceAssetURL, sourceSelection, sourceFrameAtTime } from "./source.js";
import { createProgramPlayer } from "./program.js";
import { detailIdentity, renderProperties, renderMarkers } from "./inspector.js";
import { renderMixer } from "./mixer.js";
import { createExportPanel } from "./export.js";
import { createScopes, scopeTarget } from "./scopes.js";
import { balanceSelected } from "./balance.js";
import { renderCatalog } from "./catalog.js";
import { createSlipView } from "./slip.js";
import { createSilencePanel } from "./silence.js";
import { createLibraryPanel } from "./library.js";
import { createVoiceover } from "./voiceover.js";
import { createReview } from "./review.js";
import { createReviewMetadata } from "./reviewmeta.js";
import { createPasteAttributes } from "./attributes.js";
import { createRecoveryPanel } from "./recovery.js";
import { createAudioScrub, bindSourceScrub } from "./audition.js";
import { createFastTransport } from "./fast-transport.js";
import { createPreviewCache } from "./preview-cache.js";
import { createAudioMeters } from "./audio-meters.js";

const $ = (id) => document.getElementById(id);
const editor = $("editor");
let scopes = null, scopePlayback = false, previewCache = null, audioMeters = null;
let slipScopesState = null;
let catalog = null;
let silencePanel = null;
let sharedLibrary = null;
let voiceover = null;
let review = null;
let reviewMetadata = null;
let pasteAttributes = null;
let recoveryPanel = null;
let audioScrub = null;
let fastTransport = null;
let selectionFollowsPlayhead=true;
try {selectionFollowsPlayhead=localStorage.getItem("venturi-selection-follows-playhead")!=="false";} catch {}
function updateInspectorToggle(){$("show-inspector").setAttribute("aria-expanded",String(innerWidth<=950?editor.classList.contains("inspector-drawer-open"):!editor.classList.contains("inspector-collapsed")));}
function revealInspector(){editor.classList.remove("inspector-collapsed");if(innerWidth<=950)editor.classList.add("inspector-drawer-open");updateInspectorToggle();}
$("search").addEventListener("input", () => {
  const query = $("search").value.toLowerCase();
  if(catalog){catalog.search(query);return;}
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
  Presets: ["Choose a color preset for the selected clip, or an audio preset for a mixer insert."],
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
    "VU / spectrum",
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
  scopes?.setVisible(name === "Color" && !scopePlayback && $("screen").dataset.viewerMode !== "source" && $("slip-view").hidden);
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    if (button.tagName === "BUTTON")
      button.setAttribute("aria-pressed", button.dataset.workspace === name);
  });
  const area = $("workspace-tools");
  area.replaceChildren();
  area.hidden = name === "Edit" || $("screen").dataset.viewerMode === "source" || !!scopePlayback;
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = `${name} tools`;
  area.append(note);
  const tools = document.createElement("div");
  tools.className = "tools";
  for (const label of workspaceTools[name]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.disabled = !((name === "Audio" && ["Track / Master mixer","VU / spectrum","Six-band equalizer","Three-band compressor","Normalization / Mono","Analyze silence · VAD","Voiceover"].includes(label)) || (name === "Color" && ["Shadows / Midtones / Highlights / Offset","Waveform / RGB parade / Vectorscope / Histogram","Auto balance","Curves"].includes(label)) || name === "Review");
    if (!button.disabled) button.addEventListener("click",()=>{
      if(name==="Review"){programPlayer?.stop();sourcePlayer?.pause();const panel=["Shot / Take grouping","Prompt / Seed / Model metadata"].includes(label)?reviewMetadata:review;panel?.open().catch(error=>notice(error.message));return;}
      if(label === "Analyze silence · VAD"){programPlayer?.stop();silencePanel?.open();return;}
      if(label === "Voiceover"){viewerModeSet("program");voiceover?.open();return;}
      if(label === "VU / spectrum"){audioMeters?.open();return;}
      if(name === "Color") {
        if (label === "Auto balance") {
          if (!writable || busy || unresolved) return notice("A connected writer is required");
          button.disabled=true;notice("Analyzing the native isolated clip frame…");
          balanceSelected({getTarget:()=>viewerMode === "program" && !scopePlayback ? scopeTarget(documentState,timeline,view.selection,view.playhead) : null,api:request,commit})
            .then((changed)=>notice(changed ? "Native Auto Balance applied · one Undo step" : "No native balance correction needed"))
            .catch((error)=>notice(error.message)).finally(()=>{button.disabled=false;});return;
        }
        if (label === "Waveform / RGB parade / Vectorscope / Histogram") { scopes?.setVisible($("scopes").hidden); return; }
        if (label === "Curves") {
          const curves=document.querySelector('[data-visual-path="curves"]');if(!curves)return notice("Select a native clip first");
          revealInspector();curves.open=true;curves.scrollIntoView({block:"start"});return;
        }
        const filters=document.querySelector('[data-visual-path="filters"]');if(!filters)return notice("Select a native video clip first");
        revealInspector();filters.open=true;filters.scrollIntoView({block:"start"});return;
      }
      if (!mixerDetail) return notice("Open a native timeline first");
      revealInspector();mixerDetail.open=true;mixerDetail.scrollIntoView({block:"start"});
    });
    button.title = button.disabled ? "Unavailable" : label === "Auto balance" ? "Analyze the selected clip and apply native auto balance" : `Open ${label}`;
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
    if (name === "Library") {sharedLibrary?.open();return;}
    if (name === "History") { renderHistory(); return; }
    if (name === "Presets") for (const [label,mode] of [["Open native color presets","Color"],["Open native audio presets","Audio"]]) {
      const action=document.createElement("button");action.textContent=label;action.addEventListener("click",()=>{
        showWorkspace(mode);revealInspector();
        if(mode==="Color") {const section=document.querySelector('[data-visual-path="filters"]');if(!section)return notice("Select a native video clip first");section.open=true;section.scrollIntoView({block:"start"});}
        else {if(!mixerDetail)return notice("Open a native timeline first");mixerDetail.open=true;mixerDetail.scrollIntoView({block:"start"});}
      });$("panel-content").append(action);
    }
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
  exportPanel.open();
});
$("close-export").addEventListener("click", () => {
  $("export-panel").hidden = true;
});
$("collapse-inspector").addEventListener("click", () => {
  editor.classList.remove("inspector-drawer-open");
  if(innerWidth>950)editor.classList.toggle("inspector-collapsed");
  updateInspectorToggle();$("show-inspector").focus();
});
$("show-inspector").addEventListener("click",()=>{revealInspector();$("collapse-inspector").focus();});
window.addEventListener("resize",updateInspectorToggle);updateInspectorToggle();
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
  revealInspector();
  $("palette").close();
  $("collapse-inspector").focus();
});
$("command-list").append(restoreInspector);
const meterCommand=document.createElement("button");meterCommand.textContent="Audio meters / spectrum";meterCommand.addEventListener("click",()=>{$("palette").close();audioMeters?.open();});$("command-list").append(meterCommand);
const followSelection=document.createElement("button");followSelection.textContent="Selection follows playhead";followSelection.setAttribute("aria-pressed",String(selectionFollowsPlayhead));
followSelection.addEventListener("click",()=>{selectionFollowsPlayhead=!selectionFollowsPlayhead;followSelection.setAttribute("aria-pressed",String(selectionFollowsPlayhead));try{localStorage.setItem("venturi-selection-follows-playhead",String(selectionFollowsPlayhead));}catch{}syncPlayheadSelection(true);notice(selectionFollowsPlayhead?"Selection follows playhead enabled":"Selection follows playhead disabled");});$("command-list").append(followSelection);
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
let viewer = null, viewerMode = "program", sourcePlayer = null, programPlayer = null, slipView = null;
let sourceOpenId = null;
const sourceRanges = new Map();
const mediaAssets = new Map();
const mediaState = {selected: [], anchor: null, folder: "*", kind: "all", open: false};
function updatePlayAvailability() {
  const armed=timeline?.tracks.some((track)=>track.kind==="audio" && track.armed && !track.locked);
  const sourceMedia=viewerMode==="source"?documentState?.media.find(m=>m.id===sourceOpenId):null;
  const still=sourceMedia?.is_image;
  const format=sourceMedia?.fps || timeline?.fps;
  $("format").textContent=still?"Still image":format?`${format.num}/${format.den} fps${sourceMedia?" · Source":""}`:"—";
  $("play").disabled = still || (viewerMode === "program" && (!documentState?.capabilities.playback || !timeline?.tracks.some((t) => t.clips.length)));
  if(viewerMode==="program" && armed){$("play").disabled=!writable;$("play").textContent="Record armed audio";}
  $("step-back").disabled = !!still;
  $("step-forward").disabled = !!still;
  $("source-quality").disabled = !!still;
  $("play").title = viewerMode === "source" ? "Play source media" : `Play composed timeline · native ${documentState?.capabilities.software_preview ? "CPU" : "GPU"} compositor`;
}
function viewerModeSet(mode) {
  audioMeters?.invalidate();
  fastTransport?.stop();
  audioScrub?.stop();
  viewerMode = mode;
  $("workspace-tools").hidden = mode === "source" || editor.dataset.workspace === "Edit";
  scopes?.setVisible(mode === "program" && editor.dataset.workspace === "Color" && $("slip-view").hidden);
  scopes?.refresh();
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
  if (item.compound_timeline_id) {
    const next=documentState.timelines.find((t)=>t.id===item.compound_timeline_id);
    if (next) {view.playhead=0;$("timeline-select").value=next.id;installTimeline(next);viewerModeSet("program");}
    return;
  }
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
  const frame = sourceFrameAtTime($("source-video").currentTime,item.fps.num/item.fps.den);
  $(out ? "source-out" : "source-in").value = Math.min(item.duration_frames - (out ? 0 : 1),frame+(out ? 1 : 0)); rememberSourceRange();
});
function togglePlayback() {
  audioScrub?.stop();
  if(fastTransport?.cancelPreparation())return;
  if(viewerMode==="program" && timeline?.tracks.some((track)=>track.kind==="audio" && track.armed && !track.locked)){voiceover?.open();return;}
  if (viewerMode === "program") { viewer?.invalidate(); programPlayer.toggle().catch((error) => notice(error.message)); }
  else sourcePlayer.toggle().catch((error) => notice(error.message));
}
$("play").addEventListener("click", togglePlayback);
let inspectorSequence = 0;
let mixerDetail = null;
const mixerPaths = new Set();
const visualState = new Map();
let visualControls=[];
function inspectorState(clip) {
  return documentState && timeline && clip ? { project_epoch: documentState.project_epoch, generation: documentState.generation, timeline: timeline.id, revision: timeline.revision, clip, frame: view.playhead,key_page:visualState.get(`key-page:${documentState.project_epoch}:${timeline.id}:${clip}`) || 0 } : null;
}
function selected() {
  recoveryPanel?.invalidate();
  pasteAttributes?.invalidate();
  reviewMetadata?.invalidate();
  review?.invalidate();
  voiceover?.invalidate();
  silencePanel?.invalidate();
  scopes?.refresh();
  const inspectorSeq = ++inspectorSequence;
  for(const node of document.querySelectorAll("#inspector-content details[data-visual-path]"))visualState.set(node.dataset.visualPath,node.open);
  for(const control of visualControls)control.cancel();visualControls=[];
  const mixerOpen = mixerDetail?.open || false;
  for (const node of mixerDetail?.querySelectorAll("details[data-mixer-path]") || []) {
    if (node.open) mixerPaths.add(node.dataset.mixerPath); else mixerPaths.delete(node.dataset.mixerPath);
  }
  mixerDetail=null;
  const clip = timeline?.tracks
    .flatMap((track) => track.clips)
    .find((item) => view.selection.includes(item.id));
  $("inspector-content").replaceChildren();
  const title = document.createElement("strong");
  title.textContent = clip?.name || "No clip selected";
  $("inspector-content").append(title);
  const origin=documentState?.media.find((item)=>item.id===clip?.media_id)?.shared_origin;
  if(origin){
    const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Shared asset provenance";section.append(summary);
    for(const [label,value] of [["Library item",origin.item.id],["Model",origin.item.model],["Seed",origin.item.seed || "Unknown"],["Prompt",origin.item.prompt || "Unknown"],["SHA-256",origin.sha256]]){
      const row=document.createElement("p");row.textContent=`${label}: ${value}`;row.style.overflowWrap="anywhere";section.append(row);
    }
    $("inspector-content").append(section);
  }
  if (clip && documentState && timeline.id !== "fixture") {
    const target = document.createElement("div"); target.textContent = "Reading native properties…";
    $("inspector-content").append(target);
    const state = inspectorState(clip.id), identity = detailIdentity(state);
    const end = Math.max(1, ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start_frame + c.length_frames)));
    const query = new URLSearchParams({ project_epoch: state.project_epoch, if_generation: state.generation, timeline_id: state.timeline, revision: state.revision, frame: Math.min(view.playhead, end - 1) });
    function setKeyPage(page){
      visualState.set(`key-page:${state.project_epoch}:${state.timeline}:${clip.id}`,page);
      visualState.set("key-page-focus",`${state.project_epoch}:${state.timeline}:${clip.id}`);
      const keys=[...visualState.keys()].filter(key=>key.startsWith("key-page:"));for(const key of keys.slice(0,Math.max(0,keys.length-32)))visualState.delete(key);
      selected();
    }
    request(`/timelines/${encodeURIComponent(timeline.id)}/clips/${encodeURIComponent(clip.id)}/keys/${state.key_page}?${query}`).then((detail) => {
      if (inspectorSeq !== inspectorSequence || identity !== detailIdentity(inspectorState(clip.id))) return;
      target.replaceChildren();
      visualControls=renderProperties(target, detail, { writable: writable && !busy && !unresolved, getFrame: () => view.playhead, commit, reload: selected, notice, visualState, scope:`${state.project_epoch}:${state.timeline}:${clip.id}`,setKeyPage });
    }).catch((error) => { if (inspectorSeq === inspectorSequence) {if(state.key_page && error.message.includes("beyond the last native key page"))setKeyPage(0);else target.textContent = error.message;} });
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
      for (const flag of ["muted", "solo", "locked", ...(track.kind === "audio" ? ["armed"] : [])]) {
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
      const remove=document.createElement("button");
      remove.textContent=`Remove ${track.label} (${track.clips.length} clips)`;
      remove.disabled=!writable || busy || !!unresolved || track.locked || timeline.tracks.filter((item)=>item.kind===track.kind).length<=1;
      remove.addEventListener("click",()=>commit({kind:"remove_track",track:track.id}).catch((error)=>notice(error.message)));
      $("inspector-content").append(remove);
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
    const previewSlip=document.createElement("button");previewSlip.type="button";previewSlip.textContent="Preview slip edges";previewSlip.disabled=!view.selection.length;previewSlip.addEventListener("click",()=>{const selected=timeline.tracks.flatMap((track)=>track.clips.map((clip)=>({track,clip}))).find(({track,clip})=>view.selection.includes(clip.id) && track.kind==="video")?.clip || clip;if(selected)slipView?.open(selected.id,Number(delta.value));});fieldset.append(previewSlip);
    const compound=document.createElement("form"),compoundLabel=document.createElement("label");compoundLabel.className="field";compoundLabel.textContent="Compound name";
    const name=document.createElement("input");name.value="Compound";name.required=true;name.maxLength=128;compoundLabel.append(name);
    const make=document.createElement("button");make.textContent="Make compound from selection";make.disabled=!view.selection.length;compound.append(compoundLabel,make);
    compound.addEventListener("submit",async(event)=>{event.preventDefault();try{await commit({kind:"make_compound",clip_ids:view.selection,name:name.value});view.selection=[];selected();canvasTimeline.invalidate();}catch(error){notice(error.message);}});fieldset.append(compound);
    const clipboardNote=document.createElement("p");clipboardNote.className="muted";clipboardNote.textContent=`Clip clipboard: ${documentState.clipboard_count || 0} · current project, matching FPS`;fieldset.append(clipboardNote);
    for(const [label,operation,disabled] of [["Copy clips",()=>({kind:"copy_clips",clip_ids:view.selection}),!view.selection.length],["Paste clips safely",()=>({kind:"paste_clips",frame:view.playhead}),!documentState.clipboard_count]]) {
      const button=document.createElement("button");button.textContent=label;button.disabled=disabled;button.addEventListener("click",()=>commit(operation()).catch((error)=>notice(error.message)));fieldset.append(button);
    }
    const properties=document.createElement("button");properties.textContent="Paste selected properties";properties.disabled=!view.selection.length || !documentState.clipboard_revision || !writable || busy || !!unresolved;properties.addEventListener("click",()=>pasteAttributes?.open());fieldset.append(properties);
    const markerTarget=`${documentState.project_epoch}:${timeline.id}`;
    renderMarkers($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,getFrame:()=>view.playhead,commit,notice,selectedId:view.markerTarget===markerTarget?view.markerId:null,onSelect:id=>{view.markerTarget=markerTarget;view.markerId=id;},openState:visualState,seek:(frame)=>{view.playhead=frame;syncPlayheadSelection(false);updateTime();seek();selected();}});
    const mixQuery = new URLSearchParams({project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0});
    mixerDetail=renderMixer($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,commit,notice,open:mixerOpen,catalog:documentState.audio_effects,openPaths:mixerPaths,query:mixQuery,onMeters:()=>audioMeters?.open()});
  }
}
function syncPlayheadSelection(render) {
  if(!selectionFollowsPlayhead || viewerMode!=="program" || !timeline || view.draft || view.lasso)return;
  const next=playheadSelection(timeline,view.playhead);
  if(next.length===view.selection.length && next.every(id=>view.selection.includes(id)))return;
  view.selection=next;
  if(render)selected();
}
const canvasTimeline = createTimeline({
  canvas: $("timeline"),
  getTimeline: () => timeline,
  view,
  getAssets: () => mediaAssets,
  getCache: () => previewCache?.ranges(),
  onSelect: selected,
  onSeek: (final) => {
    audioMeters?.invalidate();
    audioScrub?.stop();
    programPlayer?.pauseLocal();
    scopes?.invalidate("STALE · scrubbing");
    syncPlayheadSelection(false);
    updateTime();
    if (final) { seek(); selected(); audioScrub?.request(); }
  },
  onCommand: (operation) => commit(operation),
  onNotice: notice,
  canEdit: () => writable && !busy && !unresolved,
  onMarkerEdit: id => { revealInspector();view.markerTarget=`${documentState?.project_epoch}:${timeline.id}`;view.markerId=id;visualState.set("markers",true);selected();document.querySelector('[data-visual-path="markers"] select')?.focus(); },
  onSlip: (event)=>{if(event.phase==="begin"){programPlayer?.stop();sourcePlayer?.pause();}slipView?.draft(event);},
});
window.addEventListener("blur",()=>{for(const control of visualControls)control.cancel();});
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
  audioMeters?.invalidate();
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
$("edit-tool").addEventListener("change",()=>{canvasTimeline.cancel();view.tool=$("edit-tool").value;slipView?.reset();notice(view.tool === "slip" ? "Slip tool · drag right to advance source; linked clips follow" : "Move / trim tool");});
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
    audioScrub?.request();
    return;
  }
  view.playhead = Math.max(0, view.playhead + delta);
  syncPlayheadSelection(false);
  updateTime();
  seek();
  selected();
  audioScrub?.request();
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
  fastTransport?.stop();
  audioScrub?.stop();
  slipView?.reset();
  programPlayer?.stop();
  viewer?.invalidate();
  const next = await request("/session");
  const sourceChanged=(id)=>documentState?.media.find((item)=>item.id===id)?.content_hash !== next.media.find((item)=>item.id===id)?.content_hash;
  for(const [id,asset] of mediaAssets)if(sourceChanged(id)){asset.thumbnail?.close();mediaAssets.delete(id);}
  if(sourceOpenId && (!next.media.some((item)=>item.id===sourceOpenId) || sourceChanged(sourceOpenId))){sourcePlayer?.reset();sourceRanges.delete(sourceOpenId);sourceOpenId=null;}
  if (documentState?.project_epoch !== next.project_epoch) {
    sourcePlayer?.reset();
    sourceOpenId = null; sourceRanges.clear();
    view.playhead=0;view.origin=0;view.scrollY=0;view.selection=[];
    selectedMedia = null;
    mediaState.selected=[];mediaState.anchor=null;mediaState.folder="*";
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
  $("project-persistence-notice").textContent=next.persistence_notice || "";
  recoveryPanel?.update(next.autosave);
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
  $("media-note").textContent = "Project media · authoritative Rust session";
  catalog=renderCatalog($("media-list"),next,mediaState,{writable:writable && !busy && !unresolved,assets:mediaAssets,commit:(operation)=>mutate(operation,true),getFiles:async()=> (await request("/projects")).importable_media,onSelection:(id)=>{selectedMedia=id;},onOpen:(id)=>{selectedMedia=id;openSource();},notice});
  if (document.querySelector('[data-panel="History"]').getAttribute("aria-selected") === "true") renderHistory();
  $("viewer-message").textContent = next.capabilities.preview
    ? "Seek a timeline frame"
    : "Exact preview is not available on this host";
  updatePlayAvailability();
  if (next.capabilities.preview) seek();
}
function commandNotice(receipt) {
  return receipt.server_restarted
    ? "Command applied before the server restarted. Check project recovery before continuing."
    : receipt.receipt_persisted === false || receipt.durability?.state === "volatile"
      ? "Command applied. Save current edits before restarting the server."
      : "Command applied";
}
async function mutate(operation, project = false) {
  fastTransport?.stop();
  audioScrub?.stop();
  if (!writable || busy || unresolved)
    throw new Error("Editing is read only or a command is pending");
  programPlayer?.stop();
  slipView?.reset();
  if (!project && (!timeline || timeline.id === "fixture"))
    throw new Error("Open a real project before editing");
  const body = {
    command_id: crypto.randomUUID(),
    client_id: clientId,
    command_epoch: documentState.command_epoch,
    project_epoch: documentState.project_epoch,
    if_generation: documentState.generation,
    if_revision: project ? null : timeline.revision,
    operation,
  };
  busy = true;
  notice("Applying command…");
  try {
    const receipt = await sendMutation(
      project
        ? "/projects/commands"
        : `/timelines/${encodeURIComponent(timeline.id)}/commands`,
      body,
    );
    notice(commandNotice(receipt));
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
const timelineButton=document.createElement("button");timelineButton.textContent="New timeline";
timelineButton.addEventListener("click",()=>{$("palette").close();$("timeline-error").textContent="";$("new-timeline-dialog").showModal();});$("command-list").append(timelineButton);
let timelineAction="rename_timeline";
for(const [label,kind] of [["Rename timeline","rename_timeline"],["Duplicate timeline","duplicate_timeline"]]) {
    const button=document.createElement("button");button.textContent=label;button.addEventListener("click",()=>{
      if(!timeline || timeline.id==="fixture")return notice("Open a native timeline first");
      timelineAction=kind;$("palette").close();$("timeline-action-error").textContent="";$("timeline-action-title").textContent=label;$("timeline-action").elements.name.value=`${timeline.name}${kind==="duplicate_timeline" ? " copy" : ""}`.slice(0,128);$("timeline-action-dialog").showModal();
    });$("command-list").append(button);
}
$("timeline-action").addEventListener("submit",async(event)=>{
    event.preventDefault();const before=new Set(documentState?.timelines.map((t)=>t.id));
    try {
      await mutate({kind:timelineAction,name:event.target.elements.name.value});
      if(timelineAction==="duplicate_timeline") {const next=documentState.timelines.find((t)=>!before.has(t.id));if(next){$("timeline-select").value=next.id;view.playhead=0;installTimeline(next);seek();}}
      $("timeline-action-dialog").close();
    }catch(error){$("timeline-action-error").textContent=error.message;}
});
$("new-timeline").addEventListener("submit",async(event)=>{
  event.preventDefault();const data=new FormData(event.target),before=new Set(documentState?.timelines.map((t)=>t.id));
  try {
    await mutate({kind:"new_timeline",name:data.get("name"),fps:{num:Number(data.get("fps_num")),den:Number(data.get("fps_den"))},resolution:[Number(data.get("width")),Number(data.get("height"))]},true);
    const next=documentState.timelines.find((t)=>!before.has(t.id));
    if(next){$("timeline-select").value=next.id;view.playhead=0;installTimeline(next);seek();}
    $("new-timeline-dialog").close();
  }catch(error){$("timeline-error").textContent=error.message;}
});
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
  mutate({ kind: "save" }, true).catch(async(error) => {
    notice(error.message);
    if(error.code==="SAVE_CONFLICT") {
      await projects();
      $("projects").showModal();
      $("project-error").textContent=`${error.message}. Your edits remain in memory. Save a copy under a new name before reopening the external version.`;
      const input=$("save-as-project").elements.name;
      input.value=`${(documentState?.project_name || "Project").replace(/\.vvproj$/i,"").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,59)}_copy`;
      input.focus();
    }
  }),
);
$("timeline-select").addEventListener("change", () => {
  const next = documentState?.timelines.find(
    (t) => t.id === $("timeline-select").value,
  );
  if (next) {programPlayer?.stop();viewer?.invalidate();view.playhead=0;installTimeline(next);seek();}
});
async function projects() {
  recoveryPanel?.refresh();
  try {
    const data = await request("/projects");
    $("project-list").replaceChildren();
    const backups=$("recover-project").elements.path_token,previousBackup=backups.value;backups.replaceChildren();
    for(const item of data.backups || [])backups.append(new Option(item.name,item.path_token));
    if([...backups.options].some((option)=>option.value===previousBackup))backups.value=previousBackup;
    $("recover-project").querySelector("button").disabled=!data.backups?.length || !writable;
    const otio=$("import-otio").elements.path_token,previousOtio=otio.value;otio.replaceChildren();
    for(const item of data.importable_otio || [])otio.append(new Option(item.name,item.path_token));
    if([...otio.options].some((option)=>option.value===previousOtio))otio.value=previousOtio;
    $("import-otio").querySelector("button").disabled=!data.importable_otio?.length || !writable;
    const compoundIds=new Set(documentState?.media.filter((media)=>media.compound_timeline_id!==null).map((media)=>media.id));
    const hasCompound=timeline?.tracks.some((track)=>track.clips.some((clip)=>compoundIds.has(clip.media_id)));
    $("otio-availability").textContent=hasCompound ? "Open the child timeline to export OTIO; native compound export is unavailable." : "";
    const download=$("download-otio");download.hidden=hasCompound || !timeline?.tracks.some((track)=>track.clips.length);
    if(!download.hidden)download.href=`/api/v1/timelines/${encodeURIComponent(timeline.id)}/timeline.otio?${new URLSearchParams({project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0,width:960})}`;
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
$("import-otio").addEventListener("submit",async(event)=>{
    event.preventDefault();const data=new FormData(event.target);$("project-error").textContent="";$("otio-warnings").textContent="";
    try {
      await mutate({kind:"import_otio",path_token:data.get("path_token"),name:data.get("name")},true);
      await projects();
      $("otio-warnings").textContent=documentState.import_warnings?.join("\n") || "Native OTIO project imported and saved.";
    }catch(error){$("project-error").textContent=error.message;}
});
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
$("save-as-project").addEventListener("submit",async(event)=>{
  event.preventDefault();
  try {await mutate({kind:"save_as",name:new FormData(event.target).get("name")},true);$("projects").close();}
  catch(error){$("project-error").textContent=error.message;}
});
$("recover-project").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const data=new FormData(event.target);
  try {await mutate({kind:"recover_backup",path_token:data.get("path_token"),name:data.get("name")},true);$("projects").close();notice("Previous saved version recovered into a new project");}
  catch(error){$("project-error").textContent=error.message;}
});
async function connect() {
  try {
    let outcomeNotice = null;
    if (unresolved) {
      try {
        outcomeNotice = commandNotice(await request(`/commands/${encodeURIComponent(unresolved)}`));
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
        outcomeNotice = "Previous command outcome remains unknown. Current state refreshed; check project recovery before continuing.";
      }
      unresolved = null;
    }
    await request("/lease", { client_id: clientId });
    writable = true;
    await refresh();
    notice(outcomeNotice || "Connected to native Venturi session");
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
  } else if (modifier && event.key.toLowerCase() === "c" && view.selection.length) {
    event.preventDefault();run({kind:"copy_clips",clip_ids:view.selection});
  } else if (event.altKey && !modifier && event.key.toLowerCase() === "v") {
    event.preventDefault();pasteAttributes?.open();
  } else if (modifier && event.key.toLowerCase() === "v") {
    event.preventDefault();run({kind:"paste_clips",frame:view.playhead});
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
scopes = createScopes({ panel: $("scopes"), getTarget: () => viewerMode === "program" && !scopePlayback ? scopeTarget(documentState, timeline, view.selection, view.playhead) : null });
scopes.setVisible(editor.dataset.workspace === "Color");
previewCache = createPreviewCache({getState: () => documentState?.capabilities.preview && timeline ? {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0,width:960} : null,status:$("preview-cache-status"),onChange:()=>canvasTimeline.invalidate()});
seek = async () => { if (viewerMode === "program") { programPlayer?.stop(); scopes.invalidate("SEEKING"); await viewer.seek(); scopes.refresh(); previewCache.refresh(); audioMeters?.refresh(); } };
audioScrub=createAudioScrub({enabled:$("audio-scrub"),status:$("audio-scrub-status"),getState:()=>{
  if(!documentState || fastTransport?.active())return null;
  if(viewerMode==="source") {
    const media=documentState.media.find(m=>m.id===sourceOpenId),video=$("source-video");
    return media?.has_audio && video.readyState>=1 ? {project_epoch:documentState.project_epoch,media_id:media.id,frame:Math.min(media.duration_frames-1,sourceFrameAtTime(video.currentTime,media.fps.num/media.fps.den))} : null;
  }
  return timeline ? {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960} : null;
},getURL:query=>query.media_id ? `/api/v1/media/${encodeURIComponent(query.media_id)}/audio.wav?${new URLSearchParams({project_epoch:query.project_epoch,frame:query.frame})}` : `/api/v1/preview/audio.wav?${new URLSearchParams(query)}`});
$("play").addEventListener("click",()=>audioScrub?.stop());
$("program-video").addEventListener("play",()=>audioScrub?.stop());
$("source-video").addEventListener("play",()=>audioScrub?.stop());
bindSourceScrub($("source-video"),audioScrub,()=>viewerMode==="source" && !fastTransport?.active());
programPlayer = createProgramPlayer({
  video: $("program-video"), status: $("program-status"), cancel: $("program-cancel"),
  getState: () => {
    if (!documentState?.capabilities.playback || !timeline || viewerMode !== "program") return null;
    const end = Math.max(0, ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start_frame + c.length_frames)));
    const start = Math.min(view.playhead, Math.max(0, end - 1));
    return end ? { project_epoch: documentState.project_epoch, if_generation: documentState.generation, timeline_id: timeline.id, revision: timeline.revision, start_frame: start, end_frame: Math.min(end, start + Math.floor(300 * timeline.fps.num / timeline.fps.den)), width: 960 } : null;
  },
  onFrame: (frame) => { if (viewerMode === "program") { view.playhead = frame; syncPlayheadSelection(true); updateTime(); } },
  onState: (state) => { const active = state !== "stopped" && viewerMode === "program"; scopePlayback=active; $("workspace-tools").hidden=active || viewerMode==="source" || editor.dataset.workspace==="Edit"; scopes?.setVisible(!active && viewerMode==="program" && editor.dataset.workspace==="Color" && $("slip-view").hidden); if(active)scopes?.invalidate("PAUSED · scopes update on a stopped frame"); else scopes?.refresh(); $("program-view").hidden = !active; $("screen").dataset.programPlayback = String(active); if (viewerMode === "program") $("play").textContent = state === "preparing" ? "Cancel preparation" : state === "failed" ? "Retry playback" : "▶ Play"; },
  onStop:async()=>{await viewer?.seek();scopes?.refresh();previewCache.refresh();},
  onCache:()=>previewCache.refresh(),
  onError: notice,
});
audioMeters=createAudioMeters({root:$("audio-meters-dialog"),onTransport:()=>{if(viewerMode!=="program")viewerModeSet("program");togglePlayback();},getPlayback:()=>({label:viewerMode==="program"?`${$("play").textContent} Program`:"Play Program",status:viewerMode!=="program"?"Source viewer active":programPlayer.state()==="stopped"?"Program stopped":[$("program-status").textContent,$("fast-playback-status").textContent].filter(Boolean).join(" · ")}),isPlaying:()=>viewerMode==="program" && !$("program-video").paused,getTarget:()=>{
  if(!documentState || !timeline || viewerMode!=="program")return null;
  return {query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960},channels:[...timeline.tracks.filter(track=>track.kind==="audio").map(track=>({id:track.id,label:track.label || track.id,effects:track.mix.effects})),{id:"master",label:"Master",effects:timeline.master.effects}]};
}});
fastTransport=createFastTransport({videos:[$("program-video"),$("source-video")],select:$("playback-rate"),status:$("fast-playback-status"),getVideo:()=>$(viewerMode==="program"?"program-video":"source-video"),notice,onState:state=>{$("play").textContent=state==="preparing"?"Cancel fast audio":state==="playing"?"❚❚ Pause":"▶ Play";},getTarget:video=>{
  if(!documentState)return null;
  if(video===$("source-video") && viewerMode==="source") {
    const media=documentState.media.find(item=>item.id===sourceOpenId);
    if(!media || media.is_image || !video.getAttribute("src"))return null;
    return {identity:JSON.stringify([documentState.project_epoch,media.id,video.getAttribute("src")]),audio:media.has_audio,fps:media.fps,origin:0,end:Math.round(media.duration_frames/(media.fps.num/media.fps.den)*48000),url:`/api/v1/media/${encodeURIComponent(media.id)}/audio/window`,query:{project_epoch:documentState.project_epoch}};
  }
  const range=programPlayer?.range();
  if(video!==$("program-video") || viewerMode!=="program" || !range || !video.getAttribute("src"))return null;
  return {identity:JSON.stringify([range.project_epoch,range.if_generation,range.timeline_id,range.revision,video.getAttribute("src")]),fps:range.fps,origin:Math.round(range.start_frame/(range.fps.num/range.fps.den)*48000),end:Math.round(range.end_frame/(range.fps.num/range.fps.den)*48000),url:"/api/v1/preview/audio/window",query:{project_epoch:range.project_epoch,if_generation:range.if_generation,timeline_id:range.timeline_id,revision:range.revision,width:range.width}};
}});
sourcePlayer = createSourcePlayer({
  video: $("source-video"), image: $("source-image"), status: $("source-status"), cancel: $("source-cancel"),
  onReady: async ({ item, epoch, job }) => {
    const urls = (name) => sourceAssetURL(item.id, job, name, epoch);
    const [thumb, wave] = await Promise.allSettled([
      fetch(urls("thumb.png")).then((r) => { if (!r.ok) throw new Error("No thumbnail"); return r.blob(); }).then(createImageBitmap),
      item.has_audio === false ? Promise.resolve(null) : fetch(urls("waveform.json")).then((r) => { if (!r.ok) throw new Error("No waveform"); return r.json(); }),
    ]);
    if (documentState?.project_epoch !== epoch || documentState.media.find((m)=>m.id===item.id)?.content_hash !== item.content_hash) { if (thumb.status === "fulfilled") thumb.value.close(); return; }
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
  const frames = sourceFrameAtTime($("source-video").currentTime, fps);
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
      ? `${d.preview.software ? "CPU · " : ""}${d.preview.name} · Vulkan`
      : "GPU preview unavailable";
  } catch {}
}
const exportPanel = createExportPanel({ form: $("export-form"), status: $("export-status"), cancel: $("export-cancel"), refresh: $("export-refresh"), download: $("export-download"), getState: () => {
  if (!timeline || !documentState) return null;
  const end = Math.max(0, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.start_frame + clip.length_frames)));
  return end ? { project_epoch: documentState.project_epoch, if_generation: documentState.generation, timeline_id: timeline.id, revision: timeline.revision, start_frame: 0, end_frame: end, width: 1920, fps: timeline.fps } : null;
} });
$("export-in").addEventListener("click", () => { $("export-form").elements.start.value = view.playhead; });
$("export-out").addEventListener("click", () => { $("export-form").elements.end.value = view.playhead + 1; });
slipView=createSlipView({root:$("slip-view"),notice,commit:(operation)=>commit(operation),onVisible:(visible)=>{
  if(visible){slipScopesState={workspace:editor.dataset.workspace,visible:!$("scopes").hidden};scopes?.setVisible(false);}
  else if(slipScopesState){scopes?.setVisible(editor.dataset.workspace==="Color" && (slipScopesState.workspace!==editor.dataset.workspace || slipScopesState.visible));slipScopesState=null;}
},getTarget:(clip)=>{
  if(!documentState || !timeline || timeline.id==="fixture" || !writable || busy || unresolved || !view.selection.includes(clip))return null;
  const end=Math.max(1,...timeline.tracks.flatMap((track)=>track.clips.map((item)=>item.start_frame+item.length_frames)));
  return {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:Math.min(view.playhead,end-1),clip_id:clip};
}});
sharedLibrary=createLibraryPanel({root:$("panel-content"),getState:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:(operation)=>mutate(operation,true),notice});
const reviewContext=()=>{
  if(!documentState?.project_name || !timeline || timeline.id==="fixture")return null;
  const clips=timeline.tracks.flatMap(track=>track.clips).filter(clip=>view.selection.includes(clip.id)),oneGroup=clips[0]?.linked_group && clips.every(clip=>clip.linked_group===clips[0].linked_group),clip=(clips.length===1 || oneGroup)?clips.find(clip=>clip.kind==="media"):null;
  const end=Math.max(1,...timeline.tracks.flatMap(track=>track.clips.map(clip=>clip.start_frame+clip.length_frames)));
  return {document:documentState,selectedMedia,clip,query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:Math.max(0,Math.min(view.playhead,end-1)),width:640}};
};
review=createReview({root:$("review-dialog"),canCommit:()=>writable && !busy && !unresolved,commit,notice,getContext:reviewContext});
reviewMetadata=createReviewMetadata({root:$("review-metadata-dialog"),getContext:reviewContext,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),notice,onCompare:media_id=>review.open({media_id}).catch(error=>notice(error.message))});
pasteAttributes=createPasteAttributes({root:$("paste-attributes-dialog"),getContext:()=>documentState && timeline?{epoch:documentState.project_epoch,generation:documentState.generation,timeline:timeline.id,revision:timeline.revision,clipboard:documentState.clipboard_revision,clip_ids:[...view.selection]}:null,canCommit:()=>writable && !busy && !unresolved,commit,notice});
recoveryPanel=createRecoveryPanel({root:$("recovery-panel"),status:$("recovery-status"),button:$("recovery-button"),canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),openProjects:async()=>{$("projects").showModal();await projects();if(!$("recovery-panel").hidden){$("recovery-panel").scrollIntoView({block:"start"});$("recovery-panel").querySelector("input").focus();}},onOpened:()=>$("projects").close(),notice});
setInterval(()=>{if(documentState)recoveryPanel.refresh();},3000);
voiceover=createVoiceover({root:$("voiceover-dialog"),getClientId:()=>clientId,canCommit:()=>writable && !busy && !unresolved,commit,notice,playback:{video:$("program-video"),start:async()=>{fastTransport.normal();await programPlayer.toggle();if(programPlayer.state()!=="ready")throw new Error("Composed playback is unavailable; try recording without playback");},pause:()=>programPlayer.stop()},onProgress:(progress)=>{
  view.recording=progress;if(progress && timeline){view.recording.length_frames=Math.floor(progress.seconds*timeline.fps.num/timeline.fps.den);if(progress.withoutPlayback){view.playhead=Math.min(1_000_000_000,progress.start_frame+view.recording.length_frames);updateTime();}}canvasTimeline.invalidate();
},getTarget:()=>documentState?.project_name && timeline && timeline.id!=="fixture"?{project_epoch:documentState.project_epoch,generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,start_frame:view.playhead,tracks:timeline.tracks.filter((track)=>track.kind==="audio" && track.armed && !track.locked).map((track)=>track.id),formats:documentState.recording_formats,canPlayback:!!documentState.capabilities.playback && timeline.tracks.some((track)=>track.clips.length)}:null});
silencePanel=createSilencePanel({root:$("silence-dialog"),notice,preview:(ranges)=>{view.silencePreview=ranges;canvasTimeline.invalidate();},canCommit:()=>writable && !busy && !unresolved,commit:(operation)=>commit(operation),getTarget:()=>{
  if(!documentState || !timeline || timeline.id==="fixture" || !view.selection.length)return null;
  const end=Math.max(1,...timeline.tracks.flatMap((track)=>track.clips.map((item)=>item.start_frame+item.length_frames)));
  return {query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:Math.min(view.playhead,end-1)},clip_ids:[...view.selection]};
}});
connect().then(diagnostics);
