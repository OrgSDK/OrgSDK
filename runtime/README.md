# Persistent project executor

This private-release npm package provides `orgsdk-executor`. Install the local `npm pack` tarball with npm; it has not been published. Node 22+ and Bun 1.4.x on PATH are required. Docker execution additionally requires Docker with `--mount volume-subpath` support, a built executor image, and network access to the OrgSDK application.

Create an executor identity for the chosen project in the application. Register using its token on stdin (or `EXECUTOR_TOKEN`), without placing the token in command history:

```sh
orgsdk-executor register --url http://localhost:8080 --data /path/to/private-runner
orgsdk-executor start --data /path/to/private-runner
```

Registration saves the token in `registration.json` with mode 0600. Docker is the default mode. Configure `EXECUTOR_IMAGE`, `EXECUTION_NETWORK`, and `EXECUTOR_DATA_VOLUME`; set `--data` to the mounted volume root so it contains `agents/<agent-id>`. Docker jobs mount only their own agent subdirectory at `/agent`, use `/agent/workspace` as their working directory, and receive only their run capability through stdin. Other agents and registration files are not mounted. The managed installation runs `orgsdk-executor manage` (or `src/supervisor.ts`) with `DJANGO_URL` and `LOCAL_EXECUTOR_BOOTSTRAP_TOKEN`. Each identity has one serial worker; revoked identities stop and remain stopped while the same revoked registration is advertised. Bootstrap omissions stop active workers; a later explicit re-enable or replacement identity starts a new worker. Transient startup failures retry with a bounded delay.

Use `start --mode host` explicitly to run child jobs using the current OS account, its PATH and HOME. Host mode can use installed command-line tools and their account configuration; it is appropriate only for trusted plugins. It filters bootstrap, token, password, API key and credential environment variables from child jobs. Plugin code still receives only snapshot-authorized product credentials through the run capability. Host processes retain OS account filesystem access. Docker is the default isolation boundary.

Project workspace files and installed plugin releases survive runs. No run cleanup deletes the agent folder. Plugins install under `agents/<id>/plugins/<slug>/<sha256>/plugin.mjs`; historical pinned versions remain available to retries. Current enabled configuration is fetched before each claim. External clients own reasoning and coordination. The runtime executes action, code, validation and test jobs only; built-in chat and reasoning delegation are retired. Existing `agents/<id>` storage paths and `--agent` install arguments identify retained project IDs.

The separate [execution session module](src/sessions/README.md) supports successive cells in one live worker, stable session IDs, cursor-based events and retained history after close or expiry. It is an internal module and is not connected to the existing executor job loop or public APIs.

## External plugins

No built-in plugin implementations are shipped. Supply a self-contained ESM JavaScript release URL over HTTPS in `package_url`, its lowercase SHA256 as `digest`, and repository/source links in marketplace metadata. Up to five HTTPS redirects are followed (HTTP downgrades are rejected), streaming downloads are capped at 32 MiB, bytes are verified before import, and cached releases are verified without fetching again. Modules can export `safeFunctions` directly or a default context factory returning `safeFunctions`, optional `onLoad`, and optional Zod config schema. Inline custom plugins continue to accept TypeScript and positional handlers with the authorized secret as the first argument when configured. External factory handlers use the named canonical contract. The factory receives snapshot-scoped credential/config stores; mutation is denied. Bundle dependencies into the release. Raw npm packages and tarballs are not accepted by this version.

An administrator can preinstall a local bundle with the same digest checks. Leave `package_url` blank in the catalog for a release available only as a local file; each assigned agent needs its own installed copy:

```sh
orgsdk-executor install --agent AGENT_ID --manifest manifest.json --file plugin.mjs --data /path/to/private-runner
```

Runtime checks: `bun run check`. Build a local installable artifact with `npm pack`. Do not publish without separate authorization.

For an existing plugin checkout using the canonical `.plugin.json` with `name`, `version`, and `entry`, install its dependencies in that checkout, then run `orgsdk-executor package-plugin --directory CHECKOUT --output RELEASE_DIR`. This adapter uses Bun to bundle the entry and installed dependencies into one ESM file and emits a manifest preserving the original plugin metadata (including any declared tools/docs/auth/config). The adapter accepts a checkout root containing `plugin/.plugin.json` or the plugin directory itself. It also emits `<slug>.catalog.json`, an array matching the OrgSDK marketplace catalog (tool schemas, documentation, auth metadata and configuration schema). Set the immutable HTTPS `package_url` in that catalog and configure `PLUGIN_CATALOG_PATH` to use it; `release_metadata` is pinned when installed. The companion manifest is for the local install command. The emitted digest pins the exact compiled bytes; reproducing the source build still requires the checkout's own dependency lock. Canonical source `.tgz` packages are not directly installed or executed. Local preinstall via `install --file` avoids a release server for development without weakening digest checks.

## Install an optional local Linux service

