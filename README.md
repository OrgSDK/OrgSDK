# OrgSDK

OrgSDK gives external AI clients persistent projects for executing code and building tested, reusable actions. The application combines a static Next.js interface with a Bun API, tRPC, and a Drizzle-managed SQLite store. Executors are independent HTTP clients; they do not access the application database.

## Build and run locally

Install Bun 1.4, Node 22 and npm, then run `make install` and `make build`. Start `dist/orgsdk` and open `http://127.0.0.1:8080`. The executable embeds the frontend, including Monaco, and does not require Bun or Node at runtime. `HOST`, `PORT`, and `ORGSDK_DATA_DIR` configure listening and storage. The default data directory is `~/.local/share/orgsdk-bun`.

This version uses a fresh database format. It refuses to open an existing Django database; use a new data directory and retain the old installation and its data. No migration from Django is provided.

For development, run `make dev` and `make frontend` in separate terminals. Next uses `ORGSDK_PROXY_TARGET` (default `http://127.0.0.1:8080`). Run `make check` for code checks and `make e2e` for browser tests against a temporary isolated database. Install Playwright's browser if needed with `bunx playwright install chromium`.

## Containers and executor

`scripts/start.sh` builds and starts the app using Compose. By default it binds to localhost port 8080 and uses a distinct `orgsdk-bun` project and data volume. Review `compose.yaml` before changing its bindings or project name. The optional `runner` profile builds the separate executor and job images. Configure the same private `LOCAL_EXECUTOR_BOOTSTRAP_TOKEN` for the app and executor before starting that profile. The executor has Docker socket access so it can run isolated jobs; protect the host accordingly.

## Backup and recovery

`scripts/backup.sh /secure/path/backup.sqlite3` creates a verified SQLite snapshot. Back up the matching encryption key from the application data directory and the executor project data separately, with appropriate access controls. A database snapshot alone cannot recover encrypted credentials or project files.

`scripts/restore.sh /secure/path/backup.sqlite3` restores only into a Bun data volume without a database. Put the matching `encryption.key` in that volume before running the restore. Test recovery in a separate Compose project and preserve the source backup. Never reuse an old Django data directory for this format.

The source is distributed under [LICENSE](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

For OAuth, set `ORGSDK_PUBLIC_ORIGIN` to the installation's exact public origin and use the same hostname for workspace setup. HTTPS is required except for loopback HTTP. Invitations require SMTP: configure `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_FROM`, and optional paired `SMTP_USER` and `SMTP_PASSWORD`. STARTTLS is required by default; set `SMTP_SECURE=true` for implicit TLS. Keep credentials private. See `.env.example` for names; provide environment variables to your process or Compose deployment through your normal secrets mechanism.

If local account recovery is needed, an administrator with access to the server can run `orgsdk reset-password EMAIL` and enter the new password at the private interactive prompt.

For an HTTPS reverse proxy, set `ORGSDK_PUBLIC_ORIGIN` to the public HTTPS origin, preserve the public Host header, and keep the backend reachable through that trusted proxy. The application uses the explicit origin for CSRF and Secure cookies; it ignores forwarded scheme and host headers. Health checks and authenticated internal executor routes keep their direct service address.

The prior Django implementation and its management commands are retained in Git history. The Django admin interface is retired; use the application settings and account pages. REST compatibility type snapshots remain for existing clients; tRPC types come from the Bun server.
