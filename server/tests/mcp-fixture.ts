import { join, resolve } from "node:path";
import { z } from "zod";
import { fixture } from "./integration-fixture";
import { Client } from "../../runtime/src/client";
import { jobSchema, type Job } from "../../runtime/src/contract";
import { mcpFixture } from "../../runtime/src/mcp/testing/server";

const createdConnectionSchema = z.object({ id: z.uuid() });
const discoveryRunSchema = z.object({ run: z.uuid() });
const succeededRunSchema = z.object({
  status: z.literal("succeeded"),
  output: z.object({ result: z.unknown() }),
});

export async function connectedMcpFixture() {
  const application = await fixture();
  const remote = mcpFixture({ token: "synthetic-mcp-secret" });
  const registration = await application.register();
  const worker = new Client(application.origin, registration);
  await worker.register({
    protocol_version: 4,
    capabilities: ["code", "action", "test", "validate", "mcp_discover"],
  });
  const connection = createdConnectionSchema.parse(
    await application.data(
      "plugins.mcp.create",
      {
        project: application.project.id,
        slug: "customer-tools",
        endpoint: remote.endpoint,
        auth_mode: "headers",
        headers: { Authorization: "Bearer synthetic-mcp-secret" },
      },
      "mutation",
    ),
  );
  async function execute(job: Job) {
    const workerProcess = Bun.spawn(
      [process.execPath, resolve("runtime/src/worker.ts")],
      {
        cwd: resolve("runtime"),
        env: {
          PATH: process.env.PATH ?? "",
          ORGSDK_SERVER_URL: application.origin,
          EXECUTOR_AGENT_DIR: join(application.dir, "project"),
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await workerProcess.stdin.write(JSON.stringify(job));
    await workerProcess.stdin.end();
    const timer = setTimeout(() => workerProcess.kill(), 15000);
    try {
      const exit = await workerProcess.exited;
      const diagnostic = await new Response(workerProcess.stderr).text();
      if (exit !== 0) {
        throw new Error(`MCP worker failed: ${diagnostic}`);
      }
      const completed = succeededRunSchema.parse(
        await application.data("runs.get", { id: job.run_id }),
      );
      return completed.output.result;
    } finally {
      clearTimeout(timer);
    }
  }
  async function discover() {
    const result = discoveryRunSchema.parse(
      await application.data("plugins.mcp.discover", connection, "mutation"),
    );
    const job = jobSchema.parse(await worker.claim());
    await execute(job);
    return { run: result.run, job };
  }
  async function accept(run: string, tools = ["search_records"]) {
    return application.data(
      "plugins.mcp.accept",
      { id: connection.id, run, tools },
      "mutation",
    );
  }
  return {
    ...application,
    remote,
    connection,
    worker,
    execute,
    discover,
    accept,
    async close() {
      await remote.close();
      await application.close();
    },
  };
}
