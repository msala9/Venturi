#!/usr/bin/env bash
# Read-only inventory. Never installs drivers or changes host configuration.
set -u
printf '%s\n' '== OS =='
if test -r /etc/os-release; then grep -E 'PRETTY_NAME|VERSION_ID' /etc/os-release; fi
uname -r || true
printf '%s\n' '== toolchain =='
for c in rustc cargo clang pkg-config ffmpeg vulkaninfo; do
  if command -v "$c" >/dev/null 2>&1; then
    printf '%s: %s\n' "$c" "$(command -v "$c")"
  else
    printf '%s: missing\n' "$c"
  fi
done
rustc --version 2>/dev/null || true
pkg-config --modversion libavcodec 2>/dev/null || true
printf '%s\n' '== GPU =='
lspci -Dnn 2>/dev/null | grep -Ei 'VGA|3D|Display' || true
ls -l /dev/dri /dev/dri/by-path 2>/dev/null || true
vulkaninfo --summary 2>&1 | head -80 || true
printf '%s\n' '== permissions =='
id
printf '%s\n' 'Read-only inventory complete.'
