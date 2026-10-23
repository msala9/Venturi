# Implementation status

## Native Timeline ruler scrubbing — 2026-10-24

Source `9cb8439`, runtime `2dc4cc86af23`, owns halo1/8855.
Ruler scrubbing now matches native clip-edge snapping, including locked lanes,
native first-candidate ties, f32 conversion and rounded10px threshold. It excludes
playhead/marker targets just like the native ruler. Release samples its actual
primary-pointer coordinate even without a final move. Motion stays local and
release makes one final seek without a history edit.

Foreign pointer/document/timeline/revision/FPS/mapping, hidden/modal/detached and
navigation changes cancel obsolete gestures. Own native view ACKs and equivalent
snapshots stay valid. Five new regressions and the11 affected Timeline suites
pass173 cases; embedded build42.01s, peak1,642,283,008B on halo1.
Unchanged native/DSP/renderer checks are reused after source-hash validation.
Live embedded module hash matches the tested source. All39 protected Sessions/
40 PIDs,11 Saved files,5 local media,4 fixed NAS files and shared proxy remain
exact. See `evidence/f1-native-ruler-scrubbing.json`.

Windows reload reconnects without console errors and now reports its normal
1536x864 viewport. Clicks still time out; earlier screenshot capture also timed
out. No physical ruler/pool acceptance or new screenshot is claimed. Fade100%/
150%, held uncached Slip, dense/DPI and global M7 remain explicit. Ledger stays
**61 done /29 partial /2 excluded**; full F1-F7/M7 remains active.

The focused F2/F4 audit finds Source and Program lookahead already delivered;
old CSV speculative-continuation notes are superseded by the existing workflow
evidence. Remaining acceptance includes representative long moving A/V at
ordinary source/output resolution and physical microphone/output lifecycle.
Do not reopen explicitly deferred uninterrupted audio-effect editing for V1.
Continue those connected workflows and remaining native interactions; avoid
repeating unchanged codec/render matrices or expanding the Library increment.

## Native Library visible thumbnails — 2026-10-24

Source `6c24b73`, runtime `7d58e468c79c`, owns halo1/8855.
Library Grid/Details now request native96-width thumbnails only for intersecting
ordinary online video/still roots. List, compound, offline and audio-only rows
retain glyphs. The existing derivative producer, single queue and bounded cache
are reused with a separate profile and complete Source identity. No project
import, Source-pane opening, movie or waveform is introduced. Native sampling,
no-upscale behavior and real pre/post metadata/file checks remain authoritative.

Ready results replace only thumbnail nodes, preserving selection and drag state.
Hidden/dialog/page/layout changes withdraw demand; explicit Refresh retries.
R1 found a real resume defect: modal-close left layout buttons disabled. The
production fix resynchronizes controls on close and visibility restoration;
R2 passes330 client and14 native cases, Clippy8.55s/build41.68s,
peak2,083,192,832B within4GiB/no swap. No local workload.

Live read-only preparation of the actual64x36 shared asset returns a64x36 PNG
without upscaling, deduplicates its job and leaves Session/history/catalog exact.
All39 protected Sessions/40 PIDs,11 Saved files,5 local media,4 fixed NAS files
and shared proxy remain unchanged. See `evidence/f5-native-library-thumbnails.json`.

The existing Windows editor remains connected. A temporary1920x1080 viewport
restores layout reads, but clicks still time out and keyboard activation does
not switch the panel; the override is reset. No new screenshot or physical pool
acceptance is claimed. Physical capture and broader F5/device/
dense/DPI/M7 requirements remain open. Native Library has no media-type filter.
Ledger stays **61 done /29 partial /2 excluded**; full F1-F7/M7 remains active.
Next fix native Timeline ruler scrubbing: Web currently omits cut-edge snapping
and the final pointer-up coordinate. Preserve native tie/threshold semantics and
guard obsolete gestures. Reuse unchanged DSP/renderer/export checks.

## Native preset catalog/shortcuts and Pivot/Flip reconciliation — 2026-10-24

Source `8aeab66`, runtime `f9b6a50578fc`, owns halo1/8855. Saved presets now
use globally filtered native alphabetical ordering before32-row paging. Explicit
sort=name has truthful total/pages/catalog_total; omitted sort retains legacy
source paging. The panel preserves returned Unicode order and skips legacy
empty-page scanning when the authoritative filtered total is available.

Session-local explicit shortcut Enable now supports receivable native keys and
complete modifier chords, including Ctrl+Alt+Shift+F8. Native imported aliases
normalize only in memory. Native/default editor and actual browser/Web command
conflicts show precise reasons; text, local controls, menus, hidden documents,
composition/AltGraph/repeat and stale ownership cannot consume the command.
Saving never implicitly enables a shortcut. External desktop Keymap remaps are
not exposed or claimed mirrored. Shared preset broader acceptance stays open.

The serial halo1 gate passes83 client and19 native cases, Clippy8.40s/build41.18s,
peak2,083,926,016B within4GiB/no swap. Live global/legacy/search reads retain the
same preset metadata and all117 native shortcut keys without Session/history
changes. All39 protected Sessions/40 PIDs,11 Saved files,5 local media,4 fixed
NAS files and shared proxy stay unchanged. See
`evidence/f5-native-preset-catalog-shortcuts.json`. Physical keyboard/pool visual
acceptance remains open because the existing Windows browser reports0x0 and
cannot deliver input. No new screenshot, renderer or export pass is claimed.

`anchor_flip` is accepted from an explicit existing evidence chain, not new
development: actual Saved/reopened TL5/clip5 contains AnchorX24/FlipH=true. The
TS-017 fixture changes only its media-root prefix and compares native/API frames
0/8/24 exactly on R9700; frames8/24 cover those nonneutral values. Selected/reset
semantics and actual Undo/Redo/persistence are already proved. The old pending
render note is superseded. See `evidence/f1-anchor-flip-acceptance.json`.
Fade100%/150% mapping and prolonged uncached held Slip remain partial, alongside
global DPI/dense/M7. Ledger is now **61 done /29 partial /2 excluded**.

Next complete native Library thumbnails using the existing producer/queue/cache.
Native Library has no media-type filter; adding one is not required for parity
and is not another excluded capability. Its native Grid/Details thumbnails are
required; List, compound, offline and audio-only rows retain glyphs. This source
is in development and is not accepted by this increment. Full F1-F7/M7 stays active.

## Native Library pool browser — 2026-10-24

Source `d47b549`, runtime `a114a5e5cd63`, owns halo1/8855. The Library now uses
compact Grid/List/Details, native first-root metadata, folder tree/breadcrumbs,
global Grid search and Name/Duration ordering before32-row pagination. Legacy
queries retain candidate-ID paging; explicit sort returns truthful filtered
total/pages and catalog_total within10000 entries/16MiB metadata. Selected-row
source checks remain bounded; no probe, decoder or thumbnail endpoint is added.

Visible-order selection, keyboard/marquee, F2 asset/folder rename, native context
actions and isolated internal folder/media moves reuse existing controllers and
native CAS commands. Offline moves need no source read. External placement
tickets and Project pool IDs remain separate. Explicit folder collapse survives
Refresh. Existing transfer/reopen/review/ACK safety is retained.

The serial halo1 gate passes215 client and21 unique native cases, Clippy8.75s
and build42.22s, peak2,121,814,016B within4GiB/no swap. Live read-only queries
verify all3 current assets, both name directions, duration, root, trimmed/empty
search and the updated64x36 asset metadata without any Session/history change.
All39 protected Sessions/40 PIDs,11 Saved files,5 local media,4 fixed NAS files
and shared proxy remain unchanged. See `evidence/f5-native-library-pool.json`.

Browser reload reconnects the embedded candidate as writer without console
errors. The existing tab reports0x0 and input times out through both documented
click APIs; showing the same browser does not restore its dimensions. Actual
pool visual/physical gestures remain unverified; no screenshot is claimed.
Library thumbnails/type filtering, Project-to-Library physical capture and
broader shared-library/preset/offline/device/dense/DPI/M7 acceptance remain open.
Ledger stays **60 done /30 partial /2 excluded**; full F1-F7/M7 remains active.
Next close global native preset browsing and receivable preset shortcut behavior
as one functional block, without repeating unchanged DSP/render/export checks.

## Native Library reopen lifecycle and compact replacement review — 2026-10-24

Source `3b334fe`, runtime `9ba94a68b995`, owns halo1/8855. Library now refreshes
once after an actual project reopen, deferring until project dialogs close and
old preparation/review/commit ownership settles. Old reads and acknowledgments
cannot repaint the reopened selection; ordinary generations do not force catalog
reloads. Failed reads require explicit Retry. Replacement review uses compact
native dimensions/FPS/audio and bounded expandable file details.

Actual Windows File/Open of the same Saved project, with Library active and no
manual Refresh, retains its asset and enables Import. Double-click opens the new
64x36 Source. This R2 interaction uses the same three UI source hashes as final
R4. Final R4 passes192 affected client cases/build40.77s, peak1,645,346,816B;
unchanged native/DSP/Clippy evidence is reused after exact source checks.
All39 protected Sessions/40 PIDs,11 Saved files,5 local media,4 fixed NAS files
and shared proxy remain unchanged. See `evidence/f5-library-ui-lifecycle.json`.

Project-to-Library pointer capture remains unverified: source drag staging is
valid, but no target dragover/drop reached the tab in the actual automated
gesture. Explicit AddToLibrary remains available. The existing Windows browser
subsequently stopped responding to input/screenshots; its temporary viewport
override was reset. Final-build visual repeat and compact-review visual
acceptance remain open; no new screenshot is claimed.

Next integrate the native Library pool presentation, global Name/Duration sort,
folder navigation and contextual interactions as one functional block. That
source is in development and is not accepted by this evidence. Ledger remains
**60 done /30 partial /2 excluded**; full F1-F7/M7 stays active.

## Native Library reviewed content replacement — 2026-10-24

Source `719e8ee`, runtime `b4a885f44be3`, owns halo1/port8855. Selected-file
and recursive-folder Relink now offer intentional different-content replacement
with a bounded inline before/after review and explicit confirmation. Default
repair and legacy mutation identity retain their original exact-content rules.
The native SetMediaPath adapter updates complete metadata, FPS/crop/animation
and affected compound hashes, preserving payload IDs. New SHA paths and native
fingerprints prevent imports from reusing the old project media. Matching
acknowledged Library Source ownership is retired before reopening the new source.

Successful Capture/Import/ImportSet/placement now release consumed witnesses
after final native acceptance; the ordinary publish/import/folder sequence no
longer fails ASSET_BUSY from its own completed jobs. Same-command receipts and
publication retries remain valid. Identical-content replacement binds only its
own verified same-SHA copied identity; restored/tampered originals are refused.

Actual Windows publishes32x18, imports its independent project copy, reviews
64x36 without a prior metadata/history change, confirms one replacement/missing0,
and opens the new64x36 Source. A later import creates media17/path(2) instead
of reusing media15/16. One Undo removes only that new import, Redo restores it;
Saved reopen retains exact models/bytes and empty Undo. Prior timeline models,
ten Saved projects and both original/new bytes remain intact. See
`evidence/f5-library-replacement-workflow.json` and four screenshots.

The bounded halo1 gate passes247 affected client cases and14 core cases
(source-bound reuse), plus43 unique Web cases. Final R5 passes8 new
replacement and7 legacy Relink cases, Clippy8.47s/build41.06s, peak2,067,038,208B.
Earlier max peak2,336,600,064B remains within4GiB. No new render/export matrix,
local build or browser install. All39 prior Sessions/40 PIDs,11 candidate Saved
files,5 local protected media,4 fixed NAS files and shared proxy remain exact.

Ledger remains **60 done /30 partial /2 excluded**; full F1-F7/M7 stays active.
Next complete the connected shared Library UI lifecycle: automatic catalog
refresh after project reopen (manual Refresh currently required), actual
Project-to-Library pointer capture, and compact native contextual controls.
Keep broader shared preset/offline/large-media and physical/dense/DPI/integrated
release acceptance open; do not repeat unchanged renderer/DSP/export checks.

## Native scrub motion and legacy Library Relink — 2026-10-23

Source `886e4db`, runtime `d4b95aaa73ce`, owns halo1/port8855. The shared
Inspector numeric binder now integrates each pointer motion at its current
native speed, including Shift/10, and clamps each event. Press20px then Shift1px
retains20.1 instead of retroactively jumping to2.1. Releasing Shift without
motion does not change the value; reversing from a bound responds immediately.
Ownership, precise cancel, no-op and one-command release semantics remain intact.

Library Relink reuses native legacy16hex-prefix normalization for both chosen
files and recursive folder lookup. Original basenames take precedence; literal
stored names remain a fallback. Three actual prepared-job/commit fixture paths
restore exact original bytes and reopen missing0 without changing IDs, metadata,
hashes or compound references. Source/meta/SHA/CAS/path guards remain unchanged.
No NAS asset was removed/relinked for qualification.

Actual Windows20px PositionX scrub changes0to20 with one Transform, one
Undo/Redo and exact Saved reopen/emptyUndo. Other native parameters, timelines,
prior audio gain and all prior Saved files stay exact. Mixed held-Shift and
bound-reversal cases have deterministic coverage; no new physical modifier/DPI
claim. See `evidence/f1-native-scrub-relink-workflow.json` and screenshot.

The single bounded halo1 gate passes207 affected client and10 native cases,
Clippy8.29s/build41.07s, peak2,082,119,680B. Unchanged renderer/DSP/export evidence
is reused. All39 prior Sessions/40 PIDs,10 candidate Saved files,5 local media,
4 fixed NAS files and shared proxy remain protected. No local build/browser install.

Ledger stays **60 done /30 partial /2 excluded**; full F1-F7/M7 remains active.
Next functional Library gap: native Relink accepts a same-basename replacement
whose bytes differ, while the current Web repair contract requires matching
original metadata/content. Complete deliberate replacement with truthful source
identity/cache/payload handling rather than weakening exact-original repair.
Project-to-Library pointer capture and broader lifecycle/physical/release gates
remain open. Do not repeat unchanged renderer/audio/export matrices.

## Native Timeline waveform feedback — 2026-10-23

Source `5a2904a`, runtime `94abc1c3d922`, owns halo1/port8855. Timeline
waveforms now use the native fractional source clock and native evaluated gain,
including animated gain, minimum pixel height and red clipping. Frozen and
compound audio do not draw a false waveform. Trim/Roll/Slip drafts resample the
same source clock locally; move/copy and linked retime retain their source spans.
There is no browser keyframe evaluator, DSP or pointermove HTTP request.

The additive read-only adapter binds epoch/generation/timeline/revision and
ordered audio clips. Constant gain stays O(1); animated lookup work, response
bytes and client cache are explicitly bounded. Excessive animation hides its
waveform with a status rather than drawing inaccurate data or blocking editing.
The final controller prevents budget eviction/refetch loops and accepts finite
native Bezier overshoot. Existing raw source cache/analysis is reused.

Actual Windows changes clip23 at200% speed from0to12dB: the native multiplier
changes1to3.981071949 and its waveform shows red clipping. One Undo restores the
original waveform/models; Redo restores gain. Saved reopen retains exact models
and bytes with empty Undo. Only that clip's gain changes. See
`evidence/f2-native-waveform-workflow.json` and before/clipping/final screenshots.

R1 passes183 client cases,9 targeted native cases, Clippy8.25s and build41.60s;
R2 passes16 overlapping affected cases and build40.71s, reusing unchanged native
and Clippy results. Peak is2,064,330,752B inR1 and1,648,029,696B inR2. All heavy
work is serial and bounded on halo1; no new decode, renderer, export or physical
speaker/device claim. All39 prior Sessions/40 PIDs,9 candidate Saved files,
5 local media files,4 fixed NAS files and shared proxy remain protected.

Ledger remains **60 done /30 partial /2 excluded**. Broader waveform dense,
physical/DPI and release acceptance remains open. Full F1-F7/M7 stays active.
Next close remaining native interaction and shared-library/preset lifecycle
requirements; do not repeat unchanged renderer/DSP/export matrices. The
Project-to-Library pointer gesture remains unverified; explicit AddToLibrary
is available and a focused source review found no further concrete defect.

## Native key presets and insert workflows — 2026-10-23

Source `ccc49a5`, runtime `78153fde00f0`, owns halo1/port8855 only. Compact
Hold/Linear/EaseInOut/EaseIn/EaseOut buttons act on shared native key picks.
Actual Windows applies EaseInOut to two ZoomX keys and one text key with the
advanced panels closed: one SetInterpolation, one Undo/Redo, repeated-preset
no-op and exact Saved reopen. See `evidence/f1-selected-key-interpolation.json`.
Broader keyframe modifier/DPI/dense acceptance remains open.

Each mixer strip now has native insert rows, plus/context menus and same-channel
HTML drag. An exact own ACK remaps editor/nested paths; uncertain completions
close affected editors. Mount/toggle state, window-only blur and same-strip popup
dismissal are corrected. Actual insert drag moves EQ below Normalize; one Undo
restores every timeline. Final-build menu MoveUp retains the EQ editor at its
new index; Undo closes obsolete slot editors rather than opening Normalize.
Mono Enable/Undo/Redo changes only its native enabled flag. The source-bound
native asymmetric stereo averaging test passes; explicit Program Play is live
at5.2778s. Saved reopen retains exact models/bytes with empty Undo. Prior native
chain/PCM/export evidence is reused. See `evidence/f4-native-insert-workflow.json`
and screenshot. Chain ordering and parameterless Mono are accepted; physical
speaker/device and global release checks remain explicit in F4/F7.

Project/Library source tabs are visible and keyboard accessible. Capture staging
uses trusted local IDs/opaque tokens and no hover writes; timeline geometry or
placement metadata no longer blocks Library admission. Deterministic64-item,
stale/cancel/source/busy and acknowledged-publication cases pass. Explicit tabs
open the existing58-item ds4 archive and2-item native NAS catalog. Actual
Project-to-Library pointer attempts did not produce capture: that new gesture
remains UNVERIFIED, not accepted. Existing AddToLibrary stays available. See
`evidence/f5-project-library-capture.json`; full F5 remains partial.

Halo1 R1 passes382 client cases, one native Mono test, Clippy8.23s/build40.60s.
R3 passes110 affected cases/build41.32s; final R4 passes37 overlapping mixer
cases/build40.66s, peak1,524,899,840B. Unchanged native/Clippy checks are reused;
overlapping runs are not summed. Both new module HTTP200/MIME/body hashes match
the gated source. All39 prior Sessions/40 PIDs, eight candidate Saved files,
five local media files, four fixed NAS files and shared proxy are preserved.
No local build or new browser installation was used.

Ledger **60 done /30 partial /2 excluded**. Full F1-F7/M7 remains active.
Next functional block: native Timeline waveform feedback for keyed gain,
clipping, freeze/retime and trim/Slip/Roll, reusing native clocks/cache rather
than adding browser key evaluation or DSP. Keep the unverified Library gesture,
broader shared lifecycle and physical/dense/DPI/integrated release work open.

## Native EQ and normalization workflow — 2026-10-23

Source17af3de/runtime258b3b4eb7bd on halo1/port8855 completes the compact six-band
EQ and Loudness shortcuts. Actual new EQ gain knob ArrowUp commits0to0.1dB with
one Undo/Redo; peers, prior Mono/compressor and tracks remain exact. Six native
band arrays share128 frequencies; off bands1/6 correctly hide their curves.
Real explicit Play after the stopped edit shows128 native pre/post points in
the visible graph. A real20px EQ knob drag originally canceled when draft status
wrapping moved the knob12.8px. The relative-motion fix retains size/ownership/
resize/scroll guards; the same actual drag now changes0.1to4.8999977dB with one
Undo/Redo and exact Saved reopen. The128-case affected client gate and40.66s
embedded build pass, peak1,514,868,736B. Unchanged native/Clippy results are reused;
overlapping client runs are not summed. Broader physical/DPI acceptance is open.

Actual SamplePeak/TruePeak/Loudness controls retain native target semantics.
Streaming−14 LUFS commits the draft Loudness mode/target in one native command,
Undo restores SamplePeak−1 and Redo restores Loudness−14. Reapplying the same
preset is a no-op. Native TruePeak/R128 signal measurements and normalization
independent/master gain tests have source-bound terminal results in the workflow evidence,
7 loudness and6 normalization cases pass, peak889,618,432B, replacing reliance
on the old97-pass narrative. Earlier native PCM, presets,
transport and export proofs are reused. No new export/physical output claim.

Save/reopen preserves exact native models/Saved bytes with empty Undo.
All39 prior Sessions/40 PIDs, seven candidate Saved projects, local media,
four fixed NAS files and shared proxy retain their identities. See
`evidence/f4-eq-normalize-workflow.json` and its screenshots. The affected
EQ/Normalize capability rows advance: **58 done /32 partial /2 excluded**.
Full F1-F7/M7 stays active. Next continue the remaining editing/Inspector,
shared library/preset lifecycle and physical/integrated release requirements.


## Native Color workflow and integrated EQ/key controls — 2026-10-23

Source `737e824`, runtime `6014c198109e`, owns only port8855 on halo1.
Auto Balance actually changes six native wheel coordinates with one native
Undo/Redo; saved reopen retains exact models/bytes and empty Undo. Both native
scope pairs and their guides show the selected isolated clip. Real Program Play
advances scope frames33to45 with distinct1024x256 images. Scope input clears
outside the selected clip and restores for clip22 at40.

The native-shell scope panel previously overlaid Play/seek; normal flex flow
now allocates space and actual pointer Play reaches the button. See
`evidence/f4-color-native-workflow.json`, static and live screenshots. Existing
native isolated/Adjustment/stale/source and renderer proofs are reused.
`color_auto_balance` and `color_scopes_waveform_rgb_vector_hist` advance to done:
**56 done /34 partial /2 excluded**. Full F1-F7/M7 remains active.

The same source delivers six native EQ band strips/curves/pre-post spectra,
Loudness delivery shortcuts and reusable scalar/event/mixed key-editor cancel.
The20 native cases pass in R1; R2 fixes a JavaScript import parenthesis and
passes253 client cases, Clippy8.16s/build41.04s, peak1,522,782,208B on halo1.
EQ/Normalize acceptance remains open until the connected browser workflow.
Key-editor blur is deterministic coverage; no physical OS/DPI claim.
All39 prior Sessions/40 PIDs, six candidate Saved projects, local media,
four fixed NAS files and shared proxy retain their identities. No local build.

Next finish the connected EQ/Normalize stopped-edit/Play/Undo/Save workflow;
reuse prior native audio output evidence and then continue remaining F1-F7.


## Native compressor activity acceptance — 2026-10-23

Current compressor activity delivery: **http://127.0.0.1:8855/**,
source `641599d`, binary `771fa50f72e0`, service
`venturi-web-halo1-compressor-activity.service`, PID264167.
The compressor now shows native band input/GR, an active response distinct from
makeup, and native pre/post spectra. It uses the existing prepared telemetry,
one250ms producer and at most four deduplicated insert readers. No browser DSP,
additional decoder or persistent Viewer row is introduced.

The15-case native gate and103 client cases pass; formatting, Clippy8.42s and
build40.95s pass on halo1, peak2,093,780,992 bytes. Actual Windows verifies a
single Mid threshold change-24to-60, one Undo/Redo, nonzero native Mid GR
21.6583843dB at sample8192,241 native response points and128 pre/post points.
The curve and all three threshold/GR strips fit the upper Inspector row.
Explicit Program Pause releases the movie and clears activity correctly;
same-clock frozen-reader behavior has deterministic coverage only.

Save/reopen retains exact models and Saved bytes with empty Undo. Other bands,
crossovers, Mono bypass, clips/effects and other timelines are unchanged.
Prior Color/Mask/Title Saved files,39 Sessions/40 PIDs and fixed NAS/proxy state
are retained. See `evidence/f4-compressor-activity-workflow.json` and its screenshot.

Combined with the prior native parameter/preset/chain/reset/output evidence,
`audio_compressor_three_band` advances to done: **54 done /36 partial /2 excluded**.
Global physical-device/DPI/dense/soak/M7 and the full F1-F7 goal remain open.
Next close the concrete Color observations: actually applied Auto Balance with
Undo/Redo/persistence and scope images advancing with Program frames. Native
production behavior is already present; reuse existing renderer/export proofs.


## Native Title/Source controls and compact Inspector — 2026-10-23

Current Title/filter/Source controls: **http://127.0.0.1:8855/**,
source `b85e333`, binary `aefe8ae43d4c`, service
`venturi-web-halo1-native-scalars-source-r2.service`, PID261197. Compact native Title/background
scalars and non-Color filters now have native-speed scrubs and inline sliders.
The narrow Inspector ends above the timeline; actual Clip list selection works
with the drawer open. Numeric/slider/reset share one28px Title row.

R1 passes264 affected client cases/build42.24s; R2 passes126 overlapping Source
cases/build41.36s after fixing two actual browser findings: the absolute grid
row end and the visible Proxies handler. Peak memory stays below1.73GB on halo1;
unchanged native/Clippy/render/export checks are reused, with no local workloads.

Actual Windows775x964/DPR1.25 verifies20px Title width0to0.1 and Shadow
softness10to20 scrubs, a font-size slider keyboard edit, one Undo per command,
Shadow Undo/Redo and exact Saved reopen. Other timelines, master, prior Color
and Mask Saved projects,39 Sessions/40 PIDs and fixed NAS/proxy files are retained.
Source60to12 seek resumes Play; frame-step pauses. Visible quality changes retain
Source A/frame60/marks12to96 while pool B stays selected; proxies remain disabled
and quality returns to medium. The recentered window starts at absolute60, so
its local video time0 is correct. See `evidence/f3-title-source-controls-workflow.json`.

Ledger **53 done /37 partial /2 excluded**. Full F1-F7/M7 and physical/DPI/dense/
device acceptance remain open. Next production block: native compressor input
levels/GR and active response from existing prepared telemetry.


## Color-wheel capability acceptance — 2026-10-23

At Color-wheel acceptance the ledger was **53 done /37 partial /2 excluded**. `color_wheels` is
accepted from the combined native and connected evidence, without closing Color
scopes/Auto Balance, full F4 or the global physical/DPI/dense/soak/M7 criteria.

Native `grade_panel.rs` joint/default/key/reset semantics and `grade.rs` bounds
are covered by `evidence/m5-native-color-state.json`, animated range persistence
in `evidence/m5-color-ranges.json`, `web/test/visual.test.js` and the native selected
Inspector tests. The four wheels share the verified binding; all18 parameters,
own-source clocks, locked/readonly/stale ownership and atomic selected edits are
covered. Actual scalar, independent crossed-range and wheel-pointer edits,
Undo/Redo, exact Saved reopen and two nonneutral moving R9700/native frame matches
are recorded in `evidence/f4-color-audio-controls-workflow.json`.

TS026's scientific scope/context requirement remains on the scope capability;
it does not require repeating every wheel gesture at every OS scale. Global
release checks remain mandatory in F7. Compressor stays partial for a concrete
native workspace gap: band input-level/gain-reduction overlays and its active
response curve. Existing prepared telemetry already provides band levels and GR;
connect those to the visible compressor without a new DSP/transport engine.


## Mask gestures and live recording waveform — 2026-10-23

Current mask/recording controls: **http://127.0.0.1:8855/**,
source `83bb2d1`, binary `85abac2dafdd`, service
`venturi-web-halo1-masks-recording.service`, PID249647. Native mask pixel/range scrubs,
four scalar sliders and reusable cancellation are delivered. Voiceover now draws
actual captured amplitude using native100Hz bins, bounded to120KB, without a new
audio engine or changes to retained PCM/take recovery.

The136-case affected client gate and41.49s embedded build pass on halo1 with
peak1,661,390,848 bytes. Existing native/Clippy/render/export checks are reused.
Actual Windows adds Rectangle, scrubs CenterX0to20, cancels with Escape, then edits
Feather0to181.1166534 with the slider; each edit adds one Undo. Undo/Redo and exact
Saved reopen pass. Master, Color grade, other timelines and the prior Color Saved
project remain unchanged;39 prior Sessions/40 PIDs, NAS/proxy protection pass.
See `evidence/f3-masks-recording-controls-workflow.json` and its screenshot.

Recording waveform is verified through capture/progress/drawing regressions;
physical microphone/output and OS blur/modifier/DPI/M7 acceptance remain open.
Next compact UI fix: at775px the Inspector drawer can cover Clip list targets;
collapse the drawer to access them until popup stacking/dismissal is corrected.
Ledger remains **52 done /38 partial /2 excluded**, full F1-F7/M7 active.


## Native Color/compressor direct controls — 2026-10-23

Delivered `aa84c4c` on halo1/8855: compact Color scalar/range and compressor
dynamics controls, with stable Inspector focus/scroll. Actual Windows one-Undo
edits, crossed ranges, band reset/Undo, wheel movement and exact Saved reopen
pass. Two R9700 native/API frames and one80ms PCM fragment match exactly.
Affected R2/R3 client runs and CSS-only R4 build pass; counts overlap. No new
export, physical audibility or fullM7 claim. See COMPLETION_PLAN.md and
`evidence/f4-color-audio-controls-workflow.json`. Ledger52/38/2; rows partial.


## Preserved Inspector/audio cancellation and transition gestures — 2026-10-23

Delivered `124fbb4` on halo1/8854. Selected Inspector draft cancellation keeps
mounted controls usable; final disposal removes bindings. Queued color applies
honor cancellation. Validated unchanged audio-chain Apply preserves Redo,
generation, native compound caches and dirty state. The Effects palette is compact.

The connected Windows workflow verifies unchanged Apply/Redo, actual transition
palette blocked/explicit replacement, duration11to19 handle and exact Save/reopen.
Four native/100 unique client cases, formatting, Clippy and build pass, preserving
38 prior Sessions/39 PIDs and shared files. See COMPLETION_PLAN.md and
`evidence/f4-inspector-audio-workflow.json` for the retained first failure, focused
rerun, hashes, screenshots and explicit physical/Alt/DPI limits. Ledger52/38/2;
full F1-F7/M7 remains active. Color scalar/range and compressor controls planned
at that delivery are subsequently qualified above.

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

2026-10-23 - development branch feat/venturi-web.

## Active completion objective

Current native font/effects delivery: **http://127.0.0.1:8851/**, source `9a946dd`,
binary `da479e56f98c`. Snapshot-only font preview/Cancel/one-confirm Undo/Redo,
connected animated moving filters, Adjustment interval and audio-fade output are
qualified. The complete701-frame FullHD Web/native export has identical bytes;
Windows download and natural29.226s EOF pass. See
`evidence/f3-effects-montage-workflow.json` and COMPLETION_PLAN.md for scope and
preservation. Adjustment and Exposure/Blur/Shadow advance to done:
**51 done / 39 partial / 2 excluded**. Font hover/wheel/scaling and fade-handle
100%/150% mapping remain explicit; the full F1–F7/M7 goal remains active.

Preserved saved-preset permanent Delete delivery: **http://127.0.0.1:8850/**,
source `ebbafda`, binary `78c6f86a346b`, service
`venturi-web-halo1-preset-delete.service`, PID 211545.
Confirmed active/archived removal binds the captured revision, shared lock and
strict owner/version-2 intent; durable receipts recover retries/restarts without
re-deleting a replacement or changing project dirty/Undo state.
**41 native / 63 client cases pass**; after the sole R1 Clippy style failure,
R2 passes Clippy (8.07 s) and build (41.00 s), reusing unchanged tests; peak
1,524,707,328 bytes. Destructive/recovery checks use owned Linux fixtures.
Actual Windows verifies compact actions, captured-name confirmation, Cancel,
list Delete and Escape; no NAS preset is deleted. Saved reopen leaves
`Venturi_Preset_Delete_V1.vvproj` at frame 0/empty Undo, SHA
`cc94bfc1b772598bacaa73de29421d045c3cb050b247da877c41e0b3082a5aff`.
All 34 prior Sessions/35 PIDs/35 Saved files/34 originals, five new local copies,
four fixed NAS files and the old proxy are unchanged; runtime peak 219,017,216
bytes. See `evidence/f5-preset-delete-workflow.json` and
`f5-preset-delete-confirm.png` / `f5-preset-delete-workspace.png`.
No new export or full M7 acceptance is claimed. Both F5 rows remain partial;
the ledger stays **49 done / 41 partial / 2 excluded** and the full goal is active.
Next complete connected effects/font/background, moving Exposure/Blur/Shadow,
Adjustment interval and audio-fade output behavior, including native font preview;
reuse already-qualified default-font and three-transform-frame proof.

Preserved portable Library copies and preset activation delivery:
**http://127.0.0.1:8849/**, source `efd5f59` (feature `5a856e4`), binary
`80c54dbc8eb2`, service `venturi-web-halo1-library-copies-r2.service`, PID 209284.
Native Add to Project uses readable `library/<originalname>` copies, native
legacy-name handling and collision suffixes, with full-byte verification,
confined publication and pinned destination witnesses. Existing flat copies and
saved projects are unchanged. Saved presets apply through Enter or double-click
using the existing native command and current selection; project reopen refreshes
the epoch-bound panel instead of leaving Apply stale.

Actual Windows imports two native NAS assets as readable media 13 and compound
media 14/child timeline 4, verifies cached no-op and Undo/Redo, and plays Source
to EOF at 5.184 seconds. The shared preset applies DropShadow to Solid 14 through
Enter/double-click, with Undo/Redo and Save As/reopen. Apply remains enabled after
the project epoch changes, without manual Refresh. The bounded gate covers
**58 native cases** (54 reused and four affected cases) and **114 client cases**;
syntax, formatting, all-target Clippy and embedded build pass. The final JS-only
gate reuses unchanged native/Clippy results, builds in 40.13 seconds and peaks at
1,526,898,688 bytes. No new export or physical drag/DPI qualification is claimed;
unchanged render/audio/export evidence is reused.

Final `Venturi_Library_Copies_V1.vvproj` is Saved/frame 0/empty Undo, SHA
`2fa1646d5cc282abf5f7d1437c57745edc1f804b6312f7b3a4217e0dba3b7b6c`.
All 33 prior Sessions, 34 PIDs, 33 prior Saved files, 33 local originals, the old
proxy, four NAS assets/preset files and nested copied dependencies are preserved;
the original candidate Saved bytes are unchanged. The ordinary viewport is
restored. See `evidence/f5-library-copies-workflow.json`,
`evidence/f5-library-copies-workspace.png` and
`evidence/f5-library-preset-workspace.png`. Both F5 rows remain partial; the ledger
stays **49 done / 41 partial / 2 excluded** and the full goal remains active.
Saved-preset permanent Delete is subsequently delivered above.

Preserved Library removal delivery: **http://127.0.0.1:8848/**, source
`139418d`, binary `749e97fa8c20`, service
`venturi-web-halo1-library-delete.service`. Native Library selections now have
confirmed permanent removal from Delete/Backspace, Edit Delete and collapsed
Asset actions. Active/archived revisions bind the complete set. The existing
prepared job, shared locks, durable journal and receipt infrastructure is reused;
removal v2 journals refuse older readers without losing ordinary v1 recovery.
Cleanup retains active/archive/backup references and uncertain or replaced files;
project copies/history are unchanged. A validated ACK stops only matching
Library Source, including when its panel has closed.

The single bounded gate passes **78 native / 75 client cases**, formatting,
main syntax, all-target Clippy and embedded build, peak 2,020,155,392 bytes.
Actual destructive/recovery checks use owned temporary Linux fixtures. Actual
Windows checks single/multiple confirmation, keyboard Delete, Edit ownership,
Cancel/Escape and exact unchanged Session/Saved bytes afterward. No permanent
browser deletion or new destructive CIFS campaign is claimed. Save As/reopen
leaves `Venturi_Library_Delete_V1.vvproj` Saved/frame 0/empty Undo, SHA
`ffc98814d061219bf0cc59b3bb0f016c4b10b31d05e3730580503c13c519c1cd`.

All 32 prior Sessions, 33 PIDs, 31 prior Saved files, 29 fixed local originals,
the archived NAS original, both native manifests/shared media and global proxy
remain unchanged. No NAS writes were made. Desktop1280x720 is checked; ordinary
viewport is restored. Runtime peak is 215,527,424 bytes. See
`evidence/f5-library-delete-workflow.json` and confirmation/workspace images.
Reuse unchanged renderer/export evidence. Ledger stays **49 done / 41 partial /
2 excluded**; broader physical/Library/preset/release work and the full goal stay
active. Git auto packing unexpectedly started locally during commit; the owned
job was stopped and repository automatic maintenance is now disabled.

Preserved Library pool/Source delivery: **http://127.0.0.1:8847/**, source
`024a7ee`, binary `a23a77c45e87`, service
`venturi-web-halo1-library-pool.service`. Ordered native Library selections now
import into the project pool with one native Undo and no timeline placement.
All-cached reimport adds neither duplicates nor history. Double-click or collapsed
Preview opens the first ordinary managed raw file in Source before import;
strong identity keeps that Source job usable across import/Undo/Redo, while a
project switch rejects the old epoch. Compound composition stays outside Source.

The bounded gate passes **10 native / 277 client cases**, syntax, formatting,
all-target Clippy and embedded build (peak 2,005,843,968 bytes). Two initial
test-only constructor/name fixtures were corrected before the passing gate.
Actual Windows previews a Saved asset before import, imports two existing assets
as roots 11/12 and child timeline 3, plays the same Source to EOF at 5.184 seconds,
reimports without a new Undo, and exercises native batch Undo/Redo. Original
timelines, ten root clips, markers, mixes and effect values remain unchanged.
Save As/reopen leaves `Venturi_Library_V1.vvproj` Saved/frame 0/empty Undo, SHA
`f843c2ae3c8d6f6788b6920baa037cb72c49dd0835366f2a3bb751703e40a4fd`.

