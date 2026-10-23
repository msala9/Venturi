# Test strategy and test IDs

## V1 audio acceptance decision — 2026-10-23

The owner accepts audio/mix/effect changes with Program stopped. Qualify the
connected pause/edit/explicit-Play flow: the native command is confirmed once,
the playhead remains, old prepared audio/meters are invalidated, and next Play
uses the updated native DSP. Include a failed/unconfirmed edit, Undo/Redo, Saved
reopen and matching export where affected. Reuse existing DSP/effect coverage.
Uninterrupted audio edits, native continuous PCM cursors and separate video
leases are deferred beyond V1; do not build or qualify that architecture now.
Physical device/recording and other existing capability requirements remain
separate and explicit. No local build/render/test fleet is authorized.

## Active full-plan qualification — 2026-10-23

[COMPLETION_PLAN.md](COMPLETION_PLAN.md) controls F1–F7 full-plan completion.
[DELIVERY_PLAN.md](DELIVERY_PLAN.md) is the accepted workflow baseline. Complete
the missing production behavior of each block before its integrated acceptance.
Reuse prior evidence for unchanged components. Add focused regressions for actual defects;
run required regression/build checks once per coherent code block and one
integrated browser scenario. Repeat checks only after relevant changes/failures.
Do not build or test documentation-only planning changes.

F5 portable Library copies and preset activation (`5a856e4` plus `efd5f59`, halo1/8849): see
`evidence/f5-library-copies-workflow.json` and Library/preset workspace images.
The bounded gate validates 58 native cases (54 reused plus four affected cases)
and 114 client cases, syntax, formatting, all-target Clippy and embedded build.
The final JS-only epoch-refresh correction reuses unchanged native/Clippy results;
its build takes 40.13 seconds, with peak 1,526,898,688 bytes. Native cases cover
readable project copies, legacy names, Unicode collision bounds, full-byte reuse,
foreign collisions, destination replacement/symlink/cancel and untouched old flat
copies. Client cases cover guarded preset Enter/double-click and project-reopen
epoch rebinding without late selection writes. Actual Windows two-asset NAS import,
cached no-op, native Undo/Redo, Source EOF5.184, preset application to Solid 14,
Undo/Redo and Saved reopen pass. Reuse unchanged renderer/audio/export evidence;
no fresh export or physical HTML drag/DPI claim is added. Both F5 rows stay partial;
the next production block is saved-preset permanent Delete.

F5 native Library removal (`139418d`, halo1/8848): see
`evidence/f5-library-delete-workflow.json`. 78 native /75client cases, syntax,
formatting, all-target Clippy and embedded build pass in one bounded halo1 gate.
Affected native store/journal/worker and Host regressions include active/archive/
backup retention, last-reference cleanup, malformed/unmanaged/foreign files,
cancel/stale/32-item bounds, partial removal recovery, version2/legacyv1 refusal
rules, Saved project-copy/history preservation and original retry/restart ACK.
Client cases cover modal selection ownership, exact ready/receipt binding,
hidden-panel Source callback and unknown outcomes without replay. Actual Windows
single/multi Delete/Edit/Cancel/Escape, unchanged Session/Saved bytes and Saved
reopen pass. No permanent browser deletion or destructive CIFS case was run;
temporary Linux native fixtures supply that destructive regression coverage.
Prior editors/files/NAS originals/proxy remain unchanged. No fresh export or
physical/full release acceptance is inferred from this block.

F5 native Library pool/Source (`024a7ee`, halo1/8847): see
`evidence/f5-library-pool-workflow.json`. Ten native /277client cases, main JS
syntax, formatting, all-target Clippy and embedded build pass. Initial failures
were corrected test-only native constructor and valid project-name fixtures.
Actual Windows pre-import Source preserves Saved/generation/pool/Undo; ordered
two-asset import adds roots and an independent child in one Undo without placement.
Strong Source identity stays ready across import and reaches actual EOF afterward;
all-cached import adds no history, native batch Undo/Redo and Saved reopen pass.
Old generation remains a stable job namespace; old epoch is refused after reopen.
Original timelines/effects, three fixed native NAS files, prior editor state,
Saved bytes and proxy are unchanged. Desktop layout is checked, default restored.
Reuse the prior native renderer/701-frame export evidence. No new export, actual
continuous playback during import, physical DPI or release closure is inferred.

F1 command ownership/Selection (`89a7552`, halo1/8846): see
`evidence/f1-command-ownership-workflow.json`. Three native checks /158client
cases, formatting, all-target Clippy and embedded build pass. The initial test-only
Library DOM dataset omission is corrected; passing native cases are reused.
Actual Windows pool Delete/Edit ownership, timeline-only Delete, native Undo,
closed Slip/Compound menu focus and exact Saved reopen pass. Desktop1280x720 and
ordinary viewport are checked. Prior editors/history/originals/proxy remain
unchanged. No fresh export or full physical/release acceptance is inferred.

