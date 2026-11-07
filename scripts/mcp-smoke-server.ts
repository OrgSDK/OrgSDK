import { createServer } from "node:http";
import { z } from "zod";

/** Ordinary legacy Streamable HTTP, served independently of the installed SDK. */
export async function mcpSmokeServer() {
  let calls = 0;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      if (request.headers.authorization !== "Bearer package-mcp-secret") {
        response.writeHead(401).end();
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
      }
      const message = z
        .object({
          id: z.union([z.string(), z.number()]).optional(),
          method: z.string(),
          params: z.unknown().optional(),
        })
        .parse(JSON.parse(body));
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const send = (result: unknown, error = false) => {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            [error ? "error" : "result"]: result,
          }),
        );
      };
      if (message.method === "server/discover") {
        send({ code: -32601, message: "Method not found" }, true);
        return;
      }
      if (message.method === "initialize") {
        send({
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "acceptance", version: "1" },
        });
        return;
      }
      if (message.method === "tools/list") {
        send({
          tools: [
            {
              name: "search_records",
              description: "Find a test record",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        });
        return;
      }
      if (message.method === "tools/call") {
        calls++;
        send({
          content: [{ type: "text", text: "found" }],
          structuredContent: { found: true },
        });
        return;
      }
      send({ code: -32601, message: "Method not found" }, true);
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("MCP fixture did not start");
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    get calls() {
      return calls;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")
            ? reject(error)
            : resolve(),
        ),
      );
    },
  };
}
