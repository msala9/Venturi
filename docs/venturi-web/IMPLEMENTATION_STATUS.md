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