F1 context actions (`b23e87d`, halo1/8845): see
`evidence/f1-context-workflow.json`. 29 native / 115 client cases, formatting,
all-target Clippy and embedded build pass. JS-only pause/list-popup fixes reuse
unchanged checks and pass syntax/build. Actual Windows targeted color/native
Undo/Redo, grouped speed/native Undo/Redo, marker add/edit, preset capture with
unrelated selection, shared NAS write and read from two Saved projects, stable
playback pause, viewport swatches and Saved reopen pass. Prior Sessions/PIDs/Saved
files and originals/proxy are preserved. Physical Canvas pointer/DPI, actual
crossproject preset Apply, fresh montage export and full F1-F7/M7 remain open.

F3 visual color (`8594968`, halo1/8844): see
`evidence/f3-color-picker-workflow.json`. Two native asset/import cases, 83 client
cases, formatting, all-target Clippy and embedded build pass. The actual internal
popup-scroll defect is corrected with focused 83-case/rebuild evidence; unchanged
native checks are reused. Actual Windows all-five-row edits, title Undo/Redo,
alpha-only and precise one-channel retention, Save As/reopen and bounded native
preview pass. Default and 1280x720 popup accessibility are exercised. Physical
pointer/capture/DPI and native continuous hover preview stay explicit; alpha-zero
latent-color reconstruction is deterministic coverage. No fresh export of this
changed-color project is claimed; reuse the unchanged native pipeline evidence.

F3 Effects/Title (`4ad4ad1`, halo1/8842): see
`evidence/f3-palette-fonts-workflow.json`. 40 native / 111 client cases, formatting,
all-target Clippy and build pass. The JS-only monochrome click correction passes
syntax/embedded rebuild and actual click/Undo/Redo, reusing unchanged checks.
Actual 1280x720 Windows edits/Save/reopen/native 701-frame Full HD export and
29.226-second exported-file EOF pass. Physical HTML drag/DPI and native hover
preview remain explicit; no unchanged renderer/audio/transport matrix is repeated.

F5 shared originals (`dc42d2a`, halo1/8840): **56 distinct native cases /
59 executions** and **11 client cases** (6 top-level plus 5 subcases), formatting,
all-target Clippy and embedded build pass. The first test-only missing Id import
was fixed before the passing second gate. Worker peak is 1,924,485,120 bytes
within 8 CPUs/4 GiB/no swap. Coverage binds approved root/parent/strong identity,
version-qualified import/relink plus provenance, old-ACK/new-grant refusal,
shared requested-source/proxy/Take/clipboard/OTIO reads and unchanged project-only
scans/writes. Existing copy mode and its budget remain separate.

Actual Windows references a 657,278-byte 864x480/audio NAS original without copying
it into the project. Source reaches EOF 5.184 seconds; one linked pair is inserted
at 457 with length 124 while five original clips remain unchanged. Undo/Redo,
Save As/reopen with empty Undo and cached Program terminal frame 580 pass; the
Program player resets after EOF, so ended=true is not inferred. Native 581-frame
1920x1080 export 1792747907497046888 is Ready in 2874.348 ms and browser playback
reaches actual EOF 24.213/ended=true. Final state is Saved/frame 580. NAS bytes/
dev/inode/mtime/ctime, 24 prior Sessions/25 PIDs/15 Saved files/three originals/
shared proxy are preserved. Runtime peak is 529,149,952 bytes. No broader native
raw-path FD-reopen fix or full F4/M7 acceptance is inferred. See
`evidence/f5-shared-originals-workflow.json` and its workspace/export images.

M5 interactive audio graphs (`b6becaf`, preserved halo1/8839): **14 native cases** and
**58 client cases** pass, plus formatting, all-target Clippy and embedded build.
Native filters contain 12 audio cases (including 3 Source-audio cases), one
revision-bound Host query and one API boundary. Client total comprises 40 prior
cases, 8 new top-level graph cases and 10 cancellation subcases. Coverage includes
native coordinates/Q/shape/crossover rules, parameter-only mutation, no RPC
during drag, one release command, no-op/cancel/stale/readonly refusal, native
response ownership and preserved chain/presets/numeric fields. The bounded
8 CPU/4 GiB/no-swap worker peaks at 1,947,037,696 bytes.

