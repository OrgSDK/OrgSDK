import { and, eq, type SQL } from "drizzle-orm";
import { artifacts } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

export function artifactsRepository(context: ServiceContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(artifacts.workspaceId, workspaceId),
      id === undefined ? undefined : eq(artifacts.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(artifacts).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(artifacts)
        .where(scoped(undefined, filter))
        .all();
    },
  };
}
