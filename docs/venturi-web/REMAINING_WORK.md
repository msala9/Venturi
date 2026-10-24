# Remaining implementation and acceptance work

2026-10-24. This file separates production changes from qualification in the
29 partial rows. It does not replace FUNCTIONAL_PARITY.csv, weaken its evidence
requirements, or add exclusions. Global M7 gates stay separate from individual
functionality. A physical-input blocker does not block unrelated implementation.

## Concrete production work

- **Program navigation:** ruler and Program position seeks must preserve the
  native playing/stopped state and selected tempo. Native `main.rs` transport
  seek and `timeline_audio.rs::seek_sample` preserve playback; arrow stepping
  deliberately pauses. The old Web `seek` unconditionally stopped Program.
  Source8995296 delivers guarded seek/resume, fresh native audio origin,
  backward seeking and cancellation. Qualification is tracked separately.
- **Fullscreen delivered:** source205db70 plus379ba0c supplies full-area Fit,
  bottom90px transport overlay, keyboard access, Escape and prior zoom/focus
  restoration. A denied/pending native request uses a labelled in-tab maximized
  view after1200ms. Actual Program/Source video/still layout and keyboard
  transport pass; native browser admission and physical hover/DPI remain open.
- **Library startup while busy:** source8995296 tolerates a temporary catalog
  lock after validating the configured directories, retains local editing and
  retries deferred receipts on explicit Refresh. All operation guards remain.
  Inaccessible-root startup is delivered by the subsequent block below.
- **Library root unavailable at startup delivered:** source205db70 preserves
  local editing/import/Undo/Save and offline Saved reopen during transient root
  inaccessibility. Explicit Refresh pins exactly the configured root once across
  clones. Unsafe configuration/replacements remain refused; no fallback roots,
  broadened access or alternate catalogs. Native owned fixtures qualify outage
  recovery; actual reachable NAS asset/preset Refresh passes in Windows.

See `evidence/f2-f5-fullscreen-library-recovery-workflow.json` for the current
349-client/192-native gate, actual browser scope and preservation witnesses.

## Row-specific residuals

"Qualification" means no additional missing native production workflow was
demonstrated in the bounded source/evidence review. It is not a claim that the
feature passes every requirement or cannot contain defects.

| Partial capability | Concrete next work |
|---|---|
| source_viewer | Qualification: representative long moving media, cold preparation, sustained playback and actual audio/device behavior. Existing full-source seeking/quality/continuation evidence is retained. |
| program_viewer | Keyboard1x/2x navigation is qualified; complete physical ruler checks, then representative long-source playback/cold preparation and audio/device requirements. |
| transport_play_pause | Keyboard1x/2x seek/resume and paused navigation are qualified; complete physical ruler/cancellation checks. Keep native paused arrow stepping; retain physical held-key/output checks. |
| viewer_fullscreen | Full-area Fit, bounded in-tab fallback and keyboard/Source/Program layout delivered and qualified; qualify actual native browser admission, physical bottom hover and DPI. |
| thumbnail_workers | Qualification: dense visible demand/cold scheduling and bounded cache behavior; retain existing native producer and visibility/recovery evidence. |
| waveforms_cached | Qualification: dense/large-media demand and physical gesture/DPI behavior; retain native fractional-clock/gain/freeze and existing cache proof. |
| shared_library | Unavailable-root startup/retry delivered; qualify remaining physical Project-to-Library capture and native GUI lifecycle. Existing cross-project import/Relink/CIFS evidence stays accepted. |
| track_arm_record | Qualification: real microphone permission, disconnect and device latency with native arming/placement semantics. |
| linked_groups | Qualification: physical Alt-copy, gestures/DPI and dense timelines. Shared preset cross-project Apply is already qualified. |
| select_multiclip_marquee | Qualification: physical marquee/modifiers/scrollbars, DPI and500-clip interactions. |
| snapping | Qualification: physical ruler/edge snapping across DPI and dense timelines. |
| slip_tool | Qualification: prolonged uncached held-Slip continuity and physical/DPI operation. |
| speed_handles_constant | Qualification: physical relative scrub, handles, modifiers, cancellation and dense/DPI operation. |
| keyframe_editing | Qualification: physical multi-key graph/lane gestures and dense/DPI operation; explicit native destination replacement is delivered. |
| curve_easing_bezier | Qualification: physical tangent/modifier/wheel interactions and dense/DPI operation. |
| transform_crop_softness | Qualification: physical continuous/edge scrub, cancellation and DPI; retain native/API frame equivalence. |
| title_font_style_bg | Qualification: physical popup/font/color/relative-scrub interactions and scaling; retain existing render/history/export workflow. |
| solid_color | Qualification: physical generator drag/color/key interactions and DPI; retain native color/render/history/export proof. |
| masks_rect_ellipse_bezier | Qualification: physical Viewer pen/handles/choice/scrub and DPI; retain native moving-frame/export proof. |
| mask_boolean_feather | Qualification: physical mode/feather/handle interactions and DPI; retain native composition proof. |
| push_cross_dissolve | Qualification: physical Alt-copy/replace, wheel/blur/cancellation and100%/150% mapping. |
| smooth_cut_optical_flow | Qualification: physical transition-copy/replace/duration interactions and100%/150% mapping; retain existing moving native render/export evidence. |
| clip_fades | Qualification: fade-handle mapping at100%/150%; existing125% physical handles and native video/PCM/AAC/MP4 proof remain accepted. |
| shared_presets | Unavailable-root startup/retry delivered; qualify remaining physical/GUI lifecycle; reuse accepted cross-project Apply, native shortcuts, CAS/recovery and Delete evidence. |
| audio_mixer_track_master | Qualification: physical fader/Shift/graph/wheel/DPI and audible output/device behavior. The owner-approved paused-edit/explicit-Play workflow remains V1. |
| voiceover_record | Qualification: actual microphone/disconnect/latency/output and retained-take browser download completion. Retain intentional5min/64MiB limits and synthetic-controller proof. |
| export_h264_aac | Qualification: representative long real footage and sustained bounded export. Existing FullHD and synthetic48-frame4K equivalence are retained. |
| compare_take_AB | Qualification: sustained representative full-resolution comparison and physical audio; source quality/clock/stream/replace controls are delivered. |
| clip_move_safe | Qualification: physical Alt-copy/linked move, cancellation, DPI and dense timeline. Existing ordinary move/overlap/Undo/persistence evidence remains. |

## Integrated acceptance still required

Keep the nine native audio-clock cases unqualified until the appropriate output
environment proves them. Do not relax their assertions. The two-hour realistic
editing gate explicitly includes browser memory observation; another backend-only
loop cannot close it. Continue all safe production work and bounded halo1
qualification independently of these external prerequisites. Do not start a
Windows soak, install a browser, synthesize representative long footage, or repeat
unchanged renderer/export/regression matrices to move a counter.
