import { browserManagerProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { assertCurrentUser } from "../../auth/sessions";
import { ServiceError } from "../../shared/errors";
import { revokeUnsentMail } from "../../repositories/mail-outbox";
import { now } from "../../shared/records";
import {
  membershipForUser,
  invitationById,
  updateInvitation,
} from "../../workspaces/queries";
import { membershipIdSchema } from "../../workspaces/schemas";
export const revokeInvitationProcedure = browserManagerProcedure
  .input(membershipIdSchema)
  .mutation(({ ctx, input }) => {
    const id = input.id;
    const user = ctx.user;
    const workspace = ctx.workspace;
    inTransaction(ctx, (ctx) => {
      assertCurrentUser(ctx, user);
      const actor = membershipForUser(ctx.db, workspace.id, user.id);
      if (!actor || !["owner", "admin"].includes(actor.role)) {
        throw new ServiceError(
          "FORBIDDEN",
          "Only workspace owners and admins can manage invitations.",
        );
      }
      const invitation = invitationById(ctx.db, workspace.id, id);
      if (!invitation) {
        throw new ServiceError("NOT_FOUND", "Invitation not found.");
      }
      if (actor.role !== "owner" && invitation.role === "admin") {
        throw new ServiceError(
          "FORBIDDEN",
          "Only the owner can revoke admin invitations.",
        );
      }
      updateInvitation(ctx.db, workspace.id, invitation.id, {
        revokedAt: now(),
      });
      revokeUnsentMail(ctx, "invitation:" + invitation.id);
    });
    return { revoked: true };
  });
