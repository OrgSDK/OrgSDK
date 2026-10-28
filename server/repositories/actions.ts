import { and, eq, type SQL } from "drizzle-orm";
import { actions } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function actionsRepository(context: AppContext) {
  type Create = Omit<
    typeof actions.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(actions.workspaceId, workspaceId),
      id === undefined ? undefined : eq(actions.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(actions).where(scoped(id)).get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(actions)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(actions)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "action", row.id, "created");
          return row;
        })
        .immediate();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(actions)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "action", id, "updated");
          return row;
        })
        .immediate();
    },
  };
}
