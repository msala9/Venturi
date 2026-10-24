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
  The current candidate adds guarded seek/resume, fresh native audio origin,
  backward seeking and cancellation. Qualification is tracked separately.
- **Fullscreen:** native `main.rs::show_fullscreen_viewer` fits the image to the
  entire screen and reveals transport only in the bottom90px hover zone. Web
  currently only calls `requestFullscreen` on the ordinary Viewer; its header,
  controls and custom zoom remain. Implement the native presentation and retain
  keyboard access, Escape, Source/Program ownership and existing transport.
- **Library startup while busy:** the candidate tolerates a temporary catalog
  lock after validating the configured directories, retains local editing and
  retries deferred receipts on explicit Refresh. All operation guards remain.
  This does not implement startup with an inaccessible configured root.
- **Library root unavailable at startup:** distinguish transient inaccessibility
  from invalid/unsafe configuration. The current constructors still abort Editor
  startup when opening the configured root fails; native Library preserves an
  error and offers Refresh. Complete a bounded unavailable state and explicit
  retry of the same configured roots without fallback, broadened filesystem
  access, alternate catalogs or interference with foreign recovery.

## Row-specific residuals

"Qualification" means no additional missing native production workflow was
demonstrated in the bounded source/evidence review. It is not a claim that the
feature passes every requirement or cannot contain defects.

| Partial capability | Concrete next work |
|---|---|
| source_viewer | Qualification: representative long moving media, cold preparation, sustained playback and actual audio/device behavior. Existing full-source seeking/quality/continuation evidence is retained. |
| program_viewer | Qualify the Program navigation fix, then representative long-source playback/cold preparation and audio/device requirements. |
| transport_play_pause | Qualify seek/resume at retained tempo, paused seeks and cancellation. Keep native paused arrow stepping; retain physical held-key/output checks. |
| viewer_fullscreen | Implement full-area Fit and bottom hover transport described above; qualify keyboard entry/exit and Source/Program layout. |
| thumbnail_workers | Qualification: dense visible demand/cold scheduling and bounded cache behavior; retain existing native producer and visibility/recovery evidence. |
| waveforms_cached | Qualification: dense/large-media demand and physical gesture/DPI behavior; retain native fractional-clock/gain/freeze and existing cache proof. |
| shared_library | Complete unavailable-root startup/retry; qualify remaining physical Project-to-Library capture and native GUI lifecycle. Existing cross-project import/Relink/CIFS evidence stays accepted. |
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
| shared_presets | Complete unavailable-root startup/retry and remaining physical/GUI lifecycle; reuse accepted cross-project Apply, native shortcuts, CAS/recovery and Delete evidence. |
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
