# Remaining implementation and acceptance work

2026-10-24. This file separates production changes from qualification in the
28 partial rows. It does not replace FUNCTIONAL_PARITY.csv, weaken its evidence
requirements, or add exclusions. Global M7 gates stay separate from individual
functionality. A physical-input blocker does not block unrelated implementation.

The owner reaffirmed on2026-10-24 that unavailable checks must be reserved for
the end while work continues. Track them in FINAL_CHECKS.md, retain their
acceptance criteria and continue every independent implementation/GUI workflow.
Do not stop the plan for disconnected input, OS scaling, native fullscreen or
device/soak prerequisites; do not promote rows merely by deferring their checks.

## Concrete production work

- **Inspector viewport after native edits corrected:** source39b3ae3 retains the
  scroll/control anchor through the temporary empty-selection refresh; genuine
  context switches and user input still cancel restoration. Actual curved Path,
  vertex, three boolean modes and Feather scrubs, seven Undo/Redo and Saved
  reopen pass in evidence/f3-chrome-masks-inspector-scroll-workflow.json. The
  demonstrated jump to top is repaired and checked in currentadc69 Chrome.
  This adds no OS scaling, held modifier, moving-render or M7 qualification.

- **Native NAS Restore and import reporting delivered:** source455662c preserves
  native asset/preset two-way Restore on the shared filesystem, first-drag Mixer
  focus/scroll behavior and truthful cached single-asset import no-op receipts.
  Actual NAS/Mixer GUI observations and the focused source-bound gates are in
  `evidence/f2-f5-native-nas-restore-input-workflow.json`. R3 passes3 exact Host
  cases;54 client/49 module cases are reused from unchanged R2 inputs. Current
  runtime8b975f434990 is deployed; additive r5 package passes in
  evidence/f7-current-prebuilt-r5-workflow.json.
  These fixes do not promote rows or waive FINAL_CHECKS.md requirements.
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

## Follow-up native transport/catalog corrections delivered

Source14d4753 qualifies explicit Pause/final EOF normalization to1x and Program
exclusive terminal cursor/black/no replay, including live/Saved end versus native
last-frame restoration on reopen. Custom audio Refresh is isolated from attribute
locks/recovery. One263-client/9-native affected halo1 gate plus actual Windows
Program/Source and EQ Refresh checks pass. Prior renderer/DSP/export evidence is
retained; see `evidence/f2-f5-native-transport-audio-refresh-workflow.json`.
These were newly demonstrated source gaps in the earlier bounded review; the
qualification map below is not proof that undiscovered production defects cannot
exist or grounds to stop safe implementation when a concrete defect is found.

## Independent native tool windows and title reset delivered

Mixer/Color now coexist as independent windows, reuse one grade/scopes/Mixer
controller and preserve drafts/viewport allocation. Title Background group Reset
preserves enabled per target. See evidence/f3-f4-native-toolwindows-title-reset-workflow.json.
The187-client/4-native bounded gate and Windows keyboard/DOM workflow do not
replace physical input/DPI/audio or the other row-specific acceptance below.

## Export row-specific acceptance delivered

Representative long real-media and sustained bounded native-scale H.264/AAC
export pass. Only export_h264_aac is accepted; ledger62done/28partial/2excluded.
See evidence/f7-public-real-media-export-workflow.json for FullHD634.6s and
real4K300s outputs, resources, preservation, failed attempts and reused evidence.
Native Source/Program long browser playback, physical/DPI/device, dense editing
and two-hour M7 remain open. No new package or whole-release acceptance.

## Row-specific residuals

The subsequent evidence/f1-f3-chrome-transform-curves-save-workflow.json adds actual Viewer
move/crop, numeric scrub, graph multi-key drag and Bezier tangent proof, with
complete nine-entry Undo/Redo and edited SaveAs/reopen. The new owned effects
project is retained; all14 earlier Saved files and NAS metadata remain exact.
Unchanged source/package evidence is reused; remaining requirements below stay open.

The later evidence/f1-chrome-selection-snapping-safe-move.json additionally qualifies
ordinary Ctrl/Shift Clip-list selection, Canvas marquee/all/locked exclusion,
Snap on/off and blocked overlap/locked-peer moves in actual Chrome. Exact Undo
and own-copy Save/reopen pass. This reduces those rows to their retained held
modifier, edge/scroll, DPI/dense/device requirements; no row is promoted.

Chrome extension input is now connected. The2026-10-24 bounded workflow proves
ordinary linked video/audio mouse move, Undo/Redo, Save/reopen, paused ruler
click and Mixer header drag at observed DPR1.25. See
`evidence/f2-f4-chrome-physical-input-workflow.json`. The original13 Saved hashes
are unchanged and the original clean document is restored; one dedicated Saved
qualification copy is retained. This removes the disconnected-browser blocker.
Alt-copy, cancellation, dense input, OS100%/150%, device/audio and native
fullscreen admission still need their own evidence. Ledger stays62/28/2.

"Qualification" means no additional missing native production workflow was
demonstrated in the bounded source/evidence review. It is not a claim that the
feature passes every requirement or cannot contain defects.

