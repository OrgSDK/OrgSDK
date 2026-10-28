import { and, eq, type SQL } from "drizzle-orm";
import { documents } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function documentsRepository(context: AppContext) {
  type Create = Omit<
    typeof documents.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(documents.workspaceId, workspaceId),
      id === undefined ? undefined : eq(documents.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(documents).where(scoped(id)).get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(documents)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(documents)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "document", row.id, "created");
          return row;
        })
        .immediate();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(documents)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "document", id, "updated");
          return row;
        })
        .immediate();
    },
    remove(id: string): void {
      context.store.sqlite
        .transaction(() => {
          const deleted = database
            .delete(documents)
            .where(scoped(id))
            .returning({ id: documents.id })
            .get();
          if (deleted) recordAudit(context, "document", id, "deleted");
        })
        .immediate();
    },
  };
}
