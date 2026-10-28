import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { tableRows } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { recordAudit } from "./audit";

export function tableRowsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id: string) =>
    and(eq(tableRows.workspaceId, workspaceId), eq(tableRows.id, id));
  return {
    find(id: string) {
      const row = database.select().from(tableRows).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
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
