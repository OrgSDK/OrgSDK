import { z } from "zod";

const identifier = z.string().trim().min(1).max(160);
export const reportFields = z.strictObject({
  category: z.enum(["friction", "plugin_failure"]),
  summary: z.string().trim().min(1).max(180),
  observed: z.string().trim().min(1).max(2000),
  expected: z.string().trim().min(1).max(1000),
  plugin: identifier.optional(),
  plugin_version: identifier.optional(),
  plugin_function: identifier.optional(),
});
export const feedbackInput = reportFields.extend({ idempotency_key: z.uuid() });
export const inboxSubmission = reportFields.extend({
  submission_key: z.hash("sha256"),
  platform_version: z.string().min(1).max(60),
});
export const receipt = z.strictObject({ report_id: z.uuid() });