The 657,278-byte project copy matches its managed source SHA. Both native asset
manifests and their shared media retain exact bytes, identity and timestamps;
no NAS writes were made. All 31 prior Sessions, 32 PIDs, 29 prior Saved files,
24 fixed local originals, the archived NAS original and shared proxy remain
unchanged. Actual 1280x720 layout is checked and the ordinary viewport restored.
Runtime peak is 231,530,496 bytes. See `evidence/f5-library-pool-workflow.json`
and Source/pool screenshots. Reuse prior renderer/export evidence; no new export,
continuous playback during import, physical DPI or full release claim is made.
Ledger remains **49 done / 41 partial / 2 excluded**; the full goal stays active.

Preserved compact-Selection delivery: **http://127.0.0.1:8846/**, source `89a7552`,
binary `6958f227e039`, service `venturi-web-halo1-command-ownership.service`.
Delete/Backspace now follows Media, Library, timeline or key-editor ownership;
File/Edit retain the last panel. Project-media removal preserves source files and
offline timeline clips. Selection keeps its native summary, with metadata, trim,
Slip and Compound details collapsed. Repeated all-track controls and video Solo
leave Inspector; header/context actions and concise Edit/Timeline routes remain.

Three native checks and **158 client cases**, formatting, all-target Clippy and
embedded build pass. The initial Library test DOM lacked dataset; its simulation
was corrected without changing production, and the passing native results reused.
Actual Windows verifies pool Delete and Edit-menu removal with an unrelated clip
selection, timeline-only Delete, native Undo, opening closed Slip/Compound details
and exact Saved reopen of `Venturi_Focus_V1.vvproj` (frame 0, empty Undo).
Both timelines, all ten clips and four physical media descriptors are restored;
compound content hashes are native cache revisions, not immutable source hashes.
The 1280x720 desktop check is complete and the ordinary viewport is restored.
All 30 prior Sessions, 31 PIDs, 27 prior Saved files, 21 fixed local originals,
the NAS original and shared proxy remain unchanged. Runtime peak is 214,544,384
bytes. See `evidence/f1-command-ownership-workflow.json` and Selection images.
No new export/physical DPI/full release qualification was claimed at that checkpoint.
Library pool import, pre-import Source and permanent asset removal are
subsequently delivered above.
Ledger remains **49 done / 41 partial / 2 excluded**.

Preserved context-menu delivery: **http://127.0.0.1:8845/**, source `b23e87d`
(main feature `f3d1371`), binary `3f4e66ec5ba1`, service
`venturi-web-halo1-context-menu-r3.service`. Clip, background, ruler, marker and
track menus reuse native actions and dialogs with each action's captured selection
policy. Opening does not select or seek. Twelve native color swatches use a compact
six-column grid; linked speed presets are atomic and one Undo. Program pauses at
its current frame before menu ownership capture; keyboard access remains guarded.

The bounded gate passes **29 native / 115 client cases**, formatting, all-target
Clippy and embedded build (peak 1,972,154,368 bytes). JS-only pause and actual
clip-list close/scroll fixes pass syntax/rebuild, reusing unchanged checks.
Actual Windows checks Title-only Blue with unrelated media selection, color
Undo/Redo, linked 200%/Undo/Redo, marker add/edit, stable playback pause and
Save As/reopen. `Venturi_Context_V1.vvproj` is Saved/frame 0/empty Undo; seven
original media clips, second timeline tracks and title/solid/filter values remain
exact. Runtime peak is 275,623,936 bytes. The default viewport is restored after
the actual 1280x720 accessible swatch check.

Title-only filters preset `Venturi Context Shadow 20261023` is saved to native
`madrock-library/presets/` (6,273 bytes). Both this project and preserved Colors V1
read the identical native payload without changing Sessions. All 29 prior
Sessions, 30 PIDs, 25 Saved files, 18 fixed local originals, the NAS original and
shared proxy remain unchanged. Only the clean owned, not-yet-delivered context
candidate was replaced under exact Saved/history/PID guards during its UI fix.
See `evidence/f1-context-workflow.json` and context workspace/palette images.
Reuse the unchanged renderer/export evidence; no fresh export, physical Canvas
pointer/DPI, shared-preset drag/crossproject Apply or full F1-F7/M7 closure is
claimed. Ledger remains **49 done / 41 partial / 2 excluded**.

Preserved visual-color delivery: **http://127.0.0.1:8844/**, source `8594968`
(main feature `ac4d974`), binary `6fb00d49a181`, service
`venturi-web-halo1-color-picker-r2.service`. Selected Title, background, outline,
Solid and DropShadow colors now use compact swatches and a visual popup with
precise RGBA fields collapsed inside it. Native linear hue/saturation, gamma
value and linear alpha are retained; optional hex entry converts sRGB bytes.
Opening/canceling/no-op does not quantize Saved floats. Existing native selected
edits, keys, reset, Undo and persistence remain authoritative.

The bounded gate passes two native asset/import checks, 83 client cases,
formatting, all-target Clippy and embedded build. Actual Windows found an internal
popup scroll closing numeric Apply; `8594968` corrects it and passes the focused
83-case gate/rebuild, reusing unchanged native/Clippy results. Actual editing
covers all five rows, title Undo/Redo, alpha-only RGB preservation, fine hue
keyboard edit and precise one-channel Solid editing after internal scrolling.
Save As/reopen retains exact native values in `Venturi_Colors_V1.vvproj`, Saved
at frame 0 with empty Undo. Seven original media clips, second timeline and
Adjustment grade remain unchanged. Popup accessibility is checked at 1280x720;
the default viewport is restored. Runtime peak is 214,487,040 bytes.

All 28 prior Sessions, 29 PIDs, 23 prior Saved files, 15 fixed local originals,
the NAS original and shared proxy are unchanged, including the previous color
editor's eight Undo entries. See `evidence/f3-color-picker-workflow.json` and
workspace/Solid images. Reuse the unchanged renderer matrix and previous
701-frame native export/browser EOF evidence; no new changed-color export is
claimed. Physical pointer/DPI, continuous hover preview and full F1-F7/M7 remain
open. Ledger remains **49 done / 41 partial / 2 excluded**.

Preserved Effects/Title delivery: **http://127.0.0.1:8842/**, source `4ad4ad1`
(main feature `086ad60`), binary `dfb6b7081bbd`, service
`venturi-web-halo1-effects-placement-r2.service`. The Effects palette now places
native Title/Solid/Adjustment generators on chosen timeline targets and applies
filters to the pointer clip, adding or enabling them in place. Generator clicks
choose a free unlocked video lane or add one. Track creation/insertion is one
Undo; safe overlap, locks, linked/crossing and context guards remain. The native
BlackAndWhite entry is available. Title typography discovers server-native
families and styles lazily, preserving unknown Saved values and individual
changed-field selection semantics; manual fields stay collapsed.

The bounded gate passes 40 native and 111 client cases, formatting, all-target
Clippy and embedded build (peak 1,945,440,256 bytes). Actual Windows found and fixed
a monochrome click scope error; its JS-only rebuild reuses unchanged gate results.
Actual browser editing creates all three generators, selects DejaVu Serif/Bold,
verifies text and filter Undo/Redo, preserves seven original clips, and saves and
reopens `Venturi_Effects_V1.vvproj` with empty Undo. The 701-frame Full HD H264/AAC
export reaches actual browser EOF 29.226 seconds/ended=true, using x264/CPU decode
and R9700 Vulkan composition. Current runtime peak is 495,550,464 bytes.
All 26 earlier Sessions, 27 PIDs and 19 Saved files, local/NAS originals and shared
proxy movie are preserved. A pagehide-only Saved playhead update was hash-guarded
back to the exact previous Saved bytes without changing its Session/history.
See `evidence/f3-palette-fonts-workflow.json` and workspace/export images.

Physical HTML drag/DPI, menu-hover preview and full F1-F7/M7 acceptance are not
claimed. Ledger stays **49 done / 41 partial / 2 excluded**. Heavy work remains
halo1-only with 8 CPU/4 GiB/no swap and low priority; Windows uses one existing tab.

Preserved shared-original delivery: **http://127.0.0.1:8840/**, source `dc42d2a`,
binary `afa9c0ebffc6`, in `venturi-web-halo1-shared-originals.service`.
Library now offers an explicit archived-original Reference through the configured
read-only shared root, alongside the existing project copy. Qualified tokens bind
the prepared strong file identity; import/relink cannot borrow a newer grant for
an old acknowledgment. Project writes, scans and replacement pickers stay
project-only. Approved shared originals work through Source, proxy/Take,
capture/clipboard/OTIO, save/reopen and existing native export.

The bounded gate passes **56 distinct native cases / 59 executions** and
**11 client cases**, formatting, all-target Clippy and embedded build; the initial
test-only missing Id import was corrected before the passing gate. Actual Windows
references the 657,278-byte NAS clip without a project copy, plays Source to EOF,
appends one linked 124-frame pair at frame 457, and preserves the five existing
clips through Undo/Redo. Save As/reopen retains the shared paths with empty Undo.
Program reaches terminal frame 580; its player resets after EOF. The native
581-frame Full HD export reaches actual browser EOF 24.213 seconds/ended=true.
Final state is Saved/frame 580 in `Venturi_Shared_Originals_V1.vvproj`.
All 24 prior Sessions/25 PIDs/15 Saved files, three local originals, the NAS
original identity/bytes and the shared proxy movie are unchanged. See
`evidence/f5-shared-originals-workflow.json` and its workspace/export images.

Ledger remains **49 done / 41 partial / 2 excluded**; shared Library stays partial
and no new shared-preset acceptance is claimed. Durable export's existing native
absolute-path audio/video pipeline is unchanged; this is not a broader FD-reopen
fix. Continue the full F1–F7 functional and release work, including physical,
representative/dense/DPI and M7 requirements.

Preserved interactive audio-graph delivery: **http://127.0.0.1:8839/**, source `b6becaf`,
binary `9aa00b8af85a`, in `venturi-web-halo1-audio-graphs.service`.
Native EQ and compressor inserts now have interactive parameter handles over
SVG curves from revision-bound native response queries. EQ keeps its +/-27 dB
display, +/-24 dB gain limit, shape-specific gain behavior and rounded Q changes
at factor 1.15. Compressor crossover handles retain the native 1.2 ratio guard;
impossible domains are disabled. Its static response is explicitly makeup-only,
not measured compression activity. Precise per-band fields remain collapsed,
with presets and numeric Apply preserved. No browser DSP is introduced.

The bounded gate passes **14 native cases** (12 audio-filter matches including
3 Source-audio cases, one Host and one API) and **58 client cases** (40 prior,
8 new top-level graph cases and 10 cancellation subcases), plus formatting,
all-target Clippy and embedded build. Worker peak is 1,947,037,696 bytes.
Actual Windows checks add EQ then compressor, change band 3 Gain 0 to 0.1 dB and
Q to 0.81, crossover 200 to 201 Hz and mid-band makeup 0 to 0.1 dB. Six native
commands preserve chain order; Undo removes only the last makeup edit and Redo
restores it. Save As/reopen preserves the exact parameters and native PCM hash.
Final state is Saved in `Venturi_Audio_Graphs_V1.vvproj`, frame 0/empty Undo.
Native response reads return 128 EQ and 241 compressor points, reject a stale
generation with 409 REVISION_CONFLICT and leave Session unchanged.
All 23 prior Sessions, 24 PIDs, 13 Saved files, three originals and the shared proxy
movie remain unchanged. See `evidence/m5-audio-graphs-workflow.json` and the
EQ/compressor workspace images.

Actual OS pointer drag/wheel/reset/cancel is not claimed; deterministic graph
tests cover those gestures, local-only motion, no-op and ownership/error guards.
A motionless real handle click remains Saved. No new composed movie/export is
rendered for this parameter UI/read-only response block; native DSP and transport
are unchanged, so reuse `evidence/m7-audio-source-fd-workflow.json`.
The owner V1 stopped-audio decision remains. Ledger stays
**49 done / 41 partial / 2 excluded**; full F4/M7, physical/hardware and
representative/dense/DPI qualification remain open.

Preserved compact mixer delivery: **http://127.0.0.1:8838/**, source `a2d1358`,
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
`Venturi_Mixer_V1.vvproj`, master Gain/Pan 0, timeline1/frame 0 and empty Undo.
OS pointer drags/Shift/cancellation were not physically qualified here; their
behavior is covered by deterministic client cases. All 22 prior Sessions,
23 PIDs, 11 Saved files, three originals and the shared proxy movie are unchanged.
See `evidence/m5-mixer-controls-workflow.json` and its workspace image.

This UI-only block changes no native DSP or Program/export transport; reuse the
qualified stopped-audio workflow in `evidence/m7-audio-source-fd-workflow.json`.
Interactive EQ/compressor graphs are delivered in b6becaf above. Physical audio/hardware,
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
reopened at timeline1/frame 0 with empty Undo. Timeline DTOs/file media/folders/view
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
history and final frame 0 are unchanged. See
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
Approved nested file/tree import preserves native folder merge/pruning, global
path reuse, partial probe results and one Undo. Prepared selected/folder ByName
and explicit Chosen Relink preserve IDs, clip ranges/links and native retiming;
all metadata probes use the bounded worker, including the original legacy route.
Source/scan/context revalidation and original receipt replay remain authoritative.
Fresh dialogs reset counts and fold results. Actual Windows3-file4-folder1-error
import/UndoRedo, two missing-file recoveries, five-clip Full HD montage, Program
EOF456 and457-frame Full HD/AAC export EOF pass. Final Saved clone/client reload,
online skips and nested-file path reuse preserve saved bytes and history. The
83 affected native cases,1291 aggregate client cases, formatting/Clippy/build and
final116 affected client cases/build pass; unchanged checks are reused. See
`evidence/f2-project-media-workflow.json` and screenshots. Thirteen prior editors
and ds4 remain preserved; halo2/NAS are untouched. Ledger48done/42partial/2excluded.
Full F1-F7/M7 remains active; next pool presentation and proxy/derivative fidelity.

The preserved project-pool delivery is **http://127.0.0.1:8826/**, source `5d8d15d`,
binary `7420a371bfe9`, in `venturi-web-halo1-project-pool.service`.
Project Media now drags its selected visible set in panel order. Name/Duration
headers use native comparisons; search/folder/type filters prune hidden mutation
targets and clear stale/pending Relink drafts. An unselected drag selects only
that row. Timeline > Insert selected media provides accessible insertion while
pool Enter retains Open. Whole sources are independent of Source marks/jobs.

Strict `place_project_media` uses current Session metadata and approved-file
witnesses without probes. The shared native Library whole-placement builder
retains Library32 admission and allows256 project roots/4096 conservative clips.
Native still5s, rational endpoints, all stream ordinals, per-source links, new
tracks, locks, overlap/overwrite and compound cycles remain authoritative. The
ACK selects new clips with late-intent protection and one InsertClips Undo.

All1270 client cases and10 affected native cases pass, including receipt replay
and unchanged Library/marked Source behavior; formatting, all-target Clippy and
build pass. Actual Windows Full HD video/still/two-stream audio drag creates five
clips on V1/A1/A2 in visible rather than click order. One Undo removes all clips
and A2; Redo restores the exact model. The focused menu action recreates the same
semantic montage. Save/client reload retains native model/history; Program
reaches EOF456 and its457-frame H.264/AAC export reaches19.05s without error.
Eleven earlier halo1 editors and ds4 remain unchanged; halo2/NAS are untouched.
See `evidence/f2-project-pool-workflow.json`. Ledger47/43/2 and full F1-F7/M7 stay
active. Next implement approved nested-source/tree import and prepared project
Relink. Pool layouts, representative long4K/dense/DPI and physical output remain
open. This proof uses a19-second montage and client reload, not server restart.

### Preserved Source-lookahead delivery

The preserved halo1 delivery is **http://127.0.0.1:8825/**, source `4f94773`,
binary `318f29163b8b`, in `venturi-web-halo1-source-lookahead.service`.
Source prepares at most one adjacent native window during normal playback.
Its separate observer never changes the current movie, clock, waveform or
placement job. Version/range/audio checks bind every ACK/poll and final ready
read;10s heartbeat retains the future. EOF waits for the old audio tail and
verifies the exact absolute boundary before autoplay. Speculative failure does
not interrupt the current movie or retry itself; boundary failure requires
manual Play. Pause/seek/Stop/hidden/modal policy detach local observation.
Windowed cancellation never DELETEs a shared native job. Fast audio retains
existing foreground rollover rather than competing with speculative work.

The189-case affected client gate and embedded build pass; native code/gates are
unchanged. The actual Windows two-stream67s1x run shows the next1800–2011 job
ready while0–1800 plays and then reaches originalEOF2010 on that exact prepared
attachment without another Play. No decoded-player error occurs. Saved project
bytes, media/timelines, generation/history and Program view remain unchanged.
Tail playback was not sampled before EOF; acoustic gap duration and physical
output are not claimed. All ten prior halo1 editors and ds4 remain unchanged;
halo2/NAS are untouched. See `evidence/f2-source-lookahead-workflow.json`.
Ledger47done/43partial/2excluded and full F1-F7/M7 remain active. Next complete
remaining F2 import/proxy/derivative fidelity and representative-media acceptance.

### Preserved waveform delivery

The preserved halo1 delivery is **http://127.0.0.1:8824/**, source `f1fd010`,
binary `ae29b4545c2a`, in `venturi-web-halo1-source-waveform-r4.service`.
Audio-only Source displays the full native waveform for every audio stream,
marked-range shading and a fluid absolute playhead, without video zoom. Click
and scoped keyboard commands seek; dragging inserts the marked All range.
Visible-lane demand keeps all128 streams reachable without raising the shared
64-entry/64-MiB asset cache,16-MiB canvas limit or single-loader concurrency.
Both inner loader and queue bind attempts to strong FD versions. Interrupted
reads resume only for visible waveform lanes when idle; failed analysis and
canceled explicit retries retain the manual Refresh policy.

The initial96-case client gate, two affected native embed/Host cases, formatting,
all-target Clippy and build pass. A final67-case assets-only gate/build covers
the FD-attempt and canceled-observer corrections; unchanged cases are reused.
The actual Windows67.021-second two-stream48-kHz audio file loads both lanes
without Refresh, seeks to1889 beyond the first1800-frame window, replays from
2010 to0 and shows the advancing waveform clock while audio plays. Dragging
Source30–120 at30fps creates linked A1/A2 clips0–72 at24fps without seeking.
One Undo removes both clips and A2; Redo restores the exact model. Save, client
reload, natural Program EOF71 and Full HD/AAC exported-file EOF pass. The
decoded3.008-second export has mean -29.5dBFS and peak -20.5dBFS; this proves
file signal, not physical output. See `evidence/f2-source-waveform-workflow.json`.
All earlier nine halo1 Sessions/Undo, their project bytes, ds4 and NAS remain
preserved; halo2 is untouched. Ledger47done/43partial/2excluded and full F1-F7/M7
remain active. Speculative Source continuation is delivered in4f94773; continue
the remaining F2 and full-plan requirements.

### Preserved Source-placement delivery

The preserved halo1 delivery is **http://127.0.0.1:8822/**, source `9ecf29d`,
binary `2f3f3cdc11d1`, in `venturi-web-halo1-source-placement-r5.service`.
Marked Source video/image and compact video/audio handles place verified
original-media ranges in existing/new native tracks, with a collapsed keyboard
alternative. Stream roles match native insertion independently of preview
audition. File identity, endpoint rounding, overlap/linked-lock policy and
durable mutation receipts remain authoritative; each insertion is one Undo.
Source Replay at EOF returns to absolute frame zero. Successful view-write
acknowledgements retain their CAS revision across playback and delayed local
snapshots, fixing the earlier position-persistence warning.

The bounded gate covers all547 vv-web cases using the546 initial passes and
three corrected affected cases; formatting, all-target Clippy and build pass.
Client coverage reuses1234 initial passes plus44 corrected event-harness cases
and14 final Source/shared-asset cases. A final14-case client/build gate covers
the two browser-found UI availability/default corrections. Actual Windows
qualification imports moving A/V, marks24–96, drags all/video/audio roles,
inserts on a new audio track, performs one Undo/Redo, saves/reopens, replays
Source from7274 to0, plays the264-frame montage to natural EOF and remembers263
without a CAS warning, and plays its Full HD/AAC export to natural EOF.
See `evidence/f2-source-placement-workflow.json` and screenshots. Earlier
halo1 Sessions, files, PIDs and live Undo, ds4 and NAS remain preserved; halo2
is untouched. The ledger stays47done/43partial/2excluded. The
audio-only Source waveform surface is delivered in f1fd010; remaining F2 behavior, full F1-F7/M7,
physical audio, long4K and dense/DPI acceptance remain open.

### Preserved floating Curves delivery

The preserved halo1 delivery is **http://127.0.0.1:8819/**, source `4e983c2`,
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

### Preserved native sampling delivery

The preserved native sampling delivery is **http://127.0.0.1:8818/**, source `6a1f020`,
binary `87ef35912694`, in `venturi-web-halo1-native-curves.service`.
Its independent Saved `Venturi_Native_Curves.vvproj` adds Opacity/Position X
animation to the Library montage. The graph reads fractional visible-range
samples from Rust; selected keys expose both adjacent segments, including the
incoming segment of the last key. Tangent edits preserve mixed parameter picks
and target the segment-start interpolation with one native Undo. Typed rows
clear the scalar plot while retaining shared lane editing and navigation.
Accepted samples and pointerdown geometry survive selection/drafts, avoiding
Bezier overshoot value jumps. Compact viewport labels retain accessible names.

The bounded halo1 gate passes 95 JavaScript cases and covers all 543 vv-web
cases: 542 passed initially; 15 affected curve cases pass after correcting the
new endpoint oracle to native exact endpoint clamping. Formatting, all-target
Clippy and build pass. Actual Windows editing creates five keys on two animated
parameters, changes the incoming tangent of source key120, retains three mixed
picks, restores exact curves with one Undo/Redo, zooms/pans the shared axis,
saves and plays the compound from frame315 to natural EOF391. Three readonly
viewport reads preserve the complete Session. See
`evidence/f1-native-curve-viewport-workflow.json` and its screenshot.

The protected halo1 ports8813/8816/8817 retain complete Sessions, project hashes,
PIDs and Undo chains; ds4 and both canonical native assets remain unchanged.
Halo2/H3 was untouched. The dedicated movable/floating Curves panel, physical
modifier-wheel/DPI and representative dense editing acceptance remain open.
The ledger stays **47 done / 43 partial / 2 excluded**; full F1-F7/M7 is active.

### Preserved Library delivery

The preserved Library delivery is **http://127.0.0.1:8817/** on halo1, source
`ac0ba1a`, binary `3af3f2e0872a`, in
`venturi-web-halo1-library-edit-r2.service`. Its independent Saved
`Venturi_Library_Edit.vvproj` uses the canonical NAS. Direct Library drag now
places selected native assets in panel order with linked streams and one Undo;
cached compounds retain edits and their current geometry. Actual Windows drag,
new-clip selection, Undo/Redo, R9700 playback through the imported child to EOF
and Save pass. Automatic pool refresh no longer invalidates the completed
selection. See `evidence/f5-library-asset-drop-workflow.json` and screenshot.
The remote gate covers 141 initial JS cases plus a 42-case client regression,
539 Rust cases with 26 affected reruns after test-only corrections, formatting,
all-target Clippy and build. Unchanged native/CIFS evidence is reused.
Both earlier halo1 editors keep complete Sessions, project hashes, PIDs and
Undo histories; ds4 keeps its PID and original native asset. One reusable
Timeline 1 asset was added to the real NAS. Halo2/H3 was untouched. F5 still
requires full desktop GUI and broader offline/large-media lifecycle acceptance;
the ledger remains 47 done / 43 partial / 2 excluded and the full goal is active.

The owner moved new execution to free halo1 on 2026-10-22 because halo2 is
shared with H3 work. The preserved Color/Audio runtime is **http://127.0.0.1:8816/**,
source `63f4919`, binary `b80a7d0c3bae`, in
`venturi-web-halo1-color-audio-r2.service`. Its independent Saved
`Venturi_Color_Audio.vvproj` uses the canonical NAS. Native scope guides,
responsive first-slot display, shared inline Mixer peaks and Solo/Mute are
implemented. Gain/pan drafts survive actual Program EOF; native Apply uses one
Undo, exact Undo/Redo and Solo/Mute work, and Save retains the final mix.
The 35 focused JavaScript cases and embedded build pass; unchanged Rust/CIFS
gates are reused. See `evidence/f4-native-guides-inline-mixer-workflow.json`.
Mix/effect edits still stop Program; physical audio/recording and full F4
acceptance remain open. No ledger row advances from this bounded increment.

The migration baseline remains running at **http://127.0.0.1:8813/**,
source `fd9bde4`, with a separate Saved `Venturi_Halo1.vvproj`. It uses the
existing NAS root `/mnt/madrock-share/madrock-library` for native assets,
`presets/` for presets and local ds4 on 8787 for the shared archive. Windows
created the project, imported a real archived video, inserted linked video/
audio, displayed a composed R9700 preview and saved. The CIFS staging timestamp
fix passes 45 asset-job cases, formatting, all-target Web Clippy and the embedded
build entirely on halo1. Windows then publishes one native asset on the actual
NAS without changing the complete Session, imports an independent exact-byte
copy with one Undo entry, preserves the timeline and saves. See
`evidence/halo1-workspace-migration.json` and
`evidence/f5-nas-readonly-stage-gate.json`. Native/Web concurrent coordination
on CIFS now passes `evidence/f5-native-web-cifs-catalog-gate.json`: actual native
components and real Web children cover assets, folders, attribute and audio
presets, stale writes, locks and durable recovery in an owned fixture on the
authoritative mount. A journal writer-close timestamp bug found by that gate
is fixed with read-only reopen, complete-byte and strong identity checks.
The 98 affected Web cases, formatting, all-target Clippy and build pass.
Library asset drag-to-timeline is implemented and qualified in the newer
8817 delivery above; manual Add to project and cached imports remain. Physical
desktop GUI and the rest of F5 still require acceptance. Existing
halo2 editors and dirty histories remain preserved. This migration does not
advance the functional ledger or imply full F1-F7 completion.

The connected verified-take implementation and Windows/R9700 workflow pass;
see `evidence/f6-verified-take-gate.json` and
`evidence/f6-verified-take-workflow.json`.
Plan/Confirm now bind to the displayed B version, including original stills,
and exact approved nested/Pasted Images paths survive replacement. The native
take probe runs outside the Session actor with cancellation and final revision/
descriptor checks. Source ALL avoids an unused selected-audio buffer; Program
excludes video outside its requested range while retaining real native eager
audio and active compound costs. Validation: 224 affected JavaScript cases,
529 Rust cases with three affected reruns, all-target Clippy and offline build.
The 20-shot/60-take fixture completes 20 linked replacements, followed by a
Windows stale-B refusal, one-entry replacement/Undo/Redo, Save and isolated
restart with exact native timeline/media and Review metadata preservation.
The saved 1280x720 preview matches native R9700 RGBA bytes. A 1920x1080,
1440-frame H.264/AAC export completes in 16.689 seconds, passes decoded tone/gap
checks, downloads and reaches natural 60.01-second EOF in the Windows player.
The reopened Saved project retains the durable export and its download.
Only `replace_take_atomic` advances to done: 47 done / 43 partial / 2 excluded.
`compare_take_AB` remains partial for sustained full-resolution comparison and
physical audio acceptance. Qualified source `a7565f6` ran only on isolated
port8813 and is stopped Saved; protected port8814 still serves its existing
`3f4de7f4` binary. The full F1-F7 objective remains active.

Source `eedcae3` completes the native/Web EQ and compressor catalog increment:
native Mixer now uses the shared catalog, lock, CAS and durable recovery journal,
preserving legacy Settings and Save drafts. Web refuses pending native recovery.
Its focused gate passes 9 JavaScript, 11 Web Rust and 45 native cases, all-target
Clippy and the offline embedded build under eight-CPU/4-GiB/no-swap limits.
Actual Windows library-only Save leaves the complete Session/history unchanged;
Apply uses one Undo, Undo/Redo restore exact timelines, and Save/restart retain
the applied EQ and shared preset. Clip list also closes before Export controls.
See `evidence/f5-shared-audio-presets-gate.json` and
`evidence/f5-shared-audio-presets-workflow.json`. The finite GPU-disabled
qualification service is stopped Saved. Canonical NAS/native-Web filesystem
coordination and physical desktop acceptance remain open; F5 stays partial.
This increment is committed and qualified separately from protected port8814.

The previous halo2 working candidate remains at **http://127.0.0.1:8814/**,
source `3952711`; see `evidence/current-workspace-delivery.json`. The enabled
resource-limited halo2 service serves a separate Saved project, active R9700
preview, native Library and the configured 33-item ds4 HTTP archive. Actual
Windows preview pixels and the compact panel are visible. Earlier protected
editors remain unchanged. This candidate advances the full completion objective;
its canonical native NAS, physical and remaining F1–F7 acceptance stays open.

After accepting the usable editing workflow, the owner resumed all remaining
functions and requested a new goal on 2026-10-22. Follow
[COMPLETION_PLAN.md](COMPLETION_PLAN.md): F1 editing/Inspector, F2 media/playback/
export, F3 advanced effects/timeline, F4 Color/Audio/recording, F5 shared library/
presets, F6 AI Review and F7 integrated release. The original baseline was 42
done and 48 partial; the current accepted ledger contains 47 done and 43 partial
in-scope capabilities. Continue the connected remaining blocks in that plan.
Report delivered functions, remaining defects and actual deployment state
without subjective percentages.

## Native reference UI and Color/Audio candidate

The owner supplied the original editor screenshots and prioritized UI/UX fidelity.
The candidate replaces permanent tool rows with compact application menus,
compact media rows and Video/Audio/Selection properties; the Viewer receives the
central space and narrow browsers use side drawers. Existing IDs, native editing
operations and advanced entrypoints remain. Source controls and Viewer overlays
open on demand. Timeline pointer inertia, native zoom/content bounds and
playhead reveal are implemented without adding synthetic OS-wheel momentum.

Color/Audio adds observed native Program telemetry, clock-bound Live meters,
selected live scopes, compact grouped wheels, guarded Auto Balance, stopped
Program reconciliation and held/resumed voiceover capture across preparation.
The five-minute/64 MiB recording limit remains. Physical device acceptance is open.

See evidence/native-ui-gate.json: the full JavaScript suite passes, native audio
origin/PCM checks pass, the audition identity regression is fixed, embedded JS/CSS
serving passes, and affected all-target Clippy/build pass on bounded halo2.
Actual Windows UI qualification is recorded in evidence/native-ui-workflow.json.
The enabled native UI service is available at port8812, code f3dcf1c; port8811
remains df50859 with an unsaved InsertClips operation and is preserved. The
source ledger is45 done/45 partial;
this gate does not by itself close remaining capabilities.

## Mask Inspector and continuous Slip implementation

Source `b06948b` adds compact native mask Inspector rows, source-clock keys and
navigation, native reset semantics, a Viewer pen entrypoint and stable mask
selection across edits. Slip pointer direction/rounding now match the native
editor, linked media extents are shown during the draft, and dual-edge source
windows update through a bounded latest-target preparation while retaining
the last verified pictures with a seeking indicator.

`evidence/f3-mask-inspector-gate.json` records 187 unique focused JavaScript and
51 unique focused Rust cases, affected all-target Clippy and the cached build.
After the shared GPU became available, the actual Windows workflow passed on
integrated source `130b30e`; see `evidence/f3-mask-inspector-workflow.json`.
Rectangle width/feather, Add/Subtract/Intersect composition, native scalar/path
keys at source12/24 on 150% media, Viewer pen and vertex edits, reset/Undo and
Path navigation after Slip were exercised. Both Slip directions change all
three linked source bounds together while retaining placement/length/fades/gain;
Undo/Redo and full timeline/media/view/mask metadata equality on Save/restart pass.

The three retained transform/crop/fade frames now match native/API RGBA bytes.
Three newly edited mask frames match byte for byte at both 320×180 and the
project's full 1280×720 on R9700/Vulkan. One HD attempt deferred before work when
the lock was busy; a subsequent free-lock observation allowed the bounded pass.
Physical DPI and prolonged uncached held-Slip continuity remain open. Only the
own isolated Saved runtime was restarted/stopped. Protected editors remain
unchanged; port8812 still serves `f3dcf1c`, with 8790/8811 retaining unsaved edits.
No broad capability row is closed by these focused improvements alone.

## Shared native library coordination and relink implementation

Source `2cc447d` adds cooperative native/web catalog locks, stale cached-record
checks, bounded native transaction recovery, coordinated media publication and
retention of media referenced by archived/previous assets. The desktop Library
panel exposes Refresh/errors and accepts an absolute `VENTURI_LIBRARY_ROOT`.
Web preset reads hold a shared catalog lock, and both web catalogs refuse
pending native transactions without removing their recovery markers.

Native assets now expose contextual missing-file recovery from approved project
files. Preparation has an explicit cancelable job; final application reuses its
exact guarded Mutation and persists restored/still-missing counts in the command
and recovery receipt. Repairs preserve native IDs, metadata and fingerprints,
restore managed paths and retain SHA64 content authentication. Recursive folder
search is added in the subsequent approved-folder block; metadata-incompatible
replacements remain unavailable.

`evidence/f5-shared-native-library-gate.json` records 85 passing focused
JavaScript cases, 135 unique web Rust cases, 24 native desktop library cases,
affected web/native all-target Clippy and the embedded build on bounded halo2.
The initial failures exposed legacy read compatibility, path-derived fingerprint
assumptions and backup journal validation; their corrected affected rerun passed.
An explicit-prepare HTTP fixture was corrected to wait for ready before commit.

This is a source implementation gate. Its browser relink is covered by the
subsequent folder workflow below; shared filesystem qualification and compatible
deployment remain pending. A fresh read of halo2
mountinfo found no CIFS/NFS mounts; the halo1 NAS evidence is not a halo2 mount.
No mount/archive was changed. Protected 8790/8811 edits and the port8812 service
remain unchanged; neither shared capability is newly accepted. Ledger46done/
44partial and full F1-F7 scope remain active.

## Approved source folders and recursive native library import

The connected F5 increment adds an epoch-bound, paged browser inside the
approved project source root, contextual recursive missing-file search and
native folder import. Directory reads run outside the editing actor with one
shared permit. Import merges native folder names, skips same-folder source
fingerprints, retains per-file errors and commits one guarded transaction;
recursive relink preserves the existing authenticated-content rules.

Preparation uses the existing cancelable worker and exact Mutation on commit.
Recovery accepts partially published new assets only when the pending manifest
declares them; unknown catalog additions still refuse recovery. The initial
integrated run passes 61 focused JavaScript and all 521 web Rust tests. An
atomic API deprecation and truthful ImportTree progress are corrected; their
six source-browser and three import cases pass on the affected reruns, with
all-target Clippy and the offline embedded build. See
`evidence/f5-approved-folders-gate.json`.

Source `130b30e` passes the actual Windows workflow in
`evidence/f5-approved-folders-workflow.json`: chooser cancellation/focus,
hierarchy import with visible per-file errors, repeated merge/skip without
duplicates, cancellation of running preparation, contextual recursive relink,
project import, Save and real isolated restart. The restored file matches its
original SHA256; library IDs/folders, project bytes and media/timeline models
survive restart. The finite GPU-disabled service is stopped Saved, all three
protected editors are unchanged, and no NAS or inference workload was modified.
Shared filesystem/deployment acceptance remains open; no new parity row is
accepted by this isolated workflow.

The following compact Library pass keeps the folder/search/list/paging and
Add to project actions primary. Capture, archived filters, folder management,
help and selected-asset maintenance move into closed contextual sections.
Source chooser rows/footer controls are compact and long errors/paths wrap
inside the panel. All accessible action names and transfer/CAS/cancel handlers
are retained. Its 61 focused JavaScript cases and embedded build pass; unchanged
Rust/Clippy and renderer gates are reused. See
`evidence/f5-compact-library-gate.json`. Actual Windows 1440×900 and 544×900
qualification passes in `evidence/f5-compact-library-workflow.json`: contextual
sections, chooser import/cancel and per-file error wrapping work, with page and
panel scroll widths equal to client widths. A one-pixel hidden narrow Inspector
border is corrected with a CSS-only rebuild and unchanged checks reused.
Source `3952711` is delivered at port8814; its actual R9700 preview completes
at 960×540 and all protected sessions remain unchanged.

## Native timeline and Inspector gesture qualification

Source `9f7dcc4` adds native selected-group trim and adjacent Roll, explicit safe
versus overwrite policy, Alt-duplicate with exact fresh-copy selection receipts,
constant-only gain lines, shared cross-parameter key picks and native pointer
key movement with value changes limited to the grabbed scalar. Numeric fields
support direct scrub; Rotation/Crop/Opacity have compact sliders. Selection
shows a guarded native table. Native limits, linked groups and one Undo remain
in Rust. The existing native UI layout is retained.

