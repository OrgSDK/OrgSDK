import { expect, test } from "bun:test";
import { Client } from "./client";
import { Runner } from "./runner";
import { jobSchema, type Job } from "./contract";

function legacyJob(operation: "chat" | "action", source = "return 42;"): Job {
  return jobSchema.parse({
    protocol_version: 1,
    run_id: "123e4567-e89b-12d3-a456-426614174000",
    workspace_id: 1,
    actor_id: 1,
    operation,
    capability: "fixture",
    inputs: {},
    deadline: new Date(Date.now() + 60_000).toISOString(),
    lease_seconds: 30,
    snapshot: {
      root_agent_id: "legacy",
      source,
      agents: [
        {
          id: "legacy",
          name: "Legacy project",
          instructions: "Old prompt",
          model: "Old model",
          credential_id: "Old secret",
          documents: [],
          plugins: [],
        },
      ],
    },
  });
}

test("legacy chat is rejected without contacting a model or server", async () => {
  const job = legacyJob("chat");
  const controller = new AbortController();
  const runner = new Runner(
    job,
    new Client("http://127.0.0.1:1", "fixture"),
    controller.signal,
  );
  await expect(runner.run()).rejects.toThrow("built-in chat has been retired");
});

test("historical delegation fails explicitly and cannot contact another project", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      expect(new URL(request.url).pathname).toEndWith("/events/");
      return new Response(null, { status: 204 });
    },
  });
  try {
    const runner = new Runner(
      legacyJob("action", 'return await delegate("other", "do work");'),
      new Client(server.url.toString(), "fixture"),
      new AbortController().signal,
    );
    await expect(runner.run()).rejects.toThrow(
      "reasoning delegation has been retired",
    );
  } finally {
    await server.stop(true);
  }
});

test("action jobs need no model configuration and preserve legacy identity", async () => {
  const job = legacyJob("action");
  expect(job.snapshot.agents[0]).toEqual({
    id: "legacy",
    name: "Legacy project",
    plugins: [],
  });
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(null, { status: 204 });
    },
  });
  try {
    const runner = new Runner(
      job,
      new Client(server.url.toString(), "fixture"),
      new AbortController().signal,
    );
    expect(await runner.run()).toBe(42);
  } finally {
    await server.stop(true);
  }
});
