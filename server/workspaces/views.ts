import { type invitations } from "../db/schema/core";
export const serializeInvite = (v: typeof invitations.$inferSelect) => ({
  id: v.id,
  email: v.email,
  role: v.role,
  expires_at: v.expiresAt,
  accepted_at: v.acceptedAt,
  revoked_at: v.revokedAt,
});
