import { isTextTarget, installSplitter } from "./ui.js";
import { createTimeline, fixtureTimeline } from "./timeline/index.js";
import { linkedSelection, playheadSelection,selectedTransition,selectedGap,nativeGapAt,clipSelectionAnchor,reconcileSelectionAnchor,firstSelectionAnchor,playheadSelectionAnchor } from "./timeline/geometry.js";
import {isRetimeShortcut,timelineSelectionFocus} from './timeline/input.js';
import {createRetimeMenu} from './retime-menu.js';
import {retimeVisibilityState,toggleRetimeVisibility,retimeProjectVisibility} from './retime-visibility.js';
import { request, sendMutation, ApiFailure, persistentClientId } from "./api.js";
import { createViewer } from "./viewer.js";
import {createViewerZoom,isViewerFullscreenShortcut} from './viewer-zoom.js';
import { createSourcePlayer, sourceSelection } from "./source.js";
import { createProgramPlayer } from "./program.js";
import { buildProgramWindow } from "./program-range.js";
import { sourceSampleAtFrame,sourceAudioQuery } from "./source-clock.js";
import { createSourceSeek } from "./source-seek.js";
import { createSourceAssets,createSourceAssetQueue,sourceAssetKey,mediaThumbnail } from "./source-assets.js";
import { detailIdentity, renderProperties, renderMarkers,renderTransitionSelection,videoPropertySelection,audioPropertySelection,renderBlendMatte,renderSelectedVideoProperties,renderSelectedAudioGain } from "./inspector.js";
import {createZoomLink} from './curves.js';
import { renderMixer } from "./mixer.js";
import {canRetainAudioPresetDraft} from './audio-presets.js';
import { createExportPanel } from "./export.js";
import { createScopes, scopeTarget } from "./scopes.js";
import { balanceSelected } from "./balance.js";
import { renderCatalog } from "./catalog.js";
import { createSlipView } from "./slip.js";
import { createSilencePanel } from "./silence.js";
import { createLibraryPanel } from "./library.js";
import {createNativeAssetPanel} from './native-assets.js';
import {createMediaImportPanel} from './media-import.js';
import {createOtioImportPanel} from './otio-import.js';
import {createClipboard,bindClipboardEvents,clipboardBlocked} from './clipboard.js';
import {createClipboardImagePanel,clipboardEventImage} from './clipboard-image.js';
import { createVoiceover } from "./voiceover.js";
import { createReview } from "./review.js";
import { createReviewMetadata } from "./reviewmeta.js";
import { createPasteAttributes } from "./attributes.js";
import { createRecoveryPanel } from "./recovery.js";
import { createAudioScrub, bindSourceScrub } from "./audition.js";
import { createFastTransport } from "./fast-transport.js";
import { createPreviewCache } from "./preview-cache.js";
import { createAudioMeters } from "./audio-meters.js";
import {createPresetPanel} from './presets.js';
import {createPresetShortcuts} from './preset-shortcuts.js';
import {createViewerTransformOverlay} from './viewer-transform-overlay.js';
import {createViewerMaskOverlay} from './viewer-mask-overlay.js';
import {createCompoundNavigation,compoundNavigationAction} from './compound-navigation.js';
import {resolveMarkRange,setMarkIn,setMarkOut,markRangeContext,markRangeAction} from './mark-range.js';

