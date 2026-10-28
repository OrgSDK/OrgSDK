import { z } from "zod";
export const auditFiltersSchema = z
  .object({
    actor: z.number().int().positive().optional(),
    kind: z.string().optional(),
    object_id: z.string().optional(),
    since: z.iso.datetime().optional(),
    before: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.since ||
      !input.before ||
      Date.parse(input.since) < Date.parse(input.before),
    "Invalid date range.",
  );
