import { isTextTarget, installSplitter, installClipListDismissal } from "./ui.js";
import { createTimeline, fixtureTimeline } from "./timeline/index.js";
import { linkedSelection, playheadSelection,selectedTransition,selectedGap,nativeGapAt,clipSelectionAnchor,reconcileSelectionAnchor,firstSelectionAnchor,playheadSelectionAnchor,MIN_TIMELINE_SCALE,MAX_TIMELINE_SCALE,timelineScrollBounds,timelineOriginForFrame } from "./timeline/geometry.js";
import {isRetimeShortcut,isTimelineContextShortcut,timelineSelectionFocus} from './timeline/input.js';
import {createRetimeMenu} from './retime-menu.js';
import {createTimelineContextMenu} from './timeline/context-menu.js';
import {buildTimelineContext,timelineContextItems,timelineContextOperation} from './timeline/context-actions.js';
import {createCommandOwnership,deleteCommandOwner} from './command-ownership.js';
import {retimeVisibilityState,toggleRetimeVisibility,retimeProjectVisibility} from './retime-visibility.js';
import { request, sendMutation, ApiFailure, persistentClientId } from "./api.js";
import {createProxyControls} from "./proxies.js";
import { createViewer } from "./viewer.js";
import {createViewerZoom,isViewerFullscreenShortcut} from './viewer-zoom.js';
import { createSourcePlayer, sourceSelection, sourceMediaPath, sourceMediaQuery } from "./source.js";
import {createSourcePlacement} from './source-placement.js';
import {createSourceWaveform} from './source-waveform.js';
import {createTimelineWaveforms} from './timeline-waveforms.js';
import { createProgramPlayer } from "./program.js";
import { buildProgramWindow } from "./program-range.js";
import { sourceSampleAtFrame,sourceAudioQuery } from "./source-clock.js";
import { createSourceSeek } from "./source-seek.js";
import { createSourceAssets,createSourceAssetQueue,sourceAssetKey,mediaThumbnail,nativeThumbnailItem } from "./source-assets.js";
import { createInspectorViewportKeeper,inspectorGroup,editingShortcutAllowed,selectionInspectorRows,renderInspectorSelection, detailIdentity, renderProperties, renderMarkers,renderTransitionSelection,videoPropertySelection,audioPropertySelection,retimePropertySelection,compoundSelectionOperation,renderRetime,renderBlendMatte,renderSelectedVideoProperties,renderSelectedAudioGain,renderSelectedVideoEffects } from "./inspector.js";
import {createZoomLink} from './curves.js';
import {createFontCatalogReader} from './fonts.js';
import {effectDragItem,effectPlacementOperation} from './timeline/effect-drop.js';
import {createCurveWindow} from './curve-window.js';
import {maskFocusAfterEdit} from './masks.js';
import { renderMixer, mixerDraftContext } from "./mixer.js";
import {createMixerEditorState,notifyMixerMutation} from './mixer-inserts.js';
import {canRetainAudioPresetDraft} from './audio-presets.js';
import { createExportPanel } from "./export.js";
import { createScopes, scopeTarget } from "./scopes.js";
import { balanceSelected, balanceTarget } from "./balance.js";
import { renderCatalog,mediaRowInfo,renderMediaProxyStatus } from "./catalog.js";
import {PROJECT_POOL_DRAG_TYPE,projectPoolItems,projectPoolOperation,projectPoolTarget} from './project-pool-placement.js';
import { createSlipView } from "./slip.js";
import { createSilencePanel } from "./silence.js";
import { createLibraryPanel } from "./library.js";
import {createNativeAssetPanel,nativeAssetMutation} from './native-assets.js';
import {createLibraryCaptureDrop,stageLibraryCaptureDrag} from './library-capture-drop.js';
import {createMediaImportPanel} from './media-import.js';
import {createMediaRelinkPanel} from './media-relink.js';
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
import {createProjectView} from './project-view.js';
import {resolveMarkRange,setMarkIn,setMarkOut,markRangeContext,markRangeAction} from './mark-range.js';

const $ = (id) => document.getElementById(id);
const readFonts=createFontCatalogReader(()=>request('/fonts'));
const editor = $("editor");
const commandOwnership=createCommandOwnership();
const clipListDismissal=installClipListDismissal(document.querySelector('.timeline-list-menu'));
let scopes = null, scopesWanted=false, scopePlayback = false, scopesSuspended = false, previewCache = null, audioMeters = null;
let slipScopesState = null;
let catalog = null,proxyControls=null,proxySettings=null,proxyCacheAvailable=true;
const proxyQueueAttempts=new Set();
let proxyQueueOwner=null;
let silencePanel = null;
let sharedLibrary = null;
let nativeAssets=null,libraryCaptureDrop=null,mediaImport=null,mediaRelink=null,otioImport=null,libraryMode='shared';
let timelineAction=null,newTimelineOwner=null;
let nativePlacementIntent=0,nativePlacementCompletion=null;
let clipboard=null,clipboardImages=null,clipboardFocus='timeline',clipboardFocusSequence=0;
const clipboardButtons=[];
let clipboardStatus=null,clipboardRetry=null,clipboardCancel=null,clipboardOverwrite=null;
const sharedLibraryRoot=document.createElement('div'),nativeAssetsRoot=document.createElement('div');sharedLibraryRoot.dataset.commandOwner=nativeAssetsRoot.dataset.commandOwner='library';
function openLibraryPanel(mode=libraryMode){
  clipListDismissal.close();
  libraryMode=mode;void sharedLibrary?.cancel();nativeAssets?.hide();
  const sources=document.createElement('div');sources.className='tools';sources.dataset.commandOwner='library';sources.setAttribute('role','group');sources.setAttribute('aria-label','Library source');
  sources.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});
  for(const [value,label] of [['shared','Shared media archive'],['native','Native assets']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(value===mode));button.addEventListener('click',()=>openLibraryPanel(value));sources.append(button);
  }
  $('panel-content').replaceChildren(sources,mode==='shared'?sharedLibraryRoot:nativeAssetsRoot);
  return mode==='shared'?sharedLibrary?.open():nativeAssets?.open();
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
let timelineContextMenu=null,contextDialog=null,contextSilence=null,timelineContextOpenSequence=0;
let compoundNavigation=null;
let projectView=null;
let timelineOpenSequence=0;
let exportPanel=null;
let selectionFollowsPlayhead=true;
try {selectionFollowsPlayhead=localStorage.getItem("venturi-selection-follows-playhead")!=="false";} catch {}
function updateInspectorToggle(){$("show-inspector").setAttribute("aria-expanded",String(innerWidth<=950?editor.classList.contains("inspector-drawer-open"):!editor.classList.contains("inspector-collapsed")));audioMeters?.sync();}
function updateBrowserToggle(){for(const button of document.querySelectorAll('#workspaces [data-panel]'))button.setAttribute('aria-expanded',String(innerWidth<=760?editor.classList.contains('browser-drawer-open'):!editor.classList.contains('browser-collapsed')));}
let inspectorSelectionRead=null,inspectorViewport=null;
function setInspectorTab(tab){
  if(!['video','audio','selection'].includes(tab))return;
  if($('inspector').dataset.inspectorTab!==tab)cancelInspectorDraft();
  clipListDismissal.close();
  $('inspector').dataset.inspectorTab=tab;
  inspectorViewport?.contextChanged();
  for(const button of document.querySelectorAll('button[data-inspector-tab]'))button.setAttribute('aria-selected',String(button.dataset.inspectorTab===tab));
  if(tab==='selection')inspectorSelectionRead?.read();else inspectorSelectionRead?.cancel();
  audioMeters?.sync();
}
function globalEditingShortcut(event,{allowRepeat=false}={}){return !timelineContextMenu?.active() && editingShortcutAllowed(event,{dialogOpen:Boolean(document.querySelector('dialog[open]')),allowRepeat}) && !isTextTarget(event.target);}
document.addEventListener('keydown',event=>{
  if(timelineContextMenu?.active() && !event.target.closest?.('.timeline-context-menu-layer')){
    if(event.key==='Escape')timelineContextMenu.close();
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);
function revealBrowser(name){
  clipListDismissal.close();
  for(const tab of document.querySelectorAll('.media-source-tabs [data-panel]'))tab.setAttribute('aria-selected',String(tab.dataset.panel===(name==='Library'?'Library':'Media')));
  $('browser').dataset.commandOwner=name==='Media'?'media':'library';
  const same=($('browser').dataset.browserPanel || 'Media')===name;
  if(innerWidth<=760){const open=!(same && editor.classList.contains('browser-drawer-open') && ['Media','Effects'].includes(name));editor.classList.toggle('browser-drawer-open',open);if(open)editor.classList.remove('inspector-drawer-open');}
  else if(same && ['Media','Effects'].includes(name))editor.classList.toggle('browser-collapsed');else editor.classList.remove('browser-collapsed');
  updateBrowserToggle();updateInspectorToggle();
}
function workspaceTool(workspace,label){
  if(editor.dataset.workspace!==workspace || !$('workspace-tools').querySelector('button'))showWorkspace(workspace);
  const action=[...$('workspace-tools').querySelectorAll('button')].find(button=>button.textContent===label);
  if(action && !action.disabled)action.click();
}
function revealInspector(){clipListDismissal.close();if(innerWidth<=760)editor.classList.remove('browser-drawer-open');editor.classList.remove("inspector-collapsed");if(innerWidth<=950)editor.classList.add("inspector-drawer-open");updateBrowserToggle();updateInspectorToggle();}
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

function revealNativeFilters(){
  const section=document.querySelector('[data-visual-path="selected-filters"]') || document.querySelector('[data-visual-path="filters"]');
  if(!section)return notice('Select a native video clip first');
  revealInspector();
  for(let node=section;node;node=node.parentElement?.closest('details'))node.open=true;
  section.scrollIntoView({block:'start'});
}
function showWorkspace(name) {
  clipListDismissal.close();
  editor.dataset.workspace = name;
  inspectorViewport?.contextChanged();
  scopes?.setVisible(scopesWanted && name === "Color" && !scopesSuspended && $("screen").dataset.viewerMode !== "source" && $("slip-view").hidden);
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    if (button.tagName === "BUTTON")
      button.setAttribute("aria-pressed", button.dataset.workspace === name);
  });
  const area = $("workspace-tools");
  area.replaceChildren();
  area.hidden = name === "Edit" || $("screen").dataset.viewerMode === "source";
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
      if(label === "Analyze silence · VAD"){programPlayer?.stop();openTimelineSilence();return;}
      if(label === "Voiceover"){viewerModeSet("program");voiceover?.open();return;}
      if(label === "VU / spectrum"){audioMeters?.open();return;}
      if(name === "Color") {
        if (label === "Auto balance") {
          if (!writable || busy || unresolved) return notice("A connected writer is required");
          button.disabled=true;notice("Analyzing the native isolated clip frame…");
          balanceSelected({owner:area,canInteract:()=>button.isConnected && editor.dataset.workspace==='Color' && writable && !busy && !unresolved && !document.hidden && viewerMode==='program' && programPlayer?.state()==='stopped' && !document.querySelector('dialog[open]'),getTarget:()=>viewerMode === "program" && !scopePlayback ? balanceTarget(documentState,timeline,view.selection,view.playhead) : null,api:request,commit})
            .then((changed)=>notice(changed ? "Native Auto Balance applied · one Undo step" : "No native balance correction needed"))
            .catch((error)=>notice(error.message)).finally(()=>{button.disabled=false;});return;
        }
        if (label === "Waveform / RGB parade / Vectorscope / Histogram") { scopesWanted=$("scopes").hidden;scopes?.setVisible(scopesWanted); return; }
        if (label === "Curves") {
          openCurveWindow();return;
        }
        revealNativeFilters();return;
      }
      if (!mixerDetail) return notice("Open a native timeline first");
      revealInspector();mixerDetail.open=true;mixerDetail.scrollIntoView({block:"start"});
    });
    button.title = button.disabled ? "Unavailable" : label === "Auto balance" ? "Analyze the selected clip and apply native auto balance" : `Open ${label}`;
    tools.append(button);
  }
  area.append(tools);
  audioMeters?.sync();
  try {
    localStorage.setItem("workspace", name);
  } catch {}
}

document
  .querySelectorAll("button[data-workspace]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      {showWorkspace(button.dataset.workspace);setInspectorTab(button.dataset.workspace==='Audio'?'audio':'video');revealInspector();if(button.dataset.workspace==='Audio' && mixerDetail)mixerDetail.open=true;else if(button.dataset.workspace==='Color')revealNativeFilters();},
    ),
  );
