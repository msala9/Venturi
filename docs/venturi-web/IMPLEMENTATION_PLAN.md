# Implementation plan — bounded milestones and gates

No milestone starts until the previous one has proof. Each PR should do ONE bounded outcome and leave upstream `vv-app` unchanged. Codex must report changed files, tests run, unrun tests and risks.

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
