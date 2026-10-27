import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { jobSchema, type Job } from "./contract";
import { Client } from "./client";
import { Runner } from "./runner";
import { traceValue } from "./engine/sandbox/trace";

function job(source = "return 42;"): Job {
  return {
    protocol_version: 2,
    operation: "code",
    run_id: crypto.randomUUID(),
    workspace_id: 1,
    actor_id: 1,
    capability: "fixture",
    inputs: {},
    deadline: new Date(Date.now() + 60_000).toISOString(),
    lease_seconds: 60,
    snapshot: {
      root_agent_id: "agent",
      source,
      source_digest: "digest",
      agents: [
        {
          id: "agent",
          name: "Agent",
          instructions: "",
          model: "",
          credential_id: null,
          plugins: [],
          documents: [],
        },
      ],
    },
  };
}

test("legacy action and chat parse; legacy code is rejected", () => {
  expect(jobSchema.safeParse({ ...job(), protocol_version: 1 }).success).toBe(
    false,
  );
  for (const operation of ["action", "chat"])
    expect(
      jobSchema.safeParse({ ...job(), protocol_version: 1, operation }).success,
    ).toBe(true);
  expect(jobSchema.parse(job()).snapshot.source_digest).toBe("digest");
  expect(
    jobSchema.safeParse({
      ...job(),
      protocol_version: 1,
      operation: "action",
      snapshot: { ...job().snapshot, validation_mode: "legacy" },
    }).success,
  ).toBe(true);
});

async function execute(source: string, failTool = false) {
  const events: Array<{ sequence: number; kind: string; data: unknown }> = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const unexpected: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/events/")) {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Bun.sleep(1);
        events.push(await request.json());
        concurrent--;
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/artifacts/"))
        return failTool
          ? new Response("tool unavailable", { status: 400 })
          : Response.json({ id: "doc" });
      unexpected.push(path);
      return new Response("unexpected request", { status: 400 });
    },
  });
  let output: unknown;
  let error: unknown;
  try {
    output = await new Runner(
      job(source),
      new Client(server.url.toString(), "fixture"),
      new AbortController().signal,
    ).run();
  } catch (caught) {
    error = caught;
  } finally {
    await server.stop(true);
  }
  return { events, output, error, unexpected, maxConcurrent };
}

test("code returns 42 with no provider or credential requests", async () => {
  const result = await execute("return 42;");
  expect(result.output).toBe(42);
  expect(result.error).toBeUndefined();
  expect(result.unexpected).toEqual([]);
});

test("console before failure is persisted and tool errors retain their message", async () => {
  const result = await execute(
    "console.log('before failure'); await saveArtifact('x', 'y');",
    true,
  );
  expect(result.error).toBeDefined();
  expect(result.events[0].kind).toBe("execution.log");
  expect(result.events[0].data).toEqual({
    agent_id: "agent",
    message: "before failure",
  });
  const step = result.events.find((event) => event.kind === "execution.step");
  expect(JSON.stringify(step)).toContain("tool unavailable");
});

test("concurrent tools and console retain serial event requests", async () => {
  const result = await execute(
    "console.log('first'); await Promise.all([saveArtifact('a','b'),saveArtifact('c','d')]); console.log('last'); return 42;",
  );
  expect(result.error).toBeUndefined();
  expect(result.maxConcurrent).toBe(1);
  expect(result.events.map((event) => event.sequence)).toEqual(
    result.events.map((_, index) => index + 1),
  );
  expect(
    result.events.filter((event) => event.kind === "execution.step"),
  ).toHaveLength(2);
});

test("excessive logs are bounded before retention and posting", async () => {
  const result = await execute(
    "for(let i=0;i<1000;i++) console.log('x'.repeat(20000)); return 42;",
  );
  expect(result.output).toBe(42);
  const firstLog = result.events.find((event) => event.kind === "execution.log")
    ?.data as { message: string };
  expect(firstLog.message).toHaveLength(4096);
  expect(firstLog.message).toEndWith("[truncated]");
  expect(result.events.length).toBeLessThanOrEqual(200);
  expect(
    result.events.filter((event) => event.kind === "execution.truncated"),
  ).toHaveLength(1);
  expect(
    result.events.every(
      (event) =>
        event.data !== null &&
        typeof event.data === "object" &&
        (event.data as Record<string, unknown>).agent_id === "agent",
    ),
  ).toBe(true);
  expect(
    new TextEncoder().encode(JSON.stringify(result.events)).length,
  ).toBeLessThan(300_000);
});

test("trace serialization handles cycles, errors and bigints", () => {
  const cycle: Record<string, unknown> = {
    error: new Error("failure"),
    integer: 42n,
  };
  cycle.self = cycle;
  expect(traceValue(cycle)).toEqual({
    error: { name: "Error", message: "failure" },
    integer: "42",
    self: "[circular]",
  });
});

