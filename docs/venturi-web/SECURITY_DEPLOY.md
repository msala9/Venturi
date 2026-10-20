# Security, filesystem and deployment plan

The server can read and write user media and utilize an expensive GPU. Treat it as a privileged local tool, not a public website.

## Baseline architecture

- Bind `127.0.0.1:8787` by default; connect from Windows with `ssh -N -L 8787:127.0.0.1:8787 user@server`, browse `http://127.0.0.1:8787` on Windows.
- If connecting via VPN/Tailscale and exposing beyond loopback, require explicit host/origin/auth controls, TLS/security review. Never default to port open on all interfaces.
- Systemd user service or shell-driven process, not privileged root; sandbox filesystem when feasible. No GNOME, KDE or desktop startup.

## Filesystem policy

- Configure `projects_root`, `media_roots`, `exports_root`, `cache_root` in server config; all explicit paths.
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

## Minimal service approach (proposal only)

Install `vv-web` binary as unprivileged user; configure `~/.config/venturi-web/config.toml` with allowed roots and device selection; `systemctl --user start venturi-web` only when editing, stop afterwards if desired. Enable lingering only after user explicitly asks for background service lifetime. Project/export jobs do not survive server process termination unless persisted job state/restore is implemented; browser tab close alone should not stop the running process.

## Manual baseline smoke

```bash
# On Ubuntu: when vv-web exists
./target/debug/vv-web --listen 127.0.0.1:8787
# On Windows (PowerShell):
ssh -N -L 8787:127.0.0.1:8787 user@linux-server
# Browser: http://127.0.0.1:8787
```

`--listen` is a **proposed CLI option**, not a current Venturi command. Codex should implement/document the actual option consistently.

## License and brand

Venturi is GPL-3.0-or-later. Preserve copyright/license notices and review distribution/network implications with proper legal guidance as relevant. Do not automatically copy the MadRock mark into a project intended for distribution without rights confirmation.
