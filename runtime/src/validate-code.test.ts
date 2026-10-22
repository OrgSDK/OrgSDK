import { expect, test } from "bun:test";
import { validateCode } from "./validate-code";

const sdk = { plugins: [] };

test("validates actual semantic types with user source coordinates", () => {
  const result = validateCode(
    "const ok = 1;\nconst value: number = 'wrong';\nreturn ok;",
    sdk,
  );
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ line: 2, column: 7, code: 2322 }),
  );
  expect(validateCode("return await readFile('notes.txt');", sdk).valid).toBe(
    true,
  );
  expect(
    validateCode("return nonexistentBuiltin();", sdk).diagnostics.some(
      (diagnostic) => diagnostic.code === 2304,
    ),
  ).toBe(true);
});

test("defineParams infers installed Zod schemas", () => {
  const prefix =
    "const params = defineParams(z.object({count: z.number(), title: z.string()}));\n";
  const correct = validateCode(
    prefix +
      "const value: number = params.count; type Schema = z.infer<ReturnType<typeof z.string>>; const title: Schema = params.title; return title;",
    sdk,
  );
  expect(correct.diagnostics).toEqual([]);
  expect(
    validateCode(
      prefix + "const value: string = params.count; return value;",
      sdk,
    ).diagnostics.some((diagnostic) => diagnostic.code === 2322),
  ).toBe(true);
});

test("rejects imports, loading, exports and compiler references without evaluating code", () => {
  for (const source of [
    "import fs from 'node:fs'; return fs;",
    "return await import('node:fs');",
    "return require('node:fs');",
    "export const value = 1;",
    "type X = import('node:fs').Stats;",
    '/// <reference types="node" />\nreturn process.env;',
    '/// <reference path="/etc/passwd" />\nreturn 1;',
    '/// <reference lib="dom" />\nreturn window;',
  ])
    expect(validateCode(source, sdk).valid).toBe(false);
  expect(
    validateCode("return [process, window, require, document, fetch];", sdk)
      .diagnostics.length,
  ).toBe(5);
  expect(validateCode("throw new Error('must not execute');", sdk).valid).toBe(
    true,
  );
});

test("safe plugin signatures enforce types and incomplete metadata stays unknown", () => {
  const plugins = [
    {
      namespace: "example",
      available: true,
      metadata_complete: true,
      tools: [
        {
          name: "lookup",
          parameters: [{ name: "count", type: "number" }],
          returnType: "Promise<{title: string; count: number}>",
        },
      ],
    },
  ];
  expect(
    validateCode(
      "const result = await example.lookup(2); return result.title.toUpperCase();",
      { plugins },
    ).valid,
  ).toBe(true);
  expect(validateCode("return example.lookup('bad');", { plugins }).valid).toBe(
    false,
  );
  const incomplete = {
    plugins: [
      { namespace: "example", available: true, metadata_complete: false },
    ],
  };
  expect(
    validateCode("return await example.anyTool('input');", incomplete).valid,
  ).toBe(true);
  expect(
    validateCode(
      "const result = await example.anyTool(); return result.foo;",
      incomplete,
    ).valid,
  ).toBe(false);
});

test("metadata cannot inject declarations or expose arbitrary environment types", () => {
  const result = validateCode("return process;", {
    plugins: [
      { namespace: "readFile", available: true, metadata_complete: false },
      {
        namespace: "evil; declare var process: any",
        available: true,
        metadata_complete: false,
      },
      {
        namespace: "example",
        available: true,
        metadata_complete: true,
        tools: [
          {
            name: "run",
            parameters: [],
            returnType: "unknown; declare global {var process: any}",
          },
        ],
      },
    ],
  });
  expect(result.valid).toBe(false);
  expect(result.declarations).not.toContain("declare var process");
  expect(result.declarations).not.toContain("var process");
  expect(result.declarations).toContain("run(): Promise<unknown>");
});

test("bounds diagnostics, source and diagnostic text", () => {
  const result = validateCode(
    Array.from({ length: 150 }, (_, index) => `missing${index}();`).join("\n"),
    sdk,
  );
  expect(result.diagnostics).toHaveLength(100);
  expect(
    result.diagnostics.every(
      (diagnostic) =>
        diagnostic.message.length <= 2000 &&
        diagnostic.line > 0 &&
        diagnostic.column > 0,
    ),
  ).toBe(true);
  expect(validateCode("x".repeat(200_001), sdk).diagnostics[0].code).toBe(
    "invalid_source",
  );
  expect(validateCode("\ud800", sdk).valid).toBe(false);
  expect(validateCode("const = ;", sdk).valid).toBe(false);
});

test("declares the actual webhook, liveness and console globals without phantom constants", () => {
  const source =
    "const body = handleWebhook(z.object({count: z.number()})); const count: number = body.count; console.info(count); console.debug(count); resetTimeout(); keepAlive(1000).stop(); reportOutcome({count}); return count;";
  expect(validateCode(source, sdk).diagnostics).toEqual([]);
  expect(
    validateCode(
      "const body = handleWebhook(z.object({count: z.number()})); const count: string = body.count; return count;",
      sdk,
    ).valid,
  ).toBe(false);
  expect(
    validateCode("return constants;", sdk).diagnostics.some(
      (diagnostic) => diagnostic.code === 2304,
    ),
  ).toBe(true);
});
