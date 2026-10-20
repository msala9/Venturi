# Running the implemented host

Venturi Web currently provides native project/timeline editing over loopback.
It is an incremental editor with exact composed GPU frames and Source playback
with audio, stills, thumbnails and waveforms. Inspector properties, scalar
keyframes, Source ranges, linked slip and timeline markers are also available.
Program playback has R9700/Windows proof, including a five-minute synthetic
A/V timeline. Export has a bounded native H.264/AAC drawer; remaining advanced
effects/color/audio editing and AI review are open. WSL exposes
only llvmpipe (CPU).
The separate halo2 deployment has verified R9700 Vulkan rendering; see
evidence/m3-r9700-validation.json for the measured path.

## Ubuntu / WSL

Rust 1.88+ and the upstream native dependencies are required. This checkout
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
- Explicit capabilities report preview and Program playback true only when the
  requested AMD Vulkan compositor initializes. Program playback implementation
  still awaits M3c hardware acceptance. Source playback also works CPU-only;
  user-facing export remains unavailable.
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
