import { expect, test } from "bun:test";
import { rpcFixture } from "./rpc-fixture";

test("table row procedures reject rows from another table without reading or changing them", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const requestedTable = await caller.tables.create({
      name: "Requested",
      columns: [{ key: "value", type: "number", required: true }],
    });
    const owningTable = await caller.tables.create({
      name: "Owner",
      columns: [{ key: "value", type: "number", required: true }],
    });
    const row = await caller.tables.createRow({
      id: owningTable.id,
      table_revision: 1,
      values: { value: 42 },
    });
    await Promise.resolve(
      expect(
        caller.tables.getRow({ id: requestedTable.id, rowId: row.id }),
      ).rejects.toThrow("Not found."),
    );
    await Promise.resolve(
      expect(
        caller.tables.updateRow({
          id: requestedTable.id,
          rowId: row.id,
          table_revision: 1,
          revision: 1,
          values: { value: 99 },
        }),
      ).rejects.toThrow("Not found."),
    );
    await Promise.resolve(
      expect(
        caller.tables.deleteRow({
          id: requestedTable.id,
          rowId: row.id,
          revision: 1,
        }),
      ).rejects.toThrow("Not found."),
    );
    expect(
      await caller.tables.getRow({ id: owningTable.id, rowId: row.id }),
    ).toEqual(row);
  } finally {
    fixture.close();
  }
});
