# Linux development notice companions

The selected Linux normal dependency graph contains 265 third-party packages.
The following immutable companions supply original package texts and additional
notice material separately. Existing binary archives retain their recorded
contents; the prior77d7 assembly includes all three companions and their
checksums, as recorded in BINARY_DELIVERY.md. RUNNING.md identifies the current
455662c/8b975f434990 executable; its additive r5 package is pending. The immutable
77d7 and87bc packages and their notices retain their original version bindings.
The87bc package retains all three verbatim companions, with its separately recorded zlib delta; see
`evidence/f7-current-prebuilt-r4-workflow.json`.
Final r5 assembly will recheck the current189 loader identities against the
reviewed188-plus-zlib binding and installed notice texts without changing those
archives, installing packages or implying full release acceptance.

| Companion on halo1 | Bytes | SHA256 |
|---|---|---|
| `/home/halo/.local/share/venturi-web/deliveries/venturi-web-rust-notices-2dbc9697d6e7.tar` | 4014080 | `fefc4a4ea98d9edab61944adf3040b9a09f931cbf910ddbe5ae1e796711b3c57` |
| `/home/halo/.local/share/venturi-web/deliveries/venturi-web-notice-supplement-bf0b322.tar` | 194560 | `2256945f8e90565ffcc5c23675d3df072b4d881c10c347f013727e24f4e88763` |
| `/home/halo/.local/share/venturi-web/deliveries/venturi-web-host-notices-bf0b322.tar` | 3747840 | `5dabeba73e0f4ae1a263e4b36b1727977b1198488b69833835928b6f4052702c` |

Each archive has a same-path `.sha256` companion. Verify these on halo1 and
inspect each archive's `index.json` before assembling a delivery. Preserve the
original archive and its historical embedded binary identity. The current
dependency graph's Cargo/lock/config inputs match the recorded inventory; this
reuse does not change the old archive's provenance.

The original archive supplies 488 verbatim text files from 257 checksum-verified
published crate archives. The supplement supplies 14 notice/reference files for
the other 8 packages, plus their exact published Cargo/VCS provenance files:

| Package | Additional material |
|---|---|
| dasp_sample 0.11.0 | Upstream workspace MIT and Apache texts at recorded commit |
| harfrust 0.5.2 | Upstream workspace MIT text at recorded commit |
| nom-language 0.1.0 | Upstream workspace MIT text at recorded commit |
| profiling 1.0.18 | Upstream workspace MIT and Apache texts at recorded commit |
| spirv 0.4.0+sdk-1.4.341.0 | Upstream workspace Apache text at recorded commit |
| tract-extra 0.23.8, tract-transformers 0.23.8 | Upstream workspace LICENSE/MIT/Apache texts; published `dirty:true` retained |
| ffmpeg-sys-next 9.0.0 | Published Cargo WTFPL declaration and explicitly separate [SPDX WTFPL reference text](https://spdx.org/licenses/WTFPL.html) |

Each upstream text is bound to its Git blob hash, SHA256, request URL and package
revision. Tract texts also match the original published tract-core 0.23.8 texts.
The SPDX reference is identified as reference material rather than an original
FFmpeg package file. Dirty VCS markers do not prove exact clean-commit source
equivalence. No original package notice files were fabricated or replaced.

The host companion supplies 199 verbatim installed copyright/common-license
files for 182 packages owning the 189 recorded loader libraries, the configured
Radeon ICD with its 31 loader dependencies, and eight DejaVu font files. No
copyright file is missing. Installed binary/source package versions are checked
before and after collection. All members and the full index are re-read and
hashed. Fonts and shared libraries remain external prerequisites. The prior77d7 assembly compares all189 fresh loader name/path/resolved/size/SHA
tuples with the host index exactly; see `evidence/f7-current-prebuilt-r2-workflow.json`. Arbitrary optional/device/plugin/font paths on other hosts are
outside this configured-host evidence.

For current87bc assembly, a fresh inventory finds188 unchanged tuples and one
zlib1g patch: `1:1.3.dfsg+really1.3.1-1ubuntu3.1` to
`1:1.3.dfsg+really1.3.1-1ubuntu3.2`. The121272-byte `libz.so.1.3.1` changes
SHA256 from47b61967895b30e8c0c6818dd633ffeb87711cf637c688f981896f0dd84ce23b
to27fa6c6cb94fb5b099ead61758a300dbc392d1dbf307fff6c16a9b8e57fdc9de.
Its2927-byte copyright is unchanged, SHA256
9e5b96d63773a5d177ba264254390f792be07e41748ebd94730981c6cac31cc6.
See `evidence/f7-host-zlib-notice-delta.json`. The existing host archive/index
remain verbatim. A new candidate must bind this exact replacement, verify the
installed copyright against the archived member and fence package/library
identity before and after assembly. This is not189 unchanged-library evidence.
No host package was installed or updated by this work.

These materials cover the selected normal Rust graph and the configured host's
observed runtime/font dependencies. Broader borrowed-code attribution or public
redistribution is not established by inventory alone. No external legal-signoff
or whole-host reboot is introduced as an M7 requirement.

See [original package-text evidence](evidence/f7-third-party-notice-texts.json),
[supplement evidence](evidence/f7-notice-supplement-workflow.json),
[host notice evidence](evidence/f7-host-notices-workflow.json) and
[release checklist](RELEASE_CHECKLIST.md).
