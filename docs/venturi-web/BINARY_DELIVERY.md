# Prebuilt Linux development candidate

2026-10-24. The qualified halo1 executable is packaged without rebuilding or
changing the live editor. Full F1-F7/M7 release acceptance remains open.

| Item | Value |
|---|---|
| Persistent halo1 archive | `/home/halo/.local/share/venturi-web/deliveries/venturi-web-linux-x86_64-2dbc9697d6e7-064e1c99da5a.tar` |
| Archive bytes | `80629760` |
| Archive SHA256 | `064e1c99da5a9a6c42fae58d88e70fd73852b09a39c707c846ea69b3d0059e45` |
| Companion checksum | The archive path followed by `.sha256` |
| Binary source | `b8d6133dda5d8194ebb945d47169e7656fa9d088` |
| Launcher/document source | `1a3d1cfae263f920b8941ebe50e0696d4c45dbce` |
| Binary SHA256 | `2dbc9697d6e77b0e60a415a0e04c85bf751a6d9174f63bfa0aec12aaedc67f94` |

The archive contains `.runtime/vv-web`, `scripts/venturi-web.sh`, `manifest.json`,
`SHA256SUMS`, `runtime-libraries.json`, operating documents and available GPL and
Silero MIT notices. Its normal Rust dependency inventory is explicitly scoped;
it is not an aggregate third-party license-text bundle. The exact committed
source is available in [the project repository](https://github.com/msala9/Venturi)
on `feat/venturi-web` at the commits above.

On halo1, check the persistent archive before selecting it:

```bash
cd /home/halo/.local/share/venturi-web/deliveries
sha256sum --check venturi-web-linux-x86_64-2dbc9697d6e7-064e1c99da5a.tar.sha256
```

Extract only into a new owned directory, verify its `SHA256SUMS`, and read its
README and [RUNNING.md](RUNNING.md) before launching. The packaged launcher uses
its own `.runtime/vv-web`; `VENTURI_WEB_BINARY` can explicitly select another
prebuilt executable. Missing binaries fail without invoking Cargo or installing
anything. `bash scripts/venturi-web.sh --help` prints the actual CLI without
opening a listener. Do not replace or restart a running editor to inspect this
bundle. Starting an editor requires the explicit intended roots, GPU lock and
resource limits in the runbook; the default project root alone does not select
the shared library.

Web assets, shader source and Silero ONNX are embedded. The recorded189
loader-resolved system libraries, installed fonts, Vulkan/Radeon userspace,
Linux descriptor access and configured project/NAS/ds4 data remain host
prerequisites. Libraries and fonts are not copied into this archive. No separate
Cargo, Node, Python, ffprobe or ONNX Runtime is required by the production helper
paths: those re-execute the same binary.

All archive members were verified against their hashes, and the packaged
directory's default launcher passed the real executable's `--help`. Packaging
completed on halo1 under one CPU/512MiB/no swap, with339,873,792B peak memory.
No editor, renderer, build or installation was started, and the working8855
instance and protected sessions remain intact. See
[the evidence](evidence/f7-prebuilt-bundle-workflow.json) for exact file hashes,
loader dependencies, resource settings and successful terminal state.

This candidate is for the already qualified Linux x86_64 host. Self-contained
portability, complete third-party notices/distribution review, optional dynamic
runtime paths, fresh project/GPU startup from the archive, reboot/runback and
the final integrated editing/device/soak gates remain unqualified. Subsequent
isolated startup/runback acceptance is recorded below.

## Actual startup, prior-binary runback and forward restoration

[The runback workflow](evidence/f7-prebuilt-runback-workflow.json) subsequently
starts the packaged executable through its real launcher against the owned
Saved48-frame native4K fixture on port8856. It automatically reopens with empty
Undo, renders frame24 at960x540 and stops. The retained prior `9a619eebab31`
binary repeats this, followed by another fresh packaged current process. All
three timeline snapshots and rendered PNG hashes match exactly. Saved project
and source bytes are unchanged. The isolated listener closes and shared GPU lock
releases after completion; the live8855 instance is never restarted.

This serial halo1 service passes with512,987,136B peak under8CPU/4GiB/no swap.
Post-run protection checks preserve39 prior Sessions/40 PIDs,11 Saved files,
5 local media,4 NAS files and the shared proxy. This closes the actual packaged
startup and isolated runback/forward check for that fixture; it does not prove
every historical project, restore former unsaved state/Undo, or qualify a host
reboot, physical devices, real long footage or the final editing soak/M7 gates.

## Verified Rust notice-text companion

A separate persistent archive is available on halo1 at
`/home/halo/.local/share/venturi-web/deliveries/venturi-web-rust-notices-2dbc9697d6e7.tar`,
with a same-name `.sha256` companion. Its SHA256 is
`fefc4a4ea98d9edab61944adf3040b9a09f931cbf910ddbe5ae1e796711b3c57`.
This supplements the binary archive without changing its verified bytes.

It contains488 original license/notice files, totalling2,432,786 text bytes,
from257 of the265 third-party packages in the scoped Linux normal dependency
inventory. Each cached `.crate` archive matches its Cargo.lock checksum; the
collected files and completed archive are independently hashed. The index binds
the inventory, candidate binary and source commits separately. Both root Cargo
manifest/lock git-blob hashes match the inventory; no network or cache walk was
needed. The bounded service peaks at67,821,568B and terminates successfully.

Eight exact crate archives lack conventionally named license/notice text:
`dasp_sample 0.11.0`, `ffmpeg-sys-next 9.0.0`, `harfrust 0.5.2`,
`nom-language 0.1.0`, `profiling 1.0.18`, `spirv 0.4.0+sdk-1.4.341.0`,
`tract-extra 0.23.8` and `tract-transformers 0.23.8`. Their declared SPDX terms
are retained, without substituting invented attribution text. Host/system-library
and font notices, alternate borrowed-code locations, build/dev scope and final
distribution review remain separate. See
[the collection evidence](evidence/f7-third-party-notice-texts.json).
