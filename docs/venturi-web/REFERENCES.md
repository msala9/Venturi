# Verified references and freshness

Verified by opening public source pages on 2026-10-20; URLs reference mutable `master` and MUST be rechecked on the local commit before coding:

- Root and feature claims: https://github.com/VenturiVideo/Venturi
- Workspace members/version: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/Cargo.toml
- Root agent instructions: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/AGENTS.md
- Language/test/comment rules: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/CLAUDE.md
- Data model, GPU, workers, feature status: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/ARCHITECTURE.md
- MCP available / missing tools, overwrite semantics, revisions: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/docs/MCP.md
- Build deps/test placement: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/docs/BUILDING.md
- Session shape/revisions: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/crates/vv-session/src/session.rs
- Frame provider: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/crates/vv-session/src/frame_provider.rs
- Export: https://raw.githubusercontent.com/VenturiVideo/Venturi/master/crates/vv-session/src/export.rs
- Main UI feature imagery: https://venturivideo.github.io/Venturi/
- Requested screenshot directory (must inventory locally): https://github.com/VenturiVideo/Venturi/tree/master/media/screenshots
- MadRock reference: https://madrock.ai/ ; https://madrock.ai/brand/monogram.png

Known ambiguity: upstream `ARCHITECTURE.md` introduction has stale wording about color correction while its Feature status and README/site document color correction and scopes. Resolve from **current implementation** in Gate 0. Do not copy stale prose into feature status.

Important licensing: project GPL-3.0-or-later; if distributing modifications, consult license obligations. MadRock logo is not included. AI generated media sample fixtures are text-only, not brand-owned assets.
