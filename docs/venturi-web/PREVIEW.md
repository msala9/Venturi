# Preview and audio — technical strategy

## Why this is a first-class subsystem

Original desktop renders GPU textures directly to egui (no CPU readback) with `vv-app`-owned render-ahead/audio/proxy workers. Web needs encoded or fetched media. `vv-mcp::render_frame` gives an exact export-quality PNG, **not** a frame from interactive cache; calling it on every mouse move is inappropriate.

## Phase A — exact still image (M3a)

Implemented cache telemetry appears in the ruler: violet marks individual
composed frames, green marks ready composed movies. The footer shows their
counts and explains the colors. Metadata refreshes after completed seeks,
Stop and preparation; it is an observation of native cache availability,
not a prediction of future render-ahead work. The frame/analysis cache shares
an eight-entry, 16 MiB limit; only composed entries appear on the ruler.
Cached lookups and insertion also bind current input identities.

Stop/seek retains one ready movie reference. Play checks its native status
before reuse and seeks from its actual start frame. Backend preparation also
finds containing ready ranges, so browser reload does not force recomposition.
Changed composition, source identities, width, eviction or cancellation cannot
activate an obsolete movie. Existing movie job/disk budgets still apply.

API GET `/api/v1/preview/frame` for timeline_id/frame/revision/width. Host creates a valid renderer on specified headless Vulkan adapter; request has bounded resolution (e.g. max 1920, configurable). Use queue coalescing per browser: newest seek wins, at most 1-2 active; stale results discarded based on revision + request_seq. Add ETag based on snapshot/frame/quality when safe; server caches bounded by bytes; do not retain unlimited full images in browser memory. HTTP 503 when Vulkan unavailable; UI can still edit metadata/timeline.

## Phase B — Source Viewer via source proxy (M3b)

Use Venturi `vv-media` proxy worker output or an extracted service. Proxies are all-intra H.264; verify browser-compatible container/profile and audio tracks on target Chrome/Edge. If source proxies omit audio, provide companion compatible audio or another first-party host path. Support validated `Range`, correct MIME/content length/seek. Source proxy is a preview, not a replacement for original on export. Generate only when requested; cap disk cache and background jobs. Ensure cache key includes source content fingerprint+settings; never serve another project's material under an ID collision.

## Phase C — Program Viewer with compositing + synchronized sound (M3c)

**Crucial distinction:** raw source proxy playback cannot show edits spanning multiple tracks, masks, titles or effects. Server must compose a timeline range with `vv-render` and mix audio with `vv-audio`, then encode browser-compatible chunk/segment(s) using Venturi's libraries. Segment boundaries must be frame-accurate; invalidate affected ranges or conservative whole-preview if smarter invalidation isn't safe. Cache key includes timeline revision and encoding settings.

The initial strategy may be pre-rendered preview chunks plus HTML5 `<video>` playback. Specify precisely whether MP4 fragments are independently seekable, how client reassembles timestamps, and how to avoid audio gaps. Do not claim this is trivial: spike it and benchmark. Only after proving unacceptable latency compare WebRTC, MSE/fMP4, HLS and progressive MP4 for the specific LAN use case.

## Timing and state

- Edit coordinates in frame indices; audio sample clock is reference as in native Venturi.
- Client viewer states: current, seeking, generating, stale, failed, source offline, quality degraded.
- During scrub: playhead follows mouse immediately; request latest frame at a bounded rate, no queue accumulation. Final pointerup requests exact frame at that location.
- On edit: invalidate composed frames and clips touched, never present old preview as if updated. Show previous frame with explicit stale indicator if needed.
- Use `HTMLVideoElement.requestVideoFrameCallback()` when available for presented frame timing, with fallback where needed.
- Audio must play from the Windows browser device; there is **no** reliance on a Linux audio sink/GUI. Voiceover capture from Windows browser is a separate subsystem.

## Hardware path

Validate one GPU end-to-end first: device selection, wgpu compositor, readback/encoding, browser decode. The Strix Halo integrated GPU and OCuLink R9700 are two devices; do not assume sharing will help. Benchmark copy/readback over OCuLink vs single-device. FFmpeg hardware encoder advertised does not guarantee working output; run test encode+decode for R9700 and record pixel correctness.

## Metrics and failure tests

- p50/p95 exact seek latency from browser pointerup to presented frame, cache hit rate, dropped requests, GPU memory usage.
- Concurrent GPU AI inference load; degraded preview response without blocking timeline interactions.
- Repeated 500 seek requests over 60 seconds: bounded queue, no resource leak, latest-frame correctness.
- Project edit during old frame generation: old response ignored.
- Playback over 5-minute timeline with gaps/cuts/effects: measured A/V drift and no old-revision frames.
