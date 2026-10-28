import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { accessTokens, projects, runs } from "../db/schema";
import { memberships, users, workspaces } from "../db/schema/core";
import { handleDomain } from "../domain/routes";
import type { AppContext } from "../http/context";
test("action versions, webhook deliveries and immutable retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-actions-"));
  const store = openStore(dir);
  try {
    const user = store.db
      .insert(users)
      .values({
        username: "tester",
        email: "test@example.com",
        passwordHash: "x",
      })
      .returning()
      .get();
    const workspace = store.db
      .insert(workspaces)
      .values({
        name: "A",
        host: "localhost",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    store.db
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
      .run();
    const project = store.db
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        name: "Project",
        enabled: true,
        readableTables: [],
        writableTables: [],
        readableDocuments: [],
        writableDocuments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const ctx: AppContext = {
      request: new Request("http://localhost/"),
      store,
      user,
      workspace,
      role: "owner",
      token: null,
      responseHeaders: new Headers(),
      sessionId: null,
    };
    const call = async (path: string, body: any) =>
      handleDomain({
        ...ctx,
        request: new Request(`http://localhost/api/v1/${path}/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
    const actionResponse = await call("actions/save-action", {
      project: project.id,
      name: "Increment",
      source: "return 1;",
      input_schema: { type: "object" },
      output_schema: { type: "number" },
    });
    const saved = (await actionResponse!.json()) as any;
    expect(saved.version.number).toBe(1);
    const savedAgain = await call("actions/save-action", {
      project: project.id,
      name: "Increment",
      source: "return 1;",
      input_schema: { type: "object" },
      output_schema: { type: "number" },
    });
    const same = (await savedAgain!.json()) as any;
    expect(same.action).toBe(saved.action);
    expect(same.version.id).toBe(saved.version.id);
    const suiteResponse = await call(`actions/${saved.action}/tests`, {
      version: 1,
      cases: [{ name: "simple", inputs: {}, expected: 1 }],
    });
    const suite = (await suiteResponse!.json()) as any;
    expect(suite.revision).toBe(1);
    const limited = store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        actorId: user.id,
        name: "Version only",
        digest: "scoped",
        scopes: ["catalog:read", "actions:run"],
        projects: [],
        actionVersions: [saved.version.id],
        revoked: false,
        firstUsedAt: null,
        lastUsedAt: null,
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        restRequestCount: 0,
        mcpRequestCount: 0,
        lastTransport: "",
        lastOutcome: "",
        lastStatusCode: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const limitedCtx = {
      ...ctx,
      token: limited,
      request: new Request(
        `http://localhost/api/v1/projects/${project.id}/sdk/`,
      ),
    };
    await Promise.resolve(
      expect(handleDomain(limitedCtx)).rejects.toThrow(
        "outside the client grant",
      ),
    );
    const testRun = await call(`actions/${saved.action}/run-tests`, {
      version: 1,
      suite_revision: 1,
      idempotency_key: "test",
    });
    expect(((await testRun!.json()) as any).operation).toBe("test");
    const webhookResponse = await call("webhooks", {
      name: "Incoming",
      action: saved.action,
    });
    const hook = (await webhookResponse!.json()) as any;
    const { handleWebhookIngress } = await import("../automations/ingress");
    const ingress = () =>
      handleWebhookIngress({
        ...ctx,
        user: null,
        role: null,
        request: new Request(`http://localhost${hook.webhook.endpoint}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-secret": hook.secret,
            "x-webhook-delivery": "delivery-1",
          },
          body: JSON.stringify({ inputs: {} }),
        }),
      });
    const first = await ingress();
    expect(first!.status).toBe(202);
    const receipt = (await first!.json()) as any;
    const second = await ingress();
    expect(second!.status).toBe(200);
    expect(((await second!.json()) as any).run).toBe(receipt.run);
    const conflict = handleWebhookIngress({
      ...ctx,
      user: null,
      role: null,
      request: new Request(`http://localhost${hook.webhook.endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": hook.secret,
          "x-webhook-delivery": "delivery-1",
        },
        body: JSON.stringify({ inputs: { value: 2 } }),
      }),
    });
    await Promise.resolve(
      expect(conflict).rejects.toThrow("different payload"),
    );
    store.db
      .update(runs)
      .set({ status: "failed" })
      .where(eq(runs.id, receipt.run))
      .run();
    const retry = await call(`runs/${receipt.run}/retry`, {
      idempotency_key: "retry",
    });
    const retried = (await retry!.json()) as any;
    expect(retried.retry_of).toBe(receipt.run);
    const retryAgain = await call(`runs/${receipt.run}/retry`, {
      idempotency_key: "retry",
    });
    expect(((await retryAgain!.json()) as any).id).toBe(retried.id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