Use this optional systemd service to run a project executor on a local Linux machine.
The service communicates with the Bun application over HTTP and never accesses the application database.
Use `http://localhost:8080` when the service runs on the server machine, or the
server's reachable local network address when using another machine. Docker
jobs also need a server address reachable from their container; container
`localhost` refers to the job container itself. Allow outbound access to the
server, plugin release URLs and configured model providers. No inbound executor
port is needed. Create one executor identity per agent in the application; a
service instance uses that identity and processes one run at a time.

Build the private npm artifact from `runtime/` with `npm pack`, and transfer the
resulting tarball to the local Linux machine if needed. Install Node 22+/npm,
systemd, and **Bun 1.4.x in a system-wide path** such as `/usr/local/bin/bun`.
Docker mode also needs Docker
Engine. Extract the installer from the tarball and run it as root:

```sh
tar -xzf orgsdk-executor-0.1.0.tgz package/scripts/install-service.sh
sudo bash package/scripts/install-service.sh "$PWD/orgsdk-executor-0.1.0.tgz" researcher docker
```

The installer creates `/opt/orgsdk-executor`, the `orgsdk-researcher` system
account, `/var/lib/orgsdk-executor/researcher` (0700), the root-only environment
file `/etc/orgsdk-executor/researcher.env`, and a systemd template. It prints the
exact registration command with a silent shell token prompt and stdin pipe;
the token is never a command argument. Registration saves it as 0600 in the
private data directory. The service starts only after registration and your
explicit `systemctl enable --now orgsdk-executor@researcher` command. Replace
the printed `https://YOUR-SERVER` placeholder with your reachable local server URL.

For Docker mode, build the job image on the service machine from the repository
root with `docker build -t orgsdk-executor:local runtime`. When using another
local build machine, transfer the image with `docker save`/`docker load`. Set
`EXECUTOR_IMAGE` in the environment file to that image. The default
`EXECUTION_NETWORK=bridge` supports outbound server access. Each job bind-mounts
only its agent directory, runs as the service account's numeric UID/GID, and
receives a run capability through stdin. Registration and environment files
are outside that mount. Docker group access grants host administration power;
use a dedicated trusted executor machine.

For host execution, pass `host` to the installer explicitly. Host plugins run
under the instance account and can access its private files, including its
registration; use this mode only with trusted plugins. Docker is the default.
No bootstrap token is required for either service mode.

Repeat the installer with another instance name and register another agent to
add independent services and persistent folders. Package files are shared;
stop all executor services before upgrading the package, rerun the installer,
then restart them. Existing data and environment files are preserved. Inspect
logs with `journalctl -u orgsdk-executor@researcher`; stop a runner with
`systemctl stop orgsdk-executor@researcher`. Stopping does not delete files.
The artifact includes TypeScript sources and dependencies and requires Bun;
it is not a standalone executable.

## Publishing compatible plugin bundles

`package-plugin` creates a standalone ESM release with dependencies bundled. Supply `--license FILE` when publishing to retain that first-party license plus the installed production dependency licenses in the bundle and its `.notices.txt` companion. Missing upstream license files must be supplied from their actual upstream source before publication; the builder never fetches licenses or changes source-repository visibility.

Some libraries (such as Playwright) need their original package-file layout. Opt in with `--embed-dependencies playwright`: the package carries a compressed dependency closure, validates every extracted file against its embedded SHA256 before loading, and uses a package-local directory. It does not depend on a checkout or a shared `node_modules` directory. Do not use this to distribute platform-specific native binaries as portable JavaScript.

Browser's engine is a runner prerequisite. The optional `Dockerfile.chromium` includes the Chromium version matching Playwright 1.60.0; it adds no plugin implementations to the platform:

```sh
docker build -t orgsdk-job:chromium -f runtime/Dockerfile.chromium runtime
make EXECUTOR_JOB_IMAGE=orgsdk-job:chromium executor
```

Independently managed executors can select that image using `EXECUTOR_IMAGE`. Standard executors remain unchanged. Host-mode runners need matching Chromium at `PLAYWRIGHT_BROWSERS_PATH`.

Release acceptance can be repeated without a personal installation or provider API calls:

```sh
bun --no-env-file runtime/scripts/verify-plugin-releases.ts \
  --catalog https://orgsdk.ai/plugins/releases.json
```

Use `--catalog /path/releases.json --bundle-root /path/bundles` before publication. Add `--render-pdf` when the matching engine is provisioned to exercise real PDF output. Every package is checksum-verified, installed in temporary `orgsdk-platform-test` project storage, and loaded to compare its exported tools to the catalog. Data Tools is exercised through the VM action interface. This does not prove provider OAuth setup or live external writes.

The retained `DJANGO_URL` executor setting is the application base URL for protocol compatibility. Point it at the Bun server, for example `http://127.0.0.1:8080`. The server binary does not include or start the executor.
