# Native audio runtime and remaining acceptance

Candidate implementation, 2026-10-22. The native/component gate passes with
the reference UI integration; actual Windows workflow and device qualification
remain open. These changes are not yet deployed to the delivered editor.

Program preparation now observes the same native PCM sent to its encoder,
retaining DSP state from the Play origin. Bounded sidecars contain continuous
track/master peaks, master spectrum and supported insert readings. Live meters
follow the verified attached Program job and absolute audio clock, with native
peak decay/hold. Read current Program frame remains a separately labeled static
85 ms analysis window. Telemetry failure never changes the encoded movie or
silently substitutes independent windows for Live readings.

Voiceover now holds and resumes its existing capture across native Program
window boundaries and buffering. A cumulative native sample ceiling prevents
recording preparation waits. Held capture does not finalize the take; explicit
Stop, final EOF or context failure retains and saves the captured part. Existing
300-second/64 MiB bounds, native encoding, explicit placement and Undo remain.
Recording past these bounds is not supported. Physical microphone permission,
input disconnect, monitoring/output and latency acceptance remain open.

The Normalize form follows the native unit boundary: Sample Peak and True Peak
retain a custom dBFS target; transitions to or from Loudness use the destination
mode's native default. Clip-level normalization policy is exposed on tracks
only; the Master's stored field is preserved when editing its other parameters.
