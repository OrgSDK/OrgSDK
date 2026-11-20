import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { jobSchema } from "./contract";
import { SessionJobs } from "./session-job";

test.each([
  { status: 503, expectedPosts: 2 },
  { status: 401, expectedPosts: 1 },
])("session completion HTTP $status preserves the outcome and allows the next job", async ({ status, expectedPosts }) => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-session-jobs-"));
  const projectId = crypto.randomUUID();
  const completions: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/heartbeat/")) {
        return Response.json({ status: "running", cancel_requested: false });
      }
      if (path.endsWith("/complete/")) {
        completions.push(await request.json());
        // A gateway can fail the reply after the coordinator has applied it.
        return new Response(null, { status: completions.length === 1 ? status : 204 });
      }
      return new Response(null, { status: 404 });
    },
  });
  const jobs = new SessionJobs({
    base: server.url.toString(),
    agentId: projectId,
    directory: join(root, "agents", projectId),
    mode: "host",
  });
  const job = jobSchema.parse({
    protocol_version: 4,
    operation: "session",
    run_id: crypto.randomUUID(),
    workspace_id: 1,
    actor_id: 1,
    capability: "completion-test-only",
    inputs: {},
    deadline: new Date(Date.now() + 30_000).toISOString(),
    lease_seconds: 30,
    snapshot: {
      root_agent_id: projectId,
      agents: [],
      sdk: { plugins: [] },
      configuration_revision: "config-1",
      session: { operation: "open" },
      session_scope: { workspaceId: "1", projectId, ownerId: "owner" },
    },
  });
  try {
    await jobs.run(job, new AbortController().signal);
    const completion = z.object({
      status: z.literal("succeeded"),
      output: z.object({ result: z.object({ id: z.uuid(), status: z.literal("idle") }) }),
    }).parse(completions[0]);
    expect(completions).toHaveLength(expectedPosts);
    if (expectedPosts > 1) {
      expect(completions[1]).toEqual(completions[0]);
    }
    const id = completion.output.result.id;
    await jobs.run({
      ...job,
      run_id: crypto.randomUUID(),
      capability: "next-run-test-only",
      snapshot: { ...job.snapshot, session: { operation: "read", id } },
    }, new AbortController().signal);
    expect(completions).toHaveLength(expectedPosts + 1);
    expect(completions.at(-1)).toMatchObject({
      status: "succeeded",
      output: { result: { id, sequence: 0 } },
    });
    expect(await readdir(join(root, "session-history", projectId))).toEqual([
      `${completion.output.result.id}.json`,
    ]);
  } finally {
    await jobs.dispose();
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
