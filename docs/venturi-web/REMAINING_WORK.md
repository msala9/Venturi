# Remaining implementation and acceptance work

## Current immutable R8 delivery - 2026-10-24

The verified current archive is
`/home/halo/.local/share/venturi-web/deliveries/venturi-web-linux-x86_64-782eb350d0d0-r8-e7c23c495b4b.tar`,
91545600 bytes, SHA256
`e7c23c495b4ba751aa3ab7c53352874a3dc7d699e42dcc3f6cfeb192c19bf58d`.
Binary source dea7f17 and packaged docs9c9c487 are separately bound. This public
receipt postdates the immutable archive; its packaging-pending wording stays
unchanged. See evidence/f7-current-prebuilt-r8-workflow.json.
All members, launcher help, three original notice companions,189 libraries and
199 notice texts pass verification. One1CPU/512MiB/noSwap assembly peaks
239034368 bytes with zero memory events; the full live Session,16 Saved,
Recovery and prior R7 remain exact. R7 and older deliveries stay immutable.
R8 assembly is complete; sustained Source/Program/A-B playback and the remaining
FINAL_CHECKS/M7 gates remain open. No new runback/reboot or row promotion;
ledger stays62done/28partial/2excluded.


## Current Source/proxy clock correction - 2026-10-24

Source dea7f17 fixes index-zero alignment in windowed and full proxies within
native imported frame bounds. Actual Chrome public FullHD/4K initial60s Source
preparation from 0 passes at Medium 960px with all audio streams;4K final5s reaches EOF19037,
10:34:17. See evidence/f2-real-public-source-clock-workflow.json.
The 24 affected native cases (13 proxy/11 browser), Clippy and build pass: peak1523445760B,
zero memory events. The isolated companion peaks837091328B/events0 and stops
normally.16 Saved, Recovery and40foreign PIDs/39 Sessions remain exact.
Live782eb350d0d0/PID540668 replaces cf00; R8 packaging is pending. R7 and older
package/deployment sections below remain historical, immutable and version-bound.
Sustained Source/Program/A-B playback and physical/device/held/OS/M7 checks remain open.
Ledger stays62done/28partial/2excluded; no row promotion.


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

- **Current R7 delivery complete:** verified cf00 archive91463680bytes binds
  binary source67882ef separately from docs1487519. Streaming member/launcher/
  notice/189-loader/zlib checks pass at237674496bytes peak and zero events;
  live Session/16 Saved/Recovery and prior R6 remain exact. See
  evidence/f7-current-prebuilt-r7-workflow.json and BINARY_DELIVERY.md. This
  publication postdates the unchanged archive snapshot; earlier pending notes
  are historical. Remaining FINAL_CHECKS and ledger62/28/2 are unchanged.

- **Mask handles and cross-parameter lanes qualified:** source67882ef retains
  valid selection before native refresh reaches Inspector/Viewer, keeping the
  chosen mask after its own ACK. Actual four shape-handle edits and two lane
  move/Hold operations, then two current mask edits without reselection, pass
  Undo/Redo/Save/reopen. See evidence/f1-f3-chrome-mask-handles-lanes-workflow.json.
  Held/cancel/required OS and remaining lane wheel/dense checks stay open.

- **Dense500 ordinary editing qualified:** actual Chrome500clips/250linked A/V
  pairs pass pan/zoom, Canvas Ctrl/Shift/Ctrl+A selection, linked move, exact
  Undo/Redo and edited Save/reopen. evidence/f1-chrome-dense500-editing-workflow.json
  preserves all15 prior Saved/NAS and adds only the owned16th Saved fixture.
  Cold visible demand,60fps, browser-memory/soak and required OS/held input are
  still unqualified; do not repeat ordinary dense editing as if it were missing.

- **Live Program cursor after shortening corrected:** source5ce758c clamps the
  actual cursor before Inspector/marks/timecode and preview query installation.
  Actual old199/end176 failure is repaired; currentefa2 passes175→newend152,
  CURRENT black, valid-cursor Undo/growth, Redo and Saved/reopen151. Percentage
  scrub/Cancel, Keep length/Ripple, Canvas speed handle/preset and overlap refusal
  also pass. See evidence/f3-chrome-retime-live-end-workflow.json.58 affected
  client cases and the incremental build pass; unchanged native proof is reused.

