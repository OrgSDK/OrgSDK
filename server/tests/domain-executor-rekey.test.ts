import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { approvals, executors, projects, runs } from "../db/schema";
import { createRun } from "../runs/create";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";
test("executor rekey revokes active lease and pending approval without deleting project", async () => {
  const fixture = rpcFixture();
  const store = fixture.store;
  const project = fixture.project;
  const ctx = fixture.context();
  try {
    const register = () =>
      fixture
        .caller()
        .projects.connectExecutor({ id: project.id, locally_managed: false });
    const first = await register();
    const run = createRun(ctx, {
      project: project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "x",
    });
    store.db
      .update(runs)
      .set({
        executorId: first.executor_id,
        status: "running",
        capabilityHash: "live",
      })
      .where(eq(runs.id, run.id))
      .run();
    const approval = store.db
      .insert(approvals)
      .values({
        ...base(fixture.workspace.id),
        runId: run.id,
        prompt: "Continue?",
      })
      .returning()
      .get();
    const second = await register();
    expect(second.executor_id).toBe(first.executor_id);
    expect(second.token).not.toBe(first.token);
    const cancelled = store.db
      .select()
      .from(runs)
      .where(eq(runs.id, run.id))
      .get()!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.capabilityHash).toBe("");
    expect(cancelled.executorId).toBeNull();
    expect(
      store.db
        .select()
        .from(approvals)
        .where(eq(approvals.id, approval.id))
        .get()?.status,
    ).toBe("interrupted");
    await fixture.caller().projects.disconnectExecutor({ id: project.id });
    expect(
      store.db
        .select()
        .from(executors)
        .where(eq(executors.id, first.executor_id))
        .get()?.enabled,
    ).toBe(false);
    expect(
      store.db.select().from(projects).where(eq(projects.id, project.id)).get(),
    ).toBeDefined();
  } finally {
    fixture.close();
  }
});
