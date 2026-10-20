# Agent rules for the web UI

Read root `AGENTS.md`/`CLAUDE.md` and `docs/venturi-web/UX_SPEC.md`, `BRAND.md`, `API_CONTRACT.md` before changes.

- Vanilla JavaScript ES modules, native HTML and CSS first. No React, Redux, CSS framework, synthetic virtual DOM, generic event bus or build tool until justified by profiling/ADR.
- DOM for accessible controls, Canvas2D for timeline drawing, pure geometry functions for hit tests/snap. No parallel browser implementation of keyframes, blend modes, audio mixing or project persistence.
- No HTTP requests on `pointermove`. Use local drafts and commit once per pointerup/keyboard command; Escape cancels without server write.
- Time positions are integer frames + rational fps. Avoid seconds floats for edit authority.
- Use `textContent` or safe DOM APIs for media labels/prompts. Never trust backend data as HTML.
- Accessible focus order, keyboard shortcuts scoped away from inputs, visible status/errors, no hidden destructive operations.
- DevicePixelRatio-aware Canvas, redraw only when dirty, cull offscreen media, bounded image caches; measure before offloading to worker.
- MadRock-inspired colors only through `style/tokens.css`; do not hotlink logos/assets or infer brand font license.
- Browser tests for geometry, state machine, focus and command behavior; add test runner only when needed.
