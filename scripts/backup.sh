#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${1:?Usage: scripts/backup.sh /secure/path/backup.sqlite3}"
umask 077
compose=(docker compose --env-file "${ORGSDK_ENV_FILE:-.env.deployment}" -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
backup_temporary=$(mktemp "${1}.XXXXXX")
trap 'rm -f "$backup_temporary"' EXIT
"${compose[@]}" exec -T app python scripts/server.py manage backup_database > "$backup_temporary"
mv "$backup_temporary" "$1"
printf '%s\n' 'Verified SQLite snapshot written. Preserve installation secrets, media and executor folders separately.'
