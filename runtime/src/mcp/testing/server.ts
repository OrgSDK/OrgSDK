import { serve } from "bun";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function mcpFixture(
  options: {
    mode?: "json" | "sse";
    legacy?: boolean;
    token?: string;
    headers?: Record<string, string>;
    error?: boolean;
    delay?: number;
    disconnect?: boolean;
  } = {},
) {
  const requests: { method: string; authorization: string | null }[] = [];
  let calls = 0;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "orgsdk-test", version: "1" });
      server.registerTool(
        "search_records",
        {
          description: "Find a synthetic record",
          inputSchema: z.object({ query: z.string() }),
          outputSchema: z.object({ found: z.string() }),
        },
        async ({ query }) => {
          calls++;
          if (options.delay)
            await new Promise((resolve) => setTimeout(resolve, options.delay));
          if (options.error)
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `Failure ${options.token ?? "synthetic"}`,
                },
              ],
            };
          return {
            content: [{ type: "text" as const, text: query }],
            structuredContent: { found: query },
          };
        },
      );
      return server;
    },
    { responseMode: options.mode ?? "json" },
  );
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (
        Object.entries(options.headers ?? {}).some(
          ([name, value]) => request.headers.get(name) !== value,
        )
      )
        return new Response(null, { status: 401 });
      if (
        options.token &&
        request.headers.get("authorization") !== `Bearer ${options.token}`
      )
        return new Response(null, {
          status: 401,
          headers: { "www-authenticate": "Bearer" },
        });
      if (request.method === "POST") {
        const body = z
          .object({ method: z.string().optional() })
          .parse(await request.clone().json());
        requests.push({
          method: body.method ?? "",
          authorization: request.headers.get("authorization"),
        });
        if (options.disconnect && body.method === "tools/call") {
          calls++;
          void server.stop(true);
          return new Response(null, { status: 503 });
        }

        if (options.legacy && body.method === "server/discover")
          return Response.json({
            jsonrpc: "2.0",
            id: z
              .object({ id: z.unknown() })
              .parse(await request.clone().json()).id,
            error: { code: -32601, message: "Method not found" },
          });
      }
      return handler.fetch(request);
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}/mcp`,
    requests,
    get calls() {
      return calls;
    },
    close: () => server.stop(true),
  };
}
