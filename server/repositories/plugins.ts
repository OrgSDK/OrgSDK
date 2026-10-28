import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { plugins } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function pluginsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof plugins.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(plugins.workspaceId, workspaceId),
      id === undefined ? undefined : eq(plugins.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(plugins).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(plugins)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(plugins)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "plugin", row.id, "created");
        return row;
      });
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(plugins)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "plugin", id, "updated");
        return row;
      });
    },
    remove(id: string): void {
      inTransaction(context, (context) => {
        const database = context.db;

        const deleted = database
          .delete(plugins)
          .where(scoped(id))
          .returning({ id: plugins.id })
          .get();
        if (deleted) {
          recordAudit(context, "plugin", id, "deleted");
        }
      });
    },
  };
}
