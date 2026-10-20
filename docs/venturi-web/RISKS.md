# Risks and mitigations

| Risk | Severity | Mitigation / test |
|---|---|---|
| Browser preview differs from native composite | critical | exact frame reference and pixel tests; don't substitute source proxies for program preview |
| Accidental overwrite via MCP move/insert | critical | safe move preflight; explicit overwrite mode; collision tests |
| Web edit duplicate after network timeout | critical | idempotency key and query status; no automatic fresh-id replay |
| Arbitrary path access or symlink escape | critical | tokenized root-scoped filesystem API; negative tests |
| `vv-app` regression due to shared refactor | high | keep first PR additive, focused extraction and full cargo tests |
| GPU R9700 selection wrong / llvmpipe | high | probe and log PCI/device; deterministic wgpu adapter test |
| Preview readback OCuLink cost | high | benchmark R9700 vs iGPU end-to-end before dual-device pipeline |
| Browser A/V drift / preview cache invalidation | high | audio-master clock, frame-stamped segments, stale tags, seek tests |
| Headless Rust build requirements on Ubuntu | high | verify FFmpeg/libclang/Vulkan per upstream BUILDING, no blind system upgrades |
| Upstream master changes during implementation | high | pin git SHA per milestone, re-run Gate 0 on rebase |
| Native feature list larger than pack | medium | full screenshot and source control audit before claiming parity |
| Web voiceover mic differs from Linux cpal | high | capture/browser permission/upload and sync plan; mic never assumes host hardware |
| MadRock brand tokens only visually inferred | medium | obtain approved brand system; preserve proposals until approved |
| GPL redistribution and brand rights | medium | preserve license, avoid embedding third-party marks by default |
| Feature creep / meta-framework built in vanilla JS | medium | ADR budget, direct modules, reassess Preact only with profiling/design evidence |
