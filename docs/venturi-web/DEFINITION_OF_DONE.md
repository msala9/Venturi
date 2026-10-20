# Definition of Done

A milestone is accepted only if ALL relevant items are true:

- [ ] Delivered exactly the scoped behavior; did not silently implement the next milestone.
- [ ] Source paths and APIs match inspected local Venturi commit, not only this pack.
- [ ] Native `vv-app` still builds/tests as before; changes to shared crates covered by tests.
- [ ] Rust code/comments/docs/tests in English and tests follow upstream placement rule.
- [ ] No duplicated editing rules/browser video engine, no unnecessary framework or FFmpeg CLI pipeline.
- [ ] Server never silently overwrites clips on Safe Move; linked/locked/undo/ripple invariants tested.
- [ ] Every web edit is revision checked, idempotent and atomic (when applicable).
- [ ] All API routes validate paths and access, with bounded preview/export work.
- [ ] Browser controls keyboard/focus/ARIA and relevant screen sizes tested.
- [ ] UI handles slow network, stale previews, errors and offline media truthfully.
- [ ] Visuals follow proposed MadRock tokens, not gradients in media viewport; screenshots attached.
- [ ] Functional parity CSV row(s) updated with evidence/test; screenshot checklist updated.
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace` results reported (or explicit environment blocker), plus JS/browser tests.
- [ ] No drivers, ROCm stack, user media, original project file or root AGENTS rules overwritten.
- [ ] Commit created with concise change log, known limitations and next smallest step.

**Full product acceptance** requires 20-shot, multi-take montage on Windows, Linux headless R9700 composition, save/reopen, program preview with audio, export, recovery and no functional regression for supported upstream NLE tools.
