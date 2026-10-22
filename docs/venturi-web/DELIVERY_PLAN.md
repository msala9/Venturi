# Completed delivery baseline — usable editing workflow

2026-10-22. This narrowed objective is accepted. The owner has now resumed the
full implementation plan: [COMPLETION_PLAN.md](COMPLETION_PLAN.md) controls
remaining work. This file preserves the completed workflow and its boundaries.

## Outcome

Deliver an accessible Venturi Web candidate in which the owner can assemble
video/audio, play the composed timeline with audio, save and reopen the same
project, and export a verified H.264/AAC file. Complete this coherent workflow
before returning to advanced parity work. Do not claim the whole native GUI
or the original implementation plan is complete.

## Working sequence

| Block | Work | Exit condition | Current state |
|---|---|---|---|
| A — editing and persistence | Reuse the verified candidate and existing small A/V sources. Import/place linked clips, move, trim, split, remove a gap, Undo/Redo, save and reopen. Fix workflow blockers together. | One project retains clip positions, links, sources and audio after reopen; ordinary editing is usable in the existing Windows browser. | Accepted: three linked segments, numeric trims, split, Cut/Paste move, gap closure, Undo/Redo and exact saved native state after reopen/restart. |
| B — playback and export | Use that same edited project for composed Play/Pause/seek with audio and native export. Fix integration defects as a batch. | Current images after edits; no obsolete autoplay; complete playback and a decodable H.264/AAC export with the expected duration, picture and audio. | Accepted: composed playback before/after edit, 72-frame H.264/AAC GUI export, full decode, source-cut audio comparison, download and actual exported-file browser playback. |
| C — handover | Keep the verified candidate accessible, with its project/source/output locations and concise running instructions. | A working URL and exact deployed commit, saved project and export are reported; candidate restart reopens the saved project. | Accepted: df50859 runs on bounded venturi-web-delivery.service at Windows port 8811; project/output retained, handover documented, protected main unchanged. |

Accepted evidence: [evidence/delivery-workflow.json](evidence/delivery-workflow.json).
Use [DELIVERY_HANDOVER.md](DELIVERY_HANDOVER.md) for the URL, deployed code commit,
saved project, export and operational instructions. This completes the narrowed
workflow, with the explicit qualification boundaries below.

Use a short multi-clip project first. Reuse existing fixtures, media and helpers;
do not create another test framework or start with a broad effects matrix.
Program playback across a five-minute window remains an explicit boundary:
verify a real continuation before claiming longer uninterrupted sessions.
The current implementation allows a visible preparation pause at a boundary;
gapless playback is not an exit requirement.

## One integrated acceptance scenario

1. Open the candidate in one existing Windows browser tab and create a project.
2. Import existing small video/audio sources and assemble several linked clips.
3. Move, trim and split clips; close a gap; check Undo/Redo in the same session.
4. Play the composed edit with audio, pause and seek, edit once more and replay.
5. Save, explicitly reopen, and check the saved clip placement and source links.
6. Export H.264/AAC through the GUI. Decode/probe the result on halo2 for video,
   audio and duration; play the accessible result in the existing browser.
7. Restart only the candidate, reopen the saved project and provide the URL,
   deployed commit, project and output locations with any remaining limitations.

Use existing prior proofs for unchanged components. Add focused regression
coverage only for a newly discovered blocker. Run the required regression/build
checks once per coherent code block, then perform one integrated browser pass.
Repeat only the failed/changed portion unless it invalidates the whole workflow.
Documentation-only planning changes require no build or test run.

## Deferred work

Full closure of the 90-row parity ledger, exact native track-pane layout,
additional DPI/device matrices, advanced Color/scopes, processed compound-audio
edge cases, physical voiceover/device qualification, additional AI Review work,
native preset/compound sharing through the 14 TB NAS, optical-flow qualification
and the broad release soak are backlog. Existing capabilities remain available.
Fix them now only when they block the workflow above. Existing HTTP NAS media
catalog integration can be used; do not change mounts or scan the archive.

## Resource and session constraints

- No Windows builds, renders, heavy tests, large copies or cache scans. Use the
  existing Windows browser, one tab; no browser installation on halo2.
- One halo2 workload at a time. Check at least 8 GiB available memory before
  builds/GPU work. Use one CPU, at most 4 GiB RAM, no swap, OOMScoreAdjust=1000,
  low CPU/I/O priority and finite qualification runtimes. Reuse cached tools.
- Acquire /tmp/HALO_BENCHMARK.lock nonblocking for GPU work. If occupied, do
  independent source work; never wait-loop, steal the lock or affect inference.
- Preserve the main editor's five unsaved MoveClips operations and Undo history.
  Use a separate candidate project root and port. Activating a usable candidate
  does not authorize saving, replacing or restarting the protected editor.
- Candidate handover needs an explicit resource-limited runtime configuration;
  a stopped finite qualification service is not a usable deployment.

## Reporting and completion

Report blocks A/B/C as pending, in progress or accepted, with the exact remaining
defects and candidate deployment state. Do not publish subjective completion
percentages or treat test/commit counts as delivered features. The previous
12–24-hour workflow estimate is uncertain, not a deadline; revise it using
observed blockers rather than silently retaining it.

The goal is complete only when all three block exit conditions pass. Advanced
parity remains explicitly deferred rather than relabeled as finished.

The narrowed app goal was completed on 2026-10-22. A new active goal now pursues
the full remaining scope through COMPLETION_PLAN.md without losing this baseline.
