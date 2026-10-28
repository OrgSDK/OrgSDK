import { and, eq, type SQL } from "drizzle-orm";
import { approvals } from "../db/schema";
import { requireWorkspace, type AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { now } from "../shared/records";
import { recordAudit } from "./audit";

export function approvalsRepository(context: AppContext) {
  type Create = Omit<
    typeof approvals.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.store.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(approvals.workspaceId, workspaceId),
      id === undefined ? undefined : eq(approvals.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(approvals).where(scoped(id)).get();
      if (!row) throw new HttpError(404, "Not found.");
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(approvals)
        .where(scoped(undefined, filter))
        .all();
    },
    update(id: string, data: Partial<Create>) {
      return context.store.sqlite
        .transaction(() => {
          const row = database
            .update(approvals)
            .set({ ...data, updatedAt: now() })
            .where(scoped(id))
            .returning()
            .all()[0];
          if (!row) throw new HttpError(404, "Not found.");
          recordAudit(context, "approval", id, "updated");
          return row;
        })
        .immediate();
    },
  };
}
