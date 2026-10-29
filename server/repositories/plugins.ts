import { and, eq, type SQL } from "drizzle-orm";
import { plugins } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

export function pluginsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(plugins.workspaceId, workspaceId),
      id === undefined ? undefined : eq(plugins.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(plugins).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(plugins)
        .where(scoped(undefined, filter))
        .all();
    },
  };
}
