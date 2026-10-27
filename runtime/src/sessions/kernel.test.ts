import { expect, test } from "bun:test";
import { SessionKernel } from "./kernel";

function fixture() {
  const calls: Array<{ cell: string; name: string; args: unknown[] }> = [];
  const events: Array<{ cell: string; kind: string; data: unknown }> = [];
  const kernel = new SessionKernel(["records.search", "echo"], {
    emit: (cell, kind, data) => events.push({ cell, kind, data }),
    call: async (cell, name, args) => {
      calls.push({ cell, name, args });
      return name === "echo" ? args[0] : { items: [{ id: 41 }] };
    },
  });
  let sequence = 0;
  return {
    kernel,
    calls,
    events,
    run: (source: string, inputs = {}) =>
      kernel.execute(String(++sequence), source, inputs),
  };
}

test("awaited responses, object identity and helpers persist without replay", async () => {
  const { run, calls } = fixture();
  expect(
    await run(
      "const response = await records.search({}); const same = response; response.items;",
    ),
  ).toMatchObject({ status: "succeeded", result: [{ id: 41 }] });
  expect(
    await run(
      "let count = response.items[0].id; function read() { return count; } count++; same === response;",
    ),
  ).toMatchObject({ status: "succeeded", result: true });
  expect(await run("return read();")).toMatchObject({
    status: "succeeded",
    result: 42,
  });
  expect(calls).toHaveLength(1);
});

test("const, redeclarations, shadowing, destructuring and shorthand retain semantics", async () => {
  const { run } = fixture();
  expect(
    (
      await run(
        "const {a = 2, b = a + 1, ...rest} = await echo({c: 4}); let [x, ...xs] = [a, b]; ({a, b, rest, x, xs});",
      )
    ).result,
  ).toEqual({ a: 2, b: 3, rest: { c: 4 }, x: 2, xs: [3] });
  expect(
    (
      await run(
        "x++; function local(a: number) { return a + x; } return local(10);",
      )
    ).result,
  ).toBe(13);
  expect((await run("a = 9;")).status).toBe("rejected");
  expect((await run("const a = 9;")).status).toBe("rejected");
  expect((await run("return {a, b, x};")).result).toEqual({ a: 2, b: 3, x: 3 });
});

test("prior types, classes, functions and per-cell inputs work in later cells", async () => {
  const { run, calls } = fixture();
  expect(
    (
      await run(
        "interface Row { id: number }; type Id = number; const row: Row = {id: 42}; class Box { constructor(public value: Id) {} }; function input() { return echo(actionParams.value); } return new Box(row.id).value;",
      )
    ).result,
  ).toBe(42);
  expect((await run("const wrong: Row = {id: 'bad'};")).status).toBe(
    "rejected",
  );
  expect((await run("return await input();", { value: 7 })).result).toBe(7);
  expect(calls.at(-1)).toMatchObject({ cell: "3", args: [7] });
});

test("runtime failure keeps mutations and logs; rejected code has no effects", async () => {
  const { run, events, calls } = fixture();
  expect(
    (
      await run(
        "let changed = 1; changed++; console.log('before failure'); throw new Error('inspect failed');",
      )
    ).status,
  ).toBe("failed");
  expect((await run("return changed;")).result).toBe(2);
  expect(
    (await run("await echo('must not run'); const broken: number = 'wrong';"))
      .status,
  ).toBe("rejected");
  expect(calls).toHaveLength(0);
  expect(events).toContainEqual({
    cell: "1",
    kind: "execution.log",
    data: { level: "log", message: "before failure" },
  });
  const diagnostic = await run("const good = 1;\nconst bad: number = 'wrong';");
  expect(diagnostic.diagnostics?.[0].line).toBe(2);
});

test("independent kernels do not share bindings and cells cannot load modules", async () => {
  const first = fixture();
  const second = fixture();
  await first.run("const privateValue = 42;");
  expect((await second.run("return privateValue;")).status).toBe("rejected");
  for (const source of [
    "await import('node:fs');",
    "export const value = 1;",
    "eval('1');",
    "enum State { Ready }",
    "return __orgsdk_session_bindings__;",
  ])
    expect((await second.run(source)).status).toBe("rejected");
});

test("class self bindings, inheritance, function defaults and declaration results remain consistent", async () => {
  const { run } = fixture();
  expect(
    (
      await run(
        "let amount = 42; class Base { static self = Base; value() { return amount; } } const Original = Base;",
      )
    ).result,
  ).toBeNull();
  expect(
    (
      await run(
        "class Child extends Original {} function read(value = amount) { return value; } return [new Child().value(), Original.self === Original, read()];",
      )
    ).result,
  ).toEqual([42, true, 42]);
  expect(
    (
      await run(
        "function overloaded(value: number): number; function overloaded(value: any) { return value; } return overloaded(7);",
      )
    ).result,
  ).toBe(7);
});

test("callbacks from an old cell cannot borrow the next cell's capability", async () => {
  const { run, calls } = fixture();
  expect(
    (
      await run(
        "let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); pending.then(() => echo('old')).catch(() => {}); return 'ready';",
      )
    ).status,
  ).toBe("succeeded");
  expect(
    (await run("release(); await Promise.resolve(); return await echo('new');"))
      .result,
  ).toBe("new");
  expect(calls).toEqual([{ cell: "2", name: "echo", args: ["new"] }]);
});
