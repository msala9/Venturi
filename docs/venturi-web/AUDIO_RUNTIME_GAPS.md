# Remaining native audio runtime gaps

Source audit, 2026-10-22. These are production behavior gaps, separate from
physical microphone, output-device and latency qualification.

- `web/js/audio-meters.js` polls independent native meter windows. Each call to
  `audition::Task::meters` starts a new 4096-sample render and DSP state; it does
  not consume the continuous Program render's peaks, insert spectra or compressor
  state. The native mixer consumes continuous `MixMeters` readings with decay.
  Window readings must remain labeled as such until bounded telemetry follows
  the actual Program job, audio origin and attached playback clock.
- `web/js/voiceover.js` finishes a take on Program video `pause` or `ended`.
  This includes window handoffs and a short remaining cached window. Capture has
  no coordinated hold/resume protocol. Ignoring those events while continuing
  microphone capture would include preparation time and misalign the take.
  Retained takes, native encoding, explicit placement and Undo already exist.

The Normalize form follows the native unit boundary: Sample Peak and True Peak
retain a custom dBFS target; transitions to or from Loudness use the destination
mode's native default. Clip-level normalization policy is exposed on tracks
only; the Master's stored field is preserved when editing its other parameters.
