import { inTransaction } from "../db/transaction";
import { and, eq, type SQL } from "drizzle-orm";
import { actionTestSuites } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";
import { base } from "../shared/records";
import { recordAudit } from "./audit";

export function actionTestSuitesRepository(context: ServiceContext) {
  type Create = Omit<
    typeof actionTestSuites.$inferInsert,
    "id" | "workspaceId" | "createdAt" | "updatedAt"
  >;
  const workspaceId = requireWorkspace(context).id;
  const database = context.db;
  const scoped = (id?: string, filter?: SQL) =>
    and(
      eq(actionTestSuites.workspaceId, workspaceId),
      id === undefined ? undefined : eq(actionTestSuites.id, id),
      filter,
    );
  return {
    list(filter?: SQL) {
      return database
        .select()
        .from(actionTestSuites)
        .where(scoped(undefined, filter))
        .all();
    },
    create(data: Create) {
      return inTransaction(context, (context) => {
        const database = context.db;

        const row = database
          .insert(actionTestSuites)
          .values({ ...data, ...base(workspaceId) })
          .returning()
          .get();
        recordAudit(context, "action.tests", row.id, "created");
        return row;
      });
    },
  };
}
