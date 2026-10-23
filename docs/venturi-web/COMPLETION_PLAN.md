# Active completion plan — full Venturi Web scope

## V1 audio tradeoff — owner decision, 2026-10-23

The owner explicitly accepted applying audio effects with video stopped and
asked that V1 avoid low-benefit live-edit complexity. Keep native DSP, mixer,
insert ordering, parameters, presets and audio export in scope. Real-time mix/FX
updates during uninterrupted Program playback are deferred beyond V1; they are
not a prerequisite for these ordinary editing capabilities or a third excluded
feature. The two existing NOT-PLANNED capability rows remain the only exclusions.

For V1, pause Program before committing an audio/mixer/effect change, invalidate
obsolete prepared audio/meters, preserve the playhead, and use explicit Play to
prepare/hear the latest confirmed native mix. Never keep playing stale baked AAC
as if it reflected an edit. Failed/unknown writes retain existing reconciliation
and revision guards. Keep this interaction inside the Audio workspace; add no
persistent Viewer controls. Verify one connected stop/edit/play/save/export flow.
Retain any unshipped real-time prototype privately; do not ship unused cursors,
video lease APIs or a second audio-routing architecture for this deferred detail.

2026-10-22. The owner resumed the full implementation plan after accepting the
usable editing workflow. This file now controls the work order. DELIVERY_PLAN.md
and DELIVERY_HANDOVER.md remain the accepted baseline, not the scope limit.

## Goal and baseline

### Current execution host — halo1

The owner moved new work to free halo1 on 2026-10-22 because halo2 is shared
with an H3 agent. All new heavy work remains bounded on halo1. The existing
CIFS root is `/mnt/madrock-share/madrock-library`, presets use `presets/`, and
archive media uses the existing ds4 API on8787. No new NAS mount or Linux browser
is required. Preserve all earlier halo1 and halo2 editors and their Undo chains.

The current halo1 delivery is **http://127.0.0.1:8838/**, source `a2d1358`,
binary `72e5329138ac`, in `venturi-web-halo1-mixer-controls-r2.service`.
The Audio workspace now has a compact horizontal console with 84 px strips,
130 px relative gain faders and pan knobs. Gain uses the native 11-knot f32
mapping; pan uses normalized (dx-dy)/200 motion, with Shift at 0.1 sensitivity.
A gesture submits only its changed axis on release. Numeric Apply remains
available. No-op, canceled, stale, disabled and detached gestures do not write.

The bounded gate passes **40 client cases**, including six new top-level control
cases and seven cancellation subcases, formatting, all-target Clippy and embedded
build. The final CSS-only correction fixes Inspector specificity and aligns the
Master strip; its passing build reuses those unchanged 40 cases.
Actual Windows verification at 1280x720 confirms aligned native-sized controls,
keyboard master Gain 0 to -0.2 dB and Pan 0 to 0.01, double-click resets,
Undo/Redo and Save As/reopen. Final state is Saved in
`Venturi_Mixer_V1.vvproj`, master Gain/Pan 0, timeline1/frame0 and empty Undo.
OS pointer drags/Shift/cancellation were not physically qualified here; their
behavior is covered by deterministic client cases. All 22 prior Sessions,
23 PIDs, 11 Saved files, three originals and the shared proxy movie are unchanged.
See `evidence/m5-mixer-controls-workflow.json` and its workspace image.

This UI-only block changes no native DSP or Program/export transport; reuse the
qualified stopped-audio workflow in `evidence/m7-audio-source-fd-workflow.json`.
Interactive EQ and compressor graphs remain; the existing EQ response canvas
is read-only and compressor controls are numeric. Physical audio/hardware,
representative/dense/DPI and remaining M7 requirements stay explicit.
Ledger remains **49 done / 41 partial / 2 excluded**; the mixer row stays partial.

Preserved requested audio-source delivery: **http://127.0.0.1:8837/**, source `fc2c041`,
binary `4a2b7b7cd0bf`, in `venturi-web-halo1-audio-source-fd.service`.
An optional native audio resolver now confines the existing Program audition,
scrub, fast-audio-window and meter paths to requested approved-root sources.
Decode leases retain pinned FDs; parent lineage and strong ctime witnesses
reject substitution, including restored-mtime changes. Native Normalize/pitch
paths share the resolver without rewriting Project paths. Conservative audible
metadata preflight remains, including out-of-window DSP dependencies. Desktop
defaults and durable composed-movie/export audio keep their existing native path.

The bounded halo1 gate passes **14 cases** (3 audition, 7 frame-source adapter,
4 native audio), formatting, all-target Clippy and embedded build; client code
is unchanged. The initial test-only file-handle type mismatch was corrected before
the terminal pass. Worker peak is 1,976,766,464 bytes within the 4 GiB/no-swap cap.
Actual Windows/API verification applies master Gain 0 to -6 dB and native
500 Hz EQ 0 to -12 dB while stopped. Undo reproduces the exact gain-only PCM
hash; Redo restores EQ. Explicit Play prepares the confirmed mix with native
insert telemetry and reaches frame 456 of 457. Save As/reopen preserves the EQ
PCM hash with empty Undo; the native Full HD 457-frame export reaches browser
EOF at 19.05 seconds. Final state is Saved at frame 0 in
`Venturi_Audio_V1.vvproj`; the original candidate file remains unchanged.
All 21 earlier Sessions, 22 PIDs, nine Saved hashes, three originals and the shared
proxy movie are preserved. See `evidence/m7-audio-source-fd-workflow.json` and
`evidence/m7-audio-source-fd-workspace.jpg`.

Ledger remains **49 done / 41 partial / 2 excluded**. This qualifies the connected
V1 stopped-audio edit/play/save/export workflow, not full F4 or M7. Uninterrupted
live DSP is deferred by the owner decision above; representative/dense/DPI,
physical-device and other functional/release requirements remain explicit.
No live cursor/video-lease infrastructure is included in this delivery.
Compact mixer faders and pan controls are delivered in a2d1358 above.

Preserved requested original video/still delivery: **http://127.0.0.1:8836/**, source `83ccf82`,
binary `05a3c90beea0`, in `venturi-web-halo1-frame-sources.service`.
Native preview decoders now open only requested original video/still sources
through the approved root, retain their FDs through decode and record parent/
strong-ctime witnesses. Program, scopes and Auto Balance share this additive
native seam. Cached static frames and prepared movies validate their actual
touched originals before reuse/publication. Missing legacy witnesses are misses.
Desktop defaults, durable exports, original metadata and native audio remain.

