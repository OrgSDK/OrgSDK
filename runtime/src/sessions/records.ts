import type { SessionEvents } from "./events";
import { errorText } from "./values";
import type {
  CellEvaluation,
  CellRecord,
  SessionHistory,
  SessionScope,
  SessionStatus,
} from "./types";

export function isTerminal(status: SessionStatus): boolean {
  return status === "closed" || status === "expired" || status === "lost";
}

export function newHistory(
  scope: SessionScope,
  configurationRevision: string,
): SessionHistory {
  return {
    version: 1,
    id: crypto.randomUUID(),
    scope,
    configurationRevision,
    generation: 1,
    status: "idle",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cells: [],
    events: [],
    cursor: 0,
    outputTruncated: false,
  };
}

export function completeCell(
  cell: CellRecord,
  evaluation: CellEvaluation,
  events: SessionEvents,
): void {
  cell.status = evaluation.status;
  cell.result = events.redactor.redact(evaluation.result);
  cell.error = evaluation.error
    ? errorText(events.redactor.redact(evaluation.error))
    : undefined;
  cell.diagnostics = events.redactor.redact(
    evaluation.diagnostics,
  ) as CellRecord["diagnostics"];
  cell.finishedAt = new Date().toISOString();
  events.append(cell.id, `cell.${cell.status}`, {
    result: cell.result,
    error: cell.error,
    diagnostics: cell.diagnostics,
  });
  cell.endCursor = events.history.cursor;
}

export function interruptCell(
  cell: CellRecord,
  reason: string,
  events: SessionEvents,
): void {
  if (cell.status !== "running") return;
  cell.status = "interrupted";
  cell.error = reason;
  cell.finishedAt = new Date().toISOString();
  events.append(cell.id, "cell.interrupted", { error: reason });
  cell.endCursor = events.history.cursor;
}

export function recoverHistory(events: SessionEvents): boolean {
  const { history } = events;
  if (isTerminal(history.status)) return false;
  history.status = "lost";
  history.reason = "Supervisor restarted; live memory is unavailable";
  history.closedAt = new Date().toISOString();
  for (const cell of history.cells) interruptCell(cell, history.reason, events);
  events.append(null, "session.lost", { reason: history.reason });
  return true;
}
