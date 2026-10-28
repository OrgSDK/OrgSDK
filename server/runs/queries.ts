import { memberships } from "../db/schema/core";
import { identityRepository } from "../repositories/identity";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { accessTokens, approvals, runEvents, runs } from "../db/schema";
import { isClient, workspace } from "../domain/permissions";
import { type ServiceContext } from "../application";
import { runsRepository } from "../repositories/runs";
import { approvalsRepository } from "../repositories/approvals";

export function visibleRuns(ctx: ServiceContext) {
  const grant = isClient(ctx)
    ? and(
        eq(runs.tokenId, ctx.token!.id),
        or(
          inArray(runs.projectId, ctx.token!.projects),
          inArray(runs.actionVersionId, ctx.token!.actionVersions),
        ),
      )
    : undefined;
  return ctx.db
    .select()
    .from(runs)
    .where(and(eq(runs.workspaceId, workspace(ctx)), grant))
    .orderBy(desc(runs.createdAt))
    .all();
}
export function runEventsFor(ctx: ServiceContext, id: string) {
  return ctx.db
    .select()
    .from(runEvents)
    .where(
      and(eq(runEvents.workspaceId, workspace(ctx)), eq(runEvents.runId, id)),
    )
    .orderBy(asc(runEvents.sequence))
    .all();
}

export function findIdempotentRun(
  ctx: ServiceContext,
  namespace: string,
  key: string,
) {
  return runsRepository(ctx).list(
    and(eq(runs.idempotencyNamespace, namespace), eq(runs.idempotencyKey, key)),
  )[0];
}

export function pendingRunApprovals(ctx: ServiceContext, runId: string) {
  return approvalsRepository(ctx).list(
    and(eq(approvals.runId, runId), eq(approvals.status, "pending")),
  );
}

export function runStreamIdentity(ctx: ServiceContext, workspaceId: number) {
  return {
    membership: ctx.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, ctx.user!.id),
        ),
      )
      .get(),
    session: ctx.sessionId
      ? identityRepository(ctx.db).session(ctx.sessionId)
      : undefined,
    token: ctx.token
      ? ctx.db
          .select()
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.id, ctx.token.id),
              eq(accessTokens.workspaceId, workspaceId),
            ),
          )
          .get()
      : undefined,
  };
}
