import { and, eq, type SQL } from "drizzle-orm";
import { executors } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function executorsRepository(context: AppContext) {
  type Create = Omit<
    typeof executors.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(executors.workspaceId, workspaceId),
      id === undefined ? undefined : eq(executors.id, id),
      filter,
    );
  return {
    list(filter?: SQL) {
      return database
        .select()
        .from(executors)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .insert(executors)
            .values({ ...data, ...base(workspaceId) })
            .returning()
            .get();
          recordAudit(context, "executor", row.id, "created");
          return row;
        })
        .immediate();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(executors)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "executor", id, "updated");
          return row;
        })
        .immediate();
    },
  };
}
