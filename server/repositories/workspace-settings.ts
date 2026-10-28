import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { workspaceSettings } from "../db/schema";

export function workspaceSettingsForWorkspace(
  database: AppDatabase,
  workspaceId: number,
) {
  return database
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .get();
}
