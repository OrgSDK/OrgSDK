import { CronExpressionParser } from "cron-parser";
import { HttpError } from "../http/responses";
export function nextCron(cron: any) {
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5)
    throw new HttpError(400, "Use a valid five-field UTC cron expression.");
  try {
    const next = CronExpressionParser.parse(cron, { tz: "UTC" })
      .next()
      .toISOString();
    if (!next) throw new Error("No next occurrence.");
    return next;
  } catch {
    throw new HttpError(400, "Use a valid five-field UTC cron expression.");
  }
}
