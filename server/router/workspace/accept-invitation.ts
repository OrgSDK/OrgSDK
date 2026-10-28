import { authenticatedBrowserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { assertCurrentUser } from "../../auth/sessions";
import { ServiceError } from "../../shared/errors";
import { now } from "../../shared/records";
import { digest } from "../../shared/security";
import {
  invitationByToken,
  membershipForUser,
  createMembership,
  updateInvitation,
} from "../../workspaces/queries";
import { invitationTokenSchema } from "../../workspaces/schemas";
export const acceptInvitationProcedure = authenticatedBrowserProcedure
  .input(invitationTokenSchema)
  .mutation(({ ctx, input }) => {
    const token = input.token;
    const user = ctx.user;
    return inTransaction(ctx, (ctx) => {
      const db = ctx.db;
      assertCurrentUser(ctx, user);

      const invite = ctx.workspace
        ? invitationByToken(db, ctx.workspace.id, digest(token))
        : undefined;
      if (
        !invite ||
        !ctx.workspace ||
        invite.workspaceId !== ctx.workspace.id
      ) {
        throw new ServiceError("NOT_FOUND", "Invitation not found.");
      }
      if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new ServiceError(
          "FORBIDDEN",
          "Sign in with the invited email address.",
        );
      }
      if (invite.revokedAt || invite.expiresAt <= now()) {
        throw new ServiceError(
          "BAD_REQUEST",
          "This invitation has expired or was revoked.",
        );
      }
      const existing = membershipForUser(db, invite.workspaceId, user.id);
      if (invite.acceptedAt && !existing) {
        throw new ServiceError(
          "BAD_REQUEST",
          "This invitation has already been used.",
        );
      }
      if (!existing) {
        createMembership(db, {
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
        });
      }
      if (!invite.acceptedAt) {
        updateInvitation(db, invite.workspaceId, invite.id, {
          acceptedAt: now(),
        });
      }
      return { id: ctx.workspace.id, name: ctx.workspace.name };
    });
  });
