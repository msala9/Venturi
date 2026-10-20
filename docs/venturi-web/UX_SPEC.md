# UX/UI specification — professional NLE with AI review

## Core objective

Port the **capability surface** of the native Venturi UI, not its exact pixel layout. Keep Edit, Color, Audio and Review workspaces; keep editing engine and undo authoritative in Rust. The browser must never pretend to have applied an edit that the server rejected. A user should know *where* a tool is even when its underlying server integration is not complete.

## 1. Navigation and shell

**Screens:** Projects (recent/open/new/recover), Editor (persistent timeline/project), Review (workspace within Editor, not a new project).
**Workspace presets:** Edit, Color, Audio, Review (one editor state, one timeline). Always show an active workspace indicator. Panels are docked, resizable, collapsible; keyboard-accessible splitters. Persist panel sizes in local browser preferences, not `.vvproj`.

Desktop baseline 1920×1080, min full editing layout 1280×800. Reference sizing (CSS px): header 44, toolbar 36, status 26, side media 280, inspector 300, timeline 40% of available vertical space with min 180, viewer min height 220. DevicePixelRatio-aware Canvas; no assumption 1 physical pixel per CSS px. More than one timeline opens in tabs; each timeline has own fps/resolution.

Panel registry (single instance each): Media, Effects, Shared Library, Presets, History, Properties, Curves, Color, Scopes, Mixer, EQ, Compressor, Voiceover, Export, Diagnostics. Workspace changes only visible layout, never editing state. Quick panel launcher and command palette Ctrl+K, no sidebar menu maze.

## 2. Edit workspace layout

| Region | Content | Detail |
|---|---|---|
| Top bar | app, project/timeline, save status, undo/redo, export | Show stale / saving / connection explicitly |
| Left tabs | Media / Effects / Library / Presets / History | Search, list/grid, drag sources or effects, folders, AI Shot/Take group |
| Center | Program/Source Viewer, transport | One major viewer; mode toggle; optional overlay controls; precise TC |
| Right | Inspector | Rebuild panel based on selection; fields/sections collapsible, one commit per gesture |
| Bottom | multitrack Canvas timeline + heads + ruler | 60fps target for canvas interaction regardless of preview status |
| Bottom status | connected, cache, preview quality, render jobs, selected Vulkan GPU | Never claim HW decode merely because GPU is present |

## 3. Media browser

Tabs: All / Scenes / Audio / Titles; view modes Grid/List/Scenes/Favorites. Single click selects, double click opens Source Viewer, drag starts an Insert preview, keyboard moves focus by item. Thumbnail hover scrub opt-in for performance, not automatically seeking large files on every pointer move. Search by file/shot label and, if available, indexed prompt/model tags. Render Offline placeholder with Relink; preserve metadata. No UI operation deletes source files without a separate explicit confirmation and safe path policy.

## 4. Source and Program Viewer

Viewer control strip: switch Source/Program; Play/Pause; frame stepping; In/Out, current timecode with tabular numbers; Fit/100%; optional safe guides and overlay handles. Source I/O is a selection of a source media, not a timeline edit; Program I/O is the export range and not necessarily saved in `.vvproj` (match upstream). Fullscreen viewer via keyboard.

Viewer must expose statuses: CURRENT, SEEKING, STALE_REVISION, MEDIA_OFFLINE, FRAME_FAILED, PREVIEW_QUALITY_REDUCED. A stale frame may remain visible with clear label but cannot be shown as current. Suppress older seek frames after newer requests. Source video playback can use a browser-compatible proxy; Program preview must include compositing, text, transitions, masks and synchronized audio.

Special **Slip viewer**: when using Slip tool, split viewer into clip's new In and Out frames; show available handles before/after. This is a native Venturi UX feature, not optional future AI nice-to-have.

## 5. Timeline spec

Geometry in CSS pixels: track header 150; ruler 30 high; video track 64; audio track 56; collapsed track 28; trim hit zone 8; snap threshold 8 screen px, not time units; playhead 2px; grab handles have larger input hit area than visible geometry.

Canvas layers drawn in order: background/grid, track lanes, clips/fills, thumbnails/waveforms, transitions/speed/fades/markers, selection borders/ghost, playhead and snap guides. Separate static grid/ruler from frequently updated playhead where beneficial, but do not multiply canvases gratuitously. Redraw with requestAnimationFrame only when dirty. Cull time range and tracks outside viewport. Cache scaled thumbnails/waveform sampled arrays with memory cap.

Interaction state machine: `idle` -> `select|rect_select|scrub|move|trim|slip|resize|pan|speed_handle|transition_handle`; one active pointer gesture. `pointercapture` on drag; Escape aborts local draft; loss of pointer capture cancels or completes safely; no network on pointermove. Show drop effect and overlap consequences before pointerup.

**Default Safe Move:** if destination contains other material, invalid; no silent overwrite. `Insert/Ripple` and `Overwrite` are distinct, explicit modes. Linked audio and locked tracks are handled together. A successful gesture causes exactly one undo step. No undocumented shortcuts that conflict with browser editing text. Inputs capture keyboard while focused.

