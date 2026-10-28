import { browserWorkspaceProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { ServiceError } from "../../shared/errors";
import { and, eq } from "drizzle-orm";
import { memberships } from "../../db/schema/core";
import { memberPair, requireMutableMember } from "../../workspaces/permissions";
import { membershipIdSchema } from "../../workspaces/schemas";
export const removeMemberProcedure = browserWorkspaceProcedure
  .input(membershipIdSchema)
  .mutation(({ ctx, input }) => {
    const id = input.id;
    inTransaction(ctx, (ctx) => {
      const { actor, target, user } = memberPair(ctx, id);
      requireMutableMember(target);
      if (
        target.userId !== user.id &&
        (!["owner", "admin"].includes(actor.role) ||
          (actor.role === "admin" && target.role !== "member"))
      ) {
        throw new ServiceError(
          "FORBIDDEN",
          "Only the owner can manage admins.",
        );
      }
      ctx.db
        .delete(memberships)
        .where(
          and(
            eq(memberships.workspaceId, target.workspaceId),
            eq(memberships.id, id),
          ),
        )
        .run();
    });
    return { removed: true };
  });
