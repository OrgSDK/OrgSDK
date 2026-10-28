import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { runs } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base, now } from "../shared/records";
import { recordAudit } from "./audit";

export function runsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof runs.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id: string) =>
    and(eq(runs.workspaceId, workspaceId), eq(runs.id, id));
  return {
    find(id: string) {
      const row = database.select().from(runs).where(scoped(id)).get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(runs)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "run", row.id, "created");
        return row;
      });
    },
    update(id: string, data: Partial<Create>) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .update(runs)
          .set({ ...data, updatedAt: now() })
          .where(scoped(id))
          .returning()
          .all()[0];
        if (!row) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(context, "run", id, "updated");
        return row;
      });
    },
  };
}