Actual Windows graph keyboard changes set EQ band 3 Gain 0 to 0.1 dB/Q to 0.81,
compressor crossover 200 to 201 Hz and mid makeup 0 to 0.1 dB. The six-command
history preserves EQ-before-compressor; Undo removes only the last makeup
change and Redo restores it. Save As/reopen retains exact parameters/PCM with
empty Undo. Native read-only queries yield 128 EQ/241 makeup-only compressor
points; stale generation receives 409 REVISION_CONFLICT with Session unchanged.
Motionless actual pointer clicks remain Saved. Actual OS drag/wheel/reset/
cancel acceptance is not claimed from deterministic tests. No new movie/export
render: reuse unchanged DSP/transport proof in
`evidence/m7-audio-source-fd-workflow.json`. All 23 previous Sessions/24 PIDs/
13 Saved files/three originals/shared proxy movie are preserved. See
`evidence/m5-audio-graphs-workflow.json` and its two workspace images.

M5 compact mixer controls (`a2d1358`, preserved halo1/8838): **40 client cases** pass
across mixer-controls, mixer and audio-presets, including six new top-level
control cases with seven cancellation subcases. The tests cover all 11 native
f32 gain knots, relative drag travel, normalized pan/Shift scaling, release-only
axis writes, keyboard/reset, pending/rejected writes, context/disabled/capture/
resize/hidden cancellation and retention of unrelated numeric drafts.
Formatting, all-target Clippy and embedded build pass. A final CSS-only
Inspector-specificity/Master-alignment correction passes the embedded build;
the unchanged 40 client cases are reused. Worker peak is 1,570,299,904 bytes
within the 8 CPU/4 GiB/no-swap bound.

Actual Windows verification at 1280x720 confirms 84 px aligned strips and
130 px faders, keyboard Master Gain 0 to -0.2 dB and Pan 0 to 0.01, double-click
resets, Undo/Redo and Save As/reopen. Final state is Saved/frame 0 with empty Undo
in `Venturi_Mixer_V1.vvproj`; all 22 previous Sessions/23 PIDs/11 Saved files/
three originals/shared proxy movie are preserved. Actual OS pointer drag,
Shift and cancellation qualification is not claimed from deterministic tests.
No new Program/export render is needed for this UI-only block: reuse the
unchanged native DSP/transport verification in
`evidence/m7-audio-source-fd-workflow.json`. See
`evidence/m5-mixer-controls-workflow.json` and its workspace image.

M7 requested audio sources (`fc2c041`, preserved halo1/8837): **14 cases** pass: 3 audition,
7 frame-source adapter and 4 native audio. Formatting, all-target Clippy and
embedded build pass; no client changes require a new JavaScript gate. The first
test-only file-handle type mismatch was corrected before the terminal pass.
The bounded worker uses at most 8 CPUs/4 GiB/no swap and peaks at 1,976,766,464 bytes.
Coverage includes requested-only audio leases, unsafe-source refusal, strong
restored-mtime witnesses, native nested/Normalize/pitch PCM equality and shared
resolver failures across level-measure threads. Conservative audible metadata
preflight remains; durable composed-movie/export audio defaults are unchanged.

Actual Windows/API verification covers stopped master Gain 0 to -6 dB and native
500 Hz EQ 0 to -12 dB, changed PCM, exact gain-only PCM after Undo, Redo, explicit
Program Play with native insert telemetry and EOF 456 of 457 frames. Save As and
reopen retain the exact EQ PCM and empty Undo. The native 1920x1080/24 fps AAC
export reaches browser EOF at 19.05 seconds. Final state is Saved/frame 0; the
original candidate and 21 prior Sessions/22 PIDs/nine Saved hashes/three
originals/shared proxy movie remain unchanged. This verifies the connected V1
stopped-audio workflow, not live DSP or all F4/M7 acceptance. See
`evidence/m7-audio-source-fd-workflow.json` and its workspace image.

M7 requested original video/still sources (`83ccf82`, preserved halo1/8836):96 distinct
native cases pass (98 executions,two overlapping cases); formatting, all-target
Clippy for vv-web/vv-session and embedded build pass. Five adapter cases exercise
touched-only opens, root/parent/strong-ctime identity, decoder leases, proxy
allowlists and nonblocking unsafe-source refusal. Native resolver cases decode
tiny real moving/still fixtures, retain/release leases, refuse unsafe opens and
preserve existing metadata/audio/clock APIs. Static/movie cache regressions cover
legacy witness absence, approved-root rebinding, native audible closure, covering
dedup and status/asset/telemetry invalidation. Unchanged JavaScript gates are reused.

