import { z } from "zod";
const identifier = z.uuid();
const jsonObject = z.record(z.string(), z.json());
export const runIdSchema = z.strictObject({ id: identifier });
export const createRunSchema = z.strictObject({
  project: identifier,
  operation: z.enum(["action", "code", "validate", "test"]),
  idempotency_key: z.string(),
  source: z.string().optional(),
  inputs: jsonObject.optional(),
  action: identifier.optional(),
  version: z.number().int().positive().optional(),
  suite_revision: z.number().int().positive().optional(),
  conversation: identifier.optional(),
  input_schema: jsonObject.optional(),
  output_schema: jsonObject.optional(),
});
export const validateCodeSchema = createRunSchema.omit({ operation: true });
export const retryRunSchema = z.strictObject({
  id: identifier,
  idempotency_key: z.string(),
});
export const promoteRunSchema = z.strictObject({
  id: identifier,
  name: z.string(),
  action: identifier.optional(),
  input_schema: jsonObject.optional(),
  output_schema: jsonObject.optional(),
});
export const streamRunSchema = z.strictObject({
  id: identifier,
  after: z.number().int().nonnegative().default(0),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type RetryRunInput = z.infer<typeof retryRunSchema>;
export type PromoteRunInput = z.infer<typeof promoteRunSchema>;
