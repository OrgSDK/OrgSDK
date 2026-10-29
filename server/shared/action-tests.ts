import { z } from "zod";
import type { JsonObject } from "../db/types";
import type { actionVersions } from "../db/schema";
import { ServiceError } from "./errors";
import { validateContract } from "./contracts";

const toolName = z
  .string()
  .max(201)
  .regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$/);
const mockSchema = z
  .strictObject({
    tool: toolName,
    args: z.array(z.json()).max(30),
    result: z.json().optional(),
    error: z.string().optional(),
    times: z.number().int().min(1).max(100).default(1),
  })
  .refine(
    (mock) => Object.hasOwn(mock, "result") !== Object.hasOwn(mock, "error"),
    "Supply a result or error.",
  );
const casesSchema = z
  .array(
    z.strictObject({
      name: z.string().trim().min(1).max(200),
      inputs: z.record(z.string(), z.json()),
      expected: z.json(),
      mocks: z.array(mockSchema).max(100).default([]),
      forbidden_calls: z.array(toolName).max(100).default([]),
    }),
  )
  .min(1)
  .max(50);

export function validateCases(
  version: Pick<
    typeof actionVersions.$inferSelect,
    "inputSchema" | "outputSchema"
  >,
  value: unknown,
) {
  const parsed = casesSchema.safeParse(value);
  if (
    !parsed.success ||
    Buffer.byteLength(JSON.stringify(parsed.data)) > 200_000
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Provide 1 to 50 valid bounded test cases.",
    );
  }
  const names = new Set<string>();
  for (const testCase of parsed.data) {
    if (names.has(testCase.name)) {
      throw new ServiceError("BAD_REQUEST", "Test case names must be unique.");
    }
    names.add(testCase.name);
    validateContract(version.inputSchema, testCase.inputs);
    validateContract(version.outputSchema, testCase.expected);
  }
  return parsed.data.map((testCase): JsonObject => ({
    ...testCase,
    mocks: testCase.mocks.map((mock): JsonObject => ({
      tool: mock.tool,
      args: mock.args,
      times: mock.times,
      ...(mock.error === undefined
        ? { result: mock.result ?? null }
        : { error: mock.error }),
    })),
  }));
}
