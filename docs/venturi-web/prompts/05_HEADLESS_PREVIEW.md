# Codex Prompt 05 — actual Venturi frame preview, then browser media

ROLE: Rust/wgpu media engineer. Scope a single correct headless composed frame first, not an entire streaming stack.

Read `PREVIEW.md`, `GPU_VALIDATION.md`, `API_CONTRACT.md`, source `vv-session/frame_provider.rs` and `export.rs`, actual GPU adapter handling, G0 report. Verify dual GPU enumeration on target (R9700 and Strix Halo) without driver changes. Establish headless wgpu device. Render an actual composed timeline frame with media+effects from a test project, compare output to existing Venturi export/render_frame. Expose bounded `GET /api/v1/preview/frame` with explicit revision, frame and width. Correctly cancel/coalesce stale browser seek requests; return stale/error state without lying. No per-pointer full render loop. Honor device and memory budgets.

Make scope small: do NOT add WebRTC, HLS, fMP4 or browser voiceover in this prompt. On success create a separate spike note evaluating Source Viewer proxy playback with audio and a composed preview strategy, using actual wgpu readback/codec measurements. If hardware adapter or libs unavailable, report exact step blocked and leave fallback functionality explicit; don't replace ROCm/Mesa.

Proof: TS-013, TS-016, TS-017; report device name/PCI ID, OS/driver, actual measured p50/p95 and GPU memory where available. Update M3 plan if new constraints found.
