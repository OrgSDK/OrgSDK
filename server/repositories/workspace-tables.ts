import { and, eq, type SQL } from "drizzle-orm";
import { workspaceTables } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function workspaceTablesRepository(context: AppContext) {
  type Create = Omit<
    typeof workspaceTables.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(workspaceTables.workspaceId, workspaceId),
      id === undefined ? undefined : eq(workspaceTables.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database
        .select()
        .from(workspaceTables)
        .where(scoped(id))
        .get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(workspaceTables)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(workspaceTables)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "table", row.id, "created");
          return row;
        })
        .immediate();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(workspaceTables)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "table", id, "updated");
          return row;
        })
        .immediate();
    },
    remove(id: string): void {
      context.store.sqlite
        .transaction(() => {
          const deleted = database
            .delete(workspaceTables)
            .where(scoped(id))
            .returning({ id: workspaceTables.id })
            .get();
          if (deleted) recordAudit(context, "table", id, "deleted");
        })
        .immediate();
    },
  };
}
