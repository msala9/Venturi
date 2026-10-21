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
The owner identified SSD saturation as the workstation symptom on 2026-10-21.
Keep local activity to small source edits, focused reads, Git and short SSH
orchestration. Do not start local builds, renders, soak tests or browser GUI
qualification. Avoid recursive cache scans, large copies and full-log reads.
Use existing remote build artifacts and incremental source transfers. Resuming
development does not authorize resuming workstation qualification workloads.
Check shared-host memory headroom before heavy tests/builds. Make disposable
test/build processes sacrificial with OOMScoreAdjust=1000; never protect them
at the expense of inference or the live editor. Preserve global OOM evidence
and stop qualification work when the host is under memory pressure.

The one most likely to be missed:

## Tests

Unit tests do NOT go inline in the source file: they live in
`crates/<crate>/src/tests/<same path as the source>.rs`, pulled in with
`#[cfg(test)] #[path = "tests/<file>.rs"] mod tests;`. Never add an inline
`mod tests { … }`. Details in the "Where unit tests live" section of
`docs/BUILDING.md`.
