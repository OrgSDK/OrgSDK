export interface SessionScope {
  workspaceId: string;
  projectId: string;
  ownerId: string;
}

export type SessionStatus =
  "idle" | "executing" | "closed" | "expired" | "lost";
export type CellStatus =
  "running" | "succeeded" | "failed" | "rejected" | "interrupted";

export interface SessionEvent {
  cursor: number;
  generation: number;
  cellId: string | null;
  kind: string;
  data: unknown;
  timestamp: string;
}

export interface CellRecord {
  id: string;
  sequence: number;
  generation: number;
  source: string;
  sourceDigest: string;
  digest: string;
  inputs: Record<string, unknown>;
  status: CellStatus;
  startedAt: string;
  finishedAt?: string;
  startCursor: number;
  endCursor?: number;
  result?: unknown;
  error?: string;
  diagnostics?: CellDiagnostic[];
}

export interface CellDiagnostic {
  line: number;
  column: number;
  code: string | number;
  message: string;
}

export interface SessionHistory {
  version: 1;
  id: string;
  scope: SessionScope;
  configurationRevision: string;
  generation: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  reason?: string;
  cells: CellRecord[];
  events: SessionEvent[];
  cursor: number;
  outputTruncated: boolean;
  worker?: { pid: number; hostname: string; mode: "host" | "docker" };
}

export interface EventPage {
  events: SessionEvent[];
  nextCursor: number;
  tailCursor: number;
  hasMore: boolean;
}

export interface CellRequest {
  id: string;
  generation: number;
  expectedSequence: number;
  source: string;
  inputs?: Record<string, unknown>;
  after?: number;
  limit?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Retained by the supervisor only; never serialized into history or the worker. */
  capability?: string;
  configurationRevision?: string;
}

export interface CellReply extends EventPage {
  sessionId: string;
  cell: CellRecord;
}

export interface CellContext extends SessionScope {
  sessionId: string;
  cellId: string;
  generation: number;
  inputs: Record<string, unknown>;
  capability?: string;
  signal: AbortSignal;
}

export interface SessionFunction {
  /** A global name or namespace.method, such as records.search. */
  name: string;
  /** A trusted adapter must resolve credentials per invocation using this context. */
  handler: (
    args: unknown[],
    context: CellContext,
  ) => unknown | Promise<unknown>;
}

export interface CellEvaluation {
  status: "succeeded" | "failed" | "rejected";
  result?: unknown;
  error?: string;
  diagnostics?: CellDiagnostic[];
}

export class SessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionError";
  }
}
