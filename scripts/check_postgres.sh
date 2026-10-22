#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="orgsdk-pgcheck-$$"
trap 'docker rm -fv "$container" >/dev/null' EXIT
docker run --name "$container" --tmpfs /var/lib/postgresql:rw,size=1g -d -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=isolated-test-only postgres:18 >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
port=$(docker port "$container" 5432/tcp | cut -d: -f2)
TEST_DATABASE_URL="postgres://postgres:isolated-test-only@127.0.0.1:$port/postgres" uv run pytest tests/test_accounts.py tests/test_product.py tests/test_webhooks.py tests/test_tables.py tests/test_project_data.py tests/test_token_activity.py tests/test_fresh_install.py tests/test_installation_setup.py tests/test_agent_plugin_migration.py tests/test_mcp_code_migration.py tests/test_scoped_clients.py tests/test_code_claims.py tests/test_code_execution.py tests/test_action_authoring.py tests/test_authoring_claims.py tests/test_mcp_authoring.py tests/test_postgres_jobs.py tests/test_project_api.py tests/test_harness_retirement.py tests/test_run_origin_migration.py -q