The bounded halo1 gate passes **96 distinct native cases** (98 executions with
two overlaps), formatting, all-target Clippy and embedded build. Client code is
unchanged. Actual Windows/API qualification covers video/still Program+scopes,
Auto Balance and cache refusal during controlled replacement of owned private
copies. Restoring originals returns identical PNGs/balance values. A prepared
movie's status/asset return SOURCE_CHANGED after its still changes; restoring
bytes does not forge its old ctime witness. The real457-frame montage reaches
native Ready and browser EOF456. The temporary filter is undone, then Saved and
reopened at timeline1/frame0 with empty Undo. Timeline DTOs/file media/folders/view
are unchanged; native compound invalidation counters advance normally during
edit/Undo. The candidate's three Saved counter-line changes are recorded.
All20 earlier Sessions,21 PIDs,eight Saved hashes and the shared proxy movie are
preserved. See `evidence/m7-original-frame-sources-workflow.json` and workspace image.

Ledger remains **49 done / 41 partial / 2 excluded**; full F1-F7/M7 stays active.
Requested audio confinement for existing audition/scrub/fast-window/meters is
delivered in fc2c041 above. Preview preflight conservatively retains the native
audible closure, including out-of-window pitch/Normalize/DSP dependencies.
Continue representative/dense/DPI/physical
acceptance and remaining functional/release blocks; do not claim all M7 complete.

Preserved degraded proxy-cache delivery: **http://127.0.0.1:8835/**, source `b588603`,
binary `3619229952f1`, in `venturi-web-halo1-proxy-recovery.service`.
An unavailable proxy cache now reports its error separately from confirmed
preferences. Use proxies, quality and pause remain writable; disabling receives
a real acknowledgment and uses originals. Generation, polling and Ready badges
remain unavailable until a fresh healthy catalog. Rejected or unknown writes
remain unconfirmed and are never replayed. Invalid preferences/root approval and
already captured changed leases retain their hard errors; unknown files remain.

The bounded halo1 gate passes 14 client cases and 21 native proxy cases, formatting,
all-target Clippy and the embedded build. Actual Windows verification uses the
same binary with a private qualification cache: a foreign sentinel causes the
warning; enable/disable is acknowledged; Program reports zero selected proxies
after disabling; original Source is 1920x1080 with its full 264-frame window and
all audio streams. Only the unchanged owned sentinel is removed; explicit Refresh
recovers status. The disposable Saved/empty-Undo qualification unit is then stopped.
The delivery uses the normal shared cache, retaining its existing entry unchanged.
All 19 prior Sessions, 20 service PIDs, seven Saved hashes and three originals match.
The five-clip timeline DTO/revision is unchanged, Saved at timeline 1/frame 0 with
empty Undo. Reuse existing playback/export evidence. See
`evidence/m7-proxy-cache-recovery-workflow.json` and the degraded/workspace images.
Ledger remains **49 done / 41 partial / 2 excluded**; full F1-F7/M7 remains active.
Requested video/still FD pinning and cache-hit validation are delivered in
83ccf82 above; requested audition/scrub/fast-window/meter audio in fc2c041.
Broader release qualification remains.

Preserved native Media interaction delivery: **http://127.0.0.1:8833/**, source `9e00d2c`,
binary `899e9aacc94f`, in `venturi-web-halo1-media-interactions-r2.service`.
The Media pool now follows the native background marquee, media/folder context
menus, inline folder/compound rename and media/folder/breadcrumb drops. A folder
menu targets the clicked ID while retaining the selected media group. File names
stay immutable. Contextual timeline duplication is immediate and rename targets
the clicked compound; neither switches the open Program timeline. Menu actions
reuse the existing New Timeline, OTIO, Relink and native Library flows. No new
Viewer control row is reserved.

No-op folder/media moves preserve native Undo/Redo. Metadata batches admit 256;
prepared Relink remains 64. Drops require current local drag ownership, native
epoch/generation and original membership. Post-command reveal/rename requires a
successful matching receipt, rather than inferring success from a refresh. Real
browser findings are fixed: queued drops survive dragend, folder name buttons
initiate dragging, and long-name input scrolling retains the rename editor.

The bounded halo1 gate passes 111 affected client cases and 8 native cases. Final
30 catalog/menu cases include the new scroll regression; unchanged client files
are reused, giving 112 distinct qualified cases without a fresh full-suite claim.
Formatting, all-target Clippy and the final embedded build pass. Actual Windows
verification covers context selection, new folder/rename, a real media drag with
one Undo/Redo, five-media marquee, immediate timeline duplication, long-name
rename and a real folder-name drag/Undo/Redo. Native Save/reopen preserves the
model and bytes; the original five-clip timeline DTO/revision is exactly unchanged.
Final Program is timeline 1/frame 0, Saved, with the native empty history after
explicit reopen. Renderer/playback/export code is unchanged; reuse the prior
457-frame Full HD/AAC exported-file EOF evidence.

See `evidence/f2-media-interactions-workflow.json` and context/workspace PNGs.
All 18 earlier Sessions/live Undo, 19 service PIDs including ds4, and 6 earlier
Saved byte hashes are preserved, including the unsaved 8832 qualification editor.
Halo2, AMD drivers, mounts and NAS content are untouched. Contextual Library
publication uses the qualified pipeline but was not exercised against the NAS.
The ledger remains **49 done / 41 partial / 2 excluded**: this completes the pool
interaction follow-up, not a new coarse capability. Full F1-F7/M7 remains active.
The degraded-cache follow-up is delivered in b588603 and requested video/still
FD pinning in83ccf82 and requested audition/scrub/fast-window/meter audio in
fc2c041 above. Broader release work remains.

Preserved durable proxy-cache delivery: **http://127.0.0.1:8831/**, source `6764b2d`,
binary `4a11e6f7c63e`, in `venturi-web-halo1-proxy-durable.service`.
Native proxy preferences and ready cache now survive server restart. A private,
versioned cache under the native user cache shares ready video across projects
and processes, with short catalog locks, per-entry generation/read leases,
explicit interrupted-work recovery and bounded count/bytes. Idle jobs retain
no artifact lease; active decoders prevent eviction. Current approved original
paths and strong versions remain mandatory. Contention yields to foreground
work instead of failing newly queued generation.

The 50 distinct affected native cases, formatting, all-target Clippy and embedded
build pass; unchanged browser/native pipeline checks are reused. Actual Windows
verification restarts only the isolated candidate while Saved with empty Undo.
The Medium proxy returns Ready while generation remains paused, with identical
inode, timestamps and SHA256: no recoding. Program uses the recovered proxy and
reaches EOF456. The 457-frame Full HD H.264/AAC export is byte-identical to prior
original-media exports and plays to file EOF. Native model, metadata, Saved bytes,
history and final frame0 are unchanged. See
`evidence/f2-native-proxies-durable-workflow.json` and recovered/workspace screenshots.
All 16 earlier Sessions/live Undo, 17 service PIDs including ds4 and four earlier
Saved projects are preserved. Halo2 and NAS are untouched.

