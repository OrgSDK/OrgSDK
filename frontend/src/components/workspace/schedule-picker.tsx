"use client";
import type { ReactNode } from "react";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  parseSchedule,
  scheduleCron,
  scheduleSummary,
  weekDays,
  type ScheduleFrequency,
  type ScheduleTiming,
} from "../../lib/schedule-timing";
export function SchedulePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (cron: string) => void;
  disabled?: boolean;
}): ReactNode {
  const timing = parseSchedule(value);
  const frequencies: ScheduleFrequency[] = [
    "hourly",
    "daily",
    "weekdays",
    "weekly",
    "monthly",
    "existing",
  ];
  const update = (changes: Partial<ScheduleTiming>): void => {
    onChange(scheduleCron({ ...timing, ...changes }));
  };
  const hasTime = ["daily", "weekdays", "weekly", "monthly"].includes(
    timing.frequency,
  );
  const time = `${String(timing.hour).padStart(2, "0")}:${String(timing.minute).padStart(2, "0")}`;
  return (
    <div className="schedule-picker">
      <label>
        Frequency
        <Select
          value={timing.frequency}
          disabled={disabled}
          onValueChange={(value) => {
            const frequency = frequencies.find((item) => item === value);
            if (frequency) update({ frequency });
          }}
        >
          <SelectTrigger aria-label="Frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timing.frequency === "existing" ? (
              <SelectItem value="existing">Keep current schedule</SelectItem>
            ) : undefined}
            <SelectItem value="hourly">Hourly</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekdays">Weekdays</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {timing.frequency === "hourly" ? (
        <label>
          Minute past the hour
          <Input
            type="number"
            min={0}
            max={59}
            required
            disabled={disabled}
            value={timing.minute}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value !== "")
                update({ minute: Number(event.target.value) });
            }}
          />
        </label>
      ) : undefined}
      {hasTime ? (
        <label>
          Time (UTC)
          <Input
            type="time"
            required
            disabled={disabled}
            value={time}
            onChange={(event) => {
              if (!event.target.value) return;
              const [hour, minute] = event.target.value.split(":").map(Number);
              if (hour !== undefined && minute !== undefined)
                update({ hour, minute });
            }}
          />
        </label>
      ) : undefined}
      {timing.frequency === "weekly" ? (
        <label>
          Day of the week
          <Select
            disabled={disabled}
            value={String(timing.weekday)}
            onValueChange={(value) => {
              update({ weekday: Number(value) });
            }}
          >
            <SelectTrigger aria-label="Day of the week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekDays.map((day, index) => (
                <SelectItem value={String(index)} key={day}>
                  {day}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : undefined}
      {timing.frequency === "monthly" ? (
        <label>
          Day of the month
          <Input
            type="number"
            min={1}
            max={31}
            required
            disabled={disabled}
            value={timing.monthDay}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value !== "")
                update({ monthDay: Number(event.target.value) });
            }}
          />
        </label>
      ) : undefined}
      <p className="schedule-summary" aria-live="polite">
        {scheduleSummary(value)}
        {timing.frequency === "monthly" && timing.monthDay > 28
          ? " Months without this date are skipped."
          : ""}
        {timing.frequency === "existing"
          ? " Choose a frequency only if you want to replace this recurrence."
          : " Times use UTC and do not change with daylight saving."}
      </p>
    </div>
  );
}
