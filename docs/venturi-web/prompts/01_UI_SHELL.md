# Codex Prompt 01 — static web editor shell

ROLE: Frontend engineer / interaction designer. Scope ONLY layout and keyboard/focus with fixture data. Do not implement Rust service yet.

Read root agent rules, `docs/venturi-web/UX_SPEC.md`, `BRAND.md`, `SCREENSHOT_AUDIT.md`, G0 report. Use `web/style/tokens.css` and native ES modules/HTML/CSS; no React/Preact, CSS framework or production bundler.

Implement a semantic web shell with Projects page and single Editor containing tabs Edit/Color/Audio/Review; left panel tabs Media/Effects/Library/Presets/History; center Source/Program viewer placeholder; Inspector; bottom timeline placeholder; status bar; nonmodal Export placeholder; command palette.

Preserve desktop-feature discoverability from audit: Color wheels/scopes, EQ/mixer, curves, Slip, VAD, compound, shared library and OTIO must have clear navigational home, even if action disabled with `not implemented` tooltip. Do not create a polished but empty fake app that implies those features function.

Requirements: CSS Grid/resizable splitters with keyboard adjustment; panel collapse + sizes persisted as harmless browser UI state; keyboard focus / escape/space in text inputs; 1280×800 layout usable; no embedded outside branding logos or images. Include a fixture-based Media Library with Shot/Take grouping and explicitly labeled demo content. Display connection state as `Demo / no server`.

Proof: 4 workspace screenshots (1920×1080), 1280×800 screenshot, keyboard navigation test and document changed files. Browser test runner only if justified. Stop before drawing timeline clips or wiring server.