document.querySelectorAll("[data-panel]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-panel]")
      .forEach((tab) => tab.setAttribute("aria-selected", tab === button));
    const name = button.dataset.panel;
    revealBrowser(name);$("browser").dataset.browserPanel=name;
    if(button.closest('.media-source-tabs')){editor.classList.remove('browser-collapsed');if(innerWidth<=760){editor.classList.add('browser-drawer-open');editor.classList.remove('inspector-drawer-open');}updateBrowserToggle();updateInspectorToggle();}
    presetPanel?.hide();
    void sharedLibrary?.cancel();nativeAssets?.hide();
    $("media-list").hidden = !["Media","Effects"].includes(name);
    $("search").parentElement.hidden = !["Media","Effects"].includes(name);
    $("panel-content").hidden = name === "Media";
    $("panel-content").replaceChildren();
    if (name === "Library") {openLibraryPanel();return;}
    if (name === "History") { renderHistory(); return; }
    if (name === "Presets") for (const [label,mode] of [["Open native color presets","Color"],["Open native audio presets","Audio"]]) {
      const action=document.createElement("button");action.textContent=label;action.addEventListener("click",()=>{
        showWorkspace(mode);revealInspector();
        if(mode==="Color") revealNativeFilters();
        else {if(!mixerDetail)return notice("Open a native timeline first");mixerDetail.open=true;mixerDetail.scrollIntoView({block:"start"});}
      });$("panel-content").append(action);
    }
    if(name==='Presets'){presetPanel?.open();return;}
    if (name === "Effects") for (const [label,generator] of [["Add title","title"],["Add adjustment clip","adjustment"]]) {
      const action=document.createElement("button");action.textContent=label;
      bindPaletteDrag(action,{kind:'generator',generator});
      action.addEventListener("click",()=>addGenerator(generator));$("panel-content").append(action);
    }
    if(name==='Effects'){
      const solid=document.createElement('button');solid.textContent='▰ Color Fill';bindPaletteDrag(solid,{kind:'generator',generator:'solid'});solid.addEventListener('click',()=>$('add-solid').click());$('panel-content').prepend(solid);
      const heading=document.createElement('p');heading.textContent='Filters';$('panel-content').append(heading);
      for(const [label,kind] of [['Color Correction','ColorCorrection'],['Exposure','Exposure'],['Box Blur','BoxBlur'],['Gaussian Blur','GaussianBlur'],['Drop Shadow','DropShadow']]){
        const effect=document.createElement('button');effect.textContent=`☼ ${label}`;bindPaletteDrag(effect,{kind:'filter',filter:kind});effect.addEventListener('click',()=>{
          setInspectorTab('video');revealNativeFilters();
          const section=document.querySelector('[data-visual-path="selected-filters"]'),choice=section?.querySelector('[aria-label="Visual filter type"]'),add=section?.querySelector('[aria-label="Add visual filter to selection"]');
          if(!choice || !add || ![...choice.options].some(option=>option.value===kind))return notice('Select a video clip to add this filter');
          choice.value=kind;choice.dispatchEvent(new Event('change'));if(!add.disabled)add.click();
        });$('panel-content').append(effect);
      }
      const monochrome=document.createElement('button');monochrome.textContent='☼ Black and white';
      bindPaletteDrag(monochrome,{kind:'filter',filter:'ColorCorrection',preset:'BlackAndWhite'});
      monochrome.addEventListener('click',()=>{
        if(!writable || busy || unresolved || viewerMode!=='program' || programPlayer?.state()!=='stopped' || document.querySelector('dialog[open]'))return;
        const clip=timeline?.tracks.filter(track=>track.kind==='video' && !track.locked).flatMap(track=>track.clips).find(clip=>view.selection.includes(clip.id));
        if(!clip)return notice('Select an unlocked video clip, or drag Black and white onto one');
        run({kind:'apply_palette_filter',clip_id:clip.id,filter:'ColorCorrection',preset:'BlackAndWhite'});
      });$('panel-content').append(monochrome);
    }
    if(name==='Effects'){const transitions=document.createElement('div');transitions.id='transition-presets';$("panel-content").append(transitions);renderTransitionPresets();}
    for (const label of (name==='Effects'?[]:panels[name]) || []) {
      const item = document.createElement("p");
      item.textContent = label;
      $("panel-content").append(item);
    }
  }),
);
$("projects-button").addEventListener("click", () => {clipListDismissal.close();$("projects").showModal();});
$("palette-button").addEventListener("click", () => {clipListDismissal.close();$("palette").showModal();});
$("export-button").addEventListener("click", () => {
  clipListDismissal.close();
  $("export-panel").hidden = false;
  exportPanel.open();
});
$("close-export").addEventListener("click", () => {
  $("export-panel").hidden = true;
  exportPanel.close();
});
$("collapse-inspector").addEventListener("click", () => {
  cancelInspectorDraft();
  editor.classList.remove("inspector-drawer-open");
  if(innerWidth>950)editor.classList.toggle("inspector-collapsed");
  updateInspectorToggle();$("show-inspector").focus();
});
$("show-inspector").addEventListener("click",()=>{if(innerWidth<=950 && editor.classList.contains("inspector-drawer-open") || innerWidth>950 && !editor.classList.contains("inspector-collapsed"))$("collapse-inspector").click();else{revealInspector();$("collapse-inspector").focus();}});
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
installSplitter($("left-splitter"), editor, "--left", innerWidth<=1350?210:240,1,{storageKey:"venturi-native-layout:left"});
installSplitter($("right-splitter"), editor, "--right", 320, -1,{storageKey:"venturi-native-layout:right"});
installSplitter($("timeline-splitter"), editor, "--bottom", Math.round(innerHeight*.30), -1,{storageKey:"venturi-native-layout:bottom"});
document.addEventListener("keydown", (event) => {
  if(!globalEditingShortcut(event))return;
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

let timeline = null,lastReveal=null;
const view = {
  origin: 0,
  scale: 60,
  scrollY: 0,
  videoScroll:0,
  audioScroll:0,
  videoPaneHeight:null,
  rowHeight:44,
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
let sourceOpenId = null, sourceLibraryItem=null, sourcePreviewAttempt=null;
function currentSourceItem(){
  if(sourceLibraryItem && sourceLibraryItem.epoch===documentState?.project_epoch && sourceLibraryItem.item.id===sourceOpenId)return sourceLibraryItem.item;
  return documentState?.media.find(item=>item.id===sourceOpenId);
}
function cancelSourcePreview(){sourcePreviewAttempt?.controller.abort();sourcePreviewAttempt=null;}
function clearLibrarySource(){if(sourceLibraryItem)sourceRanges.delete(sourceLibraryItem.item.id);sourceLibraryItem=null;}
let sourcePlacement=null;
let sourceWaveform=null,sourceWaveformBinding=null,sourceWaveformDemand={entries:[],epoch:null};
let sourceSeek=null;
let sourceAssets=null,timelineWaveforms=null,derivativesTransportPending=false;
const sourceRanges = new Map();
let programMarkState=markRangeContext(null,null,null);
const mediaAssets = new Map();
let nativeThumbnailDemand={epoch:null,items:[]};
function nativeThumbnailCurrent(item,epoch){
  const reference=item.native_asset;
  return Boolean(reference && epoch===documentState?.project_epoch && reference.if_generation===documentState?.generation && nativeThumbnailDemand.epoch===epoch && nativeThumbnailDemand.items.some(value=>value.id===item.id && value.native_asset.id===reference.id && value.native_asset.revision===reference.revision && value.native_asset.if_generation===reference.if_generation));
}
function nativeThumbnail(asset){
  const item=nativeThumbnailItem(asset,documentState),cached=item && mediaThumbnail(mediaAssets,item.id);
  return cached?.nativeAsset && cached.nativeAsset.revision===asset.revision && cached.nativeAsset.if_generation===documentState?.generation?cached:null;
}
function demandNativeThumbnails(assets,context,{force=false}={}){
  const epoch=context?.project_epoch,items=context && epoch===documentState?.project_epoch && context.generation===documentState?.generation?assets.map(asset=>nativeThumbnailItem(asset,context)).filter(Boolean):[];
  nativeThumbnailDemand={epoch,items};
  sourceAssets?.demand('native_pool',items.map(item=>({item,includeWaveform:false,force})),epoch);
}
const mediaState = {selected: [], anchor: null, folder: "*", kind: "all", open: false,layout:'details',expanded:[],gridFolder:null,selectedFolder:null};
try {const layout=localStorage.getItem('venturi-media-pool-layout');if(['details','list','grid'].includes(layout))mediaState.layout=layout;} catch {}
function paintProxyBadges(){
  const items=new Map((documentState?.media || []).map(item=>[item.id,item]));
  for(const card of $('media-list').querySelectorAll('.media-item')){
    card.querySelector('.catalog-proxy-status')?.remove();const item=items.get(card.dataset.mediaId);if(!item)continue;
    const info=mediaRowInfo(item);card.title=`${item.name} · ${info.metadata} · ${info.duration}`;
    const job=proxySettings?.enabled?proxyControls?.statusFor(item.id):null;renderMediaProxyStatus(card,job);
  }
}
function proxyAPI(path,body,options={}){
  const payload=body===undefined?undefined:{...body,client_id:clientId};
  return request(path,payload,(url,init)=>fetch(url,{...init,method:options.method || init.method,signal:options.signal?AbortSignal.any([init.signal,options.signal].filter(Boolean)):init.signal}));
}
async function queueProjectProxies(context,isCurrent,manual=false){
  if(proxyQueueOwner || !proxyCacheAvailable || context.cache?.available===false || !documentState || context.project_epoch!==documentState.project_epoch || !context.settings.enabled || !writable || busy || unresolved)return;
  const candidates=documentState.media.filter(item=>item.has_video && !item.is_image && !item.compound_timeline_id && !item.offline);
  const attempt=JSON.stringify([context.project_epoch,context.settings.quality,candidates.map(item=>[item.id,item.content_hash])]);
  if(!manual && proxyQueueAttempts.has(attempt))return;
  proxyQueueAttempts.add(attempt);while(proxyQueueAttempts.size>32)proxyQueueAttempts.delete(proxyQueueAttempts.values().next().value);
  const owner={epoch:context.project_epoch,quality:context.settings.quality};proxyQueueOwner=owner;
  try{
    for(let offset=0;offset<candidates.length;offset+=32){
      if(!isCurrent() || !proxyCacheAvailable || proxyControls?.settings()?.quality!==owner.quality || !proxyControls?.settings()?.enabled)return;
      const result=await proxyAPI('/media/proxies/prepare',{project_epoch:owner.epoch,media_ids:candidates.slice(offset,offset+32).map(item=>item.id)});
      if(!isCurrent())return;if(result.project_epoch!==owner.epoch)throw Error('The project changed while queuing proxies');
      if(result.errors?.length)throw Error(result.errors.map(item=>`${candidates.find(media=>media.id===item.media_id)?.name || item.media_id}: ${item.error || item.code}`).join(' · '));
    }
  }catch(error){if(isCurrent())notice(error.message);if(manual)throw error;}
  finally{if(proxyQueueOwner===owner){proxyQueueOwner=null;void proxyControls?.refresh();}}
}
function revealProjectMedia(ids){
  const visible=ids.filter(id=>documentState?.media.some(item=>item.id===id));
  mediaState.selected=visible;mediaState.anchor=visible[0] || null;selectedMedia=visible.at(-1) || null;
  mediaState.query='';$('search').value='';catalog?.reveal(visible);
}
function updatePlayAvailability() {
  const armed=timeline?.tracks.some((track)=>track.kind==="audio" && track.armed && !track.locked);
  const sourceMedia=viewerMode==="source"?currentSourceItem():null;
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
  cancelInspectorDraft();
  cancelSourcePreview();
  if(mode!==viewerMode)nativePlacementIntent++;
  maskSelectionSequence++;
  transformOverlay?.cancel();
  maskOverlay?.cancel();
  audioMeters?.invalidate();
  fastTransport?.stop();
  audioScrub?.stop();
  viewerMode = mode;
  $("workspace-tools").hidden = mode === "source" || editor.dataset.workspace === "Edit";
  scopes?.setVisible(scopesWanted && mode === "program" && editor.dataset.workspace === "Color" && $("slip-view").hidden);
  scopes?.refresh();
  if (mode === "source") programPlayer?.stop();
  $("screen").dataset.viewerMode = mode;
  audioMeters?.sync();
  $("program-position").hidden=mode!=='program';$("source-seek-control").hidden=mode!=='source';
  $("source-view").hidden = mode !== "source";
  $("program-mode").setAttribute("aria-pressed", mode === "program");
  $("source-mode").setAttribute("aria-pressed", mode === "source");
  syncProgramMarks();
  updatePlayAvailability();
  $("viewer-caption").textContent = mode === "source" ? currentSourceItem()?.name || "Source" : timeline?.name || "Program";
  if (mode === "program") { sourcePlayer?.pause(); sourceAssets?.cancelSource(); updateTime(); seek(); }
  viewerZoom?.refresh();
  sourcePlacement?.refresh();
  refreshSourceWaveform();
}
function sourceWaveformContext(){
  const item=viewerMode==='source'?documentState?.media.find(item=>item.id===sourceOpenId):null;
  if(!item || item.native_asset || item.has_video || !item.has_audio || item.is_image || item.compound_timeline_id)return null;
  const epoch=documentState.project_epoch,identity=JSON.stringify([epoch,item.id,item.content_hash,item.duration_frames,item.fps,item.audio_stream_count]),position=sourcePosition(true),verified=sourcePlayer?.verifiedSource();
  if(sourceWaveformBinding?.identity!==identity)sourceWaveformBinding=null;
  if(position?.source_version)sourceWaveformBinding={identity,sourceVersion:position.source_version,frame:position.frame};
  const mark=id=>$(id).value.trim()===''?NaN:Number($(id).value);
  return {item,epoch,sourceVersion:sourceWaveformBinding?.sourceVersion ?? null,frame:sourceWaveformBinding?.frame ?? 0,marks:{source_in:mark('source-in'),source_out:mark('source-out')},verified:Boolean(verified?.epoch===epoch && verified.media_id===item.id),preparing:sourcePlayer?.preparing()===true,playing:!$('source-video').paused};
}
function refreshSourceWaveform(){
  const item=viewerMode==='source'?currentSourceItem():null;
  $('source-view').dataset.sourceAudioOnly=String(Boolean(item && !item.native_asset && !item.has_video && item.has_audio));
  sourceWaveform?.refresh();
}
function sourcePosition(allowPreparing=false) {
  const position=sourcePlayer?.current();
  return position && (allowPreparing || !sourcePlayer.preparing()) && position.epoch===documentState?.project_epoch && position.media_id===sourceOpenId ? position : null;
}
function syncSourcePosition() {
  sourceSeek?.sync();
  refreshSourceWaveform();
  const valid=Boolean(sourcePosition());
  $("source-mark-in").disabled=!valid;$("source-mark-out").disabled=!valid;
  $("source-assets-refresh").disabled=!valid || Boolean(currentSourceItem()?.native_asset);
  const position=sourcePosition(true);
  if(viewerMode!=="source" || !position)return;
  const fps=position.fps.num/position.fps.den,seconds=Math.floor(position.frame/fps);
  $("timecode").textContent=`Source ${[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60,position.frame%Math.max(1,Math.round(fps))].map(value=>String(value).padStart(2,"0")).join(":")}`;
}
function openSourceItem(item){
  const sameSource=sourceOpenId===item.id;
  const startFrame=sameSource?sourcePosition(true)?.frame ?? 0:0;
  if(!sameSource)sourceAssets?.cancelSource();
  sourceOpenId=item.id;
  const range=(sameSource?sourceRanges.get(item.id):null) || {source_in:0,source_out:item.is_image?Math.round(5*item.fps.num/item.fps.den):item.duration_frames};
  sourceRanges.set(item.id,range);
  $('source-in').value=range.source_in;$('source-out').value=range.source_out;
  $('source-mark-in').disabled=!!item.is_image;$('source-mark-out').disabled=!!item.is_image;
  viewerModeSet('source');sourceSeek?.reset(startFrame);
  sourcePlayer.open(item,documentState.project_epoch,$('source-quality').value,startFrame,{audioMode:'all'});
  syncSourcePosition();
}
function openSource(){
  cancelSourcePreview();
  const item=documentState?.media.find(media=>media.id===selectedMedia);
  if(!item)return notice('Select a media file first');
  if(item.compound_timeline_id){const next=documentState.timelines.find(t=>t.id===item.compound_timeline_id);if(next)openTimelineRoot(next);return;}
  clearLibrarySource();openSourceItem(item);
}
function reopenSource(){const item=currentSourceItem();if(item?.native_asset)openSourceItem(item);else openSource();}
async function previewNativeAsset(asset,{isCurrent=()=>true}={}){
  if(!documentState || busy || unresolved || view.recording || document.querySelector('dialog[open]') || !isCurrent())return;
  cancelSourcePreview();
  const owner={epoch:documentState.project_epoch,generation:documentState.generation,id:asset.id,revision:asset.revision,controller:new AbortController()};sourcePreviewAttempt=owner;
  const current=()=>sourcePreviewAttempt===owner && documentState?.project_epoch===owner.epoch && documentState?.generation===owner.generation && !busy && !unresolved && !view.recording && !document.querySelector('dialog[open]') && isCurrent();
  try{
    const result=await request(`/native-assets/items/${encodeURIComponent(owner.id)}/source`,{project_epoch:owner.epoch,if_generation:owner.generation,revision:owner.revision},(url,init)=>fetch(url,{...init,signal:AbortSignal.any([init.signal,owner.controller.signal].filter(Boolean))}));
    if(!current())return;
    const item=result.item,reference=item?.native_asset;
    if(result.project_epoch!==owner.epoch || result.generation!==owner.generation || typeof item?.id!=='string' || !item.id || reference?.id!==owner.id || reference.revision!==owner.revision || reference.if_generation!==owner.generation || typeof reference.source_version!=='string' || !reference.source_version)throw Error('The Library Source changed; open the asset again');
    sourcePreviewAttempt=null;clearLibrarySource();sourceLibraryItem={epoch:owner.epoch,generation:owner.generation,item};openSourceItem(item);
  }catch(error){if(current() && error.name!=='AbortError')notice(error.message);}
  finally{if(sourcePreviewAttempt===owner)sourcePreviewAttempt=null;}
}
$('source-mode').addEventListener('click',reopenSource);
$('program-mode').addEventListener('click',()=>viewerModeSet('program'));
function reopenSourceQuality(){
  if(!currentSourceItem())return openSource();
  cancelSourcePreview();fastTransport?.stop();audioScrub?.stop();rememberSourceRange();
  return sourcePlayer.reopen($('source-quality').value).catch(error=>notice(error.message));
}
$('source-quality').addEventListener('change',()=>{void reopenSourceQuality();});
function rememberSourceRange() { if (sourceOpenId) sourceRanges.set(sourceOpenId,{source_in:Number($("source-in").value),source_out:Number($("source-out").value)});sourcePlacement?.refresh();refreshSourceWaveform(); }
for (const id of ["source-in","source-out"]) $(id).addEventListener("input",rememberSourceRange);
for (const [id,out] of [["source-mark-in",false],["source-mark-out",true]]) $(id).addEventListener("click",()=>{
  const item = currentSourceItem();
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
  derivativesTransportPending=true;sourceAssets?.refresh();timelineWaveforms?.refresh();
  if (viewerMode === "program") { viewer?.invalidate(); programPlayer.toggle().catch((error) => notice(error.message)).finally(()=>{derivativesTransportPending=false;sourceAssets?.refresh();timelineWaveforms?.refresh();}); }
  else sourcePlayer.toggle().catch((error) => notice(error.message)).finally(()=>{derivativesTransportPending=false;sourceAssets?.refresh();timelineWaveforms?.refresh();});
}
$("play").addEventListener("click", togglePlayback);
let inspectorSequence = 0;
let mixerDetail = null;
let mixerMixDrafts = null;
const mixerPaths = new Set();
const mixerEditors=createMixerEditorState(mixerPaths);
const visualState = new Map();
inspectorViewport=createInspectorViewportKeeper($('inspector-content'),{getContext:()=>{
  if(!documentState || !timeline)return null;
  const transition=view.transitionSelection,gap=!view.selection.length && !transition?view.selectedGap:null;
  return JSON.stringify([documentState.project_epoch,timeline.id,$('inspector').dataset.inspectorTab,editor.dataset.workspace,[...view.selection].sort(),transition?{track_id:transition.track_id,clip_id:transition.clip_id,slot:transition.slot}:null,gap?{track_id:gap.track_id,start_frame:gap.start_frame,length_frames:gap.length_frames}:null]);
}});
const curveWindow=createCurveWindow({notice,onChange:open=>{
  for(const button of document.querySelectorAll('[data-ui="curves"]'))button.setAttribute('aria-pressed',String(open));
  selected();
}});
function openCurveWindow(){curveWindow.open();}
let visualControls=[],inspectorDraftOwner=null;
function cancelInspectorDraft(){inspectorDraftOwner=null;viewer?.cancelDraft();}
function selectedKeyController(){return visualControls.find(control=>control.hasSelectedKeys?.());}
function currentDeleteOwner(target=document.activeElement){const owner=commandOwnership.owner(target);return owner==='keys' && !selectedKeyController()?'timeline':owner;}
function deleteOwnedSelection(owner=currentDeleteOwner()){
  if(!writable || busy || unresolved || document.querySelector('dialog[open]'))return;
  if(owner==='library'){if(libraryMode==='native')nativeAssets?.deleteSelection();else notice('Use this browser panel’s item actions; timeline clips were not changed');return;}
  if(owner==='media'){void catalog?.removeSelected().catch(error=>notice(error.message));return;}
  if(owner==='keys'){void selectedKeyController()?.removeSelected();return;}
  if(!timeline || timeline.id==='fixture' || !canvasTimeline.navigationIdle())return;
  const transition=selectedTransition(timeline,view.transitionSelection);
  if(transition){if(!transition.locked)run({kind:'set_transition',clip_id:transition.clip_id,slot:transition.slot,transition:null});return;}
  if(view.selection.length)run({kind:'delete',clip_ids:[...view.selection],ripple:false});
}
function inspectorState(clip) {
  return documentState && timeline && clip ? { project_epoch: documentState.project_epoch, generation: documentState.generation, timeline: timeline.id, revision: timeline.revision, clip, frame: view.playhead,key_page:visualState.get(`key-page:${documentState.project_epoch}:${timeline.id}:${clip}`) || 0 } : null;
}
function syncSelectionActions(){
  const target=selectedTransition(timeline,view.transitionSelection),disabled=!writable || busy || Boolean(unresolved) || !timeline || timeline.id==='fixture';
  $("split").disabled=disabled || Boolean(target) || !view.selection.length;
  const owner=currentDeleteOwner(),baseDisabled=!writable || busy || Boolean(unresolved) || !documentState;
  $('delete').textContent=owner==='media'?'Remove selected media':owner==='keys'?'Delete selected keys':owner==='library' && libraryMode==='native'?'Delete selected Library assets':'Delete';
  $('delete').disabled=baseDisabled || (owner==='library'?libraryMode!=='native' || !nativeAssets?.canDelete():owner==='media'?!mediaState.selected.length:owner==='keys'?!selectedKeyController():disabled || (target?target.locked:!view.selection.length));
  $("close-gap").disabled=disabled || !canvasTimeline.canCloseGap();
  const selected=timeline?.tracks.flatMap(track=>track.clips.filter(clip=>view.selection.includes(clip.id)).map(clip=>({track,clip}))) || [],linked=new Set(timeline?linkedSelection(timeline,view.selection):[]),locked=timeline?.tracks.some(track=>track.locked && track.clips.some(clip=>linked.has(clip.id)));
  for(const button of document.querySelectorAll('[data-selection-command]')){
    const action=button.dataset.selectionCommand;button.disabled=disabled || Boolean(target) || Boolean(locked) || !selected.length && (action!=='ripple' || !selectedGap(timeline,view)) || action==='link' && selected.length<2 || action==='unlink' && !selected.some(({clip})=>clip.linked_group!=null) || action==='paste_attributes' && (!documentState?.clipboard_count || !documentState?.clipboard_revision);
  }
  for(const button of document.querySelectorAll('[data-timeline-command]'))button.disabled=disabled;
}
function selected() {
  inspectorViewport?.capture();
  cancelInspectorDraft();
  timelineContextMenu?.invalidate();
  inspectorSelectionRead?.cancel();inspectorSelectionRead=null;
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
  if(viewerMode==='program' && programPlayer?.state()==='ready')scopes?.onPlaybackFrame();else if(!scopesSuspended)scopes?.refresh();
  const inspectorSeq = ++inspectorSequence;
  for(const node of document.querySelectorAll("#inspector-content details[data-visual-path],.curve-window-content details[data-visual-path]"))visualState.set(node.dataset.visualPath,node.open);
  for(const control of visualControls){if(typeof control.dispose==='function')control.dispose();else control.cancel();}visualControls=[];
  curveWindow.content.replaceChildren();curveWindow.setTitle('Curves');curveWindow.setStatus('Select a native clip to edit its keyframes');
  const mixerOpen = mixerDetail?.open || false;
  mixerMixDrafts=mixerDetail?.captureMixDrafts?.() ?? mixerMixDrafts;
  const mixContext=documentState && timeline?mixerDraftContext({project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision}):null;
  if(!mixContext || mixerMixDrafts?.context!==mixContext)mixerMixDrafts=null;
  mixerEditors.capture(documentState && timeline?{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision}:null,
    mixerDetail?.querySelectorAll("details[data-mixer-path]") || [],
    timeline?[...timeline.tracks.filter(track=>track.kind==='audio').map(track=>({channel:track.id,effects:track.mix.effects})),{channel:'master',effects:timeline.master.effects}]:[]);
  mixerDetail?.disposeMeters?.();mixerDetail=null;
  const getVideoSelection=()=>videoPropertySelection({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline,selection:view.selection});
  const getAudioSelection=()=>audioPropertySelection({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline,selection:view.selection});
  const getRetimeSelection=()=>retimePropertySelection({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline,selection:view.selection});
  const videoSelection=getVideoSelection(),audioSelection=getAudioSelection(),retimeSelection=getRetimeSelection();
  const primaryId=videoSelection?.clip_ids[0] || audioSelection?.clip_ids[0];
  const clip = timeline?.tracks
    .flatMap((track) => track.clips)
    .find((item) => primaryId?item.id===primaryId:view.selection.includes(item.id));
  if(clip){curveWindow.setTitle(`Curves · ${clip.name}`);curveWindow.setStatus('Reading native keyframes…');}
  $("inspector-content").replaceChildren();
  const transition=selectedTransition(timeline,view.transitionSelection);
  syncSelectionActions();
  if(transition){
    view.selection=[];view.selectionAnchor=null;
    setInspectorTab('video');
    const query={project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960},draftOwner={};
    const current=()=>inspectorSequence===inspectorSeq && documentState?.project_epoch===query.project_epoch && documentState?.generation===query.if_generation && timeline?.id===query.timeline_id && timeline?.revision===query.revision && view.playhead===query.frame;
    const canInteract=()=>current() && writable && !busy && !unresolved && viewerMode==='program' && programPlayer?.state()==='stopped' && $('inspector').dataset.inspectorTab==='video' && $('show-inspector').getAttribute('aria-expanded')==='true' && !selectedTransition(timeline,view.transitionSelection)?.locked && !document.querySelector('dialog[open]');
    const controls=renderTransitionSelection($("inspector-content"),transition,{disabled:!writable || busy || Boolean(unresolved) || transition.locked,fps:timeline.fps,getTarget:()=>selectedTransition(timeline,view.transitionSelection),canInteract,commit,notice,
      onPreview:value=>{
        if(value===null){if(inspectorDraftOwner===draftOwner)cancelInspectorDraft();return;}
        if(!canInteract() || !documentState?.capabilities.preview)return;
        inspectorDraftOwner=draftOwner;
        return viewer?.previewDraft({query,clip_id:transition.clip_id,slot:transition.slot,transition:value},{kind:'transition',isCurrent:()=>inspectorDraftOwner===draftOwner && canInteract()}).then(shown=>{
          if(!shown && inspectorDraftOwner===draftOwner && canInteract())throw Error('Preview could not be shown; confirm to apply or cancel');
          return shown;
        });
      },
    });
    if(controls)visualControls.push(controls);
    for(const child of $('inspector-content').children)inspectorGroup(child,'video');setInspectorTab('video');return;
  }
  view.transitionSelection=null;
  const title = document.createElement("strong");
  const gap=selectedGap(timeline,view),gapTrack=timeline?.tracks.find(track=>track.id===gap?.track_id);
  title.textContent = gap?`${gapTrack.label || gapTrack.id} gap · ${gap.start_frame}–${gap.start_frame+gap.length_frames} frames`:clip?.name || "No clip selected";
  title.dataset.inspectorCommon="true";$("inspector-content").append(title);
  if(!clip && !gap && timeline){title.textContent="Timeline";const info=document.createElement('p');info.dataset.inspectorCommon="true";info.textContent=`${timeline.name} · ${timeline.resolution.width}×${timeline.resolution.height} · ${timeline.fps.num}/${timeline.fps.den} fps · ${timeline.tracks.length} tracks`;$("inspector-content").append(info);}
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
  const canNavigateInspector=()=>inspectorCurrent() && !busy && !unresolved && viewerMode==='program' && programPlayer?.state()==='stopped' && !document.querySelector('dialog[open]');
  const canEditInspector=()=>canNavigateInspector() && writable;
  const selectionDetail=(label,key,parent=$('inspector-content'))=>{const section=inspectorGroup(document.createElement('details'),'selection'),summary=document.createElement('summary');section.className='inspector-selection-tools';section.dataset.visualPath=key;section.open=visualState.get(key) ?? false;summary.textContent=label;section.append(summary);parent.append(section);return section;};
  if(view.selection.length && timeline && timeline.id!=='fixture'){
    const target=inspectorGroup(document.createElement('div'),'selection'),query={project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:inspectorFrame,width:320},clip_ids=[...view.selection];target.textContent=`${clip_ids.length} selected clips`;$('inspector-content').append(target);
    let pending=null,complete=false;
    const current=()=>inspectorCurrent() && target.isConnected && documentState?.project_epoch===query.project_epoch && documentState?.generation===query.if_generation && timeline?.id===query.timeline_id && timeline?.revision===query.revision && $('inspector').dataset.inspectorTab==='selection';
    inspectorSelectionRead={cancel(){const before=pending;pending=null;before?.abort();},read(){
      if(pending || complete || !current())return;
      if(clip_ids.length>2048){target.textContent='Select at most 2048 clips to read the native selection summary';return;}
      const controller=new AbortController();pending=controller;target.textContent=`Reading ${clip_ids.length} selected native clips…`;
      request(`/timelines/${encodeURIComponent(query.timeline_id)}/inspector-selection`,{query,clip_ids},(url,options)=>fetch(url,{...options,signal:controller.signal})).then(value=>{if(pending!==controller || !current())return;renderInspectorSelection(target,selectionInspectorRows(value,{query,clip_ids}));complete=true;}).catch(error=>{if(pending===controller && current() && error.name!=='AbortError')target.textContent=error.message;}).finally(()=>{if(pending===controller)pending=null;});
    }};
  }
  const selectionTargets=[];
  for(const [selection,getSelection,role] of [[videoSelection,getVideoSelection,'video'],[audioSelection,getAudioSelection,'audio'],[retimeSelection,getRetimeSelection,'media']]){
    if(!selection || timeline.id==='fixture')continue;
    const target=inspectorGroup(document.createElement('div'),role==='media'?'selection':role),identity=JSON.stringify(selection);target.textContent=role==='video'?'Reading selected video properties…':role==='audio'?'Reading selected audio gain…':'Reading selected media speed…';$('inspector-content').append(target);
    const current=()=>inspectorCurrent() && JSON.stringify(getSelection())===identity;
    const render=detail=>{
      if(!current() || detail.clip_id!==selection.clip_ids[0])return;
      target.replaceChildren();
      const primary=timeline.tracks.flatMap(track=>track.clips).find(item=>item.id===detail.clip_id);
      const draftOwner={};
      const options={selection,getSelection,frame:inspectorFrame,getFrame:()=>view.playhead,canInteract:()=>current() && canEditInspector(),canNavigate:()=>current() && canNavigateInspector(),commit,notice,primaryName:primary?.name,visualState,zoomLink,readFonts,timelineSize:[timeline.resolution.width,timeline.resolution.height],
        previewTitleFont:patch=>{
          if(patch===null){if(inspectorDraftOwner===draftOwner)cancelInspectorDraft();return;}
          if(!current() || !canEditInspector() || !documentState?.capabilities.preview)return;
          inspectorDraftOwner=draftOwner;
          const query={project_epoch:selection.project_epoch,if_generation:selection.generation,timeline_id:selection.timeline_id,revision:selection.revision,frame:inspectorFrame,width:960};
          return viewer?.previewDraft({query,clip_ids:[...selection.clip_ids],...patch},{isCurrent:()=>inspectorDraftOwner===draftOwner && current() && canEditInspector()}).then(shown=>{
            if(!shown && inspectorDraftOwner===draftOwner && current() && canEditInspector())throw Error('Preview could not be shown; confirm to apply or cancel');
            return shown;
          });
        },
        seek:frame=>{maskOverlay?.cancel();view.playhead=frame;updateTime();seek();selected();void projectView?.update();}};
      if(role==='video'){const properties=renderSelectedVideoProperties(target,detail,options);if(properties)visualControls.push(properties);renderBlendMatte(target,detail,options);visualControls.push(...renderSelectedVideoEffects(target,detail,options));}
      else if(role==='audio'){const gain=renderSelectedAudioGain(target,detail,options);if(gain)visualControls.push(gain);}
      else {const retime=renderRetime(target,detail,false,options.getFrame,commit,visualState,options.canInteract,{selection,getSelection,frame:inspectorFrame,labelControls:false,notice});if(retime)visualControls.push(retime);}
    };
    const entry={id:selection.clip_ids[0],target,current,render};selectionTargets.push(entry);
  }
  for(const id of new Set(selectionTargets.map(entry=>entry.id).filter(id=>id!==clip?.id))){
    const query=new URLSearchParams({project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:inspectorFrame});
    request(`/timelines/${encodeURIComponent(timeline.id)}/clips/${encodeURIComponent(id)}/keys/0?${query}`).then(detail=>{for(const entry of selectionTargets.filter(entry=>entry.id===id))entry.render(detail);}).catch(error=>{for(const entry of selectionTargets.filter(entry=>entry.id===id))if(entry.current())entry.target.textContent=error.message;});
  }
  if (clip && documentState && timeline.id !== "fixture") {
    const target = document.createElement("div");target.dataset.inspectorCommon="true"; target.textContent = "Reading native properties…";
    $("inspector-content").append(target);
    const state = inspectorState(clip.id), identity = detailIdentity(state);
    const query = new URLSearchParams({ project_epoch: state.project_epoch, if_generation: state.generation, timeline_id: state.timeline, revision: state.revision, frame: inspectorFrame });
    function setKeyPage(page){
      if(!curveWindow.isOpen() || inspectorSeq!==inspectorSequence || identity!==detailIdentity(inspectorState(clip.id)) || !target.isConnected || !canNavigateInspector())return;
      visualState.set(`key-page:${state.project_epoch}:${state.timeline}:${clip.id}`,page);
      visualState.set("key-page-focus",`${state.project_epoch}:${state.timeline}:${clip.id}`);
      const keys=[...visualState.keys()].filter(key=>key.startsWith("key-page:"));for(const key of keys.slice(0,Math.max(0,keys.length-32)))visualState.delete(key);
      selected();
    }
    request(`/timelines/${encodeURIComponent(timeline.id)}/clips/${encodeURIComponent(clip.id)}/keys/${state.key_page}?${query}`).then((detail) => {
      if (inspectorSeq !== inspectorSequence || identity !== detailIdentity(inspectorState(clip.id))) return;
      target.replaceChildren();
      for(const entry of selectionTargets.filter(entry=>entry.id===clip.id))entry.render(detail);
      transformDetail={identity,detail};transformOverlay?.invalidate();syncViewerMasks();maskOverlay?.invalidate();
      curveWindow.setStatus('');
      visualControls.push(...renderProperties(target, detail, { writable: writable && !busy && !unresolved, getFrame: () => view.playhead, commit, reload: selected, notice, visualState, scope:`${state.project_epoch}:${state.timeline}:${clip.id}`,setKeyPage,keyEditorRoot:curveWindow.isOpen()?curveWindow.content:null,transitionDefaults:timeline.transition_defaults,compositing:false,transformControls:false,gainControls:false,titleControls:false,colorControls:false,filterControls:false,retimeControls:false,zoomLink,
        seek:frame=>{maskOverlay?.cancel();view.playhead=frame;syncPlayheadSelection(false);updateTime();seek();selected();void projectView?.update();},
        canNavigate:()=>identity===detailIdentity(inspectorState(clip.id)) && canNavigateInspector(),
        navigateSource:async(sourceFrame,{signal}={})=>{
          if(identity!==detailIdentity(inspectorState(clip.id)) || !canNavigateInspector())throw Error('The keyframe navigation context changed');
          const payload={query:{project_epoch:state.project_epoch,if_generation:state.generation,timeline_id:state.timeline,revision:state.revision,frame:inspectorFrame,width:960},source_frame:sourceFrame};
          return request(`/timelines/${encodeURIComponent(state.timeline)}/clips/${encodeURIComponent(clip.id)}/keyframe-navigation`,payload,(url,options)=>fetch(url,{...options,signal:AbortSignal.any([signal,AbortSignal.timeout(5000)].filter(Boolean))}));
        },
        readCurveViewport:async({target,source_start,source_end,points},{signal}={})=>{
          if(identity!==detailIdentity(inspectorState(clip.id)) || !canNavigateInspector())throw Error('The curve viewport context changed');
          const payload={query:{project_epoch:state.project_epoch,if_generation:state.generation,timeline_id:state.timeline,revision:state.revision,frame:inspectorFrame,width:960},target,source_start,source_end,points};
          return request(`/timelines/${encodeURIComponent(state.timeline)}/clips/${encodeURIComponent(clip.id)}/curve-viewport`,payload,(url,options)=>fetch(url,{...options,signal:AbortSignal.any([signal,AbortSignal.timeout(5000)].filter(Boolean))}));
        },
        maskCommit:commitMask,
        drawMaskPath:()=>{
          if(identity!==detailIdentity(inspectorState(clip.id)) || !canEditInspector())return;
          const context=currentViewerContext();if(!context || context.clip_id!==detail.clip_id){notice('Seek a current Program frame before drawing a path mask');return;}
          maskSelectionSequence++;if($("viewer-transform").getAttribute('aria-pressed')==='true')$("viewer-transform").click();maskOverlay?.startPen();
        },
        canInteract:()=>identity===detailIdentity(inspectorState(clip.id)) && canEditInspector() }));
      for(const child of target.children)if(!child.dataset.inspectorGroup)inspectorGroup(child,detail.video?'video':'audio');
    }).catch((error) => { if (inspectorSeq === inspectorSequence && identity===detailIdentity(inspectorState(clip.id))) {if(state.key_page && error.message.includes("beyond the last native key page")){visualState.set(`key-page:${state.project_epoch}:${state.timeline}:${clip.id}`,0);selected();}else{target.textContent = error.message;curveWindow.setStatus(error.message);for(const entry of selectionTargets.filter(entry=>entry.id===clip.id))if(entry.current())entry.target.textContent=error.message;}} });
  }
  if (clip){
    const metadata=selectionDetail('Clip metadata','selection-metadata'),values=document.createElement('dl');values.className='inspector-selection-metadata';metadata.append(values);
    for (const [label, value] of [
      ["Clip ID", clip.id],
      ["Start", clip.start_frame],
      ["Length", clip.length_frames],
      ["Source in", clip.source_in_frames ?? "—"],
      ["Source out", clip.source_out_frames ?? "—"],
    ]) {
      const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=String(value);values.append(term,description);
    }
  }
  if (clip && timeline.id !== "fixture") {
    const trim=selectionDetail('Trim selected primary clip','selection-trim');
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
      input.required=true;input.disabled = !canEditInspector();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const frame = Number(input.value);
        if (!canEditInspector())return;
        if (!String(input.value).trim() || !Number.isSafeInteger(frame) || !form.reportValidity()) {
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
      apply.disabled = !canEditInspector();
      form.append(row, apply);
      trim.append(form);
    }
  }
  if (timeline?.id !== "fixture" && timeline && documentState) {
    const actions=selectionDetail('Selection actions','selection-actions'),fieldset=document.createElement('fieldset'),buttons=document.createElement('div');fieldset.disabled=!canEditInspector();buttons.className='inspector-selection-buttons';actions.append(fieldset);fieldset.append(buttons);
    for (const [label, operation] of [
      ["Link", {kind:"link_clips",clip_ids:view.selection,unlink:false}],
      ["Unlink", {kind:"link_clips",clip_ids:view.selection,unlink:true}],
      ["Disable", {kind:"set_disabled",clip_ids:view.selection,disabled:true}],
      ["Enable", {kind:"set_disabled",clip_ids:view.selection,disabled:false}],
    ]) {
      const button = document.createElement("button"); button.type='button';button.textContent = label; button.disabled = !view.selection.length || label==='Link' && view.selection.length<2;
      button.addEventListener("click",()=>{if(canEditInspector())commit(operation).catch((error)=>notice(error.message));});buttons.append(button);
    }
    const slipDetails=selectionDetail('Slip selected clips','selection-slip',fieldset);
    const form = document.createElement("form"), label = document.createElement("label"); label.className = "field"; label.textContent = "Slip delta frames";
    const delta = document.createElement("input"); delta.type = "number"; delta.step = 1; delta.value = 1; delta.min = -1_000_000_000; delta.max = 1_000_000_000; label.append(delta);
    const slip = document.createElement("button"); slip.textContent = "Apply linked slip"; slip.disabled = !view.selection.length;
    delta.required=true;form.append(label,slip);form.addEventListener('submit',event=>{event.preventDefault();if(!canEditInspector() || !String(delta.value).trim() || !Number.isSafeInteger(Number(delta.value)) || !form.reportValidity())return;commit({kind:'slip',clip_ids:[...view.selection],delta_frames:Number(delta.value)}).catch(error=>notice(error.message));});slipDetails.append(form);
    const previewSlip=document.createElement("button");previewSlip.type="button";previewSlip.textContent="Preview slip edges";previewSlip.disabled=!view.selection.length;previewSlip.addEventListener("click",()=>{if(!canEditInspector() || !String(delta.value).trim() || !Number.isSafeInteger(Number(delta.value)) || !form.reportValidity())return;const selected=timeline.tracks.flatMap((track)=>track.clips.map((clip)=>({track,clip}))).find(({track,clip})=>view.selection.includes(clip.id) && track.kind==="video")?.clip || clip;if(selected)slipView?.open(selected.id,Number(delta.value));});slipDetails.append(previewSlip);
    const compoundDetails=selectionDetail('Make compound clip','selection-compound',fieldset);
    const compound=document.createElement("form"),compoundLabel=document.createElement("label");compoundLabel.className="field";compoundLabel.textContent="Compound name";
    const name=document.createElement("input");name.value="Compound";name.required=true;name.maxLength=128;compoundLabel.append(name);
    const grouping=document.createElement('select');grouping.setAttribute('aria-label','Compound grouping');grouping.append(new Option('Native grouping','native'),new Option('Keep track audio mix','keep_track_audio_mix'));grouping.value='native';
    const groupingNote=document.createElement('p');groupingNote.className='muted';
    const explainGrouping=()=>{groupingNote.textContent=grouping.value==='native'?'Native grouping inherits the lowest selected audio host bus and resets child track buses. Routing, normalization and compositing context can change. Undo restores the original clips.':'Keep track audio mix preserves supported track settings using a neutral audio wrapper. Unsupported mixing or compositing contexts are refused; Undo restores the original clips.';};explainGrouping();grouping.addEventListener('change',explainGrouping);
    const make=document.createElement("button");make.textContent="Make compound from selection";
    const compoundContext=JSON.stringify([documentState.project_epoch,documentState.generation,timeline.id,timeline.revision,[...view.selection].sort()]),compoundIds=[...view.selection],compoundEpoch=documentState.project_epoch,compoundTimeline=timeline.id;
    let compoundWaiting=false,compoundUnknown=false;
    const compoundCurrent=()=>compound.isConnected!==false && canEditInspector() && JSON.stringify([documentState?.project_epoch,documentState?.generation,timeline?.id,timeline?.revision,[...view.selection].sort()])===compoundContext;
    const syncCompound=()=>{for(const control of [make,name,grouping])control.disabled=compoundWaiting || compoundUnknown || !compoundIds.length || !compoundCurrent();};syncCompound();compound.append(compoundLabel,grouping,groupingNote,make);
    compound.addEventListener("submit",async(event)=>{
      event.preventDefault();if(compoundWaiting || compoundUnknown)return;
      if(!compoundCurrent()){notice('The compound selection changed; select its current clips again');return;}
      if(!compound.reportValidity())return;
      try{
        const operation=compoundSelectionOperation(compoundIds,name.value,grouping.value);compoundWaiting=true;syncCompound();
        await Promise.resolve();if(!compoundCurrent())throw Error('The compound selection changed; select its current clips again');
        await commit(operation);
        if(documentState?.project_epoch===compoundEpoch && timeline?.id===compoundTimeline && (!view.selection.length || JSON.stringify([...view.selection].sort())===JSON.stringify([...compoundIds].sort()))){view.selection=[];view.selectionAnchor=null;selected();canvasTimeline.invalidate();}
      }catch(error){if(error.code==='OUTCOME_UNKNOWN')compoundUnknown=true;notice(error.message);}finally{compoundWaiting=false;syncCompound();}
    });compoundDetails.append(compound);syncCompound();
    const markerTarget=`${documentState.project_epoch}:${timeline.id}`;
    renderMarkers($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,getFrame:()=>view.playhead,commit,notice,selectedId:view.markerTarget===markerTarget?view.markerId:null,onSelect:id=>{view.markerTarget=markerTarget;view.markerId=id;},openState:visualState,seek:(frame)=>{view.playhead=frame;syncPlayheadSelection(false);updateTime();seek();selected();void projectView?.update();}});
    const mixQuery = new URLSearchParams({project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0});
    const commitEffects=(operation,edit)=>{
      const query=Object.fromEntries(mixQuery),channel=operation.channel==='master'?timeline?.master:timeline?.tracks.find(track=>track.id===operation.channel)?.mix;
      if(!channel || query.project_epoch!==documentState?.project_epoch || query.if_generation!==documentState?.generation || query.timeline_id!==timeline?.id || query.revision!==timeline?.revision)throw Error('The native insert context changed');
      const callbacks=mixerEditors.begin(query,operation.channel,channel.effects,edit);
      if(!callbacks || JSON.stringify(callbacks.effects)!==JSON.stringify(operation.effects))throw Error('The native insert edit changed');
      return mutate(operation,false,null,null,null,callbacks).catch(error=>{callbacks.onError(error);if(!error.code)selected();throw error;});
    };
    mixerDetail=renderMixer($("inspector-content"),timeline,{writable:writable && !busy && !unresolved,commit,commitEffects,notice,open:mixerOpen,mixDrafts:mixerMixDrafts,catalog:documentState.audio_effects,openPaths:mixerPaths,query:mixQuery,onMeters:()=>audioMeters?.open(),meters:{subscribe:options=>audioMeters?.subscribe(options),sync:()=>audioMeters?.sync(),visible:()=>!document.hidden && editor.dataset.workspace==='Audio' && $('inspector').dataset.inspectorTab==='audio' && viewerMode==='program'},audioPresets:{getContext:()=>({project_epoch:documentState?.project_epoch,generation:documentState?.generation,timeline_id:timeline?.id,timeline_revision:timeline?.revision}),canCommit:()=>writable && !busy && !unresolved && !document.querySelector('dialog[open]'),libraryCommit:operation=>mutate(operation,true,'/audio/presets/commands')}});
    inspectorGroup(mixerDetail,'audio');
  }
  for(const child of $('inspector-content').children)if(!child.dataset.inspectorGroup && !child.dataset.inspectorCommon)inspectorGroup(child,'selection');
  if($('inspector').dataset.inspectorTab==='selection')inspectorSelectionRead?.read();
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
  getAssetContext:presetContext,
  getGapContext:()=>documentState?{project_epoch:documentState.project_epoch,generation:documentState.generation}:null,
  canNavigate:()=>!busy && !unresolved,
  onOpenCompound:ids=>compoundNavigation?.enter(ids),
  onNavigationIntent:()=>{nativePlacementIntent++;compoundNavigation?.cancel();},
  onNavigationStateChange:()=>{timelineContextMenu?.invalidate();compoundNavigation?.invalidate();syncClipboardControls();syncSelectionActions();sourceAssets?.refresh();timelineWaveforms?.refresh();sourcePlacement?.refresh();queueMicrotask(syncProgramMarks);},
  view,
  getAssets: () => mediaAssets,
  getWaveforms: () => timelineWaveforms?.presentations() ?? new Map(),
  onPaint:(_duration,demand)=>{if(documentState && timeline?.id===demand?.timeline_id && timeline?.revision===demand.revision){sourceAssets?.demand('timeline',assetDemandItems(demand.items),documentState.project_epoch);timelineWaveforms?.demand(demand.waveform_clip_ids);}},
  getCache: () => previewCache?.ranges(),
  onSelect: ()=>{view.transitionSelection=null;selected();},
  onTransitionSelect:selection=>{view.transitionSelection=selection;view.selection=[];view.selectionAnchor=null;view.markerId=null;revealInspector();selected();},
  onRetimeMenu:target=>retimeMenu?.open(target),
  onContextMenu:target=>openTimelineContextMenu(target),
  onRetimeVisibilityChange:updateRetimeControls,
  onSeek: (final) => {
    audioMeters?.invalidate();
    audioScrub?.stop();
    programPlayer?.pauseLocal();
    scopes?.invalidate("STALE · scrubbing");
    syncPlayheadSelection(false);
    updateTime();
    if (final) { seek(); selected(); audioScrub?.request();void projectView?.update(); }
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
function timelineContext(target){
  if(!timeline || !documentState)return null;
  const rect=$('timeline').getBoundingClientRect();
  return buildTimelineContext({document:documentState,timeline,selection:view.selection,target,playhead:view.playhead,
    writable:writable && !busy && !unresolved && !view.recording && canvasTimeline.navigationIdle(),
    viewIdentity:JSON.stringify([viewerMode,view.origin,view.scale,view.scrollY,view.videoScroll,view.audioScroll,view.videoPaneHeight,view.rowHeight,view.tool,view.snap,view.transitionSelection,view.selectedGap,rect.left,rect.top,rect.width,rect.height]),
    retimeVisible:[...view.retimeVisible].sort(),overwrite:view.retimeOverwrite});
}
function pauseTimelineContextPlayback(){fastTransport?.stop();audioScrub?.stop();programPlayer?.pauseLocal();updatePlayAvailability();}
function openTimelineContextMenu(target){
  timelineContextOpenSequence++;
  if(document.querySelector('dialog[open]') || view.recording || busy || unresolved || !canvasTimeline.navigationIdle())return false;
  pauseTimelineContextPlayback();
  retimeMenu?.close(false);return timelineContextMenu?.open(target) ?? false;
}
function contextOwnerCurrent(owner){
  return Boolean(owner && documentState && timeline && writable && !busy && !unresolved && !view.recording &&
    owner.project_epoch===documentState.project_epoch && owner.generation===documentState.generation && owner.timeline_id===timeline.id && owner.revision===timeline.revision &&
    owner.playhead===view.playhead && JSON.stringify(owner.selection)===JSON.stringify(timeline.tracks.flatMap(track=>track.clips.filter(clip=>view.selection.includes(clip.id)).map(clip=>clip.id))));
}
function openTimelineSilence(owner=null){contextSilence=owner;silencePanel?.open();}
function contextBrowser(name){
  presetPanel?.hide();nativeAssets?.hide();void sharedLibrary?.cancel();revealBrowser(name);editor.classList.remove('browser-collapsed');if(innerWidth<=760)editor.classList.add('browser-drawer-open');
  $('browser').dataset.browserPanel=name;for(const button of document.querySelectorAll('[data-panel]'))button.setAttribute('aria-selected',String(button.dataset.panel===name));
  $('media-list').hidden=name!=='Media';$('search').parentElement.hidden=name!=='Media';$('panel-content').hidden=name==='Media';$('panel-content').replaceChildren();updateBrowserToggle();
}
function contextModal(title,owner){
  contextDialog?.close();const dialog=document.createElement('dialog'),heading=document.createElement('h2'),content=document.createElement('div'),status=document.createElement('p'),cancel=document.createElement('button');
  heading.textContent=title;status.setAttribute('role','status');cancel.type='button';cancel.textContent='Cancel';dialog.setAttribute('aria-label',title);dialog.append(heading,content,status,cancel);document.body.append(dialog);contextDialog=dialog;
  cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(contextDialog===dialog)contextDialog=null;dialog.remove();});
  const current=()=>dialog.isConnected && dialog.open && contextOwnerCurrent(owner);
  const apply=async operation=>{if(!current())throw Error('The timeline action context changed; reopen its menu');await commit(operation);dialog.close();};
  dialog.showModal();return {dialog,content,status,current,apply};
}
async function timelineContextAction(action,owner){
  if(timelineContext(owner.target)?.identity!==owner.identity)throw Error('The timeline menu context changed');
  const operation=timelineContextOperation(action,owner);
  if(operation)return commit(operation);
  if(action==='reveal_media'){contextBrowser('Media');revealProjectMedia([owner.clicked.media_id]);return;}
  if(action==='retime_visibility'){
    for(const id of owner.media_ids){if(owner.retime_shown)view.retimeVisible.delete(id);else view.retimeVisible.add(id);}updateRetimeControls();return;
  }
  if(action==='copy'){clipboardCommand('timeline','copy');return;}
  if(action==='paste_attributes'){pasteAttributes?.open();return;}
  if(action==='save_preset'){
    const source={epoch:owner.project_epoch,generation:owner.generation,timeline:owner.timeline_id,revision:owner.revision,clip_ids:[...owner.save_ids],name:owner.clicked.name,roles:owner.roles};
    contextBrowser('Presets');
    await presetPanel.open();if(!contextOwnerCurrent(owner))throw Error('The preset source changed; open Save preset again');presetPanel.saveSelection(source);return;
  }
  if(action==='remove_silence'){openTimelineSilence(owner);return;}
  if(action==='compound'){
    const ui=contextModal('Make compound clip',owner),form=document.createElement('form'),label=document.createElement('label'),name=document.createElement('input'),note=document.createElement('p'),button=document.createElement('button');
    label.textContent='Compound name';name.value='Compound';name.required=true;name.maxLength=128;name.setAttribute('aria-label','Compound name');label.append(name);button.textContent='Make native compound';
    note.textContent=`${owner.compound_ids.length} clips · Native grouping can change routing, normalization and compositing context. Undo restores the original clips.`;form.append(label,note,button);ui.content.append(form);
    let waiting=false;form.addEventListener('submit',async event=>{event.preventDefault();if(waiting || !form.reportValidity())return;waiting=true;button.disabled=true;try{await ui.apply(compoundSelectionOperation(owner.compound_ids,name.value,'native'));}catch(error){ui.status.textContent=error.message;}finally{waiting=false;button.disabled=!ui.current();}});name.focus();return;
  }
  if(action==='edit_marker'){
    const ui=contextModal('Edit marker',owner),form=document.createElement('form'),label=document.createElement('label'),note=document.createElement('input'),color=document.createElement('select'),button=document.createElement('button');
    label.textContent='Marker note';note.value=owner.marker.note;note.maxLength=4096;note.setAttribute('aria-label','Marker note');label.append(note);color.setAttribute('aria-label','Marker color');
    for(const value of owner.colors)color.append(new Option(value,value));color.value=owner.marker.color;button.textContent='Apply marker';form.append(label,color,button);ui.content.append(form);
    let waiting=false;form.addEventListener('submit',async event=>{event.preventDefault();if(waiting || !ui.current() || !form.reportValidity())return;if(note.value===owner.marker.note && color.value===owner.marker.color){ui.dialog.close();return;}waiting=true;button.disabled=true;try{await ui.apply({kind:'set_marker',marker:{id:owner.marker.id,delete:false,start_frame:owner.marker.start_frame,duration_frames:owner.marker.duration_frames,note:note.value,color:color.value}});}catch(error){ui.status.textContent=error.message;}finally{waiting=false;button.disabled=!ui.current();}});note.focus();return;
  }
  if(action==='advanced_speed'){
    const id=owner.media_ids[0],query=new URLSearchParams({project_epoch:owner.project_epoch,if_generation:owner.generation,timeline_id:owner.timeline_id,revision:owner.revision,frame:owner.playhead}),detail=await request(`/timelines/${encodeURIComponent(owner.timeline_id)}/clips/${encodeURIComponent(id)}/keys/0?${query}`);
    if(!contextOwnerCurrent(owner) || document.querySelector('dialog[open]'))throw Error('The media speed context changed; reopen its menu');
    const ui=contextModal('Change clip speed',owner),selection={project_epoch:owner.project_epoch,generation:owner.generation,timeline_id:owner.timeline_id,revision:owner.revision,clip_ids:[...owner.media_ids]};
    const retime=renderRetime(ui.content,detail,false,()=>view.playhead,ui.apply,new Map([['retime',true]]),ui.current,{selection,getSelection:()=>ui.current()?selection:null,frame:owner.playhead,labelControls:false,cancelButton:false,notice:message=>{ui.status.textContent=message;}});
    ui.dialog.addEventListener('close',()=>retime?.dispose(),{once:true});return;
  }
}
timelineContextMenu=createTimelineContextMenu({getContext:target=>document.querySelector('dialog[open]')?null:timelineContext(target),getItems:timelineContextItems,onAction:timelineContextAction,notice});
function renderTransitionPresets(){
  const root=$("transition-presets");if(!root)return;root.replaceChildren();
  const heading=document.createElement('h3');heading.textContent='Transitions';heading.title='Drag onto a video clip edge. Touching clips create a crossing. Click to open Inspector Transitions for keyboard editing.';root.append(heading);
  const defaults=Array.isArray(timeline?.transition_defaults)?timeline.transition_defaults:[];
  for(const preset of defaults){
    const button=document.createElement('button');button.type='button';button.textContent=`${preset.kind.replace(/([a-z])([A-Z])/g,'$1 $2')} · ${preset.duration}f`;button.setAttribute('aria-label',`Drag ${preset.kind} · ${preset.duration}f`);button.draggable=true;button.disabled=!writable || busy || Boolean(unresolved);button.title='Drag onto an eligible video edge, or click for Inspector Transitions';
    button.addEventListener('dragstart',event=>{if(!event.dataTransfer || !canvasTimeline.transitionDnd?.start(preset.kind)){event.preventDefault();return;}event.dataTransfer.setData(canvasTimeline.transitionDnd.type,preset.kind);event.dataTransfer.effectAllowed='copy';});
    button.addEventListener('dragend',()=>canvasTimeline.transitionDnd?.end());
    button.addEventListener('click',()=>{revealInspector();const section=document.querySelector('[data-visual-path="transitions"]');if(section){section.open=true;section.scrollIntoView({block:'nearest'});}else notice('Select a video clip to create a transition with the Inspector');});root.append(button);
  }
  if(!defaults.length){const pending=document.createElement('p');pending.textContent='Open a native timeline to read transition defaults';root.append(pending);}
}
window.addEventListener("blur",()=>{for(const control of visualControls)control.cancel();});
function updateTime() {
  timelineContextMenu?.invalidate();
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
  const total=programMarkTotal(),slider=$('program-position');slider.max=Math.max(0,total-1);slider.disabled=total<=0;slider.value=Math.min(Number(slider.max),view.playhead);
  $('viewer-caption').textContent=timeline?.name || 'Program';
  const revealKey=JSON.stringify([timeline?.id,view.playhead]);if(timeline && lastReveal!==revealKey && canvasTimeline.navigationIdle()){view.origin=timelineOriginForFrame(timeline,view,$('timeline').clientWidth,view.playhead);lastReveal=revealKey;}
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
      const openMenu=event=>{
        if(documentState?.project_epoch!==gapEpoch || documentState?.generation!==gapGeneration || timeline!==next || document.hidden || document.querySelector('dialog[open]') || view.recording || busy || unresolved || !canvasTimeline.navigationIdle())return;
        event.preventDefault();event.stopPropagation();pauseTimelineContextPlayback();
        const rect=button.getBoundingClientRect(),owner=++timelineContextOpenSequence,selection=JSON.stringify(view.selection),head=view.playhead,revision=next.revision;
        const target={kind:'clip',clip_id:clip.id,track_id:track.id,frame:head,clientX:event.type==='contextmenu' && event.clientX?event.clientX:rect.left,clientY:event.type==='contextmenu' && event.clientY?event.clientY:rect.bottom,returnFocus:$('timeline')};
        clipListDismissal.close();
        requestAnimationFrame(()=>{
          if(owner!==timelineContextOpenSequence || document.hidden || documentState?.project_epoch!==gapEpoch || documentState?.generation!==gapGeneration || timeline!==next || next.revision!==revision || view.playhead!==head || JSON.stringify(view.selection)!==selection)return;
          canvasTimeline.openContextMenu(target);
        });
      };
      button.addEventListener('contextmenu',openMenu);button.addEventListener('keydown',event=>{if(isTimelineContextShortcut(event))openMenu(event);});
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
  retimeMenu?.invalidate();$("retime-handles").setAttribute('aria-pressed',String(state.pressed));$("retime-handles").disabled=state.disabled;$("retime-overwrite").disabled=!timeline || !writable || busy || Boolean(unresolved);$("retime-overwrite").checked=view.retimeOverwrite;canvasTimeline.invalidate();
}
$("retime-handles").addEventListener('click',()=>{
  const state=retimeVisibilityState(timeline,view.selection,view.retimeVisible);
  if(state.disabled)return;
  canvasTimeline.cancel();view.retimeVisible=toggleRetimeVisibility(timeline,view.selection,view.retimeVisible);updateRetimeControls();
  notice(state.pressed?'Speed strips hidden for the selected media clips; other clips keep their controls':'Speed strips shown for the selected media clips · click for presets or press Shift+F10; drag endpoints to resize · overlaps require Overwrite clips');
});
$("retime-handles").addEventListener('keydown',event=>{if(event.key===' ' || event.key==='Enter')event.stopPropagation();});
$("retime-overwrite").addEventListener('change',()=>{
  canvasTimeline.cancel();view.retimeOverwrite=$("retime-overwrite").checked;updateRetimeControls();notice(view.retimeOverwrite?'Timeline overwrite enabled · trim, Alt-duplicate, speed and Library asset drags may replace overlapping clips; Undo restores them':'Timeline drags refuse overlaps');
});
document.addEventListener('keydown',event=>{if(isRetimeShortcut(event,{dialogOpen:Boolean(document.querySelector('dialog[open]'))})){event.preventDefault();event.stopPropagation();$("retime-handles").click();}});
$("edit-tool").addEventListener("change",()=>{canvasTimeline.cancel();view.tool=$("edit-tool").value;slipView?.reset();notice(view.tool === "slip" ? "Slip tool · drag right to advance source; linked clips follow" : "Move / trim tool");});
for (const [id, factor] of [
  ["zoom-in", 1.4],
  ["zoom-out", 1 / 1.4],
])
  $(id).addEventListener("click", () => {
    view.scale = Math.max(MIN_TIMELINE_SCALE, Math.min(MAX_TIMELINE_SCALE, view.scale * factor));
    view.origin=Math.min(view.origin,timelineScrollBounds(timeline,view,$("timeline").clientWidth).maxOrigin);
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
  view.scale=Math.max(MIN_TIMELINE_SCALE,Math.min(MAX_TIMELINE_SCALE,view.scale));
  canvasTimeline.invalidate();
});
function step(delta) {
  if (viewerMode === "source") {
    const media = currentSourceItem();
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
  void projectView?.update();
}
$('program-position').addEventListener('pointerdown',()=>{fastTransport?.stop();programPlayer?.stop();audioScrub?.stop();});
$('program-position').addEventListener('input',()=>{view.playhead=Number($('program-position').value);updateTime();});
$('program-position').addEventListener('change',()=>{syncPlayheadSelection(false);void seek();selected();void projectView?.update();});
$("step-back").addEventListener("click", () => step(-1));
$("step-forward").addEventListener("click", () => step(1));
document.addEventListener("keydown", (event) => {
  if (!globalEditingShortcut(event,{allowRepeat:true})) return;
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
projectView=createProjectView({
  getState:()=>({document:documentState,timeline,frame:view.playhead,ancestors:(compoundNavigation?.state().ancestors || []).map(item=>({...item,revision:documentState?.timelines.find(parent=>parent.id===item.timeline_id)?.revision})),client_id:clientId,writable:writable && !busy && !unresolved,stopped:!view.recording && (!programPlayer || programPlayer.state()!=='preparing' && $("program-video").paused && !fastTransport?.active())}),
  onView:value=>{if(documentState){documentState.view=value.view;documentState.view_revision=value.view_revision;if(value.persistence_notice)$("project-persistence-notice").textContent=value.persistence_notice;}},
  notice,
});
function resetTimelineViewport(frame=0){
  view.playhead=frame;view.scale=60;view.origin=0;view.scrollY=0;view.videoScroll=0;view.audioScroll=0;view.videoPaneHeight=null;view.rowHeight=62;view.selection=[];view.selectionAnchor=null;view.transitionSelection=null;view.selectedGap=null;
}
compoundNavigation=createCompoundNavigation({
  root:$("compound-breadcrumb"),openButton:$("open-compound"),notice,
  getState:()=>({document:documentState,timeline,frame:view.playhead,selection:[...view.selection],viewport:{scale:view.scale,origin:view.origin,scrollY:view.scrollY,videoScroll:view.videoScroll,audioScroll:view.audioScroll,videoPaneHeight:view.videoPaneHeight,rowHeight:view.rowHeight,selection:[...view.selection],selectionAnchor:view.selectionAnchor}}),
  canNavigate:()=>!busy && !unresolved && canvasTimeline.navigationIdle() && !document.querySelector('dialog[open]'),
  stop:()=>{fastTransport?.stop();audioScrub?.stop();programPlayer?.stop();sourcePlayer?.pause();sourceAssets?.cancelSource();slipView?.reset();viewer?.invalidate();},
  beforeNavigate:()=>projectView.flush(),
  install:(next,frame)=>{
    resetTimelineViewport(frame);
    installTimeline(next);
    $("timeline-select").value=next.id;$("revision").textContent=`Revision ${next.revision.slice(0,8)}`;viewerModeSet('program');selected();canvasTimeline.invalidate();
    queueMicrotask(()=>void projectView.update());
  },
});
$("open-compound").addEventListener('click',()=>compoundNavigation.enter());
document.addEventListener('toggle',()=>compoundNavigation.invalidate(),true);
document.addEventListener('keydown',event=>{
  if(timelineContextMenu?.active())return;
  if(event.target.closest?.('[data-key-editor-window]'))return;
  const action=compoundNavigationAction(event,{dialogOpen:Boolean(document.querySelector('dialog[open]')),idle:!busy && !unresolved && canvasTimeline.navigationIdle(),hasAncestors:compoundNavigation.state().ancestors.length>0});
  if(!action)return;
  if(action==='enter' && $("open-compound").disabled)return;
  event.preventDefault();event.stopImmediatePropagation();if(action==='enter')compoundNavigation.enter();else if(action==='exit')compoundNavigation.exit();
},true);
async function openTimelineRoot(next){
  const epoch=documentState?.project_epoch,intent=++timelineOpenSequence;
  programPlayer?.stop();await projectView?.flush();
  if(intent!==timelineOpenSequence || busy || unresolved || documentState?.project_epoch!==epoch || !documentState?.timelines.includes(next))return;
  compoundNavigation?.reset();sourcePlayer?.pause();viewer?.invalidate();resetTimelineViewport(projectView.frame(next.id));$("timeline-select").value=next.id;installTimeline(next);viewerModeSet('program');compoundNavigation?.invalidate();void projectView.update();
}
async function refresh({preserveAudioDrafts=false}={}) {
  const invalidateTimeline=()=>{
    compoundNavigation?.cancel();fastTransport?.stop();audioScrub?.stop();
    slipView?.reset();programPlayer?.stop();viewer?.invalidate();
  };
  if(!preserveAudioDrafts)invalidateTimeline();
  const next = await request("/session");
  if(timelineAction && !timelineAction.committing && !timelineActionCurrent(timelineAction,next))$('timeline-action-error').textContent='The project or target timeline changed. Close this dialog and try again.';
  if(newTimelineOwner && !newTimelineOwner.committing && !catalogOwnerCurrent(newTimelineOwner,next))$('timeline-error').textContent='The project changed. Close this dialog and try again.';
  const projectChanged=documentState?.project_epoch!==next.project_epoch;
  if(preserveAudioDrafts && writable && !unresolved && canRetainAudioPresetDraft(documentState,next,timeline?.id)) {
    documentState=next;timeline=next.timelines.find(item=>item.id===timeline.id);
    $("project-persistence-notice").textContent=next.persistence_notice || "";
    recoveryPanel?.update(next.autosave);
    $("connection").textContent="Connected · writer";
    mediaImport?.invalidate();mediaRelink?.invalidate();otioImport?.invalidate();syncClipboardControls();
    return;
  }
  if(preserveAudioDrafts)invalidateTimeline();
  const sourceChanged=(id)=>documentState?.media.find((item)=>item.id===id)?.content_hash !== next.media.find((item)=>item.id===id)?.content_hash;
  for(const [key,asset] of mediaAssets)if(sourceChanged(asset.mediaId)){releaseMediaAsset(asset);mediaAssets.delete(key);}
  const librarySourceCurrent=Boolean(sourceLibraryItem && sourceLibraryItem.epoch===next.project_epoch);
  if(sourcePreviewAttempt && (sourcePreviewAttempt.epoch!==next.project_epoch || sourcePreviewAttempt.generation!==next.generation))cancelSourcePreview();
  if(sourceOpenId && !librarySourceCurrent && (!next.media.some(item=>item.id===sourceOpenId) || sourceChanged(sourceOpenId))){sourcePlayer?.reset();sourceAssets?.cancel();sourceRanges.delete(sourceOpenId);sourceOpenId=null;clearLibrarySource();}
  view.retimeVisible=retimeProjectVisibility(documentState?.project_epoch,next.project_epoch,view.retimeVisible);
  if (documentState?.project_epoch !== next.project_epoch) {
    if(clipboardOverwrite)clipboardOverwrite.checked=false;
    canvasTimeline.cancel();view.retime=false;view.retimeOverwrite=false;view.transitionSelection=null;view.transitionReplace=false;$("transition-replace").checked=false;updateRetimeControls();
    sourcePlayer?.reset();
    sourceAssets?.cancel();
    sourceOpenId = null; clearLibrarySource();cancelSourcePreview();sourceRanges.clear();sourceWaveformBinding=null;
    resetTimelineViewport();
    selectedMedia = null;
    mediaState.selected=[];mediaState.anchor=null;mediaState.folder="*";mediaState.expanded=[];mediaState.gridFolder=null;mediaState.selectedFolder=null;
    for (const asset of mediaAssets.values()) releaseMediaAsset(asset);
    mediaAssets.clear();
    nativeThumbnailDemand={epoch:null,items:[]};
    viewerModeSet("program");
  }
  const previousId = projectChanged ? null : timeline?.id,
    selection = view.selection,selectionAnchor=view.selectionAnchor,transitionSelection=view.transitionSelection;
  documentState = next;
  projectView.refresh();
  compoundNavigation?.invalidate();
  $("play").disabled = viewerMode === "program" && !next.capabilities.playback;
  $("timeline-select").replaceChildren(
    ...next.timelines.map((t) => new Option(t.name, t.id)),
  );
  const active =
    next.timelines.find((t) => t.id === (projectChanged?projectView.activeTimeline():previousId)) || next.timelines[0];
  if (active) {
    if(projectChanged)view.playhead=projectView.frame(active.id);
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
  catalog=renderCatalog($("media-list"),next,mediaState,{writable:writable && !busy && !unresolved,assets:mediaAssets,commit:async(operation)=>{const receipt=await mutate(operation,true);if(catalog?.acceptReceipt(receipt))$('search').value=mediaState.query || '';return receipt;},getFiles:async()=> (await request("/projects")).importable_media,onSelection:(id,_ids,{userIntent=false}={})=>{if(userIntent)nativePlacementIntent++;selectedMedia=id;nativeAssets?.invalidate();libraryCaptureDrop?.invalidate();syncClipboardControls();syncSelectionActions();},onOpen:(id)=>{selectedMedia=id;openSource();},onDragStart:startProjectPoolDrag,onDragEnd:()=>{canvasTimeline.projectPoolDnd.end();libraryCaptureDrop?.end();},onRelink:openMediaRelink,onAction:action=>catalogAction(action,next),proxyStatus:id=>proxySettings?.enabled?proxyControls?.statusFor(id):null,onPresentationChange:({layout})=>{try{localStorage.setItem('venturi-media-pool-layout',layout);}catch{}},onDemand:items=>{if(documentState===next)sourceAssets?.demand('pool',assetDemandItems(items),next.project_epoch);},notice});
  paintProxyBadges();void proxyControls?.refresh();
  nativeAssets?.invalidate();libraryCaptureDrop?.invalidate();
  sourcePlacement?.refresh();
  refreshSourceWaveform();
  mediaImport?.invalidate();mediaRelink?.invalidate();otioImport?.invalidate();syncClipboardControls();
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
async function mutate(operation, project = false,route=null,preparedMutation=null,targetTimeline=null,mixerCallbacks=null) {
  const libraryOnly=operation.kind==='edit_audio_preset_library';
  const requestEpoch=documentState?.project_epoch;
  if(!libraryOnly){fastTransport?.stop();audioScrub?.stop();}
  if (!writable || busy || unresolved)
    throw new Error("Editing is read only or a command is pending");
  if(!libraryOnly){programPlayer?.stop();slipView?.reset();}
  if(['save','save_as','open_project','new_project','recover_backup','recover_autosave','import_otio'].includes(operation.kind))await projectView?.flush({persist:!['save','save_as'].includes(operation.kind)});
  if(!writable || busy || unresolved)throw new Error("Editing is read only or a command is pending");
  if(documentState?.project_epoch!==requestEpoch)throw new Error("The project changed before this command could start");
  if(targetTimeline && (project || !timelineActionCurrent(targetTimeline)))throw new Error('The project or target timeline changed before this command could start');
  if (!project && !targetTimeline && (!timeline || timeline.id === "fixture"))
    throw new Error("Open a real project before editing");
  if(preparedMutation && (route!=='/native-assets/commands' || !project || operation.kind!=='edit_native_asset_library' || preparedMutation.client_id!==clientId || preparedMutation.command_epoch!==documentState.command_epoch || preparedMutation.project_epoch!==documentState.project_epoch || preparedMutation.if_generation!==documentState.generation || preparedMutation.if_revision!==null || typeof preparedMutation.command_id!=='string' || !preparedMutation.command_id || JSON.stringify(preparedMutation.operation)!==JSON.stringify(operation)))throw new Error('The prepared native library command is stale; refresh before relinking');
  const body = preparedMutation?structuredClone(preparedMutation):{
    command_id: crypto.randomUUID(),
    client_id: clientId,
    command_epoch: documentState.command_epoch,
    project_epoch: documentState.project_epoch,
    if_generation: documentState.generation,
    if_revision: project ? null : targetTimeline?.revision ?? timeline.revision,
    operation,
  };
  busy = true;
  cancelInspectorDraft();
  timelineContextMenu?.invalidate();
  compoundNavigation?.invalidate();
  nativeAssets?.invalidate();libraryCaptureDrop?.invalidate();
  mediaImport?.invalidate();mediaRelink?.invalidate();otioImport?.invalidate();syncClipboardControls();
  notice("Applying command…");
  try {
    const receipt = await sendMutation(
      route || (project
        ? "/projects/commands"
        : `/timelines/${encodeURIComponent(targetTimeline?.timeline_id ?? timeline.id)}/commands`),
      body,
    );
    if(!notifyMixerMutation(mixerCallbacks,'onReceipt',receipt,body))mixerEditors.reset();
    notice(commandNotice(receipt));
    return receipt;
  } catch (error) {
    if(!notifyMixerMutation(mixerCallbacks,'onError',error,body))mixerEditors.reset();
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
  if(!timeline || !documentState || !writable || busy || unresolved)return;
  const length=Math.round(timeline.fps.num/timeline.fps.den*5);
  const track=timeline.tracks.find(track=>track.kind==='video' && !track.locked && !track.clips.some(clip=>clip.start_frame<view.playhead+length && clip.start_frame+clip.length_frames>view.playhead));
  run({kind:'place_generator',generator,start_frame:view.playhead,target:track?{kind:'track',track_id:track.id}:{kind:'new_video_track'},overwrite:false});
}
function bindPaletteDrag(button,entry){
  button.draggable=true;button.title='Drag to a timeline destination; click uses the current selection or playhead';
  button.addEventListener('dragstart',event=>{
    if(!event.dataTransfer || !documentState || !writable || busy || unresolved){event.preventDefault();return;}
    fastTransport?.stop();audioScrub?.stop();programPlayer?.stop();sourcePlayer?.pause();
    const item=effectDragItem(documentState,entry);
    const current=()=>button.isConnected!==false && $('browser').dataset.browserPanel==='Effects' && documentState?.project_epoch===item?.project_epoch && documentState?.generation===item?.generation && writable && !busy && !unresolved;
    const payload=canvasTimeline.effectDnd.start([item],current,async(draft,isCurrent)=>{
      if(isCurrent())await commit(effectPlacementOperation(draft));
    });
    if(!payload){event.preventDefault();return;}
    event.dataTransfer.setData(canvasTimeline.effectDnd.type,payload);event.dataTransfer.effectAllowed='copy';
  });
  button.addEventListener('dragend',()=>canvasTimeline.effectDnd.end());
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
function catalogOwnerCurrent(owner,state=documentState){return Boolean(owner && state && owner.project_epoch===state.project_epoch && owner.generation===state.generation);}
function timelineActionCurrent(owner,state=documentState){
  const target=state?.timelines.find(item=>item.id===owner?.timeline_id);
  return Boolean(target && catalogOwnerCurrent(owner,state) && target.revision===owner.revision && state.media.some(item=>item.id===owner.media_id && item.compound_timeline_id===target.id));
}
function timelineActionOwner(kind,id,state=documentState,mediaId=null){
  const target=state?.timelines.find(item=>item.id===id),media=state?.media.find(item=>item.compound_timeline_id===id && (mediaId===null || item.id===mediaId));
  if(!target || !media)throw Error('The selected native timeline is unavailable');
  return {kind,project_epoch:state.project_epoch,generation:state.generation,timeline_id:id,revision:target.revision,media_id:media.id,media_ids:state.media.map(item=>item.id),name:target.name,committing:false};
}
function openNewTimeline(){
  if(!writable || busy || unresolved || !documentState?.project_name)return notice('Open a project with a connected writer first');
  newTimelineOwner={project_epoch:documentState.project_epoch,generation:documentState.generation,committing:false};
  $('palette').close();$('timeline-error').textContent='';$('new-timeline-dialog').showModal();
}
function timelineCopyName(owner){
  const taken=new Set(documentState.media.filter(item=>item.compound_timeline_id).map(item=>item.name));
  for(let suffix=1;;suffix++){
    const ending=` copy${suffix===1?'':` ${suffix}`}`,base=Array.from(owner.name);
    while(new TextEncoder().encode(base.join('')+ending).length>128)base.pop();
    const candidate=base.join('')+ending;if(!taken.has(candidate))return candidate;
  }
}
function openTimelineAction(owner){
  if(!writable || busy || unresolved)throw Error('A connected writer is required for timeline actions');
  if(!timelineActionCurrent(owner))throw Error('The selected timeline changed; refresh before editing');
  timelineAction=owner;$('palette').close();$('timeline-action-error').textContent='';
  $('timeline-action-title').textContent=owner.kind==='duplicate_timeline'?'Duplicate timeline':'Rename timeline';
  $('timeline-action').elements.name.value=(owner.kind==='duplicate_timeline'?timelineCopyName(owner):owner.name).slice(0,128);$('timeline-action-dialog').showModal();
}
async function applyTimelineAction(owner,name){
  if(!timelineActionCurrent(owner))throw Error('The project or selected timeline changed; close and reopen the action');
  name=name.trim();if(!name)throw Error('Enter a nonempty timeline name');
  if(owner.kind==='rename_timeline' && name===owner.name)return;
  owner.committing=true;
  try{
    const receipt=await mutate({kind:owner.kind,name},false,null,null,owner);
    if(owner.kind==='duplicate_timeline' && receipt.project_epoch===documentState?.project_epoch && receipt.generation===documentState?.generation){
      const created=documentState.media.find(item=>item.compound_timeline_id && !owner.media_ids.includes(item.id));
      if(created)revealProjectMedia([created.id]);
    }
  }finally{owner.committing=false;}
}
async function catalogAction(action,state){
  try{
    if(!writable || busy || unresolved || !catalogOwnerCurrent(state))throw Error('The project changed or editing is unavailable; refresh the Media panel');
    if(document.querySelector('dialog[open]'))throw Error('Close the current dialog before using a Media action');
    if(['rename_timeline','duplicate_timeline'].includes(action.kind)){
      const owner=timelineActionOwner(action.kind,action.timeline_id,state,action.media_id);
      if(action.kind==='duplicate_timeline')await applyTimelineAction(owner,timelineCopyName(owner));
      else if(typeof action.name==='string')await applyTimelineAction(owner,action.name);
      else openTimelineAction(owner);
    }else if(action.kind==='new_timeline')openNewTimeline();
    else if(action.kind==='import_otio'){
      $('projects').showModal();await projects();
      if($('projects').open && catalogOwnerCurrent(state))$('otio-current-import').scrollIntoView({block:'nearest'});
    }else if(action.kind==='add_to_library'){
      const ids=action.media_ids ?? (action.media_id?[action.media_id]:[]);
      if(!Array.isArray(ids) || !ids.length || ids.length>64 || new Set(ids).size!==ids.length || ids.some(id=>!state.media.some(item=>item.id===id)))throw Error('Select 1 to 64 current project media for the native library');
      presetPanel?.hide();for(const button of document.querySelectorAll('[data-panel]'))button.setAttribute('aria-selected',String(button.dataset.panel==='Library'));
      revealBrowser('Library');$('browser').dataset.browserPanel='Library';$('media-list').hidden=true;$('search').parentElement.hidden=true;$('panel-content').hidden=false;
      await openLibraryPanel('native');
      if(!catalogOwnerCurrent(state) || !writable || busy || unresolved || document.querySelector('dialog[open]') || $('browser').dataset.browserPanel!=='Library' || libraryMode!=='native')throw Error('The project or Library panel changed before native asset capture; select the media again');
      await nativeAssets.captureSelection(ids);
    }
  }catch(error){notice(error.message);}
}
timelineButton.addEventListener('click',openNewTimeline);$("command-list").append(timelineButton);
for(const [label,kind] of [["Rename timeline","rename_timeline"],["Duplicate timeline","duplicate_timeline"]]) {
    const button=document.createElement("button");button.textContent=label;button.addEventListener("click",()=>{
      if(!timeline || timeline.id==="fixture")return notice("Open a native timeline first");
      try{openTimelineAction(timelineActionOwner(kind,timeline.id));}catch(error){notice(error.message);}
    });$("command-list").append(button);
}
$("timeline-action").addEventListener("submit",async(event)=>{
    event.preventDefault();const owner=timelineAction;if(!owner || owner.committing)return;
    try {
      await applyTimelineAction(owner,event.target.elements.name.value);
      if(timelineAction===owner)$("timeline-action-dialog").close();
    }catch(error){if(timelineAction===owner)$("timeline-action-error").textContent=error.message;}
});
$('timeline-action-dialog').addEventListener('close',()=>{timelineAction=null;});
$('new-timeline-dialog').addEventListener('close',()=>{newTimelineOwner=null;});
$("new-timeline").addEventListener("submit",async(event)=>{
  event.preventDefault();const owner=newTimelineOwner;if(!owner || owner.committing)return;const data=new FormData(event.target),before=new Set(documentState?.timelines.map((t)=>t.id));
  try {
    if(!catalogOwnerCurrent(owner))throw Error('The project changed; close and reopen New timeline');
    owner.committing=true;await mutate({kind:"new_timeline",name:data.get("name").trim(),fps:{num:Number(data.get("fps_num")),den:Number(data.get("fps_den"))},resolution:[Number(data.get("width")),Number(data.get("height"))]},true);
    const next=documentState.timelines.find((t)=>!before.has(t.id));
    if(documentState.project_epoch===owner.project_epoch && next)openTimelineRoot(next);
    if(newTimelineOwner===owner)$("new-timeline-dialog").close();
  }catch(error){if(newTimelineOwner===owner)$("timeline-error").textContent=error.message;}
  finally{owner.committing=false;}
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
  addGenerator('solid');
});
$("split").addEventListener("click", () =>
  run({ kind: "split", clip_ids: view.selection, frame: view.playhead }),
);
function projectPoolContext(){
  return documentState && timeline && timeline.id!=='fixture'?{project_epoch:documentState.project_epoch,generation:documentState.generation,timeline_id:timeline.id,timeline_revision:timeline.revision}:null;
}
function selectedProjectPoolItems(){return projectPoolItems(projectPoolContext(),catalog?.selectedItems() ?? []);}
function stopProjectPoolPlayback(){fastTransport?.stop();audioScrub?.stop();programPlayer?.stop();sourcePlayer?.pause();}
async function commitProjectPoolPlacement(operation){
  const owner={intent:nativePlacementIntent,navigation:timelineOpenSequence,frame:view.playhead},receipt=await commit(operation);
  if(owner.intent!==nativePlacementIntent || owner.navigation!==timelineOpenSequence || owner.frame!==view.playhead || receipt.project_epoch!==documentState?.project_epoch || receipt.generation!==documentState?.generation || receipt.timeline_id!==timeline?.id || !Array.isArray(receipt.clip_ids))return receipt;
  const ids=new Set(receipt.clip_ids);view.selection=timeline.tracks.flatMap(track=>track.clips).filter(clip=>ids.has(clip.id)).map(clip=>clip.id);
  view.selectionAnchor=firstSelectionAnchor(timeline,view.selection,documentState.project_epoch);view.transitionSelection=null;view.selectedGap=null;
  selected();canvasTimeline.invalidate();return receipt;
}
function startProjectPoolDrag(event,media,{catalogFallback=false}={}){
  if(!event.dataTransfer || !writable || busy || unresolved){event.preventDefault();return;}
  canvasTimeline.projectPoolDnd.end();
  stopProjectPoolPlayback();
  const captured=projectPoolItems(projectPoolContext(),media),signature=JSON.stringify([captured,mediaState]);
  const librarySignature=JSON.stringify([media,mediaState]);
  const current=()=>writable && !busy && !unresolved && JSON.stringify([selectedProjectPoolItems(),mediaState])===signature;
  const payload=captured?canvasTimeline.projectPoolDnd.start(captured,current,async(draft,isCurrent)=>{
    if(!isCurrent())throw Error('The project media selection changed before insertion');
    await commitProjectPoolPlacement(projectPoolOperation(captured,draft.start_frame,draft.target,draft.overwrite));
  }):null;
  if(payload)event.dataTransfer.setData(PROJECT_POOL_DRAG_TYPE,payload);
  const libraryPayload=stageLibraryCaptureDrag({controller:libraryCaptureDrop,event,media,timelinePayload:payload,sourceCurrent:()=>JSON.stringify([catalog?.selectedItems() ?? [],mediaState])===librarySignature});
  if(!payload && !libraryPayload){if(!catalogFallback){event.preventDefault();if(!captured)notice('Select up to256 available project media with valid native duration and audio streams');}return;}
  event.dataTransfer.effectAllowed=catalogFallback?'copyMove':'copy';
}
$("insert-media").addEventListener("click",()=>{
  if(!writable || busy || unresolved || !canvasTimeline.navigationIdle())return;
  stopProjectPoolPlayback();const items=selectedProjectPoolItems();
  if(!items){notice('Select available project media first');return;}
  void commitProjectPoolPlacement(projectPoolOperation(items,view.playhead,projectPoolTarget(timeline,items),view.retimeOverwrite)).catch(error=>notice(error.message));
});
mediaImport=createMediaImportPanel({dialog:$("imports"),root:$("import-list"),status:$("import-error"),getContext:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),onImported:ids=>{
  if(ids.some(id=>!documentState?.media.some(item=>item.id===id)))throw Error('The imported media are not yet visible in the refreshed project');
  revealProjectMedia(ids);if(selectedMedia)openSource();
}});
$("import-button").addEventListener("click",()=>void mediaImport.open());
function openMediaRelink(scope){
  stopProjectPoolPlayback();
  const epoch=documentState?.project_epoch,intent=nativePlacementIntent;
  void mediaRelink.open(scope,()=>documentState?.project_epoch===epoch && nativePlacementIntent===intent);
}
mediaRelink=createMediaRelinkPanel({dialog:$('media-relink-dialog'),root:$('media-relink-root'),status:$('media-relink-status'),getContext:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),onRelinked:ids=>{sourceAssets?.refresh();timelineWaveforms?.refresh();if(viewerMode==='source' && ids?.includes(selectedMedia))openSource();}});

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
    revealProjectMedia(receipt.media_ids);
  }else if(!target.to_pool && receipt.clip_ids.length){
    const clips=timeline.tracks.flatMap(track=>track.clips).filter(clip=>receipt.clip_ids.includes(clip.id));view.selection=clips.map(clip=>clip.id);view.selectionAnchor=firstSelectionAnchor(timeline,view.selection,documentState.project_epoch);view.transitionSelection=null;
    if(clips.length)view.playhead=Math.max(...clips.map(clip=>clip.start_frame+clip.length_frames));selected();updateTime();seek();
  }
}});
clipboardImages=createClipboardImagePanel({getContext:clipboardContext,canCommit:clipboardImageWritable,commit:operation=>mutate(operation,true),notice:message=>{notice(message);syncClipboardControls();},onSaveRequired:()=>{$("projects-button").click();$("save-as-project").scrollIntoView({block:'nearest'});$("save-as-project").elements.name.focus();notice('Save As preserves the current project. Paste the image again after saving.');},onImported:ids=>{
  if(ids.some(id=>!documentState.media.some(item=>item.id===id)))throw Error('The pasted image is not yet visible in the refreshed project');
  setClipboardFocus('pool');revealProjectMedia(ids);openSource();
}});
function clipboardButton(parent,label,owner,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.dataset.clipboardOwner=owner;if(action==='paste')node.title='Paste the retained Venturi copy; Ctrl+V uses the system clipboard';node.addEventListener('click',()=>clipboardCommand(owner,action));clipboardButtons.push({node,owner,action});parent.append(node);return node;}
const timelineClipboard=document.createElement('details'),clipboardHeading=document.createElement('summary'),clipboardTools=document.createElement('div');clipboardHeading.textContent='Clipboard';clipboardTools.className='tools';clipboardTools.setAttribute('role','group');clipboardTools.setAttribute('aria-label','Timeline clipboard');timelineClipboard.dataset.clipboardOwner='timeline';timelineClipboard.append(clipboardHeading,clipboardTools);
clipboardButton(clipboardTools,'Copy clips','timeline','copy');clipboardButton(clipboardTools,'Cut clips','timeline','cut');clipboardButton(clipboardTools,'Paste retained clips','timeline','paste');
clipboardButton(clipboardTools,'Paste from system clipboard','timeline','paste_system');
clipboardButton(clipboardTools,'Paste image from system clipboard','timeline','paste_image');
const overwriteLabel=document.createElement('label');clipboardOverwrite=document.createElement('input');clipboardOverwrite.type='checkbox';clipboardOverwrite.dataset.clipboardPasteOption='true';clipboardOverwrite.checked=false;clipboardOverwrite.setAttribute('aria-label','Replace overlapping clips');overwriteLabel.title='Applies to every timeline paste, including Ctrl+V. Undo restores replaced clips.';overwriteLabel.append(clipboardOverwrite,document.createTextNode(' Replace overlapping clips'));clipboardOverwrite.addEventListener('change',syncClipboardControls);clipboardTools.append(overwriteLabel);
clipboardRetry=document.createElement('button');clipboardRetry.type='button';clipboardRetry.textContent='Copy to system clipboard';clipboardRetry.hidden=true;clipboardRetry.addEventListener('click',()=>void clipboard.retrySystem());clipboardTools.append(clipboardRetry);
clipboardCancel=document.createElement('button');clipboardCancel.type='button';clipboardCancel.textContent='Cancel clipboard preparation';clipboardCancel.disabled=true;clipboardCancel.addEventListener('click',()=>clipboard.cancel());clipboardTools.append(clipboardCancel);
clipboardStatus=document.createElement('output');clipboardStatus.setAttribute('aria-label','Clipboard status');clipboardStatus.setAttribute('role','status');clipboardStatus.style.display='block';clipboardStatus.style.height='3em';clipboardStatus.style.overflow='auto';clipboardStatus.textContent=clipboard.state().message;timelineClipboard.append(clipboardStatus);$("clipboard-menu").append(timelineClipboard);
const poolClipboard=document.createElement('div');poolClipboard.className='tools';poolClipboard.dataset.clipboardOwner='pool';poolClipboard.setAttribute('role','group');poolClipboard.setAttribute('aria-label','Media clipboard');clipboardButton(poolClipboard,'Copy media','pool','copy');clipboardButton(poolClipboard,'Paste media','pool','paste');clipboardButton(poolClipboard,'Paste from system clipboard','pool','paste_system');clipboardButton(poolClipboard,'Paste image from system clipboard','pool','paste_image');$("media-clipboard-menu").append(poolClipboard);
for(const type of ['pointerdown','focusin'])document.addEventListener(type,event=>{const target=event.target,explicit=target?.closest?.('[data-clipboard-owner]')?.dataset.clipboardOwner;if(explicit)setClipboardFocus(explicit);else if(target?.closest?.('#media-list'))setClipboardFocus('pool');else if(target?.closest?.('#timeline-panel,#viewer,#inspector'))setClipboardFocus('timeline');},true);
document.addEventListener('toggle',syncClipboardControls,true);
bindClipboardEvents({target:document,getOwner:()=>clipboardFocus,isDialogOpen:()=>Boolean(document.querySelector('dialog[open]')),copy:options=>clipboard.copy(options),paste:text=>clipboard.paste(text),pasteImage:blob=>clipboardImages.paste(blob),imageFromEvent:clipboardEventImage,onError:error=>notice(error.message)});
syncClipboardControls();
otioImport=createOtioImportPanel({root:$("otio-current-import"),isVisible:()=>$("projects").open,getContext:()=>documentState,canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),notice,onImported:receipt=>{
  const next=documentState?.timelines.find(item=>item.id===receipt.timeline_ids[0]);
  if(!next)throw Error('The imported timeline is not yet visible in the refreshed project');
  revealProjectMedia(receipt.media_ids);
  openTimelineRoot(next);$("projects").close();
}});
$("projects").addEventListener('close',()=>otioImport.hide());
$("projects").addEventListener('cancel',()=>otioImport.hide());
$('delete').addEventListener('click',()=>deleteOwnedSelection());
function openSelectionTools(kind){
  stopProjectPoolPlayback();revealInspector();selected();setInspectorTab('selection');
  for(const key of ['selection-actions',`selection-${kind}`]){visualState.set(key,true);const section=document.querySelector(`[data-visual-path="${key}"]`);if(section)section.open=true;}
  document.querySelector(`[data-visual-path="selection-${kind}"] input`)?.focus();
}
for(const button of document.querySelectorAll('[data-selection-command]'))button.addEventListener('click',()=>{
  if(button.disabled || !writable || busy || unresolved || !timeline || timeline.id==='fixture' || view.recording || !canvasTimeline.navigationIdle() || document.querySelector('dialog[open]'))return;
  const action=button.dataset.selectionCommand,clip_ids=[...view.selection];
  if(action==='ripple'){void canvasTimeline.rippleDelete();return;}
  if(!clip_ids.length)return;
  if(action==='slip' || action==='compound'){openSelectionTools(action);return;}
  if(action==='paste_attributes'){stopProjectPoolPlayback();pasteAttributes?.open();return;}
  if(action==='link' || action==='unlink')run({kind:'link_clips',clip_ids,unlink:action==='unlink'});
  if(action==='disable' || action==='enable')run({kind:'set_disabled',clip_ids,disabled:action==='disable'});
});
for(const button of document.querySelectorAll('[data-timeline-command]'))button.addEventListener('click',()=>{if(!button.disabled)canvasTimeline.selectTimelineClips(button.dataset.timelineCommand==='select_all'?'all':'from_playhead');});
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
  timelineWaveforms?.retry();
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
      cancelInspectorDraft();
      nativeAssets?.invalidate();libraryCaptureDrop?.invalidate();
      mediaImport?.invalidate();mediaRelink?.invalidate();otioImport?.invalidate();syncClipboardControls();
      $("connection").textContent = "Disconnected · read only";
    });
}, 30_000);
document.addEventListener("keydown", (event) => {
  if (!globalEditingShortcut(event)) return;
  const owner=deleteCommandOwner(event,{owner:commandOwnership.owner(event.target),dialogOpen:Boolean(document.querySelector('dialog[open]')),keysOwnDelete:Boolean(selectedKeyController())});
  if(owner){event.preventDefault();event.stopPropagation();deleteOwnedSelection(owner);return;}
  if(canvasTimeline.handleSelectionKey(event,{timelineFocused:timelineSelectionFocus(event.target)}))return;
  if(commandOwnership.owner(event.target)==='timeline' && canvasTimeline.handleGapKey(event))return;
  const modifier = event.ctrlKey || event.metaKey;
  if (
    event.altKey && commandOwnership.owner(event.target)==='timeline' &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    event.preventDefault();
    moveSelection(
      (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1),
    );
  } else if (event.altKey && !modifier && commandOwnership.owner(event.target)==='timeline' && event.key.toLowerCase() === "v" && !clipboardBlocked(event,{dialogOpen:Boolean(document.querySelector('dialog[open]'))})) {
    event.preventDefault();pasteAttributes?.open();
  } else if(modifier && event.key.toLowerCase()==='o') {event.preventDefault();$('projects-button').click();
  } else if(modifier && event.shiftKey && event.key.toLowerCase()==='e') {event.preventDefault();$('export-button').click();
  } else if(modifier && !event.shiftKey && event.key.toLowerCase()==='i') {event.preventDefault();$('import-button').click();
  } else if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if(event.shiftKey){$('projects-button').click();$('save-as-project').elements.name.focus();}else $('save').click();
  } else if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    $(event.shiftKey ? "redo" : "undo").click();
  } else if (event.key.toLowerCase() === "t" && !modifier && commandOwnership.owner(event.target)==='timeline') $("split").click();
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
async function commitMask(operation){
  const before=currentViewerContext(),scope=maskScope(before),selected=before && maskChoice?.scope===scope && maskChoice.revision===before.revision?maskChoice.index:null;
  const index=before && operation.kind==='edit_mask'?maskFocusAfterEdit(selected,operation.edit,before.detail.masks.items.length):selected,selectionSequence=maskSelectionSequence;
  const receipt=await commit(operation),clip=timeline?.tracks.flatMap(track=>track.clips).find(clip=>clip.id===operation.clip_id);
  if(before && operation.clip_id===before.clip_id && selectionSequence===maskSelectionSequence && documentState?.project_epoch===before.project_epoch && timeline?.id===before.timeline_id && clip && view.selection.includes(clip.id)){
    maskChoice=index===null?null:{scope,revision:timeline.revision,index};
    if(index===null)maskOverlay?.setEnabled(false);
    else if(operation.kind==='edit_mask' && operation.edit.action==='add'){
      if($("viewer-transform").getAttribute('aria-pressed')==='true')$("viewer-transform").click();maskOverlay?.setEnabled(true);
    }
  }
  syncViewerMasks();maskOverlay?.invalidate();return receipt;
}
transformOverlay=createViewerTransformOverlay({screen:$("screen"),image:$("preview"),toggle:$("viewer-transform"),canCommit:()=>writable && !busy && !unresolved && !document.querySelector('dialog[open]'),commit,notice,getContext:currentViewerTransformContext});
maskOverlay=createViewerMaskOverlay({screen:$("screen"),image:$("preview"),toggle:$("viewer-mask"),penToggle:$("viewer-mask-pen"),getPenContext:currentViewerContext,canCommit:()=>writable && !busy && !unresolved && !document.querySelector('dialog[open]'),notice,getContext:()=>{
  const context=currentViewerContext();if(!context)return null;
  const index=maskChoice?.scope===maskScope(context) && maskChoice.revision===context.revision?maskChoice.index:null;
  return {...context,mask_index:index};
},commit:commitMask});
viewerZoom=createViewerZoom({screen:$('screen'),media:[$('preview'),$('program-video'),$('source-video'),$('source-image')],select:$('viewer-zoom'),status:$('viewer-zoom-status'),
  getActive:()=>{
    if(!$('slip-view').hidden)return null;
    if(viewerMode==='source' && $('source-view').dataset.sourceAudioOnly==='true')return null;
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
scopes = createScopes({ panel: $("scopes"), isPlaying:()=>!document.hidden && viewerMode==='program' && programPlayer?.state()==='ready' && !$("program-video").paused, getTarget: () => !document.hidden && viewerMode === "program" && !["preparing","failed"].includes(programPlayer?.state()) ? scopeTarget(documentState, timeline, view.selection, view.playhead) : null });
scopes.setVisible(false);
previewCache = createPreviewCache({getState: () => documentState?.capabilities.preview && timeline ? {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0,width:960} : null,status:$("preview-cache-status"),onChange:()=>canvasTimeline.invalidate()});
seek = async () => { if (viewerMode === "program") { audioMeters?.invalidate(); programPlayer?.stop(); scopes.invalidate("SEEKING"); await viewer.seek(); scopes.refresh(); previewCache.refresh(); audioMeters?.refresh(); } };
audioScrub=createAudioScrub({enabled:$("audio-scrub"),status:$("audio-scrub-status"),getState:()=>{
  if(!documentState || fastTransport?.active())return null;
  if(viewerMode==="source") {
    const media=currentSourceItem(),position=sourcePosition();
    return media?.has_audio && position ? {project_epoch:documentState.project_epoch,media_id:media.id,...(media.native_asset?{source_item:media}:{}),frame:position.frame,...sourceAudioQuery(position)} : null;
  }
  return timeline ? {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960} : null;
},getURL:query=>query.media_id ? `${sourceMediaPath(query.source_item || {id:query.media_id},'/audio.wav')}?${new URLSearchParams({...sourceMediaQuery(query.source_item || {id:query.media_id},query.project_epoch),frame:query.frame,audio_mode:query.audio_mode,audio_stream_index:query.audio_stream_index})}` : `/api/v1/preview/audio.wav?${new URLSearchParams(query)}`});
$("play").addEventListener("click",()=>audioScrub?.stop());
$("program-video").addEventListener("play",()=>{audioScrub?.stop();audioMeters?.sync();});
$("source-video").addEventListener("play",()=>audioScrub?.stop());
function refreshStoppedProgramInspector(){
  if(viewerMode!=='program' || programPlayer?.state()!=='stopped')return;
  const identity=JSON.stringify([documentState?.project_epoch,documentState?.generation,timeline?.id,timeline?.revision,view.playhead]);
  const current=()=>viewerMode==='program' && programPlayer?.state()==='stopped' && identity===JSON.stringify([documentState?.project_epoch,documentState?.generation,timeline?.id,timeline?.revision,view.playhead]);
  selected();void projectView?.update();scopes?.invalidate('SEEKING');
  void viewer?.seek().then(()=>{if(current()){scopes?.refresh();previewCache.refresh();}}).catch(error=>{if(current())notice(error.message);});
}
programPlayer = createProgramPlayer({
  video: $("program-video"), status: $("program-status"), cancel: $("program-cancel"),
  canPrefetch:()=>writable && !busy && !unresolved && !document.hidden && viewerMode==='program' && !document.querySelector('dialog[open]'),
  onPrefetch:value=>{
    $("program-status").dataset.programNextWindow=JSON.stringify(value);
    $("program-status").title=value.state==='ready'?'Next section ready':['preparing','queued','running'].includes(value.state)?'Preparing next section':value.state==='failed'?'Next section unavailable; current playback continues':'';
  },
  getState: (startFrame,audioOrigin) => {
    if (!documentState?.capabilities.playback || !timeline || viewerMode !== "program") return null;
    return buildProgramWindow(documentState,timeline,view.playhead,startFrame,audioOrigin);
  },
  beforeWindowChange: async () => {
    if(fastTransport && !await fastTransport.finishWindow($("program-video")))throw new Error("Fast audio did not finish its preview window · press Play to retry");
  },
  isInternalSeek: () => Boolean(fastTransport?.correcting($("program-video"))),
  isInternalPause: event => Boolean(fastTransport?.pausing($("program-video"),event)),
  onFrame: (frame) => { if (viewerMode === "program") { view.playhead = frame; syncPlayheadSelection(true); updateTime(); scopes?.onPlaybackFrame(); } },
  onState: (state) => { cancelInspectorDraft(); const active = state !== "stopped" && viewerMode === "program"; scopePlayback=active; scopesSuspended=["preparing","failed"].includes(state); $("workspace-tools").hidden=viewerMode==="source" || editor.dataset.workspace==="Edit"; scopes?.invalidate(state==='preparing'?"PREPARING PROGRAM":undefined); scopes?.setVisible(scopesWanted && !scopesSuspended && viewerMode==="program" && editor.dataset.workspace==="Color" && $("slip-view").hidden,{defer:state==='ready'}); $("program-view").hidden = !active; transformOverlay?.invalidate(); syncViewerMasks(); maskOverlay?.invalidate(); $("screen").dataset.programPlayback = String(active); if (viewerMode === "program") $("play").textContent = state === "preparing" ? "Cancel preparation" : state === "failed" ? "Retry playback" : "▶ Play"; sourceAssets?.refresh();timelineWaveforms?.refresh();viewerZoom?.refresh();voiceover?.syncPlayback();audioMeters?.sync(); },
  onUserPause:({frame,query,reason,isCurrent,playback})=>{
    const current=()=>isCurrent() && viewerMode==='program' && programPlayer?.state()==='ready' && programPlayer.range()===query && $('program-video').paused && documentState?.project_epoch===query.project_epoch && documentState?.generation===query.if_generation && timeline?.id===query.timeline_id && timeline?.revision===query.revision;
    if(!Number.isSafeInteger(frame) || frame<query.start_frame || frame>=query.end_frame || !current())return;
    void (async()=>{
      if(reason==='ended' && fastTransport?.active()){
        const finished=await fastTransport.finishWindow($('program-video'));
        if(!current())return;
        if(!finished)throw Error('Fast audio did not finish its preview window · press Play to retry');
      }
      if(reason==='ended' && current()){
        try{await audioMeters?.finishPlayback(playback,isCurrent);}catch{}
      }
      if(!current())return;
      fastTransport?.stop();audioScrub?.stop();programPlayer.stop();view.playhead=frame;updateTime();canvasTimeline.invalidate();refreshStoppedProgramInspector();
    })().catch(error=>{if(current())notice(error.message);});
  },
  onStop:refreshStoppedProgramInspector,
  onCache:()=>previewCache.refresh(),
  onError: notice,
});
for(const event of ['pause','ended'])$('program-video').addEventListener(event,()=>queueMicrotask(()=>void projectView?.update()));
audioMeters=createAudioMeters({root:$("audio-meters-dialog"),onTransport:()=>{if(viewerMode!=="program")viewerModeSet("program");togglePlayback();},getPlayback:()=>({label:viewerMode==="program"?`${$("play").textContent} Program`:"Play Program",status:viewerMode!=="program"?"Source viewer active":programPlayer.state()==="stopped"?"Program stopped":[$("program-status").textContent,$("fast-playback-status").textContent].filter(Boolean).join(" · ")}),isPlaying:()=>viewerMode==="program" && !$("program-video").paused,getTarget:()=>{
  if(!documentState || !timeline || viewerMode!=="program")return null;
  return {playback:programPlayer?.telemetryTarget(),query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:view.playhead,width:960},channels:[...timeline.tracks.filter(track=>track.kind==="audio").map(track=>({id:track.id,label:track.label || track.id,effects:track.mix.effects})),{id:"master",label:"Master",effects:timeline.master.effects}]};
}});
fastTransport=createFastTransport({videos:[$("program-video"),$("source-video")],select:$("playback-rate"),status:$("fast-playback-status"),getVideo:()=>$(viewerMode==="program"?"program-video":"source-video"),notice,onState:state=>{$("play").textContent=state==="preparing"?"Cancel fast audio":state==="playing"?"❚❚ Pause":"▶ Play";sourceAssets?.refresh();timelineWaveforms?.refresh();},getTarget:video=>{
  if(!documentState)return null;
  if(video===$("source-video") && viewerMode==="source") {
    const media=currentSourceItem();
    const position=sourcePosition(true);
    if(!media || media.is_image || !position || !video.getAttribute("src"))return null;
    return {identity:JSON.stringify([documentState.project_epoch,media.id,video.getAttribute("src"),position.source_version,position.audio_mode,position.audio_stream_index]),audio:media.has_audio,fps:position.fps,origin:sourceSampleAtFrame(position.start_frame,position.fps),end:sourceSampleAtFrame(position.end_frame,position.fps),url:sourceMediaPath(media,'/audio/window'),query:{...sourceMediaQuery(media,documentState.project_epoch),...sourceAudioQuery(position)}};
  }
  const range=programPlayer?.range();
  if(video!==$("program-video") || viewerMode!=="program" || !range || !video.getAttribute("src"))return null;
  return {identity:JSON.stringify([range.project_epoch,range.if_generation,range.timeline_id,range.revision,video.getAttribute("src")]),fps:range.fps,origin:Math.round(range.start_frame/(range.fps.num/range.fps.den)*48000),end:Math.round(range.end_frame/(range.fps.num/range.fps.den)*48000),url:"/api/v1/preview/audio/window",query:{project_epoch:range.project_epoch,if_generation:range.if_generation,timeline_id:range.timeline_id,revision:range.revision,width:range.width}};
}});
sourcePlayer = createSourcePlayer({
  video: $("source-video"), image: $("source-image"), status: $("source-status"), cancel: $("source-cancel"),
  windowed:true,
  canPrefetch:()=>writable && !busy && !unresolved && !document.hidden && viewerMode==='source' && !view.recording && !fastTransport?.active() && !document.querySelector('dialog[open]'),
  onPrefetch:value=>{
    $('source-status').dataset.sourceNextWindow=JSON.stringify(value);
    $('source-status').title=value.state==='ready'?'Next Source section ready':['preparing','queued','running'].includes(value.state)?'Preparing next Source section':value.state==='failed'?'Next Source section unavailable; current playback continues':'';
  },
  beforeWindowChange: async () => {
    if(fastTransport && !await fastTransport.finishWindow($("source-video")))throw new Error("Fast audio did not finish its Source window · press Play to retry");
  },
  isInternalSeek: () => Boolean(fastTransport?.correcting($("source-video"))),
  isInternalPause: event => Boolean(fastTransport?.pausing($("source-video"),event)),
  onStateChange:state=>{if(state.state==='error')sourceWaveformBinding=null;refreshSourceWaveform();sourceAssets?.refresh();timelineWaveforms?.refresh();viewerZoom?.refresh();sourcePlacement?.refresh();},
  onReady: ({ item, epoch, source_window }) => {
    syncSourcePosition();
    if(item.native_asset)return;
    const sourceVersion=source_window?.source_version,changed=sourceVersion && [...mediaAssets.values()].some(asset=>asset.mediaId===item.id && asset.sourceVersion!==sourceVersion);
    if(changed)removeMediaAssets(item.id);
    void sourceAssets?.load(item,epoch,{sourceVersion,audioStreamIndex:source_window?.audio_stream_index ?? 0,includeWaveform:Boolean(item.has_audio),force:Boolean(changed)});
  },
});
sourcePlacement=createSourcePlacement({
  root:$("source-placement"),surfaces:[$("source-video"),$("source-image"),$("source-waveform-canvas")],handles:[[$("source-video-drag"),'video_only'],[$("source-audio-drag"),'audio_only']],
  sourceDnd:canvasTimeline.sourceDnd,canCommit:()=>writable && !busy && !unresolved && viewerMode==='source' && !sourcePlayer.preparing() && !document.querySelector('dialog[open]'),
  canInsert:()=>canvasTimeline.navigationIdle(),
  getContext:()=>{
    const item=viewerMode==='source'?documentState?.media.find(media=>media.id===sourceOpenId):null;
    if(!item || !timeline)return null;
    const mark=id=>$(id).value.trim()===''?NaN:Number($(id).value);
    return {project_epoch:documentState.project_epoch,generation:documentState.generation,timeline_id:timeline.id,timeline_revision:timeline.revision,item,verified:sourcePlayer.verifiedSource(),source_in:mark('source-in'),source_out:mark('source-out'),frame:view.playhead,tracks:timeline.tracks,overwrite:Boolean(view.retimeOverwrite)};
  },
  onStart:()=>{fastTransport?.stop();audioScrub?.stop();sourcePlayer.pause();},
  commit:async operation=>{
    const owner={intent:nativePlacementIntent,navigation:timelineOpenSequence,frame:view.playhead},receipt=await commit(operation);
    if(owner.intent!==nativePlacementIntent || owner.navigation!==timelineOpenSequence || owner.frame!==view.playhead || receipt.project_epoch!==documentState?.project_epoch || receipt.generation!==documentState?.generation || receipt.timeline_id!==timeline?.id || !Array.isArray(receipt.clip_ids))return receipt;
    const ids=new Set(receipt.clip_ids);view.selection=timeline.tracks.flatMap(track=>track.clips).filter(clip=>ids.has(clip.id)).map(clip=>clip.id);
    view.selectionAnchor=firstSelectionAnchor(timeline,view.selection,documentState.project_epoch);view.transitionSelection=null;view.selectedGap=null;
    selected();canvasTimeline.invalidate();return receipt;
  },notice,
});
for(const event of ['loadedmetadata','canplay'])$("source-video").addEventListener(event,()=>sourcePlacement.refresh());
$("source-image").addEventListener('load',()=>sourcePlacement.refresh());
function assetDemandItems(items){
  const media=new Map(documentState?.media.map(item=>[item.id,item]));
  return items.flatMap(entry=>{const item=media.get(entry.media_id);return item?[{item,audioStreamIndex:entry.audio_stream_index,includeWaveform:entry.include_waveform}]:[];});
}
function updateMediaThumbnail(id){
  const asset=mediaThumbnail(mediaAssets,id);
  for(const card of document.querySelectorAll('.media-item'))if(card.dataset.mediaId===id){
    const slot=card.querySelector('.catalog-thumbnail');
    if(!slot)continue;
    const item=documentState?.media.find(item=>item.id===id);slot.textContent=item?mediaRowInfo(item).glyph:'';
    if(asset?.thumbnailURL){const image=document.createElement('img');image.alt='';image.src=asset.thumbnailURL;slot.replaceChildren(image);}
  }
}
function releaseMediaAsset(asset) {
  asset?.thumbnail?.close();
  if(asset?.thumbnailURL?.startsWith("blob:"))URL.revokeObjectURL(asset.thumbnailURL);
}
function removeMediaAssets(id){
  for(const [key,asset] of mediaAssets)if(asset.mediaId===id){releaseMediaAsset(asset);mediaAssets.delete(key);}
  updateMediaThumbnail(id);canvasTimeline.invalidate();refreshSourceWaveform();
}
function installMediaAsset({item,epoch,thumbnail,waveform,waveformBytes=0,bytes,thumbnailURL,sourceVersion,audioStreamIndex=0}) {
  if(documentState?.project_epoch!==epoch || (item.native_asset?!nativeThumbnailCurrent(item,epoch):documentState.media.find(media=>media.id===item.id)?.content_hash!==item.content_hash) || !Number.isSafeInteger(bytes) || bytes<0 || bytes>16*1024*1024)return false;
  const key=sourceAssetKey(item.id,audioStreamIndex),previous=mediaAssets.get(key),retainedWave=previous?.sourceVersion===sourceVersion && !waveform?previous:null;
  const total=bytes+(retainedWave?.waveformBytes || 0);if(total>16*1024*1024)return false;
  if([...mediaAssets.values()].some(asset=>asset.mediaId===item.id && asset.sourceVersion!==sourceVersion))removeMediaAssets(item.id);
  if(mediaAssets.get(key)===previous)releaseMediaAsset(previous);mediaAssets.delete(key);
  mediaAssets.set(key,{mediaId:item.id,contentHash:item.content_hash,nativeAsset:item.native_asset?{...item.native_asset}:null,audioStreamIndex,thumbnail,waveform:waveform || retainedWave?.waveform || null,waveformBytes:waveform?waveformBytes:retainedWave?.waveformBytes || 0,bytes:total,thumbnailURL,sourceVersion,fps:item.fps});
  updateMediaThumbnail(item.id);
  while(mediaAssets.size>64 || [...mediaAssets.values()].reduce((total,asset)=>total+asset.bytes,0)>64*1024*1024){
    const oldest=mediaAssets.keys().next().value,asset=mediaAssets.get(oldest);releaseMediaAsset(asset);mediaAssets.delete(oldest);updateMediaThumbnail(asset.mediaId);
  }
  nativeAssets?.refreshThumbnails();canvasTimeline.invalidate();refreshSourceWaveform();return true;
}
const derivativesIdle=()=>Boolean(documentState && !document.hidden && !busy && !unresolved && !derivativesTransportPending && !document.querySelector('dialog[open]') && canvasTimeline.navigationIdle() && programPlayer?.state()!=='preparing' && !sourcePlayer?.preparing() && $('source-video').paused && $('program-video').paused && $('export-preview-video').paused && !fastTransport?.active());
sourceAssets=createSourceAssetQueue({loader:createSourceAssets({getState:()=>documentState,isNativeCurrent:nativeThumbnailCurrent,onReady:installMediaAsset,onStatus:(message,item)=>{if(item?.native_asset)nativeAssets?.thumbnailStatus(item,message);else $("source-assets-status").textContent=message;},onError:error=>notice(error.message || String(error))}),getState:()=>documentState,isNativeCurrent:nativeThumbnailCurrent,
  isIdle:derivativesIdle,
  hasAsset:entry=>{const asset=mediaAssets.get(sourceAssetKey(entry.item.id,entry.audioStreamIndex)),thumbnail=mediaThumbnail(mediaAssets,entry.item.id);if(entry.item.native_asset)return Boolean(nativeThumbnailCurrent(entry.item,entry.epoch) && thumbnail?.nativeAsset?.revision===entry.item.native_asset.revision && thumbnail.nativeAsset.if_generation===entry.item.native_asset.if_generation);return Boolean((!entry.item.has_video || thumbnail?.contentHash===entry.item.content_hash && (!entry.sourceVersion || thumbnail.sourceVersion===entry.sourceVersion)) && (!entry.item.has_audio || !entry.includeWaveform || asset?.contentHash===entry.item.content_hash && asset.waveform && (!entry.sourceVersion || asset.sourceVersion===entry.sourceVersion)));}});
timelineWaveforms=createTimelineWaveforms({
  getContext:()=>documentState && timeline && timeline.id!=='fixture'?{query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:0,width:960},timeline,media:documentState.media}:null,
  canRead:derivativesIdle,
  read:(query,clip_ids,{signal})=>request(`/timelines/${encodeURIComponent(query.timeline_id)}/waveform-presentation`,{query,clip_ids},(url,options)=>fetch(url,{...options,signal:AbortSignal.any([signal,options.signal])})),
  onChange:()=>canvasTimeline.invalidate(),notice,
});
sourceWaveform=createSourceWaveform({root:$('source-waveform'),canvas:$('source-waveform-canvas'),content:$('source-waveform-content'),getContext:sourceWaveformContext,getAssets:()=>mediaAssets,
  onDemand:(entries,epoch)=>{sourceWaveformDemand={entries,epoch};sourceAssets.demand('source_waveform',entries,epoch);},
  onSeek:seekSourceFrame,onError:error=>notice(error.message || String(error))});
for(const event of ['play','pause','ended'])$('export-preview-video').addEventListener(event,()=>{sourceAssets.refresh();timelineWaveforms?.refresh();});
document.addEventListener('visibilitychange',()=>{void proxyControls?.visible(!document.hidden);sourceAssets.refresh();timelineWaveforms?.refresh();sourcePlayer?.invalidatePrefetch();audioMeters?.sync();if(document.hidden){programPlayer?.invalidatePrefetch();audioMeters?.invalidate();scopes?.invalidate();void projectView?.flush({persist:true});}else scopes?.refresh();});document.addEventListener('toggle',()=>{void proxyControls?.refresh();sourceAssets.refresh();timelineWaveforms?.refresh();sourcePlayer?.invalidatePrefetch();},true);
window.addEventListener('pagehide',()=>{inspectorViewport?.cancel();fastTransport?.stop();programPlayer?.pauseLocal();void projectView?.flush({persist:true});});
$("source-assets-refresh").addEventListener("click",()=>{
  const position=sourcePosition(),item=documentState?.media.find(media=>media.id===sourceOpenId);
  if(item && !item.has_video && sourceWaveformDemand.entries.length){sourceAssets.demand('source_waveform',sourceWaveformDemand.entries.map(entry=>({...entry,force:true})),sourceWaveformDemand.epoch);return;}
  if(item)void sourceAssets.load(item,documentState.project_epoch,{sourceVersion:position?.source_version,audioStreamIndex:position?.audio_stream_index ?? 0,includeWaveform:Boolean(item.has_audio),force:true});
});
async function seekSourceFrame(frame){
  const resume=sourcePlayer.playing();fastTransport?.stop();audioScrub?.stop();
  await sourcePlayer.seekFrame(frame,{resume});syncSourcePosition();if(!resume)audioScrub?.request();
}
sourceSeek=createSourceSeek({range:$("source-position"),frame:$("source-seek-frame"),seek:$("source-seek"),status:$("source-position-status"),getMedia:()=>{
  const item=viewerMode==="source"?currentSourceItem():null;
  return item ? {...item,epoch:documentState.project_epoch} : null;
},getPosition:()=>sourcePosition(true),onSeek:seekSourceFrame,onError:notice});
bindSourceScrub($("source-video"),audioScrub,()=>viewerMode==="source" && !fastTransport?.active());
for(const event of ["loadstart","emptied","error","seeked"])$("source-video").addEventListener(event,syncSourcePosition);
$("source-video").addEventListener("timeupdate", () => {
  if (viewerMode !== "source") return;
  syncSourcePosition();
});
for (const event of ["play", "pause", "ended"]) $("source-video").addEventListener(event, () => {
  if(event==='play' && !$("source-video").paused)exportPanel?.stopPreview();
  $("play").textContent = $("source-video").paused ? "▶ Play" : "❚❚ Pause";
  sourceAssets?.refresh();timelineWaveforms?.refresh();
  refreshSourceWaveform();
});
for (const event of ["play", "pause", "ended"]) $("program-video").addEventListener(event, () => {
  if(event==='play' && !$("program-video").paused)exportPanel?.stopPreview();
  if (viewerMode === "program") $("play").textContent = $("program-video").paused ? "▶ Play" : "❚❚ Pause";
  sourceAssets?.refresh();timelineWaveforms?.refresh();
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
function nativeImportedMedia(ids){revealProjectMedia(ids);}
function retireNativeAssetPreview(ids,receipt){
  if(receipt.project_epoch!==documentState?.project_epoch)return;
  if(ids.includes(sourcePreviewAttempt?.id))cancelSourcePreview();
  if(!ids.includes(sourceLibraryItem?.item.native_asset?.id))return;
  sourcePlayer?.reset();sourceAssets?.cancelSource();sourceSeek?.reset();
  sourceOpenId=null;clearLibrarySource();sourceWaveformBinding=null;
  if(viewerMode==='source')viewerModeSet('program');
}
nativeAssets=createNativeAssetPanel({
  root:nativeAssetsRoot,getContext:()=>documentState?{...documentState,selected_ids:[...mediaState.selected]}:null,
  canCommit:()=>writable && !busy && !unresolved,
  makeLibraryMutation:operation=>{if(!writable || busy || unresolved)throw new Error('Editing is read only or a command is pending');return nativeAssetMutation(documentState,clientId,operation,crypto.randomUUID());},
  libraryCommit:(operation,prepared)=>mutate(operation,true,'/native-assets/commands',prepared),projectCommit:operation=>mutate(operation,true),
  assetDnd:canvasTimeline.assetDnd,timelineCommit:operation=>{
    nativePlacementCompletion=null;const pending=commit(operation),owner={intent:nativePlacementIntent,navigation:timelineOpenSequence,frame:view.playhead};
    return pending.then(receipt=>{nativePlacementCompletion={owner,command:receipt.command_id};return receipt;});
  },onImported:nativeImportedMedia,onPreview:previewNativeAsset,getThumbnail:nativeThumbnail,onThumbnailDemand:demandNativeThumbnails,
  onRemoved:retireNativeAssetPreview,
  onRelinked:(id,receipt)=>retireNativeAssetPreview([id],receipt),
  onPlaced:receipt=>{
    const completed=nativePlacementCompletion;nativePlacementCompletion=null;
    if(!completed || completed.command!==receipt.command_id || completed.owner.intent!==nativePlacementIntent || completed.owner.navigation!==timelineOpenSequence || completed.owner.frame!==view.playhead || receipt.project_epoch!==documentState?.project_epoch || receipt.generation!==documentState?.generation || receipt.timeline_id!==timeline?.id || !Array.isArray(receipt.media_ids) || !Array.isArray(receipt.clip_ids))return;
    nativeImportedMedia(receipt.media_ids);
    const ids=new Set(receipt.clip_ids);view.selection=timeline.tracks.flatMap(track=>track.clips).filter(clip=>ids.has(clip.id)).map(clip=>clip.id);
    view.selectionAnchor=firstSelectionAnchor(timeline,view.selection,documentState.project_epoch);view.transitionSelection=null;view.selectedGap=null;
    selected();canvasTimeline.invalidate();void projectView?.update();
  },notice,
});
libraryCaptureDrop=createLibraryCaptureDrop({
  getContext:()=>{const context=projectPoolContext();return context && documentState?{...context,command_epoch:documentState.command_epoch,project_name:documentState.project_name,media:documentState.media}:null;},
  canCommit:()=>writable && !busy && !unresolved,
  openLibrary:async(current,signal)=>{if(signal.aborted || !current())return;canvasTimeline.projectPoolDnd.end();contextBrowser('Library');await openLibraryPanel('native');},
  captureSelection:(ids,options)=>nativeAssets.captureSelection(ids,options),notice,
});
for(const target of [...document.querySelectorAll('[data-panel="Library"]'),nativeAssetsRoot])libraryCaptureDrop.bind(target);
const mediaSourceTabs=[...document.querySelectorAll('.media-source-tabs [data-panel]')];
for(const tab of mediaSourceTabs)tab.addEventListener('keydown',event=>{
  if(event.ctrlKey || event.metaKey || event.altKey || event.isComposing || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const index=mediaSourceTabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?mediaSourceTabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+mediaSourceTabs.length)%mediaSourceTabs.length;
  mediaSourceTabs[next].focus();mediaSourceTabs[next].click();
});
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
  return {epoch:documentState.project_epoch,generation:documentState.generation,command_epoch:documentState.command_epoch,timeline:timeline?.id,revision:timeline?.revision,clip_ids:ids,name:clips[0]?.clip.name,roles:{video:clips.some(item=>item.kind==='video'),audio:clips.some(item=>item.kind==='audio')}};
}
const presetShortcuts=createPresetShortcuts({getContext:presetContext,canCommit:()=>writable && !busy && !unresolved,commit,notice});
presetPanel=createPresetPanel({root:$("panel-content"),getContext:presetContext,shortcuts:presetShortcuts,presetDnd:canvasTimeline.presetDnd,canCommit:()=>writable && !busy && !unresolved,commit,libraryCommit:operation=>mutate(operation,true,'/presets/commands'),notice});
recoveryPanel=createRecoveryPanel({root:$("recovery-panel"),status:$("recovery-status"),button:$("recovery-button"),canCommit:()=>writable && !busy && !unresolved,commit:operation=>mutate(operation,true),openProjects:async()=>{$("projects").showModal();await projects();if(!$("recovery-panel").hidden){$("recovery-panel").scrollIntoView({block:"start"});$("recovery-panel").querySelector("input").focus();}},onOpened:()=>$("projects").close(),notice});
proxyControls=createProxyControls({root:$('proxy-controls'),getContext:()=>documentState,canWrite:()=>writable && !busy && !unresolved,api:proxyAPI,notice,
  onPrepare:(context,current)=>queueProjectProxies(context,current,true),
  onChange:(settings,meta)=>{
    const changed=proxySettings && (proxySettings.enabled!==settings.enabled || proxySettings.quality!==settings.quality);
    proxyCacheAvailable=meta.cache?.available!==false;proxySettings=settings;$('source-quality').value=settings.enabled?settings.quality:'original';paintProxyBadges();
    if(changed){programPlayer?.stop();viewer?.invalidate();previewCache?.refresh();if(viewerMode==='source' && sourceOpenId){if(currentSourceItem())void reopenSourceQuality();}else if(viewerMode==='program')void seek();}
    if(settings.enabled && proxyCacheAvailable){const epoch=meta.project_epoch;void queueProjectProxies({project_epoch:epoch,settings,cache:meta.cache},()=>documentState?.project_epoch===epoch && proxyCacheAvailable && writable && !busy && !unresolved);}
  }
});
void proxyControls.refresh();
setInterval(()=>{if(documentState)recoveryPanel.refresh();},3000);
voiceover=createVoiceover({root:$("voiceover-dialog"),getClientId:()=>clientId,canCommit:()=>writable && !busy && !unresolved,commit,notice,playback:{video:$("program-video"),clock:()=>programPlayer?.recordingClock(),start:async()=>{fastTransport.normal();await programPlayer.toggle();if(programPlayer.state()!=="ready")throw new Error("Composed playback is unavailable; try recording without playback");},pause:()=>programPlayer.stop()},onProgress:(progress)=>{
  if(progress && (!documentState || !timeline || progress.project_epoch!==documentState.project_epoch || progress.generation!==documentState.generation || progress.timeline_id!==timeline.id || progress.revision!==timeline.revision))return;
  view.recording=progress;if(progress && timeline){view.recording.length_frames=Math.floor(progress.seconds*timeline.fps.num/timeline.fps.den);if(progress.withoutPlayback){view.playhead=Math.min(1_000_000_000,progress.start_frame+view.recording.length_frames);updateTime();}}canvasTimeline.invalidate();
},getTarget:()=>documentState?.project_name && timeline && timeline.id!=="fixture"?{project_epoch:documentState.project_epoch,generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,start_frame:view.playhead,tracks:timeline.tracks.filter((track)=>track.kind==="audio" && track.armed && !track.locked).map((track)=>track.id),formats:documentState.recording_formats,canPlayback:!!documentState.capabilities.playback && timeline.tracks.some((track)=>track.clips.length)}:null});
silencePanel=createSilencePanel({root:$("silence-dialog"),notice,preview:(ranges)=>{view.silencePreview=ranges;canvasTimeline.invalidate();},canCommit:()=>writable && !busy && !unresolved,commit:(operation)=>commit(operation),getTarget:()=>{
  if(contextSilence && !contextOwnerCurrent(contextSilence))return null;
  const ids=contextSilence?.media_ids ?? view.selection;
  if(!documentState || !timeline || timeline.id==="fixture" || !ids.length)return null;
  const end=Math.max(1,...timeline.tracks.flatMap((track)=>track.clips.map((item)=>item.start_frame+item.length_frames)));
  return {query:{project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,frame:Math.min(view.playhead,end-1)},clip_ids:[...ids]};
}});
$('silence-dialog').addEventListener('close',()=>{contextSilence=null;});
for(const button of document.querySelectorAll('button[data-inspector-tab]'))button.addEventListener('click',()=>setInspectorTab(button.dataset.inspectorTab));
$('inspector-content').addEventListener('click',event=>{if(event.target.closest('[data-inspector-auto-balance]'))workspaceTool('Color','Auto balance');});
$('close-browser').addEventListener('click',()=>{editor.classList.remove('browser-drawer-open');updateBrowserToggle();document.querySelector('#workspaces [data-panel="Media"]').focus();});
$('viewer-volume').addEventListener('input',()=>{for(const video of [$('source-video'),$('program-video')])video.volume=Number($('viewer-volume').value);});
for(const button of document.querySelectorAll('[data-ui]'))button.addEventListener('click',()=>{
  switch(button.dataset.ui){
    case 'save-as':$('projects-button').click();$('save-as-project').elements.name.focus();break;
    case 'play':$('play').click();break;
    case 'curves':if(curveWindow.isOpen())curveWindow.close();else openCurveWindow();break;
    case 'scopes':scopesWanted=!scopesWanted;showWorkspace('Color');scopes?.setVisible(scopesWanted && viewerMode==='program' && !scopesSuspended);break;
    case 'meters':workspaceTool('Audio','VU / spectrum');break;
    case 'voiceover':workspaceTool('Audio','Voiceover');break;
    case 'review':workspaceTool('Review','Compare A/B');break;
    case 'annotations':workspaceTool('Review','Shot / Take grouping');break;
    case 'edit-workspace':showWorkspace('Edit');break;
  }
});
document.addEventListener('toggle',event=>{
  if(!event.target.matches?.('.app-menu') || !event.target.open)return;
  syncSelectionActions();
  for(const menu of document.querySelectorAll('.app-menu[open]'))if(menu!==event.target)menu.open=false;
},true);
for(const type of ['pointerdown','focusin'])document.addEventListener(type,event=>{commandOwnership.note(event.target);syncSelectionActions();},true);
document.addEventListener('click',event=>{
  const menu=event.target.closest?.('.app-menu');
  if(event.target.closest?.('button') && menu)menu.open=false;
  else if(!menu)for(const open of document.querySelectorAll('.app-menu[open]'))open.open=false;
});
document.addEventListener('keydown',event=>{
  const menu=event.target.closest?.('.app-menu');if(!menu)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.open=false;menu.querySelector('summary').focus();return;}
  if(isTextTarget(event.target) || !['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  if(['ArrowLeft','ArrowRight'].includes(event.key)){
    const menus=[...document.querySelectorAll('.app-menu')],next=menus[(menus.indexOf(menu)+(event.key==='ArrowRight'?1:menus.length-1))%menus.length];menu.open=false;next.open=true;next.querySelector('summary').focus();return;
  }
  menu.open=true;const controls=[...menu.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(node=>node.getClientRects().length),index=controls.indexOf(document.activeElement);
  controls[(index+(event.key==='ArrowDown'?1:controls.length-1)+controls.length)%controls.length]?.focus();
},true);
connect().then(diagnostics);
