import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { tableRows } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function tableRowsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof tableRows.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(tableRows.workspaceId, workspaceId),
      id === undefined ? undefined : eq(tableRows.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(tableRows).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(tableRows)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(tableRows)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "row", row.id, "created");
        return row;
      });
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(tableRows)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "row", id, "updated");
        return row;
      });
    },
    remove(id: string): void {
      inTransaction(context, (context) => {
        const database = context.db;

        const deleted = database
          .delete(tableRows)
          .where(scoped(id))
          .returning({ id: tableRows.id })
          .get();
        if (deleted) {
          recordAudit(context, "row", id, "deleted");
        }
      });
    },
  };
}
