# OrgSDK Platform

OrgSDK gives external AI clients a persistent place to execute code and build tested, reusable actions. Projects hold files, plugins and run history. Saved actions have immutable versions, input/output contracts and isolated mocked tests. External clients own reasoning and conversation; Django owns authentication, permissions, credentials, approvals and persistence, and Next.js provides the interface.

Each project has one registered executor and processes one run at a time. Executors communicate with Django through scoped HTTP capabilities and have no database access. Connect external clients through MCP with explicit operation scopes and project or action-version grants. Plugins are external, project-owned releases.

## Install and run

Install Docker Engine 26+ with Compose and volume-subpath support, then run from this checkout:

```sh
./scripts/start.sh
```

Open **http://localhost:8080** and create your administrator and first project. Startup builds the application, starts PostgreSQL, applies migrations and generates a private `.env.deployment` configuration. Keep that file private. To start managed Docker executors:

```sh
docker compose --env-file .env.deployment --profile runner up -d --build --wait
```

The server listens on `0.0.0.0:8080`; set `BIND_ADDRESS=127.0.0.1` in `.env.deployment` for loopback-only access. Sign-in and workspace membership control access. No model-provider account is required to set up the server.

For a separately registered executor, local package installation, host execution and external plugin packaging, see the [executor guide](runtime/README.md).

## Develop

Requirements: Python 3.14+, uv 0.13.1+, Node 22+, npm, Bun 1.4.0 and Docker Compose.

```sh
make install
make dev
```

Open **http://localhost:5173**. Django, Next.js, background workers and executor source reload during development. Use `FRONTEND_PORT=5174 DJANGO_PORT=8001 make dev` to choose different ports. Rebuild executor images with `make executor-rebuild` after runtime dependency or base-image changes.

## Checks

```sh
make check                # lint, runtime, frontend, API contracts, build and Python tests
make api-generate         # regenerate contracts after API changes
scripts/check_postgres.sh # isolated PostgreSQL claims and locking tests
```

Commit generated frontend and runtime API contracts together with API changes. Runtime-specific commands and packaging are covered in the [executor guide](runtime/README.md). Retained runtime source attribution is recorded in [runtime provenance](runtime/PROVENANCE.md).

## Report issues and propose changes

Open a [bug report or feature request](https://github.com/OrgSDK/OrgSDK/issues/new/choose) to propose a change. Maintainers implement accepted work through pull requests; PR creation is limited to repository collaborators. See the [change workflow](CONTRIBUTING.md) for development, review and release steps.

## License

OrgSDK is source-available under the [OrgSDK Source-Available License](LICENSE). Personal, non-business use and internal use by businesses with fewer than 15 staff are permitted without a license fee. Staff are counted across the business group, including working owners and regular contractors. Businesses with 15 or more staff, hosting for others, and selling or embedding access to OrgSDK require a separate written commercial license. This includes access through APIs, MCP and agents.

You can share forks without charging for copies while retaining the license and notices. Separately identified third-party components keep their own licenses; see the [frontend notices](frontend/public/THIRD_PARTY_NOTICES.md) and [runtime provenance](runtime/PROVENANCE.md). The license contains the full terms.
