import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { webhooks } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { now } from "../shared/records";
import { recordAudit } from "./audit";

export function webhooksRepository(context: ServiceContext) {
  type Create = Omit<
    typeof webhooks.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id: string) =>
    and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.id, id));
  return {
    find(id: string) {
      const row = database.select().from(webhooks).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(webhooks)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "webhook", id, "updated");
        return row;
      });
    },
  };
}
