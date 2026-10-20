# Codex Prompt 08 — release-readiness audit, no large features

ROLE: release engineer and security reviewer. Review rather than implement.

Verify all release gate rows and `DEFINITION_OF_DONE.md`: document missing P0/P1 parity, test and performance evidence; run Rust fmt/clippy/workspace tests, pure JS tests and browser E2E; inspect unsafe paths, XSS, origin/host, idempotency, server file permissions, GPU queue bounds. Verify new binary starts without any Linux desktop, and from Windows over `ssh -L` with browser. Check current R9700 adapter and encoder test results; report hardware fallbacks clearly. Run 20-shot multi-take workflow with media originals, linked audio, titles, effects, masks, export, reload and recovery; document A/V issues.

Measure timeline draw FPS at 500 clips, 1280×800 and 1920×1080 UI; check madrock theme contrast, focus, keyboard, screenshots vs native UI audit. Review original Venturi GPL notices, other copied assets and brand rights. Document `systemd --user` optional service, stop/start behavior and recovery.

Output `RELEASE_CHECKLIST.md`: pass/fail/blocked for each criterion, changelog, source evidence and minimal follow-up issues. **Do not mark release ready with failing critical safety or source-overwrite tests.**
