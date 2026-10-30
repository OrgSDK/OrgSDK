import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as tables from "../db/schema";
import { fixture } from "./integration-fixture";
import { projectSchema, runSchema } from "./wire-schemas";

const staleContact = "2000-01-01T00:00:00.000Z";

test("idle polls refresh runner contact while rejected credentials do not", async () => {
  const f = await fixture();
  try {
    const token = await f.register();
    const staleRunner = () => {
      f.store.db
        .update(tables.executors)
        .set({ lastSeenAt: staleContact })
        .where(eq(tables.executors.projectId, f.project.id))
        .run();
    };
    const lastContact = async () =>
      projectSchema.parse(await f.data("projects.get", { id: f.project.id }))
        .runner.last_seen_at;
    staleRunner();
    const beforePoll = Date.now();
    const idle = await f.request(
      "/internal/execution/v1/claim/",
      "POST",
      undefined,
      token,
    );
    expect(idle.status).toBe(204);
    expect(Date.parse((await lastContact()) ?? "")).toBeGreaterThanOrEqual(
      beforePoll,
    );
    staleRunner();
    const rejected = await f.request(
      "/internal/execution/v1/claim/",
      "POST",
      undefined,
      "unregistered-executor-token",
    );
    expect(rejected.status).toBe(401);
    expect(await lastContact()).toBe(staleContact);
    await f.data(
      "projects.disconnectExecutor",
      { id: f.project.id },
      "mutation",
    );
    const revoked = await f.request(
      "/internal/execution/v1/claim/",
      "POST",
      undefined,
      token,
    );
    expect(revoked.status).toBe(401);
    expect(await lastContact()).toBe(staleContact);
  } finally {
    await f.close();
  }
});

test("active run heartbeats refresh runner contact and expired leases cannot", async () => {
  const f = await fixture();
  try {
    const token = await f.register();
    const run = runSchema.parse(
      await f.data(
        "runs.create",
        {
          project: f.project.id,
          operation: "code",
          source: "return 42;",
          idempotency_key: "runner-contact",
        },
        "mutation",
      ),
    );
    const claimed = z
      .object({ capability: z.string() })
      .parse(
        await f.json("/internal/execution/v1/claim/", "POST", undefined, token),
      );
    f.store.db
      .update(tables.executors)
      .set({ lastSeenAt: staleContact })
      .where(eq(tables.executors.projectId, f.project.id))
      .run();
    const beforeHeartbeat = Date.now();
    await f.json(
      `/internal/execution/v1/runs/${run.id}/heartbeat/`,
      "POST",
      {},
      claimed.capability,
    );
    const connected = projectSchema.parse(
      await f.data("projects.get", { id: f.project.id }),
    ).runner.last_seen_at;
    expect(Date.parse(connected ?? "")).toBeGreaterThanOrEqual(beforeHeartbeat);
    f.store.db
      .update(tables.runs)
      .set({ leaseExpiresAt: staleContact })
      .where(eq(tables.runs.id, run.id))
      .run();
    f.store.db
      .update(tables.executors)
      .set({ lastSeenAt: staleContact })
      .where(eq(tables.executors.projectId, f.project.id))
      .run();
    const expired = await f.request(
      `/internal/execution/v1/runs/${run.id}/heartbeat/`,
      "POST",
      {},
      claimed.capability,
    );
    expect(expired.status).toBe(401);
    expect(
      projectSchema.parse(await f.data("projects.get", { id: f.project.id }))
        .runner.last_seen_at,
    ).toBe(staleContact);
  } finally {
    await f.close();
  }
});
