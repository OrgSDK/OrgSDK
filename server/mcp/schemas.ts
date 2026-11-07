import { z } from "zod";
import {
  endpointSchema,
  headerSchema,
  transportSchema,
} from "../../runtime/src/mcp/contract";
export const connectionInputSchema = z.strictObject({
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
// Declared explicitly: deriving from connectionInputSchema with .partial()
// would keep the create-time defaults, so an omitted auth_mode/transport would
// parse as "none"/"auto" and silently reset the connection's authentication.
export const connectionUpdateSchema = z.strictObject({
  id: z.uuid(),
  endpoint: endpointSchema.optional(),
  transport: transportSchema.optional(),
  auth_mode: z.enum(["none", "headers", "oauth"]).optional(),
  headers: headerSchema.optional(),
});
