# Running the implemented host

Venturi Web currently provides native project/timeline editing over loopback.
It is an incremental editor with exact composed GPU frames and Source playback
with audio, stills, thumbnails and waveforms. Inspector properties, scalar
keyframes, Source ranges, linked slip and timeline markers are also available.
Program playback has R9700/Windows proof, including a five-minute synthetic
A/V timeline. Export has a bounded native H.264/AAC drawer. Native filters,
masks, retiming, selected compounds, two stopped-frame scopes, Auto Balance,
audio inserts and built-in color/EQ/compressor presets are available within
the documented bounds. Recovery copies a previous saved backup into a new
project. Browser voiceover and the ds4 shared media catalog are available.
Review offers A/B comparison and explicit native take replacement. Advanced
curve interaction, continuous scopes/meters and shared-library qualification
remain partial; Shot/Take metadata and saved attribute preset controls are
implemented. WSL exposes
only llvmpipe (CPU).
The separate halo2 deployment has verified R9700 Vulkan rendering; see
evidence/m3-r9700-validation.json for the measured path.

## Ubuntu / WSL

Use current stable Rust and the upstream native dependencies. This checkout
was checked with Rust 1.99.1 and Ubuntu 26.04 FFmpeg 8.0.1. The complete FFmpeg
development set includes libavdevice-dev and libavfilter-dev, beyond the
short upstream Ubuntu dependency example. No desktop environment is needed.

```bash
sudo apt-get install --no-install-recommends build-essential pkg-config clang \
  libavcodec-dev libavformat-dev libavutil-dev libavdevice-dev libavfilter-dev \
  libswscale-dev libswresample-dev libasound2-dev
cd /path/to/venturi-source
bash scripts/venturi-web.sh
```

The script uses `$HOME/VenturiWeb` for projects/media and
`$HOME/.cache/venturi-target` for build artifacts. Override explicitly:

```bash
bash scripts/venturi-web.sh --projects-root /srv/venturi/projects --listen 127.0.0.1:8787
```

Only loopback addresses are accepted. Nothing is installed as a service.
From this Windows workspace:

```powershell
wsl -d Ubuntu -- bash -lc 'cd /mnt/k/AI-lab/venturi/venturi-source && bash scripts/venturi-web.sh'
```

Open http://127.0.0.1:8787 in the Windows browser. For a separate Ubuntu server:

```powershell
ssh -N -L 8787:127.0.0.1:8787 user@server
```

The server process is unprivileged. No RDP, GNOME, KDE, Linux audio output or
GPU driver changes are involved. This host uses Linux directory-relative file
operations and `/proc/self/fd` for safe media probing; build it on Linux/WSL.
Native desktop builds remain `cargo run -p vv-app`; original default workspace
members are preserved so the added binary does not change default selection.

## First editing session

1. Click the Venturi name and create a project, or open a listed `.vvproj`.
2. Put source files directly in the configured root. Click Import media and
   select a server-listed file. Nested media roots, uploads and relink are
   not implemented. Projects referencing media elsewhere are refused.
3. Select imported media and click Insert media to place it at the playhead.
   Native linked video/audio insertion is preserved; occupied destinations
   are rejected. Add solid creates a native generator for a media-free test.
4. Drag, trim, select clips and split/delete. Inspector fields provide numeric
   trim. Ctrl+K exposes add track and global ripple delete. Inspector track
   controls expose mute, solo and lock. No edit RPC runs on pointer movement.
5. Alt+Left/Right moves the linked selection one frame; Shift adds ten.
6. Ctrl+S saves. Ctrl+Z / Ctrl+Shift+Z uses native history. Unsaved changes are
   visible; save before changing projects or terminating the process.

Double-click a media file, or select it and click Source, to prepare a browser
proxy. Choose quality and use the video controls or Play; Source has its own
clock and does not move the timeline. Its first audio stream plays in the
Windows browser. Native-generated thumbnails and waveforms are loaded on
demand. Cancel preparation stops its background job. Program returns to exact
composed stills; source playback does not display timeline effects.

Main Source prepares at most 60 seconds at a time from regular media, including
files longer than ten minutes. Use the full-file position slider, absolute
frame field or frame steps to reach another window; natural playback EOF
prepares the following window with a visible pause. In/Out remains absolute
within the original file, independent of the current preview window. Existing
legacy full-file Review/Slip preparation still has a ten-minute limit.
Ranged previews request whole-source thumbnails and waveforms through a separate
bounded CPU analysis job, without creating a whole-file movie. Foreground media
preparation can interrupt analysis; use Refresh media assets when idle to retry.
The visible status reports completion or failure. Partial window peaks are never
presented as a whole-file waveform. Browser acceptance remains open.

