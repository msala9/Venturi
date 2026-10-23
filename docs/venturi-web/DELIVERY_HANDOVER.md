# Usable editing workflow — handover

## Current halo1 Effects and Title delivery — 2026-10-23

Current Effects/Title delivery: **http://127.0.0.1:8842/**, source `4ad4ad1`
(main feature `086ad60`), binary `dfb6b7081bbd`, service
`venturi-web-halo1-effects-placement-r2.service`. The Effects palette now places
native Title/Solid/Adjustment generators on chosen timeline targets and applies
filters to the pointer clip, adding or enabling them in place. Generator clicks
choose a free unlocked video lane or add one. Track creation/insertion is one
Undo; safe overlap, locks, linked/crossing and context guards remain. The native
BlackAndWhite entry is available. Title typography discovers server-native
families and styles lazily, preserving unknown Saved values and individual
changed-field selection semantics; manual fields stay collapsed.

The bounded gate passes 40 native and 111 client cases, formatting, all-target
Clippy and embedded build (peak 1,945,440,256 bytes). Actual Windows found and fixed
a monochrome click scope error; its JS-only rebuild reuses unchanged gate results.
Actual browser editing creates all three generators, selects DejaVu Serif/Bold,
verifies text and filter Undo/Redo, preserves seven original clips, and saves and
reopens `Venturi_Effects_V1.vvproj` with empty Undo. The 701-frame Full HD H264/AAC
export reaches actual browser EOF 29.226 seconds/ended=true, using x264/CPU decode
and R9700 Vulkan composition. Current runtime peak is 495,550,464 bytes.
All 26 earlier Sessions, 27 PIDs and 19 Saved files, local/NAS originals and shared
proxy movie are preserved. A pagehide-only Saved playhead update was hash-guarded
back to the exact previous Saved bytes without changing its Session/history.
See `evidence/f3-palette-fonts-workflow.json` and workspace/export images.

Physical HTML drag/DPI, menu-hover preview and full F1-F7/M7 acceptance are not
claimed. Ledger stays **49 done / 41 partial / 2 excluded**. Heavy work remains
halo1-only with 8 CPU/4 GiB/no swap and low priority; Windows uses one existing tab.

## Earlier working version — 2026-10-22

Open **http://127.0.0.1:8814/** in the existing Windows browser. Code
`3952711ff4ed6857b93b5316b189fd23c652ae14` includes the native editing gestures,
mask Inspector/Viewer pen, linked Slip, folder import/recovery and compact
Library panel. The actual Windows page displays a completed 960×540 R9700
preview and the two native sample assets. The ds4 HTTP archive is configured
and currently returns 33 catalog items.

The enabled service is `venturi-web-current.service`, with one CPU, 4 GiB maximum,
zero swap, low CPU/I/O priority and the shared nonblocking GPU lock. Project
`Venturi_Workspace.vvproj` lives in `/home/marco/VenturiWeb-current-20261022` and
starts Saved with empty Undo history. It is a separate copy of the previously
Saved native UI project; all three earlier editors and their drafts remain.
Preserve this new editor too once the owner begins work.

See `evidence/current-workspace-delivery.json`. The complete F1–F7 plan remains
active. Native catalogs currently use an explicitly configured local library
root; canonical NAS sharing/filesystem qualification and the remaining physical,
long-workflow and release criteria are still open.

## Earlier native-style interface — retained

Open **http://127.0.0.1:8812/** in the existing Windows browser. The enabled halo2
service is `venturi-web-native-ui.service`; it uses one CPU, at most 4 GiB,
no swap and the existing shared GPU lock. Code:
`f3dcf1c8b6fed838c7e48497922f127b96f9c35b`. Binary SHA-256:
`2aea785298d32a54ee615972c6e6a0c2398023abf09eb0f7308bf4b191aae034`.

The compact native menus, Media/Effects toolbar, contextual Video/Audio/Selection
Inspector, large central Viewer and docked timeline are now available. File
contains project open/save/import/export. View contains Library, Presets,
History and optional diagnostic panels. On narrow windows Media and Properties
open as explicit drawers. All three splitters remain keyboard accessible.

The current project is `Venturi_Native_UI.vvproj`, timeline **Native montage**,
in `/home/marco/VenturiWeb-f1-20261022`. This separate root also contains the
qualified editing/effects/compound projects. New UI evidence and screenshots:
[evidence/native-ui-workflow.json](evidence/native-ui-workflow.json).

