# Running the implemented host

Venturi Web currently provides native project/timeline editing over loopback.
It is an incremental editor, not a completed desktop replacement. Composed
preview, playback, export, advanced effects/color/audio and AI review are not
implemented. Their UI entries are explicitly disabled. The current WSL Vulkan
probe exposes only llvmpipe (CPU); it does not validate R9700 or Strix Halo.

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
5. Ctrl+S saves. Ctrl+Z / Ctrl+Shift+Z uses native history. Unsaved changes are
   visible; save before changing projects or terminating the process.

Existing project saves use same-directory staging, file sync, atomic rename
and a previous-file `.vvproj.bak`. To recover that previous save, stop the
host, preserve the current file separately, and copy the backup to another
`.vvproj` name inside the root. Automatic unsaved-edit recovery and Save As
are not implemented. Neither browser close nor reload saves automatically.

One browser owns a renewable 90-second writer lease; other browsers read
snapshots. Reconnect retries lease acquisition. A reload creates a new client
ID; wait for the old lease to expire. Server restarts replace the project epoch
and require reopening a saved project. Completed command lookup is process
local, bounded to 4096 entries / 8 MiB of request fingerprints; a final save is
reserved before command capacity is exhausted. Restart after saving to reset
the registry. Import probing is currently serialized on the session actor and
can delay other session requests for large sources. This needs extraction
before claiming interactive import at production scale.

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
- Explicit capabilities report preview/playback/export as false. There are
  no working preview/media-serving/export endpoints yet.

Host/Origin checks, JSON-only mutations, embedded first-party assets, CSP and
nosniff are implemented. This is a local development host, not a hardened
public service. M7 threat modeling, process-crash recovery, long soak and
target hardware validation remain outstanding.

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
