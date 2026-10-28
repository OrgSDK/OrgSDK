import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { actions, actionVersions } from "../db/schema";
import { workspace } from "../domain/permissions";
import { type ServiceContext } from "../application";

export function actionGrant(ctx: ServiceContext): SQL | undefined {
  const token = ctx.token;
  if (!token) {
    return undefined;
  }
  const grantedActions = ctx.db
    .select({ id: actionVersions.actionId })
    .from(actionVersions)
    .where(
      and(
        eq(actionVersions.workspaceId, workspace(ctx)),
        inArray(actionVersions.id, token.actionVersions),
      ),
    );
  return or(
    inArray(actions.projectId, token.projects),
    inArray(actions.id, grantedActions),
  );
}
