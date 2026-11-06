import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accessTokens, projects, runs } from "../db/schema";
import { snapshotAgents } from "../projects/snapshot-schema";
import { appRouter } from "../router";
import { validateValues } from "../shared/contracts";
import { rpcFixture } from "./rpc-fixture";

test("native runs snapshot project grants, enforce idempotency and scoped access", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    f.store.db
      .update(projects)
      .set({ readableTables: ["table-a"] })
      .where(eq(projects.id, f.project.id))
      .run();
    const input = {
      project: f.project.id,
      operation: "code" as const,
      source: "return 1;",
      inputs: {},
      idempotency_key: "one",
    };
    const run = await caller.runs.create(input);
    expect(run.project).toBe(f.project.id);
    expect(Object.hasOwn(run, "agent")).toBe(false);
    const legacyInput = await f.rpc(
      "runs.create",
      { ...input, project: undefined, agent: f.project.id },
      "mutation",
    );
    expect(legacyInput.status).toBe(400);
    const stored = f.store.db
      .select()
      .from(runs)
      .where(eq(runs.id, run.id))
      .get()!;
    expect(snapshotAgents(stored.snapshot)[0]!.resources!.tables.read).toEqual([
      "table-a",
    ]);
    expect((await caller.runs.create(input)).id).toBe(run.id);
    f.store.db
      .update(projects)
      .set({ readableTables: [] })
      .where(eq(projects.id, f.project.id))
      .run();
    expect((await caller.runs.create(input)).id).toBe(run.id);
    expect(snapshotAgents(stored.snapshot)[0]!.resources!.tables.read).toEqual([
      "table-a",
    ]);
    await Promise.resolve(
      expect(
        caller.runs.create({ ...input, source: "return 2;" }),
      ).rejects.toThrow("Idempotency"),
    );
    const token = f.store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: f.workspace.id,
        actorId: f.user.id,
        name: "Client",
        digest: "no-grant",
        scopes: ["code:execute"],
        createdAt: f.time,
        updatedAt: f.time,
      })
      .returning()
      .get();
    await Promise.resolve(
      expect(
        appRouter
          .createCaller({ ...f.context(), token })
          .runs.create({ ...input, idempotency_key: "two" }),
      ).rejects.toThrow("outside the client grant"),
    );
    const other = f.store.db
      .insert(projects)
      .values({ ...f.project, id: crypto.randomUUID(), name: "Other" })
      .returning()
      .get();
    await Promise.resolve(
      expect(
        appRouter
          .createCaller({
            ...f.context(),
            token: { ...token, projects: [other.id] },
          })
          .runs.create({ ...input, idempotency_key: "other" }),
      ).rejects.toThrow("outside the client grant"),
    );
    expect(() =>
      validateValues([{ key: "count", type: "number", required: true }], {
        count: "bad",
      }),
    ).toThrow();
  } finally {
    f.close();
  }
});
