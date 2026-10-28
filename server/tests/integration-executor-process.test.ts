import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { jobSchema } from "../../runtime/src/contract";
import { fixture } from "./integration-fixture";
test("a separate existing executor process runs code against the Bun API", async () => {
  const f = await fixture();
  try {
    const token = await f.register();
    const run = await f.json("/api/v1/runs/", "POST", {
      project: f.project.id,
      operation: "code",
      source: "console.log('executed'); return 6 * 7;",
      inputs: {},
      idempotency_key: "real-worker",
    });
    const job = jobSchema.parse(
      await f.json("/internal/execution/v1/claim/", "POST", undefined, token),
    );
    expect(job.run_id).toBe(run.id);
    const process = Bun.spawn(
      [Bun.which("bun")!, resolve("runtime/src/worker.ts")],
      {
        cwd: resolve("runtime"),
        env: {
          PATH: globalThis.process.env.PATH!,
          DJANGO_URL: f.origin,
          EXECUTOR_AGENT_DIR: join(f.dir, "project"),
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await process.stdin.write(JSON.stringify(job));
    await process.stdin.end();
    const timeout = setTimeout(() => process.kill(), 15000);
    const exit = await process.exited;
    clearTimeout(timeout);
    const errors = await new Response(process.stderr).text();
    expect(exit, errors).toBe(0);
    const result = await f.json(`/api/v1/runs/${run.id}/`);
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ result: 42 });
    const events = await f.json(`/api/v1/runs/${run.id}/events/`);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sequence).toBe(1);
  } finally {
    await f.close();
  }
}, 30000);