const $ = (id) => document.getElementById(id);
const editor = $("editor");
let scopes = null, scopePlayback = false, previewCache = null, audioMeters = null;
let slipScopesState = null;
let catalog = null;
let silencePanel = null;
let sharedLibrary = null;
let nativeAssets=null,mediaImport=null,otioImport=null,libraryMode='shared';
let clipboard=null,clipboardImages=null,clipboardFocus='timeline',clipboardFocusSequence=0;
const clipboardButtons=[];
let clipboardStatus=null,clipboardRetry=null,clipboardCancel=null,clipboardOverwrite=null;
const sharedLibraryRoot=document.createElement('div'),nativeAssetsRoot=document.createElement('div');
function openLibraryPanel(mode=libraryMode){
  libraryMode=mode;void sharedLibrary?.cancel();nativeAssets?.hide();
  const sources=document.createElement('div');sources.className='tools';sources.setAttribute('role','group');sources.setAttribute('aria-label','Library source');
  sources.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});
  for(const [value,label] of [['shared','Shared media archive'],['native','Native assets']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(value===mode));button.addEventListener('click',()=>openLibraryPanel(value));sources.append(button);
  }
  $('panel-content').replaceChildren(sources,mode==='shared'?sharedLibraryRoot:nativeAssetsRoot);
  if(mode==='shared')void sharedLibrary?.open();else void nativeAssets?.open();
}
let voiceover = null;
let review = null;
let reviewMetadata = null;
let pasteAttributes = null;
let recoveryPanel = null;
let audioScrub = null;
let fastTransport = null;
let presetPanel=null;
let retimeMenu=null;
let compoundNavigation=null;
let exportPanel=null;
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
    presetPanel?.hide();
    void sharedLibrary?.cancel();nativeAssets?.hide();
    $("media-list").hidden = name !== "Media";
    $("search").parentElement.hidden = name !== "Media";
    $("panel-content").hidden = name === "Media";
    $("panel-content").replaceChildren();
    if (name === "Library") {openLibraryPanel();return;}
    if (name === "History") { renderHistory(); return; }
    if (name === "Presets") for (const [label,mode] of [["Open native color presets","Color"],["Open native audio presets","Audio"]]) {
      const action=document.createElement("button");action.textContent=label;action.addEventListener("click",()=>{
        showWorkspace(mode);revealInspector();
        if(mode==="Color") {const section=document.querySelector('[data-visual-path="filters"]');if(!section)return notice("Select a native video clip first");section.open=true;section.scrollIntoView({block:"start"});}
        else {if(!mixerDetail)return notice("Open a native timeline first");mixerDetail.open=true;mixerDetail.scrollIntoView({block:"start"});}
      });$("panel-content").append(action);
    }
    if(name==='Presets'){presetPanel?.open();return;}
    if (name === "Effects") for (const [label,generator] of [["Add title","title"],["Add adjustment clip","adjustment"]]) {
      const action=document.createElement("button");action.textContent=label;
      action.addEventListener("click",()=>addGenerator(generator));$("panel-content").append(action);
    }
    if(name==='Effects'){const transitions=document.createElement('div');transitions.id='transition-presets';$("panel-content").append(transitions);renderTransitionPresets();}
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
  exportPanel.close();
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
document.addEventListener('keydown',event=>{
  if(!isViewerFullscreenShortcut(event,{dialogOpen:Boolean(document.querySelector('dialog[open]'))}))return;
  event.preventDefault();event.stopPropagation();$('fullscreen').click();
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
  videoScroll:0,
  audioScroll:0,
  videoPaneHeight:null,
  rowHeight:62,
  playhead: 0,
  selection: [],
  selectionAnchor:null,
  snap: true,
  retime: false,
  retimeOverwrite: false,
  retimeVisible: new Set(),
  transitionSelection: null,
  selectedGap:null,
  transitionReplace: false,
  draft: null,
};
let commit = async () => {
  throw new Error("Fixture only · no edit was saved");
};
let seek = () => {};
let viewer = null, viewerZoom=null, viewerMode = "program", sourcePlayer = null, programPlayer = null, slipView = null;
let transformOverlay=null,transformDetail=null,maskOverlay=null,maskChoice=null,maskPickerIdentity=null,maskSelectionSequence=0,maskSelectionIdentity=null;
let sourceOpenId = null;
let sourceSeek=null;
let sourceAssets=null,derivativesTransportPending=false;
const sourceRanges = new Map();
let programMarkState=markRangeContext(null,null,null);
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
  maskSelectionSequence++;
  transformOverlay?.cancel();
  maskOverlay?.cancel();
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
  syncProgramMarks();
  updatePlayAvailability();
  $("viewer-caption").textContent = mode === "source" ? "Source proxy · independent of timeline edits" : "Exact timeline frame";
  if (mode === "program") { sourcePlayer?.pause(); sourceAssets?.cancelSource(); updateTime(); seek(); }
  viewerZoom?.refresh();
}
function sourcePosition(allowPreparing=false) {
  const position=sourcePlayer?.current();
  return position && (allowPreparing || !sourcePlayer.preparing()) && position.epoch===documentState?.project_epoch && position.media_id===sourceOpenId ? position : null;
}
function syncSourcePosition() {
  sourceSeek?.sync();
  const valid=Boolean(sourcePosition());
  $("source-mark-in").disabled=!valid;$("source-mark-out").disabled=!valid;
  $("source-assets-refresh").disabled=!valid;
  const position=sourcePosition(true);
  if(viewerMode!=="source" || !position)return;
  const fps=position.fps.num/position.fps.den,seconds=Math.floor(position.frame/fps);
  $("timecode").textContent=`Source ${[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60,position.frame%Math.max(1,Math.round(fps))].map(value=>String(value).padStart(2,"0")).join(":")}`;
}
function openSource() {
  const item = documentState?.media.find((m) => m.id === selectedMedia);
  if (!item) return notice("Select a media file first");
  if (item.compound_timeline_id) {
    const next=documentState.timelines.find((t)=>t.id===item.compound_timeline_id);
    if (next) openTimelineRoot(next);
    return;
  }
  const sameSource=sourceOpenId===item.id;
  const startFrame=sameSource ? sourcePosition(true)?.frame ?? 0 : 0;
  if(sourceOpenId!==item.id)sourceAssets?.cancelSource();
  sourceOpenId = item.id;
  const range = (sameSource?sourceRanges.get(item.id):null) || { source_in:0, source_out:item.is_image ? Math.round(5*item.fps.num/item.fps.den) : item.duration_frames };
  sourceRanges.set(item.id,range);
  $("source-in").value = range.source_in; $("source-out").value = range.source_out;
  $("source-mark-in").disabled = !!item.is_image; $("source-mark-out").disabled = !!item.is_image;
  viewerModeSet("source");
  sourceSeek?.reset(startFrame);
  sourcePlayer.open(item, documentState.project_epoch, $("source-quality").value,startFrame,{audioMode:'all'});
  syncSourcePosition();
}
$("source-mode").addEventListener("click", openSource);
$("program-mode").addEventListener("click", () => viewerModeSet("program"));
$("source-quality").addEventListener("change", openSource);
function rememberSourceRange() { if (sourceOpenId) sourceRanges.set(sourceOpenId,{source_in:Number($("source-in").value),source_out:Number($("source-out").value)}); }
for (const id of ["source-in","source-out"]) $(id).addEventListener("input",rememberSourceRange);
for (const [id,out] of [["source-mark-in",false],["source-mark-out",true]]) $(id).addEventListener("click",()=>{
  const item = documentState?.media.find((m)=>m.id===sourceOpenId);
  if (!item || item.is_image) return;
  const position=sourcePosition();
  if(!position)return notice("Wait for the Source window before setting In or Out");
  const frame = position.frame;
  const marks={mark_in:Number($("source-in").value),mark_out:Number($("source-out").value)};
  try {
    const resolved=resolveMarkRange(out?setMarkOut(marks,frame,item.duration_frames):setMarkIn(marks,frame,item.duration_frames),item.duration_frames);
    $("source-in").value=resolved.start_frame;$("source-out").value=resolved.end_frame;rememberSourceRange();
  } catch(error){notice(error.message);}
});
function programMarkTotal(){return timeline?Math.max(0,...timeline.tracks.flatMap(track=>track.clips.map(clip=>clip.start_frame+clip.length_frames))):0;}
function canProgramMark(){return Boolean(documentState && timeline && timeline.id!=='fixture' && programMarkTotal()>0 && !busy && !unresolved && canvasTimeline.navigationIdle());}
function syncProgramMarks(){
  programMarkState=markRangeContext(programMarkState,documentState?.project_epoch,timeline?.id);
  const range=resolveMarkRange(programMarkState.marks,programMarkTotal()),disabled=!canProgramMark();
  $("program-marks").hidden=viewerMode!=='program';
  for(const id of ['program-mark-in','program-mark-out','export-in','export-out'])$(id).disabled=disabled;
  const label=timeline?.id==='fixture' || !documentState?'Open a native timeline':`Program In ${range.start_frame} · Out ${range.end_frame} (exclusive) · ${range.end_frame-range.start_frame} frames selected for export`;
  if($("program-mark-range").textContent!==label)$("program-mark-range").textContent=label;
  return range;
}
function setProgramMark(out){
  if(!canProgramMark())return;
  programMarkState=markRangeContext(programMarkState,documentState.project_epoch,timeline.id);
  programMarkState.marks=out?setMarkOut(programMarkState.marks,view.playhead,programMarkTotal()):setMarkIn(programMarkState.marks,view.playhead,programMarkTotal());
  syncProgramMarks();exportPanel?.invalidate?.();
}
$("program-mark-in").addEventListener('click',()=>setProgramMark(false));
$("program-mark-out").addEventListener('click',()=>setProgramMark(true));
function togglePlayback() {
  audioScrub?.stop();
  if(fastTransport?.cancelPreparation())return;
  if(viewerMode==="program" && timeline?.tracks.some((track)=>track.kind==="audio" && track.armed && !track.locked)){voiceover?.open();return;}
  derivativesTransportPending=true;sourceAssets?.refresh();
  if (viewerMode === "program") { viewer?.invalidate(); programPlayer.toggle().catch((error) => notice(error.message)).finally(()=>{derivativesTransportPending=false;sourceAssets?.refresh();}); }
  else sourcePlayer.toggle().catch((error) => notice(error.message)).finally(()=>{derivativesTransportPending=false;sourceAssets?.refresh();});
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
function syncSelectionActions(){
  const target=selectedTransition(timeline,view.transitionSelection),disabled=!writable || busy || Boolean(unresolved) || !timeline || timeline.id==='fixture';
  $("split").disabled=disabled || Boolean(target) || !view.selection.length;
  $("delete").disabled=disabled || (target?target.locked:!view.selection.length);
  $("close-gap").disabled=disabled || !canvasTimeline.canCloseGap();
}
function selected() {
  if(view.selection.length || view.transitionSelection)view.selectedGap=null;
  canvasTimeline.checkGapSelection();
  view.selectionAnchor=view.transitionSelection || view.selectedGap?null:reconcileSelectionAnchor(timeline,view.selectionAnchor,documentState?.project_epoch ?? null);
  const activeGap=selectedGap(timeline,view);
  for(const button of $("clip-list").querySelectorAll('button[data-gap-track]'))button.setAttribute('aria-pressed',String(Boolean(activeGap && activeGap.track_id===button.dataset.gapTrack && activeGap.start_frame===Number(button.dataset.gapStart) && activeGap.length_frames===Number(button.dataset.gapLength))));
  for (const button of $("clip-list").querySelectorAll("button[data-clip-id]"))
    button.setAttribute("aria-pressed", String(view.selection.includes(button.dataset.clipId)));
  slipView?.invalidate();
  syncClipboardControls();
  compoundNavigation?.invalidate();
  updateRetimeControls();
  trackViewerSelection();
  transformDetail=null;transformOverlay?.cancel();transformOverlay?.invalidate();
  maskOverlay?.cancel();maskOverlay?.invalidate();syncViewerMasks();
  presetPanel?.invalidate();
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
  const getVideoSelection=()=>videoPropertySelection({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline,selection:view.selection});
  const getAudioSelection=()=>audioPropertySelection({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline,selection:view.selection});
  const videoSelection=getVideoSelection(),audioSelection=getAudioSelection();
  const primaryId=videoSelection?.clip_ids[0] || audioSelection?.clip_ids[0];
  const clip = timeline?.tracks
    .flatMap((track) => track.clips)
    .find((item) => primaryId?item.id===primaryId:view.selection.includes(item.id));
  $("inspector-content").replaceChildren();
  const transition=selectedTransition(timeline,view.transitionSelection);
  syncSelectionActions();
  if(transition){
    view.selection=[];view.selectionAnchor=null;
    const identity=JSON.stringify([documentState?.project_epoch,timeline.id]);
    renderTransitionSelection($("inspector-content"),transition,{disabled:!writable || busy || Boolean(unresolved) || transition.locked,getTarget:()=>selectedTransition(timeline,view.transitionSelection),canInteract:()=>identity===JSON.stringify([documentState?.project_epoch,timeline?.id]) && writable && !busy && !unresolved && !selectedTransition(timeline,view.transitionSelection)?.locked && !document.querySelector('dialog[open]'),commit,notice});return;
  }
  view.transitionSelection=null;
  const title = document.createElement("strong");
  const gap=selectedGap(timeline,view),gapTrack=timeline?.tracks.find(track=>track.id===gap?.track_id);
  title.textContent = gap?`${gapTrack.label || gapTrack.id} gap · ${gap.start_frame}–${gap.start_frame+gap.length_frames} frames`:clip?.name || "No clip selected";
  $("inspector-content").append(title);
  if(gap){const description=document.createElement('p');description.textContent=`${gap.length_frames} empty frames selected. Close selected gap ripples all unlocked tracks and trims overlaps using native ripple delete. Undo restores the edit.`;$("inspector-content").append(description);}
  const origin=documentState?.media.find((item)=>item.id===clip?.media_id)?.shared_origin;
  if(origin){
    const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Shared asset provenance";section.append(summary);
    for(const [label,value] of [["Library item",origin.item.id],["Model",origin.item.model],["Seed",origin.item.seed || "Unknown"],["Prompt",origin.item.prompt || "Unknown"],["SHA-256",origin.sha256]]){
      const row=document.createElement("p");row.textContent=`${label}: ${value}`;row.style.overflowWrap="anywhere";section.append(row);
    }
    $("inspector-content").append(section);
  }
  const inspectorFrame=view.playhead,selectionIdentity=JSON.stringify([...view.selection].sort()),zoomLink=createZoomLink(visualState);
  const inspectorCurrent=()=>inspectorSeq===inspectorSequence && view.playhead===inspectorFrame && JSON.stringify([...view.selection].sort())===selectionIdentity;
  const canEditInspector=()=>inspectorCurrent() && writable && !busy && !unresolved && viewerMode==='program' && programPlayer?.state()==='stopped' && !document.querySelector('dialog[open]');
  const selectionTargets=[];
  for(const [selection,getSelection,video] of [[videoSelection,getVideoSelection,true],[audioSelection,getAudioSelection,false]]){
    if(!selection || timeline.id==='fixture')continue;
    const target=document.createElement('div'),identity=JSON.stringify(selection);target.textContent=video?'Reading selected video properties…':'Reading selected audio gain…';$('inspector-content').append(target);
    const current=()=>inspectorCurrent() && JSON.stringify(getSelection())===identity;
    const render=detail=>{
      if(!current() || detail.clip_id!==selection.clip_ids[0])return;
      target.replaceChildren();
      const primary=timeline.tracks.flatMap(track=>track.clips).find(item=>item.id===detail.clip_id);
      const options={selection,getSelection,frame:inspectorFrame,getFrame:()=>view.playhead,canInteract:()=>current() && canEditInspector(),commit,notice,primaryName:primary?.name,visualState,zoomLink,
        seek:frame=>{maskOverlay?.cancel();view.playhead=frame;updateTime();seek();selected();}};
      if(video){renderSelectedVideoProperties(target,detail,options);renderBlendMatte(target,detail,options);}
      else renderSelectedAudioGain(target,detail,options);
    };
    const entry={id:selection.clip_ids[0],target,current,render};selectionTargets.push(entry);
    if(entry.id!==clip?.id){
      const end=Math.max(1,...timeline.tracks.flatMap(track=>track.clips.map(item=>item.start_frame+item.length_frames)));
      const query=new URLSearchParams({project_epoch:selection.project_epoch,if_generation:selection.generation,timeline_id:selection.timeline_id,revision:selection.revision,frame:Math.min(inspectorFrame,end-1)});
      request(`/timelines/${encodeURIComponent(timeline.id)}/clips/${encodeURIComponent(entry.id)}/keys/0?${query}`).then(render).catch(error=>{if(current())target.textContent=error.message;});
    }
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
      selectionTargets.find(entry=>entry.id===clip.id)?.render(detail);
      transformDetail={identity,detail};transformOverlay?.invalidate();syncViewerMasks();maskOverlay?.invalidate();
      visualControls=renderProperties(target, detail, { writable: writable && !busy && !unresolved, getFrame: () => view.playhead, commit, reload: selected, notice, visualState, scope:`${state.project_epoch}:${state.timeline}:${clip.id}`,setKeyPage,transitionDefaults:timeline.transition_defaults,compositing:false,transformControls:false,gainControls:false,zoomLink,
        seek:frame=>{maskOverlay?.cancel();view.playhead=frame;syncPlayheadSelection(false);updateTime();seek();selected();},
        canInteract:()=>identity===detailIdentity(inspectorState(clip.id)) && canEditInspector() });
    }).catch((error) => { if (inspectorSeq === inspectorSequence) {if(state.key_page && error.message.includes("beyond the last native key page"))setKeyPage(0);else{target.textContent = error.message;const entry=selectionTargets.find(entry=>entry.id===clip.id);if(entry?.current())entry.target.textContent=error.message;}} });
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
    compound.addEventListener("submit",async(event)=>{event.preventDefault();try{await commit({kind:"make_compound",clip_ids:view.selection,name:name.value});view.selection=[];view.selectionAnchor=null;selected();canvasTimeline.invalidate();}catch(error){notice(error.message);}});fieldset.append(compound);
    const clipboardNote=document.createElement("p");clipboardNote.className="muted";clipboardNote.textContent=`Native clipboard: ${documentState.clipboard_count || 0} clips · ${documentState.clipboard_media_count || 0} media · native FPS conversion`;fieldset.append(clipboardNote);
    for(const [label,action,disabled] of [["Copy clips",'copy',!view.selection.length],["Cut clips",'cut',!view.selection.length],["Paste retained clips",'paste',false]]) {
      const button=document.createElement("button");button.type='button';button.dataset.clipboardOwner='timeline';button.textContent=label;if(action==='paste')button.title='Paste the retained Venturi copy; Ctrl+V uses the system clipboard';button.disabled=disabled || !writable || busy || !!unresolved;button.addEventListener("click",()=>clipboardCommand('timeline',action));fieldset.append(button);
    }
    const properties=document.createElement("button");properties.textContent="Paste selected properties";properties.disabled=!view.selection.length || !documentState.clipboard_count || !documentState.clipboard_revision || !writable || busy || !!unresolved;properties.addEventListener("click",()=>pasteAttributes?.open());fieldset.append(properties);
    const markerTarget=`${documentState.project_epoch}:${timeline.id}`;
    renderMarkers($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,getFrame:()=>view.playhead,commit,notice,selectedId:view.markerTarget===markerTarget?view.markerId:null,onSelect:id=>{view.markerTarget=markerTarget;view.markerId=id;},openState:visualState,seek:(frame)=>{view.playhead=frame;syncPlayheadSelection(false);updateTime();seek();selected();}});
    const mixQuery = new URLSearchParams({project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0});
    mixerDetail=renderMixer($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,commit,notice,open:mixerOpen,catalog:documentState.audio_effects,openPaths:mixerPaths,query:mixQuery,onMeters:()=>audioMeters?.open(),audioPresets:{getContext:()=>({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline_id:timeline?.id,timeline_revision:timeline?.revision}),canCommit:()=>writable && !busy && !unresolved && !document.querySelector('dialog[open]'),libraryCommit:operation=>mutate(operation,true,'/audio/presets/commands')}});
  }
}
function syncPlayheadSelection(render) {
  if(!selectionFollowsPlayhead || viewerMode!=="program" || !timeline || view.draft || view.lasso || view.transitionSelection)return;
  const next=playheadSelection(timeline,view.playhead);
  view.selectionAnchor=playheadSelectionAnchor(timeline,view.playhead,documentState?.project_epoch ?? null);
  if(next.length===view.selection.length && next.every(id=>view.selection.includes(id)))return;
  view.selection=next;
  updateRetimeControls();
  if(render)selected();
}
const canvasTimeline = createTimeline({
  canvas: $("timeline"),
  getTimeline: () => timeline,
  getPresetContext:presetContext,
  getGapContext:()=>documentState?{project_epoch:documentState.project_epoch,generation:documentState.generation}:null,
  canNavigate:()=>!busy && !unresolved,
  onOpenCompound:ids=>compoundNavigation?.enter(ids),
  onNavigationIntent:()=>compoundNavigation?.cancel(),
  onNavigationStateChange:()=>{compoundNavigation?.invalidate();syncClipboardControls();syncSelectionActions();sourceAssets?.refresh();queueMicrotask(syncProgramMarks);},
  view,
  getAssets: () => mediaAssets,
  onPaint:(_duration,demand)=>{if(documentState && timeline?.id===demand?.timeline_id && timeline?.revision===demand.revision)sourceAssets?.demand('timeline',assetDemandItems(demand.items),documentState.project_epoch);},
  getCache: () => previewCache?.ranges(),
  onSelect: ()=>{view.transitionSelection=null;selected();},
  onTransitionSelect:selection=>{view.transitionSelection=selection;view.selection=[];view.selectionAnchor=null;view.markerId=null;revealInspector();selected();},
  onRetimeMenu:target=>retimeMenu?.open(target),
  onRetimeVisibilityChange:updateRetimeControls,
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
function retimeContext(target){
  const track=timeline?.tracks.find(track=>track.id===target.track_id),clip=track?.clips.find(clip=>clip.id===target.clip_id);
  if(!clip?.retime || !documentState)return null;
  const linked=timeline.tracks.flatMap(lane=>lane.clips.filter(item=>item.id===clip.id || (clip.linked_group!=null && item.linked_group===clip.linked_group)).map(item=>({track_id:lane.id,locked:lane.locked,clip:item})));
  const rect=$("timeline").getBoundingClientRect();
  return {project_epoch:documentState.project_epoch,generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,track_id:track.id,clip,linked,overwrite:view.retimeOverwrite===true,
    editable:writable && !busy && !unresolved && timeline.id!=='fixture' && view.tool!=='slip' && view.retimeVisible.has(clip.id) && !linked.some(item=>item.locked),
    viewIdentity:JSON.stringify([view.origin,view.scale,view.scrollY,view.videoScroll,view.audioScroll,view.videoPaneHeight,view.rowHeight,view.tool,view.snap,[...view.retimeVisible].sort(),view.selection,view.transitionSelection,rect.left,rect.top,rect.width,rect.height])};
}
retimeMenu=createRetimeMenu({getContext:retimeContext,commit:operation=>commit(operation),notice,
  onHide:target=>{view.retimeVisible.delete(target.clip_id);updateRetimeControls();notice('Speed strip hidden for this clip');},
  onAdvanced:target=>{programPlayer?.stop();fastTransport?.stop();audioScrub?.stop();if(viewerMode!=='program')viewerModeSet('program');view.transitionSelection=null;view.selection=[target.clip_id];view.selectionAnchor=clipSelectionAnchor(timeline,target.clip_id,documentState?.project_epoch ?? null);visualState.set('retime',true);visualState.set('retime-focus',target.clip_id);revealInspector();selected();canvasTimeline.invalidate();notice('Change clip speed · native Ripple is the initial duration policy; linked clips follow');},
});
function renderTransitionPresets(){
  const root=$("transition-presets");if(!root)return;root.replaceChildren();
  const note=document.createElement('p');note.className='muted';note.textContent='Drag a transition near a video clip edge. A touching neighbour creates a crossing. For keyboard editing, select a clip and open Inspector Transitions.';root.append(note);
  const defaults=Array.isArray(timeline?.transition_defaults)?timeline.transition_defaults:[];
  for(const preset of defaults){
    const button=document.createElement('button');button.type='button';button.textContent=`Drag ${preset.kind} · ${preset.duration}f`;button.draggable=true;button.disabled=!writable || busy || Boolean(unresolved);button.title='Drag onto an eligible video edge, or use the Inspector Transitions controls';
    button.addEventListener('dragstart',event=>{if(!event.dataTransfer || !canvasTimeline.transitionDnd?.start(preset.kind)){event.preventDefault();return;}event.dataTransfer.setData(canvasTimeline.transitionDnd.type,preset.kind);event.dataTransfer.effectAllowed='copy';});
    button.addEventListener('dragend',()=>canvasTimeline.transitionDnd?.end());
    button.addEventListener('click',()=>{revealInspector();const section=document.querySelector('[data-visual-path="transitions"]');if(section){section.open=true;section.scrollIntoView({block:'nearest'});}else notice('Select a video clip to create a transition with the Inspector');});root.append(button);
  }
  if(!defaults.length){const pending=document.createElement('p');pending.textContent='Open a native timeline to read transition defaults';root.append(pending);}
}
window.addEventListener("blur",()=>{for(const control of visualControls)control.cancel();});
function updateTime() {
  syncClipboardControls();
  syncProgramMarks();
  trackViewerSelection();
  transformOverlay?.invalidate();
  syncViewerMasks();maskOverlay?.invalidate();
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
function installTimeline(next,{transitionSelection=null}={}) {
  retimeMenu?.close();
  audioMeters?.invalidate();
  canvasTimeline.cancel();
  timeline = next;
  syncProgramMarks();exportPanel?.invalidate?.();
  viewerZoom?.refresh();
  view.transitionSelection=selectedTransition(next,transitionSelection)?transitionSelection:null;
  updatePlayAvailability();
  view.selection = [];
  view.selectionAnchor=null;
  selected();
  $("format").textContent = `${next.fps.num}/${next.fps.den} fps`;
  $("clip-list").replaceChildren();
  const gapEpoch=documentState?.project_epoch,gapGeneration=documentState?.generation;
  for (const track of next.tracks)
    for (const clip of track.clips) {
      const button = document.createElement("button");
      button.textContent = `${track.label || track.id} · ${clip.name || clip.id}`;
      button.dataset.clipId = clip.id;
      button.setAttribute("aria-pressed", "false");
      button.disabled=track.locked;
      button.addEventListener("click", (event) => {
        if(documentState?.project_epoch===gapEpoch && documentState?.generation===gapGeneration && timeline===next)canvasTimeline.selectClip(clip.id,event);
      });
      $("clip-list").append(button);
    }
  for(const gap of next.gaps || []){
    const track=next.tracks.find(item=>item.id===gap.track_id);if(!track || !nativeGapAt(next,gap.track_id,gap.start_frame))continue;
    const button=document.createElement('button');button.type='button';button.textContent=`${track.label || track.id} gap · ${gap.start_frame}–${gap.start_frame+gap.length_frames} frames`;
    button.dataset.gapTrack=gap.track_id;button.dataset.gapStart=gap.start_frame;button.dataset.gapLength=gap.length_frames;button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{if(documentState?.project_epoch===gapEpoch && documentState?.generation===gapGeneration && timeline?.id===next.id && timeline?.revision===next.revision)canvasTimeline.selectGap(gap.track_id,gap.start_frame);});$("clip-list").append(button);
  }
  updateTime();
}
$("demo-button").addEventListener("click", () => {
  compoundNavigation?.reset();
  installTimeline(fixtureTimeline());
  $("connection").textContent = "Demo / no server · fixture";
  $("timeline-select").replaceChildren(new Option(timeline.name, timeline.id));
  notice("500 fixture clips · gestures are local drafts, no project writes");
});
$("snap").addEventListener("click", () => {
  view.snap = !view.snap;
  $("snap").setAttribute("aria-pressed", view.snap);
});
$("transition-replace").addEventListener('change',()=>{canvasTimeline.cancel();view.transitionReplace=$("transition-replace").checked;notice(view.transitionReplace?'Replacing existing transitions is enabled for drops; Undo restores the previous settings':'Transition drops refuse occupied slots');});
function updateRetimeControls(){
  const state=retimeVisibilityState(timeline,view.selection,view.retimeVisible);view.retime=state.any;
  if(!state.any)view.retimeOverwrite=false;
  retimeMenu?.invalidate();$("retime-handles").setAttribute('aria-pressed',String(state.pressed));$("retime-handles").disabled=state.disabled;$("retime-overwrite").disabled=!state.any;$("retime-overwrite").checked=view.retimeOverwrite;canvasTimeline.invalidate();
}
$("retime-handles").addEventListener('click',()=>{
  const state=retimeVisibilityState(timeline,view.selection,view.retimeVisible);
  if(state.disabled)return;
  canvasTimeline.cancel();view.retimeVisible=toggleRetimeVisibility(timeline,view.selection,view.retimeVisible);updateRetimeControls();
  notice(state.pressed?'Speed strips hidden for the selected media clips; other clips keep their controls':'Speed strips shown for the selected media clips · click for presets or press Shift+F10; drag endpoints to resize · overlaps require Overwrite clips');
});
$("retime-handles").addEventListener('keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
$("retime-overwrite").addEventListener('change',()=>{
  canvasTimeline.cancel();view.retimeOverwrite=view.retime && $("retime-overwrite").checked;updateRetimeControls();notice(view.retimeOverwrite?'Overwrite clips enabled · speed edits may replace overlaps; Undo restores them':'Speed resize refuses overlaps');
});
document.addEventListener('keydown',event=>{if(isRetimeShortcut(event,{dialogOpen:Boolean(document.querySelector('dialog[open]'))})){event.preventDefault();event.stopPropagation();$("retime-handles").click();}});
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
    fastTransport?.stop();audioScrub?.stop();
    Promise.resolve(sourcePlayer.step(delta, fps ? fps.num / fps.den : 24, media?.duration_frames || 1)).then(()=>{syncSourcePosition();audioScrub?.request();}).catch(error=>notice(error.message));
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
  const mark=markRangeAction(event,{textTarget:isTextTarget(event.target),dialogOpen:Boolean(document.querySelector('dialog[open]'))});
  if(mark){event.preventDefault();$(viewerMode==='source'?mark==='in'?'source-mark-in':'source-mark-out':mark==='in'?'program-mark-in':'program-mark-out').click();}
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
compoundNavigation=createCompoundNavigation({
  root:$("compound-breadcrumb"),openButton:$("open-compound"),notice,
  getState:()=>({document:documentState,timeline,frame:view.playhead,selection:[...view.selection],viewport:{scale:view.scale,origin:view.origin,scrollY:view.scrollY,videoScroll:view.videoScroll,audioScroll:view.audioScroll,videoPaneHeight:view.videoPaneHeight,rowHeight:view.rowHeight,selection:[...view.selection],selectionAnchor:view.selectionAnchor}}),
  canNavigate:()=>!busy && !unresolved && canvasTimeline.navigationIdle() && !document.querySelector('dialog[open]'),
  stop:()=>{fastTransport?.stop();audioScrub?.stop();programPlayer?.stop();sourcePlayer?.pause();sourceAssets?.cancelSource();slipView?.reset();viewer?.invalidate();},
  install:(next,frame,viewport)=>{
    view.playhead=frame;view.origin=Number.isFinite(viewport?.origin) && viewport.origin>=0?viewport.origin:0;view.scrollY=Number.isFinite(viewport?.scrollY) && viewport.scrollY>=0?viewport.scrollY:0;
    view.videoScroll=Number.isFinite(viewport?.videoScroll) && viewport.videoScroll>=0?viewport.videoScroll:0;view.audioScroll=Number.isFinite(viewport?.audioScroll) && viewport.audioScroll>=0?viewport.audioScroll:0;
    view.videoPaneHeight=Number.isFinite(viewport?.videoPaneHeight) && viewport.videoPaneHeight>=0?viewport.videoPaneHeight:null;view.rowHeight=Number.isFinite(viewport?.rowHeight)?Math.max(40,Math.min(160,viewport.rowHeight)):62;
    if(Number.isFinite(viewport?.scale) && viewport.scale>0)view.scale=viewport.scale;
    installTimeline(next);view.selection=(viewport?.selection || []).filter(id=>next.tracks.some(track=>!track.locked && track.clips.some(clip=>clip.id===id)));view.selectionAnchor=reconcileSelectionAnchor(next,viewport?.selectionAnchor,documentState?.project_epoch ?? null);
    $("timeline-select").value=next.id;$("revision").textContent=`Revision ${next.revision.slice(0,8)}`;viewerModeSet('program');selected();canvasTimeline.invalidate();
  },
});
$("open-compound").addEventListener('click',()=>compoundNavigation.enter());
document.addEventListener('toggle',()=>compoundNavigation.invalidate(),true);
document.addEventListener('keydown',event=>{
  const action=compoundNavigationAction(event,{dialogOpen:Boolean(document.querySelector('dialog[open]')),idle:!busy && !unresolved && canvasTimeline.navigationIdle(),hasAncestors:compoundNavigation.state().ancestors.length>0});
  if(!action)return;
  if(action==='enter' && $("open-compound").disabled)return;
  event.preventDefault();event.stopImmediatePropagation();if(action==='enter')compoundNavigation.enter();else if(action==='exit')compoundNavigation.exit();
},true);
function openTimelineRoot(next){
  compoundNavigation?.reset();programPlayer?.stop();sourcePlayer?.pause();viewer?.invalidate();view.playhead=0;view.origin=0;view.scrollY=0;view.videoScroll=0;view.audioScroll=0;view.videoPaneHeight=null;view.rowHeight=62;$("timeline-select").value=next.id;installTimeline(next);viewerModeSet('program');compoundNavigation?.invalidate();
}
async function refresh({preserveAudioDrafts=false}={}) {
  const invalidateTimeline=()=>{
    compoundNavigation?.cancel();fastTransport?.stop();audioScrub?.stop();
    slipView?.reset();programPlayer?.stop();viewer?.invalidate();
  };
  if(!preserveAudioDrafts)invalidateTimeline();
  const next = await request("/session");
  if(preserveAudioDrafts && writable && !unresolved && canRetainAudioPresetDraft(documentState,next,timeline?.id)) {
    documentState=next;timeline=next.timelines.find(item=>item.id===timeline.id);
    $("project-persistence-notice").textContent=next.persistence_notice || "";
    recoveryPanel?.update(next.autosave);
    $("connection").textContent="Connected · writer";
    mediaImport?.invalidate();otioImport?.invalidate();syncClipboardControls();
    return;
  }
  if(preserveAudioDrafts)invalidateTimeline();
  const sourceChanged=(id)=>documentState?.media.find((item)=>item.id===id)?.content_hash !== next.media.find((item)=>item.id===id)?.content_hash;
  for(const [key,asset] of mediaAssets)if(sourceChanged(asset.mediaId)){releaseMediaAsset(asset);mediaAssets.delete(key);}
  if(sourceOpenId && (!next.media.some((item)=>item.id===sourceOpenId) || sourceChanged(sourceOpenId))){sourcePlayer?.reset();sourceAssets?.cancel();sourceRanges.delete(sourceOpenId);sourceOpenId=null;}
  view.retimeVisible=retimeProjectVisibility(documentState?.project_epoch,next.project_epoch,view.retimeVisible);
  if (documentState?.project_epoch !== next.project_epoch) {
    if(clipboardOverwrite)clipboardOverwrite.checked=false;
    canvasTimeline.cancel();view.retime=false;view.retimeOverwrite=false;view.transitionSelection=null;view.transitionReplace=false;$("transition-replace").checked=false;updateRetimeControls();
    sourcePlayer?.reset();
    sourceAssets?.cancel();
    sourceOpenId = null; sourceRanges.clear();
    view.playhead=0;view.origin=0;view.scrollY=0;view.videoScroll=0;view.audioScroll=0;view.videoPaneHeight=null;view.rowHeight=62;view.selection=[];view.selectionAnchor=null;
    selectedMedia = null;
    mediaState.selected=[];mediaState.anchor=null;mediaState.folder="*";
    for (const asset of mediaAssets.values()) releaseMediaAsset(asset);
    mediaAssets.clear();
    viewerModeSet("program");
  }
  const previousId = timeline?.id,
    selection = view.selection,selectionAnchor=view.selectionAnchor,transitionSelection=view.transitionSelection;
  documentState = next;
  compoundNavigation?.invalidate();
  $("play").disabled = viewerMode === "program" && !next.capabilities.playback;
  $("timeline-select").replaceChildren(
    ...next.timelines.map((t) => new Option(t.name, t.id)),
  );
  const active =
    next.timelines.find((t) => t.id === previousId) || next.timelines[0];
  if (active) {
    if(previousId!==active.id){view.videoScroll=0;view.audioScroll=0;view.videoPaneHeight=null;view.rowHeight=62;}
    $("timeline-select").value = active.id;
    installTimeline(active,{transitionSelection:previousId===active.id?transitionSelection:null});
    view.selection = selection.filter((id) =>
      active.tracks.some((t) => !t.locked && t.clips.some((c) => c.id === id)),
    );
    view.selectionAnchor=reconcileSelectionAnchor(active,selectionAnchor,next.project_epoch);
    selected();
    canvasTimeline.invalidate();
  } else {
    timeline = null;view.selectionAnchor=null;
    syncProgramMarks();exportPanel?.invalidate?.();
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
  renderTransitionPresets();
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
  syncSelectionActions();
  $("demo-button").hidden = true;
  $("media-note").textContent = "Project media · authoritative Rust session";
  catalog?.dispose();
  catalog=renderCatalog($("media-list"),next,mediaState,{writable:writable && !busy && !unresolved,assets:mediaAssets,commit:(operation)=>mutate(operation,true),getFiles:async()=> (await request("/projects")).importable_media,onSelection:(id)=>{selectedMedia=id;nativeAssets?.invalidate();syncClipboardControls();},onOpen:(id)=>{selectedMedia=id;openSource();},onDemand:items=>{if(documentState===next)sourceAssets?.demand('pool',assetDemandItems(items),next.project_epoch);},notice});
  nativeAssets?.invalidate();
  mediaImport?.invalidate();otioImport?.invalidate();syncClipboardControls();
  if (document.querySelector('[data-panel="History"]').getAttribute("aria-selected") === "true") renderHistory();
  $("viewer-message").textContent = next.capabilities.preview
    ? "Seek a timeline frame"
    : "Exact preview is not available on this host";
  updatePlayAvailability();
  viewerZoom?.refresh();
  if (next.capabilities.preview) seek();
}
function commandNotice(receipt) {
  if(receipt.library_durable===true)return receipt.receipt_persisted===false
    ? 'Library changes saved. Command receipt needs recovery; do not repeat the command.'
    : receipt.server_restarted?'Library command applied before the server restarted.':'Native library updated';
  return receipt.server_restarted
    ? "Command applied before the server restarted. Check project recovery before continuing."
    : receipt.receipt_persisted === false || receipt.durability?.state === "volatile"
      ? "Command applied. Save current edits before restarting the server."
      : "Command applied";
}
async function mutate(operation, project = false,route=null) {
  const libraryOnly=operation.kind==='edit_audio_preset_library';
  if(!libraryOnly){fastTransport?.stop();audioScrub?.stop();}
  if (!writable || busy || unresolved)
    throw new Error("Editing is read only or a command is pending");
  if(!libraryOnly){programPlayer?.stop();slipView?.reset();}
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
  compoundNavigation?.invalidate();
  nativeAssets?.invalidate();
  mediaImport?.invalidate();otioImport?.invalidate();syncClipboardControls();
  notice("Applying command…");
  try {
    const receipt = await sendMutation(
      route || (project
        ? "/projects/commands"
        : `/timelines/${encodeURIComponent(timeline.id)}/commands`),
      body,
    );
    notice(commandNotice(receipt));
    return receipt;
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
    await refresh({preserveAudioDrafts:operation.kind==='edit_audio_preset_library'}).catch(() => {
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
      if(timelineAction==="duplicate_timeline") {const next=documentState.timelines.find((t)=>!before.has(t.id));if(next)openTimelineRoot(next);}
      $("timeline-action-dialog").close();
    }catch(error){$("timeline-action-error").textContent=error.message;}
});
$("new-timeline").addEventListener("submit",async(event)=>{
  event.preventDefault();const data=new FormData(event.target),before=new Set(documentState?.timelines.map((t)=>t.id));
  try {
    await mutate({kind:"new_timeline",name:data.get("name"),fps:{num:Number(data.get("fps_num")),den:Number(data.get("fps_den"))},resolution:[Number(data.get("width")),Number(data.get("height"))]},true);
    const next=documentState.timelines.find((t)=>!before.has(t.id));
    if(next)openTimelineRoot(next);
    $("new-timeline-dialog").close();
  }catch(error){$("timeline-error").textContent=error.message;}
});
const ripple = document.createElement("button");
ripple.textContent = "Ripple delete selected clips or gap";
ripple.addEventListener("click", () => {
  $("palette").close();
  void canvasTimeline.rippleDelete();
});
$("command-list").append(ripple);
for(const [label,mode] of [['Select all timeline clips','all'],['Select clips from playhead','from_playhead']]){
  const button=document.createElement('button');button.type='button';button.textContent=label;
  button.addEventListener('click',()=>{$("palette").close();canvasTimeline.selectTimelineClips(mode);});$("command-list").append(button);
}
$("close-gap").addEventListener('click',()=>void canvasTimeline.closeGap());
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
mediaImport=createMediaImportPanel({dialog:$("imports"),root:$("import-list"),status:$("import-error"),getContext:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),onImported:ids=>{
  if(ids.some(id=>!documentState?.media.some(item=>item.id===id)))throw Error('The imported media are not yet visible in the refreshed project');
  mediaState.selected=[...ids];selectedMedia=ids.at(-1) || null;catalog?.search(mediaState.query || '');if(selectedMedia)openSource();
}});
$("import-button").addEventListener("click",()=>void mediaImport.open());
function clipboardContext(){
  if(!documentState)return null;
  const rect=$("timeline").getBoundingClientRect();
  return {project_epoch:documentState.project_epoch,generation:documentState.generation,project_name:documentState.project_name,owner:clipboardFocus,
    timeline_id:timeline?.id!=='fixture'?timeline?.id || null:null,timeline_revision:timeline?.revision || null,frame:view.playhead,
    clip_ids:[...view.selection],media_ids:[...mediaState.selected],clipboard_revision:documentState.clipboard_revision,
    clipboard_count:documentState.clipboard_count || 0,clipboard_media_count:documentState.clipboard_media_count || 0,
    overwrite:clipboardFocus==='timeline' && clipboardOverwrite?.checked===true,
    view_stamp:JSON.stringify([view.origin,view.scale,view.scrollY,view.videoScroll,view.audioScroll,view.videoPaneHeight,view.rowHeight,view.tool,view.transitionSelection,Boolean(view.draft),Boolean(view.lasso),clipboardFocusSequence,rect.left,rect.top,rect.width,rect.height]),
    source_stamp:JSON.stringify([viewerMode,sourceOpenId])};
}
function clipboardWritable(){return writable && !busy && !unresolved && !clipboardImages?.busy() && !document.querySelector('dialog[open]') && canvasTimeline.navigationIdle();}
function clipboardImageWritable(){return writable && !busy && !unresolved && !clipboard?.busy() && ![...document.querySelectorAll('dialog[open]')].some(dialog=>dialog!==clipboardImages?.dialog) && canvasTimeline.navigationIdle();}
function setClipboardFocus(owner){if(owner!==clipboardFocus){clipboardFocus=owner;clipboardFocusSequence++;syncClipboardControls();}}
function syncClipboardControls(){
  if(!clipboard)return;clipboard.invalidate();clipboardImages?.invalidate();const context=clipboardContext(),available=Boolean(context) && clipboardWritable() && !clipboard.busy();
  for(const item of clipboardButtons)item.node.disabled=!available || item.owner==='timeline' && item.action!=='paste_image' && !context?.timeline_id || ['copy','cut'].includes(item.action) && !(item.owner==='pool'?context?.media_ids.length:context?.clip_ids.length);
  if(clipboardRetry){clipboardRetry.hidden=!clipboard.canRetry();clipboardRetry.disabled=!available || !clipboard.canRetry();}
  if(clipboardCancel)clipboardCancel.disabled=!clipboard.busy() || !['preparing','reading'].includes(clipboard.state().phase);
  if(clipboardOverwrite)clipboardOverwrite.disabled=!writable || busy || !!unresolved || clipboard.state().phase==='committing';
}
function clipboardCommand(owner,action){setClipboardFocus(owner);void (action==='paste'?clipboard.paste(null):action==='paste_system'?clipboard.pasteSystem():action==='paste_image'?clipboardImages.pasteSystem():clipboard.copy({cut:action==='cut'})).catch(error=>notice(error.message));}
clipboard=createClipboard({getContext:clipboardContext,canCommit:clipboardWritable,commit:(operation,project)=>mutate(operation,project),onChange:state=>{if(clipboardStatus)clipboardStatus.textContent=state.message;notice(state.message);syncClipboardControls();},onPasted:(receipt,target)=>{
  if(target.to_pool && receipt.media_ids.length){
    setClipboardFocus('pool');
    mediaState.selected=receipt.media_ids.filter(id=>documentState.media.some(item=>item.id===id));mediaState.anchor=mediaState.selected[0] || null;selectedMedia=mediaState.selected.at(-1) || null;
    const folder=$("media-list").querySelector('[aria-label="Media folder"]'),kind=$("media-list").querySelector('[aria-label="Media type"]');if(folder)folder.value='*';if(kind)kind.value='all';$("search").value='';catalog?.search('');
  }else if(!target.to_pool && receipt.clip_ids.length){
    const clips=timeline.tracks.flatMap(track=>track.clips).filter(clip=>receipt.clip_ids.includes(clip.id));view.selection=clips.map(clip=>clip.id);view.selectionAnchor=firstSelectionAnchor(timeline,view.selection,documentState.project_epoch);view.transitionSelection=null;
    if(clips.length)view.playhead=Math.max(...clips.map(clip=>clip.start_frame+clip.length_frames));selected();updateTime();seek();
  }
}});
clipboardImages=createClipboardImagePanel({getContext:clipboardContext,canCommit:clipboardImageWritable,commit:operation=>mutate(operation,true),notice:message=>{notice(message);syncClipboardControls();},onSaveRequired:()=>{$("projects-button").click();$("save-as-project").scrollIntoView({block:'nearest'});$("save-as-project").elements.name.focus();notice('Save As preserves the current project. Paste the image again after saving.');},onImported:ids=>{
  if(ids.some(id=>!documentState.media.some(item=>item.id===id)))throw Error('The pasted image is not yet visible in the refreshed project');
  setClipboardFocus('pool');mediaState.selected=[...ids];mediaState.anchor=ids[0];selectedMedia=ids.at(-1);
  const item=documentState.media.find(media=>media.id===selectedMedia),folder=$("media-list").querySelector('[aria-label="Media folder"]'),kind=$("media-list").querySelector('[aria-label="Media type"]');if(folder)folder.value=item.folder || '*';if(kind)kind.value='all';$("search").value='';catalog?.search('');openSource();
}});
function clipboardButton(parent,label,owner,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.dataset.clipboardOwner=owner;if(action==='paste')node.title='Paste the retained Venturi copy; Ctrl+V uses the system clipboard';node.addEventListener('click',()=>clipboardCommand(owner,action));clipboardButtons.push({node,owner,action});parent.append(node);return node;}
const timelineClipboard=document.createElement('details'),clipboardHeading=document.createElement('summary'),clipboardTools=document.createElement('div');clipboardHeading.textContent='Clipboard';clipboardTools.className='tools';clipboardTools.setAttribute('role','group');clipboardTools.setAttribute('aria-label','Timeline clipboard');timelineClipboard.dataset.clipboardOwner='timeline';timelineClipboard.append(clipboardHeading,clipboardTools);
clipboardButton(clipboardTools,'Copy clips','timeline','copy');clipboardButton(clipboardTools,'Cut clips','timeline','cut');clipboardButton(clipboardTools,'Paste retained clips','timeline','paste');
clipboardButton(clipboardTools,'Paste from system clipboard','timeline','paste_system');
clipboardButton(clipboardTools,'Paste image from system clipboard','timeline','paste_image');
const overwriteLabel=document.createElement('label');clipboardOverwrite=document.createElement('input');clipboardOverwrite.type='checkbox';clipboardOverwrite.dataset.clipboardPasteOption='true';clipboardOverwrite.checked=false;clipboardOverwrite.setAttribute('aria-label','Replace overlapping clips');overwriteLabel.title='Applies to every timeline paste, including Ctrl+V. Undo restores replaced clips.';overwriteLabel.append(clipboardOverwrite,document.createTextNode(' Replace overlapping clips'));clipboardOverwrite.addEventListener('change',syncClipboardControls);clipboardTools.append(overwriteLabel);
clipboardRetry=document.createElement('button');clipboardRetry.type='button';clipboardRetry.textContent='Copy to system clipboard';clipboardRetry.hidden=true;clipboardRetry.addEventListener('click',()=>void clipboard.retrySystem());clipboardTools.append(clipboardRetry);
clipboardCancel=document.createElement('button');clipboardCancel.type='button';clipboardCancel.textContent='Cancel clipboard preparation';clipboardCancel.disabled=true;clipboardCancel.addEventListener('click',()=>clipboard.cancel());clipboardTools.append(clipboardCancel);
clipboardStatus=document.createElement('output');clipboardStatus.setAttribute('aria-label','Clipboard status');clipboardStatus.setAttribute('role','status');clipboardStatus.style.display='block';clipboardStatus.style.height='3em';clipboardStatus.style.overflow='auto';clipboardStatus.textContent=clipboard.state().message;timelineClipboard.append(clipboardStatus);$("timeline-panel").insertBefore(timelineClipboard,$("compound-breadcrumb"));
const poolClipboard=document.createElement('div');poolClipboard.className='tools';poolClipboard.dataset.clipboardOwner='pool';poolClipboard.setAttribute('role','group');poolClipboard.setAttribute('aria-label','Media clipboard');clipboardButton(poolClipboard,'Copy media','pool','copy');clipboardButton(poolClipboard,'Paste media','pool','paste');clipboardButton(poolClipboard,'Paste from system clipboard','pool','paste_system');clipboardButton(poolClipboard,'Paste image from system clipboard','pool','paste_image');$("browser").querySelector('.panel-footer').append(poolClipboard);
for(const type of ['pointerdown','focusin'])document.addEventListener(type,event=>{const target=event.target,explicit=target?.closest?.('[data-clipboard-owner]')?.dataset.clipboardOwner;if(explicit)setClipboardFocus(explicit);else if(target?.closest?.('#media-list'))setClipboardFocus('pool');else if(target?.closest?.('#timeline-panel,#viewer,#inspector'))setClipboardFocus('timeline');},true);
document.addEventListener('toggle',syncClipboardControls,true);
bindClipboardEvents({target:document,getOwner:()=>clipboardFocus,isDialogOpen:()=>Boolean(document.querySelector('dialog[open]')),copy:options=>clipboard.copy(options),paste:text=>clipboard.paste(text),pasteImage:blob=>clipboardImages.paste(blob),imageFromEvent:clipboardEventImage,onError:error=>notice(error.message)});
syncClipboardControls();
otioImport=createOtioImportPanel({root:$("otio-current-import"),isVisible:()=>$("projects").open,getContext:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),notice,onImported:receipt=>{
  const next=documentState?.timelines.find(item=>item.id===receipt.timeline_ids[0]);
  if(!next)throw Error('The imported timeline is not yet visible in the refreshed project');
  mediaState.selected=receipt.media_ids.filter(id=>documentState.media.some(item=>item.id===id));mediaState.anchor=mediaState.selected[0] || null;selectedMedia=mediaState.selected.at(-1) || null;
  const folder=$("media-list").querySelector('[aria-label="Media folder"]'),kind=$("media-list").querySelector('[aria-label="Media type"]');
  if(folder)folder.value=receipt.folder_id || '*';if(kind)kind.value='all';$("search").value='';catalog?.search('');
  openTimelineRoot(next);$("projects").close();
}});
$("projects").addEventListener('close',()=>otioImport.hide());
$("projects").addEventListener('cancel',()=>otioImport.hide());
$("delete").addEventListener("click", () => {
  const target=selectedTransition(timeline,view.transitionSelection);
  if(target){if(!target.locked)run({kind:'set_transition',clip_id:target.clip_id,slot:target.slot,transition:null});return;}
  run({ kind: "delete", clip_ids: view.selection, ripple: false });
});
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
  if (next) openTimelineRoot(next);
});
async function projects() {
  recoveryPanel?.refresh();
  try {
    const data = await request("/projects");
    otioImport?.setFiles(data.importable_otio || []);
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
      nativeAssets?.invalidate();
      mediaImport?.invalidate();otioImport?.invalidate();syncClipboardControls();
      $("connection").textContent = "Disconnected · read only";
    });
}, 30_000);
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || isTextTarget(event.target)) return;
  if(canvasTimeline.handleSelectionKey(event,{timelineFocused:timelineSelectionFocus(event.target)}))return;
  if(canvasTimeline.handleGapKey(event))return;
  const modifier = event.ctrlKey || event.metaKey;
  if (
    event.altKey &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    event.preventDefault();
    moveSelection(
      (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1),
    );
  } else if (event.altKey && !modifier && event.key.toLowerCase() === "v" && !clipboardBlocked(event,{dialogOpen:Boolean(document.querySelector('dialog[open]'))})) {
    event.preventDefault();pasteAttributes?.open();
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
function currentViewerContext(){
  if(!documentState || !timeline || viewerMode!=="program" || !$("program-view").hidden || !$("slip-view").hidden)return null;
  const clips=timeline.tracks.filter(track=>track.kind==="video" && !track.muted).flatMap(track=>track.clips.filter(clip=>view.selection.includes(clip.id)));
  const clip=clips.length===1?clips[0]:null,current=viewer?.current();
  if(!clip || clip.disabled || clip.kind==="adjustment" || view.playhead<clip.start_frame || view.playhead>=clip.start_frame+clip.length_frames || transformDetail?.identity!==detailIdentity(inspectorState(clip.id)))return null;
  return {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,clip_id:clip.id,preview_current:Boolean(current),timeline_size:[timeline.resolution.width,timeline.resolution.height],detail:transformDetail.detail};
}
function currentViewerTransformContext(){
  if(!documentState || !timeline || viewerMode!=='program' || !$('program-view').hidden || !$('slip-view').hidden || programPlayer?.state()!=='stopped' || document.querySelector('dialog[open]'))return null;
  const selection=videoPropertySelection({project_epoch:documentState.project_epoch,generation:documentState.generation,timeline,selection:view.selection});
  if(!selection)return null;
  const clip=timeline.tracks.flatMap(track=>track.clips).find(clip=>clip.id===selection.clip_ids[0]);
  if(!clip || view.playhead<clip.start_frame || view.playhead>=clip.start_frame+clip.length_frames || transformDetail?.identity!==detailIdentity(inspectorState(clip.id)))return null;
  return {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,clip_id:clip.id,clip_ids:[...selection.clip_ids],selection:[...selection.selection],preview_current:Boolean(viewer?.current()),timeline_size:[timeline.resolution.width,timeline.resolution.height],detail:transformDetail.detail};
}
function maskScope(context){return context?`${context.project_epoch}:${context.timeline_id}:${context.clip_id}`:null;}
function trackViewerSelection(){
  const identity=JSON.stringify([documentState?.project_epoch,timeline?.id,view.playhead,[...view.selection].sort()]);
  if(identity!==maskSelectionIdentity){maskSelectionIdentity=identity;maskSelectionSequence++;}
}
function syncViewerMasks(){
  const context=currentViewerContext(),items=context?.detail.masks?.items || [],scope=maskScope(context);
  if(context && maskChoice && (maskChoice.scope!==scope || maskChoice.revision!==context.revision))maskChoice=null;
  const selected=maskChoice && items.some(item=>item.index===maskChoice.index)?maskChoice.index:null;
  const identity=JSON.stringify([scope,context?.revision,selected,items.map(item=>[item.index,item.name,item.shape,item.enabled])]);
  if(identity===maskPickerIdentity)return;maskPickerIdentity=identity;
  $("viewer-mask-select").replaceChildren(new Option('Choose a mask',''),...items.map(item=>new Option(`${item.index+1} · ${item.name?`${item.name} · `:''}${item.shape}${item.enabled?'':' · disabled'}`,String(item.index))));
  $("viewer-mask-select").value=selected===null?'':String(selected);$("viewer-mask-select").disabled=!items.length;
}
transformOverlay=createViewerTransformOverlay({screen:$("screen"),image:$("preview"),toggle:$("viewer-transform"),canCommit:()=>writable && !busy && !unresolved && !document.querySelector('dialog[open]'),commit,notice,getContext:currentViewerTransformContext});
maskOverlay=createViewerMaskOverlay({screen:$("screen"),image:$("preview"),toggle:$("viewer-mask"),penToggle:$("viewer-mask-pen"),getPenContext:currentViewerContext,canCommit:()=>writable && !busy && !unresolved && !document.querySelector('dialog[open]'),notice,getContext:()=>{
  const context=currentViewerContext();if(!context)return null;
  const index=maskChoice?.scope===maskScope(context) && maskChoice.revision===context.revision?maskChoice.index:null;
  return {...context,mask_index:index};
},commit:async operation=>{
  const before=currentViewerContext(),choice=operation.kind==='edit_mask' && operation.edit.action==='add' && before?{scope:maskScope(before),revision:before.revision,index:before.detail.masks.items.length}:maskChoice?{...maskChoice}:null,selectionSequence=maskSelectionSequence,receipt=await commit(operation);
  const clip=timeline?.tracks.flatMap(track=>track.clips).find(clip=>clip.id===operation.clip_id);
  if(choice && before && selectionSequence===maskSelectionSequence && documentState?.project_epoch===before.project_epoch && timeline?.id===before.timeline_id && clip && view.selection.includes(clip.id))maskChoice={...choice,revision:timeline.revision};
  syncViewerMasks();maskOverlay?.invalidate();return receipt;
}});
viewerZoom=createViewerZoom({screen:$('screen'),media:[$('preview'),$('program-video'),$('source-video'),$('source-image')],select:$('viewer-zoom'),status:$('viewer-zoom-status'),
  getActive:()=>{
    if(!$('slip-view').hidden)return null;
    const element=viewerMode==='source'?$('source-image').hidden?$('source-video'):$('source-image'):$('program-view').hidden?$('preview'):$('program-video');
    return !element.hidden && element.getAttribute('src')?element:null;
  },getContext:()=>JSON.stringify([documentState?.project_epoch,timeline?.id,viewerMode,sourceOpenId]),
  onChange:()=>{transformOverlay?.cancel();maskOverlay?.cancel();transformOverlay?.invalidate();maskOverlay?.invalidate();}});
$("viewer-transform").addEventListener('click',()=>{maskSelectionSequence++;if($("viewer-transform").getAttribute('aria-pressed')==='true')maskOverlay.setEnabled(false);});
$("viewer-mask").addEventListener('click',()=>{maskSelectionSequence++;if(maskOverlay.enabled() && $("viewer-transform").getAttribute('aria-pressed')==='true')$("viewer-transform").click();});
$("viewer-mask-pen").addEventListener('click',()=>{maskSelectionSequence++;if(maskOverlay.penActive() && $("viewer-transform").getAttribute('aria-pressed')==='true')$("viewer-transform").click();});
$("viewer-mask-select").addEventListener('change',()=>{
  maskSelectionSequence++;maskOverlay.cancel();const context=currentViewerContext(),value=$("viewer-mask-select").value,index=value===''?null:Number(value);
  maskChoice=context && context.detail.masks.items.some(item=>item.index===index)?{scope:maskScope(context),revision:context.revision,index}:null;
  syncViewerMasks();maskOverlay.invalidate();
});
$("inspector-content").addEventListener('click',event=>{
  const button=event.target.closest?.('[data-viewer-mask-index]'),context=currentViewerContext();
  if(!button || !context || button.dataset.clipId!==context.clip_id)return;
  const index=Number(button.dataset.viewerMaskIndex);if(!context.detail.masks.items.some(item=>item.index===index))return;
  maskSelectionSequence++;maskOverlay.cancel();maskChoice={scope:maskScope(context),revision:context.revision,index};syncViewerMasks();
  if(!maskOverlay.enabled())$("viewer-mask").click();maskOverlay.invalidate();$("viewer-mask-select").focus();
});
scopes = createScopes({ panel: $("scopes"), getTarget: () => viewerMode === "program" && !scopePlayback ? scopeTarget(documentState, timeline, view.selection, view.playhead) : null });
scopes.setVisible(editor.dataset.workspace === "Color");
previewCache = createPreviewCache({getState: () => documentState?.capabilities.preview && timeline ? {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0,width:960} : null,status:$("preview-cache-status"),onChange:()=>canvasTimeline.invalidate()});
seek = async () => { if (viewerMode === "program") { programPlayer?.stop(); scopes.invalidate("SEEKING"); await viewer.seek(); scopes.refresh(); previewCache.refresh(); audioMeters?.refresh(); } };
audioScrub=createAudioScrub({enabled:$("audio-scrub"),status:$("audio-scrub-status"),getState:()=>{
  if(!documentState || fastTransport?.active())return null;
  if(viewerMode==="source") {
    const media=documentState.media.find(m=>m.id===sourceOpenId),position=sourcePosition();
    return media?.has_audio && position ? {project_epoch:documentState.project_epoch,media_id:media.id,frame:position.frame,...sourceAudioQuery(position)} : null;
  }
  return timeline ? {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960} : null;
},getURL:query=>query.media_id ? `/api/v1/media/${encodeURIComponent(query.media_id)}/audio.wav?${new URLSearchParams({project_epoch:query.project_epoch,frame:query.frame,audio_mode:query.audio_mode,audio_stream_index:query.audio_stream_index})}` : `/api/v1/preview/audio.wav?${new URLSearchParams(query)}`});
$("play").addEventListener("click",()=>audioScrub?.stop());
$("program-video").addEventListener("play",()=>audioScrub?.stop());
$("source-video").addEventListener("play",()=>audioScrub?.stop());
programPlayer = createProgramPlayer({
  video: $("program-video"), status: $("program-status"), cancel: $("program-cancel"),
  getState: (startFrame,audioOrigin) => {
    if (!documentState?.capabilities.playback || !timeline || viewerMode !== "program") return null;
    return buildProgramWindow(documentState,timeline,view.playhead,startFrame,audioOrigin);
  },
  beforeWindowChange: async () => {
    if(fastTransport && !await fastTransport.finishWindow($("program-video")))throw new Error("Fast audio did not finish its preview window · press Play to retry");
  },
  isInternalSeek: () => Boolean(fastTransport?.correcting($("program-video"))),
  isInternalPause: event => Boolean(fastTransport?.pausing($("program-video"),event)),
  onFrame: (frame) => { if (viewerMode === "program") { view.playhead = frame; syncPlayheadSelection(true); updateTime(); } },
  onState: (state) => { const active = state !== "stopped" && viewerMode === "program"; scopePlayback=active; $("workspace-tools").hidden=active || viewerMode==="source" || editor.dataset.workspace==="Edit"; scopes?.setVisible(!active && viewerMode==="program" && editor.dataset.workspace==="Color" && $("slip-view").hidden); if(active)scopes?.invalidate("PAUSED · scopes update on a stopped frame"); else scopes?.refresh(); $("program-view").hidden = !active; transformOverlay?.invalidate(); syncViewerMasks(); maskOverlay?.invalidate(); $("screen").dataset.programPlayback = String(active); if (viewerMode === "program") $("play").textContent = state === "preparing" ? "Cancel preparation" : state === "failed" ? "Retry playback" : "▶ Play"; sourceAssets?.refresh();viewerZoom?.refresh(); },
  onStop:async()=>{await viewer?.seek();scopes?.refresh();previewCache.refresh();},
  onCache:()=>previewCache.refresh(),
  onError: notice,
});
audioMeters=createAudioMeters({root:$("audio-meters-dialog"),onTransport:()=>{if(viewerMode!=="program")viewerModeSet("program");togglePlayback();},getPlayback:()=>({label:viewerMode==="program"?`${$("play").textContent} Program`:"Play Program",status:viewerMode!=="program"?"Source viewer active":programPlayer.state()==="stopped"?"Program stopped":[$("program-status").textContent,$("fast-playback-status").textContent].filter(Boolean).join(" · ")}),isPlaying:()=>viewerMode==="program" && !$("program-video").paused,getTarget:()=>{
  if(!documentState || !timeline || viewerMode!=="program")return null;
  return {query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960},channels:[...timeline.tracks.filter(track=>track.kind==="audio").map(track=>({id:track.id,label:track.label || track.id,effects:track.mix.effects})),{id:"master",label:"Master",effects:timeline.master.effects}]};
}});
fastTransport=createFastTransport({videos:[$("program-video"),$("source-video")],select:$("playback-rate"),status:$("fast-playback-status"),getVideo:()=>$(viewerMode==="program"?"program-video":"source-video"),notice,onState:state=>{$("play").textContent=state==="preparing"?"Cancel fast audio":state==="playing"?"❚❚ Pause":"▶ Play";sourceAssets?.refresh();},getTarget:video=>{
  if(!documentState)return null;
  if(video===$("source-video") && viewerMode==="source") {
    const media=documentState.media.find(item=>item.id===sourceOpenId);
    const position=sourcePosition(true);
    if(!media || media.is_image || !position || !video.getAttribute("src"))return null;
    return {identity:JSON.stringify([documentState.project_epoch,media.id,video.getAttribute("src"),position.source_version,position.audio_mode,position.audio_stream_index]),audio:media.has_audio,fps:position.fps,origin:sourceSampleAtFrame(position.start_frame,position.fps),end:sourceSampleAtFrame(position.end_frame,position.fps),url:`/api/v1/media/${encodeURIComponent(media.id)}/audio/window`,query:{project_epoch:documentState.project_epoch,...sourceAudioQuery(position)}};
  }
  const range=programPlayer?.range();
  if(video!==$("program-video") || viewerMode!=="program" || !range || !video.getAttribute("src"))return null;
  return {identity:JSON.stringify([range.project_epoch,range.if_generation,range.timeline_id,range.revision,video.getAttribute("src")]),fps:range.fps,origin:Math.round(range.start_frame/(range.fps.num/range.fps.den)*48000),end:Math.round(range.end_frame/(range.fps.num/range.fps.den)*48000),url:"/api/v1/preview/audio/window",query:{project_epoch:range.project_epoch,if_generation:range.if_generation,timeline_id:range.timeline_id,revision:range.revision,width:range.width}};
}});
sourcePlayer = createSourcePlayer({
  video: $("source-video"), image: $("source-image"), status: $("source-status"), cancel: $("source-cancel"),
  windowed:true,
  beforeWindowChange: async () => {
    if(fastTransport && !await fastTransport.finishWindow($("source-video")))throw new Error("Fast audio did not finish its Source window · press Play to retry");
  },
  isInternalSeek: () => Boolean(fastTransport?.correcting($("source-video"))),
  isInternalPause: event => Boolean(fastTransport?.pausing($("source-video"),event)),
  onStateChange:()=>{sourceAssets?.refresh();viewerZoom?.refresh();},
  onReady: ({ item, epoch, source_window }) => {
    syncSourcePosition();
    const sourceVersion=source_window?.source_version,changed=sourceVersion && [...mediaAssets.values()].some(asset=>asset.mediaId===item.id && asset.sourceVersion!==sourceVersion);
    if(changed)removeMediaAssets(item.id);
    void sourceAssets?.load(item,epoch,{sourceVersion,audioStreamIndex:source_window?.audio_stream_index ?? 0,includeWaveform:Boolean(item.has_audio),force:Boolean(changed)});
  },
});
function assetDemandItems(items){
  const media=new Map(documentState?.media.map(item=>[item.id,item]));
  return items.flatMap(entry=>{const item=media.get(entry.media_id);return item?[{item,audioStreamIndex:entry.audio_stream_index,includeWaveform:entry.include_waveform}]:[];});
}
function updateMediaThumbnail(id){
  const asset=mediaThumbnail(mediaAssets,id);
  for(const card of document.querySelectorAll('.media-item'))if(card.dataset.mediaId===id){
    card.querySelector('img')?.remove();
    if(asset?.thumbnailURL){const image=document.createElement('img');image.alt='';image.src=asset.thumbnailURL;card.prepend(image);}
  }
}
function releaseMediaAsset(asset) {
  asset?.thumbnail?.close();
  if(asset?.thumbnailURL?.startsWith("blob:"))URL.revokeObjectURL(asset.thumbnailURL);
}
function removeMediaAssets(id){
  for(const [key,asset] of mediaAssets)if(asset.mediaId===id){releaseMediaAsset(asset);mediaAssets.delete(key);}
  updateMediaThumbnail(id);canvasTimeline.invalidate();
}
function installMediaAsset({item,epoch,thumbnail,waveform,waveformBytes=0,bytes,thumbnailURL,sourceVersion,audioStreamIndex=0}) {
  if(documentState?.project_epoch!==epoch || documentState.media.find(media=>media.id===item.id)?.content_hash!==item.content_hash || !Number.isSafeInteger(bytes) || bytes<0 || bytes>16*1024*1024)return false;
  const key=sourceAssetKey(item.id,audioStreamIndex),previous=mediaAssets.get(key),retainedWave=previous?.sourceVersion===sourceVersion && !waveform?previous:null;
  const total=bytes+(retainedWave?.waveformBytes || 0);if(total>16*1024*1024)return false;
  if([...mediaAssets.values()].some(asset=>asset.mediaId===item.id && asset.sourceVersion!==sourceVersion))removeMediaAssets(item.id);
  if(mediaAssets.get(key)===previous)releaseMediaAsset(previous);mediaAssets.delete(key);
  mediaAssets.set(key,{mediaId:item.id,contentHash:item.content_hash,audioStreamIndex,thumbnail,waveform:waveform || retainedWave?.waveform || null,waveformBytes:waveform?waveformBytes:retainedWave?.waveformBytes || 0,bytes:total,thumbnailURL,sourceVersion,fps:item.fps});
  updateMediaThumbnail(item.id);
  while(mediaAssets.size>64 || [...mediaAssets.values()].reduce((total,asset)=>total+asset.bytes,0)>64*1024*1024){
    const oldest=mediaAssets.keys().next().value,asset=mediaAssets.get(oldest);releaseMediaAsset(asset);mediaAssets.delete(oldest);updateMediaThumbnail(asset.mediaId);
  }
  canvasTimeline.invalidate();return true;
}
sourceAssets=createSourceAssetQueue({loader:createSourceAssets({getState:()=>documentState,onReady:installMediaAsset,onStatus:message=>{$("source-assets-status").textContent=message;},onError:error=>notice(error.message || String(error))}),getState:()=>documentState,
  isIdle:()=>Boolean(documentState && !document.hidden && !busy && !unresolved && !derivativesTransportPending && !document.querySelector('dialog[open]') && canvasTimeline.navigationIdle() && programPlayer?.state()!=='preparing' && !sourcePlayer?.preparing() && $('source-video').paused && $('program-video').paused && $('export-preview-video').paused && !fastTransport?.active()),
  hasAsset:entry=>{const asset=mediaAssets.get(sourceAssetKey(entry.item.id,entry.audioStreamIndex)),thumbnail=mediaThumbnail(mediaAssets,entry.item.id);return Boolean((!entry.item.has_video || thumbnail?.contentHash===entry.item.content_hash && (!entry.sourceVersion || thumbnail.sourceVersion===entry.sourceVersion)) && (!entry.item.has_audio || !entry.includeWaveform || asset?.contentHash===entry.item.content_hash && asset.waveform && (!entry.sourceVersion || asset.sourceVersion===entry.sourceVersion)));}});
