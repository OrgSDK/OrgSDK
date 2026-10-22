import { z } from "zod";
import type { Client } from "./client";
import type { SandboxFunction } from "./engine/sandbox/types";

const id = z.string().uuid();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const offset = z.number().int().min(0).max(1_000_000).default(0);
const limit = z.number().int().min(1).max(100).default(50);
const validText = z
  .string()
  .refine(
    (value) => !value.includes("\0") && value.isWellFormed(),
    "Text must contain valid Unicode and no NUL characters",
  );
const content = validText.refine(
  (value) => new TextEncoder().encode(value).length <= 200_000,
  "Content exceeds 200000 UTF-8 bytes",
);
const values = z.record(z.string(), z.json()).refine((value) => {
  const serialized = JSON.stringify(value);
  return (
    new TextEncoder().encode(serialized).length <= 200_000 &&
    validJsonText(value)
  );
}, "Values must contain valid Unicode, no NUL characters, and at most 200000 UTF-8 bytes");

function validJsonText(value: unknown): boolean {
  if (typeof value === "string") return validText.safeParse(value).success;
  if (Array.isArray(value)) return value.every(validJsonText);
  if (value !== null && typeof value === "object")
    return Object.entries(value).every(
      ([key, entry]) =>
        validText.safeParse(key).success && validJsonText(entry),
    );
  return true;
}

export function projectDataFunctions(
  client: Client,
  signal: AbortSignal,
): SandboxFunction[] {
  const call = (operation: string, params: Record<string, unknown>) => {
    signal.throwIfAborted();
    return client.product("project-data/", "POST", { operation, ...params });
  };
  const page = (start: unknown, count: unknown) => ({
    offset: offset.parse(start),
    limit: limit.parse(count),
  });
  const builtin = (
    name: string,
    handler: (...args: unknown[]) => unknown,
  ): SandboxFunction => ({ name, calling: "positional", handler });
  return [
    builtin("listTables", (start, count) =>
      call("list_tables", page(start, count)),
    ),
    builtin("getTable", (tableId) =>
      call("get_table", { table_id: id.parse(tableId) }),
    ),
    builtin("listTableRows", (tableId, start, count) =>
      call("list_rows", { table_id: id.parse(tableId), ...page(start, count) }),
    ),
    builtin(
      "writeTableRow",
      (tableId, tableRevision, rowValues, rowId, rowRevision) => {
        if ((rowId === undefined) !== (rowRevision === undefined))
          throw new Error(
            "Updating a row requires both rowId and revision; creating a row omits both",
          );
        return call("write_row", {
          table_id: id.parse(tableId),
          table_revision: revision.parse(tableRevision),
          values: values.parse(rowValues),
          ...(rowId === undefined
            ? {}
            : {
                row_id: id.parse(rowId),
                revision: revision.parse(rowRevision),
              }),
        });
      },
    ),
    builtin("deleteTableRow", (tableId, rowId, rowRevision) =>
      call("delete_row", {
        table_id: id.parse(tableId),
        row_id: id.parse(rowId),
        revision: revision.parse(rowRevision),
      }),
    ),
    builtin("listDocuments", (start, count) =>
      call("list_documents", page(start, count)),
    ),
    builtin("readDocument", (documentId) =>
      call("get_document", { document_id: id.parse(documentId) }),
    ),
    builtin("writeDocument", (documentId, title, contentValue) =>
      call("write_document", {
        document_id: id.parse(documentId),
        title: validText.pipe(z.string().max(200)).parse(title),
        content: content.parse(contentValue),
      }),
    ),
  ];
}
