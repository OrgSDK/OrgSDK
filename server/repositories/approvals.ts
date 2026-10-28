import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { approvals } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { now } from "../shared/records";
import { recordAudit } from "./audit";

export function approvalsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof approvals.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id: string) =>
    and(eq(approvals.workspaceId, workspaceId), eq(approvals.id, id));
  return {
    find(id: string) {
      const row = database.select().from(approvals).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(approvals)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "approval", id, "updated");
        return row;
      });
    },
  };
}
