import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { users, workspaces } from "../db/schema/core";
import { handleDomain } from "../domain/routes";
import type { AppContext } from "../http/context";
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
    await Promise.resolve(
      expect(
        call(`tables/${table.id}/rows`, "POST", {
          table_revision: 1,
          values: { n: 4 },
        }),
      ).rejects.toThrow("changed"),
    );
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
    await Promise.resolve(
      expect(
        call("projects", "POST", {
          name: "Forbidden grant",
          readable_tables: [foreignId],
        }),
      ).rejects.toThrow("Not found."),
    );
    expect(store.sqlite.query("pragma foreign_key_check").all()).toEqual([]);
    await Promise.resolve(
      expect(
        call("tables", "POST", {
          name: "Bad",
          columns: [{ key: "x", type: "text", required: true }],
          extra: true,
        }),
      ).rejects.toThrow("Unexpected fields"),
    );
    await Promise.resolve(
      expect(
        call("projects", "POST", { name: "Bad", enabled: "false" }),
      ).rejects.toThrow("boolean"),
    );
    await Promise.resolve(
      expect(
        call("projects", "POST", { name: "Bad", model: "retired" }),
      ).rejects.toThrow("retired"),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
