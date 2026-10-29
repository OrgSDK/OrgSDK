import type { schedules } from "../db/schema";

export function scheduleView(schedule: typeof schedules.$inferSelect) {
  return {
    id: schedule.id,
    action: schedule.actionId,
    cron: schedule.cron,
    inputs: schedule.inputs,
    enabled: schedule.enabled,
    next_run_at: schedule.nextRunAt,
  };
}
