# npm distribution

Tracking: [Node.js distribution issue #7](https://github.com/OrgSDK/OrgSDK/issues/7).

The platform package is `@orgsdk/cli@0.1.0`. Its `orgsdk` command supervises the platform and separate HTTP executor. The independently installable runner is `@orgsdk/executor@0.1.0`. Both packages use public access on the npm registry. Builds and checks do not publish packages.

On Linux with Node.js 22.22.0 or newer:

```sh
npm install -g @orgsdk/cli@0.1.0
orgsdk start
```

The platform already includes its local executor. Install `@orgsdk/executor@0.1.0` separately only when managing a runner independently.

## Build and install

Use Linux, Node.js 22.22.0 or newer, npm, and Bun 1.4 for development and the existing test suite. `make install` installs the locked development dependencies. `npm run build:npm` builds Next.js, the portable server and JavaScript executor workers. `npm pack --ignore-scripts` packs the completed build; plain `npm pack` runs that build itself.

Install the tarball into a separate directory or globally:

```sh
npm install -g ./orgsdk-cli-0.1.0.tgz
orgsdk start
```

The installed product needs Node.js, but no source checkout, Bun, frontend build tooling or Docker for host mode. SQLite and password hashing use native dependencies; npm must install the packages appropriate to the host. A platform without a matching native prebuild may need its dependency's native build prerequisites. The supported installation target is Linux; project filesystem operations require `/proc`.

The CLI defaults to loopback port 8080. Complete setup in the browser. The local executor manager creates project registrations through the existing authenticated HTTP bootstrap protocol. It never opens the application database. A private bootstrap credential is stored outside the package alongside the installation data. Job workers receive scoped run authority, not the manager credential.

Host mode uses the current OS account and is intended for trusted code, plugins and clients. Validation and action tests run in disposable workers with allowlisted inputs and no project capability or project directory. They do not gain an OS sandbox from that separation. Docker mode remains available when configured with an executor image, network and data mounts.

For a local Linux Docker runner, build the image with `docker build -t orgsdk-executor:local runtime`, then set `EXECUTOR_IMAGE=orgsdk-executor:local`, `EXECUTION_NETWORK=host` and `EXECUTOR_DATA_BIND=1` before `orgsdk start --mode docker`. Host networking lets job containers reach the default loopback application; bind mounts select each project's own directory. This requires a local Docker daemon with access to those paths. A remote daemon needs its own reachable server address and matching storage configuration.

## Lifecycle and recovery

`orgsdk start` starts both processes and forwards shutdown signals. `orgsdk server` starts only the application. `orgsdk executor --help` exposes the separate registration, start, plugin packaging and manager commands. Use `--data`, `--host` and `--port` or the documented environment variables to select the installation.

Installation data defaults to `~/.local/share/orgsdk`; executor data defaults to its `executor/` subdirectory. Package installation and upgrades do not delete it. SQLite startup applies pending generated migrations; `orgsdk migrate` applies them while stopped. Existing Bun-created password hashes remain usable under Node.js. Do not use an experimental Django-era database.

Before upgrading, stop OrgSDK and preserve the database, matching encryption key and executor project folders. Install the selected version with `npm install -g @orgsdk/cli@VERSION`, then run `orgsdk start` with the same data directory. Startup applies pending migrations. Restore into a separate installation for recovery; reinstalling an older package does not reverse database migrations.

`orgsdk backup DESTINATION` creates a verified database snapshot. Preserve the encryption key and executor data separately. Stop the installation before restoring into a separate empty data directory, restore the matching encryption key, and test recovery before changing an existing installation. A database backup does not contain project files or recover encrypted credentials without the original key.

## Verification

`npm run test:distribution -- ./orgsdk-cli-0.1.0.tgz` installs the real tarball into an empty temporary directory. Use `npm run test:distribution -- @orgsdk/cli@0.1.0` to install from the public registry instead. The application and runner are launched with a path containing only Node.js. `npm run test:distribution:bun -- ./orgsdk-cli-0.1.0.tgz` runs the same acceptance assertions with Bun. These tests exercise frontend and Monaco assets, setup, login, automatic executor registration, code, validation, reusable action tests/execution, persistent files across restart, migration, backup, cancellation and graceful shutdown. They use disposable account and installation data.

Verify the independent registry runner with `npm --prefix runtime run smoke:node -- @orgsdk/executor@0.1.0`. Use `smoke:bun` for the matching Bun assertions. An explicit tarball argument tests that exact artifact without rebuilding it.

CI separates source quality, runtime behavior and standalone executable checks:

| Job                   | Runtime                                             | Coverage                                                                                                                                     |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Source quality        | Bun 1.4.0 and Node.js 22.22.0 tooling               | Full server, executor and frontend unit suites on Bun; formatting, lint, types, migration consistency and frontend build.                    |
| Runtime matrix        | Node.js 22.22.0, latest Node.js 24 patch, Bun 1.4.0 | The same platform contract, packed CLI acceptance, browser suite and packed executor assertions in each runtime.                             |
| Standalone executable | Compiled Bun 1.4.0                                  | Generated database history and browser suite; health/frontend/Monaco checks with an empty working directory and no runtime binaries on PATH. |

The pinned Node.js 22.22.0 lane checks the declared minimum. The Node.js 24 lane follows patch updates within that maintained major. This matrix does not run every unit test under Node.js: the full unit suites remain on Bun, while the shared contract and integration assertions exercise both product runtimes. The required `check` aggregator runs even when a dependency fails and requires every quality, runtime and standalone job to succeed.

After `npm run build:npm`, select the platform and execution-worker runtime for the browser suite with `ORGSDK_E2E_RUNTIME=node ORGSDK_E2E_ENTRY=dist/server/index.js make e2e` or replace `node` with `bun`. The executor package has matching `npm --prefix runtime run smoke:node` and `npm --prefix runtime run smoke:bun` commands. They pack and install the same JavaScript artifact, then assert CLI registration, persistent project files, plugins, validation/tests, durable sessions, cancellation and shutdown under the selected runtime. The Node smoke removes Bun from PATH.

`make check` retains source checks. `make build`, compiled database tests, `ORGSDK_E2E_BINARY=dist/orgsdk make e2e`, and `scripts/smoke-binary.sh` retain the Bun standalone checks. Passing Linux checks does not establish other operating systems or architectures as supported.

## Release procedure

Release requires maintainer authorization separately from implementation. Select a checked commit on `main` and an unused version, update both manifests and lockfiles, and record installation/upgrade notes. Authenticate with an npm account authorized for `@orgsdk`; interactive publication can require browser authentication and a second factor. Do not commit tokens.

1. Run `make install`, `make check`, `npm run build:npm` and the runtime/browser CI matrix.
2. Pack the completed platform with `npm pack --ignore-scripts` and the executor with `npm pack ./runtime --ignore-scripts`. Review both tarballs, including the retained license and runtime provenance. Exclude installation data, credentials, source tests and fixtures.
3. Run `npm run test:distribution -- ./orgsdk-cli-VERSION.tgz` and `npm --prefix runtime run smoke:node -- /absolute/path/orgsdk-executor-VERSION.tgz` against the exact release artifacts. Retain their SHA512 integrity values.
4. Publish each reviewed tarball with `npm publish ./PACKAGE.tgz --access public --ignore-scripts`. Publishing the tarball avoids rebuilding after verification. If one package succeeds and another fails, verify the published package and retry only the missing package; npm versions cannot be overwritten.
5. Check `npm view @orgsdk/cli@VERSION version dist.integrity` and the matching executor metadata against the reviewed artifacts. Repeat both acceptance checks using their pinned registry names. Also verify a fresh global install with an isolated npm prefix.
6. Tag the checked source commit and attach the reviewed artifacts and release notes to the GitHub release. Report package publication, source merge and any installation update separately.

For future automated releases, npm supports [trusted publishing from GitHub Actions](https://docs.npmjs.com/trusted-publishers/) with OIDC, npm 11.5.1+ and Node.js 22.14+. Configure the exact repository and workflow for each package before relying on it. This repository does not automatically publish packages or update running installations.
