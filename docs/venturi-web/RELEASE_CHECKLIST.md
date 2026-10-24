# Release checklist

2026-10-24. Qualified production source `158a6d7`, integrated test source
`9ab281e`; the full
F1-F7 goal remains active. The owned halo1 editor is available on port8855.
This is the release audit required by IMPLEMENTATION_PLAN.md, not a release-ready
declaration. The ledger currently records 61 done, 29 partial and two excluded
capabilities. New unqualified source changes do not inherit acceptance from this
checkpoint.

| Requirement | Current result | Authoritative evidence / remaining work |
|---|---|---|
| Full in-scope native behavior | Incomplete | FUNCTIONAL_PARITY.csv and COMPLETION_PLAN.md; all 29 partial rows remain in scope |
| Compact native interface | Qualified baseline | native-ui-workflow.json, current-workspace-delivery.json; remaining physical scaling and dense-editing checks are explicit |
| Multi-track editing and Inspector | Partial | f1-native-key-replacement-workflow.json qualifies explicit native selected destination replacement across graph/lanes/typed groups;99 client/29 native cases, actual Windows refusal/one replacement/UndoRedo/Save/reopen pass. Physical pointer/DPI/dense remain open.  f1-native-gestures-workflow.json, f3-mask-inspector-workflow.json, f1-native-curve-viewport-workflow.json; simultaneous animated lanes are implemented; native visible sampling, adjacent tangents and mixed-selection Undo/Save/playback pass. f1-floating-curves-workflow.json closes the dedicated nonmodal window and passes layout/draft/mixed Delete/Undo/Save/playback; physical modifier-wheel plus global DPI/dense acceptance stay open |
| Media, ordinary-resolution playback and export | Partial | f2-native-arrow-hold-workflow.json qualifies native timed0.5x Program arrow hold logic, single-flight seek, cancellation and actual Windows single stepping; physical held-key acceptance remains.  f7-native-4k-export-workflow.json additionally qualifies48-frame native4K A/V import/Save/reopen and byte-exact Web/native4K MP4/AAC export within4GiB, with the isolated backend stopped; synthetic2s scope leaves representative long-footage and physical acceptance open.  f6-verified-take-workflow.json proves full-HD export and native/API parity; f2-program-lookahead-workflow.json qualifies one speculative future and natural 1× five-minute boundary at 960×540 on a Full HD timeline, Save and 75-frame Full HD/AAC export EOF. f2-source-lookahead-workflow.json qualifies adjacent Source continuation; f2-source-placement-workflow.json records the EOF project-view CAS fix. Representative long moving ordinary-resolution sources and physical audio/device acceptance stay open |
| Effects and advanced timeline | Partial | f3-native-inspector-choice-previews.json qualifies all five native choice drafts and exact cancellation without history changes; physical pointer/DPI scope remains.  f3-effects-workflow.json, nativeview-workflow.json, f3-mask-inspector-workflow.json; outstanding row-specific pointer, font, moving-media and hardware scope remains |
| Color, audio and voiceover | Partial | f4-native-guides-inline-mixer-workflow.json and subsequent F4 evidence qualify native scopes, mixer, effects, retained recording drafts, placement and persistence. V1 audio edits explicitly stop playback and use Play for the updated mix; uninterrupted live DSP editing is deferred by the owner. Physical recording/device/output and remaining interactions stay open |
| Shared library and presets | Partial | f5-native-web-cifs-catalog-gate.json and f5-library-asset-drop-workflow.json: native/Web CIFS coordination and actual ordered multiasset drag, linked placement, one Undo/Redo, selection, compound playback and Save pass; full desktop GUI and broader offline/large-media lifecycle acceptance remain |
| Atomic take replacement | Qualified | f6-verified-take-workflow.json, including stale shown-B refusal, one Undo, exact save/restart, actual R9700 pixels and full-HD exported-file EOF |
| A/B comparison | Partial | Existing source clocks, stream selection and long-window evidence; sustained full-resolution and physical audio acceptance remain |
| Safe moves, linked/locked edits and stale commands | Qualified regression baseline | Existing native command/Host tests and workflow evidence; rerun affected cases after relevant implementation changes |
| Saved projects, recovery and export history | Qualified bounded behavior | Existing M7 saved/unsaved recovery and durable-receipt evidence, f6-verified-take-workflow.json; no claim of restoring Undo chains or automatically resuming render work |
| Loopback and browser boundaries | Source reviewed; final release gate open | api.rs security middleware checks configured Host and same Origin when supplied; mutation Json extractors, body limits, no-store/nosniff/CSP/referrer headers. Existing API tests cover these boundaries; final integrated candidate must retain them |
| Filesystem and worker boundaries | Source reviewed; final release gate open | Approved root-relative tokens and descriptor validation; native catalog locks/CAS/recovery; bounded probe subprocesses and GPU lock. Final changed-source safety checks remain required |
| Secret/prompt handling and browser rendering | Source reviewed; final release gate open | web/js uses text nodes/textContent for user labels; no innerHTML/eval/Function matches in the reviewed production modules; browser storage is layout/selection preferences, not authentication secrets. This scoped review is not a public-host audit |
| Licenses and notices | Partial inventory; distribution review open | f7-current-prebuilt-workflow.json includes the exact488-text Rust companion within the current candidate and explicitly binds reuse through unchanged manifest/lock/build inputs; its prior embedded candidate identity is historical.  f7-third-party-notice-texts.json supplies488 verified original text files from257/265 normal third-party crate archives; the exact eight missing-text packages, system/font and wider distribution scope remain explicit.  f7-prebuilt-bundle-workflow.json adds189 loader-resolved system-library identities/hashes and supplies GPL/Silero MIT notices with the candidate; aggregate third-party license texts and optional dynamic paths remain open.  f7-linux-normal-dependencies.json collects the selected Linux normal dependency graph offline:272 packages,265 third-party packages with declared licenses, Cargo.lock checksums and current cached-manifest hashes. Six workspace crates omit package license metadata; repository LICENSE is recorded separately. Build/dev edges, exact linked machine code/system libraries, bundled notices/assets and final packaging/distribution review remain. Earlier conservative408-package inventory is retained as historical evidence |
| Rust/JavaScript regression gate | Software gates qualified; native clock scope remains | f7-integrated-regression-workflow.json: full workspace fmt/Clippy/test compilation pass;1777 unique client cases qualify by full-run reuse plus corrected fixture,2031 native cases by reuse plus two corrected fixtures. Nine native app clock cases remain unqualified on virtual output;9 default ignored cases stay explicit. No claim of a green complete native workspace |
| Native desktop regression | Full run performed;9 clock cases unqualified | f7-integrated-regression-workflow.json records every target:2029 initial pass,11 fail,9 default ignored; two vv-web test fixtures are corrected and pass. Production audio/assertions remain unchanged; virtual ALSA/Pulse does not qualify real native clock/device behavior. Physical UX remains open |
| Two-hour typical editing soak | Not passed | m7-two-hour-backend-soak.json is interrupted; m7-halo2-backend-soak-oom.json is failed. Neither qualifies browser memory, hardware or the current candidate. Run once after functionality stabilizes, with bounded halo1 resources; do not repeat failed co-residence or Windows heavy workloads |
| Deployment and rollback | Current internal package and immediate-prior runback qualified; full M7 open | f7-current-prebuilt-workflow.json binds current source5959f90/runtime59b6 and84,684,800byte archive, real packaged/prior67ef/forward startup and exact Saved4K timeline/PNG. Verbatim Rust notices reused with unchanged dependency inputs;189 actual current loader identities. Live editor/protected files preserved. Earlier version-bound evidence follows:  f7-prebuilt-runback-workflow.json proves packaged current -> immutable prior -> packaged forward on the owned Saved4K fixture, exact timeline/PNG and unchanged files; isolated8856 closes, live8855 is preserved. f7-prebuilt-launcher-workflow.json and f7-prebuilt-bundle-workflow.json qualify prebuilt-only startup and persistent verified archive. Current production source5959f90/runtime59b6a3cc0114 remains active; f1-native-relative-scrub-workflow.json records its guarded upgrade and dedicated Saved qualification project.  Full integrated physical/long-media/editing-soak acceptance and scoped license gaps remain. Original M7 requires reload/recovery and operation docs, not whole-host reboot |

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