Actual Windows/API qualification replaces only named copied candidate originals:
cached Program+scopes refuse changed video and stills; restored files return the
same PNGs. A read-only Auto Balance operation does the same after a temporary
native filter edit. A real prepared457-frame movie reaches Ready/browser EOF456;
changing its still causes SOURCE_CHANGED on status/Range and removes its cache
hit, even after bytes are restored with a different ctime. The native filter is
undone, then Saved/reopened; exactly three compound-counter Saved lines advance,
timeline DTOs/file media/view remain and all20 previous Sessions/21 PIDs/eight
Saved hashes match. Final candidate is Saved/frame 0/empty Undo. Runtime peak
296288256 bytes; worker sampled peak1907732480 bytes is not a terminal maximum.
The4GiB/swap0 limit and successful terminal unit are recorded. No new Windows
build, browser install, halo2 or NAS operation. See
`evidence/m7-original-frame-sources-workflow.json`. Requested audio confinement
for existing audition/scrub/fast-window/meters is delivered in fc2c041 above;
broader representative/dense/DPI/physical/M7 gates remain open.

M7 degraded proxy cache (`b588603`, halo1/8835): 14 affected client cases and
21 native proxy cases pass, plus formatting/all-target Clippy/embedded build.
The native HTTP regression covers readable degraded settings, writer/epoch
rejection, acknowledged disable, exact sentinel preservation and no Project/Undo
change. Manager regressions cover latest-ready masking, verified-original lookup
fallback, captured-lease refusal, strict settings/root validation and recovery.
Client regressions cover rejected/unknown/malformed writes, reconciliation locks,
readonly/hidden policy and explicit recovery without optimistic disable/replay.
Actual Windows qualification uses the same binary with a private cache: real
foreign-file error, enable/disable ACK, original Program PNG with proxy-count0,
Full HD original Source/window264, sentinel identity and explicit Refresh.
Final delivery retains the normal shared-cache movie inode/timestamps/SHA256.
All19 prior Sessions/20 PIDs/seven Saved hashes match. Only the disposable private
qualification unit is stopped while Saved with empty Undo. Build peak1924452352
bytes; delivery peak205860864 bytes. No halo2/NAS changes or local heavy tests.
See `evidence/m7-proxy-cache-recovery-workflow.json`. Original requested-source
pinning and validation before cached frame returns remain a separate pending
production block; this gate does not claim broader M7 acceptance.

F2 native Media interactions (`9e00d2c`, halo1/8833):111 affected JavaScript
cases pass; final 30 catalog/menu cases cover the browser findings, including one
new scroll regression. Reuse the 82 unchanged other cases: 112 distinct qualified
client cases, without claiming a fresh 112-case aggregate. All 7 native catalog
cases and the embedded-module MIME case pass; formatting, all-target Clippy and
the final embedded build pass. The native wrapper no-op tests preserve generation
and Redo; mixed batches match the native changed subset and one Undo, malformed
final IDs refuse atomically, and deleting a folder retains direct/deep content.

Actual Windows pointer input verifies five-media replacement marquee, a media
move with one Undo/Redo, and dragging the folder name button without changing
media selection. Context group/target semantics, immediate duplicate, inline
long-name rename on the inactive copy and Saved native reopen pass. Preserve the
original Program timeline DTO/revision and five clips exactly. The native graph
and Saved bytes match across reopen, with Program 1/frame 0 and empty history.
All 18 prior Sessions, 19 service PIDs and 6 Saved hashes match. Final editor peak
295919616 bytes remains below 4 GiB/no-swap. No NAS writes, browser installation,
Windows heavy qualification or halo2 work. Reuse unchanged Program/export evidence.
See `evidence/f2-media-interactions-workflow.json`; broader M7 acceptance remains.

F2 native proxies (`a95b4a6`, halo1/8830):90 distinct affected native cases pass
(72 web,18 cross-native), plus7 new proxy client cases and the final23 affected
proxy/catalog cases. The prior1296-case aggregate client result is reused;
there is no claim of a fresh full1303-case run after the fixture correction.
Formatting, all-target Clippy and the final embedded binary pass. An earlier
cold feature combination hit its180-second build deadline; matching package
feature unification completed the cross-native gate. Final style-only fixes
reuse the native behavior results. Build peak2663776256 bytes stays below 4 GiB.

The integrated Windows pass uses the Saved457-frame Full HD video/still/two-stream
audio montage. Native generation parks at1/264 frames across two observations,
then resumes the same job to264. Source receives original1920x1080 while disabled
and medium960x540 when enabled. Static Program reports one selected proxy;
composed preview reports proxy mode and reaches EOF456. Disabling reports zero
proxy selections. Reenable/client reload retains enabled/medium/unpaused and the
same ready job. The457-frame Full HD H.264/AAC export is byte-identical to the
preceding original-media export and plays to19.05-second file EOF without error.
The final native Session, project Saved bytes and empty Undo equal the baseline;
15 old Sessions/PIDs and ds4 remain unchanged. See
`evidence/f2-native-proxies-workflow.json` and Paused/Ready screenshots.

