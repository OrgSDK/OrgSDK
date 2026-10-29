import { CronExpressionParser } from "cron-parser";
import { ServiceError } from "../shared/errors";
export function nextCron(cron: unknown) {
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Use a valid five-field UTC cron expression.",
    );
  }
  try {
    const next = CronExpressionParser.parse(cron, { tz: "UTC" })
      .next()
      .toISOString();
    if (!next) {
      throw new Error("No next occurrence.");
    }
    return next;
  } catch {
    throw new ServiceError(
      "BAD_REQUEST",
      "Use a valid five-field UTC cron expression.",
    );
  }
}
