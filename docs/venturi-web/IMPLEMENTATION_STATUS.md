# Implementation status

2026-10-20 — development branch feat/venturi-web.

## G0

Complete source and screenshot audit against b3b03bf. Installer copied 37
files without conflicts; original root agent rules preserved. See G0_REPORT
and SCREENSHOT_AUDIT for evidence and limitations. Functional parity ledger
updated with source paths. Runtime baseline pending dependency installation;
GPU-specific acceptance remains blocked on verified target hardware.

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
