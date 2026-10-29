import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { projects } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { now } from "../shared/records";
import { recordAudit } from "./audit";

export function projectsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof projects.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(projects.workspaceId, workspaceId),
      id === undefined ? undefined : eq(projects.id, id),
      filter,
    );
  return {
    find(id: string) {
      const row = database.select().from(projects).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    list(filter?: SQL) {
      return database
        .select()
        .from(projects)
        .where(scoped(undefined, filter))
        .all();
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(projects)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "project", id, "updated");
        return row;
      });
    },
  };
}
