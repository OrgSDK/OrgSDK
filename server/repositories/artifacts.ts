import { and, eq, type SQL } from "drizzle-orm";
import { artifacts } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";

export function artifactsRepository(context: AppContext) {
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(artifacts.workspaceId, workspaceId),
      id === undefined ? undefined : eq(artifacts.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(artifacts).where(scoped(id)).get();
      if (!row) throw new HttpError(404, "Not found.");
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
