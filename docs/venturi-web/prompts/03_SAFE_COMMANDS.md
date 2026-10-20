# Codex Prompt 03 — revisioned safe edit command bridge

ROLE: Rust editor-core engineer. Scope ONLY safe command mutations (split, trim, delete/ripple, undo/redo, safe move) and save. Do not add generic edit commands or preview.

Read and obey `docs/venturi-web/API_CONTRACT.md`, `CONSISTENCY.md`, `TEST_PLAN.md`, `ARCHITECTURE.md`, existing `vv-core` commands and `vv-session` revisions, G0 findings.

Implement explicit `POST /api/v1/timelines/{id}/commands` with `command_id`, project epoch, `if_revision`, typed operation enum and idempotent lookup. Validate frames, target ids, linked groups and locked tracks. Single Session actor serializes writes. Use a *safe_move* operation that rejects occupied destinations, never silently forwards a normal drag into upstream `move_clips` destructive overwrite. Verify existing `MoveClips`/overlap semantics by code and unit tests. If safe move cannot be implemented without a new `vv-core` command, create the smallest safe change with baseline tests; avoid multi-command partial mutation.

Implement persistent saving respecting upstream RON format, add atomic backup/recovery only after investigating the actual `vv_core::save_project` filesystem behavior. Simulate network-response loss: repeated command ID must never create duplicate mutations. Include 409 revision conflict, 409 overlap, locked track and linked-group cases, one undo step per gesture. Add clear browser client bridge only if backend proof passes.

STOP before WebRTC, proxy, effects, keyframes or advanced timeline UI. Update parity CSV and report exact test outcomes.