`proxy_quality_settings` is accepted: ledger **49 done / 41 partial / 2 excluded**.
Full F1-F7/M7 remains active. Malformed/foreign cache files and pre-intent crash
leftovers are preserved/refused; arbitrary-power-loss automatic recovery is not
claimed. Source browser/audio conversion and its broader acceptance remain in
Source capabilities. The pool interaction follow-up is delivered above. Keep
the remaining audio-source boundaries, representative/dense/DPI/physical acceptance
and other F1-F7/M7 work explicit.

Preserved initial proxy workflow: halo1/8830, source `a95b4a6`, binary `f8fe8912da80`.
Enable/quality, real generation Pause/Resume, compact menu/Media badges, original
Source dimensions when disabled and ready-only Program proxy selection are
verified in `evidence/f2-native-proxies-workflow.json`. That earlier server uses
its private ephemeral cache; its Saved project, export and live state remain.

Preserved Media presentation delivery: halo1/8829, source `e204001`, binary
`c8a3bc799e10`. Native Details/List/Grid, folder navigation/search, real metadata,
resizable columns and visible-order selection remain available and unchanged.
See `evidence/f2-media-presentation-workflow.json`.

The preserved import/recovery delivery is **http://127.0.0.1:8828/**, source `e41e9cc`,
binary `3f777879477e`, in `venturi-web-halo1-project-media-r2.service`.
Approved nested files and folder trees now import through the isolated worker,
preserving native folder merge/pruning, path deduplication, per-file errors and
one Undo. Selected/folder ByName and explicit Chosen Relink use prepared native
SetMediaPath commands with source/scan/context witnesses and one Undo. The legacy
Relink route also prepares asynchronously. Fresh dialogs clear old result counts.
The83 affected native cases, formatting, all-target Clippy/build and1291 aggregate
client cases pass; the final caption fixes pass116 affected client cases, with
unchanged native results reused. Actual Windows import/UndoRedo, missing-file
recovery, five-clip Full HD montage, Program EOF456,457-frame H.264/AAC export
EOF and final Saved client reload pass. See `evidence/f2-project-media-workflow.json`
and three screenshots. Thirteen earlier halo1 editors, their files/Undo and ds4
are preserved; halo2/NAS are untouched. The ledger is now48done/42partial/2excluded:
ordinary native video/audio import is accepted. Full F1-F7/M7 remains active.
Next complete pool Grid/List presentation and proxy/derivative fidelity, then
representative-media and remaining full-plan functionality/acceptance. Keep
physical audio, dense/DPI and long4K qualification explicit.

The preserved project-pool delivery is **http://127.0.0.1:8826/**, source `5d8d15d`,
binary `7420a371bfe9`, in `venturi-web-halo1-project-pool.service`.
Project Media now drags selected visible rows in panel order, or inserts them
through Timeline > Insert selected media. The native whole-source builder
resolves tracks once, conforms endpoints, links all streams and makes one Undo.
Source marks/jobs are independent. Name/Duration headers use native comparisons;
search/folder/type filters clear hidden mutation targets and stale Relink drafts.
Current-session/file/lock/overlap/cycle guards and256-root/4096-clip admission
apply. The1270-case client gate,10 affected native cases, formatting, all-target
Clippy and build pass. Actual Windows Full HD video/still/two-stream audio
placement creates five clips and A2, with one Undo/Redo, keyboard insertion,
Save/client reload, Program EOF456 and457-frame Full HD/AAC exported-file EOF.
See `evidence/f2-project-pool-workflow.json` and screenshot. Eleven prior halo1
editors and ds4 are preserved; halo2/NAS are untouched. Ledger47/43/2 and full
F1-F7/M7 remain active. Next implement approved nested-source/tree import and
prepared project Relink, then remaining pool presentation and broader acceptance.

The preserved Source-lookahead delivery is **http://127.0.0.1:8825/**, source `4f94773`,
binary `318f29163b8b`, in `venturi-web-halo1-source-lookahead.service`.
Normal Source playback prepares one adjacent native window without replacing
the current movie, absolute clock, waveform or placement identity. A separate
local observer checks original file version, range and audio selection and pins
the ready job. EOF rechecks it, waits for the old audio tail and verifies the
absolute seek before continuing. Failed speculation leaves current playback
running; boundary failure requires manual Play. Pause/seek/Stop/hidden/modal
policy detach local observation without deleting shared jobs. Fast audio keeps
its existing foreground rollover. The189-case focused client gate/build pass.
The uninterrupted Windows67s/two-stream1x run prepares1800–2011 while0–1800 plays,
adopts that exact job and reaches originalEOF2010 without another Play. Saved
bytes, edit history and Program view remain unchanged. See
`evidence/f2-source-lookahead-workflow.json`. All ten prior halo1 editors and
ds4 remain preserved; halo2 is untouched. Ledger47done/43partial/2excluded and
the full goal remain active. Next complete remaining F2 import/proxy/derivative
fidelity and representative-media acceptance, then the other full-plan blocks.
Physical acoustic continuity and long4K/many-stream pressure remain open.

The preserved waveform delivery is **http://127.0.0.1:8824/**, source `f1fd010`,
binary `ae29b4545c2a`, in `venturi-web-halo1-source-waveform-r4.service`.
Audio-only Source now shows the full original waveform, one lane per stream,
with native marks, absolute playhead, click/keyboard seek and marked-range drag.
Visible lanes share the existing serial derivative loader and64-entry/64-MiB
cache; all128 streams remain reachable by scrolling. The video element stays
attached for audio, while video zoom is disabled. Interrupted visible reads can
resume when idle; actual failures and canceled explicit retries stay manual.
The actual two-stream67-second workflow loads both lanes without Refresh,
seeks beyond60seconds, replays from EOF, inserts two linked72-frame clips,
performs one Undo/Redo, saves, survives a client reload and plays its native
Full HD/AAC export to EOF with decoded non-silent audio. See
`evidence/f2-source-waveform-workflow.json` and screenshot.
The ledger remains47done/43partial/2excluded. Speculative Source
continuation is delivered in4f94773; remaining F2 behavior, physical audio, long4K, dense/DPI and
full F1-F7/M7 acceptance remain open. All earlier editors are preserved.

