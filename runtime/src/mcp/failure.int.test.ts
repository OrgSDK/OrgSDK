import { expect, test } from "bun:test";
import { McpRuntime } from "./client";
import { mcpFixture } from "./testing/server";

for (const dialect of [
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft/2019-09/schema",
  "https://json-schema.org/draft/2020-12/schema",
]) {
  test(`input validation supports ${dialect}`, async () => {
    const fixture = mcpFixture();
    const runtime = new McpRuntime(
      {
        id: crypto.randomUUID(),
        endpoint: fixture.endpoint,
        transport: "streamable-http",
        revision: 1,
        tools: [
          {
            name: "search_records",
            alias: "searchRecords",
            inputSchema: {
              $schema: dialect,
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        ],
      },
      async () => ({}),
      new AbortController().signal,
    );
    try {
      await expect(
        runtime.call("searchRecords", { query: 42 }),
      ).rejects.toThrow("input schema");
      expect(fixture.calls).toBe(0);
      expect(
        await runtime.call("searchRecords", { query: "ok" }),
      ).toMatchObject({ structuredContent: { found: "ok" } });
    } finally {
      await runtime.close();
      await fixture.close();
    }
  });
}
test("an oversized response fails a call without replaying it", async () => {
  const fixture = mcpFixture();
  const runtime = new McpRuntime(
    {
      id: crypto.randomUUID(),
      endpoint: fixture.endpoint,
      transport: "auto",
      revision: 1,
      tools: [
        {
          name: "search_records",
          alias: "searchRecords",
          inputSchema: { type: "object" },
        },
      ],
    },
    async () => ({}),
    new AbortController().signal,
  );
  try {
    await expect(
      runtime.call("searchRecords", { query: "x".repeat(600_000) }),
    ).rejects.toThrow();
    expect(fixture.calls).toBe(1);
  } finally {
    await runtime.close();
    await fixture.close();
  }
});

test("a disconnect after dispatch never replays the tool call", async () => {
  const fixture = mcpFixture({ disconnect: true });
  const runtime = new McpRuntime(
    {
      id: crypto.randomUUID(),
      endpoint: fixture.endpoint,
      transport: "auto",
      revision: 1,
      tools: [
        {
          name: "search_records",
          alias: "searchRecords",
          inputSchema: { type: "object" },
        },
      ],
    },
    async () => ({}),
    new AbortController().signal,
  );
  try {
    await expect(
      runtime.call("searchRecords", { query: "effect" }),
    ).rejects.toThrow();
    expect(fixture.calls).toBe(1);
  } finally {
    await runtime.close();
    await fixture.close();
  }
});
