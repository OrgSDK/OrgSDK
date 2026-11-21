import type { Project } from "../../api/types";

export function runnerStatus(runner: Project["runner"], now: number): string {
  if (!runner.registered) return "Not registered";
  if (!runner.enabled) return "Revoked";
  if (!runner.last_seen_at) return "Registered · waiting for connection";
  return now - Date.parse(runner.last_seen_at) > 60_000
    ? "Unavailable · no recent heartbeat"
    : "Available";
}