The preserved Source-placement delivery is **http://127.0.0.1:8822/**, source `9ecf29d`,
binary `2f3f3cdc11d1`, in `venturi-web-halo1-source-placement-r5.service`.
Source now drags its verified marked range with all streams, video only or all
audio streams into existing/new native tracks. A collapsed keyboard alternative
inserts at the Program playhead. Native file identity, rational endpoint
conforming, overlap/linked-lock policy, durable receipts and one Undo remain
authoritative. Source Replay at file EOF returns to absolute frame zero.
Project-view acknowledgements retain their CAS revision across playback and
late local snapshots; the earlier EOF position-persistence defect is fixed.
See `evidence/f2-source-placement-workflow.json` for the integrated import,
three-role placement, Undo/Redo, Save/reopen, natural playback and Full HD export.
All earlier editors, including8820/8821, retain their Sessions and Undo.
The ledger remains47 done /43 partial /2 excluded. The native
audio-only Source waveform surface is delivered in f1fd010; remaining Source/F2 behavior, physical
audio, long4K, dense/DPI and M7 requirements remain open.

The preserved Program-lookahead delivery is **http://127.0.0.1:8820/**, source `672b495`,
binary `7260ae71ec09`, in `venturi-web-halo1-program-lookahead.service`.
It prepares one adjacent Program window while the current movie plays, reuses
the existing bounded worker and preserves native DSP origin. A ready future is
kept alive with a ten-second heartbeat and revalidated at EOF; pending work is
adopted without another POST. Stop/pause/stale/hidden detach locally, without
deleting potentially shared native jobs. Resource failures never retry by
themselves or interrupt the current movie. The bounded halo1 gate passes 113
JavaScript cases and the embedded build; unchanged native tests are reused.
The actual Windows scenario imports moving A/V, inserts linked clips into a
1920×1080/24fps timeline, saves, plays 0–7275 naturally at 1× with 960×540 preview,
and plays a 75-frame Full HD/AAC export to EOF. Both windows retain audio origin 0.
See `evidence/f2-program-lookahead-workflow.json` for measured preparation,
scope and limitations. Its historical project-view CAS warning is fixed in
the current9ecf29d delivery; its Saved project bytes and Undo are unchanged. This closes the speculative
preparation gap, without claiming gapless playback or physical audio acceptance.

The preserved floating-Curves delivery is **http://127.0.0.1:8819/**, source `4e983c2`,
binary `16e283f83538`, in `venturi-web-halo1-curve-window-r2.service`.
Its independent Saved `Venturi_Curve_Window.vvproj` retains the animated Library
montage and changes the final Opacity key from30 to35. Curves now opens a single
nonmodal movable/resizable window without switching the Edit workspace. The
170px scalar graph and simultaneous animated lanes share native selection and
source clock; numeric, view and help controls are folded. The Inspector no
longer contains duplicate key editors. Paging follows the window, omits a
single-page pager and recovers stale pages independently of window visibility.

The bounded halo1 gate passes109 JavaScript and543 vv-web cases, formatting,
all-target Clippy and build. A final109-case client rerun and embedded build
cover the browser-found expander CSS correction and initial animated-row choice.
Actual Windows qualification covers pointer/keyboard move/resize, numeric draft
retention and close cancellation, geometry restored after browser reload,
three mixed keys deleted from the header with one Undo and all clips retained,
exact curve restoration, numeric Undo/Redo/Save, R9700 Program EOF with the
window open and native ruler source47 -> timeline315. Actual horizontal wheel
pan and plain wheel zoom pass. See `evidence/f1-floating-curves-workflow.json`
and screenshot. The four prior halo1 editors, project hashes, PIDs and live
Undo chains are preserved, along with ds4 and both NAS assets; halo2 is untouched.

The dedicated curve-window production gap is closed. Physical modifier-wheel
remains unverified: the current browser input API cannot hold a modifier across
wheel input; exact modifier/native-axis regressions pass. Keep that named
curve acceptance item explicit, alongside global DPI/dense-editing/M7 checks.
The functional ledger remains47 done /43 partial /2 excluded; full F1-F7 is active.

R9700 Vulkan discovery, real archived-video import, Source preparation,
timeline insertion, composed preview and project Save pass in the existing
Windows browser. Source `fd9bde4` also fixes delayed CIFS writer timestamps:
close the staged writer, pin the same file read-only and verify its full SHA
before the isolated probe. The bounded halo1 gate passes 45 asset-job cases,
formatting, all-target Web Clippy and the embedded build. Actual Windows native
asset publication on the NAS leaves the complete Session unchanged; importing
that asset creates an independent exact-byte project copy with one Undo entry,
preserves the timeline and saves. See `evidence/halo1-workspace-migration.json`
and `evidence/f5-nas-readonly-stage-gate.json`. Native/Web interprocess safety
on CIFS now passes the real native component/Web process gate below. The full
F5 desktop GUI acceptance remains open; direct Web placement now passes below.

Complete all remaining in-scope capabilities against the original native GUI,
the UX specification and M7 release criteria. FUNCTIONAL_PARITY.csv
started with 42 done and 48 partial capabilities. The current accepted source
ledger contains 47 done and 43 partial capabilities after the native compound,
freeze, independent-timeline/view, static Inspector and verified atomic take
replacement qualification. The two explicitly NOT-PLANNED
rows, speed_ramp_reverse and node_graph, remain excluded. Do not relabel partial
capabilities as finished merely because a small demo, API or component test passes.

`multiple_timelines_fps` is accepted from the independently created 24 fps Middle
and 30 fps Outer timelines, native navigation and restart in
evidence/m4-compound-navigation.json, the native 24000/1001 versus 30000/1001
navigation regressions, and actual remembered root positions, Save/reopen and
isolated restart in evidence/nativeview-workflow.json. This acceptance covers
timeline clocks and native ProjectView persistence; Canvas inertia, dense editing
performance and the remaining F1/M7 checks remain open.

Preserve the delivered workflow and accessible candidate at Windows port 8811,
currently code df50859. Do not disturb the protected port-8790 editor or its
five unsaved MoveClips operations and Undo history. Re-read every live editor's
state before deployment; the owner may have begun new work in the candidate.

The previous halo2 working delivery remains **http://127.0.0.1:8814/**, source `3952711`;
see `evidence/current-workspace-delivery.json`. Its enabled
`venturi-web-current.service` uses `/home/marco/VenturiWeb-current-20261022` and
the immutable qualified binary. The actual Windows page has a completed R9700
preview, compact Library and the existing ds4 HTTP archive (33 items observed).
Preserve this editor and its browser tab alongside 8790/8811/8812. Read all live
sessions and preserve client drafts before any future deployment. Use a separate
unused port for qualification. The full F1–F7 completion scope remains unchanged.

## Current owner priority — native UI and UX

2026-10-22: the owner supplied five screenshots of the original editor and
identified poor space use, excessive always-visible controls and a small Viewer.
Complete this cross-cutting interface block before further isolated feature
qualification. Preserve the full F1–F7 scope and all existing editing behavior.

