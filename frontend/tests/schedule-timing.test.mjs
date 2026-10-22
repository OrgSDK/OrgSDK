import { expect, test } from "bun:test";
import {
  parseSchedule,
  scheduleCron,
  scheduleSummary,
} from "../src/lib/schedule-timing.ts";

test("existing custom recurrences survive an unrelated schedule edit", () => {
  for (const cron of [
    "*/15 8-18 * * 1-5",
    "0 7 1,15 * *",
    "0 9 * JAN MON",
    "0 0 9 * * *",
  ]) {
    const timing = parseSchedule(cron);
    expect(timing.frequency).toBe("existing");
    expect(scheduleCron(timing)).toBe(cron);
    expect(scheduleSummary(cron)).toContain("kept unchanged");
  }
});
test("weekday and weekly schedules retain the selected UTC time and day", () => {
  const weekdays = parseSchedule("30 14 * * 1-5");
  expect(scheduleSummary(scheduleCron(weekdays))).toBe(
    "Monday to Friday at 14:30 · UTC",
  );
  expect(scheduleCron({ ...weekdays, frequency: "weekly", weekday: 3 })).toBe(
    "30 14 * * 3",
  );
  expect(scheduleSummary("30 14 * * 3")).toBe("Every Wednesday at 14:30 · UTC");
  expect(scheduleSummary("0 9 * * 7")).toBe("Every Sunday at 09:00 · UTC");
});
test("hourly and monthly schedules keep their meaning when opened and saved", () => {
  for (const cron of ["15 * * * *", "45 16 * * *", "0 12 31 * *"]) {
    expect(scheduleCron(parseSchedule(cron))).toBe(cron);
  }
  expect(scheduleSummary("15 * * * *")).toBe(
    "Every hour at 15 minutes past the hour · UTC",
  );
});
