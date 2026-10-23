# UX/UI specification — professional NLE with AI review

## Native proxy controls — 2026-10-23

`a95b4a6` on halo1/8830 keeps proxy controls inside Playback > Proxies: Use
proxies, Low/Medium/High, Pause/Resume, Generate missing and explicit Refresh.
Actual native status/progress and the job list are folded in this menu. Small
thumbnail badges identify ready, paused, pending or failed jobs; folder/layout
rebuilds retain the status. No extra Viewer row is reserved. Source and Program
share enable/quality. Disabling uses original Source dimensions; exports always
retain original media and audio. Changing enable/quality invalidates obsolete
preview attachment while preserving the selected Source and its clock/range.
Pause alone preserves playback. Hidden or modal menus detach their observer
without canceling jobs; failed or unconfirmed writes are not replayed. Active
polling is bounded and status-only changes do not reopen the Source.

The actual Windows workflow parks generation at1/264 frames, resumes the same
job to Ready, uses that proxy in Program and reaches EOF456. The Full HD export
is identical to the earlier original-media export and plays to file EOF.
Settings and valid ready cache persist across server restart in6764b2d/halo1/8831.
Actual restart while Saved/empty history returns the same Medium proxy Ready
with generation paused; no recoding occurs. Program and export playback reach
EOF. The current controls remain compact and unchanged;16 previous editors are
preserved. Idle status records do not pin disk files, actual decoder leases do.
Malformed/foreign and pre-intent crash leftovers are preserved/refused, rather
than inferred Ready. See `evidence/f2-native-proxies-durable-workflow.json` and
its recovered/workspace screenshots. Source browser conversions and full M7
acceptance remain separately tracked.

## Owner reference update — 2026-10-22

The five original-editor screenshots supplied by the owner take precedence over
the earlier exploratory workspace styling below. Match their compact menu and
panel hierarchy, neutral charcoal/orange palette, media rows, contextual
Video/Audio/Selection properties and dominant central Viewer. Ordinary editing
must not reserve rows for a command catalog, diagnostics, clipboard operations
or all advanced timeline policies. Those actions remain reachable in menus and
collapsible sections. Media/Properties resize independently; narrow embedded
browser widths use explicit drawers instead of horizontal overflow. Existing
functional, accessibility and session-preservation requirements remain.


Media presentation (`e204001`, halo1/8829) follows native Details/List/Grid.
Three22px buttons share the existing counter row. Details uses64×36 thumbnails,
46px rows and real native metadata; List uses16px glyphs/23px rows without image
demand; Grid uses minimum80px tiles and16:9 thumbnails. Details/List show a
folder-first tree with14px depth, arrows and exclusive folder selection. Grid
shows immediate children, double-click/Enter navigation and ancestor breadcrumbs;
its search spans all project media. Tree search includes matching ancestors.
Name/Duration retain native ordering and a64px duration column. The divider
supports pointer resizing,8px arrows/1px Shift arrows and Home/double-click reset.
Only layout persists as a browser preference. Imported/pasted/Library items
reveal their ancestor tree or the last item's Grid parent. Hidden selection is
pruned to preserve existing Web mutation safety. Native pool marquee, contextual
menus and folder drag are separate open work. See Details/Grid screenshots in
`evidence/f2-media-presentation-workflow.json`.

Project import/recovery (`e41e9cc`, halo1/8828) uses compact modal choosers, adding
no permanent row to the Viewer. File > Import media browses approved nested
sources, selects files across folders/pages or imports an explicit child tree;
the project destination defaults to Root and remains an explicit choice. Folder
structure follows native import semantics and file errors do not hide successes.
Media and folders exposes selected-media or recursive current-folder Relink.
ByName leaves readable sources unchanged and reports missing/skipped/ambiguous
results; collapsed explicit replacements accept renamed files. Apply creates one
native Undo. Closing preparation cancels only its owned job, while committing
blocks close/reopen and unknown outcomes cannot repeat automatically. Reopening
clears prior result counts and folds details. See the actual Windows import,
Relink and final workspace screenshots in `evidence/f2-project-media-workflow.json`.

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

