# Codex runbook

## Current87bc internal prebuilt package - 2026-10-24

The immutable archive is `/home/halo/.local/share/venturi-web/deliveries/venturi-web-linux-x86_64-87bc10633ec7-9647db624e70.tar`,
89907200bytes, SHA256
`9647db624e70680745d256e1b9c1b762a27b1196f97f7085e23739e057dafb0b`.
Binary source5567359/runtime87bc10633ec7 and documentation sourceb81de4e are
bound separately in the manifest. All members are hashed, packaged launcher
--help passes, and the three original notice companions/indices stay verbatim.
Fresh loader binding is188 original-identical DSOs plus the pinned zlib patch
with byte-identical archived copyright, checked before/after assembly.
One1CPU/512MiB/noSwap low-priority stage passes, peak227729408B,
zero memory-limit/OOM/kill events; no build/render/server or Windows copy.
See evidence/f7-current-prebuilt-r4-workflow.json and BINARY_DELIVERY.md.

Existing77d7/59b6 runback proof stays version-bound. No current packaged-binary
downgrade or whole-host reboot is claimed. Release-ready remains false;62done/
28partial/2excluded and the full90/F1-F7/M7 goal stay active. Physical/DPI/device,
long browser playback, dense editing and two-hour memory acceptance remain open.


## Representative real-media H.264/AAC export accepted - 2026-10-24

Runtime source5567359/binary87bc10633ec7 (not the later documentation HEAD)
passes the isolated native/Web API workflow on halo1. Official CC-BY-3.0
BBB FullHD completes all19038frames/634.6seconds in111.491s;
the real3840x2160 source completes9000frames/300seconds in251.101s.
Both outputs are native-scale H.264/AAC, hashed/probed with matching HTTP ranges.
Three complete official movie sources retain exact attribution, hashes, dimensions
and durations. Prepared import, Save As/reopen, late native frames and Original
Source eight-second windows pass; original sources/Saved/live Session remain exact.
Both owned workers/children terminate, with8CPU/4GiB/noSwap/low-priority admission
and measured memory events retained. Failed acquisition/first-oracle attempts
remain explicitly failed. See evidence/f7-public-real-media-export-workflow.json.

Only export_h264_aac advances to done:62done/28partial/2excluded.
Reuse accepted browser download/EOF, immutable snapshot/cancel/reconnect and
native4K byte-exact MP4/decoded AAC evidence. These new heavy checks are API-only:
no new browser playback, physical audio, Windows large copy or package claim.
Source/Program long browser playback remain partial. Full90/F1-F7/M7 stays active,
including physical/DPI/device, dense editing and two-hour browser-memory acceptance.
Current87bc development-package refresh is pending; existing archives are unchanged.


## Independent Mixer/Color windows and native title reset â€” 2026-10-24

Source5567359/runtime87bc10633ec7 is active at http://127.0.0.1:8855/,
unit `venturi-web-halo1-native-toolwindows-layout.service`, captured PID457797.
Mixer and Color are independent movable/resizable windows, like the native GUI.
They reuse existing controls and preserve the Program viewport allocation, typed
mix drafts and per-tool geometry. Reopening restores insert interaction and
native graph/preset reads. Closing cancels owned gestures and hidden delayed
commands; Color retains Auto Balance, native Add, scopes above grading and the
same single selected grade card. Curves ownership and geometry remain separate.
Title Background group Reset now preserves each selected title's enabled state,
matching native field-diff semantics; explicit Enabled reset remains distinct.

Serial bounded halo1 stages qualify187 client and4 native cases by exact-source
reuse and a targeted native follow-up; formatting, all-target Clippy and embedded
build pass. Peak2085101568B,
8CPU/4GiB/noSwap, zero memory-limit/OOM/kill events. Actual existing Windows
keyboard/DOM workflow and preservation witnesses are recorded in
`evidence/f3-f4-native-toolwindows-title-reset-workflow.json`.

Original Saved project restored frame48/1x/Fit/Edit/Video/empty history, media
paused and console clean. All13 Saved files,5 media,4 NAS identities/bytes and
shared proxy match;39 foreign Sessions/40 PIDs match the fresh checkpoint.
Keep the complete90/F1-F7/M7 goal active,61done/29partial/2excluded. Physical
input/DPI/device, representative long footage, dense editing and two-hour
browser-memory acceptance remain required. No whole row is promoted here.


## Prerequisites

- Work in a fork of Venturi, with a clean branch (`feat/venturi-web`).
- Run Codex in repository root so it sees the original `AGENTS.md` and `CLAUDE.md`.
- `docs/venturi-web/` and scoped AGENTS already copied from this pack.
- The pack is **plans only**: no `vv-web` Cargo crate yet and no expectation `cargo check -p vv-web` succeeds before M2a.
- Rust >= 1.88 (edition 2024), FFmpeg development headers, pkg-config, clang, Vulkan dependencies; see upstream `docs/BUILDING.md` and avoid replacing existing ROCm stack.

## Suggested invocation

```bash
cd /path/to/Venturi
codex
```

First prompt: `docs/venturi-web/prompts/00_REPO_AUDIT.md`.

Once Gate 0 is approved, run ONE prompt at a time from `prompts/`. Each one instructs Codex to stop after its own acceptance criteria, not push ahead silently. Use your preferred Codex effort setting for complex Rust/API work; do not make automated changes to drivers or host OS.

## Example continuation prompt

```text
Follow repository AGENTS.md and CLAUDE.md. Read docs/venturi-web/README.md, the most recent gate report, and docs/venturi-web/prompts/03_SAFE_COMMANDS.md. Implement ONLY that prompt. Identify existing commands rather than inventing APIs; update tests and parity matrix. Do not touch desktop UI behavior. At the end show changed files, test output, risks, and next minimal step. Stop.
```

## After each Codex task

```bash
git status --short
git diff --stat
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Run native tests where dependencies and GPU are available. If something cannot run, explicitly record why, not 'passed'. New web browser test runner must be the smallest justified tool, ideally native JS tests (`node --test`) for pure logic; browser UI smoke can be Playwright only if required and isolated to dev dependencies.

## Pull request checklist

- Exact source files and upstream dependency boundaries documented.
- Code and comments in English; no verbose comments; Rust unit tests under `src/tests/...` (upstream convention).
- No extra dependency without ADR/update; no FFmpeg CLI dependency for the editing pipeline.
- Tests and demos include success, invalid command and reconnect/undo flows.
- Feature status updated in `FUNCTIONAL_PARITY.csv`; screenshot audit updated if UI changes.
- Browser remains useful under 200ms network latency; no RPC on every pointer move.
- Review security on route/path changes and duplicate commands.

## If a task is blocked

Return a short blocker report with: exact file/line, 2 options, smallest experiment to decide, and code untouched. Never fabricate API existence or success.
