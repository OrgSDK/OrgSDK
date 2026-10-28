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
import { createRun } from "../runs/create";
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
    await Promise.resolve(
      expect(
        handleDomain({
          ...ctx,
          token: { ...token, id: crypto.randomUUID() },
          request: request("retry", { idempotency_key: "foreign" }),
        }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(
        handleDomain({
          ...ctx,
          token: { ...token, projects: [] },
          request: request("retry", { idempotency_key: "revoked" }),
        }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(
        handleDomain({
          ...ctx,
          request: request("promote", {
            name: "Saved",
            input_schema: {},
            output_schema: {},
          }),
        }),
      ).rejects.toThrow("scope"),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
