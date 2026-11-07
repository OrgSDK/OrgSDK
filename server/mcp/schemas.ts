import { z } from "zod";
import {
  endpointSchema,
  headerSchema,
  transportSchema,
} from "../../runtime/src/mcp/contract";
export const connectionInput = z.strictObject({
  project: z.uuid(),
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/)
    .max(50),
  endpoint: endpointSchema,
  transport: transportSchema.default("auto"),
  auth_mode: z.enum(["none", "headers", "oauth"]).default("none"),
  headers: headerSchema.optional(),
});
export const connectionUpdate = connectionInput
  .omit({ project: true, slug: true })
  .partial()
  .extend({ id: z.uuid() });
