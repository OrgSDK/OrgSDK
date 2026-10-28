import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { accessTokens, projects } from "../db/schema";
import { memberships, users, workspaces } from "../db/schema/core";
import type { AppContext } from "../http/context";
import { type projectSnapshot } from "../projects/snapshot";
import { createRun } from "../runs/create";
import { validateValues } from "../shared/contracts";
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
    expect(
      (run.snapshot as ReturnType<typeof projectSnapshot>).agents[0]!.resources
        .tables.read,
    ).toEqual(["table-a"]);
    expect(createRun(ctx, body).id).toBe(run.id);
    store.db
      .update(projects)
      .set({ readableTables: [] })
      .where(eq(projects.id, project.id))
      .run();
    expect(createRun(ctx, body).id).toBe(run.id);
    expect(
      (run.snapshot as ReturnType<typeof projectSnapshot>).agents[0]!.resources
        .tables.read,
    ).toEqual(["table-a"]);
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
