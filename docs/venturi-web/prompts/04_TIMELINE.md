# Codex Prompt 04 — fluid Canvas2D timeline

ROLE: Frontend graphics / UX engineer. Scope timeline user interaction with fixture data first, then read-only snapshot integration when available.

Read `docs/venturi-web/UX_SPEC.md`, `BRAND.md`, `TEST_PLAN.md`, `API_CONTRACT.md`, G0 findings and root agent files. Implement pure `frameToX`, `xToFrame`, `visibleRange`, `hitTest`, `snapFrame` with rational FPS/frame coordinates; test with 24000/1001 and 30000/1001. Use Canvas2D DPR scaling, rAF redraw only when dirty, visible-range culling of >500 fixture clips. DOM accessible track list for keyboard manipulation, native tooltip/menus where possible.

Implement explicit gesture states for select/multiselect, lasso, scrub, drag ghost, trim ghost, zoom/scroll, snap and Escape cancel; pointer capture and focused-text isolation. Default drag is **safe move**, with invalid drop indicator on overlap. Use no RPC while pointer moves. At pointerup, send exactly one API command (only after M2c endpoint confirmed); show optimistic draft -> waiting -> authoritative success/reject, restore on conflict. No fake successful edits.

Tests TS-002, TS-006, TS-007, TS-014, TS-015. Profile scroll, zoom, 500 clip drag under realistic Windows scaling (report platform); document fallback metrics when unable to run on Windows.

STOP before adding transition/speed effects or a second editing engine. Attach interaction video/screenshot evidence and updated parity rows.
