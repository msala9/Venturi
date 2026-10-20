# Codex Prompt 07 — AI Shot/Take review workflow

ROLE: fullstack product engineer. Work only after stable Source Viewer playback, safe edit commands, and program preview. Read UX_SPEC, CONSISTENCY, parity CSV and tests TS-021.

Implement versioned companion Shot/Take metadata without changing upstream `.vvproj` format or rendering engine. Assign stable human-friendly shot group ids; use real media ids and optional prompt/model/seed. Absent metadata must not prevent edit. User can manually group takes, favorite/reject a take, compare A/B with clear playback alignment, and search/inspect prompt.

Implement Replace Take as a single atomic operation: plan first, analyze length/fps/audio compatibility, display preserved/changed attributes, never silently retime or trim. Choose preserve timeline range when feasible; when new media shorter show explicit options (shorten with potential ripple, cancel, or other supported policy), protected by revision and undo. Do not switch linked audio without explicit choice.

Tests: missing metadata, renamed/relinked media, two takes different frame rates, shorter take, locked tracks, conflicted revision, undo restores all original ids/attributes, repeated command id no duplication. Minimal UX screenshots Review and editor Replace dialog.

STOP after proof; no auto-generation models or inference APIs in this slice.
