import { expect, test } from "bun:test";
import { z } from "zod";
import { workspaces } from "../db/schema/core";
import { appRouter } from "../router";
import { rpcFixture } from "./rpc-fixture";

test("native table revisions reject stale writes and project grants cannot cross workspaces", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    const table = await caller.tables.create({
      name: "Numbers",
      columns: [{ key: "n", type: "number", required: true }],
    });
    const row = await caller.tables.createRow({
      id: table.id,
      table_revision: 1,
      values: { n: 3 },
    });
    expect(row.revision).toBe(1);
    const changed = await caller.tables.update({
      id: table.id,
      revision: 1,
      name: "Changed",
    });
    expect(changed.revision).toBe(2);
    await Promise.resolve(
      expect(
        caller.tables.createRow({
          id: table.id,
          table_revision: 1,
          values: { n: 4 },
        }),
      ).rejects.toThrow("changed"),
    );
    const changedRow = await caller.tables.updateRow({
      id: table.id,
      rowId: row.id,
      table_revision: 2,
      revision: 1,
      values: { n: 4 },
    });
    expect(changedRow.revision).toBe(2);
    await Promise.resolve(
      expect(
        caller.tables.updateRow({
          id: table.id,
          rowId: row.id,
          table_revision: 2,
          revision: 1,
          values: { n: 5 },
        }),
      ).rejects.toThrow("changed"),
    );
    await Promise.resolve(
      expect(
        caller.tables.deleteRow({ id: table.id, rowId: row.id, revision: 1 }),
      ).rejects.toThrow("changed"),
    );
    const foreign = f.store.db
      .insert(workspaces)
      .values({ name: "B", host: "b.local", createdAt: f.time })
      .returning()
      .get();
    const foreignCaller = appRouter.createCaller({
      ...f.context(),
      workspace: foreign,
    });
    const foreignTable = await foreignCaller.tables.create({
      name: "Private",
      columns: [{ key: "n", type: "number", required: true }],
    });
    await Promise.resolve(
      expect(
        caller.projects.create({
          name: "Forbidden grant",
          readable_tables: [foreignTable.id],
        }),
      ).rejects.toThrow("Not found."),
    );
    await Promise.resolve(
      expect(caller.tables.get({ id: foreignTable.id })).rejects.toThrow(
        "Not found.",
      ),
    );
    const invalidTable = await f.rpc(
      "tables.create",
      { name: "Bad", columns: table.columns, extra: true },
      "mutation",
    );
    expect(invalidTable.status).toBe(400);
    const invalidProject = await f.rpc(
      "projects.create",
      { name: "Bad", enabled: "false" },
      "mutation",
    );
    expect(invalidProject.status).toBe(400);
    const retired = await f.rpc(
      "projects.create",
      { name: "Bad", model: "retired" },
      "mutation",
    );
    expect(retired.status).toBe(400);
    const rejected = z
      .object({ error: z.object({ data: z.object({ code: z.string() }) }) })
      .parse(await retired.json());
    expect(rejected.error.data.code).toBe("BAD_REQUEST");
    expect(f.store.sqlite.query("pragma foreign_key_check").all()).toEqual([]);
  } finally {
    f.close();
  }
});
