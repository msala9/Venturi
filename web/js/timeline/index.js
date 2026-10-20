import { createDraw } from "./draw.js";
import { createInput } from "./input.js";
export function createTimeline(options) {
  const draw = createDraw(options.canvas, options.getTimeline, options.view, options.getAssets);
  const input = createInput({ ...options, invalidate: draw.invalidate });
  return {
    ...draw,
    cancel: input.cancel,
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
