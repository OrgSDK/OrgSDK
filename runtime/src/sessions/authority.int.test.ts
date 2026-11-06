import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createSessionFixture, scope } from "./testing/session-fixture";

test("retained helpers use each cell's authority and secrets never enter the journal", async () => {
  const contexts: Array<{ cell: string; capability?: string }> = [];
  const fixture = await createSessionFixture({
    functions: [
      {
        name: "current",
        handler: (_args, context) => {
          contexts.push({
            cell: context.cellId,
            capability: context.capability,
          });
          return context.inputs.value;
        },
      },
    ],
  });
  try {
    const first = await fixture.run(
      "function read() { return current(); } return await read();",
      { inputs: { value: 1 }, capability: "first-secret-capability" },
    );
    const second = await fixture.run("return await read();", {
      inputs: { value: 2 },
      capability: "second-secret-capability",
    });
    expect(first.cell.result).toBe(1);
    expect(second.cell.result).toBe(2);
    expect(contexts).toEqual([
      { cell: first.cell.id, capability: "first-secret-capability" },
      { cell: second.cell.id, capability: "second-secret-capability" },
    ]);
    expect(
      await readFile(
        join(fixture.historyDirectory, `${fixture.session.id}.json`),
        "utf8",
      ),
    ).not.toContain("secret-capability");
    await fixture.manager.invalidate(
      fixture.session.id,
      scope,
      "Client revoked",
    );
    await expect(fixture.run("return await read();")).rejects.toMatchObject({
      code: "session_unavailable",
    });
    expect(contexts).toHaveLength(2);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);

test("capability echoes and failures are redacted across later cells and archives stay private", async () => {
  const fixture = await createSessionFixture({
    functions: [
      {
        name: "secret",
        handler: (_args, context) => ({
          value: context.capability,
          [context.capability!]: "key",
        }),
      },
      {
        name: "fail",
        handler: (_args, context) => {
          throw new Error(`Request failed: ${context.capability}`);
        },
      },
    ],
  });
  try {
    const first = await fixture.run(
      "const saved = await secret(); console.log(saved); return saved;",
      { capability: "first-private-capability" },
    );
    expect(first.cell.result).toEqual({
      value: "[redacted]",
      "[redacted]": "key",
    });
    expect(
      (
        await fixture.run("console.log(saved); return saved.value;", {
          capability: "second-private-capability",
        })
      ).cell.result,
    ).toBe("[redacted]");
    expect(
      (
        await fixture.run("await fail();", {
          capability: "third-private-capability",
        })
      ).cell.error,
    ).toContain("[redacted]");
    const closed = await fixture.manager.close(fixture.session.id, scope);
    const path = join(fixture.historyDirectory, `${fixture.session.id}.json`);
    const serialized = await readFile(path, "utf8");
    expect(serialized).not.toContain("private-capability");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(serialized)).toEqual(closed);
  } finally {
    await fixture.cleanup();
  }
}, 15_000);
