# Native screenshots inspected

All five images under media/screenshots were opened at original resolution
on 2026-10-20. They are focused crops, not a complete desktop tour.

| File | Visible controls | Source | Web home / parity IDs |
|---|---|---|---|
| eq.png | Warmth preset/save; spectrum and response; six bands with type, enable, frequency, gain, Q and reset | crates/vv-app/src/eq_panel.rs:132; crates/vv-audio/src | Audio / audio_eq_six_band, shared_presets |
| mixer.png | A1/master strips; ordered effects; add effect; normalize; pan; solo/mute; gain faders; stereo meters | crates/vv-app/src/mixer_panel.rs; crates/vv-core/src/model.rs:2481 | Audio / audio_mixer_track_master, audio_effect_chain_order, audio_normalization_peak_r128 |
| multiband-compressor.png | preset/save; spectrum; crossover handles; low/mid/high threshold, ratio, gain, attack/release, meters and reset | crates/vv-app/src/compressor_panel.rs:271; crates/vv-audio/src | Audio / audio_compressor_three_band |
| playhead-buffer.png | timecode ruler, ticks, red playhead and blue cache interval | crates/vv-app/src/timeline_ui.rs; crates/vv-app/src/render_ahead.rs | Timeline / cache_ruler_bar |
| retime-controls.png | linked selected video/audio clips; 200% speed strips; stretch handle; audio waveform; close speed strip | crates/vv-app/src/timeline_ui.rs; crates/vv-app/src/speed_dialog.rs; crates/vv-core/src/command.rs:1053 | Timeline/Inspector / speed_handles_constant, speed_pitch_preserve, linked_groups |

Other panels were audited through source; no screenshot evidence is claimed
for the absent complete desktop, color, masks, curves, library or export views.

Web voiceover proof (2026-10-21): `evidence/m5-voiceover-browser.png` shows
the Audio workspace entry and armed track with always-visible capture actions.
`m5-voiceover-overlap-browser.png` shows a retained synthetic take after overlap
refusal. Source audit: `vv-app/src/voiceover.rs`, start_take/drive_take/place_take.
Physical microphone device/permission and latency acceptance remain open.

Review is a new extension, rather than a panel shown in the original crops.
`m6-review-ab-browser.png` shows paired native source proxies and supplied/absent
generation metadata; `m6-review-duration-browser.png` shows explicit policies
and short-take refusal. `m6-review-preserved-key-browser.png` shows the saved
linked replacement after restart, CURRENT timeline frame 31 and opacity 65.
All are CPU/browser proofs, not hardware or completed Shot/Take-sidecar proof.

`evidence/m6-frozen-take-policies.jpg` (2026-10-21) shows the explicit native
Hold plan: old held frame 24 becomes B frame 3 while all 76 timeline frames
remain. The animation clock [3, 79) is labeled separately. Existing Windows
browser checks and independent API snapshots also verify Unfreeze refusal,
explicit Shorten and one Undo per replacement. This is a CPU policy/interaction
proof; rendered hardware playback is not claimed.

`evidence/m4-preset-shortcut-settings.jpg` shows Assign with native F35,
Ctrl/Shift modifiers and the proposed canonical shortcut. Its `-applied.jpg`
shows the separate D binding enabled on the selected destination clip after
one native application. The browser and native snapshots verify exact Undo,
Remove/previous restore and input/modal/reload guards. This does not exercise
the original desktop GUI or a shared NAS preset folder.
