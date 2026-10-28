import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { tableRows } from "../db/schema";
import { ServiceError } from "../shared/errors";
export function rowInTable(
  database: AppDatabase,
  workspaceId: number,
  tableId: string,
  rowId: string,
) {
  const row = database
    .select()
    .from(tableRows)
    .where(
      and(
        eq(tableRows.workspaceId, workspaceId),
        eq(tableRows.tableId, tableId),
        eq(tableRows.id, rowId),
      ),
    )
    .get();
  if (!row) {
    throw new ServiceError("NOT_FOUND", "Not found.");
  }
  return row;
}
