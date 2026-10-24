# Security, filesystem and deployment plan

The server can read and write user media and utilize an expensive GPU. Treat it as a privileged local tool, not a public website.

## Baseline architecture

- Bind `127.0.0.1:8787` by default; connect from Windows with `ssh -N -L 8787:127.0.0.1:8787 user@server`, browse `http://127.0.0.1:8787` on Windows.
- If connecting via VPN/Tailscale and exposing beyond loopback, require explicit host/origin/auth controls, TLS/security review. Never default to port open on all interfaces.
- The deployed halo1 host is a transient system-manager service with explicit `User=halo` and `Group=halo`; inspect it with plain `systemctl`. The editor process is unprivileged. Do not confuse it with the preserved halo2 user services or enable a new boot service.

## Filesystem policy

- Configure approved roots through the implemented `--projects-root`, `--assets-root` and `--presets-root` CLI options. The shared roots are explicit opt-ins; project writes and source browsing remain scoped to their approved authority. Export/cache storage is managed by the existing bounded stores, not fictitious extra configuration-file settings.
- User-facing file choices are via server-authorized tokens/IDs derived from directory listing; no request accepting arbitrary unrestricted host paths.
- Canonicalize and validate paths AND check symlink/race conditions. For writes, use directory handles/openat-style or similarly safe resolution if available; never rely on a naive starts_with prefix alone.
- Upload size/type/duration caps, quotas for disk cache and temp outputs. Sanitize filenames and download content type. No arbitrary shell execution from request fields; do not invoke a shell to build FFmpeg arguments.
- Project import `.vvproj` and OTIO are untrusted content; validate depth/size and referenced paths; do not allow OTIO import to read outside allowlisted media roots.
- For downloads, only serve files under authorized export root, mapped by job ID. Never expose `.ssh`, environment, GPU process logs, other users' home directories.

## Web security

- CSP for first-party assets only; no CDN dependencies; prevent XSS when displaying prompts/file names, use `textContent` not innerHTML for untrusted strings.
- CSRF/Host/Origin validation on mutating routes, especially if loopback site is reachable by other local pages.
- Small request and response budgets, rate limits on preview frames/export jobs, cancellation and timeouts, no unbounded GPU queue.
- Session lock or ownership token for single-writer semantics; no persistent browser secrets in localStorage; secure same-site cookie if adding auth.
- Audit logs: operation IDs, state transitions, sanitized paths, no prompt/media data leakage by default.

## Implemented deployment and operational boundary

The host uses CLI arguments; a `config.toml` reader is not implemented.
The supported options are `--listen`, `--projects-root`, `--assets-root`,
`--presets-root`, `--library-url`, `--gpu-device`, `--software-preview` and
`--gpu-lock`. `--listen` refuses non-loopback addresses; hardware and software
preview are alternative explicit modes. RUNNING.md records the exact delivered
arguments, environment, resource properties and immutable executable hashes.

Keep the existing Windows SSH forward and work tab. The current endpoint is
`http://127.0.0.1:8855/`; this document does not authorize creating duplicate
tunnels, a default service, boot enablement, lingering or a restart loop.
The launcher selects a prebuilt executable with an optional `VENTURI_WEB_BINARY`
override; it does not build or install the host. During runback, select the
recorded immutable executable and preserve the explicit CLI roots and bounds.

Refuse stop, upgrade or runback while Unsaved, while Undo/Redo has any entries,
or while client drafts, unresolved command outcomes, playback/capture or jobs
remain active. Save alone does not clear history, and server Saved status does
not prove the browser has no drafts. Recheck unit/PID/binary/root/port ownership
and preserve saved bytes/sidecars before an explicitly planned operation.
RUNNING.md contains the gate and bounded system-unit runback template; the
retained prior binary is not a backup of unsaved state or live Undo. Browser
tab closure does not stop the service. Saved data and durable export records
can reopen; transient render work and Undo chains do not resume after restart.

## Implemented local ownership and saved recovery

vv-web acquires a nonblocking descriptor lock on the canonical project root
before creating media workers or initializing Vulkan. A second cooperating
host is refused immediately; exit/crash releases the kernel lock. This does
not lock the native desktop editor or arbitrary external filesystem tools.