Use a compact File/Edit/Timeline/Playback/View menu, native panel toolbar,
neutral dark palette, compact media rows and Video/Audio/Selection properties.
Give the video the main central area; put advanced operations in contextual
menus or collapsible sections. Keep the timeline below the Viewer/Properties
and the media browser at the side. At narrow browser widths, use explicit
side drawers without horizontal page overflow. Preserve accessible controls,
keyboard actions, drafts and native command ownership. Qualify the actual
Windows browser at desktop sizes and its observed 544-pixel side-panel width,
then guard any delivered-service upgrade against unsaved work. Build/render
checks now move to bounded halo1; no new browser installation or local server.


The native UI block is delivered at **http://127.0.0.1:8812/**, code
`f3dcf1c8b6fed838c7e48497922f127b96f9c35b`, with the new layout, compact
Inspector and contextual menus. Actual Windows qualification covers 1440×900,
1280×720 and the 544-pixel side panel, numeric edit/Undo/Save, seeking, timeline
resize, drawers and Program playback to EOF. See evidence/native-ui-workflow.json.
The protected 8790 editor still has its five unsaved moves. Port 8811 acquired
an unsaved InsertClips command, so neither its service nor its browser tab was
restarted/reloaded. The new enabled service `venturi-web-native-ui.service`
uses its own project root and the existing tunnel on 8812. The full ledger
was 45 done / 45 partial at that delivery; this interface acceptance does not close unrelated
functional or release criteria.

## Delivery blocks

The native mask/Slip source block `b06948b` now has actual Windows and R9700
qualification on integrated source `130b30e`. See
`evidence/f3-mask-inspector-workflow.json`: native Rectangle/Subtract Ellipse/
Intersect Path, source-clock scalar/path keys, Viewer pen/vertex movement,
reset/Undo, linked Slip in both directions, Undo/Redo and exact Save/restart.
Three retained transform/crop/fade references now match the API byte for byte;
three newly edited mask frames match native/API at both 320×180 and 1280×720.
Physical DPI and prolonged uncached held-Slip window continuity remain open.
Keep progressing the connected F5 shared library workflow and compact interface;
do not upgrade protected editors to bypass qualification. The accepted ledger
remains 46 done / 44 partial.

Current integration checkpoint (2026-10-22): selected Title/Solid/Filter controls
and native key navigation are implemented through bbf0fbb. The existing Windows
browser completed a separate 1280x720, 24 fps, 408-frame effects montage with two
distinct titles, selected styling/filter edits, Solid keys and linked HD media
audio, Save As/Save, H.264/AAC export, download and natural exported-file EOF.
See evidence/f3-effects-workflow.json for actual paths and remaining limits.
The finite qualification service was stopped Saved; the delivered port-8811
version remains df50859. Native compound grouping, selected media retiming and
native ProjectView persistence form the next coherent integration block. This
checkpoint does not close the full goal. Native grouping and Freeze subsequently
completed actual Windows controls at 125% scaling, one Undo/Redo, child/root mapping,
saved reopen and real isolated restart, plus a 392-frame 1280x720 R9700/AAC export
and exact downloaded-file playback. Compound Canvas double-click and pane rails
were exercised; GPU freeze-frame hashes were equal when held and different
after Undo. The compound_clips and freeze_frame rows are accepted. The delivered
port-8811 baseline still needs a guarded upgrade; broader release QA remains open.

Complete coherent user workflows in this order, taking independent source work
forward when hardware is busy. Do not restart the former sequence of tiny
feature/test/evidence increments. Each capability appears in exactly one block.

### F1 — editing, selection and Inspector

Capabilities: `multiple_timelines_fps`, `linked_groups`,
`select_multiclip_marquee`, `snapping`, `clip_move_safe`, `properties_static`,
`keyframe_editing`, `curve_easing_bezier`, `transform_crop_softness`,
`anchor_flip`, `clip_fades`.

Implement remaining native interaction and selected-target semantics together,
starting with the Inspector controls that still operate on only one selected
clip. Audit native property-specific target rules before extending batch writes.
Resolve timeline row ordering/selection and gesture gaps needed for reliable
ordinary editing. Accept one multi-track editing/Inspector workflow with linked
audio, locks, one-command gestures, Undo/Redo, saved reopen and relevant pointer,
keyboard and DPI checks. Existing accepted Blend/Matte behavior must remain valid.

The integrated native-gesture block is implemented and pushed at `9f7dcc4`. Its
bounded halo2 gate passes 1082 unique JavaScript and 493 unique vv-web tests,
all-target Clippy and build, reusing unchanged passing cases. Actual Windows
qualification exercises numeric scrub/sliders, pivot/Flip/crop/softness, Roll,
linked trim, video/audio fades, constant gain, shared cross-parameter key drag,
one Undo/Redo and exact five-timeline/ProjectView save/restart. See
`evidence/f1-native-gestures-workflow.json`. The `properties_static` row is now
accepted (46 done / 44 partial). Targeted TS017 transform/crop/fade references now
match the native/API frames in `evidence/f3-mask-inspector-workflow.json`.
Physical modifier/DPI and dense 500-clip acceptance remain open. The finite 8813
qualification instance is stopped Saved. Stable 8812 still runs `f3dcf1c`; none of
the three live editors was upgraded/reloaded or had client drafts discarded.

The native curve viewport and dedicated floating window are delivered as
`6a1f020` / `4e983c2` on halo1: see `evidence/f1-native-curve-viewport-workflow.json`
and `evidence/f1-floating-curves-workflow.json`. Native has one chosen scalar
graph plus all animated lanes; no simultaneous scalar overlay is missing.
Visible native sampling, adjacent tangent ownership, typed-row graph clearing,
shared selection and the complete nonmodal window lifecycle now pass. Actual
horizontal pan/plain wheel zoom pass. Keep physical modifier-wheel explicit
because the current browser input API cannot send a held modifier with wheel;
source/native-axis modifier regressions pass. Global DPI, modifier timeline
gestures and representative500-clip acceptance remain F1/M7 work. Avoid repeating
unchanged native catalog/render/export matrices for these Web-only key editor
changes. Continue remaining functional F2-F7 blocks while preserving this baseline.

### F2 — media, playback and export

Capabilities: `import_video_audio`, `source_viewer`, `program_viewer`,
`transport_play_pause`, `viewer_fullscreen`, `proxy_quality_settings`,
`thumbnail_workers`, `waveforms_cached`, `export_h264_aac`.

Finish actual Source/Program navigation, cache/derivative and transport gaps,
including browser continuation across the five-minute Program boundary with
audio. Verify a representative project at ordinary editing/output resolution,
not solely 64-pixel fixtures. Accept import through composed playback, edits,
save/reopen and exported-file playback in one workflow. Report preparation
pauses, throughput limits and actual codec paths honestly; do not imply gapless
playback or physical output latency from encoded-file timing.

