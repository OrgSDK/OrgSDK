import { verifySessionStartupFailure } from "./smoke-session-startup.mjs";
import { verifyManagerShutdown } from "./smoke-manager-shutdown.mjs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDirectory = resolve(process.argv[2] ?? ".");
const moduleAt = (path) =>
  import(pathToFileURL(join(packageDirectory, "dist", path)).href);
assert.ok(
  spawnSync("bun", ["--version"]).error,
  "Run this smoke with Bun absent from PATH",
);
const directory = await mkdtemp(join(tmpdir(), "orgsdk-node-artifact-"));
const agentDirectory = join(directory, "agents", "project");
await mkdir(join(agentDirectory, "workspace"), { recursive: true });
const jobs = new Map();
const completions = new Map();
const requests = [];
const token = "fixture-registration-token-".repeat(2);
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "null");
    const path = request.url;
    requests.push({ path, authorization: request.headers.authorization, body });
    response.setHeader("content-type", "application/json");
    if (path === "/internal/execution/v1/register/") {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      assert.equal(body.protocol_version, 3);
      response.end(JSON.stringify({ id: "executor", agent_id: "project" }));
      return;
    }
    const match = /\/runs\/([^/]+)\/(complete|events|heartbeat)\//.exec(path);
    assert.ok(match, `Unexpected request ${path}`);
    const job = jobs.get(match[1]);
    assert.equal(request.headers.authorization, `Bearer ${job.capability}`);
    if (match[2] === "complete") completions.set(job.run_id, body);
    response.end(
      JSON.stringify(
        match[2] === "heartbeat"
          ? { status: "running", cancel_requested: false }
          : {},
      ),
    );
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function childProcess(entry, args, input, environment = {}) {
  const child = spawn(
    process.execPath,
    [join(packageDirectory, entry), ...args],
    {
      cwd: join(agentDirectory, "workspace"),
      env: {
        PATH: process.env.PATH,
        DJANGO_URL: base,
        EXECUTOR_AGENT_DIR: agentDirectory,
        ...environment,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(input);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(code, 0, Buffer.concat(stderr).toString());
    return Buffer.concat(stdout).toString();
  } finally {
    clearTimeout(timer);
  }
}

function jobFor(source, operation = "code", plugins = []) {
  const job = {
    protocol_version: operation === "code" ? 2 : 3,
    operation,
    run_id: crypto.randomUUID(),
    workspace_id: 1,
    actor_id: 1,
    capability: `run-${crypto.randomUUID()}`,
    inputs: {},
    deadline: new Date(Date.now() + 20_000).toISOString(),
    lease_seconds: 60,
    snapshot: {
      root_agent_id: "project",
      source,
      agents: [{ id: "project", name: "Project", plugins }],
    },
  };
  jobs.set(job.run_id, job);
  return job;
}

async function execute(source, plugins = []) {
  const job = jobFor(source, "code", plugins);
  await childProcess("dist/worker.js", [], JSON.stringify(job));
  assert.equal(completions.get(job.run_id)?.status, "succeeded");
  return completions.get(job.run_id).output.result;
}

try {
  assert.match(
    await childProcess("bin/orgsdk-executor.mjs", ["--help"], ""),
    /register/,
  );
  await childProcess(
    "bin/orgsdk-executor.mjs",
    ["register", "--url", base, "--data", directory],
    token,
  );
  assert.equal(
    (await stat(join(directory, "registration.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    JSON.parse(await readFile(join(directory, "registration.json"), "utf8"))
      .token,
    token,
  );
  assert.equal(
    await execute('await writeFile("persisted.txt", "42"); return 42;'),
    42,
  );
  assert.equal(await execute('return await readFile("persisted.txt");'), "42");

  const inlineSource =
    'enum Answer { Value = 42 }; export const safeFunctions = [{name:"answer", handler: () => Answer.Value}];';
  const inline = {
    distribution: "inline",
    slug: "inline",
    version: "1",
    source: inlineSource,
    digest: createHash("sha256").update(inlineSource).digest("hex"),
    credential_id: null,
  };
  assert.equal(await execute("return await inline.answer();", [inline]), 42);

  const checkout = join(directory, "plugin-checkout");
  const release = join(directory, "release # literal % path");
  await mkdir(checkout);
  await writeFile(
    join(checkout, ".plugin.json"),
    JSON.stringify({ name: "smoke", version: "1.0.0", entry: "index.ts" }),
  );
  await writeFile(
    join(checkout, "index.ts"),
    'export default () => ({safeFunctions:[{name:"echo", handler: (args: {value: number}) => args.value}]});',
  );
  await childProcess(
    "bin/orgsdk-executor.mjs",
    ["package-plugin", "--directory", checkout, "--output", release],
    "",
  );
  await childProcess(
    "bin/orgsdk-executor.mjs",
    [
      "install",
      "--agent",
      "project",
      "--data",
      directory,
      "--manifest",
      join(release, "smoke.manifest.json"),
      "--file",
      join(release, "smoke.mjs"),
    ],
    "",
  );
  const plugin = JSON.parse(
    await readFile(join(release, "smoke.manifest.json"), "utf8"),
  );
  assert.equal(
    await execute("return await smoke.echo({value: 42});", [plugin]),
    42,
  );

  const { runIsolatedJob } = await moduleAt("isolated-actions.js");
  for (const operation of ["validate", "test"]) {
    const job = jobFor("return 42;", operation);
    job.snapshot.sdk = { plugins: [] };
    if (operation === "test")
      job.snapshot.test_suite = {
        cases: [{ name: "answer", inputs: {}, expected: 42, mocks: [] }],
      };
    await runIsolatedJob(job, base, [], undefined, "host");
    assert.equal(
      completions.get(job.run_id)?.status,
      "succeeded",
      JSON.stringify(completions.get(job.run_id)),
    );
  }

  const { SessionManager } = await moduleAt("sessions/index.js");
  const scope = {
    workspaceId: "workspace",
    projectId: "session-project",
    ownerId: "client",
  };
  const manager = new SessionManager({
    historyDirectory: join(directory, "history"),
    mode: "host",
    cellTimeoutMs: 2000,
  });
  try {
    const session = await manager.open({
      ...scope,
      workspaceDirectory: join(directory, "session-workspace"),
      configurationRevision: "1",
    });
    const first = {
      id: crypto.randomUUID(),
      generation: 1,
      expectedSequence: 0,
      source: "let answer = 40; console.log('first'); return answer;",
    };
    assert.equal(
      (await manager.execute(session.id, scope, first)).cell.result,
      40,
    );
    const second = {
      ...first,
      id: crypto.randomUUID(),
      expectedSequence: 1,
      source: "answer += 2; return answer;",
    };
    assert.equal(
      (await manager.execute(session.id, scope, second)).cell.result,
      42,
    );
    assert.equal(
      (await manager.execute(session.id, scope, second)).cell.result,
      42,
    );
    const failed = await manager.execute(session.id, scope, {
      ...first,
      id: crypto.randomUUID(),
      expectedSequence: 2,
      source: "while (true) {}",
      timeoutMs: 100,
    });
    assert.equal(failed.cell.status, "interrupted");
    const history = await manager.inspect(session.id, scope);
    assert.equal(history.cells.length, 3);
    assert.equal(history.cells[1].result, 42);
  } finally {
    await manager.dispose();
  }
  await verifySessionStartupFailure(packageDirectory);
  await verifyManagerShutdown(packageDirectory);
  assert.ok(requests.some((request) => request.path.endsWith("/events/")));
  console.log(
    "Node artifact smoke passed: CLI registration, persistent workers, inline TypeScript, external packaged plugins, host validation/test, durable session cells, deduplication and cancellation.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
