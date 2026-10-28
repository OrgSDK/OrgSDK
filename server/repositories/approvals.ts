import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
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
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(approvals.workspaceId, workspaceId),
      id === undefined ? undefined : eq(approvals.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(approvals).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(approvals)
        .where(scoped(undefined, filter))
        .all();
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
