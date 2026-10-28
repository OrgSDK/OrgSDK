import type { projects } from "../db/schema";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { findDocument } from "../repositories/documents";
import { findWorkspaceTable } from "../repositories/workspace-tables";
import { requireWorkspace } from "../shared/authorization";
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
  const workspaceId = requireWorkspace(ctx).id;
  for (const [field, key, findResource] of [
    ["readableTables", "readable_tables", findWorkspaceTable],
    ["writableTables", "writable_tables", findWorkspaceTable],
    ["readableDocuments", "readable_documents", findDocument],
    ["writableDocuments", "writable_documents", findDocument],
  ] as const) {
    if (body[key] !== undefined) {
      const grants = stringList(body[key], key);
      for (const resourceId of grants) {
        findResource(ctx.db, workspaceId, resourceId);
      }
      values[field] = grants;
    }
  }
  return values;
}