`evidence/f1-native-gestures-gate.json` records 1082 unique JavaScript and 493
unique vv-web cases, fmt, affected all-target Clippy and cached build on bounded
halo2. `evidence/f1-native-gestures-workflow.json` records actual Windows 1440×900
scrub/sliders, pivot/Flip/crop/softness, Roll, linked trim, singular video/audio
fades, gain line, mixed-key drag, Undo/Redo and exact save/restart. All five
timeline models and ProjectView match; selected native properties/keys match.
The properties_static row is accepted, bringing the ledger to 46 done / 44 partial.
Targeted rendered transform/crop/fade parity and physical Alt/DPI/500-clip checks
remain explicit; the earlier 43-frame mask/blend/transition matrix does not cover
these cases. The finite 8813 service/tunnel is stopped Saved and its tab closed.
The native UI at 8812 remains `f3dcf1c`; 8790 and 8811 retain their unsaved work.

## F1 implementation â€” integrated qualification in progress

The selected Inspector now follows native per-property target and clock rules:
Position deltas, absolute scalar/gain edits, constant versus animated tracks,
row diamonds, full-track previous/next metadata, resets and independent Flip
axes. Viewer transform handles use the same multi-selection bridge. Dedicated
scalar, value and cross-parameter key editors reject detached or obsolete
contexts and recheck live editing permission before dispatch.

Timeline paint, hit testing, Shift/marquee and effect drops share native reversed
video/ascending audio rows, separate scroll panes, a divider and row zoom.
Header flags retain native track IDs. Existing/new-track group movement keeps
opposite audio/video row offsets, native group frame bounds, ten-pixel endpoint
snapping and locked-destination fallback. New-track creation and linked movement
preflight atomically and produce one Undo. Safe edits still reject overwrite.

One bounded cached halo2 gate passes 924 JavaScript tests, 443 vv-web Rust tests,
27 native Inspector/timeline oracle tests, vv-web all-target Clippy with warnings
denied, and the embedded native build. These are implementation checks, not full
F1 acceptance or a production-service upgrade. The existing delivered editor
and protected unsaved main remain unchanged.

`evidence/f1-selected-inspector.json` records the existing Windows browser on
the isolated port-8812 instance: a 1280x720/24fps project with two linked A/V
pairs, static and animated Position deltas, per-clip source keys at47 and0,
independent peer Flip axes, selected audio gain and full-track key navigation.
Native timeline/detail state and saved project/source bytes match after the
bounded candidate restart. The source video is320x180; this does not qualify
large-source decode or full-resolution throughput. The actual Canvas new-track
gesture produced no command. Inspection identified an unrelated Inspector
scroll canceling the drag; its correction and integrated recheck are pending.

Subsequent native-view and native-UI blocks implement key-editor navigation,
root-timeline view memory, painted pane scrollbars and pointer inertia. Their
actual Windows workflows are recorded separately. Applicable physical
pointer/DPI/500-clip acceptance and the remaining Inspector gestures remain
explicit; implementation checks alone do not close the ledger.

## F2 implementation â€” combined validation pending

Source now has an explicit native all-stream audio mode shared by proxy,
scrub and fast transport; Review retains selected-stream audition. Derivatives
accept audio ordinals and thumbnail-only requests. Visible pool/timeline demand
is serialized with a bounded decoded cache and foreground-playback suspension.
Source and Program have conservative host/cgroup memory admission before queue
and execution. Program continuation replays native DSP from its original Play
origin, discarding the prefix rather than restarting insert state at each movie.

The Viewer adds native Fit/100%/anchored zoom/pan geometry and guarded Ctrl+F.
100% means received preview pixels; full-resolution source inspection is not
claimed. The F1 Inspector-scroll drag cancellation correction is in this block.
The bounded halo2 gate passes 957 unique JavaScript cases (one stale DTO
expectation corrected with its focused file rerun), 11 native browser-proxy
cases, four native DSP-origin cases and 453 vv-web tests, plus fmt, three-crate
all-target Clippy with warnings denied and the embedded native build. Three
initial memory-admission failures exposed reclaimable linker file cache being
counted as process working memory; the conservative clean-cache correction
and its regression pass within the unchanged 4 GiB cap. The implementation
still awaits integrated Windows-browser qualification; they are not installed in the delivered editor.
No capability row is newly accepted by this implementation alone.

`evidence/f2-media-workflow.json` adds the bounded R9700/Windows pass: actual
Inspector-scrolled new-track drag, one MoveClips Undo removing both lanes,
Redo/Save, HD two-stream Source playback to EOF and exact native selected-stream
PCM summation. Fit/100% explicitly report received 960x540 preview pixels.
Natural 8x playback crosses Program 0..7200 to7200..7203 with audio origin0 and
finishes at frame7202. This is a 64x64 transport fixture, not ordinary-resolution
throughput, gapless playback or physical output acceptance. A manual End-key
seek was excluded; equal constant-tone peak envelopes cannot establish distinct
waveform content. The saved project and source bytes remain intact; the finite
instance and work tab are stopped, while the delivered port8811 remains df50859.

The pass also exposed crowded Viewer-heading layout and focus-induced Canvas
scrolling on the first click. Corrections join the next coherent effects/key-ruler
block. Full-resolution composed export, distinct waveform envelopes, physical
zoom/fullscreen/DPI and broader acceptance remain open; no ledger row is closed.

## F3 selected effects and F1 key-ruler implementation

Title exposes native case, anchor/position and complete background controls.
Selected Title/Solid/Filter edits preserve peer differences and native own-clock
key behavior, with atomic group Undo and native reset/key navigation. Filter
parameters skip peers without the kind; the Title shadow shortcut touches text
peers only. Unknown write outcomes retire the old controls without replay.

Dedicated scalar/value editors now show native animation heads and an inclusive
source ruler. Key Jump uses existing native timeline frames; free ruler seeks
use one guarded read on release. Navigation works without edit permission.
Inspector detail accepts the bounded view playhead past content end while exact
preview stays strict. The browser does not reconstruct retiming or freeze clocks.

The block also prevents Canvas focus from scrolling its coordinates and arranges
the Viewer heading into two compact rows with scrollable tools.
Bounded halo2 validation passes 978 unique JavaScript cases, with two failed
new cases corrected and their 37-case focused files rerun, plus461 vv-web tests,
fmt, all-target Clippy with warnings denied and the embedded native build. One
correction latches typed unknown write outcomes; the other supplies the legacy
typed-editor pixel ratio in the new DOM harness. Unchanged media/DSP gates from
F2 are reused. These checks do not establish integrated montage acceptance. Integrated
ordinary-resolution effects montage, persistence, export and visual qualification
are pending. Root timeline view memory and pane scrollbars/inertia remain open.

## Accepted usable workflow baseline

Blocks A (editing/save), B (playback/export) and C (accessible handover) are
accepted in `evidence/delivery-workflow.json`. The actual existing Windows
browser imports a source and assembles three linked A/V segments, trims, splits,
moves by Cut/Paste, closes gaps and uses Undo/Redo. Saved native timeline/media
state and project bytes match after explicit reopen and candidate restart.
Composed playback completes before and after a further edit; a native GUI
export contains all 72 H.264 frames and stereo AAC with the expected source cuts.
The downloaded file hash matches halo2; the exported file also plays to its end
inside the new Export result player without overlapping Program/Source audio.

Code commit df50859 is deployed on `venturi-web-delivery.service` at Windows
http://127.0.0.1:8811/. See `DELIVERY_HANDOVER.md` for project/output locations.
One cached halo2 frontend gate passes 881 JavaScript checks, including four
result-player cases, and the embedded native build; Rust remains unchanged from
its earlier verified baseline. No repeated native renderer matrix was needed.
The normal candidate service has one CPU, 4 GiB RAM, no swap and low priority;
final idle memory is recorded in the proof and its GPU context is released.
The protected main editor remains on 84ef827 with its five unsaved moves intact.

Qualification uses a small 64Ã—64 three-second A/V edit. Physical Canvas/DPI,
physical output latency, complex high-resolution throughput and browser playback
across five-minute windows remain explicitly unqualified. Broader native GUI
parity is the new active objective; these gaps are tracked in COMPLETION_PLAN.md
and the ledger counts below are unchanged.

## Full parity ledger

The ledger contains 90 in-scope capabilities: 42 done, 48 partial and none not
started. Two additional rows are explicitly NOT-PLANNED and excluded. Thus
46.7% of capability rows have full acceptance; this is not an estimate of
implementation effort or the active workflow's completion. Many partial rows
already have native adapters and working browser controls. The former 65â€“70%
engineering estimate is withdrawn because it had no measured remaining-work
basis. No full-plan completion date is supported by the current evidence.

Historical increments below retain their original scope and limitations; their
test counts and earlier percentages are not current progress indicators.

Timeline selection now has a persistent Shift-click anchor shared by Canvas
and accessible clip buttons. Shift replaces the prior range and precedes Ctrl;
plain clicks replace selection, while dragging a selected member preserves its
group. Linked expansion excludes locked view targets without weakening native
edit preflight. Pending selections restore their previous clip/gap/transition
on cancellation, ignore late capture-release events and preserve a newer owner's
gap. Pointer drafts do not trigger Inspector reads.

`evidence/m4-shift-selection.json` records 877 passing JavaScript tests,
including 23 new regressions, nine existing native selection/drag/rectangle
oracles, syntax checks and a cached embedded build on bounded halo2. Fifteen
actual existing-Windows-browser selection checks pass, including repeated Shift,
Ctrl/Shift precedence, linked behavior, Reconnect, bulk/gap anchor reset and
locked exclusion. Native project/command epochs, generation zero, empty history,
saved model and source bytes remain unchanged. Temporary resources are closed;
the main editor retains its five unsaved moves.

Selection uses the current displayed web rows. The original desktop's reversed
video order, separate panes and raw stale-anchor/navigation lifecycle are not
claimed as equivalent. Physical Canvas pointer/DPI and 500-clip performance
also remain open. The multi-selection row therefore stays partial, with counts
unchanged at 42 done/48 partial. This qualification disables preview/export and
does not repeat the preceding GPU renderer proof.

Blend and Track Matte now pass the original Inspector's multi-selection
semantics and actual existing-Windows-browser controls in
`evidence/m4-batch-compositing.json`. Values come from the first unlocked video
in native track/start order; one validated `set_properties_batch` changes every
explicit selected unlocked video, without linked audio expansion. Other
properties keep their single-clip behavior. Full preflight refuses invalid,
missing, audio, duplicate or locked targets atomically. One Transform Undo
restores all targets; a matching batch preserves generation, Redo and cache data.

All 15 Blend modes, four Matte modes and Matte removal were selected through
the real Windows controls. Native history, Undo/Redo, Save As and explicit
reopen pass. The two-video Screen batch changes both inspector values with one
history entry. All 37 capture frames match native RGBA exactly on R9700 Vulkan;
two additional native renders independently verify the saved batch and Matte
removal. The new binary also repeats the 35-project, 43-frame, 38-control and
12-pixel-check render matrix. Two Windows screenshots accompany the proof.

Validation passes 434 web Rust, 291 core, five native compound PCM and 854
JavaScript tests, multimedia and targeted desktop checks, fmt and all-target
Clippy with denied warnings. Five new Rust tests include 500 targets, 4097
refusal, all modes, atomic validation and exact Undo/Redo/no-op state; fourteen
new JavaScript tests include native primary ordering, mixed selections and
stale/context/pending guards. The final frontend build pins verified Rust hashes.

Only halo2 compiles/renders, one CPU and at most 4 GiB without swap. The first
finite UI service reached its ten-minute limit after the batch Undo/Redo proof;
a second finite run completed only the final batch save/reopen. Original and
resumed capture provenance and saved hashes are retained. All own services,
the single Windows test tab and its tunnel are closed. The main editor's five
unsaved moves, binary and filesystem bindings are preserved. Blend/Matte rows
are now done; full-resolution throughput, DPI and release soak remain separate.
The verified candidate is staged; the protected main editor is not restarted.

The finite visual render matrix now passes
`evidence/m4-r9700-visual-parity.json`: 35 native generator-only projects and
43 actual 64x64 frames on AMD Radeon AI PRO R9700 (RADV GFX1201), Vulkan.
Every decoded HTTP preview matches the original native export renderer's RGBA
byte for byte. All repeated cached PNGs match and 38 effect/control comparisons
pass, alongside 12 independent solid/mask/matte/transition pixel checks.

Coverage includes all 15 native blend modes, all four matte modes, native
solids and default-font title, Rectangle/Ellipse/curved Bezier masks, animated
Rectangle placement, Subtract/Intersect and feather, plus Push/CrossDissolve/
solid SmoothCut before, during and after the crossing. Four original 64x64 PNG
samples accompany the evidence. The fixture generator extends the existing
native verification example with create-new files; its cached build, Clippy
with denied warnings and fmt check pass. Production runtime bytes are unchanged.

One sacrificial halo2 unit used one CPU, 4 GiB RAM, no swap, low priority and
a 180-second limit, with shared memory admission and the nonblocking GPU lock.
Native oracle processes finish before the HTTP renderer starts. All own
children are reaped, port 8811 is closed, fixture bytes are unchanged and the
main editor's five unsaved moves, binary and filesystem bindings are preserved.
This qualifies finite native/API GPU rendering. Browser controls, Canvas/DPI,
full-resolution throughput, foreign-font layout, moving-media optical flow and
release soak remain separate; parity counts remain 40 done/50 partial.

Master Normalize during multibus compound formation is now qualified against
the original desktop in `evidence/m4-compound-master-normalize.json`. Two
disjoint impulse clips on separate buses pass through native low-pass EQ and
SamplePeak normalization. Real native segmented level measurements show that
merging edit boundaries changes the measured level and resulting gain in both
planners. Their normalized PCM matches within 1e-6; bypassing Normalize retains
the original raw PCM, including chunked mixing, within 1e-6. The measured peak
ratio also matches the native gain cap. The contract now states this native
remeasurement explicitly rather than implying invariant normalized loudness.

All five focused native compound PCM tests, audio all-target Clippy with denied
warnings and fmt check pass on bounded halo2. This adds a native regression and
documentation without changing production behavior or imposing a new refusal.
The existing runtime binary is unchanged and the main editor retains its five
unsaved moves. Physical playback, processed split-bus context and broader
compound acceptance remain open; ledger counts remain 40 done/50 partial.

Native timeline selection now passes `evidence/m4-native-timeline-selection.json`
and its existing-Windows-browser screenshot. Ctrl+A with timeline focus selects
all unlocked clips; Alt+Y selects unlocked clips whose native end is strictly
after the playhead. Both actions replace selection without expanding linked
groups, seeking or editing the native session. The palette exposes the same
actions. Disabled, muted, frozen and generator clips retain native eligibility;
locked or already-ended linked peers remain excluded.

Fourteen new deterministic regressions cover exact boundaries, opaque/u64 IDs,
read-only selection, context changes, focus, IME, modal, pending edit and gesture
guards. All 840 JavaScript tests and the cached embedded build pass on bounded
halo2. Rust sources match the prior fully validated `4c79f64` baseline; native
suites were not rerun for this frontend-only change. Actual Windows Ctrl+A,
Alt+Y, media-focus routing, text selection, modal refusal, palette actions and
gap cleanup pass. Native generation stays zero, Undo remains empty and saved
project/source bytes remain intact. Temporary resources are closed and the main
editor retains its five unsaved moves. Native persistent shift-anchor behavior
and TS-014 Canvas performance/pointer/DPI acceptance remain open, so the
multi-selection row stays partial and ledger counts remain 40 done/50 partial.

Native global ripple deletion now passes `evidence/m4-native-gap-ripple.json`
and its existing-Windows-browser screenshot. The web exposes empty leading and
internal gaps from a shared native core resolver, including accessible gap
buttons and local Canvas selection/highlight. Close selected gap uses the
original native ripple/overlap-repair/marker commands as one Undo step. Clip
ripple deletion now preserves unrelated locked material instead of rejecting
every locked lane. Native preflight refuses invalid results, partial linked
groups and newly broken crossings before changing the real session.

The palette and native IntlBackslash action share clip/gap routing, with
text/modal/IME/repeat/gesture/context guards. Successful current-context edits
reveal the playhead only when the new native snapshot has a clip at the closed
gap's start. Twenty-six new deterministic interaction regressions cover these
states. Actual Windows checks verify local selection, Escape, the CloseGap
button, Ctrl+K/Commands palette for both gaps and linked clips, native playhead
landing, Undo/Redo, marker positions and an unchanged locked lane. The existing
browser input bridge cannot emit IntlBackslash; physical emission remains
unqualified, is recorded explicitly, and was not replaced with synthetic events
or another browser installation.

Final halo2 validation passes 291 core, 429 web Rust, four focused native PCM
and 826 JavaScript tests, targeted multimedia/five desktop checks, fmt, Clippy
with warnings denied and native build. Finite API checks pass exact frames and
stable IDs, one Undo/Redo/retry, stale/invalid/locked refusal, selected linked
clip deletion with unrelated locks and save/restart. The 192044-byte WAV remains
unchanged. Temporary tabs, backend and tunnel are closed, and the original five
unsaved main-editor edits remain intact. No local build, browser installation,
render, export or hardware GPU qualification was used. The ripple-delete
editing row is accepted; broader physical shortcut qualification stays open.

Linear multibus compounds now pass `evidence/m4-linear-audio-compounds.json`
and its existing-Windows-browser screenshot. The opt-in native plan preserves
partial source buses with gain, pan, Mono, bypassed inserts and mute/solo. A new
neutral audio track hosts the wrapper; original bus settings, unselected clips
and the parent master remain intact. Selected solo flags, including muted solo
buses, carry into the wrapper and child without introducing a persistent mute
from an outside solo. The legacy desktop compound helpers remain unchanged.

Native preflight refuses enabled EQ/compressor/Normalize bus inserts, unaligned
sample origins and rounded audio extents that would lose a final sample. The
wrapper also respects the 128-track limit. Four in-memory PCM tests compare
partial overlapping buses, solo/mute combinations, whole/chunked mixing,
Undo/Redo and fractional-FPS source phase. Unfiltered and phase comparisons use
an absolute 1e-6 bound; the separately isolated recursive master-EQ comparison
uses 2e-6 for f32 regrouping. An audible one-sample truncation fixture is refused.

The browser check also exposed and fixed accessible clip controls replacing
the selection despite Ctrl/Shift. They now support Ctrl, Shift and Meta group
selection/toggling, preserve linked groups and publish `aria-pressed`. Actual
Windows input verifies those modifiers without a native edit, then creates one
MakeCompoundClip history step, retains an intervening unselected clip, performs
exact Undo/Redo and opens the child with the original gain/pan/Mono/bypass
values. Native snapshots independently confirm every result.

Final cached halo2 validation passes 288 core, 422 web Rust, four focused native
PCM and 800 JavaScript tests, targeted multimedia/five desktop checks, fmt,
Clippy with warnings denied and native build. Finite API acceptance passes
retry, atomic nonlinear refusal, source preservation and save/restart with a
48044-byte stereo WAV. The final Windows check uses that same binary. Temporary
tabs, backend and tunnel are closed; the original five unsaved edits remain
intact. No browser installation, local build, GPU rendering or export was used.
General processed-bus/compositing and hardware acceptance remain open, so the
compound rows stay partial.

Long-source Slip edges now pass `evidence/m4-slip-source-windows.json` and its
Windows screenshot. The dual viewer uses one shared or two sequential bounded
Source windows instead of requesting a full movie proxy. Both windows match
the public manifest's pinned file version, full source FPS and frame count.
Local seeks subtract each window origin; frame choices remain entirely native.
An audio selection now previews its linked video, with the selected video
taking priority, matching the original timeline UI. Native tests cover peers
with different source clocks and selected-video priority.

Pointer drafts and numeric input remain local. Committing a numeric change
outside cached coverage recenters the windows. Incomplete numeric text stays
editable and cannot be overwritten by late media events or applied as the
previous valid delta. Selection/close/stale/error paths detach both videos and
release owned Blob URLs without canceling shared jobs. A flexible Slip layout
keeps full images and controls visible in the short existing Windows viewport.

Cached halo2 validation passes 419 web Rust, 281 core and 800 JavaScript tests,
targeted multimedia/five desktop checks, fmt, Clippy with warnings denied and
native build. After the CSS-only layout correction, unchanged Rust hashes were
verified and fmt/JavaScript/embedded build passed again. API and Windows checks
passed on the final binary using the existing real 601-second, silent 16x16,
200058-byte source. Native API checks use two 12-frame windows; the browser
actually prepares separate 60-second windows, verifies absolute/local frame
clocks, recenters through real keyboard input and completes one SlipClips
Undo/Redo. Saved source/project bytes and the main editor's five unsaved edits
remain intact. Temporary tabs, services and tunnels are closed. No local build,
browser installation or hardware GPU work occurred. Continuous edge preview
after a pointer leaves downloaded windows, physical Canvas/DPI and broader
playback qualification remain open; the Slip row stays partial.

Custom EQ/compressor parameter presets now pass
`evidence/m5-custom-audio-presets.json`. Cards provide named Save, explicit
same-name Replace, Apply and Delete alongside the existing built-in presets.
Save captures the uncommitted parameter draft; library changes preserve the
draft and create no project edit, generation change or Undo entry. An
authoritative unchanged-session check retains the existing card and transport;
ordinary edits and changed sessions retain normal invalidation. Apply uses one
native SetAudioEffect and preserves bypass, chain order and other inserts.

The bounded global sidecar uses the original desktop Settings preset arrays;
a targeted test loads it through the original Settings reader. It does not
overwrite desktop preferences. Revision/file witnesses, a nonblocking lock,
atomic publication, strict native validation and durable command receipts
cover stale writes and retries. Finite API acceptance proves both effect kinds
on master and track, exact Undo/Redo, library sharing across projects and
Save/restart. The existing Windows browser proves Save/Replace with draft
retention, Apply/Undo/Redo/Delete, unchanged saved project bytes and no console
errors. Metadata-only checks do not qualify audible output or live meters.

Cached halo2 validation passes 416 web Rust, 281 core and 783 JavaScript tests,
targeted multimedia and five desktop compatibility tests, fmt, Clippy with
warnings denied and native build. After the transport-only JavaScript fix,
Rust source hashes were verified unchanged; fmt, all JavaScript tests and the
embedded native build passed again, followed by the final API/browser proof.
One bounded remote workload ran at a time, with no browser installation, local
build or hardware GPU use. Temporary browser/server/tunnel resources are
closed and the main editor's five unsaved edits remain intact. The audio rows
stay partial for continuous meters and hardware playback; counts remain
39 done and 51 partial.

Native bitmap clipboard import now passes evidence/m4-bitmap-clipboard.json.
The existing Windows browser proves an explicit system image read, actual Ctrl+V,
Cancel, editable collision/rename, Add, Source display and one native Undo/Redo.
The raw bounded upload preserves the original PNG/JPEG/WebP/GIF/BMP/TIFF bytes.
Only explicit Add publishes a no-overwrite file in Pasted Images beside a saved
project and applies native AddEntities(ImportMedia). Undo retains that file,
matching the original desktop. Save As uses the existing flow and requires a new
paste afterward. Exact managed-directory authorization also covers reopen,
Source, native clipboard/OTIO reuse and native asset capture; arbitrary nested
paths and symlinks remain refused.

BMP/TIFF Source now uses a PNG representation from the original native software
decoder and retains alpha. Conversion and all still-image Source/SourceAssets
thumbnails run in isolated children with address-space, CPU, output and
wall-clock limits; a failed conversion does not terminate the editor.
PNG/JPEG/WebP Source preserves original bytes and GIF keeps
native regular-media semantics. Finite API proof covers all six actual formats,
collision retry, cancellation, stale guards, exact command retry and Save/restart.
Cached halo2 validation passes 405 web Rust, 281 core and
762 JavaScript tests, targeted multimedia/desktop tests, fmt,
Clippy all-targets with warnings denied and native build. The main editor and
its five unsaved edits remain intact; no local build, installation, hardware GPU
work or main restart occurred. The media-import row remains partial for broader
large-image, codec, interaction and release qualification; counts stay 39 done
and 51 partial.

The Windows screenshot exposed a short-viewer layout defect: wrapped Source
controls consumed the entire picture area at 1280x720. A bounded scrollable
Source toolbar now leaves the image visible. Final fmt, 762 JavaScript tests and
native build pass after verifying unchanged Rust hashes against the full run;
the six-format API and complete Windows interaction proof pass again on that
final binary. Both temporary tabs, servers and tunnels are closed.

Explicit native clipboard overwrite now passes evidence/m4-clipboard-overwrite.json.
The Windows control starts unchecked and captures intent before asynchronous
clipboard reads. Native insert_overwriting handles split/trim/delete, missing
tracks, linked groups and one complete Undo/Redo. The core planner now sees
halves created by earlier ranges, preserving material between pasted intervals
and fixing a native desktop multi-range defect. Invalid retained crossings are
removed through native commands and restored by Undo. Locked or partial linked
overwrites refuse atomically. Old command retries preserve their identity.
Cached halo2 validation passes 379 web Rust, 281 core and
740 JavaScript tests, multimedia/targeted desktop checks, fmt,
Clippy all-targets with warnings denied and native build. Finite API and the
existing Windows browser prove default refusal, explicit replacement, preserved
gaps, retry, one Undo/Redo and saved-project preservation. No local compilation,
installation, rendering, hardware GPU use or main-session restart occurred.
The copy/paste row is accepted; the later bitmap evidence above covers its separate media-import entry path.

The preceding native text-clipboard increment passed evidence/m4-native-text-clipboard.json.
The browser exchanges the original venturi-clipboard/1 text with Rust;
selected clips, pool items and their native dependency fragment survive project
changes. Pool focus routes Copy/Paste to its selected media, without stealing a
stale timeline selection. Explicit system Copy/Paste, retained-copy Paste,
Ctrl+C/V/X and permission-failure retry use one guarded controller. Text inputs,
modal forms and media controls retain ordinary browser clipboard behavior.
Cut submits native linked non-ripple delete only after confirmed system writing
and unchanged context; denied or stale writes never remove clips.

The existing single worker parses and validates bounded text outside the session
actor. Authorized flat-root files remain in place; their native metadata/file
fingerprints and missing/unreadable entry witnesses are independently checked.
External claimed hashes cannot authorize native reuse. Original native path/
content reuse, nested naming and dangling offline IDs follow ClipboardPayload.
A full native trial precedes last source/cancel CAS and infallible application.
Imported dependencies and inserted clips form one Undo; current captured pool
reuse/no-op leaves history and allocators unchanged. Origin alone cannot select
the trusted local fast path: exact captured text and current Session are required.
Top-level crossing transitions remain in the trusted internal cache because the
native v1 text format has no crossing list; nested crossings remain native.

The web-only matching-FPS property-paste restriction is removed. Both native
Conversion::paste keyframe modes retain source-frame timing without preset FPS/
resolution conversion. Foreign copied ClipIds numerically equal to target IDs
are no longer mistaken for source clips that should be skipped.

Full cached halo2 validation passes 374 web Rust, 278 core, 730 JavaScript,
10 proxy, three decoder, one cached-device and four targeted desktop tests,
fmt, Clippy all-targets with warnings denied and native build. Finite API proof
uses real MP4/WAV files for nested linked 24-to-25-fps cross-project paste,
existing media reuse, source bounds, exact retries, one Undo/Redo, Cut, locked/
canceled/changed/path/version refusals, property paste and Save/restart. A failed
fixture restored modified bytes without original mtime and consequently changed
the native cache fingerprint before an unrelated no-op test; restoring the test
mtime fixes the independent test, without production changes.

One existing Windows browser tab verifies native system text, cross-project
paste, 25 timeline/24 source frames, nested naming, one Undo/Redo, Cut and pool
reuse without duplication. It exposed a real missing native copy/cut event
binding: Ctrl+C produced no actor copy, although Ctrl+A proved Ctrl delivery.
Handling native ClipboardEvents alongside keydown fixes the path and suppresses
double submission. Final fmt, 734 JavaScript tests and native build pass after
verifying unchanged Rust source hashes against the full run. A second sequential
tab on this final candidate confirms actual Ctrl+C on pool and timeline, Ctrl+V
pool reuse, Ctrl+X with exactly one DeleteClips, and Undo restoring both clips.
Its screenshot and authoritative snapshots are included; both tabs and all own
temporary jobs/tunnels are closed. Saved source/target project and media bytes
remain unchanged; the main editor retains all five unsaved MoveClips and Undo.
No browser/environment installation, local build/render/test or hardware GPU
work occurred. Metadata servers were capped at one CPU/512 MiB/no swap; recorded
cgroup events show no OOM. The verified binary is staged without activation.

That increment left explicit native overwrite open. The intentional UI choice
and linked/crossing/Undo qualification are now covered by the overwrite proof
above. The later bitmap evidence above covers its separate media-import entry path.

Native current-project OTIO import now passes
`evidence/m4-native-otio-merge.json` and its actual Windows screenshot. The
Projects panel prepares a native import without changing the current project,
shows native media progress and offline warnings, and requires explicit Import
all or Reuse by native file name. Native pool absorption adds top-level timelines
and a media folder with one ImportOtio Undo, preserving nested names and existing
dirty edits. Untitled projects are supported. The ACK opens the first imported
top timeline and selects the added media/folder. The legacy separate new-project
operation retains its request meaning, dirty guard and no-overwrite behavior.

The existing single preparation worker parses OTIO and measures titles outside
the session actor. Media probes run as bounded subprocesses (20 seconds,
512 MiB address space, 10 CPU seconds); root/source identity, including missing
and unreadable files, is checked again immediately before native application.
Cancellation, stale generation, changed files, indirect manifests, symlinks and
root escapes never partially merge. Input/output remain bounded to 8 MiB and
64 distinct media URLs within the shared 256-descriptor budget. The whole
600-second parser/title budget is cooperative, not a hard interrupt inside a
blocked native call.

Bounded halo2 validation passes 359 web Rust, 277 core, 698 JavaScript, 10 proxy,
three decoder, one cached-device and four targeted desktop tests, fmt, Clippy
all targets with warnings denied and native build. Three subagents reviewed
native scope, backend and client integration without running workloads. The
finite API proof covers real MP4/WAV nested import, both reuse policies, dirty
project preservation, exact receipts, cancellation, changed/missing input,
one Undo/Redo, Save/restart and the legacy no-overwrite path. Semantic checks
exclude only compound content_hash cache generations, which native Undo/Redo
and reload deliberately advance; source hashes and every clip/time field stay
checked. Raw failed fixture attempts remain in the evidence.

One temporary tab in the existing Windows browser verified prepare/cancel,
offline warning, current-project import, first top timeline/folder selection and
one Undo/Redo against authoritative API snapshots. No browser or environment
was installed. The 512 MiB metadata server had preview/export disabled and its
recorded cgroup events show no OOM. All own temporary processes, tab and tunnel
are closed; the main editor still has its five unsaved MoveClips and Undo.
The verified candidate is staged separately without activating it.

The two OTIO ledger rows now meet the original Scenario H requirement of
upstream semantics. Prior native title roundtrip and exact Windows download
proof establish the export path. Native compound export remains explicitly
unsupported; export child timelines directly. Installing another NLE or proving
cross-machine font layout was not in the original acceptance requirement.
This closes these two adapter rows, not the full offline/relink scenario or
rendered/GPU/physical audio/release qualification. The overall 65â€“70% engineering
estimate remains uncertain and unchanged.

Earlier native editing fidelity passes `evidence/m4-native-edit-fidelity.json`.
Clip paste between different timeline FPS uses the same native relative-start,
`Clip::retime` and target-media conformance sequence as the desktop. Linked
groups, internal crossing durations, source-frame animation, speed, freeze and
pitch retain native behavior; occupied or locked targets still refuse the whole
paste. The existing Windows browser copied a linked nested video/audio group
from 24 fps into 25 fps, verified 25 timeline frames against 24 source frames,
then performed exactly one Undo/Redo. Finite API checks also cover 24â†’30 fps,
animation, unchanged source bounds, idempotency, Save/restart and atomic refusal.

Compound guards now distinguish video and audio track multiplicity. Two video
tracks with one audio track retain the original host audio bus; pan, inserts,
solo and mute no longer cause an unrelated multibus refusal. Native-plan tests
cover accepted and refused variants. A finite API check with gain, pan, Mono
and solo verified identical native 80 ms PCM before/after and one Undo/Redo.
General multibus and compositing restrictions remain where the native planner
would lose processing or dependencies.

OTIO import/export now use the native CPU title measurement callback, including
auto-sized backgrounds and foreign corner-radius conversion. HTTP/native and
foreign-metadata regressions pass; a real finite title export/import passes and
the Windows Projects download matches its native SHA. No GPU, font installation
or external editor was used. Current-project merge and isolated preparation
were subsequently completed by the increment above. Nested export remains
unsupported by the original native exporter. OS text/cross-project clip clipboard was subsequently completed by the
increment above. Continuous audio/hardware qualification remains open.

That earlier increment passed 346 web Rust, 277 core, 677 JavaScript, 10 proxy, 3 decoder,
1 cached-device and four targeted desktop tests, fmt, Clippy and native build
in the cached halo2 environment: one CPU, 4 GiB build RAM, no swap and OOM score
1000. The finite API/Windows metadata server used 512 MiB with preview/export
disabled. Its recorded cgroup events had no OOM. The only temporary Windows
tab, server and tunnel were closed; main editor five unsaved MoveClips and Undo
remain intact. The verified binary is staged separately without activating it.

Native Program export marks, percentage output sizes, audio settings and
measured pipeline progress now pass `evidence/m3-native-export-options.json`.
Program I/O and opposite-bound resets follow native MarkRange; marks survive
Program/Source switches on the same timeline and reset on timeline changes.
Marks/Whole scope, four native scales, AAC codec/bitrate/coder selection,
unavailable FDK refusal and unchanged legacy request identities are covered.
Explicit scales use native dimensions and conservative host/cgroup memory
admission; a 4K request was refused before enqueue under the 1 GiB test limit.

The existing Windows browser exported frames 2â€“10 at 64Ã—36 with AAC 192 kbps
Fast, then downloaded bytes matching the native file SHA. Another single export
was running at frame 9 before refresh and frame 95 afterward with the same job
ID, then completed all 2400 frames at 640Ã—360. A distinct export was canceled
at frame 162. Source opposite-bound resets, same-timeline Program mark retention,
no browser errors and no project/history/source changes were verified. Only the
isolated test unit was temporarily slowed to 10% CPU to observe reconnect;
its one-CPU quota was restored. A final JavaScript-only correction preserves
the native 100% default after an empty timeline, while retaining an explicitly
selected Legacy width. Its unchanged Rust hashes, fmt, 677 JavaScript tests,
native build and metadata-only Windows check passed. This is finite functional
qualification, not a
performance, high-resolution, hardware GPU, physical audio or sustained-load test.

Validation passed 340 web Rust, 277 core, 677 JavaScript, 10 proxy, 3 decoder,
1 cached-device and four targeted desktop tests, fmt, Clippy and native build.
All computation used the cached halo2 environment with one CPU, 4 GiB build
RAM, no swap and OOM score 1000; the software API/browser unit was capped at
1 GiB. Its final recorded memory.events had no OOM events. The single Windows
tab, finite server and tunnel are closed. No browser or environment installation
occurred. Program In/Out and export cancellation/progress now meet their ledger
acceptance; broader high-resolution export and release qualification remain open.
The main editor and its five unsaved MoveClips/Undo were preserved. Its older
runtime remains active while the new candidate is staged separately.

Native batch media import now passes `evidence/m2-native-media-import.json`.
One Import selected files action prepares up to 256 unique root files outside
the session actor, reports per-file failures, applies all successes in one native
ImportMedia Undo step, selects them and opens the last in Source. Existing media
paths are reused. The root list now follows the complete native extension domain.
Legacy single-file requests retain their serialized shape and use the same
single worker and isolated native probe; duplicate concurrent requests preserve
the original success or error. Final source, generation, project and writer
checks prevent canceled or obsolete imports from applying.

The existing Windows browser imported a new WAV alongside an existing WAV and
one unreadable file, displayed the error, selected both successes, opened the
last and verified one Undo/Redo without removing the existing file. Finite API
checks also import real video and BMP metadata, verify cancellation and source
changes, and preserve saved projects and receipts after restart. Receipt entries
allow 1 MiB within the unchanged 8 MiB journal; cached large reports also retire
by bytes to bound memory. Validation is 333 web Rust, 277 core, 658 JavaScript,
four targeted original-desktop tests, fmt, Clippy and native build, on the cached
halo2 environment with one CPU/4 GiB/no swap/OOM score 1000. The sampled build
peak was 1.73 GiB with no cgroup OOM events. The finite API/browser backend used
512 MiB; it, its single Windows tab and tunnel are stopped. No browser download,
environment rebuild, driver or NAS change occurred. Broad codec/still Source,
interaction and release acceptance remain partial; ledger counts are unchanged.
The verified candidate is staged separately while the main editor retains its
five unsaved MoveClips and Undo.

The existing Windows browser now verifies a functional Source handoff on a real
601-second, 24 fps, 16Ã—16 input: seek to frame 12960, seek within the same
60-second job to frame 14352, play through the next job and stop at frame 14423.
The next descriptor is exactly 14400â€“14424; the first is 12960â€“14400, with the
same source version. There were no browser media/console errors, project writes
or history changes. This is a short boundary check using a 200,058-byte silent
fixture, not a long wall-clock, high-resolution, physical audio or gapless test.
The temporary tab, finite 512 MiB halo2 backend and tunnel were closed. Evidence:
`evidence/m3-source-windows-boundary.json` and its screenshot. No browser or
environment installation occurred; main editor state was preserved.

