import { z } from "zod";
export const oauthConnectSchema = z.strictObject({
  plugin: z.uuid(),
  name: z.string().trim().min(1).max(100),
  client_id: z.string().trim().min(1).max(500),
  client_secret: z.string().trim().min(1).max(2000),
});
export const oauthCallbackSchema = z.object({
  state: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
});
export type OAuthCallbackInput = z.output<typeof oauthCallbackSchema>;
