import { and, eq, type SQL } from "drizzle-orm";
import { runEvents } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";

export function runEventsRepository(context: AppContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(runEvents.workspaceId, workspaceId),
      id === undefined ? undefined : eq(runEvents.id, id),
      filter,
    );
  return {
    list(filter?: SQL) {
      return database
        .select()
        .from(runEvents)
        .where(scoped(undefined, filter))
        .all();
    },
  };
}