The initial a95b4a6 block above used an ephemeral cache. Its persistence gap is
closed for normal server restart and valid interrupted intents in6764b2d/8831:
50 distinct affected native cases pass (18 proxy-related and33 Source executions,
with one overlapping case). Six new store regressions use tiny injected caps,
covering durable records, hashed quality/source keys, cross-open locks/leases,
valid-intent recovery, count/byte eviction, unknown-file preservation and replaced
artifact/manifest identities. Manager tests cover paused cache reuse with new
project epoch/media ID, current path approval across nested roots/hardlinks and
foreground-aware contention retry. Formatting/all-target Clippy/build pass.
Frontend and unchanged native pipeline checks are reused.

Windows verifies a real isolated-service PID change with Saved/empty Undo,
Medium Ready recovery while generation remains paused, identical proxy inode/
timestamps/SHA256, original model/metadata/view/Saved bytes and Program EOF456.
The457-frame Full HD/AAC export matches earlier original exports byte for byte
and plays to19.05-second file EOF. Final preferences enabled/medium/unpaused,
frame 0 and empty history remain. All16 earlier Sessions and17 PIDs including ds4
are equal; four earlier Saved project hashes are unchanged. See
`evidence/f2-native-proxies-durable-workflow.json`. This accepts
`proxy_quality_settings`/TS-018; broader Source/physical/dense/long4K/M7 work stays
open. Malformed/foreign files or a pre-intent crash require explicit intervention;
arbitrary-power-loss automatic recovery is not claimed. Original frame-source
FD pinning remains a separate M7 production task.

F2 media presentation (`e204001`, halo1/8829):1296 serial client cases and9
native cases pass (snapshot5, project placement1, prepared project media HTTP1,
health/assets1 and module MIME1), plus formatting/all-target Clippy/build.
Windows checks native default Details, List23px/no images, Grid folders and
breadcrumbs/global search, tree matching ancestors, duration/Shift visible order,
collapse pruning, pointer/keyboard column resize/reset, reused-file import reveal
and layout persistence on reload. Native Session, Saved bytes and empty history
are exactly equal before/after. Fourteen prior Sessions/PIDs and ds4 are unchanged.
See `evidence/f2-media-presentation-workflow.json`. Renderer/export code is
unchanged; reuse the preceding457-frame Full HD/AAC export and import/recovery
proof. No new export, acoustic, server-restart or whole-pool interaction acceptance
is claimed. Next production block is native proxy management and Program inputs.

F2 project import/recovery (`e41e9cc`, halo1/8828):83 affected native cases pass
across new project jobs/HTTP/legacy coordination and existing jobs, catalog,
approval and file guards;559 native cases exist in the compiled test binary.
Formatting, all-target Clippy and build pass. The initial serial client gate
passes1283/1291; eight obsolete flat-panel fixtures are adapted without production
changes and pass separately. Two actual-browser caption-reset fixes then pass116
affected client cases and the embedded build; other client/native results are
reused. Do not describe these as a new full1291 run after the caption fixes.
Windows verifies nested3-file4-folder1-error import, scan-empty pruning, one
Undo/Redo, selected whole-source montage, two missing-file recoveries, exact
ByName shallow match/online skip, explicit renamed still, stable clip ranges,
Program EOF456 and457-frame1920×1080 H.264/AAC exported-file EOF. Final delivery
opens an isolated Saved copy, verifies three online skips and path reuse without
Undo or saved-byte changes, clears captions on reopening and survives client
reload. The original8827 live four-command Undo chain remains intact; opening
the isolated final copy intentionally starts fresh history. See
`evidence/f2-project-media-workflow.json`. No new native renderer matrix is needed
for the caption-only fix. Device/dense/DPI/long4K and full M7 remain open.

F2 project pool (`5d8d15d`, halo1/8826):1270 JavaScript cases pass in one serial
Node run, justified by adding a fourth shared timeline drag owner and changing
catalog selection/keyboard order. Ten affected native cases cover new placement
and Host receipt replay, existing Library/marked Source and embedded assets.
Formatting, all-target Clippy and build pass. The existing Windows tab imports
moving Full HD video, a Full HD still and two-stream audio, verifies safe search
pruning/sort selection, drags them in panel order, exercises one Undo/Redo and
keyboard insertion, then Save/client reload, Program EOF456 and457-frame Full
HD/AAC file EOF. See `evidence/f2-project-pool-workflow.json`. Unit admission
cases do not qualify256-file hardware pressure. No unchanged full renderer
matrix was repeated; physical/dense/DPI/long4K acceptance remains open.