Program lookahead is implemented and qualified in `672b495` on halo1/8820;
`evidence/f2-program-lookahead-workflow.json` records the ordinary-preview,
natural 1× five-minute boundary, immutable Saved project and Full HD tail export.
Preparation is 12.765 s for 7200 preview frames and 0.521 s for the 75-frame future
with native lineage retained; these measurements use the documented repeated
864×480 source, not a 4K workload. The brief tail attachment was not directly
sampled; the uninterrupted run reaches natural EOF at 7274 after the ready future
remains stable through 7019. Eight focused cases cover ownership, TTL, pending
adoption, failure, cancellation and fast-audio/recording holds. Source placement,
EOF Replay and the project-view CAS fix are delivered in9ecf29d/8822; see
`evidence/f2-source-placement-workflow.json`. Audio-only Source waveform display
is delivered in f1fd010; see `evidence/f2-source-waveform-workflow.json`.
Speculative Source preparation is delivered in4f94773; see
`evidence/f2-source-lookahead-workflow.json` for the189-case focused gate and
actual67s automatic boundary/EOF. Project pool placement/sort, nested import,
prepared Relink and native Details/List/Grid are delivered in5d8d15d/e41e9cc/
e204001; reuse their evidence above. Native proxy controls, real generation
pause/resume and Program ready-proxy decoding are delivered in a95b4a6. Durable
shared cache, source binding, leases and process-restart reuse are delivered in
6764b2d; see `evidence/f2-native-proxies-durable-workflow.json`.
`proxy_quality_settings` is accepted. Pool interactions are delivered in9e00d2c;
degraded-cache recovery in b588603 and requested video/still binding in83ccf82.
Requested audition/scrub/fast-window/meter audio confinement is delivered in
fc2c041. Continue representative-media acceptance and the remaining native
audio-source boundaries. All41 partial
ledger rows and physical/M7 gates remain active. Unknown cache contents are
preserved; do not infer arbitrary crash cleanup or full M7 recoverability.

### F3 — advanced timeline and effects

Capabilities: `slip_tool`, `speed_handles_constant`, `speed_pitch_preserve`,
`compound_clips`, `adjustment_clips`, `title_font_style_bg`, `solid_color`,
`filters_exposure_blur_shadow`, `masks_rect_ellipse_bezier`,
`mask_boolean_feather`, `push_cross_dissolve`, `smooth_cut_optical_flow`,
`freeze_frame`.

Complete native controls and interactions, compound context/audio boundaries,
retiming and moving-media optical-flow gaps. Accept a coherent effects montage
with editable parameters, transitions, masks and titles, linked audio,
Undo/Redo, persistence and native preview/export agreement. Reuse the existing
R9700 renderer matrix for unchanged modes rather than rendering it per control.

### F4 — Color, Audio and recording

Capabilities: `color_wheels`, `color_auto_balance`,
`color_scopes_waveform_rgb_vector_hist`, `audio_mixer_track_master`,
`audio_effect_chain_order`, `audio_eq_six_band`,
`audio_compressor_three_band`, `audio_normalization_peak_r128`, `audio_mono`,
`track_arm_record`, `voiceover_record`.

Finish native workspace controls and required live behavior as connected Color
and Audio workflows. Preserve native DSP ordering and normalization semantics.
Qualify actual output, meter/scope context, track arming, record/stop/retry and
placement together. Physical microphone/device and output checks remain explicit;
synthetic input or file construction alone cannot close those requirements.

Source `63f4919` adds native graticules to the existing isolated scope PNGs:
Waveform/Parade scales, Histogram divisions and Vectorscope circle, skin line
and six 75% targets. Narrow panels uniformly show the first slot and retain
the second choice. The Mixer now shows native prepared stereo peaks for every
track/master, with Solo/Mute on tracks, through one shared bounded reader.
Numeric gain/pan drafts survive same-context EOF/readonly Inspector rebuilds;
real generation/timeline changes invalidate them. The final EOF read is
protected from the regular pause timer. No browser DSP is introduced.

The 35 focused JavaScript cases and embedded build pass on halo1; unchanged
Rust/CIFS evidence is reused. Actual Windows checks cover both wide plots,
520-pixel first-slot layout, live peaks, draft retention through EOF, one-entry
Apply, exact Undo/Redo, Solo/Mute and Save. The candidate on 8816 retains the
verified Saved project; 8813 remains untouched. See
`evidence/f4-native-guides-inline-mixer-workflow.json`. V1 mix/effect edits stop the prepared Program; the owner accepted this tradeoff
on2026-10-23. Uninterrupted live DSP edits are deferred beyond V1. The supported
stop/edit/explicit-Play/Undo/Redo/Save/reopen/export flow is verified in
`evidence/m7-audio-source-fd-workflow.json`. Remaining audio/recording acceptance
and honest paused/EOF meter presentation stay explicit without adding a new
streaming engine. The current ledger remains 49 done/41 partial/2 excluded.

Compact gain/pan controls are delivered in a2d1358/halo1/8838: native f32 fader
mapping, relative fine drag, keyboard/reset and one guarded axis write per
release, with the numeric workflow retained. The connected Windows
keyboard/reset/Undo/Redo/Save As/reopen evidence is
`evidence/m5-mixer-controls-workflow.json`. Pointer/Shift/cancellation cases
are deterministic coverage, not physical pointer qualification. Native
interactive EQ/compressor graphs remain; full F4 remains partial.

### F5 — shared media and presets

Capabilities: `shared_library`, `shared_presets`.

Retain the existing ds4-appliance HTTP catalog and actual NAS evidence. Complete
native preset/compound asset sharing and its deployment/UX qualification with
the authoritative 14 TB library arrangement. Confirm the applicable service or
mount on each host; never assume a halo1 mount exists on halo2. Use explicit small
assets and indexed API access, not archive scans or unsolicited mount changes.

The owner explicitly selected `//192.168.1.200/shared/madrock-library` as the
common root for ds4 media and native Venturi assets/presets on 2026-10-22.
Use `L=/mnt/madrock-share/madrock-library` on hosts with that mounted share,
`VENTURI_LIBRARY_ROOT=L` for desktop and Web `--assets-root L
--presets-root L/presets`. Preserve the existing ds4 monthly media layout and
service. Halo2 currently has no mount/client credential handle. The owner then
requested moving work to free halo1 because halo2 is shared with an H3 agent.
Halo1 already mounts the authoritative share; use that access for F5 rather than
adding a second mount. Its Venturi multimedia runtime is now prepared.
The filesystem's actual locking/atomic publication must be qualified before
calling F5 complete. Do not substitute a separate library root or disturb ds4.

