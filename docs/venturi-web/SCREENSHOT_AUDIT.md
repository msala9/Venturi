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
