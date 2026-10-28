import { and, eq, type SQL } from "drizzle-orm";
import { workspaceSettings } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";

export function workspaceSettingsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
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
