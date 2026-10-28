# Development checks

- Follow `CONTRIBUTING.md`: use an issue-linked feature branch and pull request targeting `main`. Keep unrelated changes separate. Do not push directly to main, merge, publish or deploy without authorization.
- Use Bun 1.4 for the server and runtime, and npm in `frontend/`. Run `make install`, `make check`, `make e2e`, and `make build` as appropriate. Browser tests use an isolated temporary data directory. Never point test fixtures at a personal installation.
- Next.js owns the static application, account and setup pages. Bun serves the static export and owns REST, tRPC, MCP, SQLite, authentication and maintenance. Keep frontend types and API behavior aligned; do not treat historical Django-generated OpenAPI files as a live contract.
- Preserve Tailwind conventions and established product UI. Protect navigation context and unsaved edits. Shared browser tasks follow the workspace `orgsdk-browser` instructions.
- SQLite writes use short immediate transactions. Executors communicate over HTTP only and never access the product database. Network calls must not run inside write transactions.

# Server organization and quality

- Read `server/README.md` for the module map. Group handlers, validation, views and services by feature. Keep `app.ts` limited to application composition and routing.
- Keep server TypeScript files at or below 300 physical lines, including comments and blank lines. ESLint enforces this for implementation and tests. Split by responsibility, not arbitrary numbered chunks; extract shared test fixtures when needed.
- Use the shared Prettier defaults. Run `bun run format` to format server and tooling changes. `bun run check` checks formatting, ESLint and TypeScript; `make check` additionally checks server tests, frontend and runtime. Run `make build`, compiled-binary `make e2e` and `scripts/smoke-binary.sh` for routing, static asset or module-layout changes.
- Use schema-inferred Drizzle models and concrete repositories. Keep query mechanics in `server/repositories/`, scope resource reads and mutations to the workspace, and push filtering, ordering and limits into SQL. Do not restore generic `any`-typed table dispatch. Keep mutations and their audit records in the same immediate transaction.
- Repositories and schema modules use strict type-aware ESLint rules. The remaining server has a shared correctness lint gate; existing dynamic REST/MCP request parsing is not yet fully typed. Narrow untrusted values at boundaries and improve these types when changing a flow.
- Drizzle models in `server/db/schema/` are the database schema source of truth, including defaults, foreign keys, indexes and checks. Generate migrations with `bun run db:generate --name <change>` and review the generated SQL and snapshots. Never add a handwritten bootstrap schema, edit applied migrations, or use schema push. `bun run db:check` verifies that migrations match the models.
- This is a greenfield database with a fresh migration history. Do not add compatibility with the earlier experimental schema or a Django installation. Test fresh creation and upgrades between generated migrations, including data preservation and rollback after failure. Never modify personal installation data during tests.

# Product boundaries

- Local product: projects have persistent executor folders; external clients own reasoning and conversations. Plugins are external and project-owned. Do not add hosted billing, cloud provisioning or bundled integrations.
- Workspace hostnames select a registered workspace and membership authorizes access. Scope every query and related resource. Enforce permissions in the server, not only the frontend.
- Executor capabilities are scoped to immutable run snapshots. Current project grants further constrain access; changes cannot widen existing snapshots. Keep credentials, registration secrets and approvals outside job authority.
- Preserve immutable action versions, test and validation isolation, protocol compatibility, third-party license notices and runtime vendor provenance.
- SQLite migrations run at startup or through `bun run db:migrate` / `orgsdk migrate`; the compiled executable embeds the generated migration files. Refuse unmanaged or mismatched migration histories. Snapshot SQLite safely and preserve encryption keys and executor data separately.
