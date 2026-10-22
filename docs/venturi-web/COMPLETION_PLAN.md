# Active completion plan — full Venturi Web scope

2026-10-22. The owner resumed the full implementation plan after accepting the
usable editing workflow. This file now controls the work order. DELIVERY_PLAN.md
and DELIVERY_HANDOVER.md remain the accepted baseline, not the scope limit.

## Goal and baseline

Complete all remaining in-scope capabilities against the original native GUI,
the UX specification and M7 release criteria. FUNCTIONAL_PARITY.csv
started with 42 done and 48 partial capabilities. The current accepted source
ledger contains 44 done and 46 partial capabilities after the native compound
and freeze workflow (evidence/nativeview-workflow.json). The two explicitly NOT-PLANNED
rows, speed_ramp_reverse and node_graph, remain excluded. Do not relabel partial
capabilities as finished merely because a small demo, API or component test passes.

Preserve the delivered workflow and accessible candidate at Windows port 8811,
currently code df50859. Do not disturb the protected port-8790 editor or its
five unsaved MoveClips operations and Undo history. Re-read every live editor's
state before deployment; the owner may have begun new work in the candidate.

## Delivery blocks

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
