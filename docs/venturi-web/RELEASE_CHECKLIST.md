# Release checklist

2026-10-23. Current working source `4e983c2`; the full F1-F7 goal remains active.
This is the release audit required by IMPLEMENTATION_PLAN.md, not a release-ready
declaration. The ledger currently records 47 done, 43 partial and two excluded
capabilities. New unqualified source changes do not inherit acceptance from this
checkpoint.

| Requirement | Current result | Authoritative evidence / remaining work |
|---|---|---|
| Full in-scope native behavior | Incomplete | FUNCTIONAL_PARITY.csv and COMPLETION_PLAN.md; all 43 partial rows remain in scope |
| Compact native interface | Qualified baseline | native-ui-workflow.json, current-workspace-delivery.json; remaining physical scaling and dense-editing checks are explicit |
| Multi-track editing and Inspector | Partial | f1-native-gestures-workflow.json, f3-mask-inspector-workflow.json, f1-native-curve-viewport-workflow.json; simultaneous animated lanes are implemented; native visible sampling, adjacent tangents and mixed-selection Undo/Save/playback pass. f1-floating-curves-workflow.json closes the dedicated nonmodal window and passes layout/draft/mixed Delete/Undo/Save/playback; physical modifier-wheel plus global DPI/dense acceptance stay open |
| Media, ordinary-resolution playback and export | Partial | f6-verified-take-workflow.json proves full-HD export and native/API parity; f2-program-lookahead-workflow.json qualifies one speculative future and natural 1× five-minute boundary at 960×540 on a Full HD timeline, Save and 75-frame Full HD/AAC export EOF; project-view CAS warning, remaining Source/F2 and physical audio acceptance stay open |
| Effects and advanced timeline | Partial | f3-effects-workflow.json, nativeview-workflow.json, f3-mask-inspector-workflow.json; outstanding row-specific pointer, font, moving-media and hardware scope remains |
| Color, audio and voiceover | Partial | f4-native-guides-inline-mixer-workflow.json: scope guides/responsive first slot, native inline peaks, retained EOF draft, one-Undo Apply, Solo/Mute and Save pass; edits during playback and physical recording/device/output remain |
| Shared library and presets | Partial | f5-native-web-cifs-catalog-gate.json and f5-library-asset-drop-workflow.json: native/Web CIFS coordination and actual ordered multiasset drag, linked placement, one Undo/Redo, selection, compound playback and Save pass; full desktop GUI and broader offline/large-media lifecycle acceptance remain |
| Atomic take replacement | Qualified | f6-verified-take-workflow.json, including stale shown-B refusal, one Undo, exact save/restart, actual R9700 pixels and full-HD exported-file EOF |
| A/B comparison | Partial | Existing source clocks, stream selection and long-window evidence; sustained full-resolution and physical audio acceptance remain |
| Safe moves, linked/locked edits and stale commands | Qualified regression baseline | Existing native command/Host tests and workflow evidence; rerun affected cases after relevant implementation changes |
| Saved projects, recovery and export history | Qualified bounded behavior | Existing M7 saved/unsaved recovery and durable-receipt evidence, f6-verified-take-workflow.json; no claim of restoring Undo chains or automatically resuming render work |
| Loopback and browser boundaries | Source reviewed; final release gate open | api.rs security middleware checks configured Host and same Origin when supplied; mutation Json extractors, body limits, no-store/nosniff/CSP/referrer headers. Existing API tests cover these boundaries; final integrated candidate must retain them |
| Filesystem and worker boundaries | Source reviewed; final release gate open | Approved root-relative tokens and descriptor validation; native catalog locks/CAS/recovery; bounded probe subprocesses and GPU lock. Final changed-source safety checks remain required |
| Secret/prompt handling and browser rendering | Source reviewed; final release gate open | web/js uses text nodes/textContent for user labels; no innerHTML/eval/Function matches in the reviewed production modules; browser storage is layout/selection preferences, not authentication secrets. This scoped review is not a public-host audit |
| Licenses and notices | Incomplete | f7-license-inventory.json hashes LICENSE/Cargo.lock and records 408 conservative locked packages, cached license expressions and FFmpeg configuration. Exact production closure, missing manifests, bundled notices/assets and final distribution review remain |
| Rust/JavaScript regression gate | Affected gates pass; final gate open | f6-verified-take-gate.json and f5-shared-audio-presets-gate.json. These do not substitute for the final workspace fmt/Clippy/tests and relevant browser checks in TEST_PLAN.md |
| Native desktop regression | Affected native gate passes; final gate open | F5's 45 native cases cover changed catalog/Mixer/Settings/recovery paths; full final native regression and physical UX remain |
| Two-hour typical editing soak | Not passed | m7-two-hour-backend-soak.json is interrupted; m7-halo2-backend-soak-oom.json is failed. Neither qualifies browser memory, hardware or the current candidate. Run once after functionality stabilizes, with bounded halo1 resources; do not repeat failed co-residence or Windows heavy workloads |
| Deployment and rollback | Preserved baseline; final delivery pending | Current working port8820 targets halo1 source672b495 with Saved long A/V montage, lookahead and Full HD tail export; halo1 ports8813/8816/8817/8818/8819 complete Sessions/projects/Undo stay unchanged. Older halo2 editors are preserved, including dirty8790/8811. Final version still needs integrated release acceptance, export and reboot/rollback instructions |

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
Resolve the canonical NAS configuration and physical acceptance requirements.
Then run the final bounded regression gate and one two-hour realistic editing
soak on halo1, preserving every protected editor and the shared GPU lock. Publish
the verified final candidate, rollback procedure and artifact paths only after
those gates pass.
