import { expect, test } from "bun:test";
import { newCell, prepareCell } from "./cell-request";
import {
  cellContext,
  FunctionBroker,
  type ActiveCell,
} from "./function-broker";
import { newHistory } from "./records";

function activeCell() {
  const history = newHistory(
    { workspaceId: "w", projectId: "p", ownerId: "o" },
    "revision",
  );
  const record = newCell(
    history,
    prepareCell({
      id: crypto.randomUUID(),
      generation: 1,
      expectedSequence: 0,
      source: "return 42;",
      inputs: { value: 42 },
    }),
  );
  const active: ActiveCell = {
    record,
    controller: new AbortController(),
    capability: "current-capability",
  };
  history.status = "executing";
  return { history, active };
}

test("cell authority refuses idle, stale, aborted and closed calls", () => {
  const { history, active } = activeCell();
  expect(() => cellContext(history, undefined, active.record.id, 1)).toThrow(
    "No active cell",
  );
  expect(() => cellContext(history, active, "another-cell", 1)).toThrow(
    "No active cell",
  );
  expect(() => cellContext(history, active, active.record.id, 2)).toThrow(
    "No active cell",
  );
  active.controller.abort();
  expect(() => cellContext(history, active, active.record.id, 1)).toThrow(
    "No active cell",
  );
  const next = activeCell();
  next.history.status = "closed";
  expect(() =>
    cellContext(next.history, next.active, next.active.record.id, 1),
  ).toThrow("No active cell");
});

test("dispatch receives current capability and copied inputs, and unknown functions fail closed", async () => {
  const { history, active } = activeCell();
  const context = cellContext(history, active, active.record.id, 1);
  context.inputs.value = 7;
  expect(active.record.inputs.value).toBe(42);
  const broker = new FunctionBroker([
    {
      name: "records.search",
      handler: (_args, cell) => ({
        capability: cell.capability,
        value: cell.inputs.value,
      }),
    },
  ]);
  expect(await broker.call(context, "/unused", "records.search", [])).toEqual({
    capability: "current-capability",
    value: 7,
  });
  await expect(
    broker.call(context, "/unused", "records.unknown", []),
  ).rejects.toMatchObject({ code: "unknown_function" });
});

test("function configuration rejects reserved names, duplicates and mixed flat/namespaced roots", () => {
  const fn = (name: string) => ({ name, handler: () => null });
  for (const name of [
    "console.log",
    "readFile",
    "records.constructor",
    "records.search.extra",
  ])
    expect(() => new FunctionBroker([fn(name)])).toThrow("session function");
  expect(
    () => new FunctionBroker([fn("records.search"), fn("records.search")]),
  ).toThrow("session function");
  expect(
    () => new FunctionBroker([fn("records"), fn("records.search")]),
  ).toThrow("overlap");
});
