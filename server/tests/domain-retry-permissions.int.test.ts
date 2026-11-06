import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accessTokens, runs } from "../db/schema";
import { appRouter } from "../router";
import { rpcFixture } from "./rpc-fixture";

test("scoped native retry uses operation authority and promotion requires run read", async () => {
  const f = rpcFixture();
  try {
    const token = f.store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: f.workspace.id,
        actorId: f.user.id,
        name: "Client",
        digest: "scope-test",
        scopes: ["code:execute", "actions:write"],
        projects: [f.project.id],
        createdAt: f.time,
        updatedAt: f.time,
      })
      .returning()
      .get();
    const callerFor = (changes: Partial<typeof token> = {}) =>
      appRouter.createCaller({
        ...f.context(),
        token: { ...token, ...changes },
      });
    const caller = callerFor();
    const run = await caller.runs.create({
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "first",
    });
    f.store.db
      .update(runs)
      .set({ status: "failed" })
      .where(eq(runs.id, run.id))
      .run();
    const retry = await caller.runs.retry({
      id: run.id,
      idempotency_key: "retry",
    });
    expect(retry.retry_of).toBe(run.id);
    await Promise.resolve(
      expect(
        callerFor({ id: crypto.randomUUID() }).runs.retry({
          id: run.id,
          idempotency_key: "foreign",
        }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(
        callerFor({ projects: [] }).runs.retry({
          id: run.id,
          idempotency_key: "revoked",
        }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(
        callerFor({ scopes: ["actions:write"] }).runs.retry({
          id: run.id,
          idempotency_key: "wrong-scope",
        }),
      ).rejects.toThrow("scope"),
    );
    await Promise.resolve(
      expect(
        caller.runs.promote({
          id: run.id,
          name: "Saved",
          input_schema: {},
          output_schema: {},
        }),
      ).rejects.toThrow("scope"),
    );
  } finally {
    f.close();
  }
});
