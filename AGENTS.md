# Instructions for AI agents

The project rules for agents are in [CLAUDE.md](CLAUDE.md) and apply to
every agent, not just Claude: read it before making changes.

## Owner workstation resources

The owner reported that local builds, preview servers and concurrent tests made
the Windows PC unusable. Keep heavy compilation, rendering and soak tests off
this workstation. Use halo2 with explicit resource limits, one build job and low
priority. Local file edits, Git and short SSH orchestration remain appropriate.
Do not restart local test fleets or reopen multiple browser test tabs. Preserve
unsaved sessions when stopping test processes. On halo2, preserve the live editor
and all foreign inference workloads; GPU use still requires its shared lock.

The one most likely to be missed:

## Tests

Unit tests do NOT go inline in the source file: they live in
`crates/<crate>/src/tests/<same path as the source>.rs`, pulled in with
`#[cfg(test)] #[path = "tests/<file>.rs"] mod tests;`. Never add an inline
`mod tests { … }`. Details in the "Where unit tests live" section of
`docs/BUILDING.md`.
