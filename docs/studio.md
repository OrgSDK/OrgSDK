# OrgSDK Studio

Build the static dashboard with `npm run build:studio` after `npm run setup`. Serve the contents of `frontend/dist/studio/` at the root of a dedicated HTTPS origin. Support directory indexes and serve the included scripts and styles on the same origin. Exclude third-party scripts from this site. A dashboard release can read and act on the workspaces that approve it.

Local installations accept pairing requests from `https://studio.orgsdk.ai` by default. Set `ORGSDK_STUDIO_ORIGIN` to an empty string to disable pairing, or to an exact HTTPS origin to use a different dashboard. Remote installations explicitly configure their dashboard origin. The installation serves setup, login, MFA, invitations and pairing approval. Opening its root or a workspace bookmark leads to Studio. Disabling Studio leaves these installations accessible through their APIs and account pages.

For the official deployment, build the export from the released source revision and run `npx wrangler@4.147.0 deploy --config wrangler.studio.jsonc` from the repository root. The configuration serves the static files at `studio.orgsdk.ai`.

## On this computer

Start OrgSDK. New local installations bind to the first available loopback port from 28940 through 28947 and save it in the data directory. The next launch tries the saved port first. Existing databases with no saved port retain 8080. Use `--port` or `PORT` for a fixed listener, including installations with pre-registered OAuth callback URLs. Docker's internal service address and existing host mapping are configured in Compose.

Open the printed dashboard link, or choose **Connect to this computer** in the hosted dashboard and grant the browser permission to reach loopback. Pick an installation if several respond. The browser checks the product, protocol and configured dashboard origin before offering a connection. An explicit server address also covers ports outside the discovery range. Chrome and Firefox found compatible local installations in browser tests. Linux WebKit did not discover the plain HTTP loopback listeners in the same setup. For plain HTTP loopback use a supported browser with local-network access enabled.

## On a customer server

The same export can connect to a remote installation. Give each customer's installation its own hostname, data directory, encryption key and executor environment. Set, for example, `ORGSDK_PUBLIC_ORIGIN=https://customer.example.com`, `ORGSDK_STUDIO_ORIGIN=https://studio.example.com` and a fixed backend `PORT`. Terminate HTTPS at the installation's reverse proxy, preserve the public Host header and initialize the matching workspace hostname and first owner before enabling public ingress. Keep backend listeners and executor registration private. Provide any public OAuth callbacks, MCP or webhook routes on the installation hostname. Only expose the routes your deployment uses. Disable proxy response buffering for tRPC event streams.

In Studio, enter the installation's HTTPS origin and choose **Connect to server**. The browser contacts that one address directly. Enter account credentials on the installation, check the dashboard origin displayed on the approval page, and approve. A user on a different computer can follow the same flow. Customer provisioning, backups, executor isolation and production operation are separate deployment responsibilities.

## Connection lifetime

Protocol version 1 uses a one-minute single-use approval code bound to a browser-generated challenge. The verifier stays in the initiating tab until exchange. The approval comes from an authenticated installation session. Studio keeps its 30-minute session credential in page memory and sends it in a request header for queries, mutations and event streams. Reloading Studio or restarting the server requires a new approval. Signing out of the approving account invalidates its dashboard access. Existing workspace permissions apply to every paired request. Manage account security and reconfirm identity on the installation.

## Offline use and updates

Visit Studio online once and allow its service worker to finish downloading the dashboard, including the editor. After that, you can reopen Studio at the same address when the dashboard host is unreachable. The installation must still be running and reachable for discovery, approval and workspace operations. A fresh browser profile, cleared site data or browser storage eviction requires another online visit.

Studio checks for a new release when opened, when a tab becomes visible and hourly while visible. It verifies the static files before activating the release. If a download fails, the previous release remains available. When an update is ready, save your work and close all Studio tabs. The next session uses the new release. API responses, credentials and workspace records are outside the service worker cache.

Serve the generated `sw.js` from the Studio origin root with revalidation enabled. Preserve the exported asset bytes when hosting them. HTML rewriting or script injection will fail the worker’s integrity checks. Keep the Studio export compatible with the installation’s pairing protocol.
