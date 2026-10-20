# Venturi Web — engineering index

**Status:** pre-implementation design, v0.2. **Product:** professional NLE web frontend with AI take review, server-side Linux GPU processing and a MadRock-inspired dark theme.

## Read in this order

1. `../../AGENTS.md` (repository root), `../../CLAUDE.md`, `../../ARCHITECTURE.md`, `../BUILDING.md`, `../MCP.md` — existing upstream instructions and invariants.
2. `ARCHITECTURE.md` — scope, ownership, reuse boundaries, risks.
3. `IMPLEMENTATION_PLAN.md` — gates, milestones, ordered acceptance criteria.
4. `FUNCTIONAL_PARITY.csv` + `SCREENSHOT_AUDIT.md` — desktop fidelity checklist (must be completed against local sources).
5. `UX_SPEC.md`, `INTERACTION_CONTRACTS.md`, `ACCEPTANCE_SCENARIOS.md`, `BRAND.md`, `web/style/tokens.css` — interaction and visual definition.
6. `API_CONTRACT.md`, `schemas/`, `CONSISTENCY.md`, `PREVIEW.md`, `SECURITY_DEPLOY.md`, `GPU_VALIDATION.md` — implementation contracts.
7. `TEST_PLAN.md`, `DEFINITION_OF_DONE.md`, `CODEX_RUNBOOK.md` — build/review workflow.
8. `prompts/00_REPO_AUDIT.md` through `prompts/07_RELEASE_REVIEW.md` — bounded Codex tasks.

## Product decisions

- Keep the entire upstream desktop `vv-app` working.
- No separate FFmpeg editing pipeline. `vv-media` already uses FFmpeg internally.
- One authoritative `vv_session::Session` per writable project. Browser owns only view/gesture state.
- Use native HTML/CSS/ES modules, Canvas2D for timeline, `PointerEvent`s for interaction, no React initially. Reassess only with measured pain.
- Web host on Ubuntu Server without GUI; Rust `vv-web` crate is **new**, not a purported upstream crate.
- Preserve the desktop feature surface incrementally: Edit, Color, Audio and AI Review workspaces; panels Media, Effects, Library, Presets, History, Curves, Inspector.
- Bind loopback by default; browser access via SSH tunnel/private VPN. No arbitrary filesystem paths in APIs.
- No unsafe overwrites from normal drag. `move_clips` and `insert_clip` in MCP overwrite destinations; enforce a safe command policy.
- First release targets **single user / single editing session**, with explicit multi-tab conflict handling.
- Feature availability shown honestly: no WebRTC promises, no unsupported driver/encoder promises.

## Source of truth and uncertainty

Primary verified references (as of **2026-10-20**, branch `master`, mutable):
- https://github.com/VenturiVideo/Venturi
- https://raw.githubusercontent.com/VenturiVideo/Venturi/master/AGENTS.md
- https://raw.githubusercontent.com/VenturiVideo/Venturi/master/CLAUDE.md
- https://raw.githubusercontent.com/VenturiVideo/Venturi/master/ARCHITECTURE.md
- https://raw.githubusercontent.com/VenturiVideo/Venturi/master/docs/MCP.md
- https://raw.githubusercontent.com/VenturiVideo/Venturi/master/docs/BUILDING.md
- https://madrock.ai/

**Gate 0 is mandatory:** record `git rev-parse HEAD`; read `media/screenshots/`; enumerate actual `vv-app` widgets/commands; revisit all assumptions. In this pack, `proposed` means **to implement**, not **already available**.

## Success measure

Given a 20-shot AI video project with linked audio, user can browse, select, trim, split, move safely, undo, inspect a source clip, see exact composed frames, save/reopen and export from Windows without a Linux desktop. Later parity milestones expose every reachable upstream capability with a test and a named API adapter.
