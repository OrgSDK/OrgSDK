import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { actions } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base } from "../shared/records";
import { recordAudit } from "./audit";

export function actionsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof actions.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(actions.workspaceId, workspaceId),
      id === undefined ? undefined : eq(actions.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(actions).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(actions)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(actions)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "action", row.id, "created");
        return row;
      });
    },
  };
}
