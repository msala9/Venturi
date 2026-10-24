# Usable editing workflow — handover

## Current owned delivery — 2026-10-24

Use **http://127.0.0.1:8855/** in the existing Windows browser and keep its
existing SSH tunnel (captured PID 23536). Tested source is
`b8d6133dda5d8194ebb945d47169e7656fa9d088`; the transient system-manager unit is
`venturi-web-halo1-inspector-choice-modes.service`, captured PID 351463, running
unprivileged as `halo:halo`. Use plain `systemctl` to inspect this unit, not
`systemctl --user`.

Executable `/home/halo/.local/share/venturi-web/.runtime/vv-web-2dbc9697d6e7`
has SHA256 `2dbc9697d6e77b0e60a415a0e04c85bf751a6d9174f63bfa0aec12aaedc67f94`.
The project root is `/home/halo/VenturiWeb-color-audio-controls-20261023`;
`Venturi_Library_Replacement_V1.vvproj` was Saved with empty Undo/Redo at the
checkpoint. Re-read live state before any operation: this may since have changed.

[RUNNING.md](RUNNING.md#current-working-instance--2026-10-24) contains the actual
CLI, environment, bounds, identity checks and runback procedure. Refuse restart
or runback when Unsaved, when Undo/Redo is nonempty, or while client drafts,
unresolved commands, capture/playback or jobs remain active. Save alone does not
clear history. Preserve the 39 prior Sessions/40 PIDs, 11 Saved files, NAS
assets/presets and shared proxy; no background enablement or driver/browser
changes are authorized by this handover.

The immutable prior source `2c587b7` and binary `vv-web-9a619eebab31` are retained
for guarded runback; the full path/hash and verification steps are in RUNNING.md.
Selecting that binary does not restore live Undo or unsaved state. Full F1-F7/M7,
the final soak and reboot/runback acceptance remain open.

## Historical workflow deliveries

The sections below retain version-specific proof. Their URLs, process IDs and
limits are historical, not instructions to operate or restart the current
editor. Leave those protected instances untouched; follow the current runbook.

### Preserved native transition controls — 2026-10-23

Open **http://127.0.0.1:8853/**, source `1e6d910`, binary `9d4623b93873`, service
`venturi-web-halo1-transition-controls.service` (PID230298). Saved project
`Venturi_Transitions_UI_V1.vvproj` opens Timeline2/frame30 with empty Undo.
Its first Push is Left/duration10/curve0.78601694; other timeline contents are
preserved. Selected transitions have paired seconds/frames scrubbing, an inline
curve slider, direction/ease preview menus and closed-wheel changes. Cancel
restores the exact confirmed Viewer image without changing the project/history.

Actual Windows verifies preview/cancel/one-confirmed-Undo, direct duration/curve
pointer edits, Undo/Redo, panel close/reopen and exact Saved reopen.3native/47client,
formatting, all-target Clippy and bounded halo1 build pass. Earlier37 editors/
38 PIDs, NAS assets, media copies and proxy remain unchanged;8852 is preserved.
See `evidence/f3-transition-controls-workflow.json`,
`f3-transition-direction-preview.png` and `f3-transition-controls-workspace.png`.

The ledger remains **52 done /38 partial /2 excluded**. Native transition control
implementation is delivered; shared physical drag/copy/replace, closed-wheel/
blur and100%/150% qualification remain explicit. Prior native fullHD export proof
is reused for the unchanged pipeline; this edited UI project was not re-exported.

## Preserved halo1 retime/transitions delivery — 2026-10-23

Open **http://127.0.0.1:8852/**, source `0bc344c`, binary `a4b48324385d`, service
`venturi-web-halo1-retime-transition-ui.service` (PID223042). Saved project
`Venturi_Retime_Transitions_V1.vvproj` opens Timeline2/frame152 with empty Undo.
Four linked moving-video segments use150%/50%-with-pitch/200%/100%; native
Push/Dissolve/SmoothCut8 cross the three cuts. Right-End speed dragging now also
works through the clip body. Source insertion options fit the actual Viewer.

Export1792770341063976604 is durable:200frames,1920x1080 H264/AAC. Its entire MP4
and decoded AAC are byte-exact to a native Timeline2 export. MP4 SHA:
`85d113a2c72217c20af0b50fa7572c7b2430859e41be106ec55ef91a5480b57f`.
The Windows download reaches natural8.341s EOF. Eight native/API images and four
audible PCM samples also match; moving SmoothCut differs from native Dissolve.
See `evidence/f3-retime-transitions-workflow.json` and its two workspace images.

The ledger is **52 done /38 partial /2 excluded**. Pitch processing is accepted;
native transition controls were still pending at this checkpoint and are now
delivered above. Physical transition actions and100%/150% mapping remain open.
Earlier36 editors/37 PIDs, NAS assets and proxy are preserved. Only this owned,
Saved/empty-Undo qualification process was replaced during the guarded upgrade.

## Preserved halo1 native font/effects delivery — 2026-10-23

Open **http://127.0.0.1:8851/**, source `9a946dd`, binary `da479e56f98c`, service
`venturi-web-halo1-effects-montage.service` (PID214422). The Saved project is
`Venturi_Effects_Montage_V1.vvproj`, at frame48/title
properties. Font choices preview without a project edit; Escape/outside cancels,
click/Enter confirms once. Prior editors and their histories remain alive.

Export1792767150513614515 is durable:701frames,1920x1080 H264/AAC,29.226s browser
duration. Web/native MP4 SHA is
`68e6e0e279edf595d0140d3d074f6ef1b00e24baa9687b6de9b4ab4f5bf54056`.
Windows download and natural EOF pass. Evidence and remaining scope are in
`evidence/f3-effects-montage-workflow.json` / COMPLETION_PLAN.md.
The ledger is **51 done /39 partial /2 excluded**, not full-plan completion.

## Preserved halo1 saved-preset Delete delivery — 2026-10-23

Preserved saved-preset permanent Delete delivery: **http://127.0.0.1:8850/**,
source `ebbafda`, binary `78c6f86a346b`, service
`venturi-web-halo1-preset-delete.service`, PID 211545.
Confirmed active/archived removal binds the captured revision, shared lock and
strict owner/version-2 intent; durable receipts recover retries/restarts without
re-deleting a replacement or changing project dirty/Undo state.
**41 native / 63 client cases pass**; after the sole R1 Clippy style failure,
R2 passes Clippy (8.07 s) and build (41.00 s), reusing unchanged tests; peak
1,524,707,328 bytes. Destructive/recovery checks use owned Linux fixtures.
Actual Windows verifies compact actions, captured-name confirmation, Cancel,
list Delete and Escape; no NAS preset is deleted. Saved reopen leaves
`Venturi_Preset_Delete_V1.vvproj` at frame 0/empty Undo, SHA
`cc94bfc1b772598bacaa73de29421d045c3cb050b247da877c41e0b3082a5aff`.
All 34 prior Sessions/35 PIDs/35 Saved files/34 originals, five new local copies,
four fixed NAS files and the old proxy are unchanged; runtime peak 219,017,216
bytes. See `evidence/f5-preset-delete-workflow.json` and
`f5-preset-delete-confirm.png` / `f5-preset-delete-workspace.png`.
No new export or full M7 acceptance is claimed. Both F5 rows remain partial;
the ledger stays **49 done / 41 partial / 2 excluded** and the full goal is active.
Next complete connected effects/font/background, moving Exposure/Blur/Shadow,
Adjustment interval and audio-fade output behavior, including native font preview;
reuse already-qualified default-font and three-transform-frame proof.

Preserved portable Library copies and preset activation delivery:
**http://127.0.0.1:8849/**, source `efd5f59` (feature `5a856e4`), binary
`80c54dbc8eb2`, service `venturi-web-halo1-library-copies-r2.service`, PID 209284.
Native Add to Project uses readable `library/<originalname>` copies, native
legacy-name handling and collision suffixes, with full-byte verification,
confined publication and pinned destination witnesses. Existing flat copies and
saved projects are unchanged. Saved presets apply through Enter or double-click
using the existing native command and current selection; project reopen refreshes
the epoch-bound panel instead of leaving Apply stale.

Actual Windows imports two native NAS assets as readable media 13 and compound
media 14/child timeline 4, verifies cached no-op and Undo/Redo, and plays Source
to EOF at 5.184 seconds. The shared preset applies DropShadow to Solid 14 through
Enter/double-click, with Undo/Redo and Save As/reopen. Apply remains enabled after
the project epoch changes, without manual Refresh. The bounded gate covers
**58 native cases** (54 reused and four affected cases) and **114 client cases**;
syntax, formatting, all-target Clippy and embedded build pass. The final JS-only
gate reuses unchanged native/Clippy results, builds in 40.13 seconds and peaks at
1,526,898,688 bytes. No new export or physical drag/DPI qualification is claimed;
unchanged render/audio/export evidence is reused.

Final `Venturi_Library_Copies_V1.vvproj` is Saved/frame 0/empty Undo, SHA
`2fa1646d5cc282abf5f7d1437c57745edc1f804b6312f7b3a4217e0dba3b7b6c`.
All 33 prior Sessions, 34 PIDs, 33 prior Saved files, 33 local originals, the old
proxy, four NAS assets/preset files and nested copied dependencies are preserved;
the original candidate Saved bytes are unchanged. The ordinary viewport is
restored. See `evidence/f5-library-copies-workflow.json`,
`evidence/f5-library-copies-workspace.png` and
`evidence/f5-library-preset-workspace.png`. Both F5 rows remain partial; the ledger
stays **49 done / 41 partial / 2 excluded** and the full goal remains active.
Saved-preset permanent Delete is subsequently delivered above.

Preserved Library removal delivery: **http://127.0.0.1:8848/**, source
`139418d`, binary `749e97fa8c20`, service
`venturi-web-halo1-library-delete.service`. Native Library selections now have
confirmed permanent removal from Delete/Backspace, Edit Delete and collapsed
Asset actions. Active/archived revisions bind the complete set. The existing
prepared job, shared locks, durable journal and receipt infrastructure is reused;
removal v2 journals refuse older readers without losing ordinary v1 recovery.
Cleanup retains active/archive/backup references and uncertain or replaced files;
project copies/history are unchanged. A validated ACK stops only matching
Library Source, including when its panel has closed.

The single bounded gate passes **78 native / 75 client cases**, formatting,
main syntax, all-target Clippy and embedded build, peak 2,020,155,392 bytes.
Actual destructive/recovery checks use owned temporary Linux fixtures. Actual
Windows checks single/multiple confirmation, keyboard Delete, Edit ownership,
Cancel/Escape and exact unchanged Session/Saved bytes afterward. No permanent
browser deletion or new destructive CIFS campaign is claimed. Save As/reopen
leaves `Venturi_Library_Delete_V1.vvproj` Saved/frame 0/empty Undo, SHA
`ffc98814d061219bf0cc59b3bb0f016c4b10b31d05e3730580503c13c519c1cd`.

All 32 prior Sessions, 33 PIDs, 31 prior Saved files, 29 fixed local originals,
the archived NAS original, both native manifests/shared media and global proxy
remain unchanged. No NAS writes were made. Desktop1280x720 is checked; ordinary
viewport is restored. Runtime peak is 215,527,424 bytes. See
`evidence/f5-library-delete-workflow.json` and confirmation/workspace images.
Reuse unchanged renderer/export evidence. Ledger stays **49 done / 41 partial /
2 excluded**; broader physical/Library/preset/release work and the full goal stay
active. Git auto packing unexpectedly started locally during commit; the owned
job was stopped and repository automatic maintenance is now disabled.

Preserved Library pool/Source delivery: **http://127.0.0.1:8847/**, source
`024a7ee`, binary `a23a77c45e87`, service
`venturi-web-halo1-library-pool.service`. Ordered native Library selections now
import into the project pool with one native Undo and no timeline placement.
All-cached reimport adds neither duplicates nor history. Double-click or collapsed
Preview opens the first ordinary managed raw file in Source before import;
strong identity keeps that Source job usable across import/Undo/Redo, while a
project switch rejects the old epoch. Compound composition stays outside Source.

The bounded gate passes **10 native / 277 client cases**, syntax, formatting,
all-target Clippy and embedded build (peak 2,005,843,968 bytes). Two initial
test-only constructor/name fixtures were corrected before the passing gate.
Actual Windows previews a Saved asset before import, imports two existing assets
as roots 11/12 and child timeline 3, plays the same Source to EOF at 5.184 seconds,
reimports without a new Undo, and exercises native batch Undo/Redo. Original
timelines, ten root clips, markers, mixes and effect values remain unchanged.
Save As/reopen leaves `Venturi_Library_V1.vvproj` Saved/frame 0/empty Undo, SHA
`f843c2ae3c8d6f6788b6920baa037cb72c49dd0835366f2a3bb751703e40a4fd`.

The 657,278-byte project copy matches its managed source SHA. Both native asset
manifests and their shared media retain exact bytes, identity and timestamps;
no NAS writes were made. All 31 prior Sessions, 32 PIDs, 29 prior Saved files,
24 fixed local originals, the archived NAS original and shared proxy remain
unchanged. Actual 1280x720 layout is checked and the ordinary viewport restored.
Runtime peak is 231,530,496 bytes. See `evidence/f5-library-pool-workflow.json`
and Source/pool screenshots. Reuse prior renderer/export evidence; no new export,
continuous playback during import, physical DPI or full release claim is made.
Ledger remains **49 done / 41 partial / 2 excluded**; the full goal stays active.

Preserved compact-Selection delivery: **http://127.0.0.1:8846/**, source `89a7552`,
binary `6958f227e039`, service `venturi-web-halo1-command-ownership.service`.
Delete/Backspace now follows Media, Library, timeline or key-editor ownership;
File/Edit retain the last panel. Project-media removal preserves source files and
offline timeline clips. Selection keeps its native summary, with metadata, trim,
Slip and Compound details collapsed. Repeated all-track controls and video Solo
leave Inspector; header/context actions and concise Edit/Timeline routes remain.

Three native checks and **158 client cases**, formatting, all-target Clippy and
embedded build pass. The initial Library test DOM lacked dataset; its simulation
was corrected without changing production, and the passing native results reused.
Actual Windows verifies pool Delete and Edit-menu removal with an unrelated clip
selection, timeline-only Delete, native Undo, opening closed Slip/Compound details
and exact Saved reopen of `Venturi_Focus_V1.vvproj` (frame 0, empty Undo).
Both timelines, all ten clips and four physical media descriptors are restored;
compound content hashes are native cache revisions, not immutable source hashes.
The 1280x720 desktop check is complete and the ordinary viewport is restored.
All 30 prior Sessions, 31 PIDs, 27 prior Saved files, 21 fixed local originals,
the NAS original and shared proxy remain unchanged. Runtime peak is 214,544,384
bytes. See `evidence/f1-command-ownership-workflow.json` and Selection images.
No new export/physical DPI/full release qualification was claimed at that checkpoint.
Library pool import, pre-import Source and permanent asset removal are
subsequently delivered above.
Ledger remains **49 done / 41 partial / 2 excluded**.

Preserved context-menu delivery: **http://127.0.0.1:8845/**, source `b23e87d`
(main feature `f3d1371`), binary `3f4e66ec5ba1`, service
`venturi-web-halo1-context-menu-r3.service`. Clip, background, ruler, marker and
track menus reuse native actions and dialogs with each action's captured selection
policy. Opening does not select or seek. Twelve native color swatches use a compact
six-column grid; linked speed presets are atomic and one Undo. Program pauses at
its current frame before menu ownership capture; keyboard access remains guarded.

The bounded gate passes **29 native / 115 client cases**, formatting, all-target
Clippy and embedded build (peak 1,972,154,368 bytes). JS-only pause and actual
clip-list close/scroll fixes pass syntax/rebuild, reusing unchanged checks.
Actual Windows checks Title-only Blue with unrelated media selection, color
Undo/Redo, linked 200%/Undo/Redo, marker add/edit, stable playback pause and
Save As/reopen. `Venturi_Context_V1.vvproj` is Saved/frame 0/empty Undo; seven
original media clips, second timeline tracks and title/solid/filter values remain
exact. Runtime peak is 275,623,936 bytes. The default viewport is restored after
the actual 1280x720 accessible swatch check.

Title-only filters preset `Venturi Context Shadow 20261023` is saved to native
`madrock-library/presets/` (6,273 bytes). Both this project and preserved Colors V1
read the identical native payload without changing Sessions. All 29 prior
Sessions, 30 PIDs, 25 Saved files, 18 fixed local originals, the NAS original and
shared proxy remain unchanged. Only the clean owned, not-yet-delivered context
candidate was replaced under exact Saved/history/PID guards during its UI fix.
See `evidence/f1-context-workflow.json` and context workspace/palette images.
Reuse the unchanged renderer/export evidence; no fresh export, physical Canvas
pointer/DPI, shared-preset drag/crossproject Apply or full F1-F7/M7 closure is
claimed. Ledger remains **49 done / 41 partial / 2 excluded**.

Preserved visual-color delivery: **http://127.0.0.1:8844/**, source `8594968`
(main feature `ac4d974`), binary `6fb00d49a181`, service
`venturi-web-halo1-color-picker-r2.service`. Selected Title, background, outline,
Solid and DropShadow colors now use compact swatches and a visual popup with
precise RGBA fields collapsed inside it. Native linear hue/saturation, gamma
value and linear alpha are retained; optional hex entry converts sRGB bytes.
Opening/canceling/no-op does not quantize Saved floats. Existing native selected
edits, keys, reset, Undo and persistence remain authoritative.

The bounded gate passes two native asset/import checks, 83 client cases,
formatting, all-target Clippy and embedded build. Actual Windows found an internal
popup scroll closing numeric Apply; `8594968` corrects it and passes the focused
83-case gate/rebuild, reusing unchanged native/Clippy results. Actual editing
covers all five rows, title Undo/Redo, alpha-only RGB preservation, fine hue
keyboard edit and precise one-channel Solid editing after internal scrolling.
Save As/reopen retains exact native values in `Venturi_Colors_V1.vvproj`, Saved
at frame 0 with empty Undo. Seven original media clips, second timeline and
Adjustment grade remain unchanged. Popup accessibility is checked at 1280x720;
the default viewport is restored. Runtime peak is 214,487,040 bytes.

All 28 prior Sessions, 29 PIDs, 23 prior Saved files, 15 fixed local originals,
the NAS original and shared proxy are unchanged, including the previous color
editor's eight Undo entries. See `evidence/f3-color-picker-workflow.json` and
workspace/Solid images. Reuse the unchanged renderer matrix and previous
701-frame native export/browser EOF evidence; no new changed-color export is
claimed. Physical pointer/DPI, continuous hover preview and full F1-F7/M7 remain
open. Ledger remains **49 done / 41 partial / 2 excluded**.

Preserved Effects/Title delivery: **http://127.0.0.1:8842/**, source `4ad4ad1`
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
interface does not contain their unsaved changes. Its historical tunnel and
editor remain protected. Do not restart `venturi-web-native-ui.service` or the
other editors from this handover. Use the current runbook's identity and
idle-state gate for an explicitly planned operation.

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

Use the current8855 configuration and guarded procedure in RUNNING.md. Earlier
halo2 unit names and port8811 tunnel helpers are historical; do not restart them
or replace their forwards to operate this delivery. The existing Windows tunnel
must remain connected. If it fails, inspect the existing forward's ownership
before arranging a replacement; do not start a duplicate on an occupied port.

Keep one existing work tab. If a writer lease has naturally expired, use
Reconnect after confirming the intended session; never force or steal another
tab's lease, close a foreign editor, or reload a tab containing unconfirmed work.
No browser installation, Windows build or local rendering is required.