Name/Duration Media headers use native ascending/descending comparisons. Shift
ranges and batch drag order follow visible sorted rows. A selected row drags
the whole selection; an unselected row first selects only itself. Project pool
placement uses whole sources/all audio streams, independently of Source marks.
Timeline > Insert selected media is the accessible alternative; Enter on a row
keeps Open. The batch shows destination/new-track/safe-overlap feedback and makes
one Undo. Filters remove hidden mutation targets and invalidate stale Relink
drafts. Cosmetic sorting preserves selection/anchor and does not reopen Source.

## 4. Source and Program Viewer

Viewer control strip: switch Source/Program; Play/Pause; frame stepping; In/Out, current timecode with tabular numbers; Fit/100%; optional safe guides and overlay handles. Source I/O is a selection of a source media, not a timeline edit; Program I/O is the export range and not necessarily saved in `.vvproj` (match upstream). Fullscreen viewer via keyboard.

Viewer must expose statuses: CURRENT, SEEKING, STALE_REVISION, MEDIA_OFFLINE, FRAME_FAILED, PREVIEW_QUALITY_REDUCED. A stale frame may remain visible with clear label but cannot be shown as current. Suppress older seek frames after newer requests. Source video playback can use a browser-compatible proxy; Program preview must include compositing, text, transitions, masks and synchronized audio.

Special **Slip viewer**: when using Slip tool, split viewer into clip's new In and Out frames; show available handles before/after. This is a native Venturi UX feature, not optional future AI nice-to-have.

Drag the received Source video/image to insert its verified marked range with
all available streams. Two compact hover/focus handles select video only or all
audio streams; preview audition selection does not restrict insertion streams.
The timeline shows native target/new-track outlines and safe overlap feedback.
Source options > Insert marked range provides streams, destination and Insert
at playhead for keyboard users. These controls stay collapsed during ordinary
editing and regain availability after a drop. Source Play at the full file's
final frame returns to absolute zero, preserving quality/audio preview choices.

Audio-only Source replaces the video surface with full-original-file waveforms,
one lane per stream, independent of audition selection. Native outside-mark
shading and a common absolute playhead remain visible. Click release seeks with
the native floor/clamp rule; a real drag inserts the marked range without also
seeking. Focused Left/Right/Home/End navigate Source while text and timeline
owners keep their shortcuts. Video zoom is disabled for waveforms. Many streams
scroll through readable lanes; only visible lanes demand analysis through the
existing serial queue/cache. Preparing/analysis states remain explicit; loaded
lanes can keep painting during playback, while new analysis waits for idle.

Normal Source playback prepares at most one adjacent native window while the
current attachment and absolute clock remain active. A short status tooltip
reports this background preparation. At EOF, recheck its original
file identity, range and audio selection, drain the previous fast-audio tail,
then attach and verify the exact absolute boundary before continuing. If it is
still pending, show the existing paused preparation state. Speculative errors
leave the current movie playing; failure at the boundary requires manual Play.
User pause, seek, Stop or hidden/modal policy detach the local future observer
without canceling a shared native job. Fast audio retains foreground rollover.

## 5. Timeline spec

Implemented Canvas geometry in CSS pixels: track header 150; ruler 48 high
(24 tick band, 18 marker lane, 6 cache stripes); track height 62; trim hit zone 8;
snap threshold 10 screen px, rounded to native frame units; playhead 2px.
Video lanes display in reverse native order and audio lanes in native order.
The 8px divider separates independently scrolling panes; video rows anchor
above it and audio rows below it. Shift+wheel adjusts row height (40–160px);
wheel scrolls the pane under the pointer and horizontal wheel pans time.
Painted scrollbars and inertial scrolling remain separate requirements.

Marker lane: click seeks to the marker, drag moves it, range ends resize, and
Alt+drag extends a point into a range in either direction. Moving a range can
snap either end to clip edges/playhead. The local ghost preserves note/color/ID;
only pointerup sends one guarded native command. Escape, capture loss and pointer
cancellation discard the draft. Double-click opens the matching numeric marker
editor; this remains the keyboard-accessible path for position, duration, note,
color and deletion. Tick-band clicks continue scrubbing under range markers.

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
