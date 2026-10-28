import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { actions, actionVersions } from "../db/schema";
import { isClient, workspace } from "../domain/permissions";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";

function actionGrant(ctx: ServiceContext): SQL | undefined {
  if (!isClient(ctx)) {
    return undefined;
  }
  const token = ctx.token!;
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
export function visibleActions(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(actions)
    .where(and(eq(actions.workspaceId, workspace(ctx)), actionGrant(ctx)))
    .all();
}
export function visibleAction(ctx: ServiceContext, id: string) {
  const action = ctx.db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.workspaceId, workspace(ctx)),
        eq(actions.id, id),
        actionGrant(ctx),
      ),
    )
    .get();
  if (!action) {
    throw new ServiceError("NOT_FOUND", "Not found.");
  }
  return action;
}
export function visibleVersions(
  ctx: ServiceContext,
  action: typeof actions.$inferSelect,
) {
  const limitedToVersionGrants =
    isClient(ctx) && !ctx.token!.projects.includes(action.projectId);
  return ctx.db
    .select()
    .from(actionVersions)
    .where(
      and(
        eq(actionVersions.workspaceId, workspace(ctx)),
        eq(actionVersions.actionId, action.id),
        limitedToVersionGrants
          ? inArray(actionVersions.id, ctx.token!.actionVersions)
          : undefined,
      ),
    )
    .orderBy(desc(actionVersions.number))
    .all();
}
