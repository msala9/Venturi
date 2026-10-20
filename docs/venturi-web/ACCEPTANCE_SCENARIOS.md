# Product acceptance scenarios (manual + automated)

## Scenario A — core 20-shot montage

Given 20 local AI-generated video files on Ubuntu media root and one soundtrack, Windows user opens Venturi Web over SSH tunnel, creates a 24fps project, imports clips, opens 10 in Source viewer, marks In/Out, inserts chosen ranges onto V1 and music on A1; moves clips, trims to frame accuracy, splits, ripple deletes a gap, adds a marker/title and saves. Close browser/reopen; project matches expected timeline. Export from server, validate audio and frames. No desktop Linux installed or started.

## Scenario B — safe move doesn't erase content

Given two touching clips on V1, drag a third clip over them in Safe Move mode. During drag show invalid destination; on release no server mutation, source clips untouched, undo history unchanged. Explicitly switch Overwrite mode and confirm intended result, then Undo returns original content in one step.

## Scenario C — interrupted connection

Given a valid timeline edit sending command id X, drop connection after server receives operation but before response. Browser shows unknown outcome; on reconnect queries X. If applied, show new revision without reapplying; if rejected, show unmodified timeline. Export job still running when tab was closed must be visible on reconnect.

## Scenario D — heavy AI inference on GPU

Given an inference job using one or both GPUs, user pans/zooms 500 clip timeline and selects clips; UI remains responsive. Program preview clearly degrades quality/latency with status; no CPU/software fallback secretly reported as hardware. Collect p50/p95 seek timings.

## Scenario E — keyframe and color parity

Given video clip with exposure filter, set position and opacity keyframes, inspect in Curve Editor, apply Color Wheels and mask, inspect actual waveform vectorscope of graded clip, save/reopen, exact program frame visually matches upstream native export. Undo returns previous values.

## Scenario F — advanced audio parity

Given voice track and music, in Audio workspace reorder EQ and multiband compressor, change track fader and normalize via appropriate metric. Browser preview matches export mix. Record voiceover from a Windows microphone with explicit permission, stop/import once, align against playhead. Browser permission rejection leaves timeline unchanged.

## Scenario G — AI takes

Given Shot 04 with three Take variants, compare A/B, favorite one and Replace Take in assembled timeline. New take shorter than original: user sees explicit duration choices; cancel leaves source and edit unchanged. Applying chosen policy preserves transforms where valid and is one undo step.

## Scenario H — offline/relink/OTIO round trip

Given saved project whose source file moved within approved media root, show red/offline asset, relink by safe picker, restore preview, import/export OpenTimelineIO per upstream semantics, reopen and verify clips/time ranges. Reject path outside allowlist.

## Scenario I — native GUI regression

After shared crate refactor, build and run original desktop vv-app and pass its tests. Verify screenshot-audit representative interactions still work. No changes to native language strings, menus or shortcuts without explicit upstream-compatible decision.
