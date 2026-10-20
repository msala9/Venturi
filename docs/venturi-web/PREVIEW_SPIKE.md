# Next media increment after M3a

The measured exact PNG path takes 96 ms median / 114 ms p95 for a 960x540
output from a two-track native composition on R9700. A 24fps frame budget is
41.67 ms. This measurement does not separate decode, GPU readback and PNG
encoding; it does show that sequential HTTP stills cannot be presented as
real-time playback. Keep exact stills for seek/pointer release and editing.

## M3b source playback

`vv-media/src/proxy.rs::generate_proxy` is directly reusable with bounded
background ownership. It writes all-intra H.264, YUV420P MP4, atomic staging,
quality-specific native content fingerprints. It does **not** write audio.
The desktop reads audio from originals; a browser cannot reuse its Linux sink.

The `verify_source_proxy` example exercised this native API locally with an
explicit CPU decoder preference. The synthetic H.264/AAC source is 48 frames,
320x180 at 24fps. Native generation took 33.06 ms and produced 149,543 bytes;
the native probe confirms input_audio=true and proxy_audio=false. This is a
tiny warm-source feasibility measurement, not target-host throughput or browser
compatibility proof. Evidence: m3-source-proxy-spike.json.

Next bounded outcome: a source-media job that wraps this generator plus a
native audio mux path, preserves the original channel/sample-rate policy, and
publishes only completed files through root-scoped media IDs. One job, bounded
disk cache, fingerprint plus encoder version in cache identity, cancellation,
HTTP Range/206/416 tests and project-epoch scoping are required. Then verify
H.264/AAC seek and sound in Windows Chrome/Edge. Do not expose video-only proxy
as finished source playback, or serve the global desktop cache by guessed ID.
Thumbnail/waveform APIs exist in vv-media and can share that bounded worker;
they must not run in the serialized session actor.

## M3c composed playback

`vv-session/src/export.rs::export_timeline` already has bounded decode/compose/
encode stages, native offline audio mix and AAC output. Reuse it for the first
short MP4 range spike rather than a second FFmpeg editing pipeline. Its current
headless compositor is constructed internally with implicit adapter choice;
before a web job uses it, add an explicit compositor/device injection seam
without changing desktop defaults. Lock ownership must extend to the actual
GPU stages and yield to the laboratory inference policy; a long export must
not monopolize the GPU. Publish only fully finalized revision-keyed ranges.

Measure decode, compose/readback, audio mix and encode separately using native
ExportProgress stage data. Verify range-boundary PTS and mixed audio over cuts,
gaps and effects, then evaluate short completed MP4 ranges with HTML video.
Only measured startup/seek/sync failures would justify MSE or a streaming
protocol. No H.264 hardware encode, source audio playback, A/V drift, browser
presentation p95 or long-form composition result has been demonstrated yet.
