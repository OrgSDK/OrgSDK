import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db";
import { users, workspaces, memberships } from "./db/core";
import { projects, accessTokens, runs } from "./db/domain";
import { eq } from "drizzle-orm";
import { createRun, handleDomain, validateValues } from "./domain";
import type { AppContext } from "./context";

test("runs snapshot project grants, enforce idempotency and scoped access", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-domain-"));
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
        name: "Test",
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
        readableTables: ["table-a"],
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
    const body = {
      project: project.id,
      operation: "code",
      source: "return 1;",
      inputs: {},
      idempotency_key: "one",
    };
    const run = createRun(ctx, body);
    expect(run.snapshot.agents[0].resources.tables.read).toEqual(["table-a"]);
    expect(createRun(ctx, body).id).toBe(run.id);
    store.db
      .update(projects)
      .set({ readableTables: [] })
      .where(eq(projects.id, project.id))
      .run();
    expect(createRun(ctx, body).id).toBe(run.id);
    expect(run.snapshot.agents[0].resources.tables.read).toEqual(["table-a"]);
    expect(() => createRun(ctx, { ...body, source: "return 2;" })).toThrow(
      "Idempotency",
    );
    const token = store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        actorId: user.id,
        name: "Client",
        digest: "digest",
        scopes: ["code:execute"],
        projects: [],
        actionVersions: [],
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
    expect(() =>
      createRun({ ...ctx, token }, { ...body, idempotency_key: "two" }),
    ).toThrow("outside the client grant");
    const other = store.db
      .insert(projects)
      .values({ ...project, id: crypto.randomUUID(), name: "Other" })
      .returning()
      .get();
    const granted = { ...token, projects: [other.id] };
    expect(() =>
      createRun(
        { ...ctx, token: granted },
        { ...body, idempotency_key: "other" },
      ),
    ).toThrow("outside the client grant");
    expect(() =>
      validateValues([{ key: "count", type: "number", required: true }], {
        count: "bad",
      }),
    ).toThrow();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cross-workspace project is not visible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-isolation-"));
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
    const a = store.db
      .insert(workspaces)
      .values({
        name: "A",
        host: "a.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const b = store.db
      .insert(workspaces)
      .values({
        name: "B",
        host: "b.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const project = store.db
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        workspaceId: b.id,
        name: "Secret",
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
      request: new Request(`http://a.local/api/v1/projects/${project.id}/`),
      store,
      user,
      workspace: a,
      role: "owner",
      token: null,
      responseHeaders: new Headers(),
      sessionId: null,
    };
    expect(handleDomain(ctx)).rejects.toThrow("Not found.");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    await expect(handleDomain(limitedCtx)).rejects.toThrow(
      "outside the client grant",
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
    const { handleWebhookIngress } = await import("./domain");
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
    await expect(conflict).rejects.toThrow("different payload");
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

test("table revisions reject stale writes and project grants cannot cross workspaces", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-table-"));
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
        host: "a.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const foreign = store.db
      .insert(workspaces)
      .values({
        name: "B",
        host: "b.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const ctx: AppContext = {
      request: new Request("http://a.local/"),
      store,
      user,
      workspace,
      role: "owner",
      token: null,
      responseHeaders: new Headers(),
      sessionId: null,
    };
    const call = (path: string, method: string, body: any, context = ctx) =>
      handleDomain({
        ...context,
        request: new Request(`http://a.local/api/v1/${path}/`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
    const create = await call("tables", "POST", {
      name: "Numbers",
      columns: [{ key: "n", type: "number", required: true }],
    });
    const table = (await create!.json()) as any;
    const row = await call(`tables/${table.id}/rows`, "POST", {
      table_revision: 1,
      values: { n: 3 },
    });
    expect(row!.status).toBe(201);
    const changed = await call(`tables/${table.id}`, "PATCH", {
      revision: 1,
      name: "Changed",
    });
    expect(((await changed!.json()) as any).revision).toBe(2);
    await expect(
      call(`tables/${table.id}/rows`, "POST", {
        table_revision: 1,
        values: { n: 4 },
      }),
    ).rejects.toThrow("changed");
    const foreignCtx = { ...ctx, workspace: foreign };
    const foreignTable = await call(
      "tables",
      "POST",
      {
        name: "Private",
        columns: [{ key: "n", type: "number", required: true }],
      },
      foreignCtx,
    );
    const foreignId = ((await foreignTable!.json()) as any).id;
    await expect(
      call("projects", "POST", {
        name: "Forbidden grant",
        readable_tables: [foreignId],
      }),
    ).rejects.toThrow("Not found.");
    expect(store.sqlite.query("pragma foreign_key_check").all()).toEqual([]);
    await expect(
      call("tables", "POST", {
        name: "Bad",
        columns: [{ key: "x", type: "text", required: true }],
        extra: true,
      }),
    ).rejects.toThrow("Unexpected fields");
    await expect(
      call("projects", "POST", { name: "Bad", enabled: "false" }),
    ).rejects.toThrow("boolean");
    await expect(
      call("projects", "POST", { name: "Bad", model: "retired" }),
    ).rejects.toThrow("retired");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executor rekey revokes active lease and pending approval without deleting project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-executor-"));
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
    const register = () =>
      handleDomain({
        ...ctx,
        request: new Request(
          `http://localhost/api/v1/projects/${project.id}/executor/`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"locally_managed":false}',
          },
        ),
      });
    const first = (await (await register())!.json()) as any;
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
    const second = (await (await register())!.json()) as any;
    expect(second.executor_id).toBe(first.executor_id);
    expect(second.token).not.toBe(first.token);
    const cancelled = store.db
      .select()
      .from(runs)
      .where(eq(runs.id, run.id))
      .get()!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.capabilityHash).toBe("");
    const deleted = await handleDomain({
      ...ctx,
      request: new Request(
        `http://localhost/api/v1/projects/${project.id}/executor/`,
        { method: "DELETE" },
      ),
    });
    expect(deleted!.status).toBe(204);
    expect(
      store.db.select().from(projects).where(eq(projects.id, project.id)).get(),
    ).toBeDefined();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scoped retry uses operation authority and promotion requires run read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-retry-scope-"));
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
        name: "Test",
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
    const token = store.db
      .insert(accessTokens)
      .values({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        actorId: user.id,
        name: "Client",
        digest: "scope-test",
        scopes: ["code:execute", "actions:write"],
        projects: [project.id],
        actionVersions: [],
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
    const ctx: AppContext = {
      request: new Request("http://localhost/"),
      store,
      user,
      workspace,
      role: "owner",
      token,
      responseHeaders: new Headers(),
      sessionId: null,
    };
    const run = createRun(ctx, {
      project: project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "first",
    });
    store.db
      .update(runs)
      .set({ status: "failed" })
      .where(eq(runs.id, run.id))
      .run();
    const request = (suffix: string, body: unknown) =>
      new Request(`http://localhost/api/v1/runs/${run.id}/${suffix}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const retry = await handleDomain({
      ...ctx,
      request: request("retry", { idempotency_key: "retry" }),
    });
    expect(retry!.status).toBe(201);
    expect(((await retry!.json()) as any).retry_of).toBe(run.id);
    await expect(
      handleDomain({
        ...ctx,
        token: { ...token, id: crypto.randomUUID() },
        request: request("retry", { idempotency_key: "foreign" }),
      }),
    ).rejects.toThrow("Not found");
    await expect(
      handleDomain({
        ...ctx,
        token: { ...token, projects: [] },
        request: request("retry", { idempotency_key: "revoked" }),
      }),
    ).rejects.toThrow("Not found");
    await expect(
      handleDomain({
        ...ctx,
        request: request("promote", {
          name: "Saved",
          input_schema: {},
          output_schema: {},
        }),
      }),
    ).rejects.toThrow("scope");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
