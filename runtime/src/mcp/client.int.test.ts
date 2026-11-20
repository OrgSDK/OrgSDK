import { expect, test } from "bun:test";
import { McpRuntime } from "./client";
import { headerSchema } from "./contract";
import { approveTools } from "./aliases";
import { mcpFixture } from "./testing/server";

for (const mode of ["json", "sse"] as const) {
  for (const legacy of [false, true]) {
    test(`discovers and calls ${legacy ? "legacy" : "current"} HTTP with ${mode} results`, async () => {
      const fixture = mcpFixture({ mode, legacy, token: "synthetic-secret" });
      const connection = {
        id: crypto.randomUUID(),
        endpoint: fixture.endpoint,
        transport: "auto" as const,
        revision: 1,
        tools: [],
      };
      const signal = new AbortController().signal;
      const credentials = async () => ({
        Authorization: "Bearer synthetic-secret",
      });
      const discovery = new McpRuntime(connection, credentials, signal);
      let runtime: McpRuntime | undefined;
      try {
        const catalog = await discovery.discover();
        expect(catalog.tools[0]?.name).toBe("search_records");
        expect(fixture.calls).toBe(0);
        runtime = new McpRuntime(
          { ...connection, tools: approveTools(catalog.tools, []) },
          credentials,
          signal,
        );
        expect(
          await runtime.call("searchRecords", { query: "hello" }),
        ).toMatchObject({ structuredContent: { found: "hello" } });
        expect(fixture.calls).toBe(1);
        await expect(
          runtime.call("searchRecords", { query: 42 }),
        ).rejects.toThrow("input schema");
        await expect(runtime.call("unapproved", {})).rejects.toThrow(
          "approved",
        );
        expect(fixture.calls).toBe(1);
      } finally {
        await runtime?.close();
        await discovery.close();
        fixture.close();
      }
    }, 15000);
  }
}

test("auth errors do not fall back, and tool errors redact access headers", async () => {
  const fixture = mcpFixture({ token: "private-value", error: true });
  const target = {
    id: crypto.randomUUID(),
    endpoint: fixture.endpoint,
    transport: "auto" as const,
    revision: 1,
    tools: [],
  };
  const denied = new McpRuntime(
    target,
    async () => ({}),
    new AbortController().signal,
  );
  const allowed = new McpRuntime(
    target,
    async () => ({ Authorization: "Bearer private-value" }),
    new AbortController().signal,
  );
  let runtime: McpRuntime | undefined;
  try {
    expect((await denied.discover()).authRequired).toBe(true);
    const catalog = await allowed.discover();
    runtime = new McpRuntime(
      { ...target, tools: approveTools(catalog.tools, []) },
      async () => ({ Authorization: "Bearer private-value" }),
      new AbortController().signal,
    );
    await expect(
      runtime.call("searchRecords", { query: "failure" }),
    ).rejects.toThrow("[REDACTED]");
    expect(fixture.calls).toBe(1);
  } finally {
    await denied.close();
    await allowed.close();
    await runtime?.close();
    fixture.close();
  }
});

test("cancellation closes an in-flight call without retrying it", async () => {
  const fixture = mcpFixture({ delay: 500 });
  const controller = new AbortController();
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
    controller.signal,
  );
  try {
    const call = runtime.call("searchRecords", { query: "wait" });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(call).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
    expect(fixture.calls).toBeLessThanOrEqual(1);
  } finally {
    await runtime.close();
    fixture.close();
  }
});

test("custom authentication headers reach discovery and calls only at the configured server", async () => {
  const headers = headerSchema.parse({
    "X-API-Key": "synthetic-api-key",
    Cookie: "testsession=synthetic-session",
  });
  const fixture = mcpFixture({ headers });
  const connection = {
    id: crypto.randomUUID(),
    endpoint: fixture.endpoint,
    transport: "auto" as const,
    revision: 1,
    tools: [],
  };
  const discovery = new McpRuntime(
    connection,
    async () => headers,
    new AbortController().signal,
  );
  let runtime: McpRuntime | undefined;
  try {
    const catalog = await discovery.discover();
    expect(catalog.authRequired).toBe(false);
    runtime = new McpRuntime(
      { ...connection, tools: approveTools(catalog.tools, []) },
      async () => headers,
      new AbortController().signal,
    );
    expect(
      await runtime.call("searchRecords", { query: "custom headers" }),
    ).toMatchObject({ structuredContent: { found: "custom headers" } });
    expect(fixture.calls).toBe(1);
  } finally {
    await discovery.close();
    await runtime?.close();
    await fixture.close();
  }
});
