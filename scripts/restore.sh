#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${1:?Usage: scripts/restore.sh /secure/path/backup.dump}"
compose=(docker compose --env-file "${ORGSDK_ENV_FILE:-.env.deployment}" -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
# Stop writers before restoring.
"${compose[@]}" stop app
count=$("${compose[@]}" exec -T postgres psql -U orgsdk -d orgsdk -Atc "select count(*) from information_schema.tables where table_schema='public'")
if [[ "$count" != 0 ]]; then
  printf '%s\n' 'Refusing to overwrite a nonempty database.' >&2
  exit 1
fi
"${compose[@]}" exec -T postgres pg_restore -U orgsdk -d orgsdk --exit-on-error < "$1"
