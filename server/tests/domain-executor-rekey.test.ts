import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { projects, runs } from "../db/schema";
import { users, workspaces } from "../db/schema/core";
import { handleDomain } from "../domain/routes";
import type { AppContext } from "../http/context";
import { createRun } from "../runs/create";
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