| Partial capability | Concrete next work |
|---|---|
| source_viewer | Native explicit Pause/final EOF speed reset delivered; qualification: representative long moving media, cold preparation, sustained playback and actual audio/device behavior. Existing full-source seeking/quality/continuation evidence is retained. |
| program_viewer | Native terminal cursor/black/no replay and Pause/EOF1x delivered; keyboard and actual Chrome ruler seek/resume at1x/2x pass. Qualify held/cancel/required scaling, representative long-source playback/cold preparation and audio/device requirements. |
| transport_play_pause | Native explicit Pause/finalEOF1x and terminal no-replay delivered; keyboard and actual Chrome ruler1x/2x seek/resume pass, including stopped seek retaining selected2x and explicit Pause resetting1x. Keep native paused arrow stepping; qualify remaining held/cancel, required scaling and output checks. |
| viewer_fullscreen | Full-area Fit, bounded in-tab fallback and keyboard/Source/Program layout delivered and qualified; qualify actual native browser admission, physical bottom hover and DPI. |
| thumbnail_workers | Qualification: dense visible demand/cold scheduling and bounded cache behavior; retain existing native producer and visibility/recovery evidence. |
| waveforms_cached | Qualification: dense/large-media demand and physical gesture/DPI behavior; retain native fractional-clock/gain/freeze and existing cache proof. |
| shared_library | Unavailable-root retry and actual native NAS two-way Restore are delivered; cached import no-op reporting is corrected. Retain accepted cross-project import/Relink/CIFS proof. Remaining actual HTML Project-to-Library capture and other explicit final checks stay in FINAL_CHECKS.md; no blanket new GUI-lifecycle blocker is introduced. |
| track_arm_record | Qualification: real microphone permission, disconnect and device latency with native arming/placement semantics. |
| linked_groups | Qualification: physical Alt-copy, gestures/DPI and dense timelines. Shared preset cross-project Apply is already qualified. |
| select_multiclip_marquee | Ordinary reverse Canvas marquees, Clip-list Ctrl/Shift and Canvas Ctrl+A/locked exclusion pass in actual Chrome; qualify remaining Canvas modifier/cancel/scrollbar, DPI and500-clip interactions. |
| snapping | Actual linked move snaps to playhead48 versus46 with Snap off at observed DPR1.25; qualify remaining ruler/edge snapping across required DPI and dense timelines. |
| slip_tool | Qualification: prolonged uncached held-Slip continuity and physical/DPI operation. |
| speed_handles_constant | Qualification: physical relative scrub, handles, modifiers, cancellation and dense/DPI operation. |
| keyframe_editing | Actual position diamonds, graph marquee/two-key drag and complete Undo/Redo/edited SaveAs/reopen pass; qualify remaining cross-parameter lanes, held modifiers/cancel and dense/DPI operation. Native destination replacement remains delivered. |
| curve_easing_bezier | Actual EaseInOut, Bezier Apply and first tangent drag pass; qualify remaining held modifiers, wheel/cancel and dense/DPI operation. |
| transform_crop_softness | Actual Viewer move/left crop, scale/rotation/pivot handles and numeric softness/PositionX scrub pass, with exact eight-entry Undo/Redo and Saved reopen. Qualify continuous edge scrub, held/cancel and required DPI; retain native/API frame equivalence. |
| title_font_style_bg | Actual font popup Cancel/family/style, Font size scrub, color palette and background height scrub pass with complete eight-entry Undo/Redo and Saved reopen; qualify remaining held/cancel and required scaling. Retain existing render/history/export workflow. |
| solid_color | Actual palette Cancel/Hue/SV and native color-key insertion/automatic keying pass with three Undo/Redo and exact Saved reopen. Qualify generator HTML drag, remaining held/cancel and required DPI; retain native color/render/history/export proof. |
| masks_rect_ellipse_bezier | Actual curved Path pen/cancel/vertex and three-shape editing, seven Undo/Redo and exact Saved reopen pass; repaired Inspector viewport stays fixed after Feather scrub. Qualify remaining handles/cancel and required DPI; retain native moving-frame/export proof. |
| mask_boolean_feather | Actual Add/Subtract/Intersect custom choices and Feather pointer scrub pass, including one native Undo per edit and exact Saved reopen. Qualify remaining handle/cancel and required DPI; retain native composition proof. |
| push_cross_dissolve | Qualification: physical Alt-copy/replace, wheel/blur/cancellation and100%/150% mapping. |
| smooth_cut_optical_flow | Qualification: physical transition-copy/replace/duration interactions and100%/150% mapping; retain existing moving native render/export evidence. |
| clip_fades | Qualification: fade-handle mapping at100%/150%; existing125% physical handles and native video/PCM/AAC/MP4 proof remain accepted. |
| shared_presets | Unavailable-root startup/retry and independent audio Refresh delivered; qualify remaining physical/GUI lifecycle; reuse accepted cross-project Apply, native shortcuts, CAS/recovery and Delete evidence. |
| audio_mixer_track_master | Qualification: physical fader/Shift/graph/wheel/DPI and audible output/device behavior. The owner-approved paused-edit/explicit-Play workflow remains V1. |
| voiceover_record | Qualification: actual microphone/disconnect/latency/output and retained-take browser download completion. Retain intentional5min/64MiB limits and synthetic-controller proof. |
| compare_take_AB | Qualification: sustained representative full-resolution comparison and physical audio; source quality/clock/stream/replace controls are delivered. |
| clip_move_safe | Ordinary linked move, Snap on/off, overlap refusal, locked-peer refusal and exact Undo/persistence pass in actual Chrome; qualify Alt-copy, cancellation, required DPI and dense timeline. |

## Integrated acceptance still required

Keep the nine native audio-clock cases unqualified until the appropriate output
environment proves them. Do not relax their assertions. The two-hour realistic
editing gate explicitly includes browser memory observation; another backend-only
loop cannot close it. Continue all safe production work and bounded halo1
qualification independently of these external prerequisites. Do not start a
Windows soak, install a browser, synthesize representative long footage, or repeat
unchanged renderer/export/regression matrices to move a counter.
