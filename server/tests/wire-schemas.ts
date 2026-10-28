import { z } from "zod";
const uuid = z.uuid();
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
export const runSchema = z.object({
  id: uuid,
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
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    count: z.number(),
    next: z.null(),
    previous: z.null(),
    results: z.array(item),
  });
}