Port 8811 now has an unsaved InsertClips edit; its old service and existing tab
were preserved. Port 8790 also retains all five unsaved moves. Do not reload,
restart or save these other editors to upgrade their appearance. The new
interface does not contain their unsaved changes. The existing 8812 Windows
tunnel must remain connected. Save any new work before restarting only
`venturi-web-native-ui.service`. Its previous binary remains available for rollback;
never apply rollback or restart commands to either protected editor.

## Earlier usable workflow baseline (port 8811)

Current Windows URL: http://127.0.0.1:8811/ through the existing SSH connection.
The separate halo2 service is `venturi-web-delivery.service`, listening only on
127.0.0.1:8811. It has one CPU, 4 GiB memory, no swap and low CPU/I/O priority.
GPU operations require the shared nonblocking /tmp/HALO_BENCHMARK.lock.

Deployed code commit: `df508593a311d80e37e57af97022c7fdb443b06e`.
Deployed binary SHA-256:
`b44a6174036c0291676bc493a0992d52c668f25f0cf3d3313212b9aa9536ae64`.
Integrated evidence: [evidence/delivery-workflow.json](evidence/delivery-workflow.json).

The protected editor on port 8790 retains its five unsaved moves and original
Undo history. This delivery uses a separate project root and service.

Open `Venturi_Editing_Delivery.vvproj` and select **Editing delivery** in
**Active timeline**. The project also contains its original empty Timeline 1.
The demo uses 64×64 output and a three-second edit to keep qualification small;
it does not change the application's normal new-project resolution.

Project root on halo2: `/home/marco/VenturiWeb-delivery-20261022`.
Saved project: `Venturi_Editing_Delivery.vvproj`.
Source: `venturi-smoke.mp4`, an existing two-second H.264/AAC A/V source.
Export job: `1792655870910606546` in the Export drawer's **Saved exports**.
Output: `.exports/1792655870910606546/program.mp4` inside the project root.
The Windows browser downloaded the same result as
`C:\Users\marco\Downloads\venturi-export (8).mp4`.

## Editing and checking output

1. Use Projects to create/open a project. Place media directly in this server
   project root, then use Import media; the existing Library tab also provides
   the ds4 catalog. A Windows local file path is not a halo2 source path.
2. Select the source and use Insert media. Video/audio are linked. Select a clip
   to trim numerically in Inspector, use Split at the playhead, Cut/Paste to
   move a linked selection, and select a gap to close it. Undo/Redo restore edits.
3. Use Program Play/Pause, frame stepping and timeline seeking. After changing
   an edit, playback prepares the current composition; the old movie is not
   authoritative for the new edit.
4. Save, then explicitly reopen from Projects. Select the intended Active
   timeline when the project contains multiple timelines.
5. Export the whole timeline or an explicit frame range with audio enabled.
   Wait for READY, then download the MP4 or choose **Preview exported video**
   and use its native playback controls. Preview is explicit, with no autoplay;
   closing the drawer releases it. Program, Source and result playback stop
   each other to avoid overlapping audio. Saved outputs survive candidate restart.

## Verified scope and remaining limits

The integrated Windows workflow imports a source, assembles three linked A/V
segments, trims, splits, moves by Cut/Paste, closes gaps and uses Undo/Redo.
Full native timeline/media state and saved file bytes match after explicit
reopen and service restart. Composed playback completes with browser audio
enabled; a post-playback edit produces a new movie with the updated duration.

The GUI export contains 72 decodable H.264 frames at 24 fps and stereo AAC at
48 kHz. The three output audio segments correlate above 0.9998 with their
expected source ranges. The downloaded file is 73,012 bytes. These checks do not
measure physical speaker/display latency or complex high-resolution throughput.

Physical Canvas drag/DPI qualification, advanced parity, the 14 TB native asset
store and broad release soak remain deferred. Program ranges use at most five
minutes with a visible preparation pause; actual multi-window browser playback
has not yet been qualified. No gapless playback claim is made.

## Operations

On halo2, inspect `systemctl --user status venturi-web-delivery.service`.
Restart only this candidate with
`systemctl --user restart venturi-web-delivery.service` after saving its project.
It automatically reopens the last saved project. Completed exports remain in
its project root. Never substitute the protected port-8790 service in these
commands.

The current Windows SSH tunnel must remain connected for the URL to work. If it
has exited, the existing workstation helper
`python K:\AI-lab\venturi\start-windows-ui-tunnel.py` restores port 8811 using
the already configured halo2 access; do not run it while that port is occupied.
No browser installation, Windows build or local rendering is needed.

Use the delivered candidate tab when available. A second tab may be read-only
while the first holds its writer lease. Close the other candidate tab and use
Reconnect after its lease expires; the protected port-8790 editor is independent.
