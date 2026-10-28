import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { documentsRepository } from "../repositories/documents";
import { workspaceTablesRepository } from "../repositories/workspace-tables";
import { text } from "../shared/validation";
export function projectValues(ctx: AppContext, body: any, old?: any) {
  if (["model", "instructions", "credential"].some((key) => key in body))
    throw new HttpError(400, "Model and reasoning configuration is retired.");
  const values: any = {
    name: body.name === undefined ? old?.name : text(body.name, "name"),
    enabled: body.enabled === undefined ? (old?.enabled ?? true) : body.enabled,
  };
  if (typeof values.enabled !== "boolean")
    throw new HttpError(400, "Enabled must be boolean.");
  for (const [field, key, table] of [
    ["readableTables", "readable_tables", workspaceTablesRepository(ctx)],
    ["writableTables", "writable_tables", workspaceTablesRepository(ctx)],
    ["readableDocuments", "readable_documents", documentsRepository(ctx)],
    ["writableDocuments", "writable_documents", documentsRepository(ctx)],
  ] as const) {
    if (body[key] !== undefined) {
      browser(ctx, true);
      if (ctx.token)
        throw new HttpError(
          403,
          "Resource grants require a workspace manager browser session.",
        );
      if (
        !Array.isArray(body[key]) ||
        body[key].some((id: unknown) => typeof id !== "string")
      )
        throw new HttpError(400, `Invalid ${key}.`);
      for (const id of body[key]) table.find(id);
    }
    values[field] = body[key] ?? old?.[field] ?? [];
  }
  return values;
}
