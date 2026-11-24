# Iterate on a browser workflow and save an action

An external MCP client can keep a TypeScript session on a project runner while it inspects a live browser. Each cell can use variables and helpers from earlier cells. When the route works, save a self-contained version as an action and run it with new inputs.

## Connect the browser

1. On Linux with Node.js 22.22.0 or newer, install the CLI and start its bundled local executor. Open [Studio](https://studio.orgsdk.ai), choose **Allow local connections**, create a workspace and select a project. A separately managed runner needs `@orgsdk/executor@1.1.0` for this release.

   ```sh
   npm install -g @orgsdk/cli@1.1.0
   orgsdk start --data "$PWD/.runtime/browser-lab"
   ```

2. Start one Playwright MCP process for this project. The example uses Microsoft's 0.0.86 release and a dedicated local Chromium profile. Set `CHROME_BIN` to the full path to Chrome or Chromium.

   ```sh
   npx --yes --package=@playwright/mcp@0.0.86 playwright-mcp \
     --host 127.0.0.1 --port 8931 --headless \
     --executable-path "$CHROME_BIN" \
     --user-data-dir "$PWD/.runtime/playwright-profile" \
     --shared-browser-context
   ```

3. Under **Plugins → Connect MCP server**, use the name `playwright` and the URL `http://127.0.0.1:8931/mcp` for a host runner on the same machine. Choose anonymous authentication, check the connection, review the schema, and enable `browser_run_code_unsafe`. This upstream tool executes Playwright code with the browser server's host privileges. Use a dedicated browser process and trusted local clients. Every client connected to this shared-context endpoint can see the same browser state.
4. Connect the external client to the **OrgSDK workspace** URL ending in `/mcp/` using a project-scoped bearer token. Grant `catalog:read`, `code:execute`, and `runs:read` for discovery and iteration. Add `actions:write`, `actions:test`, and `actions:run` to author, test, and replay. Use `list_projects` and `get_project_sdk` to discover the project ID and the reviewed tool alias. For the name above it is `playwright.browserRunCodeUnsafe`.

A project using the external Browser CDP plugin can use its named operations instead, such as `browserCdp.listPages({})` and `browserCdp.readText({ pageId, selector })`. Install it in the project, then open **Configure** and fill in **Browser endpoint** and, if needed, authentication. The plugin returns stable page IDs for an existing Chromium instance. Playwright MCP can launch and manage its browser after its server is running. Browser CDP is for attaching to a browser that you or a provider already run.

### Configure an installed plugin from MCP

A workspace owner or admin can create a client token with the optional `plugins:configure` scope and a grant for the project. Call `list_project_plugins({ project })` to find the installed plugin's ID, revision, configuration schema, and credential status. For an unauthenticated Browser CDP endpoint, call `configure_plugin` with the returned `id` and `revision` and a configuration such as `{ "cdpEndpoint": "http://localhost:9222" }`. The runner must be able to reach that address.

`configuration` replaces the full settings object when supplied. For a token-based plugin, pass `credential: { name, secret }` to store and attach a new credential in the same operation. Browser CDP accepts `secret_apiKey` in that object. Use a trusted client for supplying secrets. Tool results report whether a credential is connected and keep stored secret values private.

If a credential is connected and the configuration changes, supply a replacement credential or pass `credential: null` to disconnect it. Studio can change settings while retaining a previously stored credential, and handles OAuth and remote MCP tool review. Replacing a credential creates a new entry, so other plugins and existing run snapshots keep their original credential. If the revision is stale, list the settings again before deciding whether to retry.

## Iterate using MCP

Call `open_session` with the project and a fresh `idempotency_key`. This and each subsequent command return a run ID. Poll `get_run({id})` until the run reaches a terminal state. A successful open returns the session ID, generation, sequence and cursor in `output.result`.

Send the following source in `execute_cell`, supplying the project, `session_id`, `generation`, `expected_sequence`, a client-generated UUID for `cell_id`, and an idempotency key. Use a page you control as `inputs.url`.

```ts
const target = String(actionParams.url);
const inspect = (code: string) => playwright.browserRunCodeUnsafe({ code });
const first = await inspect(
  `async page => {
    await page.goto(${JSON.stringify(target)});
    return await page.title();
  }`
);
return first;
```

Inspect `output.result.cell.status`, `result`, `error` and `diagnostics`. A run can deliver feedback successfully even when the cell itself failed compilation. For the next cell, use the returned cell sequence and a new cell UUID. This example reuses both the existing TypeScript helper and the page opened above.

```ts
return await inspect('async page => await page.getByRole("heading").first().innerText()');
```

Cells provide project file functions and named tools from approved MCP connections and external plugins. Call a reviewed Playwright tool to work with the page. Browser objects stay in the Playwright process.

For retries, reuse the original cell ID, source, inputs and run idempotency key. To reconnect, use `read_session` with the project, session ID and an idempotency key. Supply `after` to page through events and continue from `nextCursor` while `hasMore` is true. Session commands run one at a time per project. To interrupt an active cell, grant `runs:cancel`, call `cancel_run({id})` with the cell’s run ID, and poll `get_run` until it reaches a terminal state. Queued reads and closes can then proceed. Explicitly close with `close_session` to free the project for another discovery session. Idle sessions expire after 15 minutes. Closing or restarting the runner discards live JavaScript variables. The project files, recorded runs and saved actions persist. The browser's lifetime is controlled by the separate Playwright process. A guard stops the session worker if its supervisor exits during a cell. When running in Docker, build the job image from the same revision as the executor so it includes that guard.

## Turn the route into a reusable action

Collect the steps you need in self-contained source. Replace the discovery URL and other task-specific literals with inputs. For example, this action opens its own destination and returns the Playwright tool response for the first heading.

```ts
const { url } = defineParams(z.object({ url: z.string().url() }));
const code = `async page => {
  await page.goto(${JSON.stringify(url)});
  return await page.getByRole("heading").first().innerText();
}`;
return await playwright.browserRunCodeUnsafe({ code });
```

Call `validate_code` with the project, source, input schema and an idempotency key. Wait for the check to succeed before saving the action. Call `save_action` with the project, name, source and input schema. Use its returned action ID and version with `save_tests`, then `run_tests` with the returned suite revision and an idempotency key. Mocks identify the reviewed tool by its full namespace and exact arguments. Finally, call `run_action` with the project, action ID, version, fresh inputs and a new idempotency key. Verify the live result through `get_run`. A saved version can be run after the discovery session is closed.

## Reproduce the local check

Install the platform checkout's dependencies with `npm run setup`. Set the paths to the installed `@playwright/mcp@0.0.86` entrypoint and a Chromium binary, then run the smoke check from the checkout. It creates an isolated workspace and browser profile, serves a local form, and verifies discovery across two session cells, validation, mocked action tests and live action replay after closing the session.

```sh
ORGSDK_PLAYWRIGHT_MCP_ENTRY=/path/to/node_modules/@playwright/mcp/cli.js \
ORGSDK_BROWSER_EXECUTABLE=/path/to/chrome npm run test:browser-agent
```

The command starts the source server and executor with Bun by default. To exercise
the same flow through Linux Node.js host mode, set `ORGSDK_BROWSER_AGENT_CLI` to
the absolute path of the built `bin/orgsdk.mjs` after `npm run build:npm`, or to
that file inside a locally installed candidate package. The platform and executor
then run with a Node-only PATH. The smoke driver still uses Bun.
