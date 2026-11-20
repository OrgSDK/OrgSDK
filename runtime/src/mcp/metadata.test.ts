import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, spyOn } from "bun:test";
import { approveTools } from "./aliases";
import { validateCode } from "../validate-code";
import { executeIsolated, isolatedInputSchema } from "../isolated-worker";

const tool = {
  name: "search_records",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, "odd-key": { type: "number" } },
    required: ["query"],
    additionalProperties: false,
  },
};
const sdk = {
  plugins: [
    {
      namespace: "customerTools",
      kind: "mcp",
      available: true,
      metadata_complete: true,
      tools: [
        {
          ...tool,
          name: "searchRecords",
          parameters: [],
          outputSchema: {
            type: "object",
            properties: { found: { type: "string" } },
            required: ["found"],
          },
        },
      ],
    },
  ],
};
test("aliases are deterministic, collision-safe, and stable across refreshed catalogues", () => {
  const first = approveTools(
    [
      tool,
      { ...tool, name: "search-records" },
      { ...tool, name: "constructor" },
    ],
    [],
  );
  expect(new Set(first.map((entry) => entry.alias)).size).toBe(3);
  expect(first.some((entry) => entry.alias === "constructor")).toBe(false);
  const second = approveTools([...first].reverse(), first);
  expect(second.map((entry) => entry.alias)).toEqual(
    first.map((entry) => entry.alias),
  );
});
test("remote JSON schemas produce safe object-argument declarations", () => {
  expect(
    validateCode(
      'return customerTools.searchRecords({query: "ok", "odd-key": 2});',
      sdk,
    ).valid,
  ).toBe(true);
  expect(
    validateCode("return customerTools.searchRecords({query: 42});", sdk).valid,
  ).toBe(false);
});
test("MCP action tests use existing mocks without credentials or live connections", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "mcp-isolation-"));
  const fetcher = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Remote access is forbidden in tests"),
  );
  try {
    const expected = { structuredContent: { found: "ok" } };
    const result = await executeIsolated(
      isolatedInputSchema.parse({
        operation: "test",
        source: 'return await customerTools.searchRecords({query: "ok"});',
        sdk,
        test_suite: {
          cases: [
            {
              name: "remote fixture",
              inputs: {},
              expected,
              mocks: [
                {
                  tool: "customerTools.searchRecords",
                  args: [{ query: "ok" }],
                  result: expected,
                },
              ],
            },
          ],
        },
      }),
      scratch,
    );
    expect(result).toMatchObject({ passed: true });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
    await rm(scratch, { recursive: true, force: true });
  }
});
