#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${1:?Usage: scripts/restore.sh /secure/path/backup.sqlite3}"
compose=(docker compose --env-file "${ORGSDK_ENV_FILE:-.env.deployment}" -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
"${compose[@]}" stop app
"${compose[@]}" run --rm -T --no-deps app manage restore_database < "$1"
