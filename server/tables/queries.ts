import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { tableRows } from "../db/schema";

export function tableQueries(database: AppDatabase, workspaceId: number) {
  return {
    rowsForTable(tableId: string) {
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
    },
  };
}
