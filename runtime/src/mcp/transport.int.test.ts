import { expect, test } from "bun:test";
import { z } from "zod";
import { McpRuntime } from "./client";
import { approveTools } from "./aliases";
import { legacySseFixture } from "./testing/legacy-sse";

function target(endpoint: string) {
  return {
    id: crypto.randomUUID(),
    endpoint,
    transport: "auto" as const,
    revision: 1,
    tools: [],
  };
}
for (const transport of ["auto", "sse"] as const) {
  test(`legacy SSE discovery, call and cleanup using ${transport}`, async () => {
    const fixture = legacySseFixture();
    const connection = { ...target(fixture.endpoint), transport };
    const discovery = new McpRuntime(
      connection,
      async () => ({}),
      new AbortController().signal,
    );
    let runtime: McpRuntime | undefined;
    try {
      const catalog = await discovery.discover();
      expect(catalog.transport).toBe("sse");
      await discovery.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fixture.closed).toBe(true);
      runtime = new McpRuntime(
        { ...connection, tools: approveTools(catalog.tools, []) },
        async () => ({}),
        new AbortController().signal,
      );
      expect(await runtime.call("ping", {})).toMatchObject({
        content: [{ type: "text", text: "pong" }],
      });
      expect(
        fixture.requests.filter((method) => method === "tools/call"),
      ).toHaveLength(1);
      await runtime.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fixture.closed).toBe(true);
    } finally {
      await discovery.close();
      await runtime?.close();
      fixture.close();
    }
  });
}
for (const status of [401, 403, 500, 503]) {
  test(`HTTP ${status} never attempts legacy SSE`, async () => {
    const methods: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        methods.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response(null, { status });
      },
    });
    const runtime = new McpRuntime(
      target(`http://127.0.0.1:${server.port}/mcp`),
      async () => ({}),
      new AbortController().signal,
    );
    try {
      if (status < 500)
        expect((await runtime.discover()).authRequired).toBe(true);
      else await expect(runtime.discover()).rejects.toThrow();
      expect(methods).not.toContain("GET /mcp");
    } finally {
      await runtime.close();
      server.stop(true);
    }
  });
}
for (const repeated of [false, true]) {
  test(`discovery pagination ${repeated ? "rejects repeated cursors" : "preserves schemas"}`, async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.method !== "POST")
          return new Response(null, { status: 405 });
        const message = z
          .object({
            id: z.unknown().optional(),
            method: z.string(),
            params: z
              .object({ cursor: z.string().optional() })
              .passthrough()
              .optional(),
          })
          .parse(await request.json());
        if (message.method === "server/discover")
          return Response.json({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" },
          });
        if (message.id === undefined)
          return new Response(null, { status: 202 });
        const cursor = message.params?.cursor;
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: { name: "pages", version: "1" },
              }
            : {
                tools: [
                  {
                    name: cursor ? "second" : "first",
                    inputSchema: {
                      type: "object",
                      properties: {
                        value: {
                          anyOf: [{ type: "string" }, { type: "null" }],
                        },
                      },
                    },
                  },
                ],
                ...(!cursor || repeated ? { nextCursor: "next" } : {}),
              };
        return Response.json({ jsonrpc: "2.0", id: message.id, result });
      },
    });
    const runtime = new McpRuntime(
      target(`http://127.0.0.1:${server.port}/mcp`),
      async () => ({}),
      new AbortController().signal,
    );
    try {
      if (repeated) await expect(runtime.discover()).rejects.toThrow("cursor");
      else
        expect(
          (await runtime.discover()).tools.map((tool) => tool.name),
        ).toEqual(["first", "second"]);
    } finally {
      await runtime.close();
      server.stop(true);
    }
  });
}

test("credentials are never forwarded across an HTTP redirect", async () => {
  let received = 0;
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      received++;
      return Response.json({});
    },
  });
  const source = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.redirect(`http://127.0.0.1:${sink.port}/`, 307);
    },
  });
  const runtime = new McpRuntime(
    target(`http://127.0.0.1:${source.port}/mcp`),
    async () => ({ Authorization: "Bearer secret" }),
    new AbortController().signal,
  );
  try {
    await expect(runtime.discover()).rejects.toThrow();
    expect(received).toBe(0);
  } finally {
    await runtime.close();
    source.stop(true);
    sink.stop(true);
  }
});
