import { expect, test } from "bun:test";
import { sessionLimits } from "./configuration";
import { SessionEvents } from "./events";
import { newHistory } from "./records";
import { SessionRedactor } from "./redaction";

function events(maxOutputEvents = 2, maxOutputBytes = 100_000) {
  const history = newHistory(
    { workspaceId: "w", projectId: "p", ownerId: "o" },
    "revision",
  );
  const limits = sessionLimits({
    historyDirectory: "/history",
    maxOutputEvents,
    maxOutputBytes,
  });
  const redactor = new SessionRedactor();
  return {
    history,
    limits,
    redactor,
    log: new SessionEvents(history, limits, redactor),
  };
}

test("event pagination advances only to delivered records and returned pages are independent", () => {
  const { log, history } = events();
  log.append(null, "session.opened", {});
  log.append("first", "execution.log", { message: "first" }, true);
  log.append("second", "execution.log", { message: "second" }, true);
  const first = log.page({ limit: 1 });
  expect(first).toMatchObject({ nextCursor: 1, tailCursor: 3, hasMore: true });
  first.events[0].kind = "changed";
  expect(history.events[0].kind).toBe("session.opened");
  const next = log.page({ after: first.nextCursor, limit: 1 });
  expect(next.events[0].cellId).toBe("first");
  expect(next.nextCursor).toBe(2);
  expect(
    log
      .page({ after: 1, cellId: "second" })
      .events.map((event) => event.cursor),
  ).toEqual([3]);
  for (const after of [-1, 4, 0.5])
    expect(() => log.page({ after })).toThrow("Cursor");
});

test("output quotas survive reconstruction while lifecycle events remain available", () => {
  const { log, history, limits, redactor } = events(1);
  log.append("first", "execution.log", { message: "kept" }, true);
  const restored = new SessionEvents(history, limits, redactor);
  expect(
    restored.append("second", "execution.log", { message: "over quota" }, true),
  ).toBe(true);
  expect(
    restored.append("second", "execution.log", { message: "discarded" }, true),
  ).toBe(false);
  restored.append(null, "session.closed", {});
  expect(history.events.map((event) => event.kind)).toEqual([
    "execution.log",
    "execution.truncated",
    "session.closed",
  ]);
  expect(history.outputTruncated).toBe(true);
  const bytes = events(100, 1);
  bytes.log.append("first", "execution.step", { result: "oversized" }, true);
  expect(bytes.history.events.map((event) => event.kind)).toEqual([
    "execution.truncated",
  ]);
});

test("remembered capabilities are removed from nested keys and values before retention", () => {
  const { log, history, redactor } = events();
  redactor.remember("old-capability");
  log.append("first", "execution.log", { message: "old-capability" }, true);
  redactor.remember("new-capability");
  log.append(
    "second",
    "execution.step",
    { result: { "old-capability": ["new-capability"] } },
    true,
  );
  expect(JSON.stringify(history.events)).not.toContain("capability");
  expect(history.events[1].data).toEqual({
    result: { "[redacted]": ["[redacted]"] },
  });
});
