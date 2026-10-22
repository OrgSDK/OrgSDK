import { expect, test } from "bun:test";
import { Client } from "./client";
import { projectDataFunctions } from "./project-data";

const tableId = crypto.randomUUID();
const rowId = crypto.randomUUID();
function fixture(signal = new AbortController().signal) {
  const calls: unknown[] = [];
  class ScopedClient extends Client {
    override async product(path: string, method = "GET", body?: unknown) {
      calls.push({ path, method, body });
      return { items: [], next_offset: null };
    }
  }
  const functions = projectDataFunctions(
    new ScopedClient("http://fixture", "token"),
    signal,
  );
  return {
    calls,
    invoke: (name: string, ...args: unknown[]) =>
      functions.find((fn) => fn.name === name)!.handler(...args),
  };
}

test("project data globals use the scoped capability and positional paging", async () => {
  const { calls, invoke } = fixture();
  await invoke("listTables");
  await invoke("getTable", tableId);
  await invoke("listTableRows", tableId, 100, 10);
  await invoke("writeTableRow", tableId, 2, { value: [1, true, null] });
  await invoke("writeTableRow", tableId, 2, { value: "changed" }, rowId, 3);
  await invoke("deleteTableRow", tableId, rowId, 4);
  await invoke("listDocuments", 5, 10);
  await invoke("readDocument", rowId);
  await invoke("writeDocument", rowId, "Title", "Content");
  expect(calls).toHaveLength(9);
  expect(calls[0]).toEqual({
    path: "project-data/",
    method: "POST",
    body: { operation: "list_tables", offset: 0, limit: 50 },
  });
  expect(calls[4]).toEqual({
    path: "project-data/",
    method: "POST",
    body: {
      operation: "write_row",
      table_id: tableId,
      table_revision: 2,
      values: { value: "changed" },
      row_id: rowId,
      revision: 3,
    },
  });
});

test("invalid project data arguments never reach the capability endpoint", () => {
  const { calls, invoke } = fixture();
  for (const args of [
    ["listTables", -1],
    ["listDocuments", 0, 101],
    ["getTable", "invalid"],
    ["writeTableRow", tableId, 1, {}, rowId],
    ["writeTableRow", tableId, 1, {}, undefined, 1],
    ["writeTableRow", tableId, 1, { value: Infinity }],
    ["deleteTableRow", tableId, rowId, -1],
  ]) {
    expect(() => invoke(args[0] as string, ...args.slice(1))).toThrow();
  }
  expect(calls).toEqual([]);
});

test("aborted project data calls do not start requests", () => {
  const controller = new AbortController();
  const { calls, invoke } = fixture(controller.signal);
  controller.abort();
  expect(() => invoke("listTables")).toThrow();
  expect(calls).toEqual([]);
});

test("project data validates byte limits, Unicode and positive revisions", () => {
  const { calls, invoke } = fixture();
  for (const args of [
    ["writeDocument", rowId, "Title", "é".repeat(100001)],
    ["writeDocument", rowId, "Title", "\ud800"],
    ["writeDocument", rowId, "Title", "bad\0text"],
    ["writeTableRow", tableId, 0, {}],
    ["writeTableRow", tableId, 1, { text: "\ud800" }],
    ["writeTableRow", tableId, 1, { text: "é".repeat(100001) }],
  ])
    expect(() => invoke(args[0] as string, ...args.slice(1))).toThrow();
  expect(calls).toEqual([]);
});
