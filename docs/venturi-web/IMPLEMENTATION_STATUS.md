# Implementation status

2026-10-21 — development branch feat/venturi-web.

## Current completion assessment

The ledger contains 90 in-scope capabilities: 34 done, 56 partial and none not
started. Two additional rows are explicitly NOT-PLANNED and excluded. Thus
37.8% of capability rows have full acceptance; this is not an estimate of
implementation effort. Many partial rows already have native adapters and
working browser controls. Overall engineering progress is estimated at 65–70%,
with substantial uncertainty in remaining interaction and release qualification.
No completion date is supported by the current evidence.

The native capture/application API was pushed in 2f24a91. Saved native preset
storage, its browser panel and explicit session shortcut activation now have
150 Rust tests, 119 JavaScript tests, fmt, clippy and a native build passing on
halo2, plus finite API/restart evidence. GUI acceptance, shortcut assignment
and desktop import qualification remain open. A configurable preset
folder does not establish sharing through the 14 TB archive; only the existing
ds4 media-catalog integration has actual NAS evidence.

Animated viewer transforms, mask/path handles, persistent export history and
explicit terminal-export discard, transition duration handles and exact speed
handles, completed-path pen drawing, full path-key navigation and transition
selection/placement preview cache retention and Program window continuation now pass
244 web Rust tests, 277 native core tests and 542 JavaScript tests,
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
and `evidence/m6-frozen-take-policies.json`;
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

## M1a — web shell

Implemented native HTML/CSS/ES modules, four workspace layouts, browser tabs,
honest disabled advanced tool homes, command palette, Projects dialog,
export integration notice, fullscreen, resizable keyboard-accessible panels,
local layout preferences and labeled Shot/Take fixtures. Node shortcut test
passes. Browser checked at 1920x1080 and 1280x800; four workspace screenshots
and compact layout saved under evidence/m1-*.jpg. Keyboard splitter increased
260 to 276; text input accepted Space without editor transport action;
command palette focus was verified. No engine capability claimed by shell.

## M1b — Canvas timeline

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

## M2a — native HTTP host

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

## M2b — project/session workflow

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

## M2c — safe command bridge

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

## M3a — actual headless composed frames

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
M1 timing/DPI acceptance and M3b–M7 remain open. See PREVIEW_SPIKE.md for
the smallest next media increment and measured constraints.

Deployment/browser follow-up: the final embedded UI binary was deployed during
an idle lock slot, replacing only the verified Venturi PID on 127.0.0.1:8790.
Windows browser confirmed Alt+Right start 0 to 1, undo back to 0, split at 12,
redo, lift delete and two undos restoring original revision e3c0f15b. The restored
fixture was saved. Screenshot records CURRENT at frame 12. An external Rust
test also verifies immediate GPU_BUSY under occupied lock and that the shared
lock file is preserved.

## M3b — source playback, thumbnails and waveforms

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

## M3c implementation checkpoint — GPU acceptance pending

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

## M3b additional Source coverage — PNG/JPEG stills

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

## M4 independent increment — native properties and scalar keyframes

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

Windows browser verification: PositionX 0→48→undo 0; opacity source keyframes
0=75 Linear and 1=50 EaseInOut persisted with Save. Screenshot:
evidence/m4-native-inspector-browser.png. All 22 Rust web tests, 16 JavaScript
tests, formatting, clippy and web build passed. Focused native tests cover
all-or-nothing validation, one-step undo/redo, lock refusal, source-frame mapping,
invalid ranges and keyframe removal/interpolation undo. GPU rendering of these
new edits is pending the shared hardware slot. M4 as a whole remains open:
transitions, masks, curves, slip, markers, speed, presets and compounds are not
claimed complete by this increment.

## M4 independent increment — Source range, linked slip and markers

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

Browser proof: Source 6–18 inserted a linked 12-frame video/audio pair. Slip +1
changed both source ranges to 7–19 with unchanged start 0 and length 12. Saved
and reloaded the project successfully; the writer ID now persists in tab
session storage, fixing the reload lease wait found during validation. Marker
12–18 with note Cut cue applied and saved. Screenshots:
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
further priority 60–90 minute quality test after the current H3 video.

## M4 independent increment — title generators and native transitions

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

