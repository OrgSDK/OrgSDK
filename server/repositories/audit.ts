import type { AppDatabase } from "../db/database";
import { auditRecords } from "../db/schema";
import { type ServiceContext } from "../application";
import { requireWorkspace } from "../shared/authorization";
import { base } from "../shared/records";
export function recordAudit(
  context: ServiceContext,
  kind: string,
  id: string,
  operation: string,
): void {
  appendAudit(context.db, {
    workspaceId: requireWorkspace(context).id,
    actorId: context.user?.id ?? null,
    action: kind + "." + operation,
    resource: id,
  });
}

export function appendAudit(
  database: AppDatabase,
  entry: {
    workspaceId: number;
    actorId: number | null;
    action: string;
    resource: string;
  },
): void {
  database
    .insert(auditRecords)
    .values({ ...base(entry.workspaceId), ...entry, data: {} })
    .run();
}
