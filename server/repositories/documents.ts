import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { documents } from "../db/schema";
import { ServiceError } from "../shared/errors";

export function findDocument(
  database: AppDatabase,
  workspaceId: number,
  id: string,
) {
  const record = database
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)))
    .get();
  if (!record) {
    throw new ServiceError("NOT_FOUND", "Not found.");
  }
  return record;
}
