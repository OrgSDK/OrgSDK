import type { ServiceContext } from "../application";
import { assertCurrentUser } from "../auth/sessions";
import type { memberships } from "../db/schema/core";
import { ServiceError } from "../shared/errors";
import { membershipById, membershipForUser } from "./queries";
export function memberPair(
  ctx: ServiceContext & {
    user: NonNullable<ServiceContext["user"]>;
    workspace: NonNullable<ServiceContext["workspace"]>;
  },
  id: number,
) {
  const { user, workspace } = ctx;
  assertCurrentUser(ctx, user);
  const actor = membershipForUser(ctx.db, workspace.id, user.id);
  const target = membershipById(ctx.db, workspace.id, id);
  if (!actor || !target) {
    throw new ServiceError("NOT_FOUND", "Member not found.");
  }
  return { actor, target, user };
}
export function requireMutableMember(target: typeof memberships.$inferSelect) {
  if (target.role === "owner") {
    throw new ServiceError(
      "BAD_REQUEST",
      "Transfer ownership before removing or changing the owner.",
    );
  }
}
