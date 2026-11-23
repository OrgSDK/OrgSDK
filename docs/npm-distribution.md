# npm distribution

Tracking: [Node.js distribution issue #7](https://github.com/OrgSDK/OrgSDK/issues/7).

The platform package is `@orgsdk/cli`. Its `orgsdk` command supervises the platform and separate HTTP executor. The independently installable runner is `@orgsdk/executor`. Both packages use public access on the npm registry. The source package version is `1.0.0`; builds, checks and source merges do not publish packages. Commands containing `VERSION` require a selected published version.

On Linux with Node.js 22.22.0 or newer:

```sh
npm install -g @orgsdk/cli
orgsdk start
```

The platform already includes its local executor. Install `@orgsdk/executor` separately only when managing a runner independently.

## Build and install

Use Linux, Node.js 22.22.0 or newer, npm, and Bun 1.4 for development and the existing test suite. `npm run setup` installs the locked development dependencies. `npm run build:npm` builds Next.js, the portable server and JavaScript executor workers. `npm pack --ignore-scripts` packs the completed build; plain `npm pack` runs that build itself.

Both platform builds generate `dist/THIRD_PARTY_NOTICES.txt` from the installed MCP client/core, Monaco and Zod packages. Package names and versions are recorded, identical license texts are grouped, and upstream license contents are preserved. The platform npm tarball includes the generated file. Ship it alongside the standalone executable; the individual notice files are not frontend assets or tracked source files. The standalone smoke and npm installation tests verify the release notice file.

Install the tarball into a separate directory or globally:

```sh
npm install -g ./orgsdk-cli-1.0.0.tgz
orgsdk start
```

The installed product needs Node.js, but no source checkout, Bun, frontend build tooling or Docker for host mode. SQLite and password hashing use native dependencies; npm must install the packages appropriate to the host. A platform without a matching native prebuild may need its dependency's native build prerequisites. The supported installation target is Linux; project filesystem operations require `/proc`.

New local installations try loopback ports 28940 through 28947 and remember their selected port. Existing installations without a saved port use 8080. The CLI prints the address. An explicit port is exact. Complete setup in the browser. The local executor manager creates project registrations through the existing authenticated HTTP bootstrap protocol. It never opens the application database. A private bootstrap credential is stored outside the package alongside the installation data. Job workers receive scoped run authority, not the manager credential.

Host mode uses the current OS account and is intended for trusted code, plugins and clients. Validation and action tests run in disposable workers with allowlisted inputs and no project capability or project directory. They do not gain an OS sandbox from that separation. Docker mode remains available when configured with an executor image, network and data mounts.

For a local Linux Docker runner, build the image with `docker build -t orgsdk-executor:local runtime`, then set `EXECUTOR_IMAGE=orgsdk-executor:local`, `EXECUTION_NETWORK=host` and `EXECUTOR_DATA_BIND=1` before `orgsdk start --mode docker`. Host networking lets job containers reach the default loopback application; bind mounts select each project's own directory. This requires a local Docker daemon with access to those paths. A remote daemon needs its own reachable server address and matching storage configuration.

## Lifecycle and recovery

`orgsdk start` starts both processes and forwards shutdown signals. `orgsdk server` starts only the application. `orgsdk executor --help` exposes the separate registration, start, plugin packaging and manager commands. Use `--data`, `--host` and `--port` or the documented environment variables to select the installation.

Installation data defaults to `~/.local/share/orgsdk`; executor data defaults to its `executor/` subdirectory. Package installation and upgrades do not delete it. SQLite startup applies pending generated migrations; `orgsdk migrate` applies them while stopped. Existing Bun-created password hashes remain usable under Node.js. Do not use an experimental Django-era database.

Before upgrading, stop OrgSDK and preserve the database, matching encryption key and executor project folders. Install the selected version with `npm install -g @orgsdk/cli@VERSION`, then run `orgsdk start` with the same data directory. Startup applies pending migrations. Restore into a separate installation for recovery; reinstalling an older package does not reverse database migrations.

`orgsdk backup DESTINATION` creates a verified database snapshot. Preserve the encryption key and executor data separately. Stop the installation before restoring into a separate empty data directory, restore the matching encryption key, and test recovery before changing an existing installation. A database backup does not contain project files or recover encrypted credentials without the original key.

## Verification

`npm run test:distribution -- ./orgsdk-cli-1.0.0.tgz` installs the real tarball into an empty temporary directory. Use `npm run test:distribution -- @orgsdk/cli@VERSION` to install from the public registry instead. The application and runner are launched with a path containing only Node.js. `npm run test:distribution:bun -- ./orgsdk-cli-1.0.0.tgz` runs the same acceptance assertions with Bun. These tests exercise frontend and Monaco assets, setup, login, automatic executor registration, code, validation, reusable action tests/execution, persistent files across restart, migration, backup, cancellation and graceful shutdown. They use disposable account and installation data.

Verify the independent registry runner with `npm --prefix runtime run smoke:node -- @orgsdk/executor@VERSION`. Use `smoke:bun` for the matching Bun assertions. An explicit tarball argument tests that exact artifact without rebuilding it.

CI separates source quality, runtime behavior and standalone executable checks:

| Job                   | Runtime                                             | Coverage                                                                                                                                     |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Source quality        | Bun 1.4.0 and Node.js 22.22.0 tooling               | Full server, executor and frontend unit suites on Bun; formatting, lint, types, migration consistency and frontend build.                    |
| Runtime matrix        | Node.js 22.22.0, latest Node.js 24 patch, Bun 1.4.0 | The same platform contract, packed CLI acceptance, browser suite and packed executor assertions in each runtime.                             |
| Standalone executable | Compiled Bun 1.4.0                                  | Generated database history and browser suite; health/frontend/Monaco checks with an empty working directory and no runtime binaries on PATH. |

The pinned Node.js 22.22.0 lane checks the declared minimum. The Node.js 24 lane follows patch updates within that maintained major. This matrix does not run every unit test under Node.js: the full unit suites remain on Bun, while the shared contract and integration assertions exercise both product runtimes. The required `check` aggregator runs even when a dependency fails and requires every quality, runtime and standalone job to succeed.

After `npm run build:npm`, select the platform and execution-worker runtime for the browser suite with `ORGSDK_E2E_RUNTIME=node ORGSDK_E2E_ENTRY=dist/server/index.js npm run e2e` or replace `node` with `bun`. The executor package has matching `npm --prefix runtime run smoke:node` and `npm --prefix runtime run smoke:bun` commands. They pack and install the same JavaScript artifact, then assert CLI registration, persistent project files, plugins, validation/tests, durable sessions, cancellation and shutdown under the selected runtime. The Node smoke removes Bun from PATH.

`npm run check` retains source checks. `npm run build`, compiled database tests, `ORGSDK_E2E_BINARY=dist/orgsdk npm run e2e`, and `npm run smoke:binary` retain the Bun standalone checks. Passing Linux checks does not establish other operating systems or architectures as supported.

## Release procedure

Complete the [develop-to-main release workflow](release-workflow.md) and allow the push checks on the resulting main commit to finish. Package both public artifacts, run the distribution tests against those exact tarballs, then attach them to a **draft** GitHub release with its `vMAJOR.MINOR.PATCH` tag on that commit. Include `release-artifacts.json` with the version, full source commit, and each package’s filename and SHA512 npm integrity as in the [0.2.0 release](https://github.com/OrgSDK/OrgSDK/releases/tag/v0.2.0).

Publishing the stable GitHub release starts [Publish released npm packages](../.github/workflows/publish-npm.yml). It checks the tag, successful main CI, package identities and digests, tests both tarballs, then publishes those same files as `latest` using npm trusted publishing. A final job installs both packages from the public registry and runs their acceptance tests. A matching published version is safe to retry. A mismatched digest or an attempt to move an existing latest version backwards fails.

For each package, configure the GitHub Actions trusted publisher in [CLI settings](https://www.npmjs.com/package/@orgsdk/cli/access) and [executor settings](https://www.npmjs.com/package/@orgsdk/executor/access). Use owner `OrgSDK`, repository `OrgSDK`, workflow `publish-npm.yml`, no environment, and allow direct `npm publish`. The publishing job uses GitHub-hosted runners and OIDC. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

To retry an existing stable release from Actions, select the workflow on `main` and enter the published tag, or run `gh workflow run publish-npm.yml --ref main -f tag=v0.2.0`. When a publisher change merges into protected `develop`, CI also checks the latest published GitHub release to recover a missed publication. It downloads artifacts built for the release commit on main.
