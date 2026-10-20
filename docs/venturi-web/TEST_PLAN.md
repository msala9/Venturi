# Test strategy and test IDs

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
