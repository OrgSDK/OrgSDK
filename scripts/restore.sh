#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${1:?Usage: scripts/restore.sh /secure/path/backup.sqlite3}"
source_path=$(realpath "$1")
test -f "$source_path"
compose=(docker compose -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
"${compose[@]}" run --rm --no-deps -T --entrypoint /bin/sh app -c \
  'umask 077; cat > /tmp/orgsdk-restore.sqlite3; exec /usr/local/bin/orgsdk restore /tmp/orgsdk-restore.sqlite3' < "$source_path"
printf '%s\n' 'Database restored.'