## M4 independent increment — native history navigation

History displays actual native command positions and jumps with History::go_to.
Undo/redo/jump also use the project command endpoint with epoch/generation and
idempotency checks, so recovery is possible when no active timeline remains.
The actor serializes the full native jump; browser frames/preparations invalidate
as on other mutations. A native regression covers jumping through timeline
creation/removal, invalid positions and exact restoration. Host coverage checks
project-level jump retries and redo without a timeline precondition.
Browser: InsertClips + AddTrack → initial state (no clips, redo enabled) →
position 2 restored the solid and V2. Saved successfully. Evidence:
evidence/m4-native-history-browser.png. All 27 Rust web tests, 18 JavaScript
tests, formatting, clippy and build pass. History remains process-local like
the upstream session; saving a project does not serialize undo commands.

## M2b additional persistence coverage — Save As

Projects now offers Save As to a new validated root filename. It uses the
existing atomic no-replace writer, then switches the session path and marks
the saved generation. A conflict leaves the current path and both files intact.
Host coverage checks same-ID retry, original byte preservation, the new file
and conflict path preservation. Windows browser created Saved_copy_UI_check
from History_UI_check, then rejected overwriting the original with FILE_EXISTS.
Evidence: evidence/m2-save-as-existing-file-refused.png. All 27 web Rust tests,
18 JavaScript tests, formatting, clippy and build pass. Automated crash recovery
and asynchronous import remain separate outstanding work.

## M2/M4 independent increment — timeline creation and compound insertion

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
inserted that compound into the 24fps parent: source 0–150 became 120 timeline
frames. A self-reference insertion was rejected, leaving the saved project
intact. Double-click opened Nested30 at 30fps. Evidence:
evidence/m4-compound-native-cycle-refused.png. All 29 Rust web tests, 18
JavaScript tests, formatting, clippy and build pass. New coverage checks
rational timeline creation, invalid geometry, native compound FPS conforming,
self/indirect cycle refusal, undo and malformed project graphs. Rendered
compound acceptance on R9700 remains pending the shared hardware slot.

## M5 independent increment — native mixer gain and balance

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

## M5 independent increment — native audio inserts and EQ response

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

## M4/M5 independent increment — visual filters, grading and joint keyframes

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

## M1/M3 measured acceptance increment — Canvas and five-minute A/V

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

## M3 export increment — immutable native H.264/AAC jobs

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

## M4 independent increment — native linked speed, freeze and clip labels

Inspector now exposes native constant speed 1–10000%, pitch preservation and
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

## M4 independent increment — native mask stack and Bezier values

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
including animated path endpoints, before mutation. Paths are bounded to 3–21
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

## M4 independent increment — guarded native OTIO exchange

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

## M4 independent increment — selected compounds and timeline management

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

## M3 shared-GPU correction — keep ownership for the native job

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

## M4 independent increment — native project clip clipboard

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

## Independent increment — explicit isolated software preview and export proof

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

## M5 independent increment — two native isolated clip scopes

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

## M5 independent increment — native Auto Balance

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

## M5 independent increment — shared native built-in presets

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

## M7 independent increment — saved backup recovery and process ownership

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
and AI Review remain open; M4–M7 are not declared complete.

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
the remaining M4–M7 feature ledger are still open.

## M4 independent increment — native scalar curves and Bezier editing

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
over source frames 0–47 with Bezier interpolation, while the overlay stays
colored. Windows can open the panel, see the composed native frame and isolated
scopes, and retain both keys in native history. Evidence:
m4-halo2-software-curves.json/browser.png. The binary SHA-256 is
c2cacb3ca1f10ee2da0484c141a62d4331dd6c264e6d2c8bd0598134df11d61a.
Inspection confirms software_preview, two renderer threads, root directory
ownership, no DRI/KFD handles and no loaded RADV library. Staging and this
acceptance did not acquire or probe the shared hardware GPU reservation.

## Active completion objective — continue through M4–M7

The owner explicitly requested autonomous continuation to completion. The active
goal covers the full planned native GUI parity surface, AI Review, deployment
and acceptance; finishing an individual slice is not completion of that goal.
The shared library must integrate ds4-appliance's authoritative catalog and its
14 TB network archive. The endpoint is being resolved; independent editing work
continues. See ARCHITECTURE for the verified sibling API and storage contract.

