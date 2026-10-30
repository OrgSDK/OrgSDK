# Server structure

The application API is native tRPC at `/trpc`. `router/index.ts` exports
`appRouter` and its inferred `AppRouter` type for frontend and service clients.
There are no `/api/...` routes, Hono routers, REST adapters or synthetic HTTP calls.
The frontend uses the typed client in `frontend/src/api/trpc.ts`, with inputs and outputs inferred directly from `AppRouter`.

| Directory                            | Responsibility                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `router/`                            | Endpoint business logic in logical tRPC subrouters. One procedure per file; `index.ts` only composes its module. |
| `http/`                              | Fetch adapter, origin/CSRF checks, session context, response headers and static files.                           |
| `platform/`                          | Node.js/Bun HTTP listeners, password hashing and package asset locations.                                        |
| `auth/`, `workspaces/`               | Shared session, MFA and membership policies, schemas, views and queries.                                         |
| `projects/`, `actions/`, `runs/`     | Shared grants, snapshots, immutable versions, run creation, validation and queries.                              |
| `documents/`, `tables/`, `tokens/`   | Typed resource schemas, scoped queries and shared public views.                                                  |
| `credentials/`                       | Input schemas, shared actor permissions and scoped credential queries.                                           |
| `plugins/`, `automations/`, `audit/` | Shared catalog loaders, cron/ingress, schemas, views and audit queries.                                          |
| `repositories/`                      | Concrete Drizzle queries and atomic audited mutations.                                                           |
| `domain/`, `shared/`                 | Reusable authorization, validation, errors, pagination and cryptography.                                         |
| `execution/`                         | Separate executor's wire protocol, claims, capabilities, isolated jobs, project data and maintenance.            |
| `oauth/`                             | Provider exchange, callback and credential refresh.                                                              |
| `api/`                               | MCP transport and checked wire models. MCP invokes native procedures.                                            |
| `db/`                                | Database lifecycle, Drizzle models and generated migrations.                                                     |
| `mail/`, `cli/`                      | Mail delivery and operator commands.                                                                             |
| `tests/`                             | Native caller, HTTP tRPC, security, migration and executor integration tests.                                    |

`index.ts` owns the command line and process lifecycle. `app.ts` composes tRPC,
static files and the dedicated external transports. The retained transports are
MCP at `/mcp/`, OAuth provider redirects at `/oauth/callback`, authenticated webhook
delivery at `/webhooks/:id`, and the separate executor's existing
`/internal/execution/v1/` protocol. These are external protocol boundaries, not
alternative application APIs. Their management operations are tRPC procedures.

## Procedure ownership and shared modules

- Group subrouters by product module: `auth`, `users`, `workspace`, `projects`,
  `credentials`, `plugins`, `actions`, `tables`, `documents`, `runs` and related modules.
- Put one procedure in each handler file, for example `router/credentials/create.ts`.
  A handler selects middleware, declares its Zod contract and owns the endpoint's
  business logic and orchestration directly in its callback. Do not create a
  forwarding service used only by that procedure.
- Extract shared schemas, authorization, validation, public views and reusable
  operations outside `router/` when they have a concrete responsibility. Keep
  endpoint-only Drizzle queries inside their procedure callbacks; extract query
  mechanics into feature modules or repositories when they are actually reused.
  Shared operations accept typed inputs and explicit dependencies or `ServiceContext`;
  they return data and raise `ServiceError` codes independently of tRPC. A small
  procedure that composes these modules needs no additional service layer.
- Derive client input/output types from `AppRouter`. Create uses a typed object;
  update uses `{ id, ...changedFields }`. Reject unknown fields. Use `project`,
  without retired `agent` aliases. Resource identifiers are UUIDs; account and
  membership identifiers follow their integer Drizzle models.
- Request context injects `userId`, the Drizzle `db`, workspace membership, scoped
  token and encryption capability. The native database and Store never enter it.
  `ServiceContext` excludes HTTP objects. Auth's cookie adapter remains in
  `router/identity-context.ts`.
- Declare request-wide access with the shared procedure builders below. They
  inject the narrowed identity/workspace context; callbacks do not repeat browser,
  membership, role or static scope checks. Mutation CSRF remains common to every
  procedure, including batches. Login state changes cannot authorize sibling calls
  in the same batch. Resource grants and conditional operation scopes remain with
  their business rules; transactions, asynchronous operations and subscriptions
  recheck authoritative state when it can change during a request.