Selected speed handles and Ctrl+R toggle strips for selected media clips only.
If every selected media clip has its strip, the toggle hides those strips;
otherwise it shows them all. Other clips and timelines keep their visibility.
Generators are ignored and an empty media selection makes no change.
Click the percentage to open
the ten native speed presets, drag the right endpoint for exact frame resizing,
or use the strip's close control to hide that clip's strip. With a clip selected
and the timeline focused, Shift+F10 or the Context Menu key opens the same menu.
Preset edits include linked media and preserve the primary pitch flag. Shorter
clips leave gaps; growing clips refuse overlaps unless Overwrite clips is
explicitly checked. Change clip speed opens the Inspector with the native
Ripple duration policy initially selected. Escape closes without editing.
Locked clips retain a decorative strip with editing controls disabled. Per-clip
visibility is local, survives timeline selection changes and clears on a new
project; it does not create Undo steps.

Source jobs accept at most 8192 pixels per dimension,
cap decoded audio samples at 256 MiB plus encoder overhead,
and reject completed ephemeral jobs larger than 512 MiB. The private,
process-local cache reserves 512 MiB for every queued/running job before
admission against a 2 GiB budget and at most 32 jobs. Admission also reserves
outstanding job budgets against available scratch space, preserving a 1 GiB
free-space floor. Preparation checks that floor at native cancellation points;
native write batches and encoder trailers can temporarily exceed a job budget.
This is not an instantaneous filesystem quota.

Ready status, cache reuse and asset requests renew a shared 45-second retention
period. Attached Source media renews every ten seconds; Program renews every two
seconds, including paused media. Each viewer has at most one status request in
flight. A lost/changed job stops playback and requires reopening or preparation.
Active HTTP streams also hold shared file locks; eviction acquires exclusive
locks on every job file before unlinking anything. Failed cleanup retains the
job and accounts for remaining bytes; unknown sizes refuse further admission.
Stop unused viewers and wait for retention to expire when SOURCE_CACHE_FULL is
reported. Evicted material can be regenerated. PNG/JPEG/WebP stills display their original
bytes; compound media opens its child timeline for Program preview. Original
source files are preserved.

Program playback continues through successive preview windows of at most five
minutes, preparing only the next requested window after natural EOF. The viewer
shows a preparation pause; there is no gapless playback guarantee. Stop, pause,
seek or document changes cancel continuation. At 2x/4x/8x, queued native audio
must finish its old window within the 250 ms tail deadline before replacement;
incomplete audio stops and requires Play to retry.


Existing project saves use same-directory staging, file sync, atomic rename
and a previous-file `.vvproj.bak`. To recover that previous save, stop the
host, preserve the current file separately, and copy the backup to another
`.vvproj` name inside the root. Save As creates a new name atomically and
refuses existing files. Unsaved edits require an explicit save; neither
browser close nor reload saves automatically.

One browser owns a renewable 90-second writer lease; other browsers read
snapshots. Reconnect retries lease acquisition. Reload preserves the tab's
client ID in session storage. Server restarts replace the project epoch
and require reopening a saved project. Completed command lookup is process
local, bounded to 4096 receipts with SHA-256 request fingerprints. The command
epoch rotates automatically at capacity without changing the project epoch,
dirty state or Undo history. Clients send the current command_epoch from session
snapshots; a receipt from the previous window is rejected after eviction rather
than executed again. Never resubmit an unresolved command with a fresh epoch.
Lookup is not durable across host restarts. Import probing is currently serialized on the session actor and
can delay other session requests for large sources. This needs extraction
before claiming interactive import at production scale.

The Export drawer accepts integer In/exclusive Out frames anywhere inside the
timeline, width up to 1920 and native x264 quality/speed settings. Each job has a
ten-minute processing and 512 MiB output budget; the five-minute Program preview
window does not restrict export duration. The server mixes
AAC when requested and the captured timeline contains audio clips. Close the
drawer or continue editing while the immutable snapshot renders. Saved exports
lists jobs retained in `<projects-root>/.exports`; completed files and their
status survive server restarts. Interrupted jobs are listed for review and do
not restart automatically. Previously requested cancellation recovers as canceled.
Changed or missing completed files are refused. Source/Program caches remain
ephemeral and separate.

