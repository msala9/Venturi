# Agent rules for the new `vv-web` crate

Read root `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and `docs/venturi-web/ARCHITECTURE.md` first. Repo-wide rules take precedence.

- Code, tests, docs, comments and commit messages in English. Short comments only for *why*.
- Rust tests in `src/tests/...`, never inline `mod tests {}`. Use `#[cfg(test)] #[path="tests/file.rs"] mod tests;` after verifying correct path.
- Keep `vv-web` a thin HTTP adapter around `vv-session`, not a second edit engine. Use explicit enums/handlers and validated DTOs.
- Never hold the mutable `Session` across long async GPU frame operations. One session actor serializes mutations, async workers receive snapshots.
- Every stateful write checks project epoch, timeline revision (when relevant) and idempotency key; no silent overwrites on drag, no partial linked-clip modifications.
- No unrestricted filesystem paths, shell command interpolation or default public listener.
- Distinguish preview staleness from current output; bound GPU concurrency and memory.
- No WebRTC, frameworks, default background services or new video codecs without measured need/ADR.
- Do not add GPU driver installation into app code; report capability and fallback truthfully.
- halo2 is shared with agents testing DeepSeek 4.1 Flash inference. Every new GPU path must respect `/tmp/HALO_BENCHMARK.lock` with nonblocking ownership and return busy when another workload owns it. Never delete the shared lock, stop foreign jobs, take their ports or change inference configuration.
- Deliver small tests for each new command and state machine failure path.
