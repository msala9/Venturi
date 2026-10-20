#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
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
if [[ -x .runtime/vv-web ]]; then
  exec .runtime/vv-web --projects-root "$HOME/VenturiWeb" "$@"
fi
if ! command -v cargo >/dev/null && [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/venturi-target}"
exec cargo run -p vv-web -- --projects-root "$HOME/VenturiWeb" "$@"
