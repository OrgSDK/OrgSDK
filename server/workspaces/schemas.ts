import { z } from "zod";
import { emailSchema } from "../auth/schemas";
export const membershipIdSchema = z.strictObject({
  id: z.number().int().positive(),
});
export const workspaceNameSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});
export const roleSchema = z.enum(["admin", "member"]);
export const memberUpdateSchema = membershipIdSchema.extend({
  role: roleSchema,
});
export const ownershipSchema = z.strictObject({
  membership_id: z.number().int().positive(),
});
export const invitationSchema = z.strictObject({
  email: emailSchema,
  role: roleSchema,
});
export const invitationTokenSchema = z.strictObject({
  token: z.string().min(1),
});
