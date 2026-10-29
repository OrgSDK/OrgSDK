#!/usr/bin/env bash
set -euo pipefail
binary=$(realpath "${1:-dist/orgsdk}")
test_dir=$(mktemp -d)
server_pid=
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$test_dir"
}
trap cleanup EXIT
cd "$test_dir"
PATH=/nonexistent ORGSDK_DATA_DIR="$test_dir/data" PORT=18785 "$binary" > "$test_dir/server.log" 2>&1 &
server_pid=$!
for attempt in {1..100}; do
  if curl --fail --silent http://127.0.0.1:18785/trpc/system.health >/dev/null; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then cat "$test_dir/server.log"; exit 1; fi
  sleep 0.1
done
curl --fail --silent http://127.0.0.1:18785/ | grep '<html' >/dev/null
curl --fail --silent http://127.0.0.1:18785/monaco/vs/loader.js >/dev/null
printf '%s\n' 'Standalone executable served health, HTML and Monaco from an empty working directory.'
