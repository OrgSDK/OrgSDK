import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "./contract";

type Event = { sequence: number; kind: string; data: unknown };
type Completion = {
  status: string;
  output?: { result: unknown };
  error?: string;
};

async function workerFixture() {
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-worker-"));
  const workspace = join(directory, "workspace");
  await mkdir(workspace);
  const jobs = new Map<string, Job>();
  const events = new Map<string, Event[]>();
  const completions = new Map<string, Completion>();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const match =
        /^\/internal\/execution\/v1\/runs\/([^/]+)\/(events|complete|heartbeat)\/$/.exec(
          path,
        );
      if (!match) return new Response("Unknown endpoint", { status: 404 });
      const job = jobs.get(match[1]);
      if (
        !job ||
        request.headers.get("Authorization") !== `Bearer ${job.capability}`
      )
        return new Response("Unknown run capability", { status: 403 });
      if (match[2] === "heartbeat")
        return Response.json({ status: "running", cancel_requested: false });
      if (match[2] === "events")
        events.get(job.run_id)!.push((await request.json()) as Event);
      else completions.set(job.run_id, (await request.json()) as Completion);
      return new Response(null, { status: 204 });
    },
  });

  return {
    async run(source: string, inputs: Record<string, unknown> = {}) {
      const job: Job = {
        protocol_version: 2,
        operation: "code",
        run_id: crypto.randomUUID(),
        workspace_id: 1,
        actor_id: 1,
        capability: crypto.randomUUID(),
        inputs,
        deadline: new Date(Date.now() + 10_000).toISOString(),
        lease_seconds: 60,
        snapshot: {
          root_agent_id: "project",
          source,
          agents: [{ id: "project", name: "Project", plugins: [] }],
        },
      };
      jobs.set(job.run_id, job);
      events.set(job.run_id, []);
      const child = Bun.spawn(
        [process.execPath, "--no-env-file", join(import.meta.dir, "worker.ts")],
        {
          cwd: workspace,
          env: {
            PATH: process.env.PATH ?? "",
            DJANGO_URL: server.url.toString(),
            EXECUTOR_AGENT_DIR: directory,
          },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const watchdog = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        child.stdin.write(JSON.stringify(job));
        child.stdin.end();
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stdout).toBe("");
        expect(stderr).toBe("");
        const completion = completions.get(job.run_id);
        expect(completion).toBeDefined();
        return {
          exitCode,
          completion: completion!,
          events: events.get(job.run_id)!,
        };
      } finally {
        clearTimeout(watchdog);
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await child.exited;
        }
      }
    },
    async close() {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("one-shot workers share project files while variables, globals and inputs stay run-scoped", async () => {
  const fixture = await workerFixture();
  try {
    const first = await fixture.run(
      `
      const response = { rows: [actionParams.value] };
      function select() { return response.rows[0]; }
      globalThis.cachedResponse = response;
      await writeFile("response.json", JSON.stringify(response));
      console.log("discovered response");
      return select();
    `,
      { value: 42 },
    );
    expect(first.exitCode).toBe(0);
    expect(first.completion).toEqual({
      status: "succeeded",
      output: { result: 42 },
    });

    const second = await fixture.run(
      `
      return {
        saved: JSON.parse(await readFile("response.json")),
        variable: typeof response,
        helper: typeof select,
        global: typeof globalThis.cachedResponse,
        input: actionParams.value
      };
    `,
      { value: 7 },
    );
    expect(second.exitCode).toBe(0);
    expect(second.completion).toEqual({
      status: "succeeded",
      output: {
        result: {
          saved: { rows: [42] },
          variable: "undefined",
          helper: "undefined",
          global: "undefined",
          input: 7,
        },
      },
    });
    expect(first.events.some((event) => event.kind === "execution.log")).toBe(
      true,
    );
    expect(second.events.some((event) => event.kind === "execution.log")).toBe(
      false,
    );
    expect(second.events.map((event) => event.sequence)).toEqual(
      second.events.map((_, index) => index + 1),
    );
  } finally {
    await fixture.close();
  }
}, 10_000);

test("failed worker retains logs and file effects without replaying source in the next run", async () => {
  const fixture = await workerFixture();
  try {
    const failed = await fixture.run(`
      const files = await listFiles();
      const count = files.entries.length ? Number(await readFile("count.txt")) : 0;
      await writeFile("count.txt", String(count + 1));
      console.log("write completed");
      throw new Error("inspect response failed");
    `);
    expect(failed.exitCode).toBe(1);
    expect(failed.completion.status).toBe("failed");
    expect(failed.completion.error).toContain("inspect response failed");
    expect(failed.events).toContainEqual({
      sequence: expect.any(Number),
      kind: "execution.log",
      data: { agent_id: "project", message: "write completed" },
    });

    const next = await fixture.run(
      'return Number(await readFile("count.txt"));',
    );
    expect(next.exitCode).toBe(0);
    expect(next.completion).toEqual({
      status: "succeeded",
      output: { result: 1 },
    });
  } finally {
    await fixture.close();
  }
}, 10_000);
