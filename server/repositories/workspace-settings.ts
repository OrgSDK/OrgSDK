import { and, eq, type SQL } from "drizzle-orm";
import { workspaceSettings } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";

export function workspaceSettingsRepository(context: AppContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(workspaceSettings.workspaceId, workspaceId),
      id === undefined ? undefined : eq(workspaceSettings.id, id),
      filter,
    );
  return {
    list(filter?: SQL) {
      return database
        .select()
        .from(workspaceSettings)
        .where(scoped(undefined, filter))
        .all();
    },
  };
}