Native library folder organization now passes `evidence/m4-native-asset-folders.json`.
The existing Windows browser verified create/rename, a new child under the selected
folder, folder reparenting, a two-asset move and removal of a nonempty folder:
its direct assets and child move up without media deletion or timeline history.
The Root filter survives panel reopening; unknown native memberships retain their
raw metadata while appearing at root. Source-page filtering, stale revisions,
archive/backup preservation, restart and command retry passed finite API checks.
Bounded journal tests cover interrupted multi-file installation, foreign changes,
cleanup and durable command completion; the original desktop parser/reopen test
retains the native v1 format. Latest validation is 317 web Rust, 277 core, 636
JavaScript and four targeted desktop tests, fmt, Clippy and native build.
The API check found that worker failures hid cycle/missing/stale errors; original
422/404/409 errors now survive POST, lookup and retry. Preparation shares the
existing one-worker queue, with bounded metadata/staging and no new media copy.
All compilation and tests ran on halo2 with one CPU, 4 GiB RAM, no swap and OOM
score 1000. The sampled build peak was about 2.2 GiB with no cgroup OOM events.
The finite API/browser server used 512 MiB with preview/export disabled; it, its
single temporary Windows tab and its SSH tunnel were closed. No environment,
browser, driver or NAS installation occurred. The main editor retained its five
unsaved MoveClips and Undo. Physical placement/drag, broader offline/library
lifecycle and release work remain open; overall ledger counts and estimate stay
unchanged.

Native pool asset capture and cross-project import are implemented and qualified
in `evidence/m4-native-assets.json`. File-dependent compounds retain their native
clipboard payload and nested timelines; project-owned copies survive removal of
the original and library source. Rename, recoverable archive, restore, previous
settings, revision checks, cancellation and one-Undo import pass finite API/restart
and the existing Windows browser. The actual API-exported v1 asset also opens
through the original desktop `Library::open`, merges natively and supports Undo.
Desktop 16-digit fingerprint directories are imported without pretending their
original path fingerprint is a byte SHA-256. Production native probes run in
separate processes with one CPU, 512 MiB address space, 10 CPU seconds, a 20-second
wall deadline and bounded output; canceled or obsolete jobs cannot publish later.
The Archive/Restore browser check found a stale-selection bug, which was fixed
and qualified again with a panel regression. The passed validation is 291 web
Rust, 277 core, 620 JavaScript and three targeted original-desktop tests, plus
fmt, clippy and build. The last JavaScript-only fix retained the matching Rust
source hashes and reran JavaScript/fmt/build. No full native runtime or GPU test
fleet was run. The folder follow-up is qualified above; physical asset placement/drag,
broader library lifecycle and release qualification remain open; the ledger counts and
engineering estimate above are unchanged. No NAS mount or browser installation
was added. The main editor's five unsaved MoveClips and Undo stack were preserved.

Saved native preset storage, its browser panel, full native shortcut assignment
and explicit session shortcut activation now pass 258 web Rust tests and 594
JavaScript tests, fmt, clippy and native build on halo2, plus finite API/restart
and existing Windows-browser checks. The actual exported v1 preset also passes
the original desktop parser and Library::open, and all 936 key/modifier
combinations roundtrip through native Shortcut. Preset drag uses the same native
application command, with source, geometry and lifecycle tests. Physical pointer
drag/release remains unqualified in the available DOM-only Windows browser.
Broader preset lifecycle and sharing qualification remain open. A configurable preset
folder does not establish sharing through the 14 TB archive; only the existing
ds4 media-catalog integration has actual NAS evidence.

Animated viewer transforms, mask/path handles, persistent export history and
explicit terminal-export discard, transition duration handles and exact speed
handles, completed-path pen drawing, full path-key navigation and transition
selection/placement preview cache retention and Program window continuation now pass
258 web Rust tests, 277 native core tests and 594 JavaScript tests,
fmt, clippy and build, plus finite API/restart qualification. GUI, DPI and hardware
qualification remain open. Latest evidence:
`evidence/m4-viewer-mask-handles.json`,
`evidence/m4-transition-duration-handles.json`, `evidence/m4-speed-handles.json`,
`evidence/m4-mask-pen-path-keys.json`, `evidence/m4-transition-placement.json`
`evidence/m3-preview-cache-safety.json`, `evidence/m3-program-rollover.json`
`evidence/m3-source-windows.json`, `evidence/m3-source-assets.json`
`evidence/m4-speed-presets.json`, `evidence/m4-retime-selected-visibility.json`
`evidence/m6-take-audio-streams.json`, `evidence/m6-review-longest-clock.json`,
`evidence/m6-review-source-windows.json`, `evidence/m6-review-audition-streams.json`
`evidence/m6-frozen-take-policies.json` and `evidence/m4-preset-shortcut-settings.json`;
prior transform/export proofs remain valid
for their recorded scope.

Native hardware codec selection is accepted on the R9700 through actual
Windows-browser selection, explicit native checks and a three-frame Vulkan
encode/decode export. CPU-only disablement, legacy defaults, restart identity,
GPU contention and resident-context handover are also verified. See
`evidence/m3-native-codec-selectors.json`. These two selector rows are done;
this does not qualify every source format, GPU vendor or sustained workload.

Remaining work includes mask/transition browser and rendered qualification,
compound and
import coverage, long-media preview qualification, full-source asset GUI acceptance
and remaining export lifecycle qualification,
continuous audio behavior and physical recording, remaining AI Review cases,
and final deployment, DPI, duration and resource qualification. Historical
sections below describe individual increments and their then-current limits;
later evidence supersedes those limits only where explicitly recorded.

The owner reported renewed workstation blocking and identified SSD saturation
as the observed symptom. The disposable browser tab, isolated halo2 preview and
its local tunnel were stopped; the build unit was already inactive. Dirty
sessions and foreign inference were preserved. Development may continue with
small local edits and remote orchestration. Compilation, rendering and soak
stay on bounded halo2 services; small browser checks use the existing Windows
environment, one temporary tab at a time. The specific source of workstation I/O has not been
measured. Code inspection confirms unchanged autosave generations skip snapshot
publication; this does not identify or rule out other sources of SSD pressure.

## G0

Complete source and screenshot audit against b3b03bf. Installer copied 37
files without conflicts; original root agent rules preserved. See G0_REPORT
and SCREENSHOT_AUDIT for evidence and limitations. Functional parity ledger
updated with source paths. Runtime baseline pending dependency installation;
The initial WSL GPU limitation is resolved for exact-frame acceptance by the
halo2 measurements recorded under M3a below.

Subsequent milestones and exact verification results are recorded below.

## M1a â€” web shell

Implemented native HTML/CSS/ES modules, four workspace layouts, browser tabs,
honest disabled advanced tool homes, command palette, Projects dialog,
export integration notice, fullscreen, resizable keyboard-accessible panels,
local layout preferences and labeled Shot/Take fixtures. Node shortcut test
passes. Browser checked at 1920x1080 and 1280x800; four workspace screenshots
and compact layout saved under evidence/m1-*.jpg. Keyboard splitter increased
260 to 276; text input accepted Space without editor transport action;
command palette focus was verified. No engine capability claimed by shell.

## M1b â€” Canvas timeline

Implemented rational frame coordinates, visible-range culling, DPR scaling,
rAF invalidation, pointer capture, snap, local move/trim ghosts, overlap/lock
feedback, linked selection, marquee, pan, pointer-anchored zoom, fit, frame
stepping and an accessible DOM clip list. The 500-clip fixture was loaded and
rendered in the Windows in-app browser at 1280x800 (evidence/m1b-timeline-1280.jpg).
Six Node tests pass, including 24000/1001 and 30000/1001 coordinate roundtrips,
collision/lock cases, linked IDs, exactly one commit on release, zero commands
on pointermove and cancellation on Escape/capture loss. Fixture mutations
are refused explicitly; no browser editing engine/persistence is introduced.
60 fps and Windows 125/150% scaling benchmarks remain unverified.

## M2a â€” native HTTP host

Implemented vv-web with Axum/Tokio, embedded first-party assets, normalized
errors, loopback-only CLI, Host/Origin checks, request limits, CSP/nosniff,
bounded session actor and native snapshots. Core native project/command
services and their focused tests were included together so their ownership
and serialization boundary are concrete; browser integration is recorded in
M2b/M2c. The eight original default workspace members are preserved.

Verified: cargo check -p vv-session and -p vv-web passed. Native baseline:
250 vv-core tests passed; 98 vv-session tests passed, 1 upstream test ignored;
9 vv-web tests passed. Graphics-related baseline tests used WSL llvmpipe,
not AMD hardware. The new tests cover HTTP boundaries, native import, atomic
save/backup/symlink refusal, collision refusal, linked/locked edits, history,
idempotency, epoch/generation conflicts and writer ownership. Browser health
and project creation/import were exercised against the real host.

Environment: Rust 1.99.1, FFmpeg 8.0.1 with libavdevice/libavfilter headers,
ALSA and clang. WSL was terminated once by its init lifecycle during the
first check attempt; persistent cache logs and foreground PTY execution were
used on the successful retry. Clippy found one manual-range style issue,
which was corrected; the final rerun is recorded below.

## M2b â€” project/session workflow

The browser is connected to authoritative native session snapshots. Verified
in the real host: create, save, process restart, reopen the saved RON, import
synthetic H.264/AAC media, insert linked video/audio and retain native IDs.
The project chooser uses server-issued root filenames; no arbitrary filesystem
browser. Saved .vvproj.bak is available for previous-save recovery. Save As,
nested roots, uploads, automatic crash recovery and asynchronous import probing
remain unimplemented (see RUNNING.md). A browser reload may wait for the prior
writer lease to expire; Reconnect reacquires it safely.

The M2b browser integration commit also carries the bounded exact-frame service
for the next milestone, with capability disabled unless an explicit AMD Vulkan
device initializes. Target GPU acceptance is recorded separately after testing;
code existence does not imply GPU validation.

## M2c â€” safe command bridge

Implemented native safe move, linked move/trim, split, lift/global ripple delete,
undo/redo, safe media/generator insertion and track add/mute/solo/lock. Numeric
trim uses explicit Apply controls; Alt+Left/Right moves the linked selection by
one frame (Shift adds ten). Each gesture sends one revisioned command, with
native history grouping. Local ghosts never write to the server. Overlap,
locked tracks, incomplete linked moves and stale revisions are refused before
mutation. Markers, clip disable, fades and general property editing remain
unimplemented; their parity rows stay open.

Verified native roundtrips for paired move, paired trim and global ripple,
including exactly one undo and unchanged revision/history on refusal. Browser
verified import/linked insertion, numeric trim 48 to 36 frames and undo, save,
and occupied-generator refusal without changing the two existing clips.
Evidence: m2-native-project-1920.jpg and m2-overlap-rejected.jpg. Pointer drag
commit and 60fps under load still need real-browser performance validation;
the gesture state machine is covered by Node tests, not a timing claim.

## M3a â€” actual headless composed frames

Validated on halo2 Ubuntu 26.04.1, AMD Radeon AI PRO R9700 (RADV GFX1201),
vendor/device 1002:7551, PCI 67:00.0, Vulkan, Mesa 26.0.8-1ubuntu0.3. Strix Halo
1002:1586 at 68:00.0 is enumerated separately and was not selected. No desktop
environment is required. Only the user-authorized Vulkan userspace and
multimedia dependencies were installed: zero existing packages upgraded,
no kernel AMD driver, ROCm or inference configuration changes.

The native composed fixture includes H.264 video plus a 60%-opacity scaled
solid on a second track with keyframed position. HTTP PNG frames 0, 12 and 36,
decoded to RGBA, exactly match independent native render_frame_rgba output:
2,073,600 bytes each. Screenshot m3-r9700-composed-preview.jpg shows CURRENT
in the Windows browser through the SSH tunnel. Native render identity and
hashes are recorded in evidence/m3-r9700-validation.json.

500 sequential seeks over 59.97 seconds: 500 successful, zero errors,
loopback HTTP p50 96.43 ms / p95 113.64 ms at 960x540, 24fps timeline. These
are server fetch latencies, not browser presentation latency or playback fps.
The input source is 320x180, composed in a 1920x1080 timeline; this is not a
1080p-source throughput benchmark. A post-run snapshot measured server RSS
50,728 KiB and total R9700 VRAM use 272,642,048 bytes, GPU busy 0%; neither is
a peak or a Venturi-only VRAM measurement. No two-hour soak or A/V sync proof.

Every uncached render and GPU initialization takes the laboratory's shared
/tmp/HALO_BENCHMARK.lock nonblocking. A foreign inference owner was observed:
Venturi returned GPU_BUSY, then validation proceeded after release. Foreign
processes, ports and model services were preserved. No concurrent inference
performance claim is made. RADV warns that this device is not a conformant
Vulkan implementation and is for testing; this is development validation.

Frame service bounds: one running and one replaceable pending job, eight
cached images / 16 MiB, maximum 4,194,304 output pixels. Browser aborts old
requests, rejects obsolete epoch/generation/revision/frame/width and labels
retained images stale. Out-of-order fetches and GPU_BUSY are covered by Node
tests; pending-job replacement and resolution caps by Rust tests.

Final local checks: 13 vv-web tests, 10 JavaScript tests, cargo fmt --all
-- --check, clippy -p vv-web --all-targets -- -D warnings, and build passed.
The unchanged desktop vv-app check passed; baseline native suites remain
250 vv-core and 98 vv-session passed, one upstream session test ignored.
M1 timing/DPI acceptance and M3bâ€“M7 remain open. See PREVIEW_SPIKE.md for
the smallest next media increment and measured constraints.

Deployment/browser follow-up: the final embedded UI binary was deployed during
an idle lock slot, replacing only the verified Venturi PID on 127.0.0.1:8790.
Windows browser confirmed Alt+Right start 0 to 1, undo back to 0, split at 12,
redo, lift delete and two undos restoring original revision e3c0f15b. The restored
fixture was saved. Screenshot records CURRENT at frame 12. An external Rust
test also verifies immediate GPU_BUSY under occupied lock and that the shared
lock file is preserved.

## M3b â€” source playback, thumbnails and waveforms

Implemented on-demand native all-intra H.264/AAC MP4 source preparation,
including the first audio stream and audio-only media. The new vv-media
browser_proxy adapter reuses native proxy, audio decode and AAC writing, then
muxes through FFmpeg library bindings. Production does not spawn ffmpeg CLI.
The existing desktop proxy path and decoder defaults are preserved. Web video
decode/encode and thumbnails use two CPU threads, no GPU or Linux audio sink.

A single background worker plus one queued source job owns private staged
outputs. Repeated requests deduplicate by project epoch, media ID, source file
identity and quality/version. Completed assets require the current epoch and
the same source identity on every request. Source handles use root-relative
NOFOLLOW opens. Changed/offline media and cross-project IDs cannot retrieve
cached material. Cache is bounded to 2 GiB and approximately 24 completed jobs;
one staging job adds up to 512 MiB. Entries can be evicted and regenerated.
Cache is process-local, stored in an owned private temporary directory and
removed on orderly worker shutdown. Crash-orphan cleanup remains M7 work.

Current bounds: regular sources up to ten minutes, dimensions at most 8192,
ten-minute job wall budget, 512 MiB job output and 256 MiB of decoded f32 audio
samples (native AAC staging/copies add temporary memory). This bounded version
does not claim unrestricted long-file support. Still-image Source, audio
stream selection and persistent disk cache recovery remain open.

Browser: media double-click or Source opens preparation; native video controls
play/seek with sound in the Windows browser. Source quality Low/Medium/High,
cancel, frame stepping and stale-open cancellation are implemented. Source
transport is independent from the Program playhead. On-demand thumbnail and
native waveform peaks appear in the media panel and Canvas, with a bounded
32 MiB / 16-entry browser asset cache. No timeline edit RPC runs on pointermove.

halo2 synthetic H.264/AAC, 48 frames 320x180 24fps: High preparation 102.59 ms,
224,874-byte MP4, H.264 High YUV420P + AAC LC 48kHz mono. Video duration 2.000 s,
audio 2.005 s; complete decode passed. HTTP prefix/suffix requests returned
correct bytes and 206; invalid range 416; stale project epoch 409. Thumbnail
PNG and 200 waveform peaks were verified. Windows Chromium reported playing,
readyState 4, 320x180, 2.005-second duration, muted=false and advancing time.
This is a short feasibility fixture, not long-form A/V drift proof or a
physical-speaker measurement. Evidence: m3b-halo2-source-validation.json and
m3b-source-audio-browser.jpg.

Checks: 17 vv-web tests and 11 JavaScript tests passed; vv-media suite passed
107 tests with two existing ignored tests when run serially. A parallel run
hit the upstream encoder color-check temporary-name race; serial execution
avoids that existing shared-file collision. New coverage includes actual A/V and
audio-only proxy decode, cancellation, job deduplication, epoch/media/file
identity isolation, Range/If-Range and obsolete browser preparations. Clippy,
formatting, native desktop check and vv-web build passed. Program playback,
export and advanced feature parity remain subsequent work, not completed by
source playback.

## M3c implementation checkpoint â€” GPU acceptance pending

Program preparation now reuses the native bounded decode/compose/encode and
offline audio-mix pipeline, with an explicit compositor factory and per-stage
GPU permits. The original desktop export entry point retains its defaults.
Web permits wait for submitted GPU work before unlocking, including unwinding;
local GPU workers serialize before trying the shared laboratory lock. Web CPU
decode and x264 encode use two threads. Preview ranges are currently capped
at five minutes, ten-minute preparation time and 512 MiB output.

The media worker now serves source and Program jobs with one running and one
pending item, progress, cancellation and Range delivery. Program identity
includes epoch, generation, native revision, range, requested quality and used
source-file identities. Status/download revalidate the document and media.
Cancellation remains possible after the document revision changes. Only fully
finalized MP4 files become ready. Browser playback rejects superseded seeks,
uses media presentation time for the playhead and polls document validity.

CPU/local checks: 19 vv-web tests, 13 JavaScript tests and native session suite
99 passed / 1 upstream ignored. A focused native test verifies eight permit
entries/releases for four decoded/composed frames and decodable native output.
WSL graphics tests use software rendering; they are not R9700 evidence.
Clippy for vv-web/vv-media/vv-session and formatting passed. Target GPU playback,
color comparison, long-form A/V timing and actual encoder-stage measurements
remain unverified; M3c is not accepted yet.

Resource handoff: D41 requested priority for EP2 inference. Venturi stopped its
GPU process and restarted only its own web service without --gpu-device.
Verified no /dev/dri or /dev/kfd handles and approximately 51 MiB server RSS.
No foreign workload was stopped. Hardware testing stays suspended until D41
confirms release; CPU development continues locally. D41 confirmed its workers
exited at 12:36:37 UTC; a subsequent check found H3 holding the shared lock.
Re-enable only Venturi's GPU option during a verified free slot. Exact preview
now drops its compositor after two idle seconds; Program owns its compositor
only during preparation. Diagnostics report context residency separately from
hardware capability. Actual device-handle release still needs hardware proof.

## M3b additional Source coverage â€” PNG/JPEG stills

Source now serves a private bounded copy of an imported PNG/JPEG original,
without transcoding its color profile or alpha. Signature validation, native
image probing and source identity checks precede publication; copying observes
cancellation and the 512 MiB budget. Other still formats remain unavailable in
Source. Native thumbnails remain preview conversions, not color references.
Play/step/quality controls are disabled for stills. Browser proof: imported
320x180 RGBA PNG displayed at natural size with an inactive transport, saved
project, screenshot evidence/m3b-still-source-browser.png. Original PNG bytes
including alpha compare exactly in the native job test. All 20 web Rust tests,
14 JavaScript tests, formatting and clippy passed.

## M4 independent increment â€” native properties and scalar keyframes

While shared GPU acceptance is unavailable, CPU-only Edit work adds a guarded
clip-detail read and atomic native property commands. Inspector covers all 13
transform/crop/opacity parameters, flip, all 15 native blend modes, four matte
modes plus none, solid/title RGBA, audio gain and clip fades. Each patch validates
all fields and track locks before a single native composite command; undo
restores the whole patch. Native static/default and evaluated values remain
distinct. Scalar transform/gain keyframes use native source-frame conversion,
upsert/remove and interpolation. The UI exposes five interpolation presets;
validated Bezier control points are supported by the API, not a curve editor.
No JavaScript evaluation of effects or interpolation was added.

Windows browser verification: PositionX 0â†’48â†’undo 0; opacity source keyframes
0=75 Linear and 1=50 EaseInOut persisted with Save. Screenshot:
evidence/m4-native-inspector-browser.png. All 22 Rust web tests, 16 JavaScript
tests, formatting, clippy and web build passed. Focused native tests cover
all-or-nothing validation, one-step undo/redo, lock refusal, source-frame mapping,
invalid ranges and keyframe removal/interpolation undo. GPU rendering of these
new edits is pending the shared hardware slot. M4 as a whole remains open:
transitions, masks, curves, slip, markers, speed, presets and compounds are not
claimed complete by this increment.

## M4 independent increment â€” Source range, linked slip and markers

Source In/Out uses exclusive integer source-frame bounds, local I/O buttons
and numeric fields; insertion still uses native FPS conforming and safe
overlap validation. Selected clips expose native link/unlink, enable/disable
and numeric linked slip. Slip validates the source handles and lock of every
linked member before one atomic history entry. The dedicated dual-frame Slip
viewer and pointer slip tool remain unimplemented.

Marker add/edit/remove uses native timeline IDs and commands, bounded note/range
validation and undo. Markers have native palette colors, ruler ranges and
existing timeline snapping. Inspector provides marker editing and jump; drag
of a marker is not implemented. Literal note text uses safe DOM/Canvas APIs.

Browser proof: Source 6â€“18 inserted a linked 12-frame video/audio pair. Slip +1
changed both source ranges to 7â€“19 with unchanged start 0 and length 12. Saved
and reloaded the project successfully; the writer ID now persists in tab
session storage, fixing the reload lease wait found during validation. Marker
12â€“18 with note Cut cue applied and saved. Screenshots:
evidence/m4-source-range-linked-slip-browser.png and
evidence/m4-native-markers-browser.png. Native tests cover source bounds,
linked slip/refusal/lock/undo, group disable/unlink/undo and marker CRUD/undo.
All 23 Rust web tests, 18 JavaScript tests, clippy and build passed.

M3c fixtures are ready on halo2: GPU_composed_AV.vvproj (native linked A/V plus
animated composited solid) and GPU_sync_5m.vvproj (7200 frames at 24fps, five
white flashes and 100ms beeps at 0/60/120/180/240 seconds). They are test inputs,
not successful hardware results. Shared lock remained busy; no GPU job ran.

## M3c local five-minute validation and native encoder correction

An actual 7200-frame native export on WSL llvmpipe found that missing video
packet durations made the MP4 edit list discard the final reordered frame:
7199 decoded, duration 299.958 seconds. The shared native encoder now sets the
one-frame duration only when a video packet omitted it, before time-base
rescaling. The existing encoder test now requires the exact frame count rather
than accepting loss of one frame. Audio packet behavior is unchanged.

The repeated native export decoded all 7200 frames, H.264 640x360 at 24fps and
48kHz stereo AAC. Video duration 300.000s; AAC padded duration 300.010s.
All five flash/beep onsets differ by one audio sample (0.0005 video frame),
with no accumulating drift through 240s. Preparation took 58.54s for this
deliberately simple synthetic composition; this is CPU/llvmpipe evidence,
not R9700 throughput or physical speaker/browser sync proof. Detailed evidence:
evidence/m3c-cpu-five-minute-sync.json. Reproduction uses the verify_preview
fixture_sync/export modes and scripts/venturi-web-validate-sync.py. Full M3c
GPU/browser acceptance still awaits a shared hardware slot; D41 announced a
further priority 60â€“90 minute quality test after the current H3 video.

## M4 independent increment â€” title generators and native transitions

Effects now inserts native title and adjustment clips with safe destination
checks. Inspector title editing covers default text, server font family,
weight/italic/underline/strike, size, tracking, line spacing, alignment, RGBA
and background enable. The typed API also validates native anchor/position,
case and full background settings. Existing animated text is preserved when
changing its default. Server font fallback remains native; no browser font
renderer was added. Remaining title/background controls are still partial.

Native clip in/out and adjacent-cut transitions support Push, Cross Dissolve
and Smooth Cut, duration, direction, easing and curve, including removal and
undo. Native edge/crossing duration limits, adjacency and track locks are
validated. Canvas displays transition/crossing ranges from native snapshot
coordinates. Smooth Cut retains upstream fallback to dissolve on single edges
or when the native renderer cannot morph. No optical-flow hardware acceptance
is claimed. Transition drag handles remain open.

Windows browser: created a title, saved text Venturi native title, size 84,
weight 700 and a 12-frame incoming Cross Dissolve. Re-read controls match saved
state. Evidence m4-title-typography-browser.png and
m4-transition-controls-browser.png. All 26 web Rust tests, 18 JavaScript tests,
clippy and build pass. New tests cover safe generator overlap/undo, title
animation preservation, invalid numeric rejection and transition adjacency,
duration, native crossing identity, remove and undo. Full native checks after
the video-duration correction: media 107 pass / 2 ignored, session 99 pass /
1 ignored, desktop check pass. GPU/UI rendered title/transition proof awaits
the shared GPU slot; these rows remain partial.

## M4 independent increment â€” native history navigation

History displays actual native command positions and jumps with History::go_to.
Undo/redo/jump also use the project command endpoint with epoch/generation and
idempotency checks, so recovery is possible when no active timeline remains.
The actor serializes the full native jump; browser frames/preparations invalidate
as on other mutations. A native regression covers jumping through timeline
creation/removal, invalid positions and exact restoration. Host coverage checks
project-level jump retries and redo without a timeline precondition.
Browser: InsertClips + AddTrack â†’ initial state (no clips, redo enabled) â†’
position 2 restored the solid and V2. Saved successfully. Evidence:
evidence/m4-native-history-browser.png. All 27 Rust web tests, 18 JavaScript
tests, formatting, clippy and build pass. History remains process-local like
the upstream session; saving a project does not serialize undo commands.

## M2b additional persistence coverage â€” Save As

Projects now offers Save As to a new validated root filename. It uses the
existing atomic no-replace writer, then switches the session path and marks
the saved generation. A conflict leaves the current path and both files intact.
Host coverage checks same-ID retry, original byte preservation, the new file
and conflict path preservation. Windows browser created Saved_copy_UI_check
from History_UI_check, then rejected overwriting the original with FILE_EXISTS.
Evidence: evidence/m2-save-as-existing-file-refused.png. All 27 web Rust tests,
18 JavaScript tests, formatting, clippy and build pass. Automated crash recovery
and asynchronous import remain separate outstanding work.

## M2/M4 independent increment â€” timeline creation and compound insertion

The command palette creates native timelines with validated rational FPS and
dimensions; each receives native video/audio tracks and a compound pool entry.
Timeline switching invalidates old playback/frames and resets the playhead.
Compound pool entries insert through native media editing, with safe overlap
checks and native rate conversion. Self/indirect cycles are refused before
mutation. Project loading also refuses compound cycles and missing child
timelines. Double-clicking a compound opens its actual timeline for editing.
This does not implement selection-to-compound, duplicate/rename, or flattened
compound-copy workflows.

Browser proof: created Nested30 at 30fps, inserted a 150-frame solid, then
inserted that compound into the 24fps parent: source 0â€“150 became 120 timeline
frames. A self-reference insertion was rejected, leaving the saved project
intact. Double-click opened Nested30 at 30fps. Evidence:
evidence/m4-compound-native-cycle-refused.png. All 29 Rust web tests, 18
JavaScript tests, formatting, clippy and build pass. New coverage checks
rational timeline creation, invalid geometry, native compound FPS conforming,
self/indirect cycle refusal, undo and malformed project graphs. Rendered
compound acceptance on R9700 remains pending the shared hardware slot.

## M5 independent increment â€” native mixer gain and balance

Audio workspace opens a native mixer Inspector section for every audio track
and master. Gain/balance edits validate native ranges and track locks before
one composite command; no browser audio processing was added. Timeline mix
settings do not alter the independent original Source proxy. Level meters,
insert effects, EQ/compressor views and voiceover are still outstanding.

Browser: A1 -6dB / balance -0.25 applied, undo returned gain to 0, redo restored
it, and Save succeeded. Evidence: evidence/m5-native-mixer-browser.png.
All 30 web Rust tests, 18 JavaScript tests, formatting, clippy and build pass.
Native regression checks full-patch validation, one undo step, invalid balance,
locked-track refusal, master parameters and video-track refusal. Hardware
Program playback with changed mix remains pending; M5 is not accepted.

## M5 independent increment â€” native audio inserts and EQ response

Each audio/master strip now edits a bounded ordered native insert chain:
six-band EQ (enabled/shape/frequency/gain/Q), three-band compressor (crossovers,
threshold/ratio/attack/release/makeup), sample/true-peak or R128 loudness
normalization with relative/independent clip level policy, and Mono. Add,
edit, bypass, reorder and remove validate every native range before replacing
the chain in one native undo step. The browser only edits native values;
processing, defaults and bounds come from vv-core/vv-audio. Insert editors
render lazily and retain their open state across confirmed edits.

EQ graphs request the committed native EqResponse at the native 48kHz mixer
rate, under epoch/generation/revision guards. 128 logarithmic points are drawn
without browser DSP. A +6dB band measured a 5.99877dB response peak. The graph
is a transfer response, not a live spectrum or output-level meter. Bypass
returns a flat response. Presets, live meters and compressor response display
remain open.

Browser proof: A1 EQ band 3 +6dB; compressor middle threshold -18dB; Loudness
default -23 LUFS; Mono reordered before Normalize. Bypass, remove and undo
restored the chain correctly, followed by Save. Evidence:
evidence/m5-native-equalizer-browser.png, m5-native-compressor-browser.png and
m5-native-audio-chain.json. All 33 web Rust tests, 19 JavaScript tests,
formatting, clippy and build pass. Added coverage validates default ranges,
nonfinite/out-of-order rejection, full-chain atomicity/order/undo/locks and
native EQ/bypass response.

The full vv-audio suite returned 97 pass, 1 failure, 2 ignored: the existing
mixer_seek_and_snapshot_swaps_do_not_reopen_or_leak test requires an audio
output device unavailable in WSL (CPAL reports the requested device missing).
The headless run explicitly excluded that one test: 97 pass, 2 upstream
ignored, 1 filtered. No ALSA device was fabricated or Linux playback enabled.
These are native DSP/editor checks, not R9700 Program playback or physical
Windows speaker validation. D41 acquired the shared GPU slot at 13:48:56 UTC
for the priority quality panel, with a stated 15:35 UTC hard bound; Venturi
remains CPU-only until effective release is verified.

## M4/M5 independent increment â€” visual filters, grading and joint keyframes

Inspector now edits the native ordered ColorCorrection/Exposure/BoxBlur/
GaussianBlur/DropShadow stack, with add, remove, reorder and bypass. Typed
patches validate applicable fields, numeric bounds and track locks before one
native set_clip_filters command. Existing animation is preserved. Color has
all 18 native grade parameters, plus four pointer/keyboard wheels using the
same native hue ring and Cb/Cr orientation as the desktop. Wheel movement is
local; release creates one command. Escape, capture loss and window blur
cancel. Animated X/Y use one prevalidated batch of native source-frame keys.
Scalar grade/filter keyframes support native interpolation/removal.

Windows browser: on a trimmed clip, timeline frame 0 maps to source 7.
Shadows X/Y joint keys at source 7 became 0.02/0; MidtonesLuma 0.1 key,
Exposure +1 stop and GaussianBlur radius 4 saved correctly. A native software
export of this project (including its audio insert chain) decoded all 12
frames, duration 0.500s; 6.83s elapsed with llvmpipe at 1920x1080. This verifies
native rendering, not realtime CPU playback or AMD acceptance. Evidence:
evidence/m5-native-color-state.json, m5-native-color-cpu-export.json,
m5-native-color-wheels-browser.png. R9700 acceptance, scopes and Auto Balance
remain outstanding.

Responsive check: at the 746x964 browser panel, Color/Mixer buttons now reveal
Inspector as a closable drawer instead of leaving it inaccessible below the
full-editor minimum width. Evidence m5-color-narrow-inspector-browser.png;
1280x800 full layout also checked. All 36 web Rust tests, 21 JavaScript tests,
formatting, clippy and build pass. New tests cover full-patch rejection,
animation preservation, filter order/undo/locks, joint-key atomicity, unit-disc
geometry, zero pointer-move writes, one release write and cancellation.

## M3c first R9700 composed playback and seek-race correction

During the verified free slot after D41's 14:27:17 UTC release, the actual
R9700 prepared the 48-frame animated A/V composition at 960x540 in 225.80ms
(212.58 output fps on this small fixture; CPU x264). Browser Windows playback
completed with sound enabled, readyState 4 and 2.005s media duration. All 48
video frames decoded. Three native RGBA references versus the completed MP4
measured 36.54/36.17/35.73dB PSNR (predeclared minimum 30dB for lossy H.264).
Program byte prefix/suffix ranges returned 206; invalid range returned 416.
After idle, diagnostics reported no resident context/active preparation and
/proc confirmed zero GPU/KFD handles in the web process. Evidence:
m3c-r9700-program-av.json and m3c-r9700-composed-playback-browser.png.

The long browser test exposed a real scrub race: a queued video timeupdate
after local pause could overwrite a pointer's new playhead before release.
The player now suspends its clock during manual navigation until resumed;
regression coverage exercises delayed timeupdate and resume. New project
epochs reset playhead/origin, avoiding an inherited partial preview range.
Late obsolete preparation responses request cancellation. Browser media
presentation/quality counters are exposed as diagnostic DOM data for the
next full test. Empty timelines keep Play disabled.

The first long run therefore started at frame 47, and is not counted as the
complete 7200-frame protocol. The corrected full GPU/browser run remains
pending. D41 reacquired the shared slot at 14:38:25 UTC for a short A/B,
with stated hard bound 14:55 UTC. Venturi returns to CPU-only during that slot;
the cached file playback itself does not use the server GPU.

## M1/M3 measured acceptance increment â€” Canvas and five-minute A/V

After D41's effective 14:45:08 UTC release and a fresh nonblocking free-lock
check, the corrected native R9700 Program API rendered the entire range
0..7200 at 640x360/24fps. Preparation took 1.979s on the synthetic solid/flash
fixture; this rate is not a complex-edit performance claim. H.264 decodes
exactly 7200 frames over 300.000s; stereo AAC lasts 300.010s. All five beep
onsets (0/60/120/180/240s) differ from their corresponding flashes by one
48kHz sample (0.0005 video frames), with no accumulated file drift.

Windows Chromium completed continuous playback with sound enabled,
readyState 4, media time 300.010s, total_frames 7200, dropped_frames 1 and
7199 presented frames reported by requestVideoFrameCallback. This measures
the browser's counters and encoded A/V alignment, not physical speaker/display
latency. After preparation the server had no resident compositor, active
Program jobs or GPU/KFD file handles. Evidence: m3c-r9700-five-minute-sync.json,
m3c-r9700-five-minute-browser.json/png. Large effects-heavy timelines remain
unqualified; original Mesa nonconformant/testing warning still applies.

A development-only page exercises the production Canvas renderer for 720
animation frames (60 warmup, 660 measured), 500 clips on eight tracks with
thumbnail/waveform assets, pan, zoom, selection and move ghost. Windows
Chromium at actual DPR 1.25, 1280x720 viewport, 1225x540 Canvas: paint CPU
p50/p95 0.70/1.40ms; rAF interval p50/p95 16.70/17.10ms, max 28.70ms, two
intervals above 25ms. The tab stayed visible. Paint time excludes browser
raster/compositing. Optional timing is inactive in normal production use;
the fixture is not an embedded host route. Evidence:
m1-canvas-500-clips-browser.json/png. OS 100%/150% scaling checks remain open.

The corrected pointer scrub was then exercised during active Windows Program
playback: frame zero stayed at zero after delayed media events. A native delete
on the synthetic fixture made old Program status and MP4 return 409
REVISION_CONFLICT, while DELETE cancellation still returned 200. Undo and Save
restored the fixture. Evidence: m3c-r9700-stale-revision.json.

## M3 export increment â€” immutable native H.264/AAC jobs

The Export drawer now captures In/exclusive Out (including playhead buttons),
maximum width, native x264 CRF/preset and optional AAC audio. It submits an
immutable project snapshot through the same native export path used for
Program, with native progress, cancellation and completed MP4 download.
One shared media worker/one queued job and the existing five-minute,
ten-minute execution, pixel, 512 MiB/job and 2 GiB/cache limits apply.
There are no client-controlled output paths or overwrites. Edits do not
invalidate completed exports; input replacement during preparation fails them.
The browser can reconnect to its last job after reload. Shutdown/cache eviction
ends availability; durable queue/history and hardware codecs are not claimed.

38 web Rust tests, 22 JavaScript tests, formatting, clippy and build pass.
Coverage checks native settings/range rejection, settings cache identity,
snapshot retrieval after source changes, wrong epoch/job-kind refusal,
cancellation, not-ready download, HTTP error normalization and exact rational
range validation. End-to-end Export drawer/R9700 download acceptance is the
next hardware check.

