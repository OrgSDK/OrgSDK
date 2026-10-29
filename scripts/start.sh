#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}" up -d --build --wait --wait-timeout 180
printf 'OrgSDK is ready. Open http://localhost:%s to set up your workspace.\n' "${HTTP_PORT:-8080}"