Regular .vvproj.bak files are listed for explicit recovery. Recovery requires
a clean session, native project/media/depth validation, an 8 MiB regular-file
NOFOLLOW read, and a new no-replace destination before changing the session
epoch. The original file and backup are preserved. Save As can preserve dirty
current edits first. Unsaved-edit snapshots are separate from these saved-version
backups (see below). Completed exports now have bounded durable history and
downloads; interrupted export records are retained for review and never restart
their work automatically. Interactive Source/Program render jobs remain transient.

These complement the loopback Host/Origin/JSON/CSP boundaries and bounded
queues. Save now compares the current file's descriptor identity and SHA-256
against its validated Open/last Save baseline, including equal-size changes with
restored mtime. Missing/replaced/changed files refuse with SAVE_CONFLICT before
the normal backup/write, preserving in-memory edits for Save As. Rechecks before
publication narrow concurrent-change windows; they cannot lock an uncooperative
external writer between the final check and rename. An external desktop editor
should still be closed while saving the same project from the web.

The full editing soak and release review remain open. The failed/interrupted
earlier backend soaks are retained as failure evidence, not release acceptance.
The owner's current development checkpoint uses the unprivileged, resource-limited
`venturi-web-halo1-inspector-choice-modes.service` on halo1, bound to loopback
port 8855 and reached through the existing Windows SSH tunnel (captured PID 23536).
It is a transient system-manager unit running its process as `halo:halo`, not a
newly enabled boot service. Tested source is
`b8d6133dda5d8194ebb945d47169e7656fa9d088`, executable
`/home/halo/.local/share/venturi-web/.runtime/vv-web-2dbc9697d6e7`, captured
PID 351463. RUNNING.md binds its full SHA256/configuration and the retained
`2c587b7` / `vv-web-9a619eebab31` runback binary. The captured project was Saved
with empty history; this must be checked again before any operational change.
Earlier protected halo1/halo2 editor services remain live. No public listener
is enabled. See `RELEASE_CHECKLIST.md`; deployment must preserve dirty sessions,
client drafts and Undo chains. A saved project alone does not authorize restarting
an editor with nonempty Undo history. Final reboot/rollback acceptance stays open.

Last-saved project reopening uses a private, bounded version-1 cursor containing
only the root token and SHA-256. Atomic writes and NOFOLLOW reads preserve
unsupported/linked metadata. Startup requires matching project bytes and runs
the existing native project/media validation; otherwise it leaves files intact
and offers explicit Open. This restores saved state and never implicitly applies
an unsaved edit journal. Cursor persistence errors are reported separately from
the outcome of the native project operation.

Unsaved recovery now stores one private, bounded native-RON snapshot with a
checksum and atomic publication. The actor freezes previous-session unresolved
data until a no-replace copy is kept. Restores reapply native project/media root
validation and exact revision/ownership guards, with no full payload download.
Unknown schemas, corrupt checksums, links and name collisions preserve existing
data. Keeping a copy without opening cannot replace dirty current state/history
or its Save baseline. This complements saved-file conflict checks; it does not
make all acknowledged edits, Undo chains or render jobs durable across crashes.

## License and brand

Venturi is GPL-3.0-or-later. Preserve copyright/license notices and review distribution/network implications with proper legal guidance as relevant. Do not automatically copy the MadRock mark into a project intended for distribution without rights confirmation.

The dated offline inventory in `evidence/f7-license-inventory.json` records the
root LICENSE and Cargo.lock hashes, cached crate license metadata and installed
FFmpeg configuration. Its dependency closure is deliberately conservative:
offline Cargo metadata cannot resolve an uncached `tokio-stream` package, so the
inventory includes optional, platform and development edges. Uncached manifests
remain explicit. It is not an exact linked-binary manifest or a completed
distribution/license review. No packages were downloaded to collect it.

The subsequent `evidence/f7-linux-normal-dependencies.json` resolves the selected
Linux `vv-web` normal dependency graph with `cargo tree --frozen`, matching the
qualified build's default features. It records272 unique packages,265 third-party
license declarations, lockfile checksums and current cached-manifest hashes.
The earlier missing `tokio-stream` workspace dependency does not block this
selected graph. Collection takes172ms andreported78.4M memory with zero swap; no download,
build or lockfile change occurs. Six workspace crates omit their own Cargo
license field; repository LICENSE is recorded separately rather than inventing
package declarations. Build/dev edges, exact linked system libraries, notices,
assets and packaging/distribution review remain outside this inventory.
