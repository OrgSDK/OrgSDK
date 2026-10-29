import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionLimits } from "./configuration";
import { canonicalJson, jsonValue, MAX_VALUE_BYTES } from "./values";
import { isTerminal } from "./records";
import {
  SessionError,
  type CellRecord,
  type CellRequest,
  type SessionHistory,
} from "./types";

export interface PreparedCell extends CellRequest {
  inputs: Record<string, unknown>;
  digest: string;
  sourceDigest: string;
}

export function prepareCell(request: CellRequest): PreparedCell {
  if (
    !z.uuid().safeParse(request.id).success ||
    typeof request.source !== "string" ||
    !request.source.trim() ||
    !request.source.isWellFormed() ||
    request.source.includes("\0") ||
    Buffer.byteLength(request.source) > MAX_VALUE_BYTES
  )
    throw new SessionError(
      "invalid_cell",
      "Cell requires a UUID and valid nonempty source of at most 200000 UTF-8 bytes",
    );
  const inputs = z
    .record(z.string(), z.unknown())
    .parse(jsonValue(request.inputs ?? {})) as Record<string, unknown>;
  return {
    ...request,
    inputs,
    digest: createHash("sha256")
      .update(canonicalJson({ source: request.source, inputs }))
      .digest("hex"),
    sourceDigest: createHash("sha256").update(request.source).digest("hex"),
  };
}

export function existingCell(
  history: SessionHistory,
  request: PreparedCell,
): CellRecord | undefined {
  const previous = history.cells.find((cell) => cell.id === request.id);
  if (
    previous &&
    (previous.digest !== request.digest ||
      request.expectedSequence !== previous.sequence - 1)
  )
    throw new SessionError(
      "cell_conflict",
      "Cell ID was already used with a different payload",
    );
  return previous;
}

export function validateAppend(
  history: SessionHistory,
  hasWorker: boolean,
  request: PreparedCell,
  limits: SessionLimits,
): number {
  if (isTerminal(history.status) || !hasWorker)
    throw new SessionError(
      "session_unavailable",
      `Session is ${history.status}; live memory cannot be resumed`,
    );
  if (request.expectedSequence !== history.cells.length)
    throw new SessionError(
      "stale_sequence",
      "Cell sequence changed; inspect before appending",
    );
  const sourceBytes =
    history.cells.reduce(
      (bytes, cell) => bytes + Buffer.byteLength(cell.source),
      0,
    ) + Buffer.byteLength(request.source);
  if (history.cells.length >= limits.maxCells || sourceBytes > 2_000_000)
    throw new SessionError(
      "history_limit",
      "Session source history limit reached",
    );
  const timeoutMs = request.timeoutMs ?? limits.cellTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > limits.cellTimeoutMs
  )
    throw new SessionError(
      "invalid_timeout",
      "Cell timeout must be within the configured deadline",
    );
  return timeoutMs;
}

export function newCell(
  history: SessionHistory,
  request: PreparedCell,
): CellRecord {
  return {
    id: request.id,
    sequence: history.cells.length + 1,
    generation: history.generation,
    source: request.source,
    sourceDigest: request.sourceDigest,
    digest: request.digest,
    inputs: request.inputs,
    status: "running",
    startedAt: new Date().toISOString(),
    startCursor: history.cursor,
  };
}
