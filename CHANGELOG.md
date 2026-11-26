# Changelog

## 2.7.1

### Fixed

- Studio and the executor now preserve plugin return types when named properties use TypeScript keywords, including the GitHub plugin’s type filter.

## 2.7.0

### Added

- Agents with feedback permission can report friction and plugin failures directly to the private OrgSDK maintainer inbox.

## 2.6.2

### Fixed

- Validate code and isolated action tests now recognize named plugin arguments, including Playwright Local browser calls.

## 2.6.1

### Fixed

- Automatically recover an empty or stale server PID file after an interrupted startup while keeping the installation locked to one process.

## 2.6.0

### Added

- Run a saved action version in an open execution session from Studio or MCP. Each version can run standalone, in a session, or both. Live checks can require an open browser page before an action starts.
- Playwright Local keeps the same browser tab across actions in a session. Existing action versions retain standalone execution. Upgrade separately managed executors to 2.6.0 to use session actions.

## 2.5.1

### Fixed

- Studio shows one set of keyboard-accessible action editor tabs and keeps the action name, save status and run controls readable across screen sizes.

## 2.5.0

### Added

- Configure installed plugins through project-scoped MCP tools, and open plugin settings in a Studio dialog with dedicated Browser CDP fields.

## 2.4.1

### Changed

- Follow installation updates in Studio from confirmation through running actions, reconnection and verified platform and executor readiness.

## 2.4.0

### Added

- Select the workspace name in Studio to switch between saved servers, remove a saved connection, connect to another server, or sign out.

### Changed

- Refresh Studio from the same popup when a verified browser update is ready.

## 2.3.0

### Added

- Refresh a verified Studio build and request a backed-up local platform and executor update from Studio.

Older npm installations need one manual upgrade to 2.3.0 or later. After that, the local owner can choose **Update and restart** when a newer release is available. **Refresh Studio** activates a verified browser build independently. Save your work and close other Studio tabs before refreshing.

## 2.2.0

### Added

- Manage Shell executables in Studio and review unlisted commands with allow-once, always-allow and block decisions.

## 2.1.0

### Changed

- Set up and sign in to local installations inside Studio, automatically reopen valid connections and open a hosted server from the workspace.

## 2.0.1

### Fixed

- Studio discovers local installations on entry and guides new users through installation in a welcome screen matching orgsdk.ai.

## 2.0.0

### Changed

- Studio is the sole workspace dashboard and caches its interface for offline use after the first download. Installations retain setup, account and connection approval pages.

Open Studio online once in each browser before using it offline. Keep the installation running for workspace access. Save your work and close all Studio tabs to activate a downloaded update. See [Studio connections and hosting](docs/studio.md).

## 1.1.1

### Fixed

- The standalone and bundled executor commands report the installed package version when invoked with --version.

## 1.1.0

### Added

- Open [OrgSDK Studio](https://studio.orgsdk.ai) and choose **Connect to this computer** to pair with a local installation. Fresh installations find an available port automatically. Studio also supports explicitly configured HTTPS servers. The bundled dashboard remains available offline.

## 1.0.1

### Fixed

- Show service icons for catalogue and installed plugins, including releases saved without artwork.

## 1.0.0

### Changed

- MCP and tRPC clients must send workspace access tokens with the `orgsdk_mcp_` prefix. After upgrading the platform, prepend it once to each saved OrgSDK workspace token. The token keeps its grants, revocation status and activity history.

## 0.2.1

### Fixed

- The local app now uses the same favicon as orgsdk.ai.
- Publish the tested CLI and executor from stable GitHub releases to npm through CI.
- Allow npm time to process accepted packages before checking release integrity and testing fresh installs.

## 0.2.0

### Added

- Iterate on TypeScript in a persistent project session through MCP and reuse the resulting code in tested actions.
- Connect compatible remote HTTP MCP servers as project plugins with reviewed tools, executor calls and managed authentication.

### Changed

- Collect reviewed changes on develop and prepare versioned CLI and executor releases with an aggregated changelog.
- Generate third-party notices in release artifacts instead of tracking and serving individual frontend license files.

### Upgrading

Stop the application and back up its database, matching encryption key and executor project files. Start 0.2.0 with the same data directory to apply migration `0003_remote-mcp`. The CLI includes the local executor. Upgrade independently managed runners to `@orgsdk/executor@0.2.0` before opening a session, and rebuild Docker job images from the same release when using Docker mode. Tools discovered on a remote MCP server become available to a project after review and enablement.

Release notes are collected from reviewed changes on `develop`. Earlier releases predate this changelog.
