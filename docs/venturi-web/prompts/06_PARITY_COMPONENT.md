# Codex Prompt 06 — one native UI parity slice at a time

ROLE: fullstack engineer. Choose EXACTLY ONE row/group from `FUNCTIONAL_PARITY.csv` marked P1, prioritize highest user value and server readiness. Do not implement Color+Audio+Effects in one pass.

Inputs: native `vv-app` source implementation, chosen `vv-core` command(s), `vv-session` API (if any), `docs/MCP.md`, screenshot audit, selected parity rows.

1. Identify actual native UI interactions, fields/ranges/defaults and undo behavior; record source path.
2. Decide if feature is frontend-only, MCP-available, Session API, extract from vv-app worker or needs new core command. Refuse to create JS parallel algorithms.
3. Implement small API command and panel with actual binding, explicitly disabled incomplete functions.
4. Add tests for correct backend behavior, revisions, undo, linked clips, locked tracks, GPU/audio behavior when applicable. Update error/recovery UI.
5. Update CSV `web_status=done` ONLY with code+test+proof; add screenshot/short demo.

Suggested slice order: masks and blend modes, slip viewer, keyframes/curves, compound clips, presets/shared library, history jump, Smooth Cut, Color wheels/scopes, Mixer/EQ/compressor, silence VAD, OTIO export, voiceover browser mic. Exact order can change after G0.

STOP after one slice. Return follow-up issue for the next smallest slice.
