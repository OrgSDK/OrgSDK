import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { accessTokens, runs } from "../db/schema";
import { appRouter } from "../router";
import { rpcFixture } from "./rpc-fixture";

test("native actions preserve immutable versions, webhook deliveries and retries", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    const input = {
      project: f.project.id,
      name: "Increment",
      source: "return 1;",
      input_schema: { type: "object" },
      output_schema: { type: "number" },
    };
    const saved = await caller.actions.saveAction(input);
    expect(saved.version.number).toBe(1);
    const action = await caller.actions.get({ id: saved.action });
    expect(action.project).toBe(f.project.id);
    expect(Object.hasOwn(action, "agent")).toBe(false);
    const legacyInput = await f.rpc(
      "actions.saveAction",
      { ...input, project: undefined, agent: f.project.id },
      "mutation",
    );
    expect(legacyInput.status).toBe(400);
    const same = await caller.actions.saveAction(input);
    expect(same.action).toBe(saved.action);
    expect(same.version.id).toBe(saved.version.id);
    const suite = await caller.actions.saveTests({
      id: saved.action,
      version: 1,
      cases: [{ name: "simple", inputs: {}, expected: 1 }],
    });
    expect(suite.revision).toBe(1);
    const limited = f.store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: f.workspace.id,
        actorId: f.user.id,
        name: "Version only",
        digest: "version-only",
        scopes: ["catalog:read", "actions:run"],
        actionVersions: [saved.version.id],
        createdAt: f.time,
        updatedAt: f.time,
      })
      .returning()
      .get();
    const limitedCaller = appRouter.createCaller({
      ...f.context(),
      token: limited,
    });
    await Promise.resolve(
      expect(limitedCaller.projects.sdk({ id: f.project.id })).rejects.toThrow(
        "outside the client grant",
      ),
    );
    expect(
      (await limitedCaller.actions.version({ id: saved.action, version: 1 }))
        .id,
    ).toBe(saved.version.id);
    await Promise.resolve(
      expect(
        limitedCaller.actions.version({ id: saved.action }),
      ).rejects.toThrow("explicit granted action version"),
    );
    const testRun = await caller.actions.runTests({
      id: saved.action,
      version: 1,
      suite_revision: 1,
      idempotency_key: "test",
    });
    expect(testRun.operation).toBe("test");
    const hook = await caller.webhooks.create({
      name: "Incoming",
      action: saved.action,
    });
    const ingress = (inputs: Record<string, number> = {}) =>
      f.request(hook.webhook.endpoint, "POST", { inputs }, undefined, {
        "x-webhook-secret": hook.secret,
        "x-webhook-delivery": "delivery-1",
      });
    const first = await ingress();
    expect(first.status).toBe(202);
    const receipt = z.object({ run: z.string() }).parse(await first.json());
    const second = await ingress();
    expect(second.status).toBe(200);
    expect(z.object({ run: z.string() }).parse(await second.json()).run).toBe(
      receipt.run,
    );
    expect((await ingress({ value: 2 })).status).toBe(409);
    f.store.db
      .update(runs)
      .set({ status: "failed" })
      .where(eq(runs.id, receipt.run))
      .run();
    const retried = await caller.runs.retry({
      id: receipt.run,
      idempotency_key: "retry",
    });
    expect(retried.retry_of).toBe(receipt.run);
    expect(
      (await caller.runs.retry({ id: receipt.run, idempotency_key: "retry" }))
        .id,
    ).toBe(retried.id);
    const original = f.store.db
      .select()
      .from(runs)
      .where(eq(runs.id, receipt.run))
      .get()!;
    const retry = f.store.db
      .select()
      .from(runs)
      .where(eq(runs.id, retried.id))
      .get()!;
    expect(retry.snapshot).toEqual(original.snapshot);
  } finally {
    f.close();
  }
});
