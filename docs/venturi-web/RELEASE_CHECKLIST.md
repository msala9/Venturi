# Release checklist

## Current8b975 internal prebuilt package — 2026-10-24

The immutable archive is
`/home/halo/.local/share/venturi-web/deliveries/venturi-web-linux-x86_64-8b975f434990-c8ada6e108f5.tar`,
91166720bytes, SHA256
`c8ada6e108f52e9da569fbc1c2e8e19c4252cf7d8c7c22e04a92dc683acc7cab`.
It binds binary source455662c and documentation source372612e separately,
including the API contract, FINAL_CHECKS and actual NAS/Mixer/import GUI proof.
All archive members and packaged launcher --help pass; all three original notice
companions remain verbatim. The189 current loader bindings,199 installed notice
files and reviewed zlib delta remain exact before/after assembly. Live8855
PID485839, executable, arguments and Session are unchanged; prior r4 is exact.
One1CPU/512MiB/noSwap low-priority assembly passes with peak238067712B and
zero limit/OOM/kill events. No build/render/server or Windows archive copy ran.
See evidence/f7-current-prebuilt-r5-workflow.json.

This publication receipt postdates the immutable archive: its packaged documents
retain their exact372612e snapshot, including the then-pending package status.
Do not replace that archive to refresh its own receipt. Existing77d7/59b6 runback
proof stays version-bound; no new downgrade or host reboot is claimed. Full
F1-F7/M7 and62done/28partial/2excluded remain open. Continue independent work;
FINAL_CHECKS reserves unavailable acceptance without waiving it.


2026-10-24. Current production source `455662c`, runtime `8b975f434990`, unit
`venturi-web-halo1-native-import-receipt.service`, captured PID485839. Native
NAS Restore/Mixer input and truthful import receipts are recorded in
`evidence/f2-f5-native-nas-restore-input-workflow.json`:3 current Host cases,
54 client/49 module cases reused from R2, formatting/Clippy/build passed.
The r5 package is pending;87bc/r4 remains an immutable prior package. Earlier integrated
test source `9ab281e` and later focused gates remain version-bound. The full
F1-F7 goal remains active. The owned halo1 editor is available on port8855.
This is the release audit required by IMPLEMENTATION_PLAN.md, not a release-ready
declaration. The ledger currently records 62 done, 28 partial and two excluded
capabilities. New unqualified source changes do not inherit acceptance from this
checkpoint.

