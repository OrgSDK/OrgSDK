import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runEvents } from "../db/schema";
import { sessions } from "../db/schema/core";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

type Fixture = ReturnType<typeof rpcFixture>;
function appendEvent(fixture: Fixture, runId: string, sequence: number) {
  fixture.store.db
    .insert(runEvents)
    .values({
      ...base(fixture.workspace.id),
      runId,
      sequence,
      kind: "output",
      data: { sequence },
    })
    .run();
}
async function openSubscription(fixture: Fixture) {
  const caller = fixture.caller();
  const run = await caller.runs.create({
    project: fixture.project.id,
    operation: "code",
    source: "return 1;",
    idempotency_key: "session-stream",
  });
  appendEvent(fixture, run.id, 1);
  const stream = await caller.runs.stream({ id: run.id });
  const iterator = stream[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.sequence).toBe(1);
  return { caller, run, iterator };
}

test("browser run subscriptions stop after logout removes their authenticated session", async () => {
  const fixture = rpcFixture();
  try {
    const { caller, run, iterator } = await openSubscription(fixture);
    expect((await caller.auth.logout()).is_authenticated).toBe(false);
    appendEvent(fixture, run.id, 2);
    const next = await iterator.next();
    expect(next.done).toBe(true);
    expect(next.value).toBeUndefined();
  } finally {
    fixture.close();
  }
});

test("browser run subscriptions stop when the authenticated session expires", async () => {
  const fixture = rpcFixture();
  try {
    const { run, iterator } = await openSubscription(fixture);
    const sessionId = fixture.context().sessionId!;
    fixture.store.db
      .update(sessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(sessions.id, sessionId))
      .run();
    appendEvent(fixture, run.id, 2);
    const next = await iterator.next();
    expect(next.done).toBe(true);
    expect(next.value).toBeUndefined();
  } finally {
    fixture.close();
  }
});
