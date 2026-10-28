import { auditRecords } from "../db/schema";
import type { AppContext } from "../http/context";
import { requireWorkspace } from "../http/context";
import { base } from "../shared/records";
export function recordAudit(
  context: AppContext,
  kind: string,
  id: string,
  operation: string,
): void {
  context.store.db
    .insert(auditRecords)
    .values({
      ...base(requireWorkspace(context).id),
      actorId: context.user?.id ?? null,
      action: kind + "." + operation,
      resource: id,
      data: {},
    })
    .run();
}