| Requirement | Current result | Authoritative evidence / remaining work |
|---|---|---|
| Full in-scope native behavior | Incomplete | FUNCTIONAL_PARITY.csv and COMPLETION_PLAN.md; all 28 partial rows remain in scope. Export-specific real-media/sustained qualification now passes in f7-public-real-media-export-workflow.json; global M7 gates stay open |
| Compact native interface | Qualified baseline | native-ui-workflow.json, current-workspace-delivery.json; remaining physical scaling and dense-editing checks are explicit |
| Multi-track editing and Inspector | Partial | f1-native-key-replacement-workflow.json qualifies explicit native selected destination replacement across graph/lanes/typed groups;99 client/29 native cases, actual Windows refusal/one replacement/UndoRedo/Save/reopen pass. Physical pointer/DPI/dense remain open.  f1-native-gestures-workflow.json, f3-mask-inspector-workflow.json, f1-native-curve-viewport-workflow.json; simultaneous animated lanes are implemented; native visible sampling, adjacent tangents and mixed-selection Undo/Save/playback pass. f1-floating-curves-workflow.json closes the dedicated nonmodal window and passes layout/draft/mixed Delete/Undo/Save/playback; physical modifier-wheel plus global DPI/dense acceptance stay open |
| Media, ordinary-resolution playback and export | Partial | f2-f5-native-transport-audio-refresh-workflow.json qualifies native Pause/EOF1x and exclusive terminal black/no replay, Saved end/reopen last-frame semantics;263client/9native and actual short Windows Program/Source pass. f2-f5-program-seek-library-workflow.json qualifies guarded Program seek/resume, paused navigation and explicit Play; actual keyboard1x forward/backward and2x resumption pass on Saved copy, original restored. f2-native-arrow-hold-workflow.json qualifies native timed0.5x Program arrow hold logic, single-flight seek, cancellation and actual Windows single stepping; physical held-key acceptance remains.  f7-native-4k-export-workflow.json additionally qualifies48-frame native4K A/V import/Save/reopen and byte-exact Web/native4K MP4/AAC export within4GiB, with the isolated backend stopped; synthetic2s scope leaves representative long-footage and physical acceptance open.  f6-verified-take-workflow.json proves full-HD export and native/API parity; f2-program-lookahead-workflow.json qualifies one speculative future and natural 1× five-minute boundary at 960×540 on a Full HD timeline, Save and 75-frame Full HD/AAC export EOF. f2-source-lookahead-workflow.json qualifies adjacent Source continuation; f2-source-placement-workflow.json records the EOF project-view CAS fix. Representative long moving ordinary-resolution sources and physical audio/device acceptance stay open |
| Effects and advanced timeline | Partial | f3-native-inspector-choice-previews.json qualifies all five native choice drafts and exact cancellation without history changes; physical pointer/DPI scope remains.  f3-effects-workflow.json, nativeview-workflow.json, f3-mask-inspector-workflow.json; outstanding row-specific pointer, font, moving-media and hardware scope remains |
| Color, audio and voiceover | Partial | f4-native-guides-inline-mixer-workflow.json and subsequent F4 evidence qualify native scopes, mixer, effects, retained recording drafts, placement and persistence. V1 audio edits explicitly stop playback and use Play for the updated mix; uninterrupted live DSP editing is deferred by the owner. Physical recording/device/output and remaining interactions stay open |
| Shared library and presets | Partial | f2-f5-native-nas-restore-input-workflow.json adds actual asset/preset two-way NAS Restore, Mixer first-drag focus/scroll and truthful native cached-import receipts. Earlier startup/explicit Refresh, cross-project import/Relink, native/Web CIFS coordination and ordered linked multiasset placement/Undo/Save remain accepted in their version-bound proofs. FINAL_CHECKS.md retains the explicit remaining physical HTML capture and other row-specific acceptance; these fixes do not promote either row. |
| Atomic take replacement | Qualified | f6-verified-take-workflow.json, including stale shown-B refusal, one Undo, exact save/restart, actual R9700 pixels and full-HD exported-file EOF |
| A/B comparison | Partial | f6-review-quality-workflow.json closes the Low-only implementation gap: shared Low/Medium/High/Original, retained independent source frames and audition ordinals, stale Plan invalidation, 158 client cases/build, actual paused Windows 640x360 -> 1920x1080 at frames48/24 and Medium audio-only stream1 at B30. Existing long-window/clock evidence is reused. Sustained representative full-resolution comparison and physical audio remain |
| Safe moves, linked/locked edits and stale commands | Qualified regression baseline | Existing native command/Host tests and workflow evidence; rerun affected cases after relevant implementation changes |
| Saved projects, recovery and export history | Qualified bounded behavior | Existing M7 saved/unsaved recovery and durable-receipt evidence, f6-verified-take-workflow.json; no claim of restoring Undo chains or automatically resuming render work |
| Loopback and browser boundaries | Source reviewed; final release gate open | api.rs security middleware checks configured Host and same Origin when supplied; mutation Json extractors, body limits, no-store/nosniff/CSP/referrer headers. Existing API tests cover these boundaries; final integrated candidate must retain them |
| Filesystem and worker boundaries | Source reviewed; final release gate open | Approved root-relative tokens and descriptor validation; native catalog locks/CAS/recovery; bounded probe subprocesses and GPU lock. Final changed-source safety checks remain required |
| Secret/prompt handling and browser rendering | Source reviewed; final release gate open | web/js uses text nodes/textContent for user labels; no innerHTML/eval/Function matches in the reviewed production modules; browser storage is layout/selection preferences, not authentication secrets. This scoped review is not a public-host audit |
| Licenses and notices | Scoped normal-graph/configured-host materials supplied and current assembly bound | NOTICES.md records488 original plus14 additional notice/reference texts for265 Rust packages and199 installed copyright/common-license files for182 host packages,189 DSOs, configured Radeon ICD/31 dependencies and8 DejaVu fonts. Current f7-current-prebuilt-r4-workflow.json preserves all3 original companions/indices and verifies188 identical loader tuples plus the pinned zlib patch with byte-identical archived copyright, fenced before/after assembly. f7-host-zlib-notice-delta.json retains exact versions/hashes and the refused stale r3 binding. Earlier189-exact evidence remains version-bound. Optional/plugin/device paths and broader redistribution stay outside this internal configured-host scope; no external legal-signoff gate is invented |
| Rust/JavaScript regression gate | Software gates qualified; native clock scope remains | f7-integrated-regression-workflow.json: full workspace fmt/Clippy/test compilation pass;1777 unique client cases qualify by full-run reuse plus corrected fixture,2031 native cases by reuse plus two corrected fixtures. Nine native app clock cases remain unqualified on virtual output;9 default ignored cases stay explicit. No claim of a green complete native workspace |
| Native desktop regression | Full run performed;9 clock cases unqualified | f7-integrated-regression-workflow.json records every target:2029 initial pass,11 fail,9 default ignored; two vv-web test fixtures are corrected and pass. Production audio/assertions remain unchanged; virtual ALSA/Pulse does not qualify real native clock/device behavior. Physical UX remains open |
| Two-hour typical editing soak | Not passed | m7-two-hour-backend-soak.json is interrupted; m7-halo2-backend-soak-oom.json is failed. Neither qualifies browser memory, hardware or the current candidate. Run once after functionality stabilizes, with bounded halo1 resources; do not repeat failed co-residence or Windows heavy workloads |
| Deployment and rollback | Final runtime deployed; additive r5 package pending; full M7 open | RUNNING.md identifies source455662c/runtime8b975f434990 and the guarded deployment preserving14 Saved/39 foreign Sessions/40 PIDs. f7-current-prebuilt-r4-workflow.json remains the immutable prior87bc package with reviewed188+zlib notice binding; no final-runtime package/runback is claimed yet. Historical77d7/prior59b6 runback stays version-bound. FINAL_CHECKS.md retains physical/device, long browser playback, dense/native-clock/editing-soak and final-delivery checks without adding a whole-host reboot requirement. |

