export type ScheduleFrequency =
  "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "existing";
export interface ScheduleTiming {
  frequency: ScheduleFrequency;
  hour: number;
  minute: number;
  weekday: number;
  monthDay: number;
  original: string;
}
export const weekDays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const defaultSchedule = "0 9 * * 1-5";
function integerField(
  value: string | undefined,
  maximum: number,
  minimum = 0,
): number | undefined {
  if (!value || !/^\d+$/.test(value)) return;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : undefined;
}
export function parseSchedule(cron: string): ScheduleTiming {
  const timing: ScheduleTiming = {
    frequency: "existing",
    hour: 9,
    minute: 0,
    weekday: 1,
    monthDay: 1,
    original: cron,
  };
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return timing;
  const [minute, hour, date, month, weekday] = fields;
  const parsedMinute = integerField(minute, 59);
  if (parsedMinute === undefined || month !== "*") return timing;
  timing.minute = parsedMinute;
  if (hour === "*" && date === "*" && weekday === "*")
    return { ...timing, frequency: "hourly" };
  const parsedHour = integerField(hour, 23);
  if (parsedHour === undefined) return timing;
  timing.hour = parsedHour;
  if (date === "*" && weekday === "*") return { ...timing, frequency: "daily" };
  if (date === "*" && weekday === "1-5")
    return { ...timing, frequency: "weekdays" };
  const parsedWeekday = integerField(weekday, 7);
  if (date === "*" && parsedWeekday !== undefined)
    return { ...timing, frequency: "weekly", weekday: parsedWeekday % 7 };
  const parsedDate = integerField(date, 31, 1);
  return parsedDate !== undefined && weekday === "*"
    ? { ...timing, frequency: "monthly", monthDay: parsedDate }
    : timing;
}
export function scheduleCron(timing: ScheduleTiming): string {
  const { frequency, hour, minute, weekday, monthDay, original } = timing;
  if (frequency === "existing") return original;
  const minuteField = String(minute);
  const hourField = String(hour);
  const patterns: Record<Exclude<ScheduleFrequency, "existing">, string> = {
    hourly: `${minuteField} * * * *`,
    daily: `${minuteField} ${hourField} * * *`,
    weekdays: `${minuteField} ${hourField} * * 1-5`,
    weekly: `${minuteField} ${hourField} * * ${String(weekday)}`,
    monthly: `${minuteField} ${hourField} ${String(monthDay)} * *`,
  };
  return patterns[frequency];
}
export function scheduleSummary(cron: string): string {
  const { frequency, hour, minute, weekday, monthDay } = parseSchedule(cron);
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const summaries: Record<ScheduleFrequency, string> = {
    hourly: `Every hour at ${String(minute).padStart(2, "0")} minutes past the hour · UTC`,
    daily: `Every day at ${time} · UTC`,
    weekdays: `Monday to Friday at ${time} · UTC`,
    weekly: `Every ${weekDays[weekday] ?? "Monday"} at ${time} · UTC`,
    monthly: `Day ${String(monthDay)} of each month at ${time} · UTC`,
    existing: "Existing custom recurrence · UTC (kept unchanged)",
  };
  return summaries[frequency];
}
