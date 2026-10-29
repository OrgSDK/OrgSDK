import { z } from "zod";
export const webhookCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    action: z.uuid(),
    enabled: z.boolean().optional(),
  })
  .strict();
export const webhookUpdateSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type CreateWebhook = z.infer<typeof webhookCreateSchema>;
export type UpdateWebhook = z.infer<typeof webhookUpdateSchema>;
