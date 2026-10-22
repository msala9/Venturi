import { createDraw } from "./draw.js";
import { createInput } from "./input.js";
export function createTimeline(options) {
  const draw = createDraw(options.canvas, options.getTimeline, options.view, options.getAssets, options.onPaint, options.getCache);
  const changed=()=>{options.onNavigationStateChange?.();draw.invalidate();};
  const input = createInput({ ...options, invalidate: changed });
  return {
    ...draw,
    invalidate(){input.checkPresetDrop();input.checkGapSelection();input.checkSelectionAnchor();changed();},
    cancel: input.cancel,
    closeGap:input.closeGap,
    rippleDelete:input.rippleDelete,
    selectGap:input.selectGap,
    canCloseGap:input.canCloseGap,
    handleGapKey:input.handleGapKey,
    checkGapSelection:input.checkGapSelection,
    selectTimelineClips:input.selectTimelineClips,
    selectClip:input.selectClip,
    checkSelectionAnchor:input.checkSelectionAnchor,
    canSelectTimeline:input.canSelectTimeline,
    handleSelectionKey:input.handleSelectionKey,
    transitionDnd: input.transitionDnd,
    presetDnd:{...input.presetDnd,start(item,current){options.onNavigationIntent?.();return input.presetDnd.start(item,current);}},
    navigationIdle:input.navigationIdle,
    destroy() {
      input.destroy();
      draw.destroy();
    },
  };
}
export function fixtureTimeline() {
  return {
    id: "fixture",
    name: "500 clip interaction fixture",
    fps: { num: 24000, den: 1001 },
    revision: "fixture",
    markers: [],
    tracks: Array.from({ length: 8 }, (_, t) => ({
      id: `${t < 4 ? "V" : "A"}${(t % 4) + 1}`,
      kind: t < 4 ? "video" : "audio",
      locked: false,
      clips: Array.from({ length: t < 4 ? 63 : 62 }, (_, i) => ({
        id: `fixture-${t}-${i}`,
        name: `Demo · Shot ${i + 1} / Take A`,
        start_frame: i * 150,
        length_frames: 120,
        linked_group: null,
      })),
    })),
  };
}