## M4 independent increment â€” native linked speed, freeze and clip labels

Inspector now exposes native constant speed 1â€“10000%, pitch preservation and
KeepLength/Resize/Ripple duration policies. Whole linked groups are resolved
and lock-checked first. Applying the actual native command on a trial project
validates every resulting bounded clip range and nonoverlap before one real
undo step. Resize refuses occupied space; explicit Ripple follows the native
unlocked-track policy. No browser retiming or destructive room-making is used.
Freeze/unfreeze uses the native picture mapping. Label colors use the native
ClipColor palette and appear on the Canvas, independently of solid RGBA.

Windows browser: a trimmed linked 12-frame A/V pair changed to 200% with pitch
preservation/KeepLength, then froze at native source frame 8 and received the
Orange label on both tracks. Native rounding moved the odd original source-in
7 to 8 at 200%; this is the upstream rate representation, not a JS conversion.
Save As created Retime_UI_check without replacing the original saved fixture.
Evidence: m4-native-retime-state.json and m4-native-retime-browser.png.

39 web Rust tests and 22 JS tests pass, with formatting/clippy/build. Native
tests cover overlap refusal without a history entry, invalid speed/locked
linked-track refusal, linked Ripple and neighbour movement in one undo step,
freeze/labels and exact restoration. Pointer speed handles and hardware
render/audio acceptance remain open. The Export drawer is now scrollable and
fits narrow viewports. D41 announced its next shared GPU slot with hard bound
15:16 UTC; Venturi remains CPU-only until an effective release/free-lock check.

## M4 independent increment â€” native mask stack and Bezier values

Inspector now adds/removes/reorders native Rectangle/Ellipse/Path masks, with
enabled/invert, Add/Subtract/Intersect and all applicable native scalar
parameters. Existing animation survives default changes; scalar mask keys use
the same source-frame bridge as other parameters. A numeric vertex/handle
editor applies one complete closed path after local editing. Panel construction
is lazy and open state survives confirmed edits. New mask extents match the
desktop's fitted layer coordinates. Viewer pointer overlays and path-keyframe
editing remain open; this is not full mask UX parity.

The actual renderer has eight-mask and 256-polygon-point limits. The adapter
refuses excess masks and reserves up to 12 subdivisions per Bezier vertex,
including animated path endpoints, before mutation. Paths are bounded to 3â€“21
vertices and finite pixel coordinates; parameter applicability, duplicate
fields and track locks validate before one native undo step.

Windows proof: Rectangle with Feather 12 key at source frame 7, then a Path
combined with Subtract and vertex 1 outgoing handle X=80. Save As created
Masks_UI_check. Evidence: m4-native-masks-state.json/browser.png. Both this
project and the speed/freeze fixture exported natively on WSL llvmpipe with
all 12 video frames at 1920x1080, duration 0.500s, plus stereo AAC. These are
CPU/native proofs, not R9700 mask or physical audio acceptance. Evidence:
m4-retime-masks-cpu-export.json.

41 web Rust tests and 22 JS tests pass, formatting/clippy/build pass. Added
checks cover full-patch atomicity, animation preservation, native source keys,
undo, locked tracks, path/stack budgets and reordering. A short free-lock
window after D41's 15:07:20 UTC release allowed GPU startup, but another agent
acquired the lock before the Export job: it safely failed GPU_BUSY at 0/24
frames (m3-export-gpu-busy-browser.png). Only Venturi was restarted CPU-only;
the successful R9700 Export drawer/download check still remains open.

## M4 independent increment â€” guarded native OTIO exchange

Projects now downloads a nonempty timeline through native timeline_to_otio and
imports a listed .otio into a new no-replace .vvproj. Epoch/generation/revision,
writer/idempotency and unsaved-project rules remain authoritative. Files are
bounded to 8 MiB/64 distinct URLs; probes/fingerprints use the flat authorized
root and NOFOLLOW descriptors. The native parser runs before session mutation;
errors/panics preserve the current project. Native warnings are bounded and
shown in Projects. Probing remains serialized on the actor as the existing
media import does; large/slow imports are not qualified for interactive use.

The first actual round trip exposed upstream data loss: clip effects/masks
survived, but track insert chains/master/markers did not. The native OTIO
metadata now includes track mix/lock/solo, timeline master and markers, with
defaulted import for older/foreign files. This additive fix benefits desktop
OTIO too. Exporting compound contents is not implemented upstream: web export
explicitly refuses those active references and points to the child timeline,
rather than writing an offline external-reference placeholder. Foreign title
layout and external-NLE interoperability still need separate acceptance.

Windows downloaded OTIO from Masks_UI_check and reimported it as
OTIO_full_UI_check.vvproj. Native masks, their source-frame keys, Bezier handle,
trim range 7..19 and all four audio inserts/mixer values match; no native import
warnings. Evidence: m4-native-otio-roundtrip.json and
m4-native-otio-import-browser.png. The earlier incomplete test project/file
was preserved and is not used as acceptance evidence.

251 vv-core tests and 43 vv-web tests pass; vv-session has 99 pass/1 upstream
ignored. 22 JS tests, formatting, clippy core/web and native desktop cargo
check pass. New tests cover rational-FPS native effects/masks, mixer/master/
markers/flags, hostile file URLs/symlinks, nonoverwrite, unsaved refusal,
epoch/idempotent retries, CPU-only OTIO download headers and stale revision
rejection. GUI was compile-checked, not launched on the headless server.

## M4 independent increment â€” selected compounds and timeline management

Selected clips can now become a named native compound in one undo step.
Linked groups/locks expand first; unselected material inside the replacement
span is refused. The first web adapter permits one video and one audio track;
broader track regrouping needs separate mix/order acceptance. Crossings must
include both clips, and the native planner now retains internal crossings.
Multiple audio clips with enabled per-clip normalization are refused because
grouping changes their native measurement policy. A complete native trial
checks all clip ranges/cycles and the native 16-level nesting limit before
allocating real IDs. Load/import now validates that same depth limit.

Rename and Duplicate timeline use native pool commands, preserving the pool
name and using fresh clip/link IDs for the copy. Browser proof: the trimmed
linked A/V pair became Linked shot, saved to Compound_selection_UI_check;
double-click opened the child, renamed Linked shot graded, then duplicated as
Graded alternate. Parent/child/copy clip IDs are distinct as appropriate.
Evidence: m4-selection-compound-state.json/browser.png.

Native CPU before/after exports of the 12-frame 1920x1080 graded A/V fixture
with all four audio inserts measured video PSNR 52.33dB (minimum 40dB chosen
for this comparison), and bit-identical decoded stereo PCM (RMS error 0).
The compound exported in 2.749s on llvmpipe. This is a software/native proof;
R9700 compound playback is still open. Evidence:
m4-selection-compound-cpu-comparison.json.

252 vv-core tests and 47 vv-web tests pass, with 22 JS tests, formatting,
core/web clippy and desktop cargo check. Tests cover native internal crossings,
overlap refusal with no entity/counter/history mutation, normalization-policy
refusal, compound entity undo, fresh duplicate IDs, rename undo and the exact
native depth boundary. Unrestricted multitrack compounding and flattening are
not implemented.

## M3 shared-GPU correction â€” keep ownership for the native job

Program and Export now acquire the laboratory lock once, nonblocking, for the
complete bounded native preparation. Factory/stage permits duplicate the same
locked file description, wait for GPU completion and drop it after the native
scoped workers have joined. An idle gap between init/compose stages no longer
lets a foreign workload take over midway. Exact frame requests can return
GPU_BUSY while a preparation owns the reservation; cache reads and metadata
edits remain available, and cancellation follows the native per-frame checks.
No foreign job/port/driver is touched. Existing time/output budgets still apply.

48 web Rust tests, 22 JS tests, formatting, clippy and build pass. A Linux
descriptor-lifetime regression verifies ownership survives dropping stage
clones and even the job descriptor until the last stage is gone, then becomes
available nonblocking. Fresh R9700 whole-job/Export acceptance is pending an
effective free GPU slot; earlier hardware render/file proofs are unchanged.

## M4 independent increment â€” native project clip clipboard

Copy captures native ClipboardEntry data with complete effects, source ranges,
animation, labels, linked groups and internal crossings. Locked source tracks
may be copied. A 4 MiB process-local clipboard belongs to the current project
epoch; copying is idempotent and adds no history entry. Paste checks matching
FPS, destination locks/space, media/cycle/depth limits, then allocates native
tracks/clip/link IDs in one composite step. It never invokes destructive
overwrite insertion. Any failed trial leaves real entities, counters and
history unchanged. Cross-project/FPS transfers are explicitly unavailable.

Windows: copied the trimmed 12-frame A/V group; paste at frame zero was
refused with OVERLAP. A ruler seek then pasted both clips at frame 48 using
the live playhead, retaining source range 7..19 and one fresh shared link group.
One Undo removed both copies, one Redo restored them, and Save As created
Clipboard_UI_check. History has exactly one PasteClips entry. Evidence:
m4-native-clipboard-state.json/browser.png. Ctrl+C/V is scoped away from text
inputs; browser text clipboard contents are not read or replaced.

52 web Rust tests, 22 JS tests, formatting/clippy/build pass. Added checks
cover locked-source copy, locked/overlap refusal with complete state equality,
effect/key/mask preservation, fresh groups/IDs, internal crossings, missing
tracks in one undo, FPS/epoch/cycle rejection and host retry-safe copy/paste.
This remains bounded Edit parity, not clipboard interchange with other apps.

## Independent increment â€” explicit isolated software preview and export proof

The opt-in --software-preview launcher selects only the installed lavapipe
driver before native Vulkan enumeration, bounds renderer/Tokio threads at two,
and refuses privileged or ambiguous configurations. It uses a private cache
lock, keeping all hardware paths under the shared nonblocking laboratory lock.
The UI labels CPU/llvmpipe explicitly; this mode does not qualify AMD hardware.
No kernel/ROCm/inference configuration or foreign process is changed.

Windows browser export of the graded/effected trimmed A/V fixture used frames
2..10, width 960, CRF 23/medium and AAC. The downloaded 45,492-byte MP4 contains
exactly eight H.264 frames (0.333333s) and stereo 48kHz AAC (0.341s). Native
preparation took 641.21ms on WSL llvmpipe. After a real timeline mute command,
the old export remained ready/HTTP 200 with identical SHA-256 bytes. Undo/Save
restored the fixture. Browser reload recovered the ready job; a second native
12-frame export canceled after one frame. CPU process inspection found no
DRI/KFD handles and no mapped RADV driver. Evidence: m3-export-software-*.

Completed export links now show their captured range/settings, so reload or
form edits cannot imply that an earlier download uses the new form values.
54 web Rust tests, 22 JS tests, formatting, clippy and build pass. Tests cover
software driver/privilege/thread guards and private lock behavior. Successful
R9700 Export and fresh whole-job reservation acceptance still await shared
hardware availability; M4/M5/M6/M7 remaining parity is unchanged.

## M5 independent increment â€” two native isolated clip scopes

Color now shows any pair of Waveform, RGB Parade, Vectorscope and Histogram
using vv-render's existing shader measurements. An additive vv-session helper
composes the selected clip's track alone, including crossings/mattes/grade;
adjustment clips retain lower tracks, matching the desktop input stage. The
desktop/export paths retain their existing behavior. A native test verifies
that a red clip is measured without the blue covering track and an adjustment
target retains that blue input. Unknown/out-of-range targets are refused.

The bounded preview worker returns one 1024x256 PNG for both scopes, sharing
the existing queue/cache/lock budgets. Scope analysis cannot displace a pending
Program seek. Revision/generation is rechecked before HTTP delivery; browser
identity also includes target and both kinds. No requests occur on pointermove.
Scopes update on stopped frames; retained data is marked stale during scrubbing
and paused during composed playback. Continuous playback scopes remain open.

Windows/WSL proof: all four native kinds rendered the graded A/V fixture;
exact stepping updated the scopes. A real mute command made the old query fail
409 REVISION_CONFLICT; Undo/Save restored the project. Browser tests verify
old selection responses cannot replace newer ones. Evidence: m5-native-scopes*
PNGs/JSON. This is software/native acceptance; hardware scope acceptance is
pending the shared slot, and Auto Balance/curves remain open.

54 web Rust tests, 24 JavaScript tests and 100 session tests (one ignored)
pass. Formatting, web/session clippy, native desktop check and web build pass.

The same software runtime is deployed on halo2, bound to loopback 8790. Its
48-frame 960x540 native H.264/AAC export completed in 913.09ms; the downloaded
MP4 decoded all 48 video frames, video 2.000s/AAC 2.005s. Process inspection
found no DRI/KFD handles or mapped RADV library while the shared lock was busy.
Evidence: m3-halo2-software-export* and m3-halo2-software-isolation.json. This
synthetic fixture is not a general performance benchmark or AMD qualification.

## M5 independent increment â€” native Auto Balance

Auto Balance analyzes the selected clip's isolated native stack, with lower
tracks for adjustments and opaque black as in the desktop viewer. The bounded
worker calls vv-core::auto_balance on approximately 250k RGB samples, returning
a read-only suggestion with captured identity. Program seeks take precedence;
pending scopes cannot displace balance. An enabled ColorCorrection is required.
The browser refuses obsolete selection/frame/document results before one typed,
revision/idempotency guarded native filter command. Constants change defaults;
animated wheel rows write native source-frame keys, matching desktop semantics.

Windows/WSL: frame zero of the trimmed graded fixture maps to source frame 7.
Auto Balance corrected Midtones X/Y through keys at 7, retaining the existing
MidtonesLuma key; Highlights X/Y changed their constant defaults. All other
filters stayed identical. Exactly one native Filters history entry was created;
one Undo restored the entire original stack. Redo/Save As created the separate
Auto_balance_UI_check fixture. Evidence: m5-native-auto-balance.json/browser.png.
Color bars test command/state fidelity, not aesthetic suitability of automatic
correction. R9700 Auto Balance acceptance remains open.

55 web Rust tests and 25 JavaScript tests pass, including animated wheel grouping,
source-frame mapping, single undo, atomic invalid/locked refusal and obsolete
analysis rejection. The native isolated render test now also checks opaque
Auto Balance pixels. Formatting, web/session clippy, native desktop check and
web build pass. Curves, presets, live scopes and remaining M5/M6/M7 work are open.

## M5 independent increment â€” shared native built-in presets

The desktop EQ/compressor preset factories now live in vv-core::presets;
desktop panels delegate to them. Their function bodies are identical to the
previous native definitions (recorded SHA-256 evidence), with no numeric change.
The web catalog exposes seven EQ and seven compressor IDs. One SetAudioEffect
command changes a selected insert while retaining bypass and chain order.
Color presets call native GradeTracks::apply_preset: Neutral resets the grade,
BlackAndWhite resets only global Saturation, retaining other grade animation.
The UI explains those keyframe semantics and requires an explicit preset choice.
Presets browser buttons reveal the actual clip/mixer controls.

Windows: BlackAndWhite, EQ Voice and Compressor Broadcast applied as exactly
three native history entries, saved to Presets_UI_check. Native software export
produced twelve 1920x1080 H.264 frames (0.500s) plus stereo AAC (0.512s) in 2.194s.
Every decoded frame had U/V exactly 128; decoded audio was finite and non-silent.
Evidence: m5-native-presets*, m5-native-preset-extraction.json. This verifies
native command/render behavior, not hardware performance or listening quality.
Saved/custom/shared libraries and transform presets remain open.

The two original desktop preset validation tests and the original compressor
mix-signal behavior test pass. Native desktop check also passes. Web tests cover
preset key preservation, exact undo, bypass/order, native parameter bounds,
wrong-kind/unknown/index errors and locked-track refusal.

## M7 independent increment â€” saved backup recovery and process ownership

Projects lists regular .vvproj.bak files and recovers them into a new no-replace
project. Native parsing/media/depth checks, NOFOLLOW reads and the 8 MiB budget
apply before any session switch. Dirty sessions are refused; Save As preserves
their current edits without updating the backup being recovered. Success installs
a fresh epoch and retrying the same command returns its original acknowledgment.

Windows: the recovery fixture's current version had V1 muted; its previous-save
backup had V1 enabled. Recovering to an existing name was refused. Recovery to
Recovery_recovered_UI_check restored V1 enabled and a saved fresh epoch. SHA-256
of both the original file and backup stayed identical. Evidence:
m7-recovered-backup.json/browser.png. A host regression additionally recovers
after deliberate current-file corruption without replacing that damaged file.

Each vv-web host now takes a nonblocking descriptor lock on the canonical
project directory before media/Vulkan startup. An alias cannot start another
cooperating writer. Kernel close/exit releases ownership without deleting lock
files. A separate CLI process exited 1 before renderer initialization while the
original server stayed healthy: m7-project-root-owner.json. The saved legacy
8795 test process was stopped before final runtime verification. This lock does
not coordinate arbitrary external filesystem writers or the desktop editor.

59 web Rust tests and 25 JavaScript tests pass, with formatting, core/web clippy,
build and the three focused original desktop preset tests. Root ownership/drop,
backup symlinks/path bounds, dirty/existing-name refusal, retry-safe epochs and
unchanged source files are covered. Long soak, unsaved-edit autosave, durable
render queues, full external-edit conflict detection, voiceover/curves/libraries
and AI Review remain open; M4â€“M7 are not declared complete.

## Fresh R9700 Export acceptance and final shared-host runtime

A live nonblocking shared-lock check found a free slot. The current binary
initialized the explicit R9700 device 0x7551 (RADV GFX1201, Mesa 26.0.8), then
the Windows Export drawer completed the unchanged composed A/V fixture using
the whole-job reservation path. Forty-eight 960x540 frames prepared in 222.89ms
with CPU x264/veryfast CRF 18 and AAC. The downloaded MP4 decoded exactly 48
video frames, video 2.000s and stereo AAC 2.005s. The idle process had no DRI/KFD
handles and no ownership of the shared GPU lock. Evidence:
m3-export-r9700.json/browser.png. This closes the short R9700 Export check;
the synthetic fixture is not a general performance or complex-effects claim.

After download the service was restarted in explicit CPU mode, preserving GPU
availability for the other agents. Final halo2 binary SHA-256:
fd91b89fe9ddec298912ba1e98529908ceb0f3a4c020d557c0908aed07a624aa.
The loopback 8790 endpoint and existing Windows SSH tunnel remain available.
A separate CPU_color_UI_check copy demonstrates native BlackAndWhite with
the orange overlay still colored and clip-isolated native scopes. It is saved;
the original GPU fixture is unchanged. Final process inspection confirms
software_preview true, the installed lavapipe-only environment, two renderer
threads, root directory ownership, no DRI/KFD handles and no loaded RADV library.
Evidence: m5-halo2-final-color-browser.png and m7-halo2-final-runtime.json.

No foreign process/port, kernel AMD driver, ROCm or inference configuration
was modified. Long-form Export limits, hardware encode/decode selection and
the remaining M4â€“M7 feature ledger are still open.

## M4 independent increment â€” native scalar curves and Bezier editing

The Inspector now has a working Curves panel, also reachable from the Color
workspace. Its DPR-aware Canvas plots bounded samples evaluated by native
Keyframed::value_at. Track selection covers transform, grade, filter and mask
scalars and audio clip gain. Keys retain exact source coordinates alongside
native timeline positions. Numeric editing, duplication, deletion, key dragging
and outgoing Bezier handles use one revisioned edit and one Undo per gesture.
The browser only maps geometry; it does not evaluate interpolation. Native
Interpolation::control_points supplies handle positions, including presets.

The adapter refuses occupied destinations, missing original keys, locked tracks,
out-of-range values/frames and invalid Bezier points before applying any command.
Moving an odd source-frame key on a conformed clip does not round it through the
timeline. Escape, capture loss, pointer cancellation and window blur abandon local
drafts. Unknown mutation outcomes use the existing command lookup/recovery flow.
Sampling is bounded to 769 points per animated track, with 2048 selectable keys
and an explicit total count. Constant tracks need at most two samples.

65 vv-web Rust tests and 29 JavaScript tests pass, along with formatting, web
clippy with warnings denied and a native binary build. Coverage includes every
advertised scalar target, exact source timing, collision/validation atomicity,
undo/redo, hidden-key deletion, long dense curves and one commit per completed
key or handle drag. Browser proof is in m4-native-curves.json and the accompanying
screenshots: a saved copy of the ranged fixture retains its Bezier keys after
reload; a handle drag changes only its outgoing control, Undo restores it, a
collision leaves history unchanged, and deletion is reversible.

Curves parity remains partial: multi-key box selection/group moves, dedicated
zoom/pan, linked zoom axes and RGBA/text/enum key editing are open. Slip's dual
viewer, viewer mask/transition handles, broader compound editing, live audio
meters/spectrum, browser voiceover/VAD, saved/shared libraries, long exports,
durable recovery and AI Review also remain open. There is no complete GUI parity
or production-readiness claim. This increment requires no hardware GPU work.

The development branch is deployed on halo2 in explicit software mode. The
saved CPU_curves_UI_check copy animates the base video's opacity from 30 to 100
over source frames 0â€“47 with Bezier interpolation, while the overlay stays
colored. Windows can open the panel, see the composed native frame and isolated
scopes, and retain both keys in native history. Evidence:
m4-halo2-software-curves.json/browser.png. The binary SHA-256 is
c2cacb3ca1f10ee2da0484c141a62d4331dd6c264e6d2c8bd0598134df11d61a.
Inspection confirms software_preview, two renderer threads, root directory
ownership, no DRI/KFD handles and no loaded RADV library. Staging and this
acceptance did not acquire or probe the shared hardware GPU reservation.

## Active completion objective â€” continue through M4â€“M7

The owner explicitly requested autonomous continuation to completion. The active
goal covers the full planned native GUI parity surface, AI Review, deployment
and acceptance; finishing an individual slice is not completion of that goal.
The shared library must integrate ds4-appliance's authoritative catalog and its
14 TB network archive. The endpoint is being resolved; independent editing work
continues. See ARCHITECTURE for the verified sibling API and storage contract.

## M4 increment â€” native media catalog and safe relink

Media now supports Ctrl/Shift and keyboard range selection, search/type/folder
filtering, nested project folders, atomic batch moves, folder rename/reparent/
removal and native media removal/relink. Removing a folder keeps its contents;
removing media leaves its timeline clips offline without deleting source files.
Relink probes/fingerprints an allowlisted regular file through one descriptor,
validates the entire batch, then reuses native SetMediaPath. FPS/crop/key
adaptation, IDs and Undo remain owned by the original core. Locked references,
missing streams, short replacements, symlinks, path escapes and folder cycles
are refused. Source playback and thumbnails/waveforms invalidate on changed
native content hashes, including Undo; late assets cannot re-enter the cache.

70 Rust web tests and 31 JavaScript tests pass, with formatting, web clippy
(warnings denied) and build. Windows browser proof:
m4-native-catalog.json/browser.png. A real linked A/V fixture retained clip IDs,
timing, links and an EaseInOut opacity key through removal, Undo, relink to a
different MP4, Undo/Redo and save. Both source SHA-256 values stayed unchanged.
Removing a parent folder lifted its media and child to the root, and Undo
restored the hierarchy. Compound cache generations advance during Undo, while
removed media's Inspector bounds use timeline dimensions until it returns.

Project folders are editing organization only. Shared assets remain owned by
ds4-appliance; this increment does not create another shared catalog or modify
its files, mount, credentials, retention policy or inference services.

## M4 increment â€” Slip tool and dual source viewer

Timeline now offers Move/trim and Slip tools. Slip drags retain clip geometry,
intersect all linked source handles and commit one native SlipClips operation.
The Inspector also opens a dual viewer with numeric delta/Apply/Close controls.
Its first/last source coordinates are computed by the native clip methods for
every cached integer delta, including conformed FPS. The browser only indexes
that map and seeks two muted local MP4 Blob views; pointer movement performs no
HTTP. Cached maps have at most 65537 entries and proxies at most 32 MiB.

Browser verification initially caught CSP blocking blob videos and Color scopes
constraining the view. The media CSP now permits local blobs; scopes hide while
Slip is visible and restore their previous visibility on close. The tested
320x180 source displays frames 10 and 21 at media times 0.416666/0.875 seconds,
matching the embedded source frame numbers. Numeric +3 and pointer +5 moved
linked video/audio source bounds together, each in one Undo. Both Undos restored
7..19; Redo/save retained 10..22 (exclusive out). Clip IDs, timeline geometry,
links, native keyframes and the source SHA-256 stayed unchanged. Evidence:
m4-native-slip.json/browser.png. 72 web Rust and 35 JavaScript tests, formatting,
web clippy with warnings denied and build pass; all acceptance here is CPU.

Slip remains partial at the source-service limits: long or complex sources
whose full low-quality proxy exceeds the existing source-job duration/32 MiB
local budget need bounded source-window proxies. Numeric native slip still
works without a dual movie preview. Stills/audio/compound sources retain their
native editing semantics but do not claim a dual movie decoder. Closing these
source-preview limits is required before complete M4 parity is claimed.

The catalog/Slip binary is deployed on halo2 in explicit CPU mode, SHA-256
d0c2a8f4b78568be60004b97c182bd0a7a395a05dfee67498b7548bda9101037.
CPU_slip_UI_check is a saved copy: linked video/audio were trimmed to 12 frames
and slipped +5, while the separate overlay and original project were retained.
Windows dual preview decoded source frames 5 and 16 from local blob URLs.
Process inspection again found no DRI/KFD descriptors or loaded RADV library,
with two renderer threads and project directory ownership. Evidence:
m4-halo2-software-slip.json/browser.png. No hardware reservation was acquired.

## M5 increment â€” native speech detection and global silence removal

Audio now opens a speech-analysis dialog for selected source audio or the audio
linked to selected video. It uses vv-session's embedded Silero model, native
non-speech spans, clip mapping and timeline cut planner. Detection is CPU-only,
off the Session actor, with cancellation, bounded work/results and a 32 MiB
native probability cache. Parameters and document/source identities invalidate
obsolete proposals. Proposed cuts are listed and highlighted across the Canvas;
the browser does not perform speech detection or calculate edit ranges.

Apply explicitly ripples every track through native delete_ranges, validates
the complete result first and creates one RemoveSilences Undo entry. Locked
affected tracks refuse atomically. The model's actual zero-audio result was
verified in the Windows browser: two seconds at 24 fps proposed 0..48, analysis
left history unchanged, Apply removed the 48-frame audio and shortened a
120-frame video to 72, and one Undo restored both original clips and IDs.
Changing threshold disabled the old proposal; a locked video track refused
Apply with unchanged history and clips. Source SHA-256 remained unchanged.
The saved Speech_UI_check project retains its original audio/video content.
Evidence: m5-native-silence.json, m5-native-silence-browser.png and
m5-native-silence-locked-browser.png. 76 Rust web tests and 37 JavaScript tests
pass, with formatting, clippy (web and media, warnings denied) and build.

The fixture exposed an existing native WAV writer tail-padding defect: a
variable-frame PCM encoder received a full padded final block, adding 48 ms to
a two-second recording. Commit 825ad28 preserves the actual final sample count.
Focused native tests round-trip every sample exactly for mono and stereo,
including a short final block; all three audio_file tests pass. Fixed-frame
encoders retain their required padding. Original desktop recording shares this
correction without changing its UI or editing semantics. Voiceover remains the
next independent Audio slice; this increment does not close M5 as a whole.

Silero is also deployed on halo2 in explicit software mode, binary SHA-256
8335ce3f1105d84c6b3bb983704fe54f88e49e8fd84099a6838273093e5d502b.
The Windows browser analyzed the linked half-second A/V edit and proposed
0..12 without applying it; the saved project and empty history stayed intact.
No DRI/KFD handles or RADV library were present, and the shared hardware lock
was not acquired or probed. Evidence: m5-halo2-software-silence.json/browser.png.

## M4/M5 increment â€” native track removal and arming

Track Inspector now exposes explicit removal with its clip count, preserving
one video and one audio track and refusing locked tracks. The native RemoveTrack
command retains all track content for one Undo. Audio tracks additionally expose
native arming, restricted to saved projects and unlocked audio tracks. Canvas
headers show REC for armed tracks. The adapter now preserves the native history
label for mute/solo/lock/arm rather than labeling every flag as LockTrack.

78 web Rust tests and 37 JavaScript tests pass, with formatting, clippy and build.
Windows proof adds V2, removes populated V1 in one step, restores V1 and its
original clip with Undo, then arms A1 and saves Tracks_UI_check. The original
Speech_UI_check file remains intact. Evidence: m4-native-tracks.json/browser.png.
Arming is a prerequisite for browser voiceover; it does not by itself claim a
complete recording workflow.

Shared-library discovery resolved the actual running appliance on halo1:
http://192.168.1.153:8787. Its catalog responds from halo2, reporting the 14 TB
archive configured and reachable at /mnt/madrock-share/madrock-library, seven-day
SSD retention, sequence 5 and zero items. The older 8788 reference was not the
active listener. No appliance configuration, mount or inference was changed.

## M4 increment â€” ds4 shared-media catalog and archive recovery

The Library tab now consumes ds4-appliance's authoritative catalog through a
startup-configured server origin. Search covers ID, type, tool, prompt, model and
exact seed strings. It reports archive reachability and SSD retention, prepares
only explicitly selected project copies and uses the original native import
command. Native MediaIds remain separate from appliance IDs. Missing shared uses
can be restored through the same appliance file API and relinked atomically,
with native lock/stream/source-range checks and one Undo.

Transfers run off the actor through a bounded HTTP client/worker, validate size,
media signature, native streams and current catalog identity, compute SHA-256,
and publish without overwriting through the actor's exact directory descriptor.
Per-file versioned provenance sidecars keep captured prompt/model/seed and full
SHA-256 without modifying the native project format. Prepared copies survive
Save and host restart, while changed local copies are refused. Seeds serialize
as strings, including values above JavaScript's exact integer range. WebP joins
PNG/JPEG original-byte Source playback and native thumbnails; no still transcoder
or browser editing engine is introduced. Existing dependency versions and the
eight native default workspace members remain unchanged.

83 Rust web tests and 39 JavaScript tests pass, with formatting, clippy (warnings
denied) and build. Tests cover declared type/playlist rejection, native WAV
roundtrip, truncated transfers, changed local files, exact u64 seeds, path/URL
validation and WebP original-byte delivery. Windows acceptance used a 2003-byte
synthetic PNG created only for this test. The appliance actually moved it into
its CIFS archive; the mounted filesystem reports 13,888,976,269,312 bytes. API and
local source SHA-256 match. After reversible removal of the local copy, one
RelinkMedia step recovered it with the same MediaId/ClipId, 120-frame edit and
opacity key `[0,65,EaseInOut]`. Undo/Redo, save/restart and repeated import retain
the same media, animation and exact seed 9007199254740993. Source decoded the
original 320x180 PNG. Evidence: m4-ds4-shared-library.json/browser.png,
m4-ds4-shared-source-browser.png and m4-ds4-library-network.json.

This slice does not complete the original native library's compound-asset
organization or saved/shared attribute-preset workflows. Those remain explicit
parity work. The active completion goal remains open for the remaining GUI,
Voiceover, AI Review and release acceptance. No GPU reservation or inference
configuration was changed by this CPU-only integration.

The verified library binary is deployed on halo2, SHA-256
89c804446bd17b3578013dbb1429f8d413f856802fa9612d5a915d6193ed92f1,
with the actual appliance origin configured. CPU_shared_library_UI_check is a
saved project containing the archived PNG as native media and a 120-frame clip.
Windows Source decoded 320x180 and displayed the exact seed/provenance. Inspection
confirmed two renderer threads, the held project directory lock, no DRI/KFD
descriptors and no RADV library. The hardware reservation was not acquired or
probed. Evidence: m4-halo2-shared-library.json/browser.png.

The one synthetic appliance item created for this acceptance was then removed
by exact ID after checking its unique marker and SHA-256. The original catalog
had no items and is empty again. Both WSL and halo2 still deliver the original
PNG bytes through their native Source APIs from their persistent project
copies. No pre-existing library asset was changed or deleted. The redundant
local offline-test backup was removed only after both copies matched SHA-256.

## Voiceover prerequisite â€” explicit native audio container

The shared audio-file writer now selects the container from AudioFileFormat
instead of guessing it from the path suffix. Normal desktop take filenames keep
the same muxers/codecs. A pre-created safe file descriptor can therefore receive
native WAV output through /proc/self/fd without using an unrestricted path.
Four focused native audio_file tests pass, including every available format,
exact mono/stereo sample preservation and extensionless-descriptor output;
media clippy with warnings denied also passes. This is a recording prerequisite,
not a completed microphone/placement workflow.

## M5 â€” browser voiceover and native take placement

Audio Voiceover and armed Program transport now open a real capture dialog.
User Start requests browser input permission and creates a bounded AudioWorklet
capture, optionally preparing the existing native composed programme first.
Mono/stereo input, native formats, optional headphone monitoring, start and
latency correction are exposed. Stop/input loss/programme end/document changes
flush final samples and release input. Stop and placement controls stay visible
while settings scroll. No browser DSP or editing engine is introduced.

One bounded upload encodes outside the Session actor through a pre-created
descriptor and publishes without replacement. Versioned UUID receipts retain
frame count and raw/encoded SHA-256. Identical retries resolve to the same take;
changed input/receipt/files are preserved and refused. Failed uploads retain the
browser Blob and a float WAV backup. Explicit discard releases an unsaved take
after confirmation; saved audio remains in the media picker.

Placement uses native import, FPS conforming, insert and disarm in one
RecordVoiceover group. A trial project validates the entire operation. Locked
targets/linked tracks, duplicate placement and default overlaps are refused.
Overwrite and rebinding after document changes require explicit actions. Undo
restores clips, media and arming; recorded files persist independently of it.

89 Rust web tests and 49 JavaScript tests pass, plus formatting, clippy with
warnings denied and build. Tests cover exact samples, retry, malformed input,
changed files, multitrack atomicity, locked linked video, latency at zero, final
chunks, cancellation during permission/preparation, retained capture after
programme/network failure, stale rebinding and preview reset after placement.

Windows acceptance used the real AudioWorklet/controller with an explicit
synthetic 440 Hz provider, never a physical microphone. A 138240-sample take
survived interrupted upload, retry, placement, Undo/Redo, Save and server restart.
Native WAV decoded SHA-256 matches captured PCM exactly. A second capture waited
for the native 69-frame composed programme and saved at its end, refused default
overlap and applied two-frame latency correction with explicit overwrite. Native
insertion retained the untouched one-frame tail; one Undo restored the old clip.
Canceling before delayed input opened released it without capture. Evidence:
m5-voiceover.json/browser.png, m5-voiceover-composed.json and
m5-voiceover-overlap-browser.png. Physical microphone permission/device latency
and embedded-browser download completion remain unverified. No hardware GPU
lock or inference setting changed. Full parity and the completion goal stay open.

A third browser capture used stereo under the production Content Security
Policy. All 184832 frames decoded to the exact interleaved PCM SHA-256, with
identical left/right samples from the mono synthetic provider. No CSP/console
errors occurred. Releasing the saved local take kept the native audio file
available. Evidence: m5-voiceover-stereo.json.

The voiceover binary is deployed on halo2 from 7896a06, SHA-256
3d1460c37f5231384cf659cb5dbb96bac0601ce85e0e6f09990ebca8c10fa3f6.
CPU_shared_library_UI_check reopened with its original clip and exact shared
seed. The embedded recording modules match the tested sources and native WAV
is available. The process remains isolated CPU/lavapipe with two workers, no
DRI/KFD descriptors and no RADV mapping; the shared hardware lock was untouched.
Evidence: m5-halo2-voiceover.json/browser.png. Physical microphone capture is
not claimed by this deployment check.

## M6 prerequisite â€” native Replace Take planner and guarded API

The new vv-core take planner creates one native composite command for explicit
source replacement. It preserves clip IDs, placement, existing speed and all
unrelated uses of the original media. Linked replacement or keeping other
linked clips is an explicit policy; mixed linked sources/speeds require the
latter. Missing streams and locked linked tracks refuse the whole operation.
The default preserves edit duration or refuses a short take. Explicit shorten
leaves a gap, clamps fades and removes affected crossings in the same Undo;
it never ripples or silently changes speed. Preserved effects remap keyframe
times through native FPS/In helpers and rescale crop through the native relink
convention. Reset replaces clip effects/fades only. Source files remain intact.
Frozen/compound clips are explicitly refused at this stage.

A read-only plan API exposes exact changes, with canonical string IDs and a
descriptor source version. Applying requires that version and the normal
epoch/generation/revision/idempotency checks, source metadata revalidation and
a complete trial project. The native GUI's existing behavior is unchanged;
only the new history label has English/Italian translations.

258 core tests and 91 web tests pass. Core/web clippy with warnings denied,
formatting and the native vv-app check pass. Tests cover mixed FPS and source
In animation, crop scaling, unrelated uses, linked sync, locks, stream mismatch,
shortening/crossings, source changes, explicit effect reset, unchanged source
bytes and exact Undo/Redo. This is an executable backend prerequisite, not
completed Review UI, Shot/Take sidecar or A/B acceptance; the goal remains open.

## M6 â€” A/B source comparison and explicit Replace Take UI