History retains at most 64 jobs and 2 GiB of output/partial files, with 512 MiB
reserved per pending job. New jobs are refused when capacity is full. Select a
terminal saved export and use **Discard saved export…** to remove its generated
MP4/partial output and history after confirming the exact job. This permanently
frees its capacity; source media and projects remain. Finish active downloads
before discarding. Active jobs must finish or be canceled first. The server never
automatically evicts history. A restart completes only previously confirmed
discard intents; changed or unknown files block cleanup and remain preserved.
Blocked `discarding` entries conservatively consume the full output budget.
An unreadable history preserves files and
blocks exports while editing/previews remain available. Hardware encoding and
automatic job resume are unavailable. Finite API acceptance verified software
H.264 output and download identity across a forced restart, interrupted running
work and persisted cancellation. GUI/hardware qualification remains open; see
`evidence/m4-animated-viewer-durable-exports.json`.
Explicit terminal removal and exact quota recovery across restart have separate
no-GPU API evidence in `evidence/m3-export-discard.json`. Browser confirmation
qualification remains open.

Projects also downloads the current nonempty timeline as OTIO. To import,
place .otio directly in the server root, reopen Projects, choose it and supply
a new project name. Save current edits first; existing names are refused.
Native Venturi metadata retains clip effects/masks, track/master mixer and
markers. Compound export requires opening the child timeline first; foreign
title layout may differ. Media referenced by imported files must remain in
the configured root. Import warnings appear in Projects.

## Actual API deltas from the proposal

Projects also lists the previous saved .vvproj.bak versions. Expand Recover
previous save and supply a new project name. Recovery validates the native
backup and creates a new file without replacing the project or backup. Use
Save As to preserve current unsaved edits first; normal Save updates the one
previous-save backup. Edits made after the last save are not autosaved.

One server may own a configured project root. A second vv-web process using
the same canonical directory fails immediately before renderer initialization.
Use a different project directory for independent test servers. The kernel
releases ownership when the process exits, including after a crash; do not
delete directories to clear ownership.

- Project operations share `POST /api/v1/projects/commands`: typed
  `new_project {name}`, `open_project {path_token}`, `save`, `import_media`.
- `POST /api/v1/lease {client_id}` claims/renews the single writer.
- Every mutation includes `command_id`, `client_id`, string `project_epoch`,
  string `if_generation`, and `operation`. Timeline commands also require
  `if_revision` and use `/api/v1/timelines/{id}/commands`.
- Epoch includes a server-start nonce and native epoch. `if_generation` also
  protects project-wide undo/redo against edits to other timelines.
- Track IDs are opaque index strings within the revisioned timeline; labels
  separately expose V1/A1. Source in/out use native Clip methods.
- `GET /commands/{id}` returns the original acknowledgment or cached failure.
  Reusing the ID with a different request fails. IDs are never silently evicted.
- Acknowledgments are compact. Fetch `/session` after applying or recovering
  a command. Transport failure triggers same-ID lookup, never a fresh replay.
- Explicit capabilities report preview, Program playback and export only when
  the selected native Vulkan compositor initializes. Hardware mode selects the
  requested AMD device; explicit software mode reports software_preview true.
  Source playback also works without a compositor.
- GET `/preview/frame` requires project_epoch, if_generation, timeline_id,
  revision, frame and optional width (default 960). Returns a composed PNG;
  stale revisions are refused, a replaced pending job returns SEEK_SUPERSEDED,
  and foreign GPU lock ownership returns GPU_BUSY (503). Cache hits need no GPU.

Host/Origin checks, JSON-only mutations, embedded first-party assets, CSP and
nosniff are implemented. This is a local development host, not a hardened
public service. M7 threat modeling, process-crash recovery, long soak, playback
and hardware encode validation remain outstanding.

## halo2 development deployment

The selected adapter is R9700 device 0x7551, not integrated Strix Halo 0x1586.
The runtime can be built on matching Ubuntu/WSL and copied as a stripped binary
to `.runtime/vv-web`; the launcher uses it when present, without Rust on halo2.
The current deployment directory is `/home/marco/AI-lab/venturi-web`:

```bash
cd /home/marco/AI-lab/venturi-web
bash scripts/venturi-web.sh --listen 127.0.0.1:8790 --gpu-device 0x7551 \
  --gpu-lock /tmp/HALO_BENCHMARK.lock
```

