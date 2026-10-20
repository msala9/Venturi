# Headless Vulkan + dual AMD GPU validation

Host: Ubuntu Server with Strix Halo integrated GPU **plus Radeon AI PRO R9700 over OCuLink**. The user uses this machine for AI inference; avoid changing ROCm/Mesa packages without a deliberate rollback plan. Testing below is informational only until a new GPU-specific change is approved.

## Inventory: run on Ubuntu over SSH

```bash
cat /etc/os-release | grep -E 'PRETTY_NAME|VERSION_ID'
uname -r
rustc --version
cargo --version
ldd --version | head -1
lspci -Dnn | grep -Ei 'VGA|3D|Display'
ls -l /dev/dri /dev/dri/by-path 2>/dev/null || true
id
vulkaninfo --summary 2>&1 | head -100
ffmpeg -hide_banner -hwaccels 2>/dev/null || true
```

Missing tools are **missing**, not automatically installed by this pack. The `ffmpeg` CLI here is diagnostic; library headers/runtime required for Venturi build are separate. Linux Vulkan validation may work without X11/Wayland; confirm with a renderer test (headless GPU adapter creation) before GUI assumptions.

## Acceptance for R9700

1. Vulkan loader lists BOTH actual AMD adapters and (if any) software device; identify R9700 by actual device name and PCI id, not array index.
2. Headless `wgpu` creates a compatible adapter and renders a small deterministic composition through Venturi's path, no window server.
3. GPU device selection is logged; do not silently fall back to llvmpipe.
4. `render_frame`/new API renders a real timeline frame accurately; compare reference image with software output within justified color tolerance.
5. Export H.264 MP4 via supported hardware or software fallback. Test actual encode + decode + colors, don't infer success from FFmpeg `-encoders` list.
6. Run with and without concurrent AI inference; record wall time, peak VRAM/RAM, preview seek latency and exported video fidelity.
7. No driver/DKMS/ROCm changes are included in Codex implementation patches without explicit user approval.

## Environment selection notes

Mesa Vulkan device selection may use `DRI_PRIME=pci-0000_XX_YY_Z!` or environment-specific Vulkan ICD options, but must be verified on the host. A backend using wgpu may select an adapter directly rather than relying solely on global env vars. Do not hardcode assumed PCI id or `/dev/dri/renderD128`.

## Sample report

```text
OS/kernel:
Vulkan loader version:
Strix Halo device/PCI:
R9700 device/PCI:
Selected render adapter (evidence):
Software fallback available:
H.264 decode/encode tested:
1080p 24fps exact seek (p50/p95):
4K export stage fps (decode/compose/encode):
AI inference contention:
Driver change made: NO
Blockers:
```
