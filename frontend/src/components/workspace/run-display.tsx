import {
  Activity,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { components } from "../../api/schema";
export type Run = components["schemas"]["Run"];
export const activeStatuses: Run["status"][] = [
  "queued",
  "running",
  "waiting_approval",
];
export function RunStatus({ status }: { status: Run["status"] }): ReactNode {
  const icons = {
    succeeded: CheckCircle2,
    waiting_approval: ShieldAlert,
    running: Activity,
    queued: Clock3,
    failed: XCircle,
    cancelled: XCircle,
    interrupted: XCircle,
  };
  const Icon = icons[status];
  return (
    <span className={`run-status status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function textField(value: unknown, key: string): string {
  if (
    value !== null &&
    typeof value === "object" &&
    Object.hasOwn(value, key)
  ) {
    const found: unknown = Reflect.get(value, key);
    if (typeof found === "string") return found;
  }
  return "";
}
export function displayValue(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string"
    ? value
    : JSON.stringify(value, undefined, 2);
}
export function progressLabel(run: Run): string {
  if (run.cancel_requested) return "Cancellation requested…";
  if (run.status === "queued") return "Queued, waiting for an executor…";
  return run.status === "waiting_approval"
    ? "Waiting for your approval…"
    : "Working on your task…";
}
export function runOperationLabel(operation: Run["operation"]): string {
  const labels: Record<Run["operation"], string> = {
    chat: "Chat task",
    code: "Code execution",
    action: "Action run",
    validate: "Code validation",
    test: "Action tests",
  };
  return labels[operation];
}
export function runLabel(
  run: Run,
  agents: components["schemas"]["Agent"][],
): string {
  const agent = agents.find((item) => item.id === run.agent)?.name ?? "Agent";
  return run.operation === "chat"
    ? `${agent} · ${textField(run.inputs, "message").slice(0, 70)}`
    : `${agent} · ${runOperationLabel(run.operation)}`;
}
