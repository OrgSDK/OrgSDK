import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { tableRows } from "../db/schema";

export function rowsForTable(
  database: AppDatabase,
  workspaceId: number,
  tableId: string,
) {
  return database
    .select()
    .from(tableRows)
    .where(
      and(
        eq(tableRows.workspaceId, workspaceId),
        eq(tableRows.tableId, tableId),
      ),
    )
    .all();
}
