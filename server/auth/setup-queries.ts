import type { AppDatabase } from "../db/database";
import { projects, workspaceSettings } from "../db/schema";
export function insertInitialProject(
  database: AppDatabase,
  values: typeof projects.$inferInsert,
): void {
  database.insert(projects).values(values).run();
}
export function insertExecutionSettings(
  database: AppDatabase,
  values: typeof workspaceSettings.$inferInsert,
): void {
  database.insert(workspaceSettings).values(values).run();
}
