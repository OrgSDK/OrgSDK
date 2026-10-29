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
  const workspaceId = requireWorkspace(context).id;
  context.db
    .insert(auditRecords)
    .values({
      ...base(workspaceId),
      actorId: context.user?.id ?? null,
      action: kind + "." + operation,
      resource: id,
      data: {},
    })
    .run();
}
