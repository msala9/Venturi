# Implementation status

2026-10-20 — development branch feat/venturi-web.

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
