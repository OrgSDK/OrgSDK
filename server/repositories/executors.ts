import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { executors } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function executorsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof executors.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(executors.workspaceId, workspaceId),
      id === undefined ? undefined : eq(executors.id, id),
      filter,
    );
  return {
    list(filter?: SQL) {
      return database
        .select()
        .from(executors)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(executors)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "executor", row.id, "created");
        return row;
      });
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(executors)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "executor", id, "updated");
        return row;
      });
    },
  };
}
