import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { workspaceTables } from "../db/schema";
import { ServiceError } from "../shared/errors";

export function findWorkspaceTable(
  database: AppDatabase,
  workspaceId: number,
  id: string,
) {
  const record = database
    .select()
    .from(workspaceTables)
    .where(
      and(
        eq(workspaceTables.workspaceId, workspaceId),
        eq(workspaceTables.id, id),
      ),
    )
    .get();
  if (!record) {
    throw new ServiceError("NOT_FOUND", "Not found.");
  }
  return record;
}
