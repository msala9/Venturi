# Headless Vulkan + dual AMD GPU validation

## 2026-10-20 measured result

M3a passed on halo2 R9700 (1002:7551, PCI 67:00.0), Ubuntu 26.04.1,
Vulkan RADV GFX1201 / Mesa 26.0.8-1ubuntu0.3. The integrated Strix Halo
(1002:1586, PCI 68:00.0) was enumerated and not used. Three HTTP composed
frames exactly match independent native RGBA; 500/500 seeks succeeded,
p50 96.43 ms / p95 113.64 ms on server loopback at 960x540. See
IMPLEMENTATION_STATUS.md and evidence/m3-r9700-validation.json for scope.

The user explicitly authorized Vulkan userspace and multimedia dependencies.
Setup installed new packages only, without upgrading existing packages or
changing AMD kernel drivers, ROCm or inference configuration. RADV reports
nonconformance/testing status for this adapter, so no production qualification.
All actual GPU work respects /tmp/HALO_BENCHMARK.lock nonblocking. Foreign
DeepSeek 4.1 Flash jobs remain untouched. Hardware encoding, concurrent
inference performance, browser presentation latency and long soak are unproven.

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

2026-10-20 execution: exact frames and five-minute composed A/V playback have
R9700/Windows evidence. A fresh current-binary Export drawer check also decoded
all 48 frames of the 960x540 synthetic A/V fixture; compositor R9700, encoder
CPU x264 and audio AAC. Native preparation was 222.89ms. After idle, the process
had zero DRI/KFD handles and released the shared lock. See
evidence/m3-export-r9700.json. No general workload performance is inferred.

Shared-host policy takes precedence over the proposed concurrent workload
benchmark above: hardware paths acquire /tmp/HALO_BENCHMARK.lock nonblocking.
Busy hardware work is refused. Metadata and explicit CPU/lavapipe rendering
were verified while other agents held the lock. The final service uses CPU
mode; no simultaneous inference/render GPU benchmark was run. Only previously
authorized userspace Vulkan/multimedia dependencies were added, with no kernel
AMD/ROCm/inference configuration changes.

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
