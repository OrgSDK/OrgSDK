import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { startChild, stopChildren, waitForHealth } from "./dev-process";
import { api, availablePort, runSchema } from "./distribution-fixture";
import {
  issuedMcpAccessTokenSchema,
  type McpAccessToken,
} from "../server/tokens/access-token";

const idSchema = z.object({ id: z.uuid() });
const mcpEnvelope = z.object({
  error: z.unknown().optional(),
  result: z.unknown().optional(),
});
const mcpToolResult = z.object({
  isError: z.boolean(),
  content: z.tuple([z.object({ text: z.string() })]),
});
const runResult = z.object({ result: z.unknown() });
const remoteTool = "browser_run_code_unsafe";
const actionTool = "playwrightProof.browserRunCodeUnsafe";

function createMcpClient(origin: string, token: McpAccessToken) {
  let id = 0;
  async function request(method: string, params: unknown = {}) {
    const response = await fetch(`${origin}/mcp/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload: unknown = await response.json();
    assert(response.ok, JSON.stringify(payload));
    const envelope = mcpEnvelope.parse(payload);
    assert.equal(envelope.error, undefined, JSON.stringify(envelope.error));
    return envelope.result;
  }

  return {
    request,
    async call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = mcpToolResult.parse(
        await request("tools/call", { name, arguments: args }),
      );
      const { text } = result.content[0];
      assert.equal(result.isError, false, `${name}: ${text}`);
      return JSON.parse(text) as unknown;
    },
  };
}

type McpClient = ReturnType<typeof createMcpClient>;

async function waitForCompletedRun(
  id: string,
  getRun: (id: string) => Promise<unknown>,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = runSchema.parse(await getRun(id));
    if (
      ["succeeded", "failed", "cancelled", "timed_out", "interrupted"].includes(
        run.status,
      )
    ) {
      assert.equal(run.status, "succeeded", JSON.stringify(run));
      return run.output;
    }
    await sleep(250);
  }
  throw new Error(`Run ${id} did not finish.`);
}

async function completedRun(
  client: McpClient,
  tool: string,
  input: Record<string, unknown>,
) {
  const { id } = idSchema.parse(
    await client.call(tool, { ...input, idempotency_key: randomUUID() }),
  );
  return waitForCompletedRun(id, (id) => client.call("get_run", { id }));
}

async function connectPlaywright(
  rpc: ReturnType<typeof api>,
  project: string,
  endpoint: string,
) {
  const connection = idSchema.parse(
    await rpc(
      "plugins.mcp.create",
      { project, slug: "playwright-proof", endpoint, auth_mode: "none" },
      true,
    ),
  );
  const discovery = z
    .object({ run: z.uuid() })
    .parse(await rpc("plugins.mcp.discover", connection, true));
  await waitForCompletedRun(discovery.run, (id) => rpc("runs.get", { id }));
  await rpc(
    "plugins.mcp.accept",
    { ...connection, run: discovery.run, tools: [remoteTool] },
    true,
  );
}

function browserSnippet(url: string, label: string) {
  return `async (page) => {
    await page.goto(${JSON.stringify(url)});
    await page.getByLabel("Name").fill(${JSON.stringify(label)});
    await page.getByRole("button", { name: "Store" }).click();
    return await page.locator("output").innerText();
  }`;
}

const parseResultSource = `
function readPlaywrightResult(response: unknown) {
  const result = z.object({ content: z.array(z.object({ text: z.string() })) }).parse(response);
  const text = result.content[0]?.text ?? "";
  const section = /^### Result\\n([^\\n]+)/m.exec(text)?.[1];
  if (!section) throw new Error("Missing Playwright result");
  return JSON.parse(section);
}
`;

async function proveAction(
  client: McpClient,
  project: string,
  fixtureUrl: string,
  fixtureVisits: readonly string[],
) {
  const inputSchema = z.toJSONSchema(
    z.object({
      url: z.string().regex(/^https?:\/\//),
      label: z.string().min(1),
    }),
  );
  const source = `${parseResultSource}
const { url, label } = defineParams(z.object({ url: z.url(), label: z.string().min(1) }));
const snippet: (url: string, label: string) => string = ${browserSnippet.toString()};
const code = snippet(url, label);
return readPlaywrightResult(await ${actionTool}({ code }));`;
  const visits = fixtureVisits.length;
  const validation = await completedRun(client, "validate_code", {
    project,
    source,
    input_schema: inputSchema,
  });
  assert.equal(
    z.object({ valid: z.boolean() }).parse(runResult.parse(validation).result)
      .valid,
    true,
  );
  assert.equal(
    fixtureVisits.length,
    visits,
    "Validation must not navigate the browser.",
  );
  const actionVersion = z
    .object({
      action: z.uuid(),
      version: z.object({ number: z.number().int() }),
    })
    .parse(
      await client.call("save_action", {
        project,
        name: "Replay browser proof",
        source,
        input_schema: inputSchema,
      }),
    );
  const action = {
    action: actionVersion.action,
    version: actionVersion.version.number,
  };
  const { revision } = z.object({ revision: z.number().int() }).parse(
    await client.call("save_tests", {
      ...action,
      cases: [
        {
          name: "Action decodes Playwright output",
          inputs: { url: fixtureUrl, label: "mock label" },
          expected: "mocked",
          mocks: [
            {
              tool: actionTool,
              args: [{ code: browserSnippet(fixtureUrl, "mock label") }],
              result: {
                content: [{ type: "text", text: '### Result\n"mocked"\n' }],
              },
            },
          ],
        },
      ],
    }),
  );
  const tests = await completedRun(client, "run_tests", {
    ...action,
    suite_revision: revision,
  });
  assert.equal(
    z.object({ passed: z.boolean() }).parse(runResult.parse(tests).result)
      .passed,
    true,
  );
  assert.equal(
    fixtureVisits.length,
    visits,
    "Mocked tests must not navigate the real browser.",
  );

  for (const label of ["replay one", "replay two"]) {
    const beforeReplay = fixtureVisits.length;
    const url = new URL(fixtureUrl);
    url.searchParams.set("replay", label);
    const replay = await completedRun(client, "run_action", {
      ...action,
      project,
      inputs: { url: url.href, label },
    });
    assert.deepEqual(replay, { result: label });
    assert.deepEqual(
      fixtureVisits.slice(beforeReplay),
      [url.href],
      "Each action run must navigate to its input URL exactly once.",
    );
  }
}

async function proveSession(
  client: McpClient,
  project: string,
  fixtureUrl: string,
) {
  const session = z
    .object({
      id: z.uuid(),
      generation: z.number().int(),
      sequence: z.number().int(),
    })
    .parse(
      runResult.parse(await completedRun(client, "open_session", { project }))
        .result,
    );
  const common = {
    project,
    session_id: session.id,
    generation: session.generation,
  };
  const code = browserSnippet(fixtureUrl, "first draft");
  async function executeCell(expectedSequence: number, source: string) {
    const output = await completedRun(client, "execute_cell", {
      ...common,
      expected_sequence: expectedSequence,
      source,
      cell_id: randomUUID(),
    });
    const reply = z
      .object({
        sessionId: z.uuid(),
        cell: z.object({
          sequence: z.number().int(),
          status: z.string(),
          result: z.unknown(),
        }),
      })
      .parse(runResult.parse(output).result);
    assert.equal(reply.sessionId, session.id);
    assert.equal(reply.cell.status, "succeeded", JSON.stringify(output));
    return reply.cell;
  }
  const first = await executeCell(
    session.sequence,
    `${parseResultSource}
const firstLabel = readPlaywrightResult(await ${actionTool}({ code: ${JSON.stringify(code)} }));
return firstLabel;`,
  );
  assert.equal(first.result, "first draft");
  const update = `async (page) => {
    const previous = await page.locator("output").innerText();
    await page.getByLabel("Name").fill("second draft");
    await page.getByRole("button", { name: "Store" }).click();
    return { previous, current: await page.locator("output").innerText() };
  }`;
  const second = await executeCell(
    first.sequence,
    `
const changed = readPlaywrightResult(await ${actionTool}({ code: ${JSON.stringify(update)} }));
return { priorBinding: firstLabel, livePage: changed };`,
  );
  assert.deepEqual(second.result, {
    priorBinding: "first draft",
    livePage: { previous: "first draft", current: "second draft" },
  });
  await completedRun(client, "close_session", {
    project,
    session_id: session.id,
  });
}

const playwrightEntry = process.env.ORGSDK_PLAYWRIGHT_MCP_ENTRY;
const browserExecutable = process.env.ORGSDK_BROWSER_EXECUTABLE;
assert(
  playwrightEntry,
  "Set ORGSDK_PLAYWRIGHT_MCP_ENTRY to the installed @playwright/mcp 0.0.86 cli.js.",
);
assert(
  browserExecutable,
  "Set ORGSDK_BROWSER_EXECUTABLE to a Chrome or Chromium binary.",
);
const packagedCli = process.env.ORGSDK_BROWSER_AGENT_CLI;
const node = Bun.which("node");
assert(node, "Node.js is required to run the Playwright MCP server.");
const directory = await mkdtemp(join(tmpdir(), "orgsdk-browser-agent-"));
const children: ReturnType<typeof startChild>[] = [];
const fixtureVisits: string[] = [];
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname !== "/") {
      return new Response(null, { status: 404 });
    }
    fixtureVisits.push(request.url);
    return new Response(
      `<!doctype html><title>Browser agent fixture</title><label>Name <input></label>
      <button onclick="document.querySelector('output').textContent = document.querySelector('input').value">Store</button>
      <output></output>`,
      { headers: { "Content-Type": "text/html" } },
    );
  },
});

try {
  const playwrightPort = await availablePort();
  const endpoint = `http://127.0.0.1:${playwrightPort}/mcp`;
  children.push(
    startChild(
      node,
      [
        resolve(playwrightEntry),
        "--host",
        "127.0.0.1",
        "--port",
        String(playwrightPort),
        "--headless",
        "--executable-path",
        resolve(browserExecutable),
        "--user-data-dir",
        join(directory, "browser"),
        "--output-dir",
        join(directory, "browser-output"),
        "--shared-browser-context",
      ],
      process.env,
    ),
  );
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH,
    HOST: "127.0.0.1",
    PORT: String(port),
    ORGSDK_DATA_DIR: join(directory, "server"),
    ORGSDK_SERVER_URL: origin,
    LOCAL_EXECUTOR_BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
    EXECUTOR_DATA_DIR: join(directory, "executor"),
    PLUGIN_CATALOG_URL: "",
    PLUGIN_MARKETPLACE_URL: "",
  };
  if (packagedCli) {
    const nodeOnlyPath = join(directory, "node-only");
    await mkdir(nodeOnlyPath);
    await symlink(node, join(nodeOnlyPath, "node"));
    children.push(
      startChild(
        node,
        [
          resolve(packagedCli),
          "start",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--data",
          env.ORGSDK_DATA_DIR,
        ],
        {
          PATH: nodeOnlyPath,
          HOME: directory,
          PLUGIN_CATALOG_URL: "",
          PLUGIN_MARKETPLACE_URL: "",
        },
      ),
    );
  } else {
    children.push(startChild("bun", ["--no-env-file", "server/index.ts"], env));
  }
  await waitForHealth(origin, AbortSignal.timeout(15_000));
  if (!packagedCli) {
    children.push(
      startChild(
        "bun",
        ["--no-env-file", "runtime/src/cli.ts", "manage", "--mode", "host"],
        env,
      ),
    );
  }

  const rpc = api(origin);
  const health = z
    .object({ runtime: z.string() })
    .parse(await rpc("system.health"));
  assert.equal(health.runtime, packagedCli ? "node" : "bun");
  const password = "Disposable-browser-proof-123!";
  const email = "owner@example.test";
  await rpc("auth.setupStatus");
  await rpc(
    "auth.setup",
    {
      domain: "127.0.0.1",
      workspace_name: "Browser proof",
      username: "proof-owner",
      email,
      password1: password,
      password2: password,
      project_name: "Browser agent fixture",
    },
    true,
  );
  await rpc("auth.login", { email, password }, true);
  const project = z
    .object({ results: z.tuple([idSchema]) })
    .parse(await rpc("projects.list")).results[0].id;
  const { token } = issuedMcpAccessTokenSchema.parse(
    await rpc(
      "tokens.create",
      {
        name: "Browser proof",
        scopes: [
          "catalog:read",
          "code:execute",
          "runs:read",
          "actions:write",
          "actions:run",
          "actions:test",
        ],
        projects: [project],
      },
      true,
    ),
  );
  const client = createMcpClient(origin, token);
  await client.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "browser-agent-smoke", version: "1" },
  });
  assert.deepEqual(
    await completedRun(client, "execute_code", {
      project,
      source: "return 42;",
    }),
    { result: 42 },
  );
  await connectPlaywright(rpc, project, endpoint);
  assert.deepEqual(
    z
      .object({ projects: z.array(idSchema) })
      .parse(await client.call("list_projects", {})).projects,
    [{ id: project }],
  );
  assert.match(
    JSON.stringify(await client.call("get_project_sdk", { project })),
    /browserRunCodeUnsafe/,
  );
  await proveSession(client, project, String(fixture.url));
  await proveAction(client, project, String(fixture.url), fixtureVisits);
  console.log(
    `Browser agent acceptance passed on ${packagedCli ? "Node-only packaged host mode" : "Bun source host mode"}: MCP discovery, two retained cells, validation, a mocked action suite and two parameterized action runs.`,
  );
} finally {
  await stopChildren(children);
  await fixture.stop(true);
  await rm(directory, { recursive: true, force: true });
}
