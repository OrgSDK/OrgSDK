import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { workspaceTables } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function workspaceTablesRepository(context: ServiceContext) {
  type Create = Omit<
    typeof workspaceTables.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(workspaceTables.workspaceId, workspaceId),
      id === undefined ? undefined : eq(workspaceTables.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database
        .select()
        .from(workspaceTables)
        .where(scoped(id))
        .get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(workspaceTables)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(workspaceTables)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "table", row.id, "created");
        return row;
      });
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(workspaceTables)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "table", id, "updated");
        return row;
      });
    },
    remove(id: string): void {
      inTransaction(context, (context) => {
        const database = context.db;

        const deleted = database
          .delete(workspaceTables)
          .where(scoped(id))
          .returning({ id: workspaceTables.id })
          .get();
        if (deleted) {
          recordAudit(context, "table", id, "deleted");
        }
      });
    },
  };
}