## M4 increment — native media catalog and safe relink

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

## M4 increment — Slip tool and dual source viewer

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

## M5 increment — native speech detection and global silence removal

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

## M4/M5 increment — native track removal and arming

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

## M4 increment — ds4 shared-media catalog and archive recovery

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

## Voiceover prerequisite — explicit native audio container

The shared audio-file writer now selects the container from AudioFileFormat
instead of guessing it from the path suffix. Normal desktop take filenames keep
the same muxers/codecs. A pre-created safe file descriptor can therefore receive
native WAV output through /proc/self/fd without using an unrestricted path.
Four focused native audio_file tests pass, including every available format,
exact mono/stereo sample preservation and extensionless-descriptor output;
media clippy with warnings denied also passes. This is a recording prerequisite,
not a completed microphone/placement workflow.

## M5 — browser voiceover and native take placement

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

## M6 prerequisite — native Replace Take planner and guarded API

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

## M6 — A/B source comparison and explicit Replace Take UI

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

## M6 — persistent Shot / Take annotations

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

## M4 — shared native property paste

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

## M6 — twenty-shot montage acceptance

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

## M7 — external project Save conflict protection

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

## M4 — selection follows playhead

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

## M7 — validated last-saved project reopen

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

## M7 — independent unsaved-edit recovery snapshots

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

## M5 — native color range and saturation acceptance

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

## M5 — bounded native audio audition for Program and Source

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
about 3–13 ms for this tiny fixture; this is not a general latency guarantee.
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
Source 00:00:01:11 and reached Native audio · 80 ms with the native project Saved.
The audio scrub parity row is now complete for the required release-based web
interaction. Evidence: m5-source-pointer-scrub.png and m5-audio-scrub.json.

The 5586798 Source-pointer build is deployed on halo2, SHA-256
11aab00407571166ab7494e074bf47d4be4cdbde6d7a4642f17aa18143eae666.
The embedded module hash, saved shared project, exact provenance seed, Favorite,
native silent fragment and CPU-only isolation were checked again in
m5-halo2-audio-scrub.json. No hardware lock was probed or acquired.

## M4 — close stale Source range and clip-disable ledger entries

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

## M5 — pitch-preserving 2x/4x/8x Source and Program transport

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

## M3b/M5 — cache ruler and reusable composed movies

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

## M5 — native audio window meters and insert spectra

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

## M3/M7 — export duration independent of Program preview windows

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

## M7 — bounded command receipt rotation without editor restart

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

## M7 — synced command receipts and acknowledgment checkpoints

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

## M4 — marker lane gestures and native MoveMarker history

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
6 to 12, moved a 24–36 range so its far end snapped to the clip end at 48, resized
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

## M4 — scalar curve group editing and two-axis view controls

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

## M4 — native RGBA, text and direction key tracks

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

## M7 — interrupted local CPU soak and remote build limits

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

## M4 — cross-parameter native key selection

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

## M4 — linked Zoom properties and scalar curve edits

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

## M4 — dense native key pages and selection across pages

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

## M4 — native attribute preset capture/application API

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

## M4 — saved native presets and explicit shortcut activation

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

## M4 — timeline fades, static viewer handles and neutral multitrack compounds

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

## M3/M4 — animated native viewer handles and persistent export history

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

## M3 — explicit saved-export discard

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

## M4 — mask viewer handles and explicit Bezier path keys

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

## M4 — transition duration pointer handles

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

## M4 — exact native speed pointer handles

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

## M4 — native completed-path pen and full path-key navigation

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

## M4 — native transition selection, placement and duplication

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


## M3 — preview cache admission and live media retention

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


## M3 — foreground Program window continuation

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


## M3 — bounded native Source windows and absolute navigation

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

## M3 — independent full-source thumbnails and waveforms

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

## M4 — exact native speed strip presets

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

## M4 — native selected-only speed-strip visibility and Windows UI acceptance

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
were 2,108–43,172 bytes. This is functional long-source acceptance, not a
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
remain separate release work. The broader engineering estimate remains 65–70%.

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
Ledger totals and the uncertain 65–70% engineering estimate are unchanged.
