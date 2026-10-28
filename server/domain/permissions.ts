import type { actions, actionVersions, runs } from "../db/schema";
import { type ServiceContext } from "../application";
import { requireManager, requireWorkspace } from "../shared/authorization";
import { ServiceError } from "../shared/errors";
export { inTransaction as tx } from "../db/transaction";

export function workspace(ctx: ServiceContext) {
  return requireWorkspace(ctx).id;
}

export function isClient(ctx: ServiceContext) {
  return ctx.token !== null;
}

export function scope(ctx: ServiceContext, required: string) {
  if (
    ctx.token &&
    (ctx.token.revoked || !ctx.token.scopes.includes(required))
  ) {
    throw new ServiceError(
      "FORBIDDEN",
      "Client scope does not permit this operation.",
    );
  }
}

export function browser(ctx: ServiceContext, manager = false) {
  if (ctx.token) {
    throw new ServiceError(
      "FORBIDDEN",
      "This operation requires a browser session.",
    );
  }
  if (manager) {
    requireManager(ctx);
    return;
  }
  requireWorkspace(ctx);
}

export function projectGrant(ctx: ServiceContext, id: string) {
  if (ctx.token && !ctx.token.projects.includes(id)) {
    throw new ServiceError("FORBIDDEN", "Project is outside the client grant.");
  }
}

export function authorizeVersion(
  ctx: ServiceContext,
  action: typeof actions.$inferSelect,
  version: typeof actionVersions.$inferSelect,
  explicit: boolean,
) {
  if (!ctx.token || !isClient(ctx)) {
    return;
  }
  if (ctx.token.projects.includes(action.projectId)) {
    return;
  }
  if (explicit && ctx.token.actionVersions.includes(version.id)) {
    return;
  }
  throw new ServiceError(
    "FORBIDDEN",
    "Client requires an explicit granted action version.",
  );
}

export function authoringGrant(ctx: ServiceContext, id: string) {
  if (isClient(ctx)) {
    projectGrant(ctx, id);
  }
}

export function authorizeRunRead(
  ctx: ServiceContext,
  run: typeof runs.$inferSelect,
  requestedScope: string | null = "runs:read",
) {
  if (requestedScope) {
    scope(ctx, requestedScope);
  }
  if (
    isClient(ctx) &&
    ctx.token &&
    (run.tokenId !== ctx.token.id ||
      !(
        ctx.token.projects.includes(run.projectId) ||
        (run.actionVersionId &&
          ctx.token.actionVersions.includes(run.actionVersionId))
      ))
  ) {
    throw new ServiceError("NOT_FOUND", "Not found.");
  }
}
