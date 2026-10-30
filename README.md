# OrgSDK

OrgSDK gives external AI clients persistent projects for executing code and building tested, reusable actions. The application combines a static Next.js interface with a Node.js or Bun API, tRPC, and a Drizzle-managed SQLite store. Executors are independent HTTP clients; they do not access the application database.

## Install from npm

On Linux with Node.js 22.22.0 or newer, install the platform package and start it:

```sh
npm install -g @orgsdk/cli
orgsdk start
```

Open `http://127.0.0.1:8080` and create your workspace and account. The command starts the platform and a separate executor manager. It connects a local runner for each enabled project, so code, validation and action tests can run without a separate registration command. Neither Bun nor Docker is required for this local mode. Code and plugins run with your current user's host privileges; use trusted code and clients. This mode is not an operating-system sandbox.

`orgsdk start --data /path/to/installation --port 8081` selects another installation. Data defaults to `~/.local/share/orgsdk`, outside the npm package: the database and encryption key are in that directory, and executor project folders are under `executor/agents/`. Stopping with Ctrl+C stops the supervised processes. Reinstalling the package does not remove installation data; back up that directory before upgrading.

Use `orgsdk server` to run only the platform, or `orgsdk executor --help` to register and run a separate executor. Independently managed runners can install `@orgsdk/executor` from npm. `orgsdk start --mode docker` uses the existing Docker executor configuration and requires Docker, an executor image and the documented network/storage settings. See [the executor guide](runtime/README.md). Linux is the current supported host because persistent project-file access uses `/proc`; macOS and Windows are not supported.

See [distribution and verification](docs/npm-distribution.md) for pinned installation, upgrades, recovery and release checks.

## Build and run locally

Install Bun 1.4, Node.js 22.22.0 or newer and npm, then run `make install` and `make build`. Start `dist/orgsdk` and open `http://127.0.0.1:8080`. The executable embeds the frontend, including Monaco, and does not require Bun or Node at runtime. `HOST`, `PORT`, and `ORGSDK_DATA_DIR` configure listening and storage. The default data directory is `~/.local/share/orgsdk`.

To build the npm package, run `npm run build:npm`, then `npm pack --ignore-scripts`. The tarball includes the platform JavaScript, frontend, migrations and executor workers. `npm pack` without `--ignore-scripts` builds those assets automatically. Use `npm run test:distribution -- ./orgsdk-cli-0.1.0.tgz` to install and verify the actual tarball with temporary data and a Node-only runtime path. Replace the tarball argument with `@orgsdk/cli@0.1.0` to verify the registry release.

The Drizzle schema is the source of truth. Startup applies pending generated migrations to `orgsdk.sqlite3`, and the executable embeds the migration files. Start the initial installation in an empty data directory. This is a greenfield schema without compatibility with the earlier experimental database.

For development, run `make dev` and `make frontend` in separate terminals. Next uses `ORGSDK_PROXY_TARGET` (default `http://127.0.0.1:8080`). Run `make check` for formatting, lint, types, migrations and the full Bun unit suites. Install Playwright's browser if needed with `bunx playwright install chromium`; browser tests also need OpenSSL for their temporary TLS mailbox.

After `npm run build:npm`, run the same browser suite against either runtime with `ORGSDK_E2E_RUNTIME=node ORGSDK_E2E_ENTRY=dist/server/index.js make e2e` or replace `node` with `bun`. The selected runtime runs both the application and its separate execution worker. To test the standalone product, run `ORGSDK_E2E_BINARY=dist/orgsdk make e2e` after `make build`. All browser modes create disposable installation data and a local mailbox, reject requests to retired `/api` routes, and preserve existing installations.

CI tests Node.js 22.22.0, the latest Node.js 24 patch and Bun 1.4.0 in separate jobs using shared platform, packaged-installation, browser and executor assertions. The full unit suites remain on Bun; the compiled Bun executable has its own regression job. The required `check` job succeeds only when every quality and runtime job succeeds. See [the verification commands and coverage](docs/npm-distribution.md#verification).

## Database development

Edit the Drizzle models in `server/db/schema/`, including foreign keys, indexes,
checks and defaults. Run `bun run db:generate --name <change>` and review the
resulting SQL, snapshots and journal in `server/db/migrations/`. Commit generated
migrations with their schema changes. Do not edit an applied migration or use
schema push. `bun run db:check` verifies the generated history and checks for drift.

Startup applies migrations automatically. To apply them without starting the
server, run `bun run db:migrate` or `dist/orgsdk migrate` with `ORGSDK_DATA_DIR`
set to the intended installation. The migration command refuses to run while a
server owns that data directory. Tests cover fresh installs, forward upgrades,
repeat starts, encrypted data, database constraints and failed-upgrade rollback.

## Containers and executor

`scripts/start.sh` builds and starts the app using Compose. By default it binds to localhost port 8080 and uses a distinct `orgsdk-bun` project and data volume. Review `compose.yaml` before changing its bindings or project name. The optional `runner` profile builds the separate executor and job images. Configure the same private `LOCAL_EXECUTOR_BOOTSTRAP_TOKEN` for the app and executor before starting that profile. The executor has Docker socket access so it can run isolated jobs; protect the host accordingly.

## Backup and recovery

`scripts/backup.sh /secure/path/backup.sqlite3` creates a verified SQLite snapshot. Back up the matching encryption key from the application data directory and the executor project data separately, with appropriate access controls. A database snapshot alone cannot recover encrypted credentials or project files. Backups preserve the source migration level without upgrading it; restored databases apply pending migrations on their next startup.

`scripts/restore.sh /secure/path/backup.sqlite3` restores only into a Bun data volume without a database. Put the matching `encryption.key` in that volume before running the restore. Test recovery in a separate Compose project and preserve the source backup. Restore into a separate empty data directory.

The source is distributed under [LICENSE](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

For OAuth, set `ORGSDK_PUBLIC_ORIGIN` to the installation's exact public origin and use the same hostname for workspace setup. HTTPS is required except for loopback HTTP. Invitations require SMTP: configure `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_FROM`, and optional paired `SMTP_USER` and `SMTP_PASSWORD`. STARTTLS is required by default; set `SMTP_SECURE=true` for implicit TLS. Keep credentials private. See `.env.example` for names; provide environment variables to your process or Compose deployment through your normal secrets mechanism.

If local account recovery is needed, an administrator with access to the server can run `orgsdk reset-password EMAIL` and enter the new password at the private interactive prompt.

For an HTTPS reverse proxy, set `ORGSDK_PUBLIC_ORIGIN` to the public HTTPS origin, preserve the public Host header, and keep the backend reachable through that trusted proxy. The application uses the explicit origin for CSRF and Secure cookies; it ignores forwarded scheme and host headers. Health checks and authenticated internal executor routes keep their direct service address.

The prior Django implementation and its management commands are retained in Git history. The Django admin interface is retired; use the application settings and account pages. The frontend uses native tRPC throughout, with input and output types inferred directly from the Bun server router. Application REST compatibility routes and OpenAPI snapshots have been removed.
