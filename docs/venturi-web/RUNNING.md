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
curves, live scopes/meters, native saved/shared libraries and Shot/Take metadata
remain open. WSL exposes
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

Source jobs currently accept regular media up to ten minutes and 8192 pixels
per dimension, cap decoded audio samples at 256 MiB plus encoder overhead,
and cap each generated job at 512 MiB. Cache is private, 2 GiB, process-local;
evicted material can be regenerated. PNG/JPEG stills display their original
bytes; compound media opens its child timeline for Program preview. Original
source files are preserved.

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
local, bounded to 4096 entries / 8 MiB of request fingerprints; a final save is
reserved before command capacity is exhausted. Restart after saving to reset
the registry. Import probing is currently serialized on the session actor and
can delay other session requests for large sources. This needs extraction
before claiming interactive import at production scale.

The Export drawer uses integer In/exclusive Out frames, up to five minutes,
width up to 1920 and the native x264 quality/speed settings. The server mixes
AAC unless disabled. Close the drawer or continue editing while the immutable
snapshot renders; reopening/reloading can recover the latest job status.
Download the MP4 before server shutdown or cache eviction. This first adapter
does not offer persistent export queues or hardware encoding.

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
Native compound-library organization and saved/shared attribute presets remain
separate parity work; this is the appliance media-catalog integration.

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
Frozen/compound replacements require an explicit edit first. Recheck source-
dependent audio normalization.

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
saved custom attribute presets remain separate work.

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
