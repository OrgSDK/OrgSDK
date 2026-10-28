import { and, eq, type SQL } from "drizzle-orm";
import { conversations } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

export function conversationsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(conversations.workspaceId, workspaceId),
      id === undefined ? undefined : eq(conversations.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(conversations).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(conversations)
        .where(scoped(undefined, filter))
        .all();
    },
  };
}
