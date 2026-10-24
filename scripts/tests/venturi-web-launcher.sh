#!/usr/bin/env bash
set -euo pipefail
launcher="$(cd -- "$(dirname -- "$0")/.." && pwd)/venturi-web.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/venturi-web-launcher.XXXXXX")"
fixture="$(cd -- "$fixture" && pwd -P)"
trap 'rm -rf -- "$fixture"' EXIT
repo="$fixture/repo with spaces"
mkdir -p -- "$repo/scripts" "$repo/.runtime" "$fixture/bin"
cp -- "$launcher" "$repo/scripts/venturi-web.sh"
cat > "$repo/.runtime/vv-web" <<'BINARY'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "$@" > "$TEST_ARGS"
printf '%s\n' "$PWD" "${VK_DRIVER_FILES-}" "${LP_NUM_THREADS-}" "${TOKIO_WORKER_THREADS-}" > "$TEST_ENV"
exit "${TEST_EXIT:-0}"
BINARY
cat > "$fixture/bin/cargo" <<'CARGO'
#!/usr/bin/env bash
printf 'unexpected Cargo invocation\n' > "$TEST_CARGO"
exit 99
CARGO
chmod +x -- "$repo/.runtime/vv-web" "$fixture/bin/cargo"
test_binary=""
test_exit=0
run_launcher() {
  env PATH="$fixture/bin:$PATH" VENTURI_WEB_BINARY="$test_binary" \
    TEST_ARGS="$fixture/args" TEST_ENV="$fixture/env" TEST_CARGO="$fixture/cargo-called" \
    TEST_EXIT="$test_exit" bash "$repo/scripts/venturi-web.sh" "$@"
}
expect_args() {
  local actual=() expected=("--projects-root" "$HOME/VenturiWeb" "$@")
  mapfile -d '' -t actual < "$fixture/args"
  [[ "${#actual[@]}" == "${#expected[@]}" ]]
  for index in "${!expected[@]}"; do [[ "${actual[index]}" == "${expected[index]}" ]]; done
}
expect_failure() {
  rm -f -- "$fixture/args"
  if run_launcher > "$fixture/stdout" 2> "$fixture/stderr"; then
    printf 'Launcher accepted an invalid executable\n' >&2; exit 1
  fi
  [[ ! -e "$fixture/args" && ! -e "$fixture/cargo-called" ]]
  [[ "$(< "$fixture/stderr")" == *VENTURI_WEB_BINARY* ]]
}

run_launcher --listen 127.0.0.1:8899 --projects-root "$fixture/project with spaces" ""
expect_args --listen 127.0.0.1:8899 --projects-root "$fixture/project with spaces" ""
mapfile -t recorded < "$fixture/env"
[[ "${recorded[0]}" == "$repo" ]]
cp -- "$repo/.runtime/vv-web" "$fixture/vv-web-versioned binary"
rm -- "$repo/.runtime/vv-web"
expect_failure
test_binary="$fixture/vv-web-versioned binary"
run_launcher --help
expect_args --help
cp -- "$test_binary" "$repo/versioned-vv-web"
test_binary=versioned-vv-web
run_launcher --listen 127.0.0.1:8899
expect_args --listen 127.0.0.1:8899
test_exit=23
if run_launcher; then exit 1; else result=$?; fi
[[ "$result" == 23 ]]
test_exit=0
test_binary="$fixture/missing"
expect_failure
test_binary="$fixture/bin"
expect_failure
touch "$fixture/not-executable"
test_binary="$fixture/not-executable"
expect_failure

test_binary="$fixture/vv-web-versioned binary"
software_icd=""
for candidate in /usr/share/vulkan/icd.d/lvp_icd*.json; do
  if [[ -f "$candidate" ]]; then software_icd="$candidate"; break; fi
done
if [[ -n "$software_icd" ]]; then
  run_launcher --software-preview
  expect_args --software-preview
  mapfile -t recorded < "$fixture/env"
  [[ "${recorded[1]}" == "$software_icd" && "${recorded[2]}" == 2 && "${recorded[3]}" == 2 ]]
else
  rm -f -- "$fixture/args"
  if run_launcher --software-preview 2> "$fixture/stderr"; then exit 1; fi
  [[ ! -e "$fixture/args" && "$(< "$fixture/stderr")" == *lavapipe* ]]
fi
[[ ! -e "$fixture/cargo-called" ]]
printf 'Prebuilt-only launcher checks passed\n'
