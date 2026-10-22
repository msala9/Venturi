# Usable editing workflow — handover

## Open the candidate

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