## Scoped source review

The loopback server is an unprivileged local editing tool reached through an SSH
tunnel. Its trusted boundary includes the configured roots and cooperating local
processes. Native/Web catalog locks coordinate their writes; arbitrary external
writers are still refused through identity/CAS checks rather than controlled by
the application. Root/project/media validation and per-operation revision checks
must remain active at publication, not only in chooser UI.

The reviewed production subprocess call sites use explicit argument vectors and
owned worker executables, not request-built shell commands. The derivative
worker's unsafe blocks implement its process/resource and native-library
boundary; this inventory alone does not establish their complete safety. The
bounded worker and hostile-path regressions remain part of the release gate.

The license artifact is technical inventory, with its limitations stated in the
artifact. It does not infer that missing optional/platform manifests are linked
in the delivered Linux binary, nor that the set is cleared for distribution.

## Remaining release sequence

Program seek/busy startup (8995296), full-area Fit/bounded fullscreen fallback
and unavailable shared-root startup/explicit retry (205db70 plus379ba0c) are
delivered. Current focused evidence qualifies349 client and192 native cases,
actual maximized Program/Source keyboard workflow and reachable NAS Refresh.
Keep all29 partial rows in scope; REMAINING_WORK.md names their remaining
requirements. Native fullscreen admission, physical hover/input/DPI and the
other broader row-specific/M7 gates are not implied by these deliveries.


Complete the coherent missing functionality blocks, qualify their affected
native/Web paths and update the ledger only with matching workflow evidence.
The canonical NAS is already available on halo1 at
`/mnt/madrock-share/madrock-library`; do not reopen that setup requirement.
Finish the broader shared-library/preset and physical acceptance requirements.
Reuse the integrated software gates above; rerun only code affected by later
changes. Complete one two-hour realistic editing soak with browser memory
observation and bounded halo1 workers, preserving protected editors and the
shared GPU lock. Publish
the verified final candidate, rollback procedure and artifact paths only after
those gates pass.
