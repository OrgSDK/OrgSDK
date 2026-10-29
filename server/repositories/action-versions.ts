import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { actionVersions } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { base } from "../shared/records";
import { recordAudit } from "./audit";

export function actionVersionsRepository(context: ServiceContext) {
  type Create = Omit<
    typeof actionVersions.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id: string) =>
    and(eq(actionVersions.workspaceId, workspaceId), eq(actionVersions.id, id));
  return {
    find(id: string) {
      const row = database
        .select()
        .from(actionVersions)
        .where(scoped(id))
        .get();
      if (!row) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      return row;
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(actionVersions)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "action.version", row.id, "created");
        return row;
      });
    },
  };
}
