#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if [[ -x .runtime/vv-web ]]; then
  exec .runtime/vv-web --projects-root "$HOME/VenturiWeb" "$@"
fi
if ! command -v cargo >/dev/null && [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/venturi-target}"
exec cargo run -p vv-web -- --projects-root "$HOME/VenturiWeb" "$@"
