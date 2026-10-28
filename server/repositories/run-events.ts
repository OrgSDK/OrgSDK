import { and, eq, type SQL } from "drizzle-orm";
import { runEvents } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";

export function runEventsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
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