F2 Source lookahead (`4f94773`, halo1/8825):189 focused Source/window/audio/waveform/assets
and fast-transport client cases pass, including ready adoption, pending EOF
wait, selected/all audio identity, exact version/range/TTL revalidation,
speculative failure without retries, cancellation and fast-tail ownership.
The embedded build passes. Native code is unchanged; reuse its existing
formatting/Clippy/native gates. A ready next job is not proof of gapless or
physical audio. The uninterrupted Windows67s/two-stream1x run adopts the exact
prepared1800–2011 job after0–1800 and reaches originalEOF2010 without another
Play. Saved project bytes, native media/timelines, history and Program view
stay unchanged. Tail playback was not sampled before EOF; acoustic gap duration
and physical output remain open. See `evidence/f2-source-lookahead-workflow.json`.

F2 audio Source waveform (`f1fd010`, halo1/8824):96 affected client cases,
two native embedded-module/Host cases, formatting, all-target Clippy and build
pass. Final67 assets cases/build cover version identity through the real loader,
interrupted visible demand, late first-paint demand and manual failure/Refresh
policy. Reuse the other unchanged native547-case and client gates; no full
renderer matrix or native suite was repeated. The actual Windows scenario uses
a67.021-second two-stream AAC48-kHz file at native30fps, loads both full-source
waveforms without Refresh, clicks to1889 after60seconds, replays from2010 to0,
drags marks30–120 into two native72-frame audio clips at24fps, exercises one
Undo/Redo, Save/client reload, Program EOF71 and Full HD/AAC export EOF.
One finite decoded-file level check proves non-silent AAC; it does not qualify
physical audio.128-stream reachability/virtualization and the16-MiB canvas cap
are deterministic client cases, not a128-stream hardware pressure claim.
See `evidence/f2-source-waveform-workflow.json`. Speculative Source continuity,
physical output, representative large-file pressure and M7 remain open.

F2 Source placement (`9ecf29d`, halo1/8822): the initial full client run passes
1234/1235 cases; the remaining baseline fake-window oracle discarded capture
listeners. Its faithful multiple-listener harness passes44 focused cases.
The native gate passes546/547 cases; the remaining new oracle incorrectly
assumed a one-frame minimum for a positive Source range. Actual native endpoint
rounding can produce zero; the adapter now refuses it atomically. All3 affected
native placement cases pass, covering all547 cases with the unchanged passes.
The final14-case Source/asset geometry gate includes the added exact BigInt
endpoint subtraction regression. Formatting, all-target Clippy and embedded
build pass. A final14-case client rerun/build covers default target and automatic
post-drop availability. No native suite was repeated for these two UI corrections.
The existing Windows tab verifies marked all/video/audio placement, new tracks,
one Undo/Redo, Save/reopen, Source absolute EOF Replay, Program EOF and remembered
position without CAS error, and Full HD/AAC exported-file EOF. See
`evidence/f2-source-placement-workflow.json`. Audio-only Source waveform display is
qualified separately in `evidence/f2-source-waveform-workflow.json`; remaining
gapless/physical audio, long4K and full F2/M7 acceptance remain open.

F2 lookahead (`672b495`, halo1/8820): 113 affected JavaScript cases and embedded
build pass, including eight new ownership/TTL/adoption/failure/cancellation and
fast-tail/recording regressions. Reuse the unchanged 543-case vv-web/fmt/Clippy
gate from `f1-floating-curves-workflow.json`. The single Windows acceptance run
imports/inserts/saves 7275 frames, naturally crosses the 7200-frame boundary at 1×
with 960×540 preview on a 1920×1080 timeline, and plays the 75-frame Full HD/AAC
export to EOF. No native suites or renderer matrices were repeated. Source is
the documented 864×480 moving A/V loop. The short second attachment was not
directly sampled; natural EOF and stable ready future are recorded. Keep
gapless/physical audio, broader Source/F2 and M7 acceptance open. A project-view
CAS warning after EOF is fixed by9ecf29d; Saved project bytes and Undo are
unchanged. See `evidence/f2-program-lookahead-workflow.json` and its screenshots.

The TS matrix, applicable DPI/device checks, performance requirements and M7
release gates below now belong to the active full scope. Encoded-file timing,
synthetic recording or tiny fixtures do not prove physical-device behavior or
ordinary-resolution throughput. Keep unverified gates explicit. Data integrity,
linked edit atomicity, Undo/Redo, current preview identity and valid output remain required.
No Windows heavy workloads and no new browsers; use bounded, sequential halo1
workloads and the shared nonblocking GPU lock. The owner moved new work to free
halo1 because halo2 is shared with H3. Preserve every earlier editor and Undo
chain. Keep the eight-CPU/4-GiB/no-swap/low-priority resource policy.

