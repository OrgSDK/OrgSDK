import { z } from "zod";
export const scheduleFields = z.object({
  action: z.uuid(),
  cron: z.string().trim().min(1).max(100),
  inputs: z.json().optional(),
  enabled: z.boolean().optional(),
});
export const scheduleCreateSchema = scheduleFields.strict();
export const scheduleUpdateSchema = scheduleFields
  .partial()
  .extend({ id: z.uuid() })
  .strict();
export type CreateSchedule = z.infer<typeof scheduleCreateSchema>;
export type UpdateSchedule = z.infer<typeof scheduleUpdateSchema>;
