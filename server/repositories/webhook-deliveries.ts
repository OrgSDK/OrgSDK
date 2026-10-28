import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { webhookDeliveries } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { base } from "../shared/records";

export function webhookDeliveriesRepository(context: ServiceContext) {
  type Create = Omit<
    typeof webhookDeliveries.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(webhookDeliveries.workspaceId, workspaceId),
      id === undefined ? undefined : eq(webhookDeliveries.id, id),
      filter,
    );
  return {
    list(filter?: SQL) {
      return database
        .select()
        .from(webhookDeliveries)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(webhookDeliveries)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        return row;
      });
    },
  };
}