## Dedicated Curve window checkpoint — 2026-10-23

`evidence/f1-floating-curves-workflow.json` covers109 focused JS cases,543 Web
Rust cases, formatting, all-target Clippy and build on bounded halo1. A final
109-case client rerun/build includes a browser-found CSS expander correction.
The one existing Windows tab exercises pointer/keyboard move/resize, local
numeric draft retention and close cancellation, layout after actual reload,
header mixed Delete/Undo with all timeline clips retained, numeric Undo/Redo/Save,
native ruler seek and R9700 Program EOF while the nonmodal window remains open.
Horizontal wheel pan and plain wheel zoom pass. Physical modifier-wheel remains
unverified because the browser input API cannot hold a modifier during a wheel
event; source/native-axis modifier regression cases pass. The dedicated window
gap is closed; global DPI/representative dense timeline and other M7 acceptance
remain open. Native/catalog/export/persistence matrices are unchanged and reused.

## Historical native curve viewport checkpoint — 2026-10-23

`evidence/f1-native-curve-viewport-workflow.json` covers95 focused JS cases,
543 vv-web cases with15 affected reruns after a test-only endpoint correction,
formatting, all-target Web Clippy and embedded build on bounded halo1. Actual
Windows animation, incoming tangent ownership, mixed selection, exact Undo/Redo,
shared time zoom/pan, Save and composed compound EOF pass. Three real readonly
viewport calls preserve Session/history. Regressions cover fractional native
ease/overshoot, full-track page neighbors, bounds/stale/locked readonly behavior,
coalesced cancellation and horizontal drag retaining accepted overshoot samples.
The dedicated floating UI, physical modifier-wheel/DPI and dense editing gates
remain open; this does not qualify unchanged export/restart or full M7 release.

