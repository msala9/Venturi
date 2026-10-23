# Implementation plan — parity backlog and delivery priority

## Active objective — 2026-10-22 owner instruction

The owner accepted the usable workflow and resumed the full plan. Follow
[COMPLETION_PLAN.md](COMPLETION_PLAN.md) for the active F1–F7 delivery blocks:
complete the 41 remaining partial capabilities, preserve the 49 already accepted and finish
M7 release qualification. The two explicitly NOT-PLANNED rows remain excluded.
[DELIVERY_PLAN.md](DELIVERY_PLAN.md) is the completed regression baseline.
Preserve the protected editor and any new work in the delivered candidate.

Work in coherent delivery blocks, reuse existing evidence, use focused checks
during development and one integrated acceptance pass per block. Do not repeat
full renderer/browser matrices for unrelated edits. Required regression checks
still apply to the completed code block. The owner moved new work to free halo1
because halo2 is shared with an H3 agent. Heavy work runs only on bounded halo1,
one workload at a time, at most eight CPUs/4 GiB with no swap and low CPU/I/O
priority. Use the existing Windows browser. Preserve all earlier halo2 and
halo1 editors, their projects and Undo chains.

The current halo1 delivery is **http://127.0.0.1:8831/**, source `6764b2d`,
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
history and final frame0 are unchanged. See
`evidence/f2-native-proxies-durable-workflow.json` and recovered/workspace screenshots.
All 16 earlier Sessions/live Undo, 17 service PIDs including ds4 and four earlier
Saved projects are preserved. Halo2 and NAS are untouched.

`proxy_quality_settings` is accepted: ledger **49 done / 41 partial / 2 excluded**.
Full F1-F7/M7 remains active. Malformed/foreign cache files and pre-intent crash
leftovers are preserved/refused; arbitrary-power-loss automatic recovery is not
claimed. Source browser/audio conversion and its broader acceptance remain in
Source capabilities. Next implement pool marquee, contextual actions and folder
drag as one native interaction block. Keep original frame-source FD pinning,
representative/dense/DPI/physical acceptance and other F1-F7/M7 work explicit.

Preserved initial proxy workflow: halo1/8830, source `a95b4a6`, binary `f8fe8912da80`.
Enable/quality, real generation Pause/Resume, compact menu/Media badges, original
Source dimensions when disabled and ready-only Program proxy selection are
verified in `evidence/f2-native-proxies-workflow.json`. That earlier server uses
its private ephemeral cache; its Saved project, export and live state remain.

Preserved Media presentation delivery: halo1/8829, source `e204001`, binary
`c8a3bc799e10`. Native Details/List/Grid, folder navigation/search, real metadata,
resizable columns and visible-order selection remain available and unchanged.
See `evidence/f2-media-presentation-workflow.json`.

Preserved import/recovery delivery: halo1/8828, source `e41e9cc`, binary `3f777879477e`.
Approved nested file/tree import and prepared project Relink now complete the
ordinary native import/recovery workflow. Native folder merge/pruning, path
deduplication, per-file errors, selected/folder missing-name search and explicit
replacement remain native; probes run in the isolated serial worker. Each edit
is one Undo, and original legacy receipts replay without probing again. Dialog
reopen clears obsolete counts. The83 affected native cases,1291 aggregate client
cases and final116 affected client cases/build pass. Actual Windows nested import,
UndoRedo, two-file recovery, five-clip Full HD playback/export EOF and final Saved
client reload pass. See `evidence/f2-project-media-workflow.json`. Thirteen older
editors/Undo and ds4 remain preserved. Ledger48done/42partial/2excluded; continue
pool Grid/List presentation, proxy/derivative fidelity and the full F1-F7/M7 plan.

Preserved project-pool delivery: halo1/8826, source `5d8d15d`, binary `7420a371bfe9`.
Project pool selection places whole sources sequentially in visible panel order
by drag or Timeline > Insert selected media. Native destinations, all streams,
per-source links, still5s, rational lengths and one Undo remain authoritative.
Name/Duration sorting and hidden-selection/Relink-draft safety close related
ordinary Media workflow gaps. The1270-case client/10-case affected native gates,
formatting, all-target Clippy and build pass. Actual Windows drag, Undo/Redo,
keyboard insertion, Save/client reload, Program EOF and457-frame Full HD/AAC
export EOF pass; see `evidence/f2-project-pool-workflow.json`. Eleven prior
editors are preserved. Continue approved nested-source/tree import, prepared
project Relink, remaining pool presentation and representative/full F1-F7/M7.

Preserved Source-lookahead delivery: halo1/8825, source `4f94773`, binary `318f29163b8b`.
Normal Source playback prepares one next native window with separate local
ownership, version/audio/range verification and ready heartbeat. The current
movie and placement identity stay active. EOF adopts the existing job only
after final verification, audio-tail drain and exact absolute seek. Speculative
failure leaves playback running; boundary failure requires manual Play.
Pause/seek/Stop and hidden/modal policy detach observation without shared-job
deletion. The189-case focused client gate/build and actual Windows67s/two-stream
automatic boundary/EOF pass with unchanged Saved bytes/history/Program view.
See `evidence/f2-source-lookahead-workflow.json`. Continue remaining F2
import/proxy/derivative fidelity and representative-media acceptance, then the
other full-plan blocks. Full F1-F7/M7 remains active.

