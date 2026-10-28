import { and, eq, type SQL } from "drizzle-orm";
import { actionTestSuites } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { type ServiceContext } from "../application";

export function actionTestSuitesRepository(context: ServiceContext) {
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
  };
}
