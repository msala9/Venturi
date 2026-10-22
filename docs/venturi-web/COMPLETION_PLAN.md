# Active completion plan — full Venturi Web scope

2026-10-22. The owner resumed the full implementation plan after accepting the
usable editing workflow. This file now controls the work order. DELIVERY_PLAN.md
and DELIVERY_HANDOVER.md remain the accepted baseline, not the scope limit.

## Goal and baseline

### Current execution host — halo1

The owner moved new work to free halo1 on 2026-10-22 because halo2 is shared
with an H3 agent. The current working runtime serves Windows
**http://127.0.0.1:8816/** through the same-port SSH tunnel to halo1.
Source `63f4919` runs as unprivileged `halo` in
`venturi-web-halo1-color-audio-r2.service`, using
`/home/halo/VenturiWeb-color-audio-20261022` and the separate Saved project
`Venturi_Color_Audio.vvproj`. It includes the native scope guides, inline Mixer
meters/Solo/Mute, retained numeric drafts and CIFS catalog staging fix described
below. The earlier halo1 editor on **8813**, source `fd9bde4`, remains running
with its complete Session, ImportMedia Undo entry and project bytes unchanged.
Both use the existing CIFS mount
`/mnt/madrock-share/madrock-library` for native assets and its `presets/`
subdirectory for presets, and the existing local ds4 API on 8787 for archive
media. The existing halo2 editors below are preserved historical deliveries;
ports 8813/8816 on Windows target halo1, not the stopped halo2 qualifications.
Use halo1 for subsequent bounded build/render/qualification work. Do not
start another NAS mount or install browsers on either server.

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
F5 GUI and placement acceptance remains open.

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
`evidence/f4-native-guides-inline-mixer-workflow.json`. Mix/effect edits still
stop the prepared Program, and inline displays clear on pause/end. Implement
the remaining native live-edit behavior and physical audio/recording acceptance
before advancing the full F4 rows. The ledger remains 47/43/2.

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
coordination, not the complete F5 capability. Asset drag from Library directly
to the timeline remains missing Web production behavior; manual Add to project
and cached repeated imports already exist. Implement native placement and its
context guards before calling that gap a qualification-only item. Physical
desktop GUI acceptance and the remaining release requirements also stay open.

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
