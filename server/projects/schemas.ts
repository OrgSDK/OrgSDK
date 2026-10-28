import { z } from "zod";
export const projectIdSchema = z.strictObject({ id: z.uuid() });
export const projectCreateSchema = z.strictObject({
  name: z.string().min(1).max(100),
  enabled: z.boolean().optional(),
  readable_tables: z.array(z.uuid()).optional(),
  writable_tables: z.array(z.uuid()).optional(),
  readable_documents: z.array(z.uuid()).optional(),
  writable_documents: z.array(z.uuid()).optional(),
});
export const projectChangesSchema = projectCreateSchema
  .partial()
  .extend({ id: z.uuid() });
export const projectExecutorSchema = projectIdSchema.extend({
  locally_managed: z.boolean().default(false),
});