Use 8790 here because 8787 belongs to another laboratory service. On Windows,
the existing session tunnel exposes http://127.0.0.1:8790. To establish a new
tunnel, use the already configured halo2 SSH access with
`-N -L 8790:127.0.0.1:8790`; keep host verification enabled. No credentials
are stored in this repository. The server/tunnel are development processes,
not boot services; close them explicitly when no longer needed.

DeepSeek 4.1 Flash inference is shared work on halo2. Never stop model jobs or
delete/replace the shared lock. GPU initialization and each uncached frame
take the lock nonblocking, then release it. Cached PNGs do not use the GPU.
Program/Export holds one reservation for its complete bounded preparation;
cancel it to release that reservation at the next native cancellation point.
Uncached exact seeks return GPU_BUSY during that preparation. This prevents
another agent from acquiring the GPU between that job's native stages.
If startup finds the lock busy, editing stays available with preview disabled;
restart only the Venturi process during an idle slot to enable it. A server
that already initialized returns GPU_BUSY for frames until the lock is free.
Retained images are labeled stale. Only userspace Vulkan and multimedia
dependencies were authorized; no kernel driver/ROCm/inference changes.

For repeatable development validation, build the example and use the script:

```bash
cargo build -p vv-web --example verify_preview
python3 scripts/venturi-web-validate.py --url http://127.0.0.1:8790 \
  --reference /path/to/verify_preview \
  --project "$HOME/VenturiWeb/GPU_composed.vvproj" --output /tmp/vv-validation-new
```

Open that fixture in the browser first. The script waits for the shared lock
and compares three native frames before its 500-seek check. It never stops a
foreign workload. RADV currently emits a nonconformance/testing warning;
these results do not qualify the driver for production.

## Explicit CPU preview while hardware is reserved

Software compositing is optional and never a silent hardware fallback:

```bash
bash scripts/venturi-web.sh --software-preview --listen 127.0.0.1:8790
```

The launcher selects only the installed Mesa lavapipe ICD using the process
environment VK_DRIVER_FILES, and caps LP_NUM_THREADS and Tokio workers at two.
The native decoder/encoder workers remain bounded at two. No global Vulkan
configuration or inference setting changes. The server verifies the installed
lavapipe manifest, an unprivileged Linux process and one or two renderer threads
before creating a Vulkan instance. Mixed driver discovery and simultaneous
--gpu-device are refused. This mode uses a private cache lock rather than the
laboratory hardware lock. The UI identifies CPU/llvmpipe explicitly.

The Export drawer reads native encoder/decoder choices without checking GPU
devices. Select a hardware option and use its explicit check button before
exporting. Checks are scoped to the current server instance; a server restart
requires a new check. CPU-only preview disables hardware codecs. A selected
hardware encoder never silently changes to x264; observed decoder fallback is
reported separately from the compositor and encoder.

Codec checks require at least 4 GiB of available host memory and a cgroup v2
memory limit of at most 4 GiB with `MemorySwapMax=0`. Run the host in a suitably
bounded service before requesting checks. An unbounded host returns
`CODEC_PROBE_RESOURCE_LIMIT`. Each isolated check uses one allowed CPU, low
priority, a CPU-time limit and its own 20-second wall deadline. Hardware checks
also require the nonblocking shared laboratory GPU reservation. They yield any
resident preview context and release native device caches before reservation
release. Missing capability or a busy reservation does not trigger retries or
an automatic software substitute.

Exact frames, composed Program playback and x264/AAC export still use the
native Venturi pipeline. They can be slower than real time. The Windows export
fixture produced exactly eight 960x540 H.264 frames and stereo AAC; its completed
bytes survived a timeline edit and its status survived browser reload. A second
export canceled during native preparation. The WSL process had no DRI/KFD
handles and did not map the RADV library. These are software acceptance results,
not R9700 export acceptance. See m3-export-software-* evidence.

