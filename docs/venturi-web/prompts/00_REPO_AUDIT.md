# Codex Prompt 00 — verify the real source tree first

ROLE: Staff engineer and maintainability reviewer. Work in the current Venturi repository. THIS TASK IS AN AUDIT, NOT FEATURE IMPLEMENTATION.

Read and obey `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `docs/BUILDING.md`, `docs/MCP.md` and all files in `docs/venturi-web` relevant to this step. Record `git rev-parse HEAD`, branch, dirty status and workspace members. Do not discard changes or alter existing code.

1. Inventory and visually inspect every full-resolution image in `media/screenshots`; fill `docs/venturi-web/SCREENSHOT_AUDIT.md` with filenames, visible controls, associated source file(s), target panel and parity row IDs. Add missing features to CSV.
2. Map the actual native `vv-app` module/panel tree to `vv-core`, `vv-session`, `vv-media`, `vv-render`, `vv-audio` and `vv-mcp`; find real definitions (not guesses). Check existing commands for safe move vs overwrite, ripple insert, keyframe, color, mixer, history and compound, include line references.
3. Verify `vv-session::Session` owns project/history and frame/export entry points. Inspect exact headless GPU creation requirements. Record whether a new web crate can depend on `vv-session` without depending on `vv-app` GUI.
4. Verify upstream MCP tools, particularly `insert_clip`, `move_clips`, `render_frame`, `export`, `if_revision`, and documented missing operations. Flag docs that disagree with current source.
5. Check existing root AGENTS and CLAUDE conventions. Do not override them. Check `cargo check -p vv-session` and baseline tests when environment allows, recording exact pass/fail/error messages.
6. On local Ubuntu only: run `scripts/venturi-web-env.sh`; report R9700 and Strix Halo GPU PCI ids without changing the OS/ROCm stack. If unavailable, mark hardware unverified.
7. Update `FUNCTIONAL_PARITY.csv` `verified_source_path` with exact paths, and `desktop_status` or `mcp_status` only with code evidence. Create `docs/venturi-web/G0_REPORT.md` based on `G0_REPORT_TEMPLATE.md`. Update implementation plan if needed.

STOP after documenting evidence. Do NOT add `vv-web` or start implementing HTTP routes. Present uncovered GUI features, contradictions, highest risks, baseline test results and the smallest M1/M2 decisions needing approval.
