import type { ServiceContext } from "../application";
import { ServiceError } from "./errors";

export function requireUser(ctx: ServiceContext) {
  if (!ctx.user) {
    throw new ServiceError("UNAUTHORIZED", "Authentication required.");
  }
  return ctx.user;
}
export function requireWorkspace(ctx: ServiceContext) {
  requireUser(ctx);
  if (!ctx.workspace) {
    throw new ServiceError("NOT_FOUND", "Unregistered workspace domain.");
  }
  if (!ctx.role) {
    throw new ServiceError(
      "FORBIDDEN",
      "You are not a member of this workspace.",
    );
  }
  return ctx.workspace;
}
export function requireManager(ctx: ServiceContext) {
  const workspace = requireWorkspace(ctx);
  if (!["owner", "admin"].includes(ctx.role!)) {
    throw new ServiceError(
      "FORBIDDEN",
      "Only workspace owners and admins can manage this workspace.",
    );
  }
  return workspace;
}
