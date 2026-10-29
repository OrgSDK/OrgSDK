import { type invitations } from "../db/schema/core";
export const serializeInvite = (
  invitation: typeof invitations.$inferSelect,
) => ({
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  expires_at: invitation.expiresAt,
  accepted_at: invitation.acceptedAt,
  revoked_at: invitation.revokedAt,
});
