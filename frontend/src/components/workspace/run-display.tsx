import type { Project, Run } from "../../api/types";
import {
  Activity,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
export type { Run } from "../../api/types";
export const activeStatuses: Run["status"][] = [
  "queued",
  "running",
  "waiting_approval",
];
export function RunStatus({ status }: { status: Run["status"] }): ReactNode {
  const icons: Record<string, typeof Clock3> = {
    succeeded: CheckCircle2,
    waiting_approval: ShieldAlert,
    running: Activity,
    queued: Clock3,
    failed: XCircle,
    cancelled: XCircle,
    interrupted: XCircle,
  };
  const Icon = icons[status] ?? Clock3;
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
  return labels[operation] ?? operation.replaceAll("_", " ");
}
export function runLabel(run: Run, projects: Project[]): string {
  const project =
    projects.find((item) => item.id === run.project)?.name ?? "Project";
  return run.operation === "chat"
    ? `${project} · ${textField(run.inputs, "message").slice(0, 70)}`
    : `${project} · ${runOperationLabel(run.operation)}`;
}
