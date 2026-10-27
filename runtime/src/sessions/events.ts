import type { SessionLimits } from "./configuration";
import type { SessionRedactor } from "./redaction";
import { traceData } from "./values";
import { SessionError, type EventPage, type SessionHistory } from "./types";

export interface EventQuery {
  after?: number;
  limit?: number;
  cellId?: string;
}

export class SessionEvents {
  private outputEvents: number;
  private outputBytes: number;

  constructor(
    readonly history: SessionHistory,
    private readonly limits: Pick<
      SessionLimits,
      "maxOutputEvents" | "maxOutputBytes"
    >,
    readonly redactor: SessionRedactor,
  ) {
    const output = history.events.filter(
      (event) =>
        event.kind === "execution.log" || event.kind === "execution.step",
    );
    this.outputEvents = output.length;
    this.outputBytes = output.reduce(
      (bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event.data)),
      0,
    );
  }

  append(
    cellId: string | null,
    kind: string,
    data: unknown,
    output = false,
  ): boolean {
    if (output && this.history.outputTruncated) return false;
    const bounded = traceData(this.redactor.redact(data));
    const bytes = Buffer.byteLength(JSON.stringify(bounded));
    const outputFull =
      this.outputEvents >= this.limits.maxOutputEvents ||
      this.outputBytes + bytes > this.limits.maxOutputBytes;
    if (output && outputFull) {
      this.history.outputTruncated = true;
      this.append(cellId, "execution.truncated", {
        reason: "Session output retention limit reached",
      });
      return true;
    }
    if (output) {
      this.outputEvents++;
      this.outputBytes += bytes;
    }
    this.history.updatedAt = new Date().toISOString();
    this.history.events.push({
      cursor: ++this.history.cursor,
      generation: this.history.generation,
      cellId,
      kind,
      data: bounded,
      timestamp: this.history.updatedAt,
    });
    return true;
  }

  page(options: EventQuery = {}): EventPage {
    const after = options.after ?? 0;
    const limit = options.limit ?? 100;
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > this.history.cursor ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new SessionError(
        "invalid_cursor",
        "Cursor must be within the retained history and limit must be 1–1000",
      );
    const remaining = this.history.events.filter(
      (event) =>
        event.cursor > after &&
        (!options.cellId || event.cellId === options.cellId),
    );
    const events = remaining.slice(0, limit);
    return {
      events: structuredClone(events),
      nextCursor: events.at(-1)?.cursor ?? after,
      tailCursor: this.history.cursor,
      hasMore: remaining.length > events.length,
    };
  }
}