for(const event of ['play','pause','ended'])$('export-preview-video').addEventListener(event,()=>sourceAssets.refresh());
document.addEventListener('visibilitychange',()=>sourceAssets.refresh());document.addEventListener('toggle',()=>sourceAssets.refresh(),true);
$("source-assets-refresh").addEventListener("click",()=>{
  const position=sourcePosition(),item=documentState?.media.find(media=>media.id===sourceOpenId);
  if(item)void sourceAssets.load(item,documentState.project_epoch,{sourceVersion:position?.source_version,audioStreamIndex:position?.audio_stream_index ?? 0,includeWaveform:Boolean(item.has_audio),force:true});
});
sourceSeek=createSourceSeek({range:$("source-position"),frame:$("source-seek-frame"),seek:$("source-seek"),status:$("source-position-status"),getMedia:()=>{
  const item=viewerMode==="source" ? documentState?.media.find(media=>media.id===sourceOpenId) : null;
  return item ? {...item,epoch:documentState.project_epoch} : null;
},getPosition:()=>sourcePosition(true),onSeek:async frame=>{
  fastTransport?.stop();audioScrub?.stop();
  await sourcePlayer.seekFrame(frame);syncSourcePosition();audioScrub?.request();
},onError:notice});
bindSourceScrub($("source-video"),audioScrub,()=>viewerMode==="source" && !fastTransport?.active());
for(const event of ["loadstart","emptied","error","seeked"])$("source-video").addEventListener(event,syncSourcePosition);
$("source-video").addEventListener("timeupdate", () => {
  if (viewerMode !== "source") return;
  syncSourcePosition();
});
for (const event of ["play", "pause", "ended"]) $("source-video").addEventListener(event, () => {
  if(event==='play' && !$("source-video").paused)exportPanel?.stopPreview();
  $("play").textContent = $("source-video").paused ? "▶ Play" : "❚❚ Pause";
  sourceAssets?.refresh();
});
for (const event of ["play", "pause", "ended"]) $("program-video").addEventListener(event, () => {
  if(event==='play' && !$("program-video").paused)exportPanel?.stopPreview();
  if (viewerMode === "program") $("play").textContent = $("program-video").paused ? "▶ Play" : "❚❚ Pause";
  sourceAssets?.refresh();
});
async function diagnostics() {
  try {
    const d = await request("/diagnostics");
    $("gpu-status").textContent = d.preview.available
      ? `${d.preview.software ? "CPU · " : ""}${d.preview.name} · Vulkan`
      : "GPU preview unavailable";
  } catch {}
}
exportPanel = createExportPanel({ form: $("export-form"), status: $("export-status"), cancel: $("export-cancel"), refresh: $("export-refresh"), download: $("export-download"), history:{select:$("export-history"),refresh:$("export-history-refresh"),status:$("export-history-status")}, discard:{button:$("export-discard"),dialog:$("export-discard-dialog"),summary:$("export-discard-summary"),status:$("export-discard-status"),confirm:$("export-discard-confirm"),keep:$("export-discard-keep")},
  preview:{button:$("export-preview"),video:$("export-preview-video"),status:$("export-preview-status")},
  beforePreview:()=>{fastTransport?.stop();audioScrub?.stop();programPlayer?.stop();sourcePlayer?.pause();},
  getPreviewContext:()=>({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline_id:timeline?.id,revision:timeline?.revision}),getState: () => {
  if (!timeline || !documentState) return null;
  const end = Math.max(0, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.start_frame + clip.length_frames)));
  return end ? { project_epoch: documentState.project_epoch, if_generation: documentState.generation, timeline_id: timeline.id, revision: timeline.revision, start_frame: 0, end_frame: end, width: 1920, fps: timeline.fps, marks:resolveMarkRange(programMarkState.marks,end),export_scales:timeline.export_scales,has_audio:timeline.tracks.some(track=>track.kind==="audio" && track.clips.length>0) } : null;
} });
$("export-in").addEventListener("click", () => {setProgramMark(false);exportPanel.useMarks?.();});
$("export-out").addEventListener("click", () => {setProgramMark(true);exportPanel.useMarks?.();});
slipView=createSlipView({root:$("slip-view"),notice,commit:(operation)=>commit(operation),onVisible:(visible)=>{
  if(visible){slipScopesState={workspace:editor.dataset.workspace,visible:!$("scopes").hidden};scopes?.setVisible(false);}
  else if(slipScopesState){scopes?.setVisible(editor.dataset.workspace==="Color" && (slipScopesState.workspace!==editor.dataset.workspace || slipScopesState.visible));slipScopesState=null;}
  viewerZoom?.refresh();
},getTarget:(clip)=>{
  if(!documentState || !timeline || timeline.id==="fixture" || !writable || busy || unresolved || !view.selection.includes(clip))return null;
  const end=Math.max(1,...timeline.tracks.flatMap((track)=>track.clips.map((item)=>item.start_frame+item.length_frames)));
  return {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:Math.min(view.playhead,end-1),clip_id:clip};
}});
sharedLibrary=createLibraryPanel({root:sharedLibraryRoot,getState:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:(operation)=>mutate(operation,true),notice});
nativeAssets=createNativeAssetPanel({root:nativeAssetsRoot,getContext:()=>documentState?{...documentState,selected_ids:[...mediaState.selected]}:null,canCommit:()=>writable && !busy && !unresolved,libraryCommit:operation=>mutate(operation,true,'/native-assets/commands'),projectCommit:operation=>mutate(operation,true),onImported:ids=>{mediaState.selected=ids.filter(id=>documentState.media.some(item=>item.id===id));selectedMedia=mediaState.selected.at(-1) || null;catalog?.search(mediaState.query || '');},notice});
const reviewContext=()=>{
  if(!documentState?.project_name || !timeline || timeline.id==="fixture")return null;
  const clips=timeline.tracks.flatMap(track=>track.clips).filter(clip=>view.selection.includes(clip.id)),oneGroup=clips[0]?.linked_group && clips.every(clip=>clip.linked_group===clips[0].linked_group),clip=(clips.length===1 || oneGroup)?clips.find(clip=>clip.kind==="media"):null;
  const end=Math.max(1,...timeline.tracks.flatMap(track=>track.clips.map(clip=>clip.start_frame+clip.length_frames)));
  return {document:documentState,selectedMedia,clip,query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:Math.max(0,Math.min(view.playhead,end-1)),width:640}};
};
review=createReview({root:$("review-dialog"),canCommit:()=>writable && !busy && !unresolved,commit,notice,getContext:reviewContext});
reviewMetadata=createReviewMetadata({root:$("review-metadata-dialog"),getContext:reviewContext,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),notice,onCompare:media_id=>review.open({media_id}).catch(error=>notice(error.message))});
pasteAttributes=createPasteAttributes({root:$("paste-attributes-dialog"),getContext:()=>documentState && timeline?{epoch:documentState.project_epoch,generation:documentState.generation,timeline:timeline.id,revision:timeline.revision,clipboard:documentState.clipboard_count?documentState.clipboard_revision:null,clip_ids:[...view.selection]}:null,canCommit:()=>writable && !busy && !unresolved,commit,notice});
function presetContext(){
  if(!documentState)return null;
  const ids=timeline?linkedSelection(timeline,view.selection):[],clips=timeline?.tracks.flatMap(track=>track.clips.filter(clip=>ids.includes(clip.id)).map(clip=>({clip,kind:track.kind}))) || [];
  return {epoch:documentState.project_epoch,generation:documentState.generation,timeline:timeline?.id,revision:timeline?.revision,clip_ids:ids,name:clips[0]?.clip.name,roles:{video:clips.some(item=>item.kind==='video'),audio:clips.some(item=>item.kind==='audio')}};
}
const presetShortcuts=createPresetShortcuts({getContext:presetContext,canCommit:()=>writable && !busy && !unresolved,commit,notice});
presetPanel=createPresetPanel({root:$("panel-content"),getContext:presetContext,shortcuts:presetShortcuts,presetDnd:canvasTimeline.presetDnd,canCommit:()=>writable && !busy && !unresolved,commit,libraryCommit:operation=>mutate(operation,true,'/presets/commands'),notice});
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
