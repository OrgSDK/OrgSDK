import { expect, test } from "bun:test";
import {
  existingCell,
  newCell,
  prepareCell,
  validateAppend,
} from "./cell-request";
import { sessionLimits } from "./configuration";
import { newHistory } from "./records";
import type { CellRequest } from "./types";

const request = (changes: Partial<CellRequest> = {}): CellRequest => ({
  id: crypto.randomUUID(),
  source: "return actionParams;",
  generation: 1,
  expectedSequence: 0,
  ...changes,
});

test("prepared inputs are independent and equivalent nested JSON retains the same request identity", () => {
  const inputs = { nested: { a: 1, b: 2 } };
  const first = prepareCell(request({ inputs }));
  inputs.nested.a = 99;
  expect(first.inputs).toEqual({ nested: { a: 1, b: 2 } });
  const equivalent = prepareCell({
    ...first,
    inputs: { nested: { b: 2, a: 1 } },
  });
  expect(equivalent.digest).toBe(first.digest);
  expect(prepareCell({ ...first, source: "return 43;" }).sourceDigest).not.toBe(
    first.sourceDigest,
  );
});

test("malformed or oversized cells are refused before becoming records", () => {
  for (const changes of [
    { source: " " },
    { source: "\0" },
    { source: "\ud800" },
    { source: "é".repeat(100001) },
    { id: "not-a-uuid" },
  ])
    expect(() => prepareCell(request(changes))).toThrow("Cell requires");
  expect(() => prepareCell(request({ inputs: { value: "\0" } }))).toThrow(
    "Unicode",
  );
});

test("deduplication and append checks are separate from record creation and mutation", () => {
  const history = newHistory(
    { workspaceId: "w", projectId: "p", ownerId: "o" },
    "revision",
  );
  const prepared = prepareCell(request());
  const cell = newCell(history, prepared);
  expect(history.cells).toHaveLength(0);
  history.cells.push(cell);
  expect(existingCell(history, prepared)).toBe(cell);
  expect(() =>
    existingCell(history, prepareCell({ ...prepared, source: "return 43;" })),
  ).toThrow("different payload");
  const limits = sessionLimits({ historyDirectory: "/history", maxCells: 1 });
  expect(() =>
    validateAppend(
      history,
      true,
      prepareCell(request({ expectedSequence: 1 })),
      limits,
    ),
  ).toThrow("history limit");
  expect(history.cells).toHaveLength(1);
});
