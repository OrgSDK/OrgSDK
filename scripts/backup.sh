#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${1:?Usage: scripts/backup.sh /secure/path/backup.sqlite3}"
umask 077
compose=(docker compose -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
container_path="/tmp/orgsdk-backup-$(date +%s)-$$.sqlite3"
backup_temporary=$(mktemp "${1}.XXXXXX")
cleanup() { "${compose[@]}" exec -T app rm -f "$container_path" >/dev/null 2>&1 || true; rm -f "$backup_temporary"; }
trap cleanup EXIT
"${compose[@]}" exec -T app /usr/local/bin/orgsdk backup "$container_path"
"${compose[@]}" exec -T app cat "$container_path" > "$backup_temporary"
ln "$backup_temporary" "$1"
rm "$backup_temporary"
printf '%s\n' 'SQLite snapshot written. Preserve the encryption key and executor project data separately.'
