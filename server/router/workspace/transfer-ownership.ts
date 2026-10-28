import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { ServiceError } from "../../shared/errors";
import { setMembershipRole } from "../../workspaces/queries";
import { memberPair } from "../../workspaces/permissions";
import { ownershipSchema } from "../../workspaces/schemas";
export const transferOwnershipProcedure = browserProcedure
  .input(ownershipSchema)
  .mutation(({ ctx, input }) => {
    const id = input.membership_id;
    inTransaction(ctx, (ctx) => {
      const { actor, target } = memberPair(ctx, id);
      if (actor.role !== "owner") {
        throw new ServiceError(
          "FORBIDDEN",
          "Only the owner can transfer ownership.",
        );
      }
      if (target.id === actor.id) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Select another member as owner.",
        );
      }
      setMembershipRole(ctx.db, target.workspaceId, actor.id, "admin");
      setMembershipRole(ctx.db, target.workspaceId, target.id, "owner");
    });
    return { transferred: true };
  });
