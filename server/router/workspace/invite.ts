import { browserManagerProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { randomUUID } from "node:crypto";
import { assertCurrentUser } from "../../auth/sessions";
import { ServiceError } from "../../shared/errors";
import { smtpConfigured } from "../../mail/outbox";
import { enqueueMail } from "../../repositories/mail-outbox";
import { now } from "../../shared/records";
import { digest, encrypt } from "../../shared/security";
import {
  hasMemberEmail,
  pendingInvitationsByEmail,
  membershipForUser,
  updateInvitation,
  createInvitation,
} from "../../workspaces/queries";
import { serializeInvite } from "../../workspaces/views";
import { invitationSchema } from "../../workspaces/schemas";
export const inviteProcedure = browserManagerProcedure
  .input(invitationSchema)
  .mutation(({ ctx, input }) => {
    const user = ctx.user;
    const workspace = ctx.workspace;
    if (!smtpConfigured()) {
      throw new ServiceError(
        "PRECONDITION_FAILED",
        "Invitation delivery is not configured.",
      );
    }
    const email = input.email.trim().toLowerCase();
    const role = input.role;
    const token = randomUUID();
    const timestamp = now();
    const url = new URL("/workspaces/invite/", ctx.origin);
    url.searchParams.set("token", token);
    const message = encrypt(
      ctx,
      `You have been invited to ${workspace.name} as ${input.role}.\nSign in with ${email} and accept: ${url}\nThis invitation expires in seven days.`,
    );
    return inTransaction(ctx, (ctx) => {
      const db = ctx.db;

      assertCurrentUser(ctx, user);
      const actor = membershipForUser(ctx.db, workspace.id, user.id);
      if (!actor || !["owner", "admin"].includes(actor.role)) {
        throw new ServiceError(
          "FORBIDDEN",
          "Only workspace owners and admins can invite members.",
        );
      }
      if (actor.role !== "owner" && input.role === "admin") {
        throw new ServiceError(
          "FORBIDDEN",
          "Only the owner can invite admins.",
        );
      }
      if (hasMemberEmail(db, workspace.id, email)) {
        throw new ServiceError(
          "BAD_REQUEST",
          "This email already belongs to a workspace member.",
        );
      }
      const prior = pendingInvitationsByEmail(db, workspace.id, email);
      for (const invite of prior) {
        if (invite.expiresAt > timestamp) {
          throw new ServiceError(
            "BAD_REQUEST",
            "A pending invitation already exists.",
          );
        }
        updateInvitation(ctx.db, workspace.id, invite.id, {
          revokedAt: timestamp,
        });
      }
      const invite = createInvitation(db, {
        workspaceId: workspace.id,
        email,
        role,
        tokenDigest: digest(token),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      enqueueMail(ctx, {
        id: "invitation:" + invite.id,
        recipient: email,
        subject: "Invitation to " + workspace.name,
        body: message,
      });
      return serializeInvite(invite);
    });
  });
