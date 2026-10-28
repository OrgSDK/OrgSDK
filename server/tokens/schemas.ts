import { z } from "zod";
const clientScopes = z.enum([
  "catalog:read",
  "code:execute",
  "actions:write",
  "actions:run",
  "actions:test",
  "runs:read",
  "runs:cancel",
]);
export type ClientScope = z.infer<typeof clientScopes>;

export const tokenCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(clientScopes).min(1),
    projects: z.array(z.uuid()).default([]),
    action_versions: z.array(z.uuid()).default([]),
  })
  .strict();
