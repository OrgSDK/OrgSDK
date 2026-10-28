import { z } from "zod";
export const pluginIdSchema = z.strictObject({ id: z.uuid() });
export const pluginCreateSchema = z.strictObject({
  project: z.uuid(),
  slug: z.string(),
  version: z.string(),
  description: z.string().optional(),
  source: z.string().optional(),
  distribution: z.enum(["inline", "external"]).optional(),
  credential: z.uuid().nullable().optional(),
  configuration: z.json().optional(),
  enabled: z.boolean().optional(),
});
export const pluginChangesSchema = pluginCreateSchema
  .omit({ slug: true })
  .partial()
  .extend({ id: z.uuid(), refresh_bundle: z.boolean().optional() });

export type UpdatePlugin = Omit<z.output<typeof pluginChangesSchema>, "id">;
