import { expect, test } from "bun:test";
import { createSessionFixture, scope } from "./testing/session-fixture";

test("cell deduplication never repeats effects and conflicts reject before execution", async () => {
  let calls = 0;
  const fixture = await createSessionFixture({
    functions: [{ name: "effect", handler: () => ++calls }],
  });
  try {
    const request = {
      id: crypto.randomUUID(),
      generation: 1,
      expectedSequence: 0,
      source: "return await effect();",
    };
    const replies = await Promise.all([
      fixture.manager.execute(fixture.session.id, scope, request),
      fixture.manager.execute(fixture.session.id, scope, request),
    ]);
    expect(replies[0].cell).toEqual(replies[1].cell);
    expect(calls).toBe(1);
    await expect(
      fixture.manager.execute(fixture.session.id, scope, {
        ...request,
        source: "return 2;",
      }),
    ).rejects.toMatchObject({ code: "cell_conflict" });
    await expect(
      fixture.manager.execute(fixture.session.id, scope, {
        ...request,
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "stale_sequence" });
    await fixture.manager.close(fixture.session.id, scope);
    expect(
      (await fixture.manager.execute(fixture.session.id, scope, request)).cell
        .result,
    ).toBe(1);
    expect(calls).toBe(1);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("owner/project checks, cursor validation and admission limits precede effects", async () => {
  const fixture = await createSessionFixture({ maxCells: 1 });
  try {
    for (const wrong of [
      { ...scope, ownerId: "other" },
      { ...scope, projectId: "other" },
      { ...scope, workspaceId: "other" },
    ])
      await expect(
        fixture.manager.inspect(fixture.session.id, wrong),
      ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      fixture.manager.open({
        ...scope,
        ownerId: "other",
        workspaceDirectory: fixture.workspaceDirectory,
        configurationRevision: "config-1",
      }),
    ).rejects.toMatchObject({ code: "project_busy" });
    await expect(
      fixture.manager.execute(fixture.session.id, scope, {
        id: crypto.randomUUID(),
        source: "return 1;",
        expectedSequence: 0,
        generation: 1,
        after: 999,
      }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    await fixture.run("return 42;");
    await expect(fixture.run("return 43;")).rejects.toMatchObject({
      code: "history_limit",
    });
    expect(
      (await fixture.manager.inspect(fixture.session.id, scope)).cells,
    ).toHaveLength(1);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("runtime failure preserves project effects and session state without replay", async () => {
  const fixture = await createSessionFixture();
  try {
    const failed = await fixture.run(
      "let count = 1; await writeFile('count.txt', String(count)); console.log('before error'); throw new Error('inspect failed');",
    );
    expect(failed.cell.status).toBe("failed");
    expect(failed.events.some((event) => event.kind === "execution.log")).toBe(
      true,
    );
    expect(
      (
        await fixture.run(
          "count++; return {count, file: await readFile('count.txt')};",
        )
      ).cell.result,
    ).toEqual({ count: 2, file: "1" });
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("concurrent appends serialize and equivalent object inputs deduplicate", async () => {
  const fixture = await createSessionFixture();
  try {
    const request = {
      id: crypto.randomUUID(),
      source: "return actionParams;",
      expectedSequence: 0,
      generation: 1,
      inputs: { a: 1, b: 2 },
    };
    const first = await fixture.manager.execute(
      fixture.session.id,
      scope,
      request,
    );
    expect(
      (
        await fixture.manager.execute(fixture.session.id, scope, {
          ...request,
          inputs: { b: 2, a: 1 },
        })
      ).cell,
    ).toEqual(first.cell);
    const replies = await Promise.allSettled([
      fixture.run("return 1;", { expectedSequence: 1 }),
      fixture.run("return 2;", { expectedSequence: 1 }),
    ]);
    expect(
      replies.filter((reply) => reply.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = replies.find(
      (reply) => reply.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "stale_sequence" });
    expect(
      (await fixture.manager.inspect(fixture.session.id, scope)).cells,
    ).toHaveLength(2);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);
