import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accessTokens, runEvents, runs } from "../db/schema";
import { appRouter } from "../router";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

test("native run subscriptions resume by sequence and finish after terminal events", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    const run = await caller.runs.create({
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "stream",
    });
    f.store.db
      .insert(runEvents)
      .values(
        [1, 2].map((sequence) => ({
          ...base(f.workspace.id),
          runId: run.id,
          sequence,
          kind: "output",
          data: { sequence },
        })),
      )
      .run();
    f.store.db
      .update(runs)
      .set({ status: "succeeded" })
      .where(eq(runs.id, run.id))
      .run();
    const stream = await caller.runs.stream({ id: run.id, after: 1 });
    const received = [];
    for await (const event of stream) {
      received.push(event.sequence);
    }
    expect(received).toEqual([2]);
    const response = await f.rpc("runs.stream", { id: run.id, after: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const wire = await response.text();
    expect(wire).toContain('"sequence":2');
    expect(wire).not.toContain('"sequence":1');
    expect(wire).toContain("event: return");
  } finally {
    f.close();
  }
});

test("native run subscriptions stop when token access is revoked", async () => {
  const f = rpcFixture();
  try {
    const token = f.store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: f.workspace.id,
        actorId: f.user.id,
        name: "Stream client",
        digest: "stream-token",
        scopes: ["code:execute", "runs:read"],
        projects: [f.project.id],
        createdAt: f.time,
        updatedAt: f.time,
      })
      .returning()
      .get();
    const caller = appRouter.createCaller({ ...f.context(), token });
    const run = await caller.runs.create({
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "revocable-stream",
    });
    f.store.db
      .insert(runEvents)
      .values({
        ...base(f.workspace.id),
        runId: run.id,
        sequence: 1,
        kind: "output",
        data: {},
      })
      .run();
    const stream = await caller.runs.stream({ id: run.id });
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.sequence).toBe(1);
    f.store.db
      .update(accessTokens)
      .set({ revoked: true })
      .where(eq(accessTokens.id, token.id))
      .run();
    expect((await iterator.next()).done).toBe(true);
  } finally {
    f.close();
  }
});