Source `2cc447d` completes the connected catalog coordination/relink increment:
compatible native desktop/web locks, stale-record checks, native recovery,
media reference retention, desktop Refresh/root configuration, and cancellable
contextual relink with durable result counts. The focused implementation gate
passes 85 JavaScript, 135 unique web Rust and 24 native library cases, affected
Clippy and build; see `evidence/f5-shared-native-library-gate.json`.
The canonical NAS root, compatible deployment and the real shared filesystem
transaction workflow remain open. Halo2 currently has
no CIFS/NFS mount. Keep `shared_library`/`shared_presets` partial; do not infer
NAS qualification from isolated filesystem tests or the ds4 HTTP archive.

The next connected increment adds the approved source folder browser, native
ImportTree and recursive RelinkFolder. Its implementation gate passes 61 focused
JavaScript and all 521 web Rust cases; the two small corrections pass affected
reruns, all-target Clippy and the embedded build. See
`evidence/f5-approved-folders-gate.json`. Qualify its complete folder import,
duplicate merge/skip, contextual recovery and restart workflow in one isolated
Windows browser tab. This library workflow can use the existing GPU-disabled
server mode; it does not need to wait for the shared GPU. Keep rendering and
physical device acceptance separate and preserve every protected editor.

That actual Windows workflow passes on source `130b30e`: chooser Escape/focus,
two assets across three folders with one visible file error, repeat import with
two skips/no duplicate folders, cancellation during preparation, contextual
recursive restoration of one offline file, import into the project, Save and
real isolated restart. Project bytes, media/timeline models and library catalog
remain equal across restart. See `evidence/f5-approved-folders-workflow.json`.
The finite GPU-disabled service was stopped Saved. This closes the isolated
browser workflow gap, not the NAS/deployment or full F5 acceptance requirements.

The compact Library presentation passes actual Windows 1440×900 and the
544×900 drawer, chooser import/cancel and error wrapping. Both page/panel widths
have no horizontal overflow. The one-pixel hidden Inspector border at narrow
widths is corrected. See `evidence/f5-compact-library-workflow.json`.
Source `3952711` is delivered at port8814 with active R9700 preview; native
catalogs still use the explicit local library root while canonical NAS/shared
filesystem acceptance remains open.

Source `eedcae3` connects desktop EQ/compressor controls to the same
`presets/.venturi-audio-presets.json` catalog as Web. It reuses the native
transaction journal, shared lock and stale-record checks; Web refuses pending
native recovery without touching its marker. Legacy Settings values remain
preserved, existing catalogs are never seeded over, and invalid legacy can use
an explicit absent-only empty catalog action. Save conflicts retain the draft.
The connected gate passes 9 JavaScript, 11 Web Rust and 45 native cases,
all-target native/Web Clippy and the offline embedded build. It uses the newly
authorized eight-CPU quota with two compiler jobs, 4 GiB RAM and no swap; see
`evidence/f5-shared-audio-presets-gate.json`.

The isolated Windows workflow also passes library-only Save with unchanged
Session/history, one-Undo Apply, exact Undo/Redo, Save/restart and the reopened
preset. Clip list now dismisses before Export and no longer intercepts its
controls. See `evidence/f5-shared-audio-presets-workflow.json`. Its GPU-disabled
service is stopped Saved. This qualifies the connected implementation and
isolated Web workflow; canonical shared-filesystem/native-Web interprocess and
physical desktop acceptance still remain. Neither F5 capability advances to
done, and protected port8814 remains unchanged.

The halo1 CIFS gate now passes actual native `Library` and `AudioPresetLibrary`
against the real Web process, using an owned catalog inside the authoritative
mount. It covers asset, folder, attribute and EQ/compressor edits in both
directions, stale writes, explicit Refresh, shared/exclusive locks and durable
native multi-record recovery. Complete Web Session, source project, legacy
Settings and the other audio catalog remain unchanged. The test removes its
fixture; ds4 remains on the same PID. See
`evidence/f5-native-web-cifs-catalog-gate.json`.

That gate found and fixed a real folder-rename failure on CIFS: the Web journal
captured staged metadata identities before closing its writer. It now closes
and reopens read-only, verifies the same inode/length and all bytes, then pins
the strong identity. Replacement, symlink and recovery checks remain intact.
The focused 98 Web asset cases, formatting, all-target Clippy and embedded
build pass; both real interprocess tests pass on CIFS. This qualifies filesystem
coordination, not the complete F5 capability.

Source `ac0ba1a` implements direct multiasset Library placement. Compact rows
retain Shift ranges, Ctrl toggles and owned Ctrl+A. A local ghost follows native
ordered whole-media placement, rate conversion, track resolution and linked
streams. One bounded batch prepares files; final actor preflight checks all
revisions, cancellation, locks, overlaps, cycles and copied-file witnesses before
native grouped import/insertion. The single Undo preserves native monotonic IDs.
Valid cached compounds retain their project edits and current duration/roles;
page metadata carries epoch/generation and refreshes after edits. Existing Web
file/byte budgets remain, with 32 roots and 16 MiB aggregate metadata per batch.

The actual Windows drag from the canonical NAS places a video and compound at
frames 144 and 268, creates four linked clips and one independent child timeline,
and records one InsertClips Undo. Undo/Redo restore semantic timelines/media;
derived compound hashes advance under native synchronization. The final client
retains all four newly inserted clip selections: automatic pool refresh no longer
counts as newer user intent. Program playback crosses into the imported compound
from frame 236 and reaches natural EOF at 391; Save retains generation 3. See
`evidence/f5-library-asset-drop-workflow.json` and its Windows screenshot.
The gate covers 141 initial JavaScript cases and a 42-case client regression;
539 Rust cases are covered, with 26 affected reruns after test-only corrections,
plus formatting, all-target Clippy and the embedded build. The unchanged
native/CIFS interprocess proof is reused. No build/render fleet ran on Windows.
Both earlier halo1 Sessions, project hashes, PIDs and Undo histories remain
unchanged, as does ds4's PID. One useful reusable Timeline 1 asset was added to
the real Library; the original asset is unchanged. Physical desktop GUI and
broader offline/large-media lifecycle acceptance remain open. F5 stays partial;
the ledger remains 47 done / 43 partial / 2 excluded.

### F6 — AI Review

Capabilities: `compare_take_AB`, `replace_take_atomic`.

Finish remaining original Review extension interactions and hardware acceptance,
preserving source clocks, audio-stream choices, animation, linked replacements
and explicit duration/freeze policies. Reuse the existing 20-shot/60-take montage,
export and recovery evidence where the code is unchanged. Accept the complete
choose/compare/replace/save/export workflow rather than another isolated API demo.