Driver isolation follows the official [Vulkan loader driver selection](https://github.com/KhronosGroup/Vulkan-Loader/blob/main/docs/LoaderDriverInterface.md);
the renderer thread cap uses Mesa's [LP_NUM_THREADS](https://docs.mesa3d.org/envvars.html#lp-num-threads).

The shared ds4-appliance library can be configured explicitly:

```bash
bash scripts/venturi-web.sh --software-preview --listen 127.0.0.1:8790 \
  --library-url http://192.168.1.153:8787
```

Open Library to search prompt/model/seed/type, then Import project copy. The
appliance transparently serves its SSD and 14 TB network archive; Venturi never
scans or mounts that archive. Only selected assets transfer into the configured
project root. Original media and the appliance's pin/retention rules stay intact.
Missing shared sources expose Relink missing project uses, which restores the
local copy and applies native SetMediaPath without replacing clip IDs or keys.
Imported provenance appears in the Inspector and survives Save/restart.

The server requires a fixed HTTP(S) service origin without credentials, path or
query; browser input cannot choose arbitrary remote URLs. Redirects are disabled.
There are two bounded catalog readers and one transfer plus one queued. A source
is at most 512 MiB and a catalog 4 MiB/5000 items. Transfers have a three-minute
HTTP deadline, native media validation and SHA-256/no-replace publication.
Selected project copies are persistent; the ordinary preview cache remains
bounded independently. Canceling a transfer never removes shared originals or
edits a project. An already completed copy can remain available in the picker.
Native compound-library organization remains separate parity work. Saved native
attribute presets have API/restart, Windows shortcut and real native-parser
import evidence. Broader lifecycle/drag and cross-project runtime acceptance
remain open. The appliance media catalog does not configure the preset folder;
no NAS preset deployment is claimed or required by the original preset scope.

## Browser voiceover

Save the project, unlock and arm audio tracks in the Inspector, then open
Audio → Voiceover or Record armed audio in Program transport. Start requests
input permission in that browser. Choose mono/stereo and a native output format.
Composed playback is prepared before capture; disable it to record on a blank
timeline or beyond existing programme material. Stop and save take releases
input, retains a local WAV backup and uses the server's native encoder. Review
the take and start/latency fields before Place. Overlap requires explicit
overwrite. One Undo restores clips and arming. Positive latency correction moves
the take earlier; calibrate it for the physical devices. Optional input monitoring
needs headphones. Capture stops at five minutes or 64 MiB. Failed uploads keep
the take in the current tab for retry/download; avoid reloading until it is saved
or backed up. Saved audio remains importable from the server picker if placement
is canceled. Physical-device latency acceptance is still open.

## Comparing and replacing takes

Open Review → Compare A/B to choose imported sources. Playback follows elapsed
seconds; a shorter source holds its final frame. Choose the side to hear or
Neither. Native source FPS/frame counts are separate from proxy dimensions.
Known shared-asset metadata is shown without inventing missing model/prompt/seed.

Select a source clip before opening Review to replace it with B. Choose B source
In, preserve duration or explicit shorten, linked video/audio policy and clip
effect/fade policy. Preview native replacement changes is read-only. Inspect
all affected clip ranges, removed crossings and key merges, then Confirm for one
Undo. Shorten leaves a gap; it never ripples or changes speed. Native frame
quantization may merge keys, with first-key retention shown in the preview.
Frozen clips require an explicit Frozen clip policy. Hold B Source In uses
that exact native B frame for every affected frozen clip, preserving its full
timeline duration and silence even when B is shorter. Moving linked clips
still follow the selected duration policy. Unfreeze removes the hold and
checks Preserve/Shorten against the original edit duration; it never silently
shortens first. The plan distinguishes the held picture from the animation
source clock, which can extend beyond B for a frozen clip. A/B audition plays
the sources independently of timeline freeze. Compound targets remain
unsupported and require an ordinary source-media target before replacement.
To replace an ordinary take inside a compound, open its nested timeline and
select that clip. The wrapper is not replaced and no internal clip is chosen
automatically. Native cache counters may advance during Undo/Redo.
Recheck source-dependent audio normalization.

Review → Shot / Take grouping (or Prompt / Seed / Model metadata) organizes
imported sources in shots, with Favorite/Rejected flags and searchable labels,
model, prompt and exact seed strings. Captured shared-library provenance is the
default; uncheck Use captured source provenance for explicit known/unknown
overrides. A changed source needs an explicit rebind. Annotations save alongside
the native project in `.vvproj.review.json`. Restore previous annotations swaps
the last two saved annotation states; timeline Undo remains separate. Save As
copies annotations independently. Missing media retain visible orphan entries.

## Copying selected clip properties

Copy source clips with Copy clips or Ctrl+C, select destination clips and choose
Paste selected properties (Alt+V). Choose groups and maintain source-frame timing
or stretch keys to the target source range. The first copied source of each
track kind is used. Linked targets are included; original copied clips are
skipped. Filters/masks replace their stacks. Speed/pitch uses native Ripple and
may move following clips or unfreeze media. Locked/stale targets or a ripple
that would separate a linked group refuse the whole operation. One Undo restores
all properties and timing. Cross-timeline paste requires matching timeline FPS;
saved custom attribute presets use the separate Presets panel below.

## Following the playhead

Commands (Ctrl+K) → Selection follows playhead toggles the local preference,
enabled by default like the desktop. Seek, frame steps, marker jumps and composed
playback select the top visible video clip and its linked group; locked tracks
are excluded and gaps clear selection. Disable it to retain a manual selection
while moving the playhead. The preference persists in this browser and never
writes native project state or Undo history.

## Reopening saved projects

After a validated Open or successful project save, the service remembers the
root-scoped project token and saved-file SHA-256 in `.venturi-last-project.json`.
The next service start reopens that saved project automatically when its bytes
still match, after the normal native project/media/depth checks. A changed,
missing or unsupported previous file stays untouched; Projects explains that
an explicit Open is needed. Open the external version explicitly to update the
automatic reopen baseline. Unsupported or linked reopen metadata is preserved
and does not turn a successful project save into a failed command.

This restores saved composition, media and separately saved Review annotations.
Unsaved edits use the separate recovery snapshots described below. Render-job
restoration remains pending.

## Recovering unsaved edits

Dirty native project state is captured to a separate recovery snapshot at a
two-second interval while the session actor is available. The footer reports
the latest stored snapshot; the project keeps its Unsaved changes badge until
Save. The snapshot holds the native RON model (up to 8 MiB) in a versioned,
checksummed atomic record (up to 16 MiB). It never saves over the project file.
Edits newer than the last completed snapshot can still be lost on a crash.

After restart, Recovery opens Projects at the pending snapshot. Enter a new
project name and create a recovery copy; existing files are never overwritten.
Opening that copy requires a clean current session and starts a fresh Undo
history. If newer edits are already in memory, uncheck Open the recovery copy:
the snapshot is kept as a separate saved project and current edits/history stay
in place. New snapshots then resume. A pending snapshot stays frozen until a
copy is kept, so new edits cannot silently replace it. Separately saved Review
annotations are copied from the source project's sidecar.

Missing or externally changed backing project files do not prevent explicit
recovery to a new file. Unsupported, altered or linked recovery records are
preserved and reported as unavailable; normal Save/Save As remain independent.
Snapshots contain current project state, not the pre-crash Undo chain or render
jobs. The configured project root retains one active recovery record; kept
recovery copies are ordinary saved projects.

## Save conflicts

Save refuses a project changed, replaced or removed by an external editor after
Open/last Save. Your native edits and Undo history remain in memory. Projects
opens with an explanation and a proposed Save As name; save your copy before
reopening the external version. Neither a conflict nor Save As overwrites the
external project. Close other editors while saving the same file: external
filesystem tools do not share the web host's directory ownership lock.

## Saved attribute presets

Open Presets to save the selected native video/audio attribute groups, apply a
saved preset, change its name/groups/anchor/filter mode, restore previous
settings, archive/restore, or import/export native v1 JSON. Applying is one Undo;
saving and managing the library does not change the timeline. If the command
succeeds but its list refresh fails, use Refresh presets; the acknowledged
operation has already happened.

Use **Drag preset** to drag the selected saved preset onto a timeline clip.
Dropping on a selected clip applies to the whole selection; dropping on another
clip applies only there and retains the current selection. Linked clips remain
part of the native operation. The outline is local feedback; release commits
one ApplyPreset command. Escape, leaving the editor or a changed source/session
cancels the draft. Locked targets and empty timeline gaps cannot accept a drop.
The existing **Apply preset to selected clips** button remains the keyboard path.

The default folder is `<projects-root>/.presets`. Start the binary with
`--presets-root /path/to/folder` to share a folder between cooperating web hosts.
Do not use an active desktop library as a simultaneous shared writer: desktop
does not take the web lock or reload external changes. Actual desktop application
import is verified for the recorded v1 export through the real native parser
and Library::open; the original desktop import UI was not exercised. NAS preset
sharing remains unqualified. The existing ds4 media
archive integration does not configure this preset folder automatically.

Imported desktop shortcut strings are preserved. Compatible
Ctrl+Alt+Shift+letter chords can be explicitly enabled for this project/browser
session; C/K/Q/S/V/Z and unsupported chords display a conflict/compatibility
reason. Editable fields/dialogs, repeats, busy/read-only sessions and empty
selections do not apply presets. Project changes revoke activation; changed or
archived preset metadata requires enabling again.

Save/Edit preset settings offer Keep current shortcut, Assign a shortcut and
Remove shortcut. Keep is the default and preserves existing imported metadata.
Assign offers all 117 native key names with Ctrl/Shift/Alt checkboxes, including
function keys and symbols that the browser cannot activate. Remove explicitly
clears the saved shortcut. Saving changes disables its existing browser binding;
use Enable separately for an eligible chord. A failed key-catalog read blocks
Assign while Keep and Remove remain available. The panel never silently removes
another preset's shortcut. Unknown legacy strings can be kept by the web host,
but the current desktop parser cannot import those unknown shortcuts.

The existing Windows browser verifies cold-open selection, assignment, removal,
previous restore, explicit activation, single Undo and input/dialog/reload
guards. Native JSON files are limited to 4 MiB and the web adapter's supported
format/name/frame bounds. Broader preset lifecycle and sharing qualification
remain separate from this recorded acceptance.

## Viewer and fade handles

On a current stopped Program frame, select a video clip and enable Transform.
Drag inside its outline to move, a corner to scale, the diamond to move the
anchor, the knob to rotate or an edge bar to crop. Shift scales the axes
independently or snaps rotation to 15 degrees. Crop retains at least one source
pixel per axis. Static properties change defaults; animated properties create
or replace Linear keys at the native current source frame, matching desktop
handles. Undo restores previous interpolation. The outline is a local draft
until release; Escape cancels. Stale frames, playback, Source/slip views, locked
clips and changed selections cannot commit. Numeric Inspector controls remain
the keyboard alternative.

Choose a mask in the viewer's Mask selector, or use its Inspector selection
button, then enable **Mask handles**. Mask and Transform modes are exclusive.
Rectangle/ellipse corners and sides resize against the opposite edge; Shift
preserves proportions for corners. Drag inside to move, or the knob to rotate
(Shift snaps to 15 degrees). Path vertices expose incoming/outgoing tangents;
dragging a tangent mirrors its counterpart unless Alt is held. Outside-edge
clicks insert a corner at the pointer, Alt-click removes a vertex down to three,
and double-click switches between a corner and native automatic smooth handles.
Escape cancels the draft. Selected vertices survive own edits and preview
refreshes. The Inspector can set/remove a path key at the playhead using native
evaluated geometry; Apply path continues to edit the default. Animated viewer
edits create Linear keys with one Undo. Pen drawing and full path-key timeline
navigation remain open, as do browser/DPI/rendered qualification.

Timeline fade handles occupy the upper band of sufficiently wide clips. Drag a
handle to set that clip's fade; lower edge trims and the Slip tool retain their
hit targets. Linked audio/video fades are independent, matching the desktop.
Release creates one Undo, while cancellation or no change creates none.

Existing transitions expose duration handles in the bottom clip band. Drag an
edge transition endpoint to resize it; drag either crossing endpoint to resize
both halves symmetrically. The draft label reports integer frames and retains
the transition's kind, direction, ease and curve. Release applies one Undo;
Escape, lost capture, changed selection/session or viewport cancels. Slip and
ordinary trims retain their targets, and Alt still pans. Locked, tiny or
incomplete transition snapshots expose no editable handle; zoom in or use the
Inspector. Transition selection and Alt duplication remain separate work.

Multitrack compounds are available for normal video layers and unmuted gain-only
audio with no solo/pan/inserts. Include intervening video and both sides of a
crossing. Dependencies that cannot be preserved are explicitly rejected;
flattening and arbitrary mixer/compositing preservation remain unavailable.
These increments have native/API and interaction-state tests; real GUI and
rendered-equivalence qualification remains pending.

## Checks

```bash
node --test web/test/*.test.js
cargo check -p vv-web
cargo fmt --all -- --check
cargo clippy -p vv-web --all-targets -- -D warnings
cargo test -p vv-web -p vv-core -p vv-session --no-fail-fast
```

FFmpeg CLI is used only by synthetic media tests, matching upstream test
conventions. Production media editing calls vv-core/vv-session/vv-media.