Review now opens two source players using the existing bounded native proxy/
original-still service. Playback compares elapsed seconds at 1x, holds the
shorter take at its last frame and lets the user audition one side at a time.
Native media controls and the audition selector stay consistent. Sources can
be swapped or compared without a clip selection. Native FPS/frame counts and
known ds4 prompt/model/exact seed are displayed; absent generation metadata is
reported as absent. No editing or retiming algorithm runs in the browser.

Selecting a native media clip enables a replacement preview with B source In,
duration, linked-source and effect/fade policies. The preview lists every
affected clip/range and any crossing or animation-key merging. Only Confirm
commits; source choices, parameter edits, stale documents and read-only sessions
cannot confirm an obsolete plan. Settings lock during the native mutation.

Real mixed-FPS acceptance exposed a one-frame animation error in the initial
FPS-only key scaling. Native per-key mapping through timeline frames fixes it;
all effect parameter types use the same native map. Existing rescale behavior
is retained, including first-key retention when quantization merges keys. The
merge count is now explicit in the confirmation preview.

260 core tests, 91 web tests and 58 JS tests pass, with formatting, core/web
clippy (warnings denied), native vv-app check and build. JS tests include late
preview refusal, explicit shortening/confirmation, stale/read-only state,
native refresh during commit, merge warnings and exclusive audition controls.
Core regression tests cover the actual 24/50 fps key position and merge counts.

Windows acceptance used three synthetic H.264/AAC files at 25, 30 and 50 fps
with linked video/audio on a 24 fps timeline. A 72-frame edit refused the short
take until explicit Shorten produced 60 frames on both tracks. The following
solid stayed at frame 110. A longer take preserved IDs/start/72-frame length/
speed and rescaled crop from 10 to 20 pixels. One Undo restored original media,
timing and effects. Redo, Save and server restart retained opacity values
100/65/20 at timeline frames 12/31/83. The browser showed frame 31 CURRENT and
opacity 65; source file SHA-256 values never changed. A/B ran at 1x with less
than 80 ms initial clock difference and held shorter B at 2.516 s while A
finished at 4.010 s. Evidence: m6-review.json, m6-review-ab-clock.json,
m6-review-ab-browser.png, m6-review-duration-browser.png and
m6-review-preserved-key-browser.png. This is CPU acceptance. Shot/Take sidecar,
favorite/reject/editable metadata and hardware acceptance remain open.

The e15f24a binary is deployed on halo2, SHA-256
55c81b7dc862f7eae6ce5f52ee6b97a0f7e2377f55882e7adff32f37ed16a3bf.
Both Review panes decoded the shared original 320x180 PNG and displayed the
captured model/prompt and exact seed 9007199254740993. Still comparison disables
movie playback. The original saved library project stayed unchanged. The
embedded Review module matches the tested source; malformed preview requests
are rejected without mutation. CPU/lavapipe isolation, two worker caps, no
DRI/KFD handles and no hardware-lock acquisition were verified. Evidence:
m6-halo2-review.json/browser.png. The detailed local proof retains only the
relevant native session and complete opacity/crop tracks rather than repeating
unrelated Inspector catalogs.

## M6 â€” persistent Shot / Take annotations

Review grouping and metadata tools now open a saved-project annotation editor.
Users can create/rename/remove shots, assign takes, mark Favorite/Rejected,
search labels/model/prompt/exact seed and compare a selected take. Source
provenance is inherited by default; explicit model/prompt/seed overrides and
unknown values are separate. All source text uses safe DOM text/value APIs.
Changed source identities require an explicit rebind. Missing media retain
their annotations in a visible orphan list.

The versioned, bounded project sidecar has revision/namespace guards, atomic
publication and a rolling previous state. It leaves native project semantics
and timeline Undo unchanged. Restore previous annotations is reversible. Save
As copies annotations independently and rolls back only its own reserved file
on failure; orphan sidecars cannot silently attach to a new project. Read-only,
stale and failed requests retain the current form and cannot write.

96 web tests and 64 JS tests pass; web clippy with warnings denied, formatting
and build pass. Real CPU browser acceptance saved an Opening shot, Favorite,
manual model, multiline literal prompt and exact seed 18446744073709551615.
Exact seed search and A/B display retained every digit. Restore previous toggled
the old/new state. Save As copied annotations; rejecting the copy left the
original Favorite. Server restart and native reopen retained the original
annotations and unchanged clip ranges/source SHA-256 values. Evidence:
m6-review-annotations.json, m6-review-annotations-browser.png and
m6-review-annotations-compare-browser.png. Twenty-shot montage acceptance and
remaining original-GUI parity/release checks are still open.

The 779fbba binary is deployed on halo2, SHA-256
0b5b28b99b55db0d30660fe0d5b6008a29cbe80c3744ed864494091b6b400d06.
The shared still fixture inherited model/prompt and exact seed 9007199254740993
with a Favorite annotation and Library acceptance shot. CPU/lavapipe, two-worker
caps and absence of DRI/KFD descriptors were verified; the hardware lock was not
acquired or probed. The global ds4 catalog and NAS were not changed. Evidence:
m6-halo2-review-annotations.json and m6-halo2-review-annotations-browser.png.

## M4 â€” shared native property paste

The original desktop attribute conversion now lives in `vv-core::attributes`.
Desktop uses the same enum, mapping and preset conversion through UI extension
methods; serialized preset names and native behavior are unchanged. The web
adapter uses native SetClipAttributes/SetClipSpeed in one composite history step.
Users copy clips, select destinations and open Paste selected properties or
Alt+V to choose the original 16 groups and source-frame timing/stretch policy.
Only the selected properties are replaced, with native type-specific targets,
key mapping and duration clamping. Speed explicitly uses Ripple/pitch behavior.

The clipboard snapshot has a content revision; late/stale or read-only forms
cannot apply. Locked linked destinations refuse the whole operation. A native
trial validates all changes and refuses ripple that would separate a linked
group, including a locked downstream counterpart. Failed requests retain choices.

267 core tests, 100 web tests and 67 JS tests pass, along with core/web clippy
with warnings denied and the native vv-app compile check. Seven extracted native
tests cover selective paste, timing/stretch, edge values, fades/transitions,
filters and color keys. Adapter tests cover per-kind linked targets, exact
one-step Undo, unchanged unchecked values, stale copies, locks, native speed
ripple and protected downstream links. Real browser acceptance copied Opacity
and Crop from the animated 50 fps source clip to a 24-frame solid. At timeline
frame 116/source frame 6 the native value was exactly 65 and CropLeft 20. One
Undo restored 100/0; Redo/Save/service restart retained the pasted keys and
unchanged source hashes and clip ranges. Evidence:
m4-native-paste-properties.json, m4-native-paste-properties-dialog-browser.png
and m4-native-paste-properties-browser.png. Saved custom preset library and
remaining parity/release work remain open.

The 5311b48 binary is deployed on halo2, SHA-256
bf70ad296bdf3fdb0b4f73053636e5275282abcfc977df0c9e833b2aced36149.
Its embedded property-paste module matches the tested source. Saved shared
fixture annotations and exact seed remained intact. CPU/lavapipe, two workers,
no DRI/KFD handles and no hardware-lock probe/acquisition were verified. Evidence:
m4-halo2-properties.json. Native vv-app test targets also compile successfully.

## M6 â€” twenty-shot montage acceptance

A separate saved fixture contains 20 shots, each with three synthetic 25/30/50
fps H.264/AAC sources, for 60 imported takes and 40 linked timeline clips.
All sources have explicit synthetic metadata, exact seed strings and per-take
ratings. The 24 fps timeline places edits every 72 frames. Twenty native
replacements alternate short B (explicit 60-frame shortening, leaving a gap)
and long C (72-frame preservation). Every preview affected both linked clips;
each retained opacity 65 at shot-relative timeline frame 19. The first replacement
had exact native Undo/Redo. Saved annotation items and shot names matched exactly
after service restart and project reopen. All 60 source hashes stayed unchanged.

The browser reported 20 shots / 60 takes and filtered Shot 20 to unrated A,
Rejected B and Favorite C, retaining C's exact u64::MAX seed. Fit displayed the
whole montage. Native Export completed all 1440 frames, 60 seconds, with CPU
lavapipe and x264/AAC at the requested maximum 640 width (native percentage
rounding yielded 632x356). The downloaded MP4 has 1440 frames at 24 fps, video
duration 60.000 s and AAC duration 60.010 s. Decoded analysis measured the first
take at 660 Hz and the next at approximately 875 Hz, with zero RMS in the gap.
Frame 65 in that gap is black; frame 84 in the next take has image content.
No hardware GPU, global ds4 catalog or NAS mutation was involved. Evidence:
m6-twenty-shot-montage.json, m6-twenty-shot-browser.png,
m6-twenty-shot-timeline-browser.png and m6-twenty-shot-export-browser.png.
This closes Shot/Take grouping acceptance; remaining native GUI and release
work is still tracked in the parity ledger.

## M7 â€” external project Save conflict protection

The current native project file is bound to its descriptor identity and SHA-256
after a validated Open or successful Save/Save As. Only one current baseline is
retained. Save rechecks the bounded, NOFOLLOW file before writing the backup and
again before publication. A changed/replaced/missing file returns SAVE_CONFLICT;
dirty native state and history stay available. The browser opens Projects with
the visible error beside Save As, proposes a bounded copy name and focuses it.
Save As still uses a new no-replace destination and copies Review annotations.

103 web tests and 67 JS tests pass, with web clippy (warnings denied), formatting
and build. Regression tests cover stable external changes with unchanged backup,
equal-size writes with restored mtime, deleted/replaced files, explicit reopen,
dirty-state retention, repeat-safe refusal and repeat-safe Save As. Real browser
acceptance appended a valid external RON comment to an own montage copy after
muting V1 in memory. Save refused, kept dirty/history/V1 state and preserved the
external SHA-256 without creating a backup. Save As and service restart retained
the muted track and an exact annotation copy. All 60 source hashes stayed
unchanged. Evidence: m7-save-conflict.json and m7-save-conflict-browser.png.

This detects ordinary external edits; it does not lock arbitrary external
writers across the final check/rename interval. Directory ownership only
coordinates cooperating web hosts. Unsaved-edit autosave, durable jobs, saved
session restoration and the rest of the release checks remain open.

The fd0df82 binary is deployed on halo2, SHA-256
92172373336309e8fb27c9e71112c06bb9ea620e34764e0c906b2badddaa27ce.
The embedded main module matches the tested source; the saved shared project,
Favorite annotation and exact seed remain available. CPU/lavapipe and two-worker
caps are retained, with no DRI/KFD handles or hardware-lock probe/acquisition.
Evidence: m7-halo2-save-conflict.json.

## M4 â€” selection follows playhead

The Commands palette has a persisted Selection follows playhead toggle, enabled
by default like the desktop. It follows the audited native visible-video order:
topmost clip on unmuted video tracks, disabled clips excluded, whole linked group
then locked tracks dropped. Gaps clear selection. Seek drafts update selection
locally and refresh Inspector only at the final seek; playback updates Inspector
at clip boundaries. Frame steps and marker jumps use the same rule. Disabling
the preference retains manual selection independently of the playhead.

68 JS tests pass, including video layering, disabled/muted sources, linked
members, locked tracks and exclusive end boundaries. Browser acceptance moved
from Shot 01 B through its gap into Shot 02 C, verified a disabled manual
selection over another take, persisted the disabled option across reload and
reenabled it. During composed CPU playback, timeline frame 1252 selected Shot
18 C exactly as the native timeline predicted. The complete native session
snapshot and history were byte-for-byte equivalent before/after these view-only
checks. Evidence: m4-selection-follows-playhead.json and the associated
playhead/gap/playback browser screenshots. No HTTP editing or DSP runs in this
view preference.

The 67b8df2 binary is deployed on halo2, SHA-256
7155e73a3237261cbd5f742eadcf3caf21e7e7f28395932144fa5ac16f5cb37f.
The tested main module, saved library project and exact provenance/annotation
seed match. CPU/lavapipe and two workers remain isolated from hardware; no
DRI/KFD handles or GPU-lock probe/acquisition occurred. Evidence:
m4-halo2-selection-follow.json.

## M7 â€” validated last-saved project reopen

Successful project Open/New/Import/Save/Save As/recovery records a bounded,
versioned root-scoped project token and saved-file SHA-256. The private cursor
uses NOFOLLOW reads, a 4 KiB limit, exclusive temporary writes, fsync and atomic
publication. Startup reopens matching saved bytes through the same bounded
native parser, media-root/depth/range validation and rate refresh as explicit
Open. The Save-conflict baseline is refreshed from the actual file. Missing,
changed, unknown or linked metadata/files are preserved; the empty session and
Projects notice permit explicit Open. Auxiliary cursor failures cannot turn a
successful native project Save into a failed mutation acknowledgment.

108 web tests and 68 JS tests pass; web clippy with warnings denied, formatting
and build pass. Native host restart reopened the saved 20-shot/60-take/40-clip
fixture before any browser Open command. Reload showed its saved composition.
Save worked against the refreshed baseline. A separate saved copy changed
externally was refused at startup with a visible Projects notice. Explicit Open
updated its hash baseline; the following restart reopened it automatically.
Source hashes and native project/annotation contents stayed intact. Tests also
cover repeated metadata writes, missing files, future schemas, symlinks and
successful project acknowledgments despite unsupported cursor metadata.
Evidence: m7-saved-project-resume.json, m7-saved-project-resume-browser.png and
m7-saved-project-changed-browser.png. Unsaved autosave and durable render jobs
remain open; this increment restores only saved project state.

The 310fe8f binary is deployed on halo2, SHA-256
a5a9242943e53ef2e3a05ca8c8709f139f9184a7c95087897264078d7eac814c.
After an initial explicit Open, an owned service restart reopened the saved
shared-library fixture before any browser Open request. Its cursor matched the
on-disk project hash and the browser showed the saved project immediately after
connection. Exact provenance/annotation seed and Favorite stayed intact.
CPU/lavapipe, two workers and absence of DRI/KFD handles were verified; the
hardware lock was not acquired or probed. Evidence:
m7-halo2-saved-resume.json/browser.png.

## M7 â€” independent unsaved-edit recovery snapshots

The serial actor now captures dirty native RON at a two-second interval without
changing the project, history or saved badge. A bounded versioned record uses
raw payload checksum, NOFOLLOW access, exclusive temporary creation, fsync and
atomic publication. It retains one active snapshot. Restart freezes unresolved
data; explicit recovery creates a new saved file and copies Review annotations.
Opening it requires a clean session and uses native installation/fresh history.
Keeping it without opening preserves newer edits, history and the current Save
baseline, then enables new snapshots. Save/Save As track protected saved copies.
Unknown or altered records stay intact; auxiliary failures do not change native
Save acknowledgments. Source media and shared appliance/NAS data are untouched.

115 web tests and 72 JS tests pass, with formatting, web clippy (warnings denied)
and build. Tests cover native snapshot round-trip, project/history preservation,
pending-data freeze, annotation copies, safe dirty-current handling, Save As,
immediate saves after recovery, correct retained-copy association, stale receipts,
existing names, checksum/schema failures and symlinks. UI state tests cover late
status replies, read-only ownership, retained errors/choices and explicit retry.

Real acceptance used two SIGKILLs of the exact owned CPU test process. Each
snapshot receipt stayed identical across its crash. The first recovered edit
returned in a new saved copy while the original project hash stayed unchanged.
The second refused opening over newer dirty edits, then kept the old snapshot
separately while retaining current flags and Undo history. Saving current edits
and restarting produced no pending recovery. Reopening the kept copy verified
its independent older flags. Both recovered native RON files were byte-exact
copies of their captured payloads; all 20 opacity middle keys remained 65,
all Review sidecars matched and all 60 source hashes stayed unchanged.

Visual QA found and fixed a narrow horizontal form inherited from Projects.
The recovery form now uses readable full-width rows and focuses its name. A
separate missing-backing-file test verified recovery while its own saved fixture
was temporarily held; that backing file was restored byte-exact afterward.
Evidence: m7-unsaved-recovery.json and the snapshot/recovery/refusal/kept-current
browser screenshots. Capture timing depends on actor availability, and edits
after the latest snapshot are not crash-durable. Durable command receipts/render
jobs, deployment/service packaging, soak and remaining native parity stay open.

The 9d59a90 binary is deployed on halo2, SHA-256
a03229472396652d5549c74a0e41384b6dd76a483d1923c84e9cd0e367426764.
The tested recovery module matches the embedded asset, the saved shared project
reopened before browser Open, and recovery status is empty for that clean fixture.
Known provenance, exact annotation seed and Favorite remain intact. CPU/lavapipe,
two workers, no DRI/KFD handles and no hardware-lock probe/acquisition are
verified in m7-halo2-unsaved-recovery.json. No other agent's process or GPU slot
was used by this deployment.

## M5 â€” native color range and saturation acceptance

The existing ColorCorrection adapter exposes the same native ShadowsSat,
MidtonesSat, HighlightsSat, global Saturation, LowRange and HighRange controls
as the desktop grade panel, including native keyframes. The parity row was
stale and is now verified rather than reimplemented. Actual browser acceptance
on a separate synthetic montage copy set all six defaults, verified exact Undo
and Redo of HighRange, wrote two LowRange keys and a Saturation key, and checked
native evaluation at the intermediate timeline frame. LowRange interpolated
from 0.25 to 0.4 as 0.325 at frame 12. Save/Open and an owned CPU-service restart
retained all values and animation with fresh history. All 60 media hashes and
the original saved project stayed unchanged. This is CPU/lavapipe evidence;
no shared GPU slot was acquired.

Visual QA also fixed numeric Inspector rows whose two-column labels overlapped
their action buttons at the normal narrow panel width. Labels and inputs now
share their own full-width row, with actions below. The updated binary was
built and visually checked after restart. Evidence: m5-color-ranges.json and
m5-color-ranges-browser.png. No editing/DSP semantics changed in this increment.

## M5 â€” bounded native audio audition for Program and Source

Audio scrub now opts in to an 80 ms native audio fragment after a completed
timeline seek or a Source frame step. The server uses `audio_render::render_offline`
on a snapshot, preserving native gain, mute/solo, fades, inserts, normalization
and compound mixing. Source audition uses an isolated native source timeline,
so timeline effects and mute do not alter its sound. Root-scoped media descriptors
are pinned and identities checked before/after rendering; Program history and
source membership are rechecked before sending output. One CPU worker, no queued
render, a five-second cancellation budget and a fixed 15,404-byte PCM WAV keep
this independent of GPU ownership. Browser playback uses Web Audio only as an
output device. It debounces seeks and discards responses after a newer gesture,
document change, opt-out or playback start; no HTTP runs on pointer movement.

116 web Rust tests and 77 JavaScript tests pass, with web clippy warnings denied,
formatting and build. Native acceptance covers source-independent gain, mute,
unchanged project contents, cancellation and changed files. Actual HTTP fragments
on the synthetic montage measured 660.02 Hz and 879.91 Hz, exact silence in the
gap and with the track muted, and unchanged native session data/source hashes.
Frame/epoch/generation refusal paths were checked. Local fragment requests took
about 3â€“13 ms for this tiny fixture; this is not a general latency guarantee.
The actual browser reached its running audio output path in Program and Source.
Physical loudspeaker output was not measured. Continuous Source pointer scrub
and native fast-forward audio remain open.

Visual acceptance also corrected the Source frame readout/mark quantization for
microsecond media clocks and hides workspace editing tools and timeline-only
Color scopes when viewing an original Source. Program restores those controls.
This keeps the Source video visible at the normal narrow layout.
Evidence: m5-audio-scrub.json, m5-audio-scrub-program.png and
m5-audio-scrub-source.png. halo2 deployment follows after this local acceptance;
no GPU slot or inference process has been used.

The accepted audio build plus narrow-transport wrapping is deployed on halo2
from 4fc96b6, SHA-256
3f3c1d925f2480cb7264cc42c4c34d439be7d5774b122f4adf13131f316d442e.
Embedded audition/Source/CSS hashes match local sources. The saved shared-library
fixture reopened with its exact seed and Favorite annotation, native silent
Program audio returned 15,404 bytes and the still source correctly refused audio.
The browser reached the audio output path while the project stayed Saved.
CPU/lavapipe, two workers, no DRI/KFD handles and no lock probe/acquisition are
verified in m5-halo2-audio-scrub.json/browser.png. Transport wrapping was visually
checked in the narrower main editor panel as well as the local editing layout.

Source native-control scrubbing now also auditions after pointer release or a
settled keyboard seek. Pointer seeking only marks a pending fragment; release
coalesces the final position, while cancellation/focus loss, playback and inactive
media suppress output. The request uses the same source frame as the readout and
In mark. 80 JavaScript tests pass, including several seeks during one held pointer,
late completion, cancellation and playing/hidden Source refusal. Actual browser
acceptance dragged the paused Source bar from zero to 1.37181 seconds, showed
Source 00:00:01:11 and reached Native audio Â· 80 ms with the native project Saved.
The audio scrub parity row is now complete for the required release-based web
interaction. Evidence: m5-source-pointer-scrub.png and m5-audio-scrub.json.

The 5586798 Source-pointer build is deployed on halo2, SHA-256
11aab00407571166ab7494e074bf47d4be4cdbde6d7a4642f17aa18143eae666.
The embedded module hash, saved shared project, exact provenance seed, Favorite,
native silent fragment and CPU-only isolation were checked again in
m5-halo2-audio-scrub.json. No hardware lock was probed or acquired.

## M4 â€” close stale Source range and clip-disable ledger entries

The Source In/Out row still referred to a missing dual-frame Slip viewer despite
the later native-slip acceptance. The ledger now links that evidence together
with native exclusive-bound insertion tests and the corrected Source frame/mark
acceptance. Long-media proxy limits remain tracked under Source viewer/Slip.
The marker entry now names its actual outstanding pointer-move interaction.

Clip Disable/Enable also had the unrelated old Slip note. Actual acceptance on
a separate synthetic montage copy disabled both linked video/audio clips in one
ToggleClipsDisabled Undo entry, returned a completely black native composed frame,
and retained IDs/start/duration/media. Undo restored the exact original preview
hash. Redo followed by explicit Enable restored that hash again. Save/Open retained
enabled flags with fresh history. The saved-file comparison found only the native
compound content hash and next-compound-generation advancing from 119 to 123;
all other saved lines match the source project. These invalidation counters are
preserved by native Undo/Redo. The core command is unchanged. Evidence:
m4-clip-disable.json and m4-clip-disable-browser.png. Rendering was CPU/lavapipe;
no hardware acceptance is implied by this check.

## M5 â€” pitch-preserving 2x/4x/8x Source and Program transport

The transport Speed control now supports 1x/2x/4x/8x. Fast audio renders through
the shared native mixer and `vv_audio::stretch_samples`; it retains the desktop's
2/4/8-second window growth and padded last window, with output trimmed to a
validated playback end. Root media descriptors are pinned, source versions bind
successive windows, and snapshot generation/revision/source checks reject stale
work. A single CPU audio worker, a five-second budget and fixed window sizes bound
work. Native PCM is scheduled in the browser with at most two buffers plus one
request, with an audio clock synchronizing the prepared video. Web Audio only
routes output/volume; it does not implement timeline mixing or stretching.

Pause, seek, source/document change and preparation cancellation discard old
output. Returning to 1x restores ordinary media audio with existing mute/volume.
Video EOF waits for the queued native audio completion event, with a bounded
failure path; it does not cut the tail based on a guessed wall-clock delay.
Voiceover forces composed playback to 1x and retains capture on external rate
changes. Native browser rate menus are hidden in favor of the explicit transport.

117 web Rust tests and 86 JavaScript tests pass; formatting, web clippy warnings
denied and build pass. Native tests cover pitch at all three tempos, exact output
lengths, short tails, explicit range ends, stale source versions, canceled/changed
files and unchanged project state. Client tests cover asynchronous media events,
bounded buffering, stale responses, routing restoration, cancel and audio EOF.
CPU contention at startup now briefly retries only RENDER_BUSY before output is
created; GPU_BUSY still returns immediately and cancellation never starts work.

Actual browser acceptance played a six-second Source and the complete 60-second,
20-shot composed montage at each tempo. All six runs completed their audio tails;
Source used two windows, Program nine. Maximum measured software audio/video-clock
drift was below 27 ms on Source and 19 ms on Program. Backend tone windows stayed
near 660 Hz while output durations divided by 2/4/8. Live Source 2x-to-4x-to-1x
changes retained playback, volume and mute. Stop returned a current native frame
and restored Color tools/scopes. Movie playback temporarily hides those stopped
tools to retain a readable picture at the smaller editing layout. Source rate
readout now shows its actual FPS. Physical loudspeaker loopback was not measured.

The saved native project hash, history, all 60 source hashes and Review annotations
remained unchanged. Evidence: m5-native-fast-audio-windows.json,
m5-fast-transport-browser.json and the fast Source/Program screenshots. This is
CPU/lavapipe acceptance; existing longer-source/program bounds and full hardware
qualification remain on their separate parity rows. No inference process, shared
GPU slot, AMD kernel driver or ROCm configuration was touched.

The aa44bfa transport build is deployed on halo2, SHA-256
e564688e0bbfe96d22992e62fb4102c28bcf2168680033764dc56af66992bd82.
The native runtime returned the expected silent 2x/4x/8x windows on its saved
shared-image fixture, bound the input version, refused still-source audio and
served matching client asset hashes. The browser completed the five-second
composed preview at 8x with both audio windows completed and clock drift below
26 ms, then displayed live 2x playback. Native project/source hash, exact seed
and Favorite remain intact. CPU/lavapipe, two workers, no DRI/KFD handles and no
shared hardware-lock probe/acquisition are recorded in m5-halo2-fast-transport.json
and m5-halo2-fast-transport-browser.png. No shared archive content was modified.

## M3b/M5 â€” cache ruler and reusable composed movies

The timeline ruler now displays actual cached composed frames in violet and
ready composed movie ranges in green, with counts and a footer legend. Native
telemetry filters epoch, generation, timeline, revision, requested width and
input identities; scope/analysis images, source proxies and exports are excluded.
It refreshes after completed seeks, preparation and Stop without rendering or
acquiring GPU ownership. The existing eight-entry/16 MiB frame cache now also
binds source identities on lookup and insertion.

Stop/seek retains one movie reference. Play preflights its native status, then
seeks relative to the prepared range. Backend preparation also reuses containing
ready ranges, including after a browser reload. Replies expose their actual
range, which binds subsequent URLs and clock conversion. Failed validation,
eviction, source/composition changes and late canceled replies cannot resume
obsolete output. Existing bounded media-job eviction remains authoritative.

118 web Rust tests and 89 JavaScript tests pass; formatting, clippy with warnings
denied and build pass. Actual CPU/lavapipe acceptance prepared a 60-second,
20-shot movie once, stopped it, sought within it, resumed it, reloaded the browser
and resumed another internal seek. Every path reused the same native job ID and
movie SHA-256; after reload the media clock started within one second of the
requested frame. Stale cache queries were refused and other widths were isolated.
The saved project, all 60 source hashes, history and Review annotations remained
unchanged. Evidence: m5-preview-cache.json, m5-preview-cache-ruler.png and
m5-preview-cache-reuse.png. This closes cache_ruler_bar within the existing
bounded preview strategy; longer-source/movie support and hardware codec
qualification remain on their separate rows. No inference resource was touched.

The f5c76e0 build is deployed on halo2 with SHA-256
0c929ef6cc9df3c3b4aeb61d72ee0516faff3aa82a6f64acaccd7e0b474bfb7e.
Actual native and browser acceptance reused its shared-image movie after a seek
and again through the retained-reference preflight. Stop refreshed exact-frame
telemetry. The same job ID, embedded asset hashes, exact provenance seed,
Favorite, source hash, saved session and CPU-only isolation are recorded in
m5-halo2-preview-cache.json and m5-halo2-preview-cache-browser.png. No shared
hardware-lock probe/acquisition or archive write occurred.

## M5 â€” native audio window meters and insert spectra

Audio workspace, Mixer and Commands now open a nonmodal audio inspection window.
It displays post-fader stereo peaks for audio tracks/master, native master FFT,
before/after EQ or compressor spectra and three-band gain reduction. Each reading
names its Program frame and 85 ms window. Live inspection allows one request in
flight and follows playback at most every 250 ms; close, seek, source/document
change and cancellation suppress obsolete output. The window includes the same
Play/Cancel/Pause action and progress as the main transport.

The session renderer exposes its existing native metered mixer through the same
streaming source, normalization and effect-state path. Existing render callers
retain their unmetered path. A multi-chunk test with EQ, compression, resampling,
varispeed and pitch correction produces byte-identical PCM with metering enabled.
Pinned source identities, snapshot checks, a single CPU audio worker and the
existing five-second cancellation budget cover inspection. No browser DSP or
GPU work is added. These are independent mix windows: dynamic processors start
afresh, peaks between requests are not held, and browser/device volume is
excluded. Continuous output-stream metering remains a parity gap.

118 web Rust tests and 100 session tests pass; one existing manual precision
benchmark is ignored. All 92 JavaScript tests, formatting, web/session clippy
with warnings denied, native GUI test compilation and web build pass. Actual
synthetic acceptance found native peak bins at 656.25/878.90625 Hz for 660/880 Hz
sources, exact gap silence, a 12 dB EQ boost and about 11.1 dB middle-band gain
reduction. The browser displayed both insert spectra, live advancing readings,
stereo levels and negative infinity in the gap. Save/process restart retained
identical project/annotation hashes, fresh history and exactly identical native
meter responses. All 60 original source hashes and the original project remain
unchanged. Evidence: m5-native-audio-meters.json and the EQ, compressor, live,
silence and fast meter screenshots.

Combined acceptance exposed an initial-seek race in cached fast playback. Program
Play now waits for metadata and seek completion; canceled waits cannot autoplay.
Actual full 60-second and internally sought cached 8x playback both completed all
nine native audio windows with live inspection enabled; maximum audio/video-clock
drift stayed below 13 ms. The earlier failed run is retained in the evidence as
the regression trigger. This fixes the cached fast-transport regression without
claiming continuous output meters or physical audio-loopback qualification.

The a55eb58 build is deployed on halo2, SHA-256
051dbeed370eea43385b6d5b827f7b6d6341f2bb9b1436df3bec44b27c38c44d.
Commands opened its native meter window on the saved shared-image fixture;
stereo silence, 2049 native spectrum bins, stale/missing-insert refusal and
matching embedded assets were verified. A nonzero seek reused its existing
five-second movie at 8x with both audio windows completed and clock drift below
14 ms. Exact seed, Favorite, source hash, saved session and CPU-only isolation
remain intact. Evidence: m5-halo2-audio-meters.json and its browser screenshot.
No shared hardware lock, inference process or archive content was touched.

## M3/M7 â€” export duration independent of Program preview windows

Export now accepts any valid exclusive-out range inside the captured timeline;
the five-minute duration check applies only to Program preview preparation.
The existing streaming native pipeline, ten-minute processing deadline, 512 MiB
output cap, bounded job queue/cache, cancellation and immutable snapshot remain
authoritative. Native normalization analysis honors a nonzero export CPU thread
budget; the original desktop's automatic thread policy stays unchanged.

119 web Rust tests, 100 session tests and 92 JavaScript tests pass; one existing
manual precision benchmark is ignored. Formatting, web/session clippy with
warnings denied, native GUI test compilation and build pass. The native/JS range
tests accept long export ranges while preserving preview, bounds and CRF checks.

Actual CPU/lavapipe acceptance exported 8,640 frames at 24 fps from a separate
synthetic project: a 64x36 generated clip and a six-minute 660 Hz WAV. Native
H.264 video and stereo 48 kHz AAC both decode to exactly 360 seconds. Beginning,
middle and end video samples match the native composed reference within four
8-bit RGB levels; decoded audio stays near 660 Hz throughout. The Windows browser
downloaded the 6,052,915-byte MP4 with SHA-256
c4cb58b9921c770e659bc2d5f6f72d2cb669ce3a425acc7f02b391e30c904312,
identical to the native job artifact. A repeat after the CPU-budget change produced
the same bytes. Saved project/session, the synthetic WAV and all 60 existing
source hashes remained unchanged. Evidence: m3-six-minute-export.json and its
browser screenshot. This fixture validates duration, timestamps and download at
64x36; full-resolution performance remains separate. Durable queues and hardware
codec selection are still open. No halo2 hardware resource was acquired.

Remote video-only acceptance also exposed an inaccurate download label: an
enabled audio checkbox announced AAC even when the native exporter omitted it
because no audio track contained clips. The descriptor now exposes audio_present
through the same native condition used by encoding, and the UI names AAC or
silent output accordingly. The six-minute WAV case retains AAC and exactly the
same encoded bytes after this extraction. 119 web tests, 100 session tests,
93 JavaScript tests, clippy, formatting, native GUI compilation and build pass.

The 1bb9927 build is deployed on halo2, SHA-256
f4e1d14f2ff88d295f4145491d2d3d4076c1436e9de8349e9920397ce8411560.
An independent saved copy exported a six-minute 64x36/24 fps generated timeline.
Native probe confirms 8,640 H.264 frames and 360 seconds, with no audio stream
when the audio track is empty. The UI correctly labels this silent; its Windows
download matches the native artifact SHA-256
1a81c9efc2b82fbc398f767ed013ab6900616dc16545943da7f4ee10db01dc59.
The original shared project was reopened afterward with identical project and
Review hashes, original PNG hash, exact seed and Favorite. CPU isolation and no
hardware-lock acquisition are recorded in m3-halo2-six-minute-export.json and
its browser screenshot. Shared archive content and inference were untouched.

## M7 â€” bounded command receipt rotation without editor restart

The hard 4096-command/8 MiB request-fingerprint stop is replaced by a bounded
4096-receipt window with fixed SHA-256 request identities. At capacity the host
rotates a separate command_epoch and retains the boundary receipt. Model/project
epoch, dirty state, history, selection identity and render job identity remain
unchanged. Session/ACK expose the current receipt epoch and the UI sends it on
new commands. Cached matching retries retain their original result; changed
bodies are rejected. Evicted old envelopes are rejected by command_epoch before
engine work, including clipboard/metadata operations without a history advance.
Legacy envelopes without the field work only in the initial receipt epoch.

120 web Rust tests and 93 JavaScript tests pass, with formatting, clippy and build.
The native test performs 5000 copy operations through rotation, preserves the
dirty project and history, rejects the old command and replays the boundary ACK.
Actual HTTP acceptance on an isolated GPU-disabled host applied 5003 commands,
preserved the native project, generation/history, dirty state and saved-file hash,
recovered the boundary receipt and refused both an evicted request and changed
ID reuse. Old lookup returns unknown rather than guessing an outcome. Evidence:
m7-command-receipt-rotation.json. This removes the capacity restart interruption;
durable command acknowledgment and restart recovery remain open. No shared host
hardware or source file was involved.

The browser subsequently acquired the same isolated host in command epoch 1.
Copy applied successfully without moving its playhead, then native Disable/Undo
restored the clip while retaining the pre-existing InsertClips history entry.
The server confirmed epoch 1, the original project epoch, dirty state and Undo
position. m7-command-receipt-rotation-browser.png records the editing UI; preview
is deliberately disabled on this protocol-only fixture.

The same receipt protocol is deployed on halo2 from b5ab90d. Binary SHA-256:
0b77406c1e25d007797288793d4c8d23a9fb47c27c4f2b8f947e09d64faa1063.
The real browser applied Copy in command epoch 0 while the shared-library project
remained Saved with generation 0 and empty history. Project, Review and imported
source hashes, exact seed and Favorite flag were preserved. The service remains
explicit software preview with no hardware handles or GPU-lock acquisition.
Evidence: m7-halo2-command-receipts.json and browser screenshot.

## M7 â€” synced command receipts and acknowledgment checkpoints

Successful command acknowledgments now have a bounded root-local JSONL journal:
4096 successes / 8 MiB, SHA-256 request identities and record checksums, fsync
before confirmation, atomic rotation, no-follow regular files and exclusive root
ownership while the healthy journal is open. Changed/replaced journals are
preserved and reported unavailable. Receipt failure never turns an applied native
operation into a rejected edit. Dirty named projects synchronously publish native
RON recovery before their ACK; the response explicitly distinguishes saved,
recovery-backed and volatile state from receipt persistence. Earlier unresolved
recovery snapshots remain frozen and are not overwritten to satisfy a new ACK.

Retained receipts survive restart with server_restarted=true. Repeated matching
requests return the historical result without engine execution; changed ID reuse
is rejected. New server project epochs reject unknown old envelopes. The UI
warns to check recovery on both immediate lost-response lookup and Reconnect.
Restart still reopens the saved project, offers unsaved state as an explicit new
recovery copy, and starts fresh native Undo/clipboard/transport state. Historical
checkpoint revisions can be superseded or resolved by later edits/Save. Failed
commands, evicted successes, external side-effect transactions and durable render
queues remain outside this guarantee. Torn/corrupt journals are preserved with a
visible persistence notice; recovery and manual Save remain available.

125 web Rust tests and 94 JavaScript tests pass; fmt, clippy and build pass.
An isolated GPU-disabled HTTP host was SIGKILLed 7.46 ms after its edit ACK,
before the periodic autosave interval. Restart retained the exact receipt and
checkpoint; lookup/retry did not replay the edit or change the journal. The real
browser recovered the Solid clip into Durable_receipt_recovered_UI.vvproj, Saved
with a fresh history. Its native RON is byte-identical to the acknowledged
checkpoint, and the original saved file hash is unchanged. Evidence:
m7-durable-command-receipts.json and m7-durable-command-receipts-browser.png.
No shared library mutation or hardware GPU work was performed.

