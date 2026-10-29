import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { tableRows } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { recordAudit } from "./audit";

export function removeTableRow(context: ServiceContext, id: string): void {
  const workspaceId = requireWorkspace(context).id;
  inTransaction(context, (transaction) => {
    const deleted = transaction.db
      .delete(tableRows)
      .where(and(eq(tableRows.workspaceId, workspaceId), eq(tableRows.id, id)))
      .returning({ id: tableRows.id })
      .get();
    if (deleted) {
      recordAudit(transaction, "row", id, "deleted");
    }
  });
}