test("cancellation does not hang while flushing an unavailable event endpoint", async () => {
  class StalledClient extends Client {
    override async request(): Promise<unknown> {
      return new Promise(() => undefined);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  try {
    await new Runner(
      job("console.log('pending'); throw new Error('stop');"),
      new StalledClient("http://localhost", "fixture"),
      controller.signal,
    ).run();
    throw new Error("Execution should fail");
  } catch (error) {
    expect(String(error)).toContain("stop");
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    clearTimeout(timer);
  }
});

test("trace count limit emits one explicit marker", async () => {
  const result = await execute(
    "for(let i=0;i<1000;i++) console.log(i); return 42;",
  );
  expect(result.output).toBe(42);
  expect(result.events.length).toBeLessThanOrEqual(200);
  expect(
    result.events.filter((event) => event.kind === "execution.truncated"),
  ).toHaveLength(1);
});

test("oversized trace values keep an object envelope and explicit truncation", async () => {
  const result = await execute(
    "for(let i=0;i<8;i++) console.log('x'.repeat(4000)); return 42;",
  );
  const summary = result.events.find((event) => event.kind === "action.result");
  expect(summary?.data).toEqual({
    agent_id: "agent",
    truncated: true,
    payload: "[trace value exceeds limit]",
  });
});

test("CLI registration advertises code execution and persists returned identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-code-registration-"));
  let registration: unknown;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      registration = await request.json();
      return Response.json({
        id: "executor-fixture",
        agent_id: "agent-fixture",
      });
    },
  });
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        new URL("./cli.ts", import.meta.url).pathname,
        "register",
        "--url",
        server.url.toString(),
        "--data",
        directory,
      ],
      {
        env: { EXECUTOR_TOKEN: "fixture-token-for-registration-test-only" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await child.exited).toBe(0);
    expect(registration).toEqual({
      protocol_version: 3,
      capabilities: ["action", "code", "validate", "test"],
    });
    const saved = JSON.parse(
      await readFile(join(directory, "registration.json"), "utf8"),
    );
    expect(saved.agent_id).toBe("agent-fixture");
    expect(saved.executor_id).toBe("executor-fixture");
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Runner persists files across runs and routes project data without providers", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-project-runner-"));
  const calls: Array<{ path: string; body: unknown }> = [];
  class ProjectClient extends Client {
    override async request(path: string, _method = "GET", body?: unknown) {
      calls.push({ path, body });
      if (path.endsWith("/project-data/"))
        return { items: [{ id: "table" }], next_offset: null };
      if (path.endsWith("/events/")) return undefined;
      throw new Error(`Unexpected request ${path}`);
    }
  }
  const client = new ProjectClient("http://fixture", "token");
  const run = (source: string) =>
    new Runner(job(source), client, new AbortController().signal, root).run();
  try {
    await run(
      "await writeFile('notes.txt', 'persistent'); return await listTables();",
    );
    expect(await run("return await readFile('notes.txt');")).toBe("persistent");
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("persistent");
    expect(calls.some((call) => call.path.endsWith("/project-data/"))).toBe(
      true,
    );
    expect(
      calls.every(
        (call) =>
          call.path.endsWith("/events/") ||
          call.path.endsWith("/project-data/"),
      ),
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("await writeFile");
    expect(await run("return typeof saveMemory;")).toBe("undefined");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project data permission errors retain execution traces", async () => {
  const result = await execute(
    "console.log('before data'); await listTables();",
  );
  expect(result.error).toBeDefined();
  expect(result.events.some((event) => event.kind === "execution.log")).toBe(
    true,
  );
  expect(JSON.stringify(result.events)).toContain("unexpected request");
});

test("unused file capabilities do not initialize an unsupported workspace", async () => {
  const client = new Client("http://fixture", "token");
  const runner = new Runner(job(), client, new AbortController().signal, "/");
  expect(await runner.run()).toBe(42);
  const invalidFiles = new Runner(
    job("return await readFile('notes.txt');"),
    client,
    new AbortController().signal,
    "/",
  );
  await expect(invalidFiles.run()).rejects.toThrow(
    /workspace root|require Linux/,
  );
});

test("one-off code queries an agent-owned plugin through its VM namespace", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-code-plugin-"));
  const pluginSource = `export const safeFunctions = [{
    name: 'query', calling: 'positional',
    handler: (query) => ({ rows: [{ name: query, total: 42 }] })
  }];`;
  const source = "return await queryFixture.query('active projects');";
  const claim = job(source);
  claim.snapshot.agents[0].plugins = [
    {
      distribution: "inline",
      slug: "query-fixture",
      version: "1",
      source: pluginSource,
      digest: new Bun.CryptoHasher("sha256").update(pluginSource).digest("hex"),
      credential_id: null,
    },
  ];
  const runnerPath = Bun.resolveSync("./runner.ts", import.meta.dir);
  const clientPath = Bun.resolveSync("./client.ts", import.meta.dir);
  const script = `
    import { Runner } from ${JSON.stringify(runnerPath)};
    import { Client } from ${JSON.stringify(clientPath)};
    const requests = [];
    class EventsOnlyClient extends Client {
      async request(path, method, body) {
        requests.push({path, method, body});
        if (!path.endsWith('/events/')) throw new Error('Unexpected capability request: ' + path);
      }
    }
    globalThis.fetch = () => { throw new Error('Unexpected provider or network request'); };
    const output = await new Runner(${JSON.stringify(claim)}, new EventsOnlyClient('http://fixture', 'token'), new AbortController().signal).run();
    console.log(JSON.stringify({output, requests}));
  `;
  try {
    // A child process isolates plugin storage configuration from concurrent tests.
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env: { ...process.env, EXECUTOR_DATA_DIR: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.output).toEqual({
      rows: [{ name: "active projects", total: 42 }],
    });
    expect(result.requests.length).toBeGreaterThan(0);
    expect(
      result.requests.every((request: { path: string }) =>
        request.path.endsWith("/events/"),
      ),
    ).toBe(true);
    expect(JSON.stringify(result.requests)).not.toContain(source);
    expect(JSON.stringify(result.requests)).toContain("query");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
