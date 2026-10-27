import { expect, test } from "bun:test";
import { createSessionFixture, scope } from "./testing/session-fixture";

test("external deadlines kill code looping after await and retain the full accepted history", async () => {
  const fixture = await createSessionFixture();
  try {
    await fixture.run("const response = {value: 42}; response;");
    const started = Date.now();
    const killed = await fixture.run(
      "await Promise.resolve(); console.log('before loop'); while (true) {}",
      { timeoutMs: 1500 },
    );
    expect(Date.now() - started).toBeLessThan(8000);
    expect(killed.cell.status).toBe("interrupted");
    expect(killed.events.some((event) => event.kind === "execution.log")).toBe(
      true,
    );
    const expired = await fixture.manager.inspect(fixture.session.id, scope);
    expect(expired.status).toBe("expired");
    expect(expired.cells).toHaveLength(2);
    expect(expired.events.at(-1)?.kind).toBe("session.expired");
    await expect(fixture.run("return response;")).rejects.toMatchObject({
      code: "session_unavailable",
    });
    expect(
      (await fixture.manager.readEvents(fixture.session.id, scope)).tailCursor,
    ).toBe(expired.cursor);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("explicit close cancels a pending capability, retains logs and releases project capacity", async () => {
  let called!: () => void;
  const entered = new Promise<void>((resolve) => {
    called = resolve;
  });
  let aborted = false;
  const fixture = await createSessionFixture({
    functions: [
      {
        name: "wait",
        handler: (_args, context) =>
          new Promise((_resolve, reject) => {
            called();
            context.signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("aborted"));
              },
              { once: true },
            );
          }),
      },
    ],
  });
  try {
    const running = fixture.run("console.log('waiting'); await wait();");
    await entered;
    const closed = await fixture.manager.close(fixture.session.id, scope);
    expect(aborted).toBe(true);
    expect(closed.status).toBe("closed");
    expect((await running).cell.status).toBe("interrupted");
    expect(closed.events.some((event) => event.kind === "execution.log")).toBe(
      true,
    );
    const next = await fixture.manager.open({
      ...scope,
      workspaceDirectory: fixture.workspaceDirectory,
      configurationRevision: "config-1",
    });
    expect(next.id).not.toBe(fixture.session.id);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("reset retains the ID and cursor, clears memory explicitly and rejects stale generations", async () => {
  const fixture = await createSessionFixture();
  try {
    const first = await fixture.run(
      "const response = 42; await writeFile('saved.txt', 'kept'); return response;",
    );
    const reset = await fixture.manager.reset(fixture.session.id, scope, {
      expectedGeneration: 1,
      workspaceDirectory: fixture.workspaceDirectory,
      configurationRevision: "config-2",
    });
    expect(reset.id).toBe(fixture.session.id);
    expect(reset.generation).toBe(2);
    expect(reset.cursor).toBeGreaterThan(first.tailCursor);
    expect(reset.cells).toHaveLength(1);
    await expect(fixture.run("return response;")).rejects.toMatchObject({
      code: "stale_generation",
    });
    const absent = await fixture.manager.execute(reset.id, scope, {
      id: crypto.randomUUID(),
      source: "return response;",
      generation: 2,
      expectedSequence: 1,
    });
    expect(absent.cell.status).toBe("rejected");
    const retained = await fixture.manager.execute(reset.id, scope, {
      id: crypto.randomUUID(),
      source: "return await readFile('saved.txt');",
      generation: 2,
      expectedSequence: 2,
    });
    expect(retained.cell.result).toBe("kept");
    await expect(
      fixture.manager.execute(reset.id, scope, {
        id: crypto.randomUUID(),
        source: "return 1;",
        generation: 2,
        expectedSequence: 3,
        configurationRevision: "changed",
      }),
    ).rejects.toMatchObject({ code: "configuration_changed" });
    expect((await fixture.manager.inspect(reset.id, scope)).status).toBe(
      "lost",
    );
  } finally {
    await fixture.cleanup();
  }
}, 20_000);

test("abort signal cancels an accepted cell, while already-aborted submissions have no effects", async () => {
  let entered!: () => void;
  const called = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const fixture = await createSessionFixture({
    functions: [
      {
        name: "wait",
        handler: (_args, context) =>
          new Promise((_resolve, reject) => {
            entered();
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            );
          }),
      },
    ],
  });
  try {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      fixture.manager.execute(fixture.session.id, scope, {
        id: crypto.randomUUID(),
        source: "await wait();",
        expectedSequence: 0,
        generation: 1,
        signal: cancelled.signal,
      }),
    ).rejects.toBeDefined();
    expect(
      (await fixture.manager.inspect(fixture.session.id, scope)).cells,
    ).toHaveLength(0);
    const controller = new AbortController();
    const running = fixture.run("console.log('accepted'); await wait();", {
      signal: controller.signal,
    });
    await called;
    controller.abort();
    expect((await running).cell.status).toBe("interrupted");
    expect(
      (await fixture.manager.inspect(fixture.session.id, scope)).status,
    ).toBe("lost");
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("worker death preserves source and logs and marks memory lost without replay", async () => {
  const fixture = await createSessionFixture();
  try {
    await fixture.run(
      "const response = 42; console.log('retained'); return response;",
    );
    process.kill(fixture.session.worker!.pid, "SIGKILL");
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        (await fixture.manager.inspect(fixture.session.id, scope)).status ===
        "lost"
      )
        break;
      await Bun.sleep(20);
    }
    const lost = await fixture.manager.inspect(fixture.session.id, scope);
    expect(lost.status).toBe("lost");
    expect(lost.cells[0].source).toContain("const response = 42");
    expect(lost.events.some((event) => event.kind === "execution.log")).toBe(
      true,
    );
    await expect(fixture.run("return response;")).rejects.toMatchObject({
      code: "session_unavailable",
    });
  } finally {
    await fixture.cleanup();
  }
}, 15_000);
