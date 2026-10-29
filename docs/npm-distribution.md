# npm distribution

Tracking: [Node.js distribution issue #7](https://github.com/OrgSDK/OrgSDK/issues/7).

The platform candidate is `@orgsdk/cli@0.1.0`. Its `orgsdk` command supervises the platform and separate HTTP executor. The standalone runner candidate is `@orgsdk/executor@0.1.0`. Both remain marked private to prevent accidental publication. No package registry release is performed by the build or checks.

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

`orgsdk backup DESTINATION` creates a verified database snapshot. Preserve the encryption key and executor data separately. Stop the installation before restoring into a separate empty data directory, restore the matching encryption key, and test recovery before changing an existing installation. A database backup does not contain project files or recover encrypted credentials without the original key.

## Verification

`npm run test:distribution -- ./orgsdk-cli-0.1.0.tgz` installs the real tarball into an empty temporary directory. The application and runner are launched with a path containing only Node.js. The test exercises frontend and Monaco assets, setup, login, automatic executor registration, code, validation, reusable action tests/execution, persistent files across restart, migration, backup, cancellation and graceful shutdown. It uses disposable account and installation data.

`make check` retains server, runtime and frontend checks. `make build`, compiled database tests, `ORGSDK_E2E_BINARY=dist/orgsdk make e2e`, and `scripts/smoke-binary.sh` retain the Bun standalone checks. The runtime has its own packed Node smoke covering worker/session/plugin behavior. Passing Linux checks does not establish other operating systems or architectures as supported.

## Publication boundary

Before publishing, select and verify the intended package names and scope ownership, review the exact tarball and license/provenance files, select a release version, and obtain publication authorization. Remove the private flag only as part of that release decision. Configure registry authentication or trusted publishing and publish the reviewed artifact. Repository commits, a draft pull request and local tarball installation do not publish an npm package or update a running installation.
