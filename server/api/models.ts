import { z } from "zod";

const uuid = z.string().uuid();
const resourceModes = z.object({ read: z.array(uuid), write: z.array(uuid) });
export const sessionSchema = z.object({
  is_authenticated: z.boolean(),
  user: z
    .object({
      id: z.number(),
      username: z.string(),
      email: z.string(),
      first_name: z.string(),
      last_name: z.string(),
    })
    .nullable(),
});
export const projectSchema = z.object({
  id: uuid,
  name: z.string(),
  enabled: z.boolean(),
  runner: z.object({
    registered: z.boolean(),
    enabled: z.boolean(),
    locally_managed: z.boolean(),
    last_seen_at: z.string().nullable(),
    protocol_version: z.number().nullable(),
  }),
  plugins: z.array(uuid).optional(),
  readable_tables: z.array(uuid).optional(),
  writable_tables: z.array(uuid).optional(),
  readable_documents: z.array(uuid).optional(),
  writable_documents: z.array(uuid).optional(),
});
export const documentSchema = z.object({
  id: uuid,
  kind: z.enum(["document", "memory"]),
  title: z.string(),
  content: z.string(),
});
export const actionSchema = z.object({
  id: uuid,
  agent: uuid,
  project: uuid,
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});
export const runSchema = z.object({
  id: uuid,
  agent: uuid,
  project: uuid,
  origin: z.enum([
    "legacy",
    "browser",
    "client",
    "schedule",
    "webhook",
    "retry",
    "delegation",
  ]),
  origin_reference: z.string(),
  conversation: uuid.nullable(),
  actor: z.number(),
  client_token: uuid.nullable(),
  source: z.string().nullable(),
  source_digest: z.string().nullable(),
  sdk_revision: z.number().nullable(),
  configuration_revision: z.string().nullable(),
  operation: z.enum(["action", "chat", "code", "validate", "test"]),
  action_version: uuid.nullable(),
  inputs: z.json(),
  status: z.enum([
    "queued",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  output: z.json(),
  error: z.string(),
  retry_of: uuid.nullable(),
  cancel_requested: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const sdkSchema = z.object({
  project: uuid,
  protocol_version: z.number(),
  sdk_revision: z.number(),
  configuration_revision: z.string(),
  resources: z.object({ tables: resourceModes, documents: resourceModes }),
  limits: z.record(z.string(), z.number()),
  builtins: z.array(z.string()),
  plugins: z.array(
    z.object({
      namespace: z.string().nullable(),
      available: z.boolean(),
      slug: z.string(),
      version: z.string(),
      digest: z.string(),
      metadata_complete: z.boolean(),
      tools: z.array(z.record(z.string(), z.unknown())).nullable(),
    }),
  ),
  notes: z.string(),
  example: z.string(),
});
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    count: z.number(),
    next: z.null(),
    previous: z.null(),
    results: z.array(item),
  });
}
