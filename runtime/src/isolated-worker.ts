import { isEntrypoint, readStdin } from "./process-runtime";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SandboxExecutor } from "./engine/sandbox/executor";
import type { SandboxFunction } from "./engine/sandbox/types";
import { projectFileFunctions } from "./project-files";
import { validateCode } from "./validate-code";

const json = z.json();
const toolName = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$/)
  .max(201);
const mockSchema = z
  .object({
    tool: toolName,
    args: z.array(json).max(30),
    result: json.optional(),
    error: z.string().max(2000).optional(),
    times: z.number().int().min(1).max(100).default(1),
  })
  .strict()
  .refine(
    (mock) => (mock.result !== undefined) !== (mock.error !== undefined),
    "Mocks require exactly one result or error",
  );
export const isolatedInputSchema = z
  .object({
    operation: z.enum(["validate", "test"]),
    source: z.string().refine((value) => Buffer.byteLength(value) <= 200_000),
    sdk: z
      .object({
        plugins: z
          .array(
            z
              .object({
                namespace: z.string().nullable(),
                available: z.boolean(),
                metadata_complete: z.boolean().optional(),
                tools: z
                  .array(
                    z
                      .object({
                        name: z.string(),
                        parameters: z
                          .array(
                            z.object({
                              name: z.string(),
                              type: z.string(),
                              optional: z.boolean().optional(),
                            }),
                          )
                          .optional(),
                        returnType: z.string().optional(),
                        returns: z.string().optional(),
                      })
                      .strip(),
                  )
                  .nullable()
                  .optional(),
              })
              .strip(),
          )
          .max(100)
          .optional(),
      })
      .strip(),
    test_suite: z
      .object({
        cases: z
          .array(
            z
              .object({
                name: z.string().max(200),
                inputs: z.record(z.string(), json),
                expected: json,
                mocks: z.array(mockSchema).max(100).default([]),
                forbidden_calls: z.array(toolName).max(100).default([]),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strip()
      .optional(),
    output_schema: z.record(z.string(), json).nullable().optional(),
  })
  .strict();
export type IsolatedInput = z.infer<typeof isolatedInputSchema>;
const deniedBuiltins = [
  "listTables",
  "getTable",
  "listTableRows",
  "writeTableRow",
  "deleteTableRow",
  "listDocuments",
  "readDocument",
  "writeDocument",
  "requestApproval",
  "saveArtifact",
  "saveMemory",
  "delegate",
  "fetch",
];
const fileNames = ["readFile", "writeFile", "listFiles", "removeFile"];

export async function executeIsolated(
  value: unknown,
  scratch = "/work",
  signal = new AbortController().signal,
) {
  const input = isolatedInputSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(input)) > 800_000)
    throw new Error("Isolated input exceeds 800000 bytes");
  const validation = validateCode(input.source, input.sdk);
  if (input.operation === "validate") return validation;
  if (!validation.valid) return { passed: false, validation, cases: [] };
  if (!input.test_suite) throw new Error("Test jobs require a test suite");
  const cases = [];
  for (const fixture of input.test_suite.cases) {
    signal.throwIfAborted();
    const root = await mkdtemp(join(scratch, "case-"));
    const violations: string[] = [];
    const violation = (message: string) => {
      if (violations.length < 20) violations.push(message.slice(0, 300));
    };
    const counts = fixture.mocks.map(() => 0);
    const logs: string[] = [];
    let actual: unknown;
    let error: string | undefined;
    try {
      const executor = new SandboxExecutor();
      const files = projectFileFunctions(root, signal);
      const tools = new Set([
        ...deniedBuiltins,
        ...fileNames,
        ...fixture.mocks.map((mock) => mock.tool),
        ...fixture.forbidden_calls,
      ]);
      for (const plugin of input.sdk.plugins ?? []) {
        if (!plugin.available || !plugin.namespace) continue;
        for (const tool of plugin.tools ?? [])
          tools.add(`${plugin.namespace}.${tool.name}`);
      }
      const functions = [...tools].map((tool): SandboxFunction => {
        const [category, name] = tool.includes(".")
          ? tool.split(".")
          : [undefined, tool];
        return {
          name: name!,
          ...(category
            ? {
                category: category.replace(
                  /[A-Z]/g,
                  (letter) => `-${letter.toLowerCase()}`,
                ),
              }
            : {}),
          calling: "positional",
          handler: (...args: unknown[]) => {
            signal.throwIfAborted();
            if (fixture.forbidden_calls.includes(tool)) {
              violation(`Forbidden call: ${tool}`);
              throw new Error(`Forbidden call: ${tool}`);
            }
            let normalizedArgs: unknown;
            try {
              const serialized = JSON.stringify(z.json().parse(args));
              if (Buffer.byteLength(serialized) > 200_000)
                throw new Error("Call arguments exceed limit");
              normalizedArgs = JSON.parse(serialized);
            } catch {
              violation(`Invalid call arguments: ${tool}`);
              throw new Error(`Invalid call arguments: ${tool}`);
            }
            const index = fixture.mocks.findIndex(
              (mock, index) =>
                mock.tool === tool &&
                counts[index]! < mock.times &&
                isDeepStrictEqual(normalizedArgs, mock.args),
            );
            if (index >= 0) {
              const mock = fixture.mocks[index]!;
              counts[index] = counts[index]! + 1;
              if (mock.error !== undefined) throw new Error(mock.error);
              return structuredClone(mock.result ?? null);
            }
            const file = files.find((file) => file.name === tool);
            if (file && !fixture.mocks.some((mock) => mock.tool === tool))
              return file.handler(...args);
            violation(`Unexpected call: ${tool}`);
            throw new Error(`Unexpected call: ${tool}`);
          },
        };
      });
      executor.registerBuiltins(functions.filter((fn) => !fn.category));
      executor.registerMultiple(functions.filter((fn) => fn.category));
      const result = await executor.execute(
        input.source,
        {
          agent: { id: "test", name: "Test" },
          stores: {},
          actionRunner: {},
          runId: "isolated",
        },
        {
          _isolatedCalls: {
            namespaces: (input.sdk.plugins ?? [])
              .filter((plugin) => plugin.available && plugin.namespace)
              .map((plugin) => plugin.namespace!),
            unknownCall: (tool) => {
              violation(`Unexpected call: ${tool}`);
              throw new Error(`Unexpected call: ${tool}`);
            },
          },
          parameters: fixture.inputs,
          signal,
          timeout: 5000,
          onLog: (line) => {
            if (logs.length < 20) logs.push(line.slice(0, 1000));
          },
        },
      );
      const serialized = JSON.stringify(z.json().parse(result.result ?? null));
      if (Buffer.byteLength(serialized) > 20_000)
        throw new Error("Case output exceeds 20000 bytes");
      actual = JSON.parse(serialized);

      if (!isDeepStrictEqual(actual, fixture.expected))
        violation("Output differs from expected");
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message.slice(0, 2000)
          : "Test execution failed";
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    fixture.mocks.forEach((mock, index) => {
      if (counts[index] !== mock.times)
        violation(`Unconsumed mock: ${mock.tool}`);
    });
    cases.push({
      name: fixture.name,
      passed: !error && violations.length === 0,
      actual,
      error,
      violations,
      logs,
    });
  }
  return { passed: cases.every((item) => item.passed), validation, cases };
}

if (isEntrypoint(import.meta.url)) {
  try {
    const output = await executeIsolated(
      JSON.parse(await readStdin(800_000)),
      process.cwd(),
    );
    const serialized = JSON.stringify(output);
    if (Buffer.byteLength(serialized) > 1_000_000)
      throw new Error("Isolated result exceeds limit");
    process.stdout.write(serialized);
  } catch (error) {
    process.stderr.write(
      error instanceof Error
        ? error.message.slice(0, 2000)
        : "Isolated execution failed",
    );
    process.exitCode = 1;
  }
}
