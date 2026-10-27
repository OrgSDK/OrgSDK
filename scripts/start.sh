#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
environment_file="${ORGSDK_ENV_FILE:-.env.deployment}"
export ORGSDK_ENV_FILE="$environment_file"
if [[ ! -f "$environment_file" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    ORGSDK_ENV_FILE="$environment_file" python3 scripts/init_deployment.py "$@"
  else
    environment_directory="$(cd "$(dirname "$environment_file")" && pwd)"
    environment_name="$(basename "$environment_file")"
    docker run --rm --user "$(id -u):$(id -g)" \
      -e ORGSDK_ENV_FILE="/output/$environment_name" \
      -v "$PWD:/workspace:ro" -v "$environment_directory:/output" -w /workspace \
      python:3.14-slim python scripts/init_deployment.py "$@"
  fi
fi
compose=(docker compose --env-file "$environment_file" -f "${ORGSDK_COMPOSE_FILE:-compose.yaml}")
"${compose[@]}" up -d --build --wait --wait-timeout 180
printf '%s\n' 'OrgSDK is ready. Open the configured local port (default http://localhost:8080) to create your administrator and first agent.'
