import { and, eq, type SQL } from "drizzle-orm";
import { actionVersions } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base } from "../shared/records";
import { recordAudit } from "./audit";

export function actionVersionsRepository(context: AppContext) {
  type Create = Omit<
    typeof actionVersions.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(actionVersions.workspaceId, workspaceId),
      id === undefined ? undefined : eq(actionVersions.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database
        .select()
        .from(actionVersions)
        .where(scoped(id))
        .get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(actionVersions)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(actionVersions)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "action.version", row.id, "created");
          return row;
        })
        .immediate();
    },
  };
}
