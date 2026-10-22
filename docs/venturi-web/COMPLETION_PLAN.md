# Active completion plan — full Venturi Web scope

2026-10-22. The owner resumed the full implementation plan after accepting the
usable editing workflow. This file now controls the work order. DELIVERY_PLAN.md
and DELIVERY_HANDOVER.md remain the accepted baseline, not the scope limit.

## Goal and baseline

Complete all remaining in-scope capabilities against the original native GUI,
the UX specification and M7 release criteria. FUNCTIONAL_PARITY.csv
started with 42 done and 48 partial capabilities. The current accepted source
ledger contains 46 done and 44 partial capabilities after the native compound,
freeze, independent-timeline/view and static Inspector qualification. The two explicitly NOT-PLANNED
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
checks remain on bounded halo2; no new browser installation or local server.


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

The next native mask/Slip source block is committed at `b06948b`; its focused
implementation gate is recorded in `evidence/f3-mask-inspector-gate.json`.
Its isolated runtime start was deferred by the shared GPU lock. Reuse the
passing focused checks and the retained three native reference frames; run
the remaining Windows workflow/render comparison once hardware is available.
Do not count native-only references as native/API parity or upgrade any
protected editor to bypass qualification. During the hardware wait, continue
F5 native/web catalog coordination and asset missing-file recovery as one
connected source block. The accepted ledger remains 46 done / 44 partial.

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
accepted (46 done / 44 partial). Targeted rendered TS017 transform/crop/fade parity,
physical modifier/DPI and dense 500-clip acceptance remain open. The finite 8813
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

### F5 — shared media and presets

Capabilities: `shared_library`, `shared_presets`.

Retain the existing ds4-appliance HTTP catalog and actual NAS evidence. Complete
native preset/compound asset sharing and its deployment/UX qualification with
the authoritative 14 TB library arrangement. Confirm the applicable service or
mount on each host; never assume a halo1 mount exists on halo2. Use explicit small
assets and indexed API access, not archive scans or unsolicited mount changes.

Source `2cc447d` completes the connected catalog coordination/relink increment:
compatible native desktop/web locks, stale-record checks, native recovery,
media reference retention, desktop Refresh/root configuration, and cancellable
contextual relink with durable result counts. The focused implementation gate
passes 85 JavaScript, 135 unique web Rust and 24 native library cases, affected
Clippy and build; see `evidence/f5-shared-native-library-gate.json`.
Actual Windows relink, the canonical NAS root, compatible deployment and the
real shared filesystem transaction workflow remain open. Halo2 currently has
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

### F6 — AI Review

Capabilities: `compare_take_AB`, `replace_take_atomic`.

Finish remaining original Review extension interactions and hardware acceptance,
preserving source clocks, audio-stream choices, animation, linked replacements
and explicit duration/freeze policies. Reuse the existing 20-shot/60-take montage,
export and recovery evidence where the code is unchanged. Accept the complete
choose/compare/replace/save/export workflow rather than another isolated API demo.

### F7 — integrated release

Finish M7 from IMPLEMENTATION_PLAN.md: scoped security/threat-model and license
review, recoverability, deployment/rollback documentation and the bounded
two-hour editing soak on halo2. Reuse the final working candidate and realistic
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

All builds, renders, heavy tests and prolonged qualification run on halo2, one
workload at a time. Check at least 8 GiB memory headroom before heavy work. Use
one CPU, at most 4 GiB RAM, no swap, OOMScoreAdjust=1000, low CPU/I/O priority,
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
