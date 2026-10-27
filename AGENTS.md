# Development checks

- Follow `CONTRIBUTING.md`: use an issue-linked feature branch and pull request targeting `main`. Keep unrelated changes separate. Do not push feature commits directly to `main`, merge PRs, publish releases or deploy without authorization for that action.

- Python dependencies are managed with uv; JavaScript dependencies with npm in `frontend/`.
- Run `make install` after cloning. Run `make check` before finishing changes.
- Frontend gates: `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck`, and `npm --prefix frontend run check` (format, lint, types and API contract drift).
- After changing DRF serializers, API views or routes, run `make api-generate`. Commit `frontend/openapi.json` and `frontend/src/api/schema.d.ts` together. Do not edit generated files.
- React owns application, account and setup pages and routing. Django owns /api/, /admin/ and /static/. Keep builds independent; do not mount React in Django templates. API calls use the shared typed client, session bootstrap and Django CSRF protection.
- Tailwind styles the React frontend in `frontend/src/`. Account and setup pages reuse the product React components and styles. Write complete utility class names, not dynamically constructed class fragments.
- SQLite is the only product database. The single ASGI API process also runs durable background jobs and periodic maintenance. Jobs live in each app's `tasks.py` and are registered in `apps/core/jobs.py`; enqueue outbox records inside the same transaction as their domain changes. Keep tasks safe to repeat and network operations outside write transactions. Do not start a separate database worker or give executors database access.

- Local product availability is not gated by subscriptions or rollout flags. Enforce workspace membership and executor capabilities in Django, not only React.

# OrgSDK product boundaries

- Next.js owns the static application UI; Nginx routes API and admin traffic to Django; account and setup pages are static React routes.
- `apps/agents` owns execution projects (the retained Agent identity) and snapshot assembly; `apps/actions` owns action/workflow definitions, immutable versions, project-owned plugins, run artifacts and schedules; `apps/credentials` owns encrypted workspace credentials, API management, run snapshot credential scope and redaction; `apps/runs` owns code/action/check runs and archived chat records, events, human approvals and shared lifecycle/API services; `apps/audit` owns audit records and recording; `apps/api_access` owns API tokens and scoped authentication; `apps/documents` owns independent workspace documents/memory; `apps/tables` owns typed workspace table definitions and rows. `apps/execution` owns code execution infrastructure: the external executor protocol, worker coordination and workspace execution settings (pool, enablement, and concurrency). Execution routes authorized artifact operations to actions; it does not own workflow definitions or artifacts. Never add product database access to `runtime/`.
- `apps/mcp` owns MCP routing, JSON-RPC handling, tool schemas and dispatch. MCP and REST call the owning app services; never import REST views into MCP.
- `apps/workspaces` owns registered domains, hostname resolution, shared workspace API authorization and workspace setup/provisioning. Hostnames select a registered workspace, while membership authorizes access. Scope both querysets and related serializer fields.
- Executor capabilities are scoped to a run snapshot. Keep user/plugin credential management and human approvals outside executor authority.
- Project table/document grants are manager-owned. Runtime data access intersects the immutable run snapshot with current project grants; adding a grant cannot widen an existing run. File SDK operations stay within the project's `workspace/` directory, outside plugin caches and executor registration files.
- `apps/actions` owns immutable saved-action contracts, promotion provenance and versioned mocked test suites. Validation/test runs use protocol 3 and a Docker container without network, project storage or run credentials, even when ordinary execution uses explicit host mode. The supervisor reports their lifecycle outside that container. New semantic action versions require protocol 3 before live execution; retain legacy snapshot compatibility.
- Preserve third-party license notices and runtime vendor provenance.
- `make api-generate` also generates `runtime/src/generated/schema.d.ts`, `frontend/auth-openapi.json` and `frontend/src/api/auth-schema.d.ts`; commit all product and authentication API artifacts together.
- Runtime checks use Bun 1.4.0 (`make runtime-check`), including retained sandbox tests. `make check` includes file-backed SQLite contention, queue recovery and authentication cache tests. SQLite write services must use short `transaction.atomic()` blocks, configured as `BEGIN IMMEDIATE`.
- Installation fixture scripts may run only against the isolated `orgsdk-platform-test` project. Never reuse its known test account in a personal installation.

- `config/api.py` composes domain-owned REST routes. Shared random-secret/digest primitives live in `apps/core/tokens.py`. First-party migrations are a fresh-install baseline for the current domain apps; no product app, migration label or legacy table overrides remain. Existing databases created with superseded migrations require a separate upgrade plan.

- Local-only product: any number of projects per workspace, one registered executor per project, serial runs in persistent project folders. Existing Agent IDs, database tables and executor directory names are compatibility details. External clients own reasoning and conversation; built-in chat and reasoning delegation are retired. Plugins are external and project-owned. Do not reintroduce bundled integrations, hosted billing or cloud provisioning. Runtime registration secrets stay outside job environments.
