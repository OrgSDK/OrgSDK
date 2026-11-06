# Local development

Use Linux, Node.js 22.22+ with npm, and Bun 1.4. The native SQLite dependency also needs Python 3 and a C++ build toolchain (Debian/Ubuntu: `python3 build-essential`). Run these from the platform repository:

```sh
npm run setup
npm run dev
```

`setup` uses the committed npm lockfiles for the platform, frontend and executor. `dev` starts the API at `127.0.0.1:8081`, a development proxy at `http://localhost:3000`, Next on loopback port 3001, and a separate trusted host executor manager. Complete workspace setup using `localhost` as the domain. New enabled projects receive local runners automatically. No Docker, database service or npm package build is needed.

The API and executor reload source changes; Next provides HMR. Restart `npm run dev` after changing dependencies or environment configuration. Ctrl+C stops the process groups, including active execution workers. Failed startup or an unexpectedly exited component stops the other components. Occupied ports fail before any child starts.

Development data, keys and project files persist under `.runtime/dev` in this checkout. This command does not read repository `.env` files or use an installed OrgSDK data directory. It passes process environment settings such as SMTP and plugin catalog configuration to its children. Project code runs with your host account's privileges, so use trusted code.

| Variable                   | Default                            | Purpose                                       |
| -------------------------- | ---------------------------------- | --------------------------------------------- |
| `ORGSDK_DEV_API_PORT`      | `8081`                             | API loopback port                             |
| `ORGSDK_DEV_UI_PORT`       | `3000`                             | Browser-facing proxy port                     |
| `ORGSDK_DEV_NEXT_PORT`     | `3001`                             | Internal Next server port                     |
| `ORGSDK_DEV_HOST`          | `127.0.0.1`                        | UI bind address; use `0.0.0.0` for LAN access |
| `ORGSDK_DEV_ORIGIN`        | `http://localhost:<UI port>`       | Browser origin, matching the workspace domain |
| `ORGSDK_DEV_DATA_DIR`      | `.runtime/dev`                     | Explicit development installation directory   |
| `NEXT_DEV_ALLOWED_ORIGINS` | machine hostname plus dotted hosts | Additional comma-separated HMR hostnames      |

For LAN access, choose the browser hostname in `ORGSDK_DEV_ORIGIN`, allow that hostname for HMR and create the workspace with the same domain. The API remains on loopback behind the development proxy, which preserves the browser's Host header for workspace selection and CSRF. Next's built-in external rewrites change that header and cannot serve this role. Application calls use inferred tRPC; the executor uses named operations with fixed protocol routes and `ORGSDK_SERVER_URL`.

## Verification

| Command                    | Scope                                                                            |
| -------------------------- | -------------------------------------------------------------------------------- |
| `npm run test:unit`        | Pure logic, schemas, compiler/VM behavior and mocked UI logic                    |
| `npm run test:integration` | Database, application transport, filesystem and child-process integration        |
| `npm run test:cli`         | Node CLI parsing and supervision                                                 |
| `npm run test:dev`         | Disposable dev setup, proxied login, execution, validation, shutdown and restart |
| `npm run check:server`     | Server/tooling formatting, lint, types and migration drift                       |
| `npm run check`            | All source checks, dead-code gate, both test groups, frontend checks/build       |
| `npm run e2e`              | Browser flow against disposable installation data                                |
| `npm run build`            | Standalone Bun executable                                                        |
| `npm run build:npm`        | Node platform, frontend and executor distribution                                |
| `npm run smoke:binary`     | Embedded health, UI and Monaco with an empty PATH/data directory                 |

Integration test filenames use `.int.test.ts`; existing JavaScript tests use `.int.test.mjs`. The explicit file selector ensures unit runs never include integration files. Server tests currently all exercise real databases/application fixtures and belong to integration. Browser specs stay in `e2e`. Real Docker tests remain opt-in (`ORGSDK_SESSION_DOCKER_TEST=1`). Test fixtures use temporary storage; never point them at `.runtime/dev` or a personal installation.

Browser prerequisites: `bunx playwright install chromium` and OpenSSL. Build before browser tests so the static frontend is available. See [distribution verification](npm-distribution.md#verification) for Node/Bun and compiled-binary modes.

## Maintenance

`npm run deadcode` checks unused files, dependencies and unresolved imports across the three packages using [Knip](https://knip.dev/reference/configuration). Entrypoints include standalone worker processes, the public session and sandbox APIs, and dynamically built contract probes. The root `pino` dependency is required by the executor copied into the platform npm artifact. Review findings before deletion; do not auto-delete dynamic entrypoints or published APIs. `npm run deadcode:exports` provides the wider unused-export report for manual review.

`npm run prune:empty` removes empty source directories, recursively. It excludes Git, dependencies, build output and persistent runtime state. `npm run deps:outdated` reports dependency updates in all three packages. Keep tRPC client/server aligned and regenerate frontend SDK assets with `npm --prefix frontend run predev` when their renderer or locked dependencies change.

Development/build commands use TypeScript tooling. Published CLI launchers and package acceptance probes use plain Node ESM so they can verify a distribution without a TypeScript loader or Bun; the systemd installer remains a shell script for its Linux administration commands. Public entrypoints are invoked through `package.json`; Make is not required.

The executor's obsolete generated OpenAPI snapshot has been removed. Frontend generated SDK declarations and Zod libraries remain necessary for the action editor and are verified by its check command. Database migrations and snapshots remain authoritative generated artifacts.

Dependency updates retain TypeScript 6 for the executor compiler API and the existing Monaco 0.52 / frontend TypeScript 5.9 pairing. Monaco 0.57 bundles an advisory-affected DOMPurify version, so that upgrade is deferred. Scoped minimatch and esbuild overrides update vulnerable tooling transitives; validate migration generation and lint after changing them. The installed Next lint plugins still advertise ESLint peers through version 9 while the current Unicorn and ESLint config require version 10; npm reports these upstream peer warnings. The lint gates exercise the installed combination.

## Cleanup verification — 6 November 2026

Verified locally on Linux with Node.js 22.22.1 and Bun 1.4.0, on base `950fd77` plus the cleanup changes:

- `npm run setup` completed with unchanged manifest and lockfile hashes; all three npm audits reported zero vulnerabilities.
- `npm run check` passed: 110 unit tests, 183 integration tests and seven Node CLI tests, plus formatting, lint, type checks, migration drift, Knip and the frontend build. The default Docker opt-in skip was exercised separately and passed against the rebuilt job image.
- `npm run test:dev` passed first setup/login through the proxy, automatic execution, validation, process shutdown, restart and persistent project files. A real browser verified setup/login and HMR preserving an entered draft, with no console errors.
- Both Node distribution and standalone browser suites passed all 17 tests. The standalone empty-PATH smoke and compiled migration tests passed.
- The platform tarball passed fresh Node-only installation acceptance. Executor tarballs passed the Node and Bun runtime acceptance suites, including missing-Docker failure and manager shutdown.
- Platform, job and supervisor Docker images built. An isolated Compose rehearsal verified private backup files, refusal to overwrite a backup, restore with the matching key, healthy startup and matching SQLite schema/migration history. Its test containers and volumes were removed.

These are local checks; they do not represent a commit, registry publication or deployment. The optional Chromium job image and Node.js 24 matrix job were not exercised locally.
