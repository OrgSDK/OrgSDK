import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "./index";
import { createSessionFixture, scope } from "./testing/session-fixture";

test("stable session identity, live variables, global cursor and complete close archive", async () => {
  let reads = 0;
  const fixture = await createSessionFixture({
    functions: [
      {
        name: "records.search",
        handler: async () => {
          reads++;
          return { items: [41] };
        },
      },
    ],
  });
  try {
    const first = await fixture.run(
      "const response = await records.search(); console.log('first'); response.items;",
    );
    expect(first.cell.result).toEqual([41]);
    const second = await fixture.run(
      "let total = response.items[0]; function value() { return total; } total++; console.log('second'); value();",
      { after: first.nextCursor },
    );
    expect(second.sessionId).toBe(fixture.session.id);
    expect(second.cell.result).toBe(42);
    expect(
      second.events.every((event) => event.cursor > first.nextCursor),
    ).toBe(true);
    expect(
      second.events
        .filter((event) => event.kind === "execution.log")
        .map((event) => event.data),
    ).toEqual([{ level: "log", message: "second" }]);
    const third = await fixture.run("return value();");
    expect(third.cell.result).toBe(42);
    expect(
      (await fixture.manager.inspect(fixture.session.id, scope)).worker,
    ).toEqual(fixture.session.worker);
    expect(reads).toBe(1);
    const closed = await fixture.manager.close(fixture.session.id, scope);
    expect(closed.status).toBe("closed");
    expect(closed.cells.map((cell) => cell.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(closed.events.map((event) => event.cursor)).toEqual(
      closed.events.map((_, i) => i + 1),
    );
    expect(closed.events.at(-1)?.kind).toBe("session.closed");
    const saved = JSON.parse(
      await readFile(
        join(fixture.historyDirectory, `${fixture.session.id}.json`),
        "utf8",
      ),
    );
    expect(saved).toEqual(closed);
    const restarted = new SessionManager({
      historyDirectory: fixture.historyDirectory,
      mode: "host",
    });
    expect(await restarted.inspect(fixture.session.id, scope)).toEqual(closed);
    const page = await restarted.readEvents(fixture.session.id, scope, {
      after: 0,
      limit: 2,
    });
    expect(page.events).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(page.events[1].cursor);
    expect(page.tailCursor).toBe(closed.cursor);
    const byCell = await restarted.readEvents(fixture.session.id, scope, {
      cellId: second.cell.id,
    });
    expect(
      byCell.events.every((event) => event.cellId === second.cell.id),
    ).toBe(true);
  } finally {
    await fixture.cleanup();
  }
}, 20_000);

test("idle expiry retains terminal history and bounded output has one explicit truncation event", async () => {
  const fixture = await createSessionFixture({
    idleTimeoutMs: 500,
    maxOutputEvents: 2,
  });
  try {
    const result = await fixture.run(
      "for (let i = 0; i < 10; i++) console.log(i); return 42;",
    );
    expect(result.cell.result).toBe(42);
    expect(
      result.events.filter((event) => event.kind === "execution.log"),
    ).toHaveLength(2);
    expect(
      result.events.filter((event) => event.kind === "execution.truncated"),
    ).toHaveLength(1);
    await Bun.sleep(700);
    const history = await fixture.manager.inspect(fixture.session.id, scope);
    expect(history.status).toBe("expired");
    expect(history.outputTruncated).toBe(true);
    expect(history.cells[0].result).toBe(42);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("an unfinished archive after supervisor restart reports lost memory without executing source", async () => {
  let effects = 0;
  const fixture = await createSessionFixture({
    functions: [{ name: "effect", handler: () => ++effects }],
  });
  try {
    await fixture.run("await effect(); return 42;");
    const history = await fixture.manager.close(fixture.session.id, scope);
    history.status = "executing";
    history.cells[0].status = "running";
    delete history.closedAt;
    await writeFile(
      join(fixture.historyDirectory, `${fixture.session.id}.json`),
      JSON.stringify(history),
    );
    const reader = new SessionManager({
      historyDirectory: fixture.historyDirectory,
      mode: "host",
    });
    const lost = await reader.inspect(fixture.session.id, scope);
    expect(lost.status).toBe("lost");
    expect(lost.cells[0].status).toBe("interrupted");
    expect(lost.events.at(-1)?.kind).toBe("session.lost");
    expect(effects).toBe(1);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);