- Use Drizzle for application reads/writes. Push scope, filters, ordering and limits
  into SQL. Select public fields explicitly; encrypted secrets and token digests
  cannot appear in serialized responses. Tokens accept explicit client scopes.
- Put reference checks, dependent writes and audit records in one short immediate
  transaction. Pass its Drizzle context onward; nested operations use savepoints.
  Await catalog/provider calls and password hashing before entering a transaction,
  then recheck authoritative state before writing.
- Use native tRPC subscriptions for run events, with sequence cursors, completion
  and continuing authority checks. Do not add a parallel REST event endpoint.

## Middleware policies

| Procedure                        | Access                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `publicProcedure`                | Public requests, with mutation CSRF enforcement.                                                                   |
| `browserProcedure`               | Browser transport, including anonymous setup and login.                                                            |
| `authenticatedBrowserProcedure`  | Signed-in browser identity; workspace membership is optional.                                                      |
| `freshBrowserProcedure`          | Signed-in browser with recent identity confirmation.                                                               |
| `protectedProcedure`             | Authenticated workspace member, browser or scoped client.                                                          |
| `browserWorkspaceProcedure`      | Browser identity with workspace membership.                                                                        |
| `browserManagerProcedure`        | Browser workspace owner or admin.                                                                                  |
| `browserOwnerProcedure`          | Browser workspace owner.                                                                                           |
| `browserSessionManagerProcedure` | Browser manager with a session bound to OAuth state.                                                               |
| `scopedProcedure(scope)`         | Workspace member with the required client scope, or array of scopes. Browser members retain their resource access. |

A procedure such as `router/webhooks/list.ts` selects `browserWorkspaceProcedure`
and directly loads and serializes its data. Endpoint-specific orchestration stays
in that callback, including its endpoint-only Drizzle queries. Reused queries,
shared rules, crypto and serializers remain in their feature modules. A separate
service forwarding to the same one callback adds no boundary and must not be introduced.

## Quality and verification

Use descriptive variable names, guard clauses, braces on every control statement,
one variable per declaration, kebab-case filenames and Prettier defaults. Keep all
server TypeScript files within 300 physical lines, including tests and comments.
Extract responsibilities before a file reaches the limit. Explicit and unsafe
`any` are banned across the server, tooling and tests. Accept `unknown` at external
boundaries and validate it. Do not suppress rules or add unchecked assertions.

`bun run check` runs formatting, lint, types and migration drift checks.
`bun test server` exercises the server independently of the frontend. Full product
checks additionally include the separate frontend and executor projects. Do not
use personal installation data in tests.

If VS Code reports unsafe assignments of "error typed" values after files or
exports move, compare with `bun run check`. When that check passes, run
**ESLint: Restart ESLint Server** to refresh the editor's cross-file type cache.
TypeScript-ESLint documents this [stale editor diagnostics issue](https://typescript-eslint.io/troubleshooting/typed-linting/#editor-eslint-reports-become-out-of-date-after-file-changes).
If the diagnostic persists, inspect its underlying TypeScript/import error;
keep the unsafe-type rules enabled.

## Database ownership

Drizzle models in `db/schema/` are the schema source of truth, including defaults,
constraints and indexes. Generate changes with `bun run db:generate --name <change>`;
review the SQL, snapshots and journal. Do not edit applied migrations, add bootstrap
DDL or use schema push. `bun run db:check` verifies generated history and model drift.

The standard migrator applies pending migrations on startup or through
`orgsdk migrate`. The executable embeds migrations for fresh installs and forward
upgrades. Tests verify record/credential preservation, migration rollback, backups
and the tRPC activity-column rename. Earlier Django/experimental databases are not
imported. Keep installation keys and executor data separate.

Native SQLite is confined to opening/configuring the database, migration-history
inspection and physical backup/restore. Application dependencies expose a Drizzle
interface without `$client`. The encryption capability is initialized once from
the installation key and exposes no filesystem paths.

`db/connection.ts` selects the Bun SQLite or Node.js better-sqlite3 driver. Both
expose the same synchronous Drizzle operations and immediate transaction behavior.
The Node npm build keeps the driver modules in lazy chunks; otherwise the Bun
driver import can be evaluated before runtime selection. The standalone Bun build
uses the Bun driver exclusively and embeds its assets and migrations.
