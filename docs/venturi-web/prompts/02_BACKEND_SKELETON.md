# Codex Prompt 02 — minimal Rust vv-web host

ROLE: Rust backend engineer. Scope one thin HTTP shell and read-only session DTOs. NO editing commands or GPU preview.

Inspect existing workspace Cargo conventions; read `docs/venturi-web/ARCHITECTURE.md`, `API_CONTRACT.md`, `SECURITY_DEPLOY.md`, G0 report. Add `crates/vv-web` as a new workspace member with only justified dependencies (Axum/Tokio/Serde if needed). Keep `vv-app` and existing crates unchanged except the workspace Cargo manifest and focused shared API improvements proven necessary.

Implement `GET /api/v1/health`, static asset serving from `web/` with explicit MIME types, and read-only `/api/v1/session` `/api/v1/timelines/{id}` only if actual `vv-session` API can be used without inventing types. Prefer one actor owning Session; do not hold lock across long operations. If read-only session routes require substantial refactor, stop at health and report the exact blocker. Provide a CLI bound to `127.0.0.1:8787` by default and a documented narrow `--listen` override; no public listening by default.

Use an allowlisted media/projects root abstraction even if no writes are implemented yet. No unsafe path parameters and no arbitrary file system browser. JSON error envelope and bounded response sizes. Add tests in upstream Rust test layout; verify `cargo check -p vv-web`, `cargo fmt --check`, `cargo clippy` and workspace tests (or blockers). Do not claim GPU tested.

STOP after read-only backend smoke and tests. Report exact API schema deltas before building command mutations.
