#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${1:?Usage: scripts/backup.sh /secure/path/backup.dump}"
umask 077
compose=(docker compose --env-file "${ORGSDK_ENV_FILE:-.env.deployment}" -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
# A failed dump must not leave an apparently valid backup at the destination.
backup_temporary=$(mktemp "${1}.XXXXXX")
trap 'rm -f "$backup_temporary"' EXIT
"${compose[@]}" exec -T postgres pg_dump -U orgsdk -Fc orgsdk > "$backup_temporary"
mv "$backup_temporary" "$1"
printf '%s\n' 'Database backup written. Preserve .env.deployment, server-data secrets and media separately.'
