# Gate 0 — source audit

Date: 2026-10-20. Branch: `feat/venturi-web`. Upstream/fork base:
`b3b03bf25bf619226354dc0c71dce982071fbda3` (0.8.1).
Initial worktree contained only the 37 installer overlay files. Original
`AGENTS.md` and `CLAUDE.md` are byte-for-byte unchanged. Installer executed
with absolute paths and `--no-root-agents`, with no conflicts.

## Engine boundaries and evidence

The eight workspace crates are vv-core, vv-media, vv-render, vv-audio,
vv-session, vv-vad, vv-mcp and vv-app (`Cargo.toml:4`). vv-session has no
dependency on vv-app or egui (`crates/vv-session/Cargo.toml:12`). It does
depend on vv-audio/cpal, so ALSA build headers remain necessary even when
the web process never opens an audio device.

`Session` owns Project and History (`crates/vv-session/src/session.rs:19`),
applies native commands at line 60, exposes epoch at line 104 and content
revision at line 111. Project replacement resets history and bumps epoch;
revisions are content fingerprints, not monotonically increasing counters.
Undo/redo is global project history; a web history command therefore also
needs a project history generation precondition, beyond timeline revision.

Native edit functions are in `crates/vv-core/src/edit.rs`: split (79),
delete (159), global ripple delete (186), media insertion (447), generators
(526), move (565), trim bounds (596), trim (645), slip (697). Both insertion
and move call room-making code that **overwrites** occupied destinations.
Trim extension also overwrites neighbors. A web safe move/trim must validate
all final ranges, links, source bounds and locks before issuing a command.
`MoveClips::new` (`command.rs:1245`) itself is available without room-making.
`CompositeCommand` (`command.rs:98`) preserves one undo step.

`vv_core::save_project` (`persistence.rs:17`) serializes RON then calls
`std::fs::write`; it is not atomic. The host needs same-directory staging,
flush and rename, plus backup, without changing desktop persistence.

## Desktop capability inventory

The full panel/module inventory is `crates/vv-app/src/main.rs:9-54`.
The parity CSV maps every feature to actual source, including timeline UI,
transport, slip viewer, media pool/folders, library, presets, history,
properties, keyframe editor, masks/overlay, color wheels/scopes, mixer,
EQ, compressor, voiceover, VAD, export, relink and OTIO. The five screenshot
files were all inspected at their original resolution; see SCREENSHOT_AUDIT.
This is a source/visual audit, not an interactive desktop runtime test.

Important dependency seams: render-ahead, proxy, waveform, thumbnails,
transport clock and preview audio orchestration still live in vv-app.
Copying its playback loop into JavaScript would create a divergent engine.
Color grading command construction also lives partly in grade_panel; the
underlying grade/mask/animation model is already in vv-core. EQ/compressor
DSP is in vv-audio, while graphs/presets are in the native panels.

## MCP

The exhaustive tool enum is `crates/vv-mcp/src/tools.rs:8-49`; actual dispatch
is `dispatch.rs:99-190` and server registration `server.rs:71-328`.
Confirmed: projects, import/OTIO import, timelines/tracks, insert, split,
delete/range delete, destructive move, trim, static clip properties,
generators, links, markers, display color, masks/mattes, edge transitions,
render_frame, audio levels, export/status/cancel, undo/redo. `if_revision`
is optional in MCP edit DTOs and checked in edit_tools via ids::check_revision.
Web preconditions must be mandatory. No MCP request-id deduplication exists.
GUI-only: get_state, screenshot_ui, set_active_timeline. Missing direct tools:
safe move, keyframe/curve editing, mixer/EQ/compressor, color grading/scopes,
voiceover, library/presets, compound creation, slip/speed and OTIO export.
stdio/socket MCP is not HTTP.

## Headless rendering

`vv-session/src/export.rs:496` exposes `render_frame_rgba(project, timeline,
frame, size, compositor)` using the real exact decode/composition path.
`frame_provider.rs:211` handles GPU compounds; stack_layers is at line 343.
`vv-render/src/compositor.rs:1197` creates an independent device without a
window surface. It uses default adapter selection and panics on failure;
production host must probe explicitly and handle failure, with bounded jobs
on project snapshots. Export API is at `export.rs:300`; audio export uses
`audio_render.rs` and vv-audio mixing, requiring no Linux audio sink.

Ubuntu 26.04 WSL2 is available. `scripts/venturi-web-env.sh` ran read-only:
/dev/dri/card0 and renderD128 exist, but vulkaninfo/PCI enumeration were not
available at audit time. R9700/Strix Halo identities, hardware codecs and
GPU performance are **unverified**. No driver/ROCm/inference changes made.
Initial Windows rustc/cargo and WSL Rust/native media headers were absent;
toolchain/build dependencies are being installed. Baseline check/test results
will be appended to IMPLEMENTATION_STATUS once the environment is ready.

## Documentation corrections and decisions

ARCHITECTURE.md's opening claim of no color correction contradicts its later
feature list and grade_panel/color_window code. The pack's combined
speed-ramp/reverse/freeze exclusion is outdated for freeze: Clip::freeze
(`model.rs:1915`), SetClipFreeze (`command.rs:1138`) and speed_dialog exist.
Freeze gets a separate parity row; reverse/speed ramps remain unverified.
Proposed HTTP DTOs are new contracts, not MCP response formats.
The MadRock site could not be read by the web tool; tokens remain explicitly
provisional, with no downloaded brand artwork.

No critical blocker for CPU editing/static web work. GPU acceptance is
blocked on an identified, tested adapter. Proceed under the user's explicit
authorization: M1a shell, M1b local Canvas interaction, M2a host, M2b safe
project/session persistence, M2c preflighted native commands. Do not claim
M3-M7 complete from navigation placeholders. Avoid modifying any existing
desktop crate; add a host dependency boundary only.

No source implementation changes were made during G0.

## Verified runtime follow-up

The local check/test prerequisites were installed without GPU driver changes.
`cargo check -p vv-session` passed; vv-core 250 tests passed, vv-session
98 passed/1 upstream ignored. Local Vulkan is llvmpipe CPU (0x10005:0x0000),
Mesa 26.0.3, LLVM 21.1.8. This is baseline coverage, not target GPU validation.

The owner subsequently identified halo2 and authorized its use. Pinned SSH
access was reused from the lab helper without copying credentials into this
repository. Read-only PCI inventory confirmed R9700 at 67:00.0 (1002:7551)
and Strix Halo at 68:00.0 (1002:1586). Initially the node had no Vulkan loader,
ICD or FFmpeg runtime. The owner explicitly authorized adding Vulkan userspace
and multimedia dependencies; an apt simulation reported 0 upgrades/removals.
The existing kernel AMD driver, ROCm and inference configuration are preserved.
