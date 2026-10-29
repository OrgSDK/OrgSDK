import { z } from "zod";
const identifier = z.uuid();
const jsonObject = z.record(z.string(), z.json());
export const actionIdSchema = z.strictObject({ id: identifier });
export const versionFields = {
  source: z.string(),
  input_schema: jsonObject.optional(),
  output_schema: jsonObject.optional(),
  sdk_contract: jsonObject.optional(),
};
export const saveActionSchema = z.strictObject({
  project: identifier,
  action: identifier.optional(),
  name: z.string(),
  ...versionFields,
});
export const createActionSchema = z.strictObject({
  project: identifier,
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});
export const updateActionSchema = z.strictObject({
  id: identifier,
  project: identifier.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});
export const createVersionSchema = z.strictObject({
  id: identifier,
  ...versionFields,
});
export const actionVersionSchema = z.strictObject({
  id: identifier,
  version: z.number().int().positive().optional(),
});
export const actionTestsSchema = z.strictObject({
  id: identifier,
  version: z.number().int().positive(),
  suite_revision: z.number().int().positive().optional(),
});
export const saveTestsSchema = z.strictObject({
  id: identifier,
  version: z.number().int().positive(),
  cases: z.array(z.json()),
});
export const runTestsSchema = z.strictObject({
  id: identifier,
  version: z.number().int().positive(),
  suite_revision: z.number().int().positive(),
  idempotency_key: z.string(),
  inputs: jsonObject.optional(),
});
export type VersionInput = Pick<
  z.infer<typeof createVersionSchema>,
  "source" | "input_schema" | "output_schema" | "sdk_contract"
>;
export type SaveActionInput = z.infer<typeof saveActionSchema>;
export type CreateActionInput = z.infer<typeof createActionSchema>;
export type UpdateActionInput = z.infer<typeof updateActionSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type ActionTestsInput = z.infer<typeof actionTestsSchema>;
export type SaveTestsInput = z.infer<typeof saveTestsSchema>;
export type RunTestsInput = z.infer<typeof runTestsSchema>;