Halo2 acceptance for 223c07d uses binary SHA-256
fd87052ba494ae47c67e3e21dabffe50f4ee855b379f86633fb5cdcb8473a03f.
The real browser applied Copy on the Saved shared-library project, producing a
saved-backed synced receipt. After an owned-service restart the same lookup
returned the original ACK with server_restarted=true; the journal hash was
unchanged and clipboard count correctly reset to zero without replay. Saved
project and Review hashes were identical before/after. The UI reopened normally.
Evidence: m7-halo2-durable-command-receipts.json and browser screenshot. Explicit
software preview remains enabled; no GPU lock, AMD driver or inference work was
involved.

## M4 â€” marker lane gestures and native MoveMarker history

The Canvas now separates ruler ticks, markers and the two native-cache stripes.
Point/range markers can be moved directly, range edges resized, and Alt+drag can
extend a point in either direction. Native-style eight-CSS-pixel snapping checks
both ends of a moving range against clip edges/playhead. Drafts remain local,
with no HTTP during pointer movement. Escape, capture loss and cancellation
remove the ghost without edits. Read-only gestures can seek but cannot commit.
Click seeks to the marker; double-click opens its existing accessible numeric
editor with the matching selection. Editor selection/open state survives the
normal inspector refresh and is scoped to the project/timeline.

The new thin move_marker DTO preserves stored note/color/ID and invokes native
SetMarker::moved, with the existing epoch/generation/revision checks. Invalid or
missing marker ranges are refused; an unchanged range has no history effect.
126 Rust web tests and 96 JavaScript tests pass, with fmt, clippy and build. Tests
include exact u64 marker identity, native metadata/clip preservation, one MoveMarker
Undo, bounds, local drafts, both range edges, Alt extension, cancellation and
read-only behavior.

Actual browser acceptance on the isolated GPU-disabled host moved a point from
6 to 12, moved a 24â€“36 range so its far end snapped to the clip end at 48, resized
the end to 44 and the start to 32. Each release advanced history once, using the
native MoveMarker label. Four Undo restored the original timeline revision;
four Redo restored the final one. Double-click selected marker 1 with start 32,
duration 12, Purple and its original note. Save/process restart preserved the
final revision and both markers with a fresh history. Clip tracks and parent
project hashes are unchanged. Evidence: m4-marker-gestures.json and browser PNG.
The markers parity row is now done. This interaction check needed no renderer,
shared archive mutation or shared hardware GPU.

Halo2 now runs b653fc9, binary SHA-256
bc69432b5db04d8e30a2d2c72a3e3b201fe303a7b8ab616290b123e021efbcd2.
On an explicit Save As copy of the shared-library fixture, the real browser added
a Cyan point marker at 12, dragged it to 24, and saved. The host recorded exactly
AddMarker/MoveMarker at history position 2 and preserved the note/color/ID. The
original shared project was reopened Saved with empty history and no markers.
Its project/Review/source hashes, exact seed and Favorite provenance are unchanged.
The separate marker test copy is retained. Evidence:
m4-halo2-marker-gestures.json and m4-halo2-marker-gestures-browser.png. Renderer
remains software-only with no hardware handles or shared GPU-lock acquisition.

## M4 â€” scalar curve group editing and two-axis view controls

The curve editor now supports box/additive key selection and an accessible native
multi-select, with shared frame/value deltas, pointer group moves and group Delete.
The new edit_curve_keys adapter builds native removal/insertion commands in one
CompositeCommand. It preserves outgoing interpolation and Bezier controls; every
key/destination/value/lock is checked before applying, including overflow and
collisions with unselected keys. Selected origins can be selected destinations.
Zero movement has no Undo effect. There is no browser interpolation/edit engine.

Time/value zoom, time/value pan, wheel/Shift-wheel and Alt/middle-drag pan affect
only local view geometry. Draft moves/boxes stay local until release; Escape and
capture loss cancel. Keyboard Delete is scoped to the curve canvas and deletes
selected keys without reaching the global clip-delete shortcut. Selection survives
successful moves and rejected collisions. View/selection state is scoped to the
project/timeline/clip/parameter and capped at 128 compact state entries; native
samples and clip payloads are not retained in that map.

128 web Rust tests and 99 JavaScript tests pass, with fmt, clippy and build. Actual
browser acceptance on the isolated renderer-disabled host created Hold, explicit
Bezier and EaseInOut opacity keys. A box selected keys 0/10 without changing the
project. A colliding move was refused with native state/history and UI selection
unchanged. Numeric group move produced 5/15, and a real graph drag produced 7/17,
each in one SetKeyframe Undo. Graph-focused Delete removed both selected keys and
kept the clip; one Undo restored them. Two further Undo restored the original
native curve revision and samples, and two Redo restored the final curve. Both
axis zoom/pan controls changed only the displayed viewport, not native history.
Save/process restart preserved exact native keys, interpolation/control values,
samples and timeline revision, with fresh history. Parent saved projects and clip
snapshot hashes are unchanged. Evidence: m4-curve-groups.json and browser PNG.
Cross-parameter linked zoom and RGBA/text/enum key tracks remain open; the ledger
row remains partial. No shared GPU, archive or inference changes were involved.

Halo2 now runs 84ef827, binary SHA-256
01e5b4c58a7e9bf22b3057b0f9d54c88958ec1bd92b563109f2be6bdc38ef7f6.
The real browser created two opacity keys on an explicit shared-library project
copy, selected them through the accessible multi-select and moved both by two
source frames in one native history step. Saved keys are 2/12 with values 20/80
and the original Hold/EaseIn interpolation. This uses the actual 25 fps shared
image source in a 24 fps timeline. The original shared project was then reopened
Saved with fresh history; project/Review/source hashes and exact seed/Favorite
remain unchanged. Evidence: m4-halo2-curve-groups.json and browser PNG. The test
copy is retained. Preview is still explicitly CPU-only; no hardware lock, AMD
driver or inference work was touched.

## M4 â€” native RGBA, text and direction key tracks

The inspector now exposes typed RGBA, title-content and blur-direction key tracks,
including exact source/timeline positions, native interpolation/Bezier controls,
value editing, a time-row Canvas, additive/box selection and group movement/delete.
The thin adapter validates typed values, UTF-8 size, target existence, video track,
locks, bounds and collisions before using native UpsertKeyframe, RemoveKeyframe
and MoveKeyframes. Group moves retain values/interpolation and use the desktop
MoveKeyframes history label. Unselected keys are never silently overwritten.
No interpolation, color processing or typography engine was added in JavaScript.
The API reports truncation after the first 1024 keys; editing requests remain
bounded. Source coordinates avoid a timeline/source round trip.

131 Rust web tests and 101 JavaScript tests pass, with fmt, clippy and build.
Actual browser acceptance created RGBA keys with EaseInOut/explicit Bezier and
moved them to source 2/12; created Horizontal/Vertical blur keys and moved them
by a real pointer group drag to 5/17; and created literal Unicode multiline
text keys, moving them to source 5/25 (timeline 65/85 on the title at frame 60).
Graph-focused Delete kept the title clip; Undo restored both values and their
interpolation. Save/process restart preserved all typed keys, the native curve
revision, prior scalar opacity keys and every parent project hash. An internal
browser restoration interrupted one unsubmitted direction edit; the server and
recovery checkpoint retained the applied RGBA/filter state, and testing resumed
in a fresh tab after the writer lease expired. No blind replay was used.

The same saved fixture was then opened with explicit llvmpipe software preview.
Native composed frames show different RGBA results, a black gap and both literal
text variants. Cached repeats are byte-identical; session/project hashes are
unchanged. CPU preview is explicit, with no DRI/KFD/DXG handles. Evidence:
m4-value-keys.json, m4-value-keys-rgba-browser.png,
m4-value-keys-native-text-browser.png and m4-value-keys-text-browser.png.
Linked zoom and selection across parameter rows remain open.

Responsive acceptance also found that Show inspector did not open the drawer
below 950px. A viewer Inspector button and the command now share the reveal path;
marker double-click also reveals it. Close/open state and focus return were
verified in the actual 707px Codex pane, including Ctrl+K / Show inspector. A
1280x800 desktop viewport also shows the controls and native frame together;
temporary viewport overrides were reset. Title/key text areas now use the full
inspector width. Workspace tooltips identify their actual action. Evidence:
m4-value-keys-drawer-browser.png and the drawer metadata in m4-value-keys.json.
No OS DPI qualification or hardware GPU claim is inferred from these viewports.

### halo2 acceptance without interrupting the live editor

The d4e23f8 binary was staged on halo2, but replacing port 8790 was refused:
the live project had five unsaved MoveClips commands under another writer lease.
That process, history and recovery checkpoint were left untouched. Instead, an
isolated CPU instance on port 8811 uses a separate project root containing only
copies of the saved project, Review sidecar, shared PNG and origin sidecar.
Absolute media paths were rebased only in a derived test fixture; the original
project copies and live files retain their original hashes.

The actual browser added a title at frame 144, created two literal Unicode text
keys, and moved both from source 0/12 to 2/14 with one native MoveKeyframes step.
Save retained Hold interpolation, exact text and native history position 4.
The composed CPU viewer shows the literal text. Original project/Review/source
hashes, exact seed 9007199254740993, Favorite, and the live editor's generation 5
and five unsaved moves remain unchanged. Assets match d4e23f8. No hardware GPU
handles or shared lock were used. Evidence: m4-halo2-value-keys.json and browser
PNG. Port 8790 remains on 84ef827 until its live edits can be preserved through
the editor; staging the newer binary does not mean the main service was upgraded.

## M7 â€” interrupted local CPU soak and remote build limits

The owner reported an unresponsive workstation while local build/test processes
and preview instances were running. Local compilation and the finite backend
soak were stopped. Saved test servers on 8802/8805 were stopped; the dirty 8804
session was preserved. Agent-created halo2 verification tabs were closed.
Further heavy work belongs on halo2 under explicit CPU/memory limits.

The backend soak stopped after 80 samples and 4741 seconds, short of its two-hour
target. Every sampled source hash and native export hash remained consistent;
FD count stayed 16; threads were 14 in 77 samples and 15 in three samples.
RSS grew from 267931648 to 330891264 bytes.
This is interrupted evidence, not a passed two-hour qualification or a browser
memory test. The retained JSON is marked `interrupted`; no local soak was resumed.

A private halo2 build workspace now holds the Rust toolchain, Node runtime and
unpacked multimedia development packages. No system packages were installed or
upgraded. The finite systemd user build unit is constrained to CPUQuota=100%,
MemoryMax=4G, MemorySwapMax=0, one Cargo job, Nice=19 and IOWeight=10. Software
Vulkan is forced for tests. It does not take the hardware GPU lock or modify
the running editor. A running build is not a passed validation result.

## M4 â€” cross-parameter native key selection

The inspector now has a bounded multi-select list combining scalar and typed
RGBA/text/direction rows. It moves, deletes or changes interpolation for keys
from different parameters of one clip through native MoveKeyframes,
RemoveKeyframe and SetKeyframeInterpolation commands. Optional Zoom X/Y linking
includes existing twins at matching source frames; missing twins are ignored.
All keys, locks, frame arithmetic, source bounds and unselected destinations are
validated before mutation. Each action is one Undo; zero movement adds no step.
The list shows at most 2048 advertised keys and reports truncation. Scalar graph
vertical value/default coupling remains separate and open.

135 Rust tests and 103 JavaScript tests pass on halo2, along with fmt, clippy and
build. No heavy local build or render was resumed. The runtime proof uses a
separate CPU instance constrained to one CPU, 2 GiB, low priority and software
Vulkan. The live port 8790 process still retains its five unsaved moves.

Actual browser acceptance selected Zoom X, opacity, RGBA and blur direction;
the existing Zoom Y twin joined the move. Five keys moved by two source frames
without changing their values. One interpolation operation set explicit Bezier
controls on all five. Focused Delete removed the selected keys while retaining
all three clips, even with an empty movement delta. Three Undo operations
restored the original timeline revision and keys. Redo/Save/process restart
retained exact values, interpolation and the saved file hash with fresh history.
A colliding move was rejected with no generation/history change, a visible error
and retained selection. Parent projects and the live shared project, Review,
source hash and exact seed remain unchanged.

Acceptance caught two frontend problems: DOM replacement lost the key-list
focus, and a rejected command's message could be suppressed after refresh.
Both are corrected. Key-list focus returns after mutation/refresh and on error;
Delete stays scoped to the list. The existing curve-editor CSS also constrains
the list to the inspector width. The initial accidental test-copy clip deletion
was undone; native timeline cache counters advanced, while the restored timeline
revision and key values matched the baseline. No byte-identical Undo-save claim
is made for those counters. Evidence: m4-cross-parameter-keys.json and browser PNG.

### Remote backend soak interrupted by global OOM

The eeba038 CPU backend soak on halo2 completed 20 samples, then the kernel
terminated it during a verified global OOM (`CONSTRAINT_NONE`, `global_oom`).
Two unrelated Python processes were also terminated. The private kernel journal
is retained; the committed proof contains aggregate foreign-process counts only.
The own unit reported 312.7M peak memory and 19.174 CPU seconds over 1206.735 wall
seconds. It was limited to one CPU/2 GiB, and no GPU work or driver changes were
used. The own process had about 214 MiB anonymous RSS in the kernel OOM record.

The collected samples retain the source/export hashes and baseline history;
FD count is 16 throughout, with 14 threads in 19 samples and 15 in one. This is
failed qualification, not a passed two-hour test or proof of a backend leak.
Evidence: m7-halo2-backend-soak-oom.json. No automatic restart was attempted.
Further test/build launches require memory headroom and sacrificial OOM priority;
the live editor's process/priority and its unsaved moves remain untouched.

The owner subsequently relayed the ComfyUI agent's report: its persistent backend
test completed one of three requests before global OOM, also losing a foreign
vv-web process. That agent disabled the configuration and will not repeat that
co-residency. This corroborates a shared-host incident; the attribution is a
relayed report, not an independently correlated ComfyUI trace. Venturi's long
soak remains stopped. No foreign service or configuration was changed here.

## M4 â€” linked Zoom properties and scalar curve edits

One browser view setting now links Zoom X/Y across property defaults, playhead
keys, the scalar curve graph and cross-parameter selection. Defaults and paired
playhead keys use existing native commands. Scalar key/group edits prevalidate
both axes before one native composite command; existing missing twins are
ignored, while new paired keys are created together. Time-only groups retain
each axis's values and interpolation. Group value edits couple resulting values
while retaining each axis's outgoing interpolation. Omitted/false link flags
preserve old command receipt serialization.

139 Rust tests, 105 JavaScript tests, fmt, clippy with warnings denied and the
native build pass on halo2. Actual browser acceptance coupled defaults, moved
and edited a Bezier pair, moved two pairs with value deltas, deleted selected
pairs with graph-focused Delete, and added/removed paired playhead keys.
Undo restored the baseline revision and asymmetric original values; Redo,
Save and process restart retained exact native keys, interpolation and file
hashes. An old request receipt also replayed unchanged after restart. Source,
Review and parent project hashes and the live editor's five unsaved moves were
preserved. The isolated process uses one CPU, 2 GiB, software Vulkan and
OOMScoreAdjust=1000. No GPU lock was acquired or probed. Evidence:
m4-linked-zoom.json and m4-linked-zoom-browser.png.

The scalar curve retains keyboard focus after refresh/error so Delete remains
scoped to its keys. Dense-key paging remains open; the bounded first-page key
lists do not yet provide full native key access. This increment does not close
full GUI parity or the failed duration qualification.

## M4 â€” dense native key pages and selection across pages

The inspector now reads explicit pages of up to 256 native keys per parameter.
First/last page bounds and overflowing offsets are validated under the normal
snapshot identity checks. Previous/Next and direct page entry retain accessible
focus, and stale page replies cannot replace a newer inspector request. Property,
filter, mask and title summaries retain at most 16 keys plus the native count;
complete scalar/RGBA/text/direction keys remain reachable through the pages.

Cross-parameter selection retains up to 2048 picks across pages and row filters,
reports selected keys outside the list, and offers an explicit clear action.
The all-parameter list stays bounded; choosing a parameter exposes every key in
that row's current page. Removed/stale picks reject the complete native command.
Curve/value graph selection remains scoped to the displayed page. No browser
interpolation or project format change was introduced.

140 Rust tests and 107 JavaScript tests, fmt, clippy with warnings denied and the
native build pass on halo2. A native fixture contains 2501 Zoom X and 2501 literal
Unicode title keys. Ten read pages expose every key exactly once; the largest
compact reply in this fixture is 128757 bytes. Out-of-range/overflowing pages and
stale snapshots are rejected without changing history.

Actual GUI acceptance moved/edited a Bezier key at source 5000 to 5001, selected
Zoom X source 0 on page 1 and text source 4800 on page 10, and retained both across
page/parameter changes. A colliding move was rejected with unchanged history,
visible error, focus and selection. A valid +1 move and focused keyboard Delete
each used one native history step while retaining all four clips. Undo restored
the original revision and complete key hashes. Redo/Save/process restart retained
the exact saved keys/file hash with fresh history. The CPU viewer displays the
late literal title. One invalid preparation fixture was rejected by the existing
clip-range validation; it remains separate from the accepted v2 fixture.

Evidence: m4-dense-key-pages.json and m4-dense-key-pages-browser.png. The finite
build/fixture jobs and isolated software preview were limited to one CPU, bounded
RAM and OOMScoreAdjust=1000. Parent project/source/Review hashes and the primary
editor's five unsaved moves were preserved. The temporary browser tab was closed.
No hardware lock was acquired/probed and no long soak was resumed. Full hardware,
browser-memory and duration qualification remain open.

## M4 â€” native attribute preset capture/application API

The web adapter now captures the earliest selected video/audio source clips,
including linked members, using the desktop's native v1 preset JSON fields.
Application reuses core Conversion::preset and the existing attribute planner,
including native speed ripple, a trial project and linked-target lock/sync checks.
It remains one ApplyPreset Undo step. Source clip IDs are not used to skip targets
in another project. The desktop GUI and core project format are unchanged.

Three native tests cover 24-to-48 fps conversion, doubled pixel resolution,
Start/End/Stretch keyframe anchors, append filters, exact Undo, duplicate/source
validation, locked targets and linked audio/earliest-video capture. Input guards
reject timing that cannot fit native coordinates and nonfinite converted clip
values before session mutation. An initial project-wide JSON check was replaced
with clip-specific validation after it rejected a valid native project shape.

143 Rust tests, 107 JavaScript tests, fmt, clippy with warnings denied and build
pass on halo2. Actual HTTP acceptance captured a preset from the dense native
fixture, submitted a 437234-byte mutation to a 48 fps/1280x720 target, and verified position
20/40, fade 24, converted Bezier key timing, one ApplyPreset, exact retry receipt,
Undo/Redo, Save and process restart. Stale capture and a non-preset operation on
the 4 MiB apply route were rejected. Malformed timing, floating-point overflow
and a missing audio source were rejected without history/timeline/file changes;
the actor remained responsive. A normal apply/Undo/Save also passed with the
numeric guards enabled. The final Saved file hash and native properties survive
restart with fresh history. The finite test copies retain the original parent,
shared source and Review hashes and the primary editor's five unsaved moves.

Evidence: m4-native-attribute-presets-api.json. The isolated instance remains CPU
only, limited to one CPU/2 GiB with OOMScoreAdjust=1000. No local heavy work,
hardware lock use or long soak was started. This closes the native API adapter;
saved/shared library CRUD, preset GUI, shortcut activation and desktop import
acceptance remain open. Native JSON capture alone is not the completed library.

## M4 â€” saved native presets and explicit shortcut activation

The Presets panel now exposes native attribute preset capture, page/search,
import/export, application, settings changes, previous-settings restore and
recoverable archive/restore. A revision hash protects application and edits.
Import carries raw JSON text to Rust, retaining native IDs above JavaScript's
safe integer range. Library changes do not edit timeline history; application
uses the existing native preset planner and one ApplyPreset Undo step.

The default store is `.presets` under the project root. `--presets-root` selects
an explicit folder shared by cooperating web instances. Regular root-relative
file opens, bounded reads, nonblocking writer locking, atomic publication and
backups preserve existing files on rejected operations. Previous-settings restore
atomically exchanges both versions, so interruption cannot lose the previous
copy between two publications. A successful command ACK remains successful if
the subsequent list/item read fails; the UI asks for Refresh without resubmitting
the acknowledged save/import. Pending list reads are invalidated before writes.

Imported shortcut strings are retained. The user can explicitly activate a
conflict-filtered Ctrl+Alt+Shift+letter subset for the current project/browser
session. Editable controls, open dialogs, repeats, composition, read-only/busy
sessions and empty selections exclude activation. Bindings retain the preset
hash, reject duplicate chords and revoke on project changes or rejected applies.
Unsupported native chords stay visible; shortcut assignment is not implemented.

150 Rust tests and 119 JavaScript tests, fmt, clippy with warnings denied,
native build and changed JavaScript syntax checks pass on halo2. A finite API
fixture verified capture/apply/import retry receipts, native 24-to-48 fps/pixel
conversion, Undo/Redo, library edits without timeline changes, stale rejection,
exact previous/archive restore, native JSON import/export and restart. The
1,179,270-byte stored preset and imported ID 9007199254740993 survive unchanged.
Native shortcut metadata is returned without parsing source IDs in JavaScript.

The two temporary API servers had preview disabled, one CPU, 512 MiB, no swap,
OOMScoreAdjust=1000 and a 90-second runtime cap. Both are stopped. No local build,
browser, GPU initialization/lock or long soak was used. Parent project hashes
and the main editor's generation 5/five unsaved moves were preserved. Evidence:
`evidence/m4-saved-native-presets.json`. Browser acceptance, actual desktop
application import, NAS preset sharing and concurrent desktop/web writes remain
unqualified. The ds4 media-catalog NAS evidence does not qualify preset sharing.

## M4 â€” timeline fades, static viewer handles and neutral multitrack compounds

The timeline now draws draggable fade handles in each clip's top band, leaving
lower edge trim targets and the Slip tool available. Existing fades are visible;
selection/hover reveals zero-fade handles. The draft changes only on the client;
release submits one native SetProperties operation for that clip. Fade behavior
matches desktop: audio and video fades remain independent even for linked clips.
Escape, pointer cancellation/capture loss, wheel or changed session discards the
draft and releases capture. Returning to the original value creates no edit.

The Program viewer's explicit Transform toggle exposes position and corner-scale
handles for a selected active video clip on a current stopped frame. The overlay
uses authoritative source dimensions and evaluated native transform values, with
the desktop's fitted source, crop, flip, pivot and clockwise rotation geometry.
Shift scales independently; normal corner dragging scales proportionally. Only
static affected axes are editable in this increment. Animated affected axes use
the existing inspector controls. The displayed frame identity, property identity
and viewport are checked throughout a gesture; stale frames never accept a move.
Geometry values use native f32 precision, including the minimum scale boundary
and sub-ULP no-op detection. Ghost outlines do not render or mutate media.

The overlay redraws only on invalidation, coalesces animation-frame requests,
and caps its backing canvas at 4,194,304 pixels. Default-off controls, pointer
ownership, Escape/cancel/blur/visibility/resize handling and numeric Inspector
fallback avoid background loops or hidden writes. Real browser/DPI acceptance
remains pending; mock DOM interaction tests are not a visual qualification.

MakeCompound now accepts multiple video/audio tracks when the native planner
can preserve normal compositing and gain-only audio. Linked groups expand before
validation. Muted tracks, audio solo/pan/inserts, adjustment/matte dependencies,
selected non-normal blends, unselected intervening video and boundary-crossing
transitions are refused. Native relative gain compensation, nesting and one-step
Undo/Redo are retained. No core/desktop behavior was changed. Arbitrary bus/effect
preservation and flattening still require native planning work.

154 Rust tests, 137 JavaScript tests, fmt, clippy with warnings denied, native
build and changed JavaScript syntax checks pass on halo2. One new geometry test
initially compared binary floating-point coordinates exactly; it now uses the
existing small numeric tolerance. A finite API fixture verified native source
dimensions, fade and position/scale edits, exact retry ACK, Undo/Redo, a two-video
layer compound and Save/restart. Native unit tests cover four linked video/audio
tracks, relative gains and rejected processing/layer/lock/crossing cases.

Evidence: `evidence/m4-viewer-fades-multitrack.json`. Temporary servers used no
preview/GPU, one CPU, 512 MiB, no swap, OOMScoreAdjust=1000 and 90-second runtime
caps; both are stopped. Parent files and the primary editor's five unsaved moves
were preserved. No local browser/build, hardware probe or long soak was started.
GUI/rendered-equivalence/hardware acceptance remains open; affected ledger rows
remain partial.

## M3/M4 â€” animated native viewer handles and persistent export history

Viewer gestures now support move, scale, rotation, anchor and crop using native
evaluated values. One guarded EditViewerTransform command chooses a static
default edit or native source-frame Linear key per changed axis. Replacing an
existing key matches desktop interpolation behavior; Undo restores the previous
interpolation. Complete crop-pair validation preserves at least one source pixel
per axis. Rotation accumulates full turns and Shift snaps to 15 degrees; Shift
scale remains independent by axis. No pointermove starts rendering or sends HTTP.
Existing current-frame/selection/viewport guards, f32 no-op handling, cancellation
and bounded event-driven overlay drawing remain in force. Mask/path handles and
real GUI/DPI/hardware acceptance remain open.

Exports now retain synchronized manifests and completed output under the project
root's `.exports`, independent of ephemeral Source/Program caches. Saved exports
lists retained jobs across server restarts using their original epoch references.
Recovered running/queued work becomes interrupted, or canceled for a persisted
cancel request; no job automatically restarts. Changed/missing output is refused.
Unreadable history preserves files and blocks exports while editing and previews
remain available. Retention is bounded to 64 jobs and 2 GiB including partials
and 512 MiB reservations per pending job; admission refuses overflow. Automatic
resume, deletion/retention controls, hardware codec selection and arbitrary output
formats remain open. This is persistent history/output with interrupted-job
recovery, rather than a resumable render scheduler.

169 Rust tests, 151 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Finite API qualification verified mixed static/animated edits,
exact Undo/Redo/retry and atomic invalid-crop rejection. A 12-frame 640x360/24 fps
software H.264 export produced 2,375 bytes with the same download SHA after an
owned guarded SIGKILL/restart. Running work interrupted at frame 17; a queued
persisted cancellation recovered as canceled. No automatic rerender occurred;
incorrect epoch references were rejected. Parent project hashes and the primary
editor's five unsaved moves remained unchanged.

Evidence: `evidence/m4-animated-viewer-durable-exports.json`. The proof used one
CPU, 768 MiB, no swap, OOMScoreAdjust=1000 and 120-second runtime caps, with
software Vulkan and no hardware GPU/shared-lock descriptors. No local browser,
build or long soak was started. GUI/hardware acceptance and broader release
qualification remain open; affected capability rows remain partial.

## M3 â€” explicit saved-export discard

Saved terminal exports can be removed through an exact-job confirmation. Fresh
epoch/revision/UUID checks prevent stale targeting. Active jobs, uncertain
metadata and active downloads refuse removal. A durable discard intent precedes
known-file unlinking; directory sync and manifest-last cleanup allow restart to
finish committed removal without replaying renders. Unknown/changed/linked files
are preserved and blocked intents conservatively retain the full output charge.
A bounded high-water scalar prevents discarded IDs from being reused. There is
no recursive cleanup or automatic eviction. A completed discard stays acknowledged
if the subsequent history refresh fails; uncertain outcomes are never reposted
automatically.

175 Rust and 158 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Tests cover download file/HTTP-body lifetime, stale requests,
all cleanup boundaries, foreign-file preservation, quota and ID reuse. A finite
no-GPU API/restart check removed only the preceding fixture's three terminal jobs,
releasing exactly three slots and 2,423 charged bytes. Invalid epoch/revision and
repeated requests preserved remaining files and quota; removed jobs did not
return after restart. All project hashes and the primary editor's five unsaved
moves remained unchanged. Both disposable processes stopped and port 8811 closed.

Evidence: `evidence/m3-export-discard.json`. API checks used one CPU, 512 MiB,
no swap, OOMScoreAdjust=1000 and 60-second runtime caps. Browser confirmation,
real filesystem failure recovery, hardware codecs and full GUI parity remain
unqualified. No local build/browser/render/soak or new export render was started.

## M4 â€” mask viewer handles and explicit Bezier path keys

Rectangle/ellipse masks have native layer-space move, corner/side resize and
rotation gestures. Path masks expose vertices, selected incoming/outgoing
tangents, native outside-edge corner insertion, Alt removal and smooth/corner
double-click. Shift and Alt follow native resize/rotation/tangent behavior.
Current-frame values and paths come from Rust; JavaScript only maps geometry and
drafts a gesture. One native set_clip_masks command chooses constant defaults or
Linear source-frame keys and preserves other masks/effects. Explicit path-key
set/remove controls let users begin animation without changing the default.
Invalid geometry/topology/budgets refuse the entire command. Selected vertices
survive own commits and transient preview refreshes; stale gestures still cancel.

Mask and Transform modes are exclusive, with a revision-bound mask picker and
Inspector selection buttons. The overlay is off by default, capped at 4M backing
pixels and redraws on events only. Pointer movement sends no HTTP; release sends
one command, and Escape/capture loss/viewport or identity changes cancel. Numeric
Inspector controls remain available. Pen drawing and full path-key navigation
remain open.

182 Rust and 177 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Native tests include rate/freeze source-clock behavior and
atomic rejection. Finite no-GPU API checks verify mixed static/animated edits,
Hold-to-Linear replacement, exact single Undo/Redo/retry, no-op history, ellipse
parameters, explicit path keys, vertex/tangent/topology changes, preserved path
defaults and invalid-path atomicity. Save/restart retained identical mask data;
the fixture uses generated media, so freeze remains a native-test result rather
than a live API claim. Served asset hashes match the validated source.

Evidence: `evidence/m4-viewer-mask-handles.json`. Both disposable processes were
stopped and port 8811 closed. Project hashes and the primary editor's five unsaved
moves remained intact. API checks used one CPU, 512 MiB, no swap,
OOMScoreAdjust=1000 and 60-second runtime caps. No GPU, render, export, local
browser/build or soak was started. Browser/DPI/rendered/hardware acceptance stays
open and affected ledger rows remain partial.

## M4 â€” transition duration pointer handles

Existing edge/crossing transitions expose bottom-band duration handles. The full
native crossing payload is included in snapshots; drafts retain kind, direction,
ease and curve. Crossings resize symmetrically with the native odd-frame split,
f32 duration rounding and native limits. Pointer motion stays local; owned
release computes its final position and sends one existing set_transition.
Timeline/viewport/selection/writer changes, Escape and capture/visibility loss
cancel. No-op durations send no command. Fade, Slip, ordinary trim and Alt pan
retain their targets. Transition creation/selection and Alt duplication remain
separate work; tiny/incomplete snapshots use the Inspector fallback.

182 Rust and 195 JavaScript tests, fmt, clippy and native build pass on halo2.
Finite no-GPU API checks verified nondefault edge In/Out and crossing settings,
duration-only changes, unchanged source fields/other timelines, single exact
Undo/Redo/retry, atomic invalid rejection and Save/restart. Served timeline assets
match validated source hashes. Evidence:
`evidence/m4-transition-duration-handles.json`. Both own instances stopped and
port 8811 closed; project hashes and the primary editor's five unsaved moves
remained intact. CPU1/512 MiB/no swap/OOMScoreAdjust=1000/60-second API caps were
used; no render/export/GPU/local browser/build/soak was started. GUI/DPI/rendered
and hardware acceptance remain open; affected ledger rows remain partial.

## M4 â€” exact native speed pointer handles

An explicit Speed handles mode (Ctrl/Cmd+R outside text inputs/dialogs) shows
eligible media endpoints in the upper clip strip. Native snapshots supply the
source span, integer length bounds and pitch flag. JavaScript drafts integer
endpoints and snapping only; Rust computes the exact rational speed and uses
native ResizeTo. One release produces one ClipSpeed Undo step. Escape, stale
identity, viewport/tool/mode/selection changes and capture loss cancel locally.
Known primary overlap stays visibly invalid even for linked selections.

Safe growth refuses overlaps. An unchecked, explicit Overwrite clips control
permits native make-room trim/delete in the same Undo step, and resets on project
change or mode exit. All selected linked media are validated before and after a
cloned native change. Originally shared endpoints must remain exact; locked,
source-capped or unrepresentable linked results reject the whole edit. Foreign
linked overwrite groups must be fully aligned and covered on every member
track. Failure preserves real allocators and history. A no-op after Undo/Redo also
preserves compound media metadata instead of triggering an incidental refresh.
Native percent/pitch/fit Inspector controls remain available, including when
handles are too small.

194 Rust and 213 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Finite API qualification uses a 2375-byte H.264 fixture and
48044-byte silent WAV, fractional timeline FPS, nonzero video source-in and a
linked audio clip with a different original end. It verifies exact endpoints,
safe collision rejection, explicit obstruction trim, shared speed/pitch/group,
one exact Undo/Redo/retry, invalid atomic rejection, no-op, freeze-to-speed,
source/other timeline preservation and Save/restart. Native tests additionally
cover delete, source caps and locked/incomplete foreign groups. Evidence:
`evidence/m4-speed-handles.json`.

Both own instances stop and port 8811 closes; the primary editor and its five
unsaved moves remain intact. API limits are one CPU, 512 MiB, no swap,
OOMScoreAdjust=1000 and 60 seconds per instance. No render/export/GPU/local
browser/build/soak is used. Native strip preset menu, browser/DPI/rendered
playback and hardware acceptance remain open; affected ledger rows stay partial.

## M4 â€” native completed-path pen and full path-key navigation

Draw path uses the existing bounded viewer overlay. Clicks place vertices and
drags pull Bezier tangents; Alt keeps the incoming tangent independent. Clicking
the first vertex after three points or pressing Enter on the focused canvas
submits one complete Path Add. Escape discards the entire draft. Zero to two
vertices stay client-only, preserving the native valid-path contract. The new
mask retains native defaults and layer coordinates. Existing mask editing and
Transform modes remain exclusive; owner-only release, pending suppression,
frame/writer/context/viewport changes and image/visibility loss protect drafts.
No HTTP is sent while placing or dragging vertices. Numeric Inspector controls
remain available. This is the native click/drag pen, not sampled freehand.

Path details now expose strict previous/next destinations and exact-key status
from the full Rust track, filtered to the source interval and mapped by native
timeline_frame_at. The 16-key preview does not limit navigation. Inspector arrows
seek these destinations; the diamond sets the core-evaluated path with Linear
interpolation or removes the exact key. Source-frame animation remains separate
from frozen picture selection. Controls reject stale playheads and identities,
open dialogs, active playback and duplicate submissions; focus is retained on
refresh without taking focus from dialogs. No browser keyframe interpolation is
introduced.

198 Rust and 243 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. The finite API proof creates a complete path with tangents,
preserves an existing Ellipse, verifies exact single Undo/Redo/retry, twenty path
keys beyond the preview, strict neighbours and endpoint boundaries, diamond
set/remove, retained path defaults and atomic invalid creation. A real retimed
video with source offset verifies native mapped key destinations and unchanged
animation navigation when its picture is frozen. Save/restart retains both mask
stacks and all other timelines. Evidence:
`evidence/m4-mask-pen-path-keys.json`.

Disposable API units are stopped and port 8811 is closed. Parent project hashes
and the primary editor's five unsaved moves are preserved. The same one-CPU,
512 MiB, no-swap, OOMScoreAdjust=1000 and 60-second API caps apply. No local
browser/build, render/export, GPU or soak is used. Browser/DPI/rendered/hardware
acceptance remains open; ledger rows stay partial.

## M4 â€” native transition selection, placement and duplication

Clicking the lower marker body selects a canonical edge or left-anchored crossing
and clears clip selection. Both crossing halves identify the same transition.
A dedicated Inspector edits duration, Push direction, ease and curve, or removes
the transition; Delete uses the same native operation. Read-only selection is
supported. Clip selection, playhead-following and timeline/project changes keep
selection intent separate. Idle Escape deselects; active Escape cancels a draft.

Effects offers native Push, CrossDissolve and SmoothCut drags. Rust supplies
complete desktop defaults using timeline FPS, Right direction, native easing and
curve. Destination geometry chooses the nearest eligible video edge within the
native 40-pixel/half-clip zone, creates a crossing at exact adjacency and clamps
only to the native slot duration limit. Alt-drag copies the complete payload;
duration handles retain priority with Alt. Ordinary marker-body drags fall
through to existing move/trim behavior, with safe overlap refusal. Drafts stay
local, recompute at owner release and send one set_transition. Unknown drag
payloads, stale context, invalid targets and writer/capture/viewport changes
refuse or cancel. Replacing an occupied destination requires an unchecked,
explicit option that resets on project change. Identical placements send no RPC.
Numeric Inspector creation remains available as a keyboard alternative and uses
the same native creation defaults.

The native adapter now treats identical payloads and absent removals as no-ops
after eligibility, lock, adjacency and payload validation. No-op calls preserve
redo, generation, revision and compound media hashes, including after Undo/Redo.
No new editing command, dependency or desktop change is introduced.

