import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { projects } from "../db/schema";
import { users, workspaces } from "../db/schema/core";
import { handleDomain } from "../domain/routes";
import type { AppContext } from "../http/context";
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
