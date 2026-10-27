import { isAbsolute, relative, sep } from "node:path";
import { SessionError, type SessionFunction, type SessionScope } from "./types";

export interface SessionManagerOptions {
  historyDirectory: string;
  /** Docker is the default. Host execution must be selected explicitly. */
  mode?: "docker" | "host";
  image?: string;
  sourceDirectory?: string;
  functions?: SessionFunction[];
  idleTimeoutMs?: number;
  cellTimeoutMs?: number;
  startTimeoutMs?: number;
  maxSessions?: number;
  maxCells?: number;
  maxOutputEvents?: number;
  maxOutputBytes?: number;
  /** Optional installation-specific secret redactor, applied before retention. */
  redact?: (value: unknown) => unknown;
}

export interface OpenSession extends SessionScope {
  workspaceDirectory: string;
  configurationRevision: string;
}

export interface ResetSession {
  expectedGeneration: number;
  workspaceDirectory: string;
  configurationRevision: string;
}

export function sessionLimits(options: SessionManagerOptions) {
  const limits = {
    idleTimeoutMs: options.idleTimeoutMs ?? 15 * 60_000,
    cellTimeoutMs: options.cellTimeoutMs ?? 300_000,
    startTimeoutMs: options.startTimeoutMs ?? 30_000,
    maxSessions: options.maxSessions ?? 16,
    maxCells: options.maxCells ?? 128,
    maxOutputEvents: options.maxOutputEvents ?? 1000,
    maxOutputBytes: options.maxOutputBytes ?? 1_000_000,
  };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new SessionError(
        "invalid_options",
        `${name} must be a positive integer`,
      );
  return limits;
}

export type SessionLimits = ReturnType<typeof sessionLimits>;

export function validateWorkspace(
  workspaceDirectory: string,
  historyDirectory: string,
): void {
  if (!isAbsolute(workspaceDirectory))
    throw new SessionError(
      "invalid_directory",
      "Workspace directory must be absolute",
    );
  const storage = relative(workspaceDirectory, historyDirectory);
  const parentDirectory = storage === ".." || storage.startsWith(`..${sep}`);
  const historyInsideWorkspace = !parentDirectory && !isAbsolute(storage);
  if (historyInsideWorkspace)
    throw new SessionError(
      "invalid_directory",
      "History must be stored outside the project workspace",
    );
}

export function validateOpen(
  request: OpenSession,
  historyDirectory: string,
): void {
  const identity = [
    request.workspaceId,
    request.projectId,
    request.ownerId,
    request.configurationRevision,
  ];
  if (
    identity.some(
      (value) => typeof value !== "string" || !value || value.length > 256,
    )
  )
    throw new SessionError(
      "invalid_scope",
      "A bounded workspace, project, owner and configuration revision are required",
    );
  validateWorkspace(request.workspaceDirectory, historyDirectory);
}

export function validateReset(
  request: ResetSession,
  generation: number,
  historyDirectory: string,
): void {
  if (generation !== request.expectedGeneration)
    throw new SessionError("stale_generation", "Session generation changed");
  if (
    !isAbsolute(request.workspaceDirectory) ||
    !request.configurationRevision ||
    request.configurationRevision.length > 256
  )
    throw new SessionError(
      "invalid_reset",
      "Reset requires an absolute workspace and configuration revision",
    );
  validateWorkspace(request.workspaceDirectory, historyDirectory);
}