Preserved waveform delivery: halo1/8824, source `f1fd010`, binary `ae29b4545c2a`.
Audio-only Source displays native full-source peaks per stream, marks and an
absolute playhead. Click/keyboard seek and marked All drag share verified Source
identity; all128 stream ordinals remain reachable through visible-lane demand.
The existing single derivative queue/cache stays bounded and resumes interrupted
visible reads without automatically retrying real failures. Actual Windows
two-stream loading, late seek, Replay, linked insertion, Undo/Redo, Save/client
reload, Program EOF and non-silent Full HD/AAC exported-file EOF pass. See
`evidence/f2-source-waveform-workflow.json`. Speculative Source continuation is
delivered in4f94773; remaining F2 behavior and the full goal remain active.

Preserved Source-placement delivery: halo1/8822, source `9ecf29d`, binary `2f3f3cdc11d1`.
Verified marked Source ranges support native all/video/audio placement by drag
or collapsed keyboard controls, existing/new tracks, safe overlap policy and
one Undo. EOF Replay returns to absolute zero. Project-view CAS acknowledgements
survive playback and delayed local snapshots. The ordinary moving A/V workflow
imports, edits, saves/reopens, plays naturally and exports Full HD/AAC.
See `evidence/f2-source-placement-workflow.json`. All prior editors, projects and
live Undo remain preserved. The audio-only Source waveform surface is delivered
in f1fd010. Continue remaining F2 behavior. Ledger47done/43partial/2excluded and full F1-F7/M7 stay active.

Preserved Program-lookahead delivery: halo1/8820, source `672b495`, with one speculative adjacent
Program window and shared-job-safe local cancellation. The 113-case affected
JavaScript gate and embedded build pass. `f2-program-lookahead-workflow.json`
records natural 1× playback beyond five minutes with 960×540 preview on a Full HD
timeline, native audio-origin retention, Save and actual 75-frame Full HD/AAC
export playback. The ledger stays 47 done / 43 partial / 2 excluded. The
EOF project-view CAS warning is fixed in9ecf29d. Continue remaining Source/F2 behavior; this
scope does not qualify physical audio, long 4K or all F2-F7/M7 requirements.

The milestone table below defines the full scope; COMPLETION_PLAN.md groups its
remaining work into coherent blocks. Leave upstream `vv-app` unchanged and report delivered behavior,
checks, remaining defects and deployment state. No upstream PR or merge.

| ID | Outcome | Dependencies | Proof / exit criterion |
|---|---|---|---|
| G0 | Ground truth and screenshot audit | local repo | commit SHA, file inventory, desktop feature map, dependency & GPU risks; parity CSV updated |
| M1a | Static web shell + design tokens | G0 | Edit, Color, Audio, Review responsive layouts; no runtime framework; focus/keyboard tests |
| M1b | Timeline Canvas independent of media backend | M1a | 500 fixture clips; pan/zoom/select/snap/drag/trim ghost at 60fps target; no server calls during drag |
| M2a | New Rust vv-web skeleton | G0 | compiles `cargo check -p vv-web`, binds loopback, health, static assets, error normalization |
| M2b | Session read/list/open/save | M2a | safe allowlisted paths; snapshot JSON with canonical string IDs, epoch/revisions; integration tests |
| M2c | Safe command bridge and project save | M1b+M2b | trim/split/delete/undo/redo + safe move without overwriting; one undo per gesture; conflict/retry tests |
| M3a | Headless exact frame path | M2b, GPU probe | actual composed frame served, no GUI; bounded jobs, stale seek cancellation, tests |
| M3b | Source proxy playback + thumbnail/waveform | M3a | playback media preview/audio where supported, cache budgets, range requests |
| M3c | Composed timeline preview + audio | M3b | AV sync, range invalidation, no stale frame misrepresented; benchmark on R9700 |
| M4 | Desktop Edit parity | M3 | transitions, linked clips, slip, markers, keyframes, presets, compound, OTIO; each parity row verified |
| M5 | Color and Audio parity | M4 | scopes, wheels, mixer, EQ, compressor, normalization, VAD, voiceover from Windows browser |
| M6 | AI Review | M3+safe commands | Shot/Take sidecar, A/B comparison, atomic Replace Take with duration policies |
| M7 | Security, deployment and release | M5+M6 | systemd loopback, SSH tunnel, reload/recovery, threat-model, 2h soak, docs and license review |

## Current F1 delivery checkpoint — 2026-10-23

