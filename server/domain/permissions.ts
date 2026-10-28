import type { AppContext } from "../http/context";
import { requireManager, requireWorkspace } from "../http/context";
import { HttpError } from "../http/responses";
export const tx = <T>(ctx: AppContext, fn: () => T) =>
  ctx.store.sqlite.transaction(fn).immediate();

export function workspace(ctx: AppContext) {
  return requireWorkspace(ctx).id;
}

export function isClient(ctx: AppContext) {
  return !!ctx.token && ctx.token.scopes.some((s: string) => s.includes(":"));
}

export function scope(ctx: AppContext, required: string) {
  if (!ctx.token) return;
  const legacyNeeded = ["catalog:read", "runs:read"].includes(required)
    ? "read"
    : "write";
  if (
    ctx.token.revoked ||
    (isClient(ctx)
      ? !ctx.token.scopes.includes(required)
      : !ctx.token.scopes.includes(legacyNeeded) || required === "actions:test")
  )
    throw new HttpError(403, "Client scope does not permit this operation.");
}

export function browser(ctx: AppContext, manager = false) {
  if (isClient(ctx))
    throw new HttpError(403, "This operation requires a browser session.");
  if (ctx.token) {
    const required = ["GET", "HEAD", "OPTIONS"].includes(ctx.request.method)
      ? "read"
      : "write";
    if (!ctx.token.scopes.includes(required))
      throw new HttpError(403, "Token scope does not permit this operation.");
  }
  if (manager) requireManager(ctx);
  else requireWorkspace(ctx);
}

export function projectGrant(ctx: AppContext, id: string) {
  if (ctx.token && !ctx.token.projects.includes(id))
    throw new HttpError(403, "Project is outside the client grant.");
}

export function authorizeVersion(
  ctx: AppContext,
  action: any,
  version: any,
  explicit: boolean,
) {
  if (!ctx.token || !isClient(ctx)) return;
  if (ctx.token.projects.includes(action.projectId)) return;
  if (explicit && ctx.token.actionVersions.includes(version.id)) return;
  throw new HttpError(
    403,
    "Client requires an explicit granted action version.",
  );
}

export function authoringGrant(ctx: AppContext, id: string) {
  if (isClient(ctx)) projectGrant(ctx, id);
}

export function authorizeRunRead(
  ctx: AppContext,
  run: any,
  requestedScope: string | null = "runs:read",
) {
  if (requestedScope) scope(ctx, requestedScope);
  if (
    isClient(ctx) &&
    ctx.token &&
    (run.tokenId !== ctx.token.id ||
      !(
        ctx.token.projects.includes(run.projectId) ||
        (run.actionVersionId &&
          ctx.token.actionVersions.includes(run.actionVersionId))
      ))
  )
    throw new HttpError(404, "Not found.");
}
