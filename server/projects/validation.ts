import type { projects } from "../db/schema";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { documentsRepository } from "../repositories/documents";
import { workspaceTablesRepository } from "../repositories/workspace-tables";
import { booleanValue, stringList, text } from "../shared/validation";
export function projectValues(
  ctx: ServiceContext,
  body: Record<string, unknown>,
  old?: typeof projects.$inferSelect,
) {
  if (["model", "instructions", "credential"].some((key) => key in body)) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Model and reasoning configuration is retired.",
    );
  }
  const values = {
    name: text(body.name ?? old?.name, "name"),
    enabled: booleanValue(body.enabled, old?.enabled ?? true),
    readableTables: old?.readableTables ?? [],
    writableTables: old?.writableTables ?? [],
    readableDocuments: old?.readableDocuments ?? [],
    writableDocuments: old?.writableDocuments ?? [],
  };
  if (typeof values.enabled !== "boolean") {
    throw new ServiceError("BAD_REQUEST", "Enabled must be boolean.");
  }
  for (const [field, key, table] of [
    ["readableTables", "readable_tables", workspaceTablesRepository(ctx)],
    ["writableTables", "writable_tables", workspaceTablesRepository(ctx)],
    ["readableDocuments", "readable_documents", documentsRepository(ctx)],
    ["writableDocuments", "writable_documents", documentsRepository(ctx)],
  ] as const) {
    if (body[key] !== undefined) {
      const grants = stringList(body[key], key);
      for (const resourceId of grants) {
        table.find(resourceId);
      }
      values[field] = grants;
    }
  }
  return values;
}
