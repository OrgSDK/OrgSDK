import type { SessionLimits } from "./configuration";
import {
  existingCell,
  newCell,
  validateAppend,
  type PreparedCell,
} from "./cell-request";
import { completeCell, isTerminal } from "./records";
import type { SessionRuntime } from "./session-runtime";
import { errorText } from "./values";
import { SessionError, type CellRecord, type CellReply } from "./types";

function reply(
  session: SessionRuntime,
  cell: CellRecord,
  request: PreparedCell,
): CellReply {
  return {
    sessionId: session.history.id,
    cell: structuredClone(cell),
    ...session.events.page({
      after: request.after ?? cell.startCursor,
      limit: request.limit,
    }),
  };
}

async function dispatchCell(
  session: SessionRuntime,
  cell: CellRecord,
): Promise<void> {
  if (isTerminal(session.history.status)) return;
  const evaluation = await session.worker!.execute(
    cell.id,
    cell.source,
    cell.inputs,
  );
  if (isTerminal(session.history.status)) return;
  completeCell(cell, evaluation, session.events);
  session.history.status = "idle";
}

/** Accept, persist, dispatch and complete one cell; scheduling belongs to the session. */
export async function executeCell(
  session: SessionRuntime,
  request: PreparedCell,
  limits: SessionLimits,
): Promise<CellReply> {
  const { history, events } = session;
  if (request.generation !== history.generation)
    throw new SessionError(
      "stale_generation",
      "Session generation changed; inspect before submitting",
    );
  if (
    request.configurationRevision !== undefined &&
    request.configurationRevision !== history.configurationRevision
  ) {
    await session.finish("lost", "Session configuration changed");
    throw new SessionError(
      "configuration_changed",
      "Open or reset a session for the current configuration",
    );
  }
  const previous = existingCell(history, request);
  if (previous) return reply(session, previous, request);
  const timeoutMs = validateAppend(
    history,
    session.worker !== undefined,
    request,
    limits,
  );
  // Cursor validation must precede acceptance and any user effects.
  events.page({ after: request.after, limit: request.limit });
  request.signal?.throwIfAborted();
  const cell = newCell(history, request);
  session.beginCell(cell, request.capability);
  const abort = () => {
    void session.finish("lost", "Cell cancelled").catch(() => undefined);
  };
  const timer = setTimeout(() => {
    void session
      .finish("expired", "Cell execution deadline exceeded")
      .catch(() => undefined);
  }, timeoutMs);
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    // Persist exact source before dispatching it to the worker.
    await session.save();
    if (request.signal?.aborted) abort();
    await dispatchCell(session, cell);
  } catch (error) {
    if (!isTerminal(history.status))
      await session.finish("lost", errorText(error));
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
    await session.releaseCell();
  }
  return reply(session, cell, request);
}
