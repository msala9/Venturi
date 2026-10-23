# Test strategy and test IDs

## Active full-plan qualification — 2026-10-23

[COMPLETION_PLAN.md](COMPLETION_PLAN.md) controls F1–F7 full-plan completion.
[DELIVERY_PLAN.md](DELIVERY_PLAN.md) is the accepted workflow baseline. Complete
the missing production behavior of each block before its integrated acceptance.
Reuse prior evidence for unchanged components. Add focused regressions for actual defects;
run required regression/build checks once per coherent code block and one
integrated browser scenario. Repeat checks only after relevant changes/failures.
Do not build or test documentation-only planning changes.

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
