#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
binary="${VENTURI_WEB_BINARY:-.runtime/vv-web}"
if [[ "$binary" != /* ]]; then binary="$PWD/$binary"; fi
if [[ ! -f "$binary" || ! -x "$binary" ]]; then
  printf 'Venturi Web prebuilt executable is missing or not executable: %s\n' "$binary" >&2
  printf 'Set VENTURI_WEB_BINARY to a prebuilt vv-web executable, or place one at %s/.runtime/vv-web.\n' "$PWD" >&2
  printf 'This launcher does not build or install binaries.\n' >&2
  exit 127
fi
for argument in "$@"; do
  if [[ "$argument" == --software-preview ]]; then
    software_icd=""
    for candidate in /usr/share/vulkan/icd.d/lvp_icd*.json; do
      if [[ -f "$candidate" ]]; then software_icd="$candidate"; break; fi
    done
    if [[ -z "$software_icd" ]]; then echo "Mesa lavapipe ICD is unavailable" >&2; exit 1; fi
    export VK_DRIVER_FILES="$software_icd" LP_NUM_THREADS=2 TOKIO_WORKER_THREADS=2
  fi
done
exec -- "$binary" --projects-root "$HOME/VenturiWeb" "$@"