Source `4e983c2` runs on halo1 port8819 with the native nonmodal Curve window,
visible Rust sampling and selected-key adjacent tangents. Actual Windows
window geometry/draft/keyboard ownership, mixed Delete/Undo, numeric Undo/Redo,
Save, reload layout, native ruler and composed compound EOF pass. See
`evidence/f1-floating-curves-workflow.json`, supplementing the unchanged previous
native curve, typed/mixed/dense-page/linked-Zoom evidence. Simultaneous animated
lanes and the dedicated movable window are implemented. Physical modifier-wheel
is a named unverified acceptance item (input API limit), while horizontal pan
and plain wheel zoom pass. Keep global DPI/500-clip/M7 checks separate and
continue the remaining functional F2-F7 blocks without repeating unchanged
catalog/render matrices. The ledger47/43/2 and full scope remain active.

## G0 — work orders (first Codex turn only)

- Confirm branch/commit. Inspect root `AGENTS.md`, `CLAUDE.md`, screenshot directory names, desktop `vv-app` panel files, `vv-mcp` tool enum + dispatch, `vv-session` render interfaces.
- Mark feature rows as `existing-gui`, `mcp`, `session-direct`, `extract-ui-worker`, `new-core-command`, or `unknown` after inspecting actual code; do not infer from screenshots only.
- Check `cargo check -p vv-session` and baseline `cargo test -p vv-session` where possible. Document missing native packages rather than editing system drivers.
- Inspect MadRock source visuals; don't assert theme hex are official. Prepare small UX reference screenshots from local repo if useful.
- Publish `G0_REPORT.md` listing exact file paths, line ranges, git SHA, verified findings and blockers. No new Rust host yet.

## M1 UX sequence

1. Native HTML skeleton with real focus/navigation; CSS grid with resizable panels; workspace presets = stored layout configuration, not separate apps.
2. `timeline/geometry.js`: pure frame↔x and hit-testing functions with unit tests.
3. `timeline/input.js`: explicit idle/select/move/trim/scrub machine using pointer capture, cancel on Escape, snap within 8 CSS px.
4. `timeline/draw.js`: DPR-aware Canvas and visible-range culling; no interval loop, rAF invalidation only.
5. Media/Inspector panels using fixtures. Source and Program viewers start with clearly labeled fixture data, never simulated server capabilities.

## M2 host sequence

1. Minimal Axum router, `/api/v1/health`, embedded/static assets, JSON errors, graceful shutdown; one binary.
2. Session actor, project endpoints, path allowlist, file sanitization, revision serializer.
3. Command processing with safe move validation. **Do not directly call MCP's destructive move/insert semantics for drag.**
4. Idempotency registry + conflict handling and autosave/recovery policy.
5. Diagnostics endpoint with **non-secret** GPU adapter/encode capability flags verified by probe.

## M3 media sequence

1. Probe Vulkan wgpu without Wayland, get correct GPU; verify a real exact frame result.
2. Bounded async frame requests: max outstanding per browser + global, queue newest seek, discard by seq and revision.
3. Thumbnails/waveforms reuse `vv-media` workers; do not rescan full media during every request.
4. Timeline playback: compose and encode ahead to browser-compatible media + synchronized audio, cache/invalidation versioned by revision. Measure before choosing streaming tech.

## Deferred parity tracking

`FUNCTIONAL_PARITY.csv` is a feature ledger, not a wish list. Each row needs an issue/PR, API implementation, user-facing location, test and evidence before `web-status=done`. Don't silently mark `done` because a panel icon exists.

## Gate review template

```text
Milestone:
Commit SHA / branch:
Changed files:
Behavior demonstrated:
Commands/tests run (stdout summary):
Browser screenshots/interaction video:
GPU adapter, driver, codec evidence if applicable:
Parity rows updated:
Security review:
Known regressions / TODO:
Rollback instructions:
Next smallest step:
```

## Stop-the-line triggers

2026-10-20 execution note: local WSL exposes only llvmpipe; hardware proof was
therefore performed separately on halo2. M3a exact composed frames now have
R9700 Vulkan evidence, including three native RGBA comparisons and 500 seeks.
M3b source and M3c composed playback now have native/browser R9700 evidence,
including a full five-minute synthetic A/V test. M1 Canvas timing is measured
at actual DPR 1.25; OS 100%/150% scaling acceptance is open. Export has a
bounded native job adapter; M4–M7 remain partial/open. Respect the shared
nonblocking GPU lock during all halo2 work;
other agents run DeepSeek 4.1 Flash inference there. See IMPLEMENTATION_STATUS,
RUNNING and PREVIEW_SPIKE for verified boundaries and next steps.

- Wrong GPU or llvmpipe selected during GPU-dependent validation.
- Source files at risk of overwrite without user-initiated overwrite intent.
- A user gesture creates multiple undo steps without explicit grouping.
- `vv-app` baseline tests or docs functionality regress.
- Project path outside allowlisted roots / symlink escape / unvalidated output path.
- A stale preview silently displayed as current.
- Web API exposed on `0.0.0.0` without opt-in security design.
