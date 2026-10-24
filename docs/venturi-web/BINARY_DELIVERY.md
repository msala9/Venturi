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
the final integrated editing/device/soak gates remain unqualified.
