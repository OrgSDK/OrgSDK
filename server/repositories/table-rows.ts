import { and, eq, type SQL } from "drizzle-orm";
import { tableRows } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function tableRowsRepository(context: AppContext) {
  type Create = Omit<
    typeof tableRows.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(tableRows.workspaceId, workspaceId),
      id === undefined ? undefined : eq(tableRows.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(tableRows).where(scoped(id)).get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(tableRows)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(tableRows)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "row", row.id, "created");
          return row;
        })
        .immediate();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(tableRows)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "row", id, "updated");
          return row;
        })
        .immediate();
    },
    remove(id: string): void {
      context.store.sqlite
        .transaction(() => {
          const deleted = database
            .delete(tableRows)
            .where(scoped(id))
            .returning({ id: tableRows.id })
            .get();
          if (deleted) recordAudit(context, "row", id, "deleted");
        })
        .immediate();
    },
  };
}
