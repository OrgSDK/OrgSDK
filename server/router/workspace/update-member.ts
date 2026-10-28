import { browserOwnerProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { ServiceError } from "../../shared/errors";
import { setMembershipRole, memberRow } from "../../workspaces/queries";
import { memberPair, requireMutableMember } from "../../workspaces/permissions";
import { memberUpdateSchema } from "../../workspaces/schemas";
export const updateMemberProcedure = browserOwnerProcedure
  .input(memberUpdateSchema)
  .mutation(({ ctx, input }) => {
    const id = input.id;
    const role = input.role;
    return inTransaction(ctx, (ctx) => {
      const { actor, target } = memberPair(ctx, id);
      requireMutableMember(target);
      if (actor.role !== "owner") {
        throw new ServiceError("FORBIDDEN", "Only the owner can change roles.");
      }
      setMembershipRole(ctx.db, target.workspaceId, id, role);
      const updated = memberRow(ctx.db, target.workspaceId, id);
      if (!updated) {
        throw new ServiceError("NOT_FOUND", "Member not found.");
      }
      return updated;
    });
  });