**Time semantics:** integer timeline frames; fps rational; `source_in/out` are media frames. Timecode uses project frame rate and supports 24000/1001, 30000/1001; inspect actual drop-frame convention before adding DF labels. Scroll zoom anchors under pointer or playhead. Sticky clip timecode during drag. Snapping uses pixel threshold and visible timeline edges/markers/playhead, with lock and disabled track rules.

## 6. Inspector and curves

Contextual sections for video: Transform (position, scale x/y link, rotation, anchor, flip), Crop + softness, Speed / pitch, Opacity / blend mode, Filters stack, Masks, Titles, Clip/Track audio, Transition, Metadata. Audio: Gain/fades, normalization, effects. Multi-select: only shared parameters. Title: typography/alignment/background/shadow. Keyframe diamond per animatable row, arrows for prev/next, default vs animated value, numerical scrubbing with Shift fine control. Update temporary draft locally; single Rust commit on release. Cursor animation is not eased while manipulating a value.

Curves editor: panel that can occupy upper timeline area or float, dedicated canvas with bezier handles and graph bounds; interpolation Hold/Linear/Ease/Bezier as upstream. Numeric inputs and keyboard alternatives for accessibility.

## 7. Effects, generators, masks and transitions

Left Effects tab: Generators (Solid Color, Title, Adjustment), Filters (color correction, exposure, gaussian/box blur, drop shadow), Transitions (Push, Cross Dissolve, Smooth Cut) and saved Presets. Search and category browse; drag onto clip or at cut point. Masks in viewer: rectangle/ellipse/path with points, rotation, feather, invert and combining modes. Track mattes alpha/luma. Preserve 15 blend modes via native enum; do not reimplement compositing in browser.

## 8. Color workspace

Program Viewer plus keyframeable shadows/midtones/highlights/offset wheels, per-range saturations and boundaries, Auto Balance, scopes two at once (waveform/RGB parade/vectorscope/histogram). Measurement must use same input stage as upstream: the clip being graded, not necessarily the fully composed project. Scope display may use server-produced measurements or bitmap payload; design binary frame/scope bandwidth separately. UI palette never recolors RGB technical measurements.

## 9. Audio workspace

Timeline with tall waveforms, mixer strips for every audio track and master (gain, pan/balance, mute/solo, level meter). Ordered effect chain (6-band EQ, three-band multiband compressor, normalize, mono, bypass). EQ graph and actual freq/Q/gain + presets, compressor threshold/ratio/attack/release/crossover/return. Clip and track normalization: peak, true peak, loudness (EBU R128) if upstream supports.

Voiceover: get mic access in Windows browser with user gesture, record/monitor/stop, upload into safe project work dir, align to project time, import as take; test browser permissions, latency correction, disconnect and no duplicate import. Never route Windows microphone to the Linux OS implicitly. Preview synchronizes A/V with a master media clock; don't promise perfect 8x audio until implemented.

## 10. AI Review workspace

Side-by-side A/B media previews (equal elapsed seconds by default), take labels, model/prompt/seed only when known, Favorite/Reject flags, quickly swap and select, explicit Replace Take. When durations differ present choices: preserve edit duration with available media range / shorten explicitly / cancel; never silently retime. AI Shot/Take metadata lives in a versioned sidecar not in project core. UI must keep rendering even when metadata absent.

## 11. Project, export and jobs

Project browser: new/open/recent/recover/duplicate, safe remote path picker. Export is a nonmodal side panel: destination within allowlisted root; in/out or entire; H.264 MP4 initially; encoder/decoder choices based on real probes; size/quality; progress and stage speed; background job status retained after tab reload. Unknown capability -> hide/disable with reason, never fake an encoder. Only one export concurrent pending actual code verification.

## 12. Keyboard plan (proposed, validate against upstream and browser)

Space play/pause, arrows frame stepping, I/O In/Out, V Select, B Blade, T Split, Y Slip, N Snap, M Marker, H Hand, +/- Zoom, Shift+F Fit, Ctrl+K command palette, Ctrl+S Save, Ctrl+Z/Shift+Ctrl+Z Undo/Redo, Delete lift/delete, Shift+Delete Ripple (confirm against host shortcuts); R arm audio only in Audio scope. Escape cancels drafts, dismisses overlays, then deselects. Editor shortcuts do **not** fire in inputs/textareas/contenteditable or active dialogs.

## 13. Accessibility and error states

HTML semantic menus/buttons and real number fields, keyboard focus visible, splitter keyboard controls, screen reader accessible track/clip list synchronized with Canvas (do not claim Canvas accessible on its own). Touch not a v1 priority, but controls must not be tiny. Respect reduced motion and OS scaling. Errors: offline media, stale revision, server disconnected, unavailable GPU adapter, timeouts, failed exports, unsaved changes, duplicate sessions. Allow user to recover or retry without losing edit history.

## 14. Visual acceptance

1920×1080, 1440×900, 1280×800; Windows 100%,125%,150% scaling. Keyboard-only media select/edit, 500-clip timeline performance, stop/rewind/scrub during server delay, resize panels, projector/second monitor optional future. Review before claiming UI completeness: compare against every screenshot in `media/screenshots` + original desktop panel inventory.
