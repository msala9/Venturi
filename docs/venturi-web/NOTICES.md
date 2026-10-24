# Linux development notice companions

The selected Linux normal dependency graph contains 265 third-party packages.
The following immutable companions supply original package texts and additional
notice material separately. Existing binary archives retain their recorded
contents; the next assembled delivery must include all three companions and their
checksums. The current live bf0b322/77d7 executable is described in RUNNING.md.

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
hashed. Fonts and shared libraries remain external prerequisites. The next
binary assembly must compare fresh loader paths/hashes before reusing this
host companion. Arbitrary optional/device/plugin/font paths on other hosts are
outside this configured-host evidence.

These materials cover the selected normal Rust graph and the configured host's
observed runtime/font dependencies. Broader borrowed-code attribution or public
redistribution is not established by inventory alone. No external legal-signoff
or whole-host reboot is introduced as an M7 requirement.

See [original package-text evidence](evidence/f7-third-party-notice-texts.json),
[supplement evidence](evidence/f7-notice-supplement-workflow.json),
[host notice evidence](evidence/f7-host-notices-workflow.json) and
[release checklist](RELEASE_CHECKLIST.md).