## Existing repo quality gate

Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace` where dependencies/GPU exist. Upstream Rust unit tests belong in `crates/<crate>/src/tests/<source path>.rs`, not inline. See root AGENTS/CLAUDE.md and docs/BUILDING.md. Before adding new test harness for frontend, prove pure JS works with `node --test`; UI interactions need browser-level smoke only when necessary.

## Core behavior

| ID | Test | Expected outcome |
|---|---|---|
| TS-001 | Open / save project and reopen | Identical timeline/model state and media references |
| TS-002 | Safe drag into occupied track | 409 OVERLAP, project unchanged |
| TS-003 | Overwrite in explicit overwrite mode | Change is confirmed and undoable as ONE step |
| TS-004 | Linked audio move | All linked clips follow or command rejected atomically |
| TS-005 | Locked track during multi-edit | No partial modification |
| TS-006 | Trim, split, ripple delete, undo | Exact frame semantics and stable IDs after undo |
| TS-007 | 24000/1001 with 30000/1001 media | No drift; correct rational conversion |
| TS-008 | Replayed command_id after lost response | No duplicate edit, same authoritative result |
| TS-009 | Revision changed during drag | Conflict, draft restored, no accidental overwrite |
| TS-010 | Second writer tab | Read-only or explicit controlled takeover |
| TS-011 | Save during process crash simulation | Last valid save or recovery, never partial .vvproj |
| TS-012 | Export while editing | Output uses frozen snapshot; revisions isolate correctly |
| TS-013 | GPU unavailable while editing | Editing functional, preview indicates failure; no llvmpipe lie |
| TS-014 | 500-clip Canvas pan/zoom/drag | Target 60fps on target Windows PC, bounded memory |
| TS-015 | Pointer cancel/Escape, focus in input | No unintended edit, typing Space doesn't start playback |
| TS-016 | Seek 100 times rapidly | Last frame rendered correctly, stale responses suppressed |
| TS-017 | Frame source to web preview parity | Reference composed frame pixel/color reasonable tolerance |
| TS-018 | Proxy cache invalidation after edit | No outdated frame silently shown as current |
| TS-019 | Audio crosscut playback | Correct mix/no perceptible drift at cuts, track effects applied |
| TS-020 | Browser mic record/stop/disconnect | Take imported once, no unauthorized recording |
| TS-021 | AI Replace Take shorter than original | User choice, no silent retime or destructive shortening |
| TS-022 | Path traversal / symlink / malformed OTIO | Reads/writes denied outside roots |
| TS-023 | Invalid/large API payload / flood preview | Bounded queue/resources, validated error |
| TS-024 | Browser reconnect after export started | Job status present, output unaffected |
| TS-025 | Native vv-app regression | Baseline tests + same functionality after shared crate change |
| TS-026 | Color scopes fidelity | Correct clip stage and scientific RGB representation |
| TS-027 | EQ/compressor and voiceover | Match native audio output within justified tolerances |
| TS-028 | Full shortcut focus sequence | Keyboard editing, Undo/Redo, text inputs and dialogs work |

## UX visual test matrix

- Viewports: 1920×1080, 1440×900, 1280×800.
- Windows scaling: 100%, 125%, 150%; Chromium/Edge current supported stable versions.
- Workspaces: Edit, Color, Audio, Review; Source and Program Viewer; Slip, Curves; Mixer, Export; stale preview; lost server connection; offline media; blocked overwrite; empty project.
- Accessibility smoke: keyboard-only nav, focus return from dialog, contrast of disabled/selected states, accessible track/clip list synchronized with Canvas.

## Observability and performance proof

Instrument CPU timing of Canvas draw, pointer-to-visible latency, RPC p50/p95, frame queue occupancy, cache bytes/hits, decoder/encoder choice, GPU adapter/VRAM, dropped frames and A/V drift. Don't print real prompt/media details in logs without consent.

Performance numbers are goals, not achieved results: 60fps timeline, <=1 animation frame input visual response, browser initial compressed JS target <100KB, still seek cached target <100ms, playback start once cached target <500ms, no memory growth after 2h typical editing.

## Required evidence for closing a parity row

Location in native UI + exact source function, web entrypoint and API, test ID + test output, screenshot or short video of intended interaction, known limitations. Mark `done` only with all of these.

TS-020 automated acceptance uses the production AudioWorklet/controller with an
explicit synthetic input provider, not a physical microphone toggle in the app.
It verifies final PCM hashes, interrupted-upload retention/retry, native placement,
Undo/Redo/save/restart, delayed-input cancellation, composed programme end,
safe overlap refusal and explicit overwrite/latency correction. Rust adapter and
JS state-machine tests cover locked targets/linked tracks and stale documents.
Physical permission, input disconnect and device latency still need device QA;
successful WAV construction does not prove embedded-browser download completion.

TS-021 now includes real browser source comparison at 25/30 fps, 1x elapsed
clock alignment/shorter-source hold, explicit short-take refusal/shortening,
linked video/audio replacement with IDs/start/speed retained, no ripple of the
following clip, mixed 24/50 fps animation/crop preservation, one Undo, Save/
restart and unchanged original file hashes. Pure state tests cover late plans,
source/policy/document changes, ownership, explicit confirmation and key-merge
warnings. Shot/Take acceptance now also covers exact u64 seed, inherited versus
explicit metadata, safe literal prompt display, Favorite/Rejected, search,
reversible annotation restore, independent Save As and restart persistence.
Tests refuse stale sidecar revisions, source rebinding without confirmation,
foreign schemas/symlinks, orphan namespace collisions and late/read-only forms.
Twenty-shot montage acceptance additionally covers 60 takes, per-shot flags,
20 native linked replacements with exact middle keys and unchanged placement,
restart metadata equality and a full 60-second x264/AAC export. Decoded output
verifies frame count, source tones and black/silent explicit gaps. This was CPU
acceptance. On 2026-10-22, `evidence/f6-verified-take-workflow.json` adds
Review-specific native/API R9700 pixel parity and a full-HD export/download/
natural-EOF workflow, qualifying `replace_take_atomic`. Sustained full-resolution
A/B throughput and physical audio acceptance remain open for `compare_take_AB`.

TS-011 additionally uses two verified own-process SIGKILLs after completed native
recovery snapshots. Snapshot receipts survive unchanged; recovery copies match
their native RON payload bytes, retain all 20 middle keys and exact Review
sidecars, and leave the original project/source hashes intact. A second crash
tests refusal over newer edits, keep-without-open, unchanged current history,
normal Save and a clean restart. Missing backing file recovery and focused form
layout are also exercised. This proves periodic recovery, not durability of edits
after the last checkpoint or survival of render jobs/Undo history.

Library coverage for TS-001/002/004/005/006/007/009/015 now includes
`evidence/f5-library-asset-drop-workflow.json`:
an actual Windows multiasset drag from the canonical CIFS Library inserts video
then an independent compound in panel order, with linked streams, four selected
new clips and one native Undo. Undo/Redo restore semantic timelines/media;
native compound hashes and ID counters are derived/monotonic. Playback crosses
the imported compound to natural EOF and Save retains the result. Focused checks
cover exact-rate ghosts, default/new/locked tracks, opt-in overwrite, cycles,
batch budgets, source revisions/cancellation and edited cached compounds.
Automatic pool renders must not invalidate completion; genuine mouse/keyboard
selection must invalidate it. Full native desktop physical acceptance and broad
offline/large-media lifecycle cases remain open.
