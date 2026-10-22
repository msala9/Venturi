# Instructions for AI agents

The project rules for agents are in [CLAUDE.md](CLAUDE.md) and apply to
every agent, not just Claude: read it before making changes.

## Owner workstation resources

The owner reported that local builds, preview servers and concurrent tests made
the Windows PC unusable. Keep heavy compilation, rendering and soak tests off
this workstation. On 2026-10-22 the owner requested moving work to free halo1
because halo2 is shared with an H3 agent; halo1 already mounts the NAS.
Prefer halo1 for new development/qualification after its prerequisites are ready.
Preserve existing halo2 editors and artifacts; do not migrate their dirty state.
The owner explicitly authorized up to eight CPUs on halo2 earlier that day.
Retain bounded build concurrency on halo1, with explicit RAM/I/O limits and low
priority; retain the no-swap and one-heavy-workload-at-a-time policy. Local file
edits, Git and short SSH orchestration remain appropriate.
Do not restart local test fleets or reopen multiple browser test tabs. Preserve
unsaved sessions when stopping test processes. On halo2, preserve the live editor
and all foreign inference workloads; GPU use still requires its shared lock.
The owner identified SSD saturation as the workstation symptom on 2026-10-21.
Keep local activity to small source edits, focused reads, Git and short SSH
orchestration. Do not start local builds, renders, soak tests or browser GUI
qualification. Avoid recursive cache scans, large copies and full-log reads.
Use existing remote build artifacts and incremental source transfers. Resuming
development does not authorize resuming workstation qualification workloads.
The owner clarified that browser checks must use the existing Windows browser
environment, one tab at a time. Do not download or install browsers on halo2.
Keep compilation, rendering and heavy test workloads on resource-limited halo1;
small browser interaction checks on Windows are authorized.
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
