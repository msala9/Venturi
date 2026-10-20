# Codex runbook

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