The connected verified-take increment fixes exact approved nested/Pasted Images
paths, binds Plan/Confirm to the B file actually displayed (including loaded
original stills), and moves the native metadata probe outside the Session actor
into the existing bounded, cancellable subprocess. Final publication rechecks
the exact request, source descriptor/lineage and project/timeline revisions.
Its scoped 30-second HTTP deadline covers the 20-second probe/25-second worker
budget without changing ordinary request deadlines. Strong ctime identity is
limited to Source/Take/audition/Slip; legacy atomic-save identity and the existing
shared catalog identity format are preserved.

The same increment removes Source ALL's unused selected-audio memory allowance
and excludes video outside the requested Program range while retaining active
crossing neighbours and conservative compound/audio costs. The native mixer
really prepares full pitch-corrected clips outside its range, so that allocation
remains budgeted. The gate passes 224 affected JavaScript and 529 Rust cases,
three affected worker reruns, all-target Clippy and the offline embedded build;
see `evidence/f6-verified-take-gate.json`.

The connected Windows/R9700 workflow is now qualified on isolated source
`a7565f6`; see `evidence/f6-verified-take-workflow.json`. The 20-shot/60-take
fixture completes 20 linked replacements, with explicit shortening/preservation,
middle animation keys and annotations retained. Replacing the displayed B file
without changing its bytes or mtime refuses the stale plan without an edit.
The Windows replacement then uses one Undo entry; Undo/Redo, Save and isolated
restart preserve the native timeline/media models and Review metadata. The saved
preview at frame 1387 matches the native R9700 reference byte for byte at 1280x720.
A native 1920x1080, 1440-frame H.264/AAC export completes, is downloaded, passes
decoded tone/gap checks and plays to natural 60.01-second EOF in Windows.
Reopened Windows controls retain the Saved project and durable export download.

Only `replace_take_atomic` advances to done: the ledger is 47 done / 43 partial /
2 excluded. `compare_take_AB` still needs sustained full-resolution comparison
and physical audio acceptance. The finite qualification service is stopped
Saved; this acceptance does not deploy the F6 candidate to protected port8814
or close the remaining F1-F7 goal.

### F7 — integrated release

Finish M7 from IMPLEMENTATION_PLAN.md: scoped security/threat-model and license
review, recoverability, deployment/rollback documentation and the bounded
two-hour editing soak on halo1. Reuse the final working candidate and realistic
project; no workstation soak, resource pressure/filling tests or foreign-process
crash experiments. Preserve all dirty sessions. Deliver an accessible verified
version, source commit, running instructions, saved project and output artifact.

Degraded proxy-cache preference recovery is delivered in b588603/halo1/8835.
Confirmed preferences remain writable during failed cache census; acknowledged
disable uses originals. Uncaptured lookup errors can fall back only after current
original approval/version checks; already captured changed leases remain errors.
Unknown cache files are preserved and recovery requires a fresh healthy catalog.
This does not provide arbitrary crash cleanup. Requested video/still binding is
delivered below; the requested audio adapter is recorded separately.

Requested original video/still confinement and touched-source cache validation
are delivered in83ccf82/halo1/8836 using additive native resolver APIs. Program,
scopes and Auto Balance pin actual native decoder requests; native compound and
crossing traversal shares that provider. The focused gate and actual cache
replacement probes are recorded above. No broad new compound/transition GPU
matrix is claimed. Durable composed-movie/export audio retains its existing
native path.

Requested audio decode confinement for existing Program audition, scrub,
fast-audio windows and meters is delivered in fc2c041/halo1/8837. The optional
native LevelCache resolver pins actual decode/Normalize/pitch requests, shares
strong source witnesses and retains leases through file use; Project paths and
native clocks are unchanged. The 14-case gate and connected Windows V1 workflow
are recorded in `evidence/m7-audio-source-fd-workflow.json`. Preview metadata
preflight still conservatively covers audible out-of-window dependencies.
This is not a claim that durable composed-movie/export audio has moved to the
resolver, or that physical-device, representative/dense/DPI and full M7
qualification is complete.

## Execution and verification policy

At each block, identify concrete missing production behavior and unverified
behavior from native source, current code and existing evidence. Implement the
missing behavior before the integrated qualification pass. A partial row may
contain both kinds of work; test counts are not implementation progress.

Use focused checks while developing. Run required regression/build checks once
for the coherent code block, followed by one integrated browser/hardware pass.
Repeat only affected checks after a relevant change or failure. Reuse cached
tools, fixtures, helpers and valid prior proofs; do not add another test framework.
Documentation-only planning changes require no build or test execution.

Every accepted row needs native semantics, an actual web entrypoint, persistence
and the applicable TEST_PLAN.md evidence. Mark complete only for the verified
scope. Physical device/OS checks that tools cannot perform must be reported and
resolved explicitly, never silently dropped. Keep the full plan intact when a
block is difficult or requires outside input.

## Resource and session rules

The owner's latest direction is to move work to free halo1 and reuse its NAS
mount, avoiding contention with the H3 agent on halo2. The runtime is now ready;
prepare build prerequisites there before starting new heavy work. Preserve all earlier
halo2 editor services, projects, Undo histories and qualified artifacts.
All builds, renders, heavy tests and prolonged qualification run remotely, one
workload at a time. Check at least 8 GiB memory headroom before heavy work. Use
up to eight CPUs (owner authorization on 2026-10-22), at most 4 GiB RAM, no swap,
OOMScoreAdjust=1000, low CPU/I/O priority,
bounded cache/disk use and finite qualification runtimes. Keep routine checks
short; a release soak needs its own finite, low-load configuration.

Use /tmp/HALO_BENCHMARK.lock nonblocking for GPU work. Never steal/delete the
lock, wait-loop, stop foreign jobs, change inference configuration or modify AMD
kernel/ROCm drivers. Preserve other DeepSeek/ComfyUI agents and their workloads.
Use only the existing Windows browser, one work tab. No browser installations,
local builds/renders, large copies, cache walks or SSD saturation workloads.

Use isolated project roots for destructive qualification. Upgrade a live service
only after checking ownership and unsaved state, preserving saved data and
rollback. Preserve both the protected editor and any newer candidate edits.
Do not change the NAS mount/content without necessity and authorization.

## Completion and reporting

Report delivered functions/blocks, actual remaining defects or qualification
gaps, and the deployed commit/URL. Update FUNCTIONAL_PARITY.csv only when the
corresponding scope is accepted. Do not use subjective percentages, commit
counts or test counts as a substitute for delivery.

Complete this goal only after all 90 in-scope capabilities and applicable M7
criteria are satisfied and the resulting version is accessible. Commit/push
feat/venturi-web without an upstream PR or merge. The accepted narrow workflow
remains a baseline; it does not by itself complete this new goal.