201 Rust and 275 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Finite API acceptance verifies fractional-FPS defaults,
short crossing clamp, isolated edge creation, complete payload copy/replacement,
source preservation, one exact Undo/Redo/retry, no-op/absent removal after
Undo/Redo, locked no-op refusal and atomic invalid duration/curve rejection.
Save/restart retains exact transitions, other source fields and timelines.
Evidence: `evidence/m4-transition-placement.json`. Geometry, pointer lifecycle,
trusted Effects drag, local selection and Inspector command/DOM behavior were
tested without a browser. Browser/DPI/rendered/optical-flow/hardware acceptance
remains open; transition ledger rows remain partial.

Both own API instances stop and port 8811 closes. Parent file hashes and the
primary editor's five unsaved moves are preserved. API uses one CPU, 512 MiB,
no swap, OOMScoreAdjust=1000 and 60-second instance caps. No local browser/build,
render/export, GPU or soak is started.


## M3 â€” preview cache admission and live media retention

Ephemeral Source/Program admission now reserves the full 512 MiB budget of each
queued/running job against 2 GiB and at most 32 entries, with a 1 GiB scratch
free-space floor after outstanding reservations. Final publication refuses
oversized jobs; native cancellation points check free space. These checks do not
claim an instantaneous filesystem quota over encoder batches or trailers.
Durable export quotas and history remain separate.

Ready status, cache hits and asset opens renew a shared 45-second retention
period. Source renews every ten seconds, including original stills; Program
renews every two seconds, including paused playback. Both loops allow one status
request in flight and isolate obsolete replies/JSON completions from replacement
media. Missing, changed or disconnected jobs stop playback and require reopening.
Obsolete preparation acknowledgments never cancel shared deduplicated jobs.

Active HTTP response bodies hold shared file locks. Reclamation acquires
exclusive locks on all bounded regular files before unlinking anything. Failed
cleanup retains its job and remaining bytes; unknown sizes fail closed. Cleanup
is flat and restricted to the current process cache, without orphan scans.

206 Rust and 304 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Tiny deterministic tests cover reservations, free-space and
publication boundaries, TTL expiry, live HTTP-body protection, partial cleanup,
unknown-size refusal and timer/async ownership failures. Finite API acceptance
prepares two qualities of the existing 2375-byte video using CPU only, verifies
reuse, authorized ready status and byte ranges, continued access to the first
job, stale epoch refusal and exact unchanged saved restart. Evidence:
`evidence/m3-preview-cache-safety.json`. No disk-filling, large-media pressure,
browser, GPU, render/export or soak qualification was run. Long-media Source
segmentation and Program rollover remain open; capability rows stay partial.

Own test units stop and port 8811 closes. Parent files, source media and the
primary editor's five unsaved moves remain intact. The candidate is staged
without restarting that editor.


## M3 â€” foreground Program window continuation

Program continues from the acknowledged movie's actual exclusive end, using one
foreground window of at most five minutes at a time. A preparation pause is
visible; no prefetch or gapless playback is claimed. Explicit continuation at
timeline end returns no range, preserving the final valid playhead. Native
covering-cache ranges retain their real media origin and frame mapping.

Playback intent and attachment ownership are separate from paused media state.
Stop, pause, native seek, document changes and late acknowledgment/status/media
callbacks cannot autoplay a replacement. Fast transport exposes a bounded old
window handoff: queued native audio must actually finish within its existing
250 ms tail deadline before changing query/src. Canceled, failed or incomplete
audio refuses continuation; selected tempo remains intact. Internal fast-video
drift corrections remain separate from user seeking.

206 Rust and 345 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Deterministic tests cover multiple exact windows, final short tails, fractional
FPS, nonzero starts, covering cache, old heartbeats/frame callbacks, metadata and
seek gates, cancellation, storage failure and native audio-tail ownership.
Finite API acceptance serves the embedded assets and verifies unchanged saved
restart and preservation of parent files and the primary dirty editor. It does
not render a long timeline or qualify browser, physical audio, continuous filter
state, GPU or gapless behavior. Source segmentation remains open. Evidence:
`evidence/m3-program-rollover.json`.


## M3 â€” bounded native Source windows and absolute navigation

Main Source prepares explicit windows of at most 60 seconds rather than an
entire long file. Native proxy APIs preserve their legacy full-file entry
points, reuse bounded CPU decoding/encoding, retain CFR held frames across VFR
timestamp holes, rebase output PTS to zero and reject missing requested frames.
Audio crops positioned native chunks with checked rational 48 kHz bounds and
zero-filled gaps. Publication follows final cancellation checks. File probes
can still scan VFR timestamps; general delayed-stream offset parity is open.

The HTTP adapter validates absolute nonempty bounds against full native media
metadata and includes range/quality/epoch/file identity in cache keys. Jobs
expose source_window bounds, total frames, rational FPS and opaque file version.
Main Source verifies metadata and the actual post-seek frame before publishing
its absolute clock. Whole-file slider/numeric seeking, steps, In/Out, timecode,
audition and fast audio use original source coordinates. Natural EOF prepares
one following window with visible waiting; no prefetch or gapless claim. Native
fast-audio pause ownership works with either event-listener order. Late events,
changed metadata, cancellation and AAC padding cannot shift the new window.

Ranged jobs skip whole-source thumbnail and waveform scans. Main does not put
segment peaks into the whole-media timeline asset cache. This leaves full-source
thumbnails/waveforms unavailable through windowed Source until a bounded assets
path is added; it is required remaining work, not full parity. Original stills
and existing legacy Review/Slip callers retain their earlier behavior; those
legacy full-file callers remain limited to ten minutes.

210 vv-web tests, ten filtered native range tests and 390 JavaScript tests pass
on halo2, plus fmt, clippy for vv-web/vv-media with warnings denied and native
build. Both native and web-worker tests encode a real 601-second 16x16 CPU
fixture and produce only its late twelve-frame window, preserving original
bytes. Tests cover sample boundaries, gap/overlap placement, VFR hold, exact
frame counts, cancellation, absolute clocks, whole-file controls, cache/timer
ownership and late events. Finite API acceptance verifies two qualities and a
following nonzero range on the existing tiny source, distinct/reused keys,
authorized status/byte ranges, invalid bounds/DTO rejection, absent whole-source
assets, unchanged source/session/parent files and exact saved restart. Evidence:
`evidence/m3-source-windows.json`.

All compilation/tests/API work ran on halo2 with one CPU, low priority, no swap
and sacrificial OOM scoring; build memory is capped at 4 GiB and finite API at
512 MiB. No local build, test server, browser qualification, GPU, export or soak
was started. Own API units stopped and port 8811 closed; the main editor's five
unsaved moves remain intact. Browser/DPI, large-file pressure/startup performance,
physical/continuous audio and hardware qualification remain open.

## M3 â€” independent full-source thumbnails and waveforms

Windowed Source now requests a separate native full-source analysis job. The
job publishes a thumbnail and streaming waveform without encoding a whole-file
movie. It shares the bounded ephemeral cache, single CPU worker, retention and
file authorization. Accepted foreground preparation preempts running analysis;
failed admission does not cancel existing work. Critical probe metadata and
file identity must match before and after analysis; missing legacy descriptive
file metadata remains compatible. Output is bounded to a 1 MiB PNG and 4 MiB
waveform JSON with at most 65,536 peaks. The waveform retains the actual native
audio duration, including when it differs from video duration.

The client checks epoch/media/file identity, full-source scope, normalized finite
peaks, streamed byte limits and decoded thumbnail memory before publication.
Bitmap and Blob URL ownership is released on stale results, replacement and
eviction. Analysis failures remain visible; Refresh explicitly retries and
window continuation does not repeatedly restart canceled analysis. Per-item
assets remain capped at 16 MiB and the shared browser cache at 16 entries/32 MiB.

215 vv-web tests and 439 JavaScript tests pass on halo2, plus fmt, clippy with
warnings denied and native build. The existing 601-second tiny-video fixture
also obtains a full-source thumbnail without a full movie. Finite API acceptance
uses existing tiny video/audio media to verify typed descriptors, deduplication,
PNG/JSON delivery, absence of an analysis MP4, retained window movies, stale
epoch/DTO rejection, unchanged source/session/parents and exact saved restart.
The temporary units stopped, port 8811 closed, and the main editor retained its
five unsaved moves. Evidence: `evidence/m3-source-assets.json`.

All execution stayed on halo2 with one CPU, low priority, no swap and sacrificial
OOM scoring; build memory was capped at 4 GiB and finite API at 512 MiB. Browser
and DPI interaction, large-media startup/pressure, all audio stream layouts,
physical audio, GPU and soak qualification remain open. This increment does not
change the count of fully accepted capability rows or establish full GUI parity.

## M4 â€” exact native speed strip presets

The speed strip now has separate percentage-menu, close and endpoint hit areas.
The menu offers the native ten presets, an Advanced Inspector entry and per-clip
local hiding. Labels use native speed_percent rather than dividing rounded
durations. Keyboard access uses Shift+F10/Context Menu; arrows, Home/End and
Escape navigate or close the modal, restoring focus. Stale dialog callbacks,
epoch/revision/media/linked-lock/viewport/lease changes and duplicate pending
actions cannot apply to another target. Advanced opens the exact primary clip,
stops transport and initially selects the native Ripple duration policy.
Clipped/narrow strips and restored fade hit regions use the same draw geometry.
Evicting Blob thumbnails also removes their media-card images.

The adapter accepts only the ten native preset values and calls exact native
Rational::from_percent plus SetClipSpeed Resize. Linked media preserve the
primary pitch flag; shrinking leaves a gap. Explicit overwrite uses the same
native make-room composite and locked/foreign-linked guards as endpoint edits.
Cloned native results validate before real mutation. Full-state no-ops preserve
history and compound metadata; same-speed presets can still unfreeze a clip.

220 vv-web tests and 455 JavaScript tests pass on halo2, with fmt, clippy with
warnings denied and native build. The finite API fixture uses the existing tiny
video and audio, fractional timeline FPS, nonzero source-in and linked unequal
durations. It verifies exact 150/200/50 percent, no-op, explicit obstruction trim,
atomic invalid/overlap refusal, native Inspector freeze-frame mapping, unfreeze,
one Undo/Redo/retry, source/other timeline preservation and exact saved restart.
An initial probe wrongly compared a timeline freeze position with a source frame;
the corrected probe uses the native Inspector result and retains the failed
attempt evidence. Evidence: `evidence/m4-speed-presets.json`.

All workloads ran on halo2 with one CPU, low priority, no swap and sacrificial
OOM scoring, 4 GiB build/512 MiB finite API limits. Own units stopped and port
8811 closed; the main editor's five unsaved moves remain intact. Native Ctrl+R
still differs: the web mode toggles all eligible strips, while desktop toggles
selected media. Selection-only visibility, browser/DPI/rendered playback and
hardware qualification remain open. No capability row is promoted to done.

## M4 â€” native selected-only speed-strip visibility and Windows UI acceptance

Ctrl+R and Selected speed handles now collect existing selected media IDs only,
without expanding linked groups for visibility. If all are already visible,
only those IDs are removed; otherwise they are all added. Other clips and
timelines retain their local visibility. Generators/deleted IDs are ignored,
empty selection is a no-op, and project changes clear IDs. The toolbar reflects
the selected media rather than a global mode. Per-clip close/menu hide removes
one ID. Drawing and hit testing require explicit membership; there is no global
fallback. Locked strips are painted with native percentages but have no editing
targets. Visibility changes invalidate pending gestures and menus.

220 Rust and 464 JavaScript tests, fmt, clippy with warnings denied and native
build pass on halo2. Real Windows in-app browser checks at 1280x720 confirm
selected Ctrl+R, no implicit linked visibility, preservation of unselected and
other-timeline strips, per-clip hiding, generator exclusion, keyboard menu,
Escape focus return and Advanced native Ripple/focus. Choosing 125% through the
actual menu updates both linked clips with one ClipSpeed history entry; one UI
Undo restores the exact saved native timeline. Session's dirty flag remains true
after Undo because upstream compares history generation with saved_generation;
the original saved project bytes remain unchanged.

The isolated halo2 API service used one CPU, 512 MiB, no swap, low priority,
sacrificial OOM scoring and a finite runtime, with composition/export disabled.
Its GPU/shared-lock file descriptors were checked absent. The service and its
Windows tunnel stopped; the main editor retains five unsaved MoveClips.
Heavy work remained on halo2; no workstation build/test fleet was started.
Evidence: `evidence/m4-retime-selected-visibility.json` and
`evidence/m4-retime-selected-menu-windows.jpg`.

An unrequested private browser setup on halo2 was abandoned after the owner
clarified that the existing Windows browser must be used. All downloaded browser
binaries, private libraries/package caches and the setup directory were removed;
no system packages or AMD/ROCm drivers were changed. The owner constraint is
recorded in AGENTS.md. Browser pointer-drag, OS scaling, rendered playback,
physical audio and hardware acceptance remain open; the full parity ledger is
still 32 done, 56 partial and two not started.

## M6 - explicit replacement audio stream policies

Replace Take now preserves each affected Audio clip's stream index by default,
or maps all affected Audio clips to an explicitly chosen B stream. Missing
streams refuse the whole native plan before mutation; there is no silent stream
zero fallback. Video clip stream fields stay unchanged. Native plans report
before/after Audio indices and the replacement stream count. Source validation
now includes sample rate, channels and stream count. Strict policy parsing
retains legacy canonical receipt bytes for omitted or explicit Preserve.

Review exposes the native B count, bounds explicit selection, shows each mapping
before confirmation and invalidates obsolete plans on source/settings changes.
B changes, swaps and refresh reset to Preserve. The replacement setting is
separate from audition, which still uses the first source audio stream.

One limited halo2 build passed 271 native core tests, 224 web Rust tests,
472 JavaScript tests, formatting and clippy for both crates with warnings denied.
A 97 KB diagnostic two-stream Matroska was imported by the native service;
one-stream WAV replacement refused preservation and invalid selection, then
explicitly remapped both linked clips to stream zero. One Undo/Redo, retry,
Save and restart preserved exact state and all parent/source hashes.
The existing Windows browser selected stream one of the two-stream source,
previewed both mappings, applied one ReplaceTake and restored the exact timeline
and both previous stream indices with one UI Undo. Only one temporary tab was
used; no browser was installed on halo2. The own finite server and SSH tunnel
were stopped. The primary editor's five unsaved MoveClips remain intact.

Evidence: `evidence/m6-take-audio-streams.json` and
`evidence/m6-take-audio-windows.jpg`. This closes the missing-stream replacement
defect, not the whole Review milestone. Long-source A/B windows, shorter-A clock
continuation, selected-stream audition, frozen/compound policies and physical
audio/hardware acceptance remain open. The completion ledger is unchanged.

## M6 - longest native source leads A/B comparison

Comparison chooses the longest ready playable native duration using exact
rational frame/FPS comparison, with stable A ties. Browser proxy duration and
playback rate do not elect the leader. A shorter A no longer pauses a longer B
at its natural EOF; a shorter B retains the same behavior. Invalid native
timing is shown and excluded from playback. Frame callback tickets prevent a
canceled callback after swap, reopen or close from affecting the new schedule.

The limited halo2 aggregate passed 271 core tests, 224 web Rust tests and
477 JavaScript tests, formatting, clippy and build. Five controller regressions
exercise natural pause/ended in either pane, leader end, exact duration ties,
invalid/still/unready media, rates and canceled callbacks. In the existing
Windows browser, a 0.5-second source A was held while the 5-second B continued
at 1x; after swapping, the long A reached its own end. Both stopped normally.
Native project/history, parent projects and source hashes stayed unchanged;
no GPU or shared-lock descriptors were open. The own finite 512 MiB/one-CPU
server, temporary browser tab and hidden SSH tunnel were stopped. The primary
editor's five unsaved MoveClips remain intact.

Evidence: `evidence/m6-review-longest-clock.json` and
`evidence/m6-review-clock-windows.jpg`. Long-source Review windows, exact native
last-frame hold, selected-stream audition and physical audio remain open.
The parity ledger and overall completion estimate are unchanged.

## M6 - full-source A/B windows and exact native clocks

Review now opens bounded Source windows, exposes absolute native-frame seeks,
and maps synchronized positions through exact rational frame rates. Browser
controls retain their local-window meaning; visible clocks identify the native
frame and exclusive range. Preparation is serialized, both synchronized panes
hold during a window change, and playback resumes only from verified ranges.
Pause, cancellation, source changes, stale context and delayed native events
cannot revive obsolete playback. Independent playback keeps its own clock.

The Windows check exposed a real browser edge case: a video can report ended
at its last decoded frame before its container duration. Calling native Play
there rewinds the proxy to zero. Review now holds an ended follower or advances
an ended leader/independent source to the next exclusive window before Play.
Full-source final-frame hold and intentional replay remain separate branches.

One limited halo2 aggregate passed 271 core, 224 web Rust and 504 JavaScript
tests, formatting, clippy with warnings denied and native build. The existing
Windows browser compared a tiny 601-second 24-fps H.264 video with a sparse
silent 605-second WAV at native 30 fps. It verified initial windows, exact
last-frame start, continuation beyond 60 seconds, Pause and synchronized seek
to 600 seconds. A then held native frame 14423 while B advanced at frame 18054;
both stopped at their exact native final frames. Native job metadata and byte
ranges confirm every requested window is at most 60 seconds; observed assets
were 2,108â€“43,172 bytes. This is functional long-source acceptance, not a
full-resolution throughput or sustained duration benchmark.

The fixture was saved and restarted exactly; the browser comparison did not
change project/history or parent/source hashes. The finite service used one CPU,
512 MiB, no swap, low priority and sacrificial OOM scoring, without GPU/shared
lock descriptors. Its own server, hidden SSH tunnel and single temporary Windows
tab were stopped. No browser was installed and no local build was run. The
primary editor retains its five unsaved MoveClips.

Evidence: `evidence/m6-review-source-windows.json` and
`evidence/m6-review-source-windows.jpg`. Selected-stream audition, frozen/compound
replacement, physical audio, hardware and sustained/full-resolution acceptance
remain open. The parity ledger and completion estimate remain unchanged.

## M6 - independent A/B audition audio streams

Each Review pane now has a separate zero-based native audio stream selector.
Audition changes pause comparison and reload that pane without changing the
timeline, replacement policy or existing replacement plan. Choices persist
through absolute seeks, native EOF windows and retry; take changes, swap and
refresh reset them to zero. Stills, silent sources and unknown native counts
disable the selector. The menu bounds display to 1,024 native stream entries.

Source preparation accepts an optional strict unsigned `audio_stream_index`,
defaults to zero and validates it before cache admission. Default and explicit
zero deduplicate; different indices have distinct keys while retaining the same
file identity. Window descriptors, ready clocks and heartbeat verification bind
the selected index. The existing native media decoder receives the audio ordinal,
uses the returned stream's format and feeds full/ranged proxies and legacy
waveforms consistently. Main Source's omitted-zero behavior remains compatible.
Reentrant reset callbacks and obsolete stream notifications cannot overwrite a
newer attachment or restart playback.

The bounded halo2 aggregate passed 271 core tests, 227 web Rust tests, ten targeted
native browser-proxy tests and 521 JavaScript tests, formatting, clippy with
warnings denied and build. Native tests use video plus two audio ordinals with
different sample rates/channels. A separate 578,057-byte, two-second Matroska
was imported and saved/restarted. Its one-second native proxy outputs measured
440 Hz mono for ordinal zero and 880 Hz stereo for ordinal one, both at 48 kHz;
their bytes and job IDs differ. Negative, unavailable, fractional, boolean,
string and overflowing selections return 422 without project/session mutation.

The existing Windows browser selected the same source in both panes, then used
stream zero for A and stream one for B. Native job descriptors and byte-range
responses confirm separate cached windows; synchronized seek to frame 30 retains
both choices. Replacement stream zero remains independent of B audition stream
one. Swap resets both to zero. Project/history, parent projects and source bytes
remain unchanged. The finite one-CPU, 512 MiB, no-swap service, single temporary
Windows tab and hidden tunnel were stopped; the primary editor retains its five
unsaved MoveClips. No browser installation, local build, GPU or physical playback
was used.

Evidence: `evidence/m6-review-audition-streams.json` and
`evidence/m6-review-audition-streams.jpg`. Frozen/compound replacement policies,
physical audio, hardware and sustained/full-resolution qualification remain
open. The parity ledger and overall completion estimate are unchanged.

## M3 - native encoder and decoder selectors

The Export drawer now offers native encoder/decoder choices with exact quality
ranges, quality direction and codec-specific presets. Opening or refreshing the
drawer reads metadata only. An explicit check button runs the native color
check in an isolated child; hardware remains unqualified until that check
passes in the current server instance. Restart changes the qualification
identity. CPU-only hosts disable hardware. The legacy web x264 CRF18/veryfast
and software-decoder defaults retain their canonical request/receipt bytes.
Changing codec uses native defaults; Vulkan uses QP23 and no preset. Requested
settings and observed encoder/decoder/compositor paths are shown separately.
Encoding never silently falls back; native decoder fallback remains bounded
and is reported.

Preview contexts now hold the shared reservation for their entire residency.
Export/probe handover asks the worker to release its resident context before
nonblocking reservation admission. Native decoder cache references are dropped
after joined providers and before reservation release. The isolated child
inherits the same lock descriptor and keeps its own wall deadline, one allowed
CPU, CPU-time/output limits, sacrificial OOM priority and private temporary
directory. Parent and child require an effective cgroup RAM limit of at most
4 GiB, zero swap and 4 GiB host memory headroom. Existing desktop decoder entry
points retain automatic CPU thread selection; bounded web fallback retains its
thread count across hardware failure and reopen.

The bounded halo2 aggregate passed 271 core, 241 web Rust, ten native proxy,
three bounded-decoder and one device-cache tests, plus 533 JavaScript tests,
formatting, clippy with warnings denied and build. CPU API/restart checks
verified pure catalog reads, strict inputs, disabled hardware refusal, an
explicit native x264 check and identity invalidation without editing projects.

On the R9700, native Vulkan encode/color and decoder/color checks passed. Two
three-frame exports verified legacy x264/software and selected Vulkan/Vulkan;
uncached preview frames immediately handed their resident contexts to export.
A separately held shared reservation refused a forced check with GPU_BUSY,
preserving prior availability. Idle GPU/lock handles were empty.

The existing Windows browser then selected Vulkan for both paths, observed
Start disabled before each explicit check, received QP23/no-preset controls and
submitted a native three-frame export. READY reported actual Vulkan encode,
Vulkan decode and R9700 compositing without CPU fallback. Its HTTP download
decoded to exactly three 640x360 H.264 frames, 0.125 seconds, no audio. A separate
CPU-only GUI check preserved legacy defaults across refresh/reopen and showed
disabled hardware and requested/actual saved-job labels. Each temporary tab was
closed before opening the next. GPU GUI service limits were one CPU, 2 GiB,
zero swap, low I/O priority and OOMScoreAdjust1000. All own services and tunnels
stopped; the main editor still has its five unsaved MoveClips and Undo history.

Evidence: `evidence/m3-native-codec-selectors.json` and its CPU/R9700 screenshots.
The two selector rows are done for the verified native R9700 behavior. Other
GPU vendors, long-source/format combinations and sustained resource qualification
remain separate release work. The broader engineering estimate remains 65â€“70%.

## M4 - modal cancellation of captured duration gestures

Timeline pointer captures cannot begin while a native dialog is open. If a
dialog appears during transition-duration or speed-endpoint capture, the next
move/release cancels the draft and releases capture without submitting an edit.
The transition-placement guard shares the same modal predicate.

Two regressions cover dialogs before capture, before movement and before
release. Each preserves the native duration and creates no command; closing
the dialog permits exactly one ordinary native operation. All 535 JavaScript
tests and the cached native asset build passed on bounded halo2. A finite
CPU-only API served the exact new input asset and preserved project/history
and the primary editor's five unsaved edits. No local build/render, GPU or
additional browser qualification was used. Rust/native source is unchanged
from c4afce9; its Rust/clippy and R9700 results are inherited, not rerun.

Evidence: `evidence/m4-modal-duration-capture.json`. Actual pointer/DPI and
rendered mask/transition qualification remain open. The ledger counts and
overall engineering estimate are unchanged.

## M6 - explicit frozen-take policies and compound target identity

Replace Take now requires an explicit choice for affected frozen clips. Hold B
Source In preserves their complete timeline duration and silence while holding
exactly that native B frame. Animation source clocks, existing speed and selected
attribute policies remain independent of the held picture. Moving linked clips
retain normal duration checks. Unfreeze checks Preserve/Shorten against the
original duration; it never silently trims before making that decision. Omitted
and explicit Reject preserve legacy request fingerprints.

The native plan reports nullable previous/new held frames, and the browser
distinguishes those pictures from animation source ranges. Policy changes and
stale target/source identities invalidate confirmation. A compound wrapper is
explicitly identified and refused without loading an unrelated A source. Its
ordinary child clip can use the existing Replace Take command after opening the
nested timeline; no automatic recursive selection or wrapper replacement is added.

Bounded halo2 validation passed 277 core, 244 web, ten proxy, three bounded
decoder, one cached-device and 542 JavaScript tests, formatting, native build
and clippy with warnings denied for core/media/web/desktop all targets. Before
these edits, the original desktop passed all-target compilation and 26 selected
pure CPU tests: eight decoder policy, twelve settings and six export-dialog
tests. Tests that initialize the app or poll native GPU availability were
excluded. Full workspace runtime, native desktop GUI and GPU qualification are
not claimed: their automatic native probes cannot safely share this host's
inference ownership and resource constraints. Final all-target desktop clippy
does include the new shared core edits.

Finite native API checks verified strict policy/frame/lock refusals, both
policies with one Undo/Redo/retry, source preservation and save/restart. Compound
A/B wrappers are refused atomically; a child replacement restores its original
clip through Undo and leaves the parent intact. The first diagnostic incorrectly
required byte-identical project files after native compound cache invalidation.
Only compound content hashes and next_compound_generation differed. The final
comparison excludes exactly those native cache fields, retains original raw
bytes in the native backup and verifies the reopened saved state and media hashes.

The existing Windows browser verified default refusal, Hold at B frame 3 with
76 frames preserved, changed-policy invalidation, Unfreeze Preserve refusal,
explicit Shorten to nine frames and exact original clip restoration with one
Undo each. Native snapshots independently confirm both results. Compound targets
show an empty A selector and keep replacement disabled after explicitly choosing
ordinary comparison media. No browser installation, local build/test/render or
GPU was used. The sole temporary tab, CPU API and tunnel are stopped; the main
editor still retains its five unsaved MoveClips and Undo history.

Evidence: `evidence/m6-frozen-take-policies.json` and its Windows screenshot.
The broader Replace Take row stays partial pending rendered/hardware acceptance.
Ledger totals and the uncertain 65â€“70% engineering estimate are unchanged.

## M4 - native preset shortcut assignment and cold-open selection

Save/Edit settings now offer explicit Keep, Assign and Remove choices. Assign
uses the complete 117-key native catalog and canonical Ctrl/Shift/Alt order;
native aliases and the special Ctrl++ form normalize to valid desktop strings.
Omission preserves legacy Options/receipt bytes and imported shortcut metadata.
Clear removes it. Invalid actions, fields, nulls, keys and duplicate modifiers
are rejected before a library write. Only the named preset/revision is changed;
other entries never lose shortcuts implicitly. Session-local browser activation
remains a separate, conflict-filtered Enable action.

The new controller regressions found a real cold-open bug: absent selected and
preferred values compared equal before selected.archived was read. The panel
could not select its first item and left Edit disabled. An explicit nonnull
guard fixes that path; a dedicated first-open regression and the original new
assertions now pass. Late catalogs after close/hide/reopen, failed catalog
reads, changed selection/session/preset revision and acknowledged-write refresh
failure preserve the draft and cannot submit a stale mutation.

Bounded halo2 validation passed 277 core, 251 web, ten proxy, three bounded
decoder, one cached-device and 553 JavaScript tests, formatting, build and
all-target clippy including the original desktop. A second sequential CPU-only
job tested a real web-exported preset through the original AttributePreset
parser and Library::open, preserving the full JSON through roundtrip. Its
actual HTTP key catalog matches egui::Key::ALL; every one of 936 key/modifier
combinations passes native Shortcut serde. These two new native tests, desktop
all-target clippy and cargo fmt --all -- --check pass. No GUI or native probes
are invoked by those tests. Full workspace runtime remains unqualified under
shared-host GPU ownership and resource constraints.

Finite API checks cover capture/update retries, omitted Keep, F35 and Plus
canonicalization, explicit removal/previous restore, stale/invalid refusals,
unchanged unrelated legacy metadata, one ApplyPreset/Undo/Redo and saved-state
restart. Library writes preserve project bytes and native timeline history.
Existing unknown imported strings remain preservable but fail the actual
desktop parser as expected; no native compatibility is claimed for them.

The existing Windows browser verifies first-item selection and Edit, assignment
of Ctrl+Shift+F35 disabling an enabled old chord, Remove and exact previous
restore, reassignment to Ctrl+Shift+Alt+D without automatic activation, explicit
Enable, one native ApplyPreset and exact Undo. Input and modal guards create no
edits. Reload retains saved metadata and clears browser activation. Native API
snapshots independently confirm all clip/history outcomes. All own jobs, the
single temporary tab and its tunnel are stopped. The primary editor retains
its five unsaved MoveClips. No browser installation, local build/test/render,
GPU, driver or foreign inference change was used.

Evidence: `evidence/m4-preset-shortcut-settings.json`, its settings/result
screenshots and the two exact exported fixtures under vv-app/src/tests/fixtures.
The broader shared-presets row stays partial: the original drag-to-clip workflow
is still missing, and broader GUI lifecycle/cross-project runtime qualification
is open. A preset folder on the NAS is not an original requirement and is not
used by itself as a completion blocker; no such deployment is claimed. Ledger
totals and the uncertain overall estimate are unchanged.

## M4 - saved preset drag source and timeline drop

The Presets panel now provides an explicit draggable selected-preset button;
the select list and Apply button retain their keyboard workflow. Starting a
drag needs a current writable native timeline but no clip selection. Dropping
on an already selected clip targets the whole selection; otherwise it targets
only that clip, retaining selection. The existing `apply_saved_preset` command
owns linked expansion, native conversion, attribute roles, validation and Undo.

The Canvas resolves actual inset clip bodies beneath trim/fade/speed/transition
handles in CSS coordinates, including transformed bounds and rational FPS.
Headers, ruler, gaps and clipped areas cannot become targets. Local outlines
and literal preset names/counts show linked targets and lock/role errors. Hover
reads only DataTransfer types and never performs HTTP. Release verifies the
owned payload, source revision, epoch/generation, timeline object/revision,
selection, viewport, modal and writer state before one native command. Async
commit blocks a second drop. Escape, cancellation, source changes, hidden
panels, blur, resize, scroll and visibility changes discard the draft. Preset
and transition drag starts cancel each other.

Bounded halo2 validation passes 277 core, 251 web, 10 media-proxy, three decoder,
one cached-device and 575 JavaScript tests, plus fmt, clippy warnings denied
(including native desktop all-targets) and native build. The 22 new JavaScript
cases cover the source controls and timeline controller. One existing Windows
browser tab verified the enabled draggable control without selection, retained
Apply, ZoomX 1 to 1.5 and one Undo restoring every original target field; the
source clip, saved project and preset bytes remained unchanged. Served module
hashes match the tested source. No new environment or browser was installed.

Evidence: `evidence/m4-preset-drag.json` and `evidence/m4-preset-drag.jpg`.
The connected Windows browser exposes DOM-only input and cannot perform native
pointer drag/release; that acceptance and DPI interaction remain open. This
increment does not claim rendered, GPU or cross-project GUI acceptance. The
single temporary tab, tunnel and CPU-only backend were stopped; the primary
editor retains all five unsaved MoveClips. Ledger totals and the uncertain
65-70% engineering estimate are unchanged.

## M4 - native compound entry and ancestor navigation

The native compound workflow is now exposed from the timeline: Open selected
compound, Enter and Canvas double-click enter the child at the picture under
the current playhead. A breadcrumb and Alt+Left return to a selected ancestor.
Rust calls the existing `Clip::picture_frame_at` and `timeline_frame_at`; no
browser-side FPS, trim, speed or freeze arithmetic was introduced. Child entry
is clamped to content. Moving-wrapper return is clamped to the wrapper; frozen,
missing or null wrappers retain the original entry playhead, matching desktop.

The read-only endpoint guards epoch, generation, source revision, current parent
revisions, canonical opaque native IDs, bounded frames and the 16-level path.
It accepts the actual view frame past content end without relaxing preview
frame validation. Ordinary selected clips are ignored, matching-child A/V
wrappers count as one, and locked compounds remain navigable without a lease.
Navigation does not change history, receipts, generation or project bytes.

The client guards source/document identity, frame, selection, viewport, pending
ownership and explicit double-click sources. Direct timeline/Media-pool opens
reset ancestry; parent viewport and surviving selection return with the native
frame. Modal and gesture guards apply in read-only projects too. Review fixed
two integration defects before execution: synchronous Canvas cancellation had
cleared the just-pushed ancestry; button-focused Alt+Left could have reached
the old clip-move binding. Tests model the synchronous install callback order
and reserved back-navigation during blocked gestures.

Bounded halo2 fmt, clippy (native desktop included), build and tests pass:
277 core, 258 web, 10 media-proxy, three decoder, one cached-device and 594
JavaScript tests. Seven new Rust tests and 19 JavaScript cases cover mapping,
strict DTOs, lease-free reads, parent CAS, stale responses, loops/depth,
cancellation and marker/drag compatibility. A finite API fixture verifies
24/30-fps nested entry, 200% speed, offsets, freeze, out-of-content playheads,
removed wrappers, stale parents/generation, path refusal and restart. Its first
attempt incorrectly expected a source frame from `set_freeze.frame`, which is
a timeline frame; corrected fixture expectations pass without implementation
changes. Raw failure evidence and the original disposable root are retained.

The existing Windows browser verified Open, Enter, two nested breadcrumbs,
frame-24 child to frame-123 outer return, frame-18 re-entry, focused-button
Alt+Left and direct-open reset. Undo remained empty, generation stayed zero,
saved project bytes were unchanged and no browser errors were logged. A log
collector escaping error was corrected without rerunning tests or browser
actions. The collector records its separate bounded-reader retry explicitly.

Evidence: `evidence/m4-compound-navigation.json` and its screenshot. Canvas
physical double-click/DPI and nested rendered/GPU equivalence remain open.
Native compound asset storage/import is a distinct remaining gap. No native
Flatten/Uncompound GUI command was found in this source audit, so it is not
used as an unverified native-parity blocker. General mixer/compositing
preservation remains required before expanding the current compound guards.
All own finite jobs, the temporary Windows tab and tunnel are stopped; the
primary editor retains five unsaved MoveClips. Ledger totals and the uncertain
65-70% engineering estimate are unchanged.


## 2026-10-22: full-plan native interaction and ordinary-resolution checkpoint

COMPLETION_PLAN.md now controls the full 90-capability scope. Earlier subjective
percentages and general lossless-compound requirements are superseded. Grouping
can reset bus/compositing context in the original GUI; ffb5ddf exposes that exact
native planner explicitly while preserving the separate conservative mix option.

Selected Title/Solid/Filter and key navigation implementation through bbf0fbb
passed an actual separate Windows montage: distinct titles, selected styling,
Solid keys, linked HD source audio, Save and 408-frame1280x720 H.264/AAC export,
download and natural result EOF. Source/synthetic/performance limits are in
evidence/f3-effects-workflow.json. The original editor retains all five unsaved
moves. The user-delivered port8811 service still runs df50859.

The next source block ffb5ddf adds native compounds, selected-media retiming,
ProjectView memory/persistence, pane scrollbars/native wheel modifiers and the
Normalize unit-boundary correction. Its combined1007-case JavaScript gate found
one ProjectView variable-shadowing defect affecting10 cases; corrected focused
cases pass and the997 unchanged results are reused. All471 web Rust cases, fmt,
Clippy and embedded build pass. Native exact project/PCM grouping oracles and
view history/cache/CAS/save/reopen regressions are included. Integrated browser
qualification remains pending; a shared GPU lock refusal deferred that pass
without affecting foreign workloads. See evidence/f3-native-view-gate.json.

Continuous Program meter state and voiceover handoff remain concrete production
gaps (AUDIO_RUNTIME_GAPS.md). Native paused-edit/Inspector refresh and physical
pointer/DPI/performance/device acceptance remain open. No partial row is closed
merely by these source/component or synthetic output proofs.


### Native compound and Freeze accepted

The integrated eced3ca workflow is recorded in evidence/nativeview-workflow.json.
Actual Windows Canvas double-click at 125% scaling, child/breadcrumb navigation,
linked selected speed/freeze, one native Undo/Redo, saved reopen and a real own
service restart preserve all five timelines, remembered root positions and saved
project bytes. The 392-frame 1280x720 compound export decodes as H.264 and stereo
48 kHz AAC; its Windows download is byte-identical and playback reaches natural EOF.
GPU previews at frames 370 and 380 are identical under native Freeze (source 15)
and different after one Undo. Both compound_clips and freeze_frame now satisfy
their native function/control/persistence/render criteria: 44 done, 46 partial,
2 excluded. Broader 100%/150% DPI, devices, 500-clip performance and M7 remain
global release gates. The df50859 user-delivered port-8811 service still needs
a guarded upgrade.
