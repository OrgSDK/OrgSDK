# Server structure

`index.ts` owns the command line and process lifecycle. `app.ts` registers the HTTP
surface with Hono and delegates API requests and static assets.

| Directory                                          | Responsibility                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `http/`                                            | Request context, origin and CSRF checks, router adapters, shared errors, response headers and static files. |
| `auth/`, `workspaces/`                             | Setup, sessions, login, MFA, accounts, membership and invitations.                                          |
| `projects/`, `actions/`, `runs/`                   | Project grants and snapshots, immutable action versions, run creation, retries and streaming.               |
| `documents/`, `tables/`, `tokens/`, `credentials/` | Resource-specific REST handlers and views.                                                                  |
| `plugins/`, `automations/`, `audit/`               | Plugin catalog and installation, schedules, webhook ingress and audit history.                              |
| `domain/`                                          | Resource route registration and shared authorization policies.                                              |
| `execution/`                                       | Internal executor protocol, claims, capability checks, isolated jobs, project data and maintenance.         |
| `oauth/`                                           | Connection flow, provider exchange and credential refresh.                                                  |
| `api/`                                             | MCP and tRPC adapters and typed response contracts.                                                         |
| `repositories/`                                    | Concrete, schema-typed Drizzle queries and atomic audited mutations.                                        |
| `db/`                                              | Store lifecycle, complete Drizzle schema models and generated migrations.                                   |
| `shared/`, `mail/`, `cli/`                         | Shared validation and cryptography, mail delivery, operator commands.                                       |
| `tests/`                                           | Behavior-focused regression suites and shared fixtures.                                                     |

Keep route handlers focused on HTTP input, authorization and output. Services own
business rules. Repositories execute queries using concrete Drizzle table models;
resource repositories always add workspace scope, including when accepting an
additional SQL filter. Prefer database predicates over reading an entire workspace
and filtering it in JavaScript. Snapshot and grant checks remain business rules.

Write transactions are synchronous and immediate. Nested resource mutations use
savepoints so an outer failure also rolls back audit records. Provider calls, SMTP
and password hashing stay outside write transactions. Executor capability queries
have their own authority model and do not grant browser or account access.

Use Prettier defaults and keep every server TypeScript file within 300 physical
lines. Extract meaningful responsibilities before adding more code to a full file.
`bun run check` runs formatting, lint, types and migration drift checks. `make check` also runs the server,
frontend and executor checks. Formatting is separate from ESLint. Repositories and
schema modules use strict type-aware lint rules; the rest of the server uses a
correctness-focused gate while dynamic request parsing is incrementally typed.

Drizzle models are the schema source of truth. Every constraint and default belongs
in `db/schema/`. Generate a change with `bun run db:generate --name <change>` and
review the generated SQL, snapshots and journal in `db/migrations/`. Do not edit
applied migrations or use schema push. `bun run db:check` checks the migration
history and generates into a temporary directory to detect schema drift.

The Drizzle migrator applies pending migrations on startup, or explicitly through
`bun run db:migrate` / `orgsdk migrate`. The executable embeds the SQL and journal,
so it can initialize and upgrade `orgsdk.sqlite3` without a source checkout.
`0000_initial` creates the complete schema; `0001_queue_indexes` adds execution and
mail queue indexes. Tests exercise both fresh creation and upgrades from the first
migration, preserving records and encrypted credentials and rolling back failures.

This is a greenfield migration history. No compatibility importer or table-renaming
path exists for the earlier experimental database. Use an empty data directory for
the initial installation. Subsequent changes use generated forward migrations.
