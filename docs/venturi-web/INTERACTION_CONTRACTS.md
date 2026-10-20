# Low-level web component contracts

The goal is measurable input behavior, not a framework. Use the following as a starting point, revise after G0.

## Timeline module boundaries

```js
// Proposed interface, not pre-existing code.
createTimeline({canvas, overlay, getDocument, dispatchCommand, getView, setView})
  -> {setDocument(snapshot), setViewport(bounds), destroy()}
```

Split pure calculations into `geometry.js` (time/frame/coordinates, selection bounds, snap candidate scoring, hit zones), `input.js` (pointer state transitions and per-user-command draft) and `draw.js` (visible portion painting and dirty-region invalidation). `destroy()` removes listeners, aborts seeks and releases image cache references. Avoid global listeners with uncertain owners.

`getDocument`: **confirmed** immutable snapshot; never writable by UI.
`getView/setView`: client-only playhead, zoom, selection, scroll, active tool and focused panel.
`dispatchCommand`: one call after a user gesture; never per pointer movement.

## Geometry and timing

```js
// Conceptual pure functions:
frameToX(frame, originFrame, pxPerSecond, fpsNum, fpsDen)
xToFrame(x, originFrame, pxPerSecond, fpsNum, fpsDen)
visibleFrameRange(width, originFrame, pxPerSecond, fpsNum, fpsDen)
snapFrame(proposedFrame, candidates, thresholdPx, viewport)
```

Use integer frame indices for editing; `pxPerSecond` is a drawing scale only. Validate >0 FPS numerator/denominator; avoid 53-bit JS integer overflow for extreme timelines, limit supported frame ranges or use BigInt in isolated conversion logic only when needed. `xToFrame` should specify floor/round behavior based on operation (seek vs trim); don't make both silently round differently.

Snapping candidates (if visible and enabled): playhead, marker, edit in/out edges, in/out timeline range, transition handles. Clip lock state and audio/video track legality override snapping. Ghost alignment must use the same candidate chosen for actual commit.

## Pointer state transition table

| Current state | Input | New state / behavior |
|---|---|---|
| idle | pointerdown on clip body | maybe-move / capture pointer |
| idle | pointerdown on edge | maybe-trim / capture pointer |
| idle | pointerdown ruler | scrubbing |
| idle | pointerdown blank + selection tool | selection rectangle |
| maybe-move | movement over drag threshold | moving, render ghost; no network |
| maybe-trim | movement over threshold | trimming, render bounds; no network |
| moving/trimming | Escape | abort draft; restore visual snapshot |
| moving/trimming | pointerup | validate local legality; exactly one command |
| any gesture | lostpointercapture/blur | cancel safely; never silent destructive commit |
| waiting server | 200 | replace snapshot, clear ghost |
| waiting server | 409 | clear ghost, load authoritative snapshot, announce conflict |
| waiting server | transport timeout | unknown; query same command ID; no blind retry |

Keyboard selection and menus should produce same command payloads as pointer paths. Browser input fields suppress editor shortcuts; model selectors and dialogs trap focus only when modal.

## Undo / batching

One slider interaction emits a **single** `set` command at release. For local visual preview, use display-only draft and request a bounded still frame, but do not create a new server-side undo per pixel. A multi-clip drag must preflight all linked-group moves and map results atomically. `Undo` is routed to Session history rather than being a browser-only reversal.

## Error and loading presentation contract

- Pending: show temporary ghost and a compact unsaved marker; do not freeze unrelated panels.
- 409 overlap: keep last confirmed document, red drop invalid reason, never discard other clips.
- 409 revision: refresh, show concise toast and allow user to retry intentionally.
- 503 GPU: timeline remains interactive; viewer shows diagnostic and optional software fallback if actually supported.
- `stale preview`: last image may remain with label and subtle dimming; render completion under old revision never clears label.
- Offline media: keep clip on timeline, badge + relink link, not a broken black screen reported as success.

## AI Review contracts

`Shot` is a user-defined logical grouping; `Take` is a MediaId with optional data. Replacement request must name selected clip ID and new MediaId, expected timeline revision and explicit duration/audio policy. User may see a preview of changes but no commit until confirmation. Preserve media source originals and undo path.

## Inspector contracts

Each row has label, numeric control, reset, optional keyframe diamond and prev/next marker; keyboard path must be equivalent to drag. Control constraints come from source Rust, not hardcoded JS assumptions. Number input uses local edit buffer until commit; invalid intermediate text doesn't immediately reset to default.

## Viewer contracts

Separate viewer time from authoritative timeline playhead where Source viewer is active. Program viewer state owns `(timeline_id, revision, frame, request_seq)`. A matching response is the only one allowed to render as CURRENT. Maintain source/audio clock when paused/resuming; seeking changes playback generation. Audio/video playback and microphone recording are browser-specific; avoid cpal dependencies in web host request handler.