- **Independent Mixer navigation corrected:** source d49ed8c preserves scroll
  across native refresh and applies EQ/compressor knob styles to the tool window,
  preventing oversized indicators from covering other controls. Actual EQ graph
  drag/wheel, compressor addition/crossover/makeup, five Undo/Redo and edited
  Save/reopen pass in evidence/f4-chrome-mixer-graph-scroll-workflow.json on
  current26b6bf6f5059. Existing masks/title/keys,14 other Saved and NAS are exact.
  Required Shift/held/cancel/scaling/device acceptance remains FINAL_CHECKS.

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
Bounded real Source preparation/late EOF now passes; sustained Program/A-B playback, physical/DPI/device, dense performance
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
| source_viewer | Native Pause/EOF and proxy frame-zero alignment delivered. Actual public FullHD/4K initial60s preparation and4K final5s EOF19037 pass in evidence/f2-real-public-source-clock-workflow.json. Sustained playback, cold-pressure and actual audio/device acceptance remain open; retain existing seeking/quality/continuation proof. |
| program_viewer | Native terminal cursor/black/no replay and Pause/EOF1x delivered; actual Chrome ruler seek/resume1x/2x and source5ce758c edit-induced end clamp/CURRENT black/Undo/Save/reopen pass. Qualify held/cancel/required scaling, representative long-source playback/cold preparation and audio/device requirements. |
| transport_play_pause | Native explicit Pause/finalEOF1x and terminal no-replay delivered; keyboard and actual Chrome ruler1x/2x seek/resume pass, including stopped seek retaining selected2x and explicit Pause resetting1x. Keep native paused arrow stepping; qualify remaining held/cancel, required scaling and output checks. |
| viewer_fullscreen | Full-area Fit, bounded in-tab fallback and keyboard/Source/Program layout delivered and qualified; qualify actual native browser admission, physical bottom hover and DPI. |
| thumbnail_workers | Dense500 ordinary navigation is qualified. Qualify cold visible demand/scheduling and bounded cache behavior; retain existing native producer and visibility/recovery evidence. |
| waveforms_cached | Dense500 ordinary navigation is qualified. Qualify cold/large-media demand and physical gesture/DPI behavior; retain native fractional-clock/gain/freeze and existing cache proof. |
| shared_library | Unavailable-root retry and actual native NAS two-way Restore are delivered; cached import no-op reporting is corrected. Retain accepted cross-project import/Relink/CIFS proof. Remaining actual HTML Project-to-Library capture and other explicit final checks stay in FINAL_CHECKS.md; no blanket new GUI-lifecycle blocker is introduced. |
| track_arm_record | Qualification: real microphone permission, disconnect and device latency with native arming/placement semantics. |
| linked_groups | Dense500 linked move/Undo/Redo/Save/reopen is qualified. Retain physical Alt-copy, held/cancel, required DPI and dense performance gates. Shared preset cross-project Apply is already qualified. |
| select_multiclip_marquee | Ordinary reverse Canvas marquees, Clip-list Ctrl/Shift and Canvas Ctrl+A/locked exclusion pass. Dense500 additionally qualifies Canvas Ctrl/Shift/Ctrl+A and navigation; retain held/cancel/scrollbar, required DPI and60fps/cold-demand checks. |
| snapping | Actual linked move snaps to playhead48 versus46 with Snap off at observed DPR1.25; qualify remaining ruler/edge snapping across required DPI and dense timelines. |
| slip_tool | Actual ordinary linked video-body and audio-body Slip, two Undo/Redo and edited Save/reopen pass in evidence/f1-chrome-linked-slip-input-workflow.json, preserving timing/rate/pitch and unrelated effects. Neutral wording9fbc205 is embedded in5ce758c/currentefa2. Qualify prolonged uncached held-Slip continuity, remaining cancel and required OS scaling. |
| speed_handles_constant | Actual ordinary percentage scrub/draft Cancel, Keep length/Ripple, Canvas endpoint, strip preset/Cancel, overlap refusal and five Undo/Redo/Save/reopen pass in evidence/f3-chrome-retime-live-end-workflow.json. Qualify continuous edge-relative input, held modifiers/mid-gesture cancellation and dense/required OS scaling. |
| keyframe_editing | Actual diamonds/graph and cross-parameter lanes pass: keys96/111 move to98/113, then both Hold, one command each with exact Undo/Redo/Save/reopen. Retain wheel/held/cancel, dense and required OS/DPI qualification; native destination replacement remains delivered. |
| curve_easing_bezier | Actual EaseInOut, Bezier Apply/first tangent and cross-parameter lane Hold editing pass with exact Undo/Redo/Save/reopen. Retain wheel/held/cancel and dense/required OS-DPI qualification. |
| transform_crop_softness | Actual Viewer move/left crop, scale/rotation/pivot handles and numeric softness/PositionX scrub pass, with exact eight-entry Undo/Redo and Saved reopen. Qualify continuous edge scrub, held/cancel and required DPI; retain native/API frame equivalence. |
| title_font_style_bg | Actual font popup Cancel/family/style, Font size scrub, color palette and background height scrub pass with complete eight-entry Undo/Redo and Saved reopen; qualify remaining held/cancel and required scaling. Retain existing render/history/export workflow. |
| solid_color | Actual palette Cancel/Hue/SV and native color-key insertion/automatic keying pass with three Undo/Redo and exact Saved reopen. Qualify generator HTML drag, remaining held/cancel and required DPI; retain native color/render/history/export proof. |
| masks_rect_ellipse_bezier | Actual Path pen/vertex, Rectangle corner/side and Ellipse move/rotate pass with persistence. Source67882ef fixes own-ACK picker loss; two consecutive current edits retain picker1/CURRENT without reselection, exact Undo/Redo/Save/reopen. Retain held/cancel/required OS-DPI and native moving-frame/export proof. |
| mask_boolean_feather | Actual Add/Subtract/Intersect choices, Feather scrub and shape handles pass with one native Undo per edit and exact Saved reopen. Own-ACK handle continuity is corrected; retain held/cancel/required OS-DPI qualification and native composition proof. |
| push_cross_dissolve | Actual Chrome explicit create/replace, direction/ease closed-wheel and no-op, popup cancellation, paired seconds/frames/curve scrubs, Canvas duration, Remove and full Undo/Redo/Save/reopen pass in evidence/f3-chrome-transition-input-workflow.json. Qualify held Alt-copy, HTML drop, actual window blur and required100%/150% mapping. |
| smooth_cut_optical_flow | Actual Chrome explicit SmoothCut replacement, Canvas selection/duration and full Undo/Redo/Save/reopen pass in evidence/f3-chrome-transition-input-workflow.json. Qualify held transition-copy/HTML drop, window blur and required100%/150% mapping; retain existing moving native render/export evidence. |
| clip_fades | Qualification: fade-handle mapping at100%/150%; existing125% physical handles and native video/PCM/AAC/MP4 proof remain accepted. |
| shared_presets | Unavailable-root startup/retry and independent audio Refresh delivered; qualify remaining physical/GUI lifecycle; reuse accepted cross-project Apply, native shortcuts, CAS/recovery and Delete evidence. |
| audio_mixer_track_master | Actual fader, EQ graph XY/wheel and compressor crossover/makeup pass; Mixer scroll and detached knob interception are corrected in d49ed8c, with full Undo/Redo/Save/reopen proof. Qualify remaining Shift/held/cancel/required DPI and audible output/device behavior. The owner-approved paused-edit/explicit-Play workflow remains V1. |
| voiceover_record | Qualification: actual microphone/disconnect/latency/output and retained-take browser download completion. Retain intentional5min/64MiB limits and synthetic-controller proof. |
| compare_take_AB | Qualification: sustained representative full-resolution comparison and physical audio; source quality/clock/stream/replace controls are delivered. |
| clip_move_safe | Dense500 linked move with exact Undo/Redo/Save/reopen is qualified; retain physical Alt-copy, cancellation, required DPI and dense performance checks. |

## Integrated acceptance still required

Keep the nine native audio-clock cases unqualified until the appropriate output
environment proves them. Do not relax their assertions. The two-hour realistic
editing gate explicitly includes browser memory observation; another backend-only
loop cannot close it. Continue all safe production work and bounded halo1
qualification independently of these external prerequisites. Do not start a
Windows soak, install a browser, synthesize representative long footage, or repeat
unchanged renderer/export/regression matrices to move a counter.
