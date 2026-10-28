import { and, eq, type SQL } from "drizzle-orm";
import { webhookDeliveries } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { base } from "../shared/records";

export function webhookDeliveriesRepository(context: AppContext) {
  type Create = Omit<
    typeof webhookDeliveries.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
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
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(webhookDeliveries)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          return row;
        })
        .immediate();
    },
  };
}
