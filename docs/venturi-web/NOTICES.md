# Linux development notice companions

The selected Linux normal dependency graph contains 265 third-party packages.
The following immutable companions supply original package texts and additional
notice material separately. Existing binary archives retain their recorded
contents; the next assembled delivery must include both companions and their
checksums. The current live bf0b322/77d7 executable is described in RUNNING.md.

| Companion on halo1 | Bytes | SHA256 |
|---|---|---|
| `/home/halo/.local/share/venturi-web/deliveries/venturi-web-rust-notices-2dbc9697d6e7.tar` | 4014080 | `fefc4a4ea98d9edab61944adf3040b9a09f931cbf910ddbe5ae1e796711b3c57` |
| `/home/halo/.local/share/venturi-web/deliveries/venturi-web-notice-supplement-bf0b322.tar` | 194560 | `2256945f8e90565ffcc5c23675d3df072b4d881c10c347f013727e24f4e88763` |

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

This closes acquisition of notice material for the selected normal graph.
System libraries, fonts, optional dynamic paths, borrowed-code attribution and
distribution scope remain distinct release work. The 189 loader identities in
the packaged snapshot are an inventory, not those libraries' complete notices.

See [original package-text evidence](evidence/f7-third-party-notice-texts.json),
[supplement evidence](evidence/f7-notice-supplement-workflow.json) and
[release checklist](RELEASE_CHECKLIST.md).
