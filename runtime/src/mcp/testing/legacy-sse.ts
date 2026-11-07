import { serve } from "bun";
import { z } from "zod";

export function legacySseFixture() {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const requests: string[] = [];
  let closed = false;
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/sse" && request.method === "GET") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              closed = false;
              stream = controller;
              controller.enqueue(
                encoder.encode("event: endpoint\ndata: /messages\n\n"),
              );
            },
            cancel() {
              closed = true;
              stream = undefined;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.pathname !== "/messages" || request.method !== "POST")
        return new Response(null, { status: 405 });
      const message = z
        .object({
          id: z.union([z.string(), z.number()]).optional(),
          method: z.string(),
        })
        .parse(await request.json());
      requests.push(message.method);
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "legacy-sse-fixture", version: "1" },
            }
          : message.method === "tools/list"
            ? { tools: [{ name: "ping", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: "pong" }] };
      stream?.enqueue(
        encoder.encode(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`,
        ),
      );
      return new Response(null, { status: 202 });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}/sse`,
    requests,
    get closed() {
      return closed;
    },
    close() {
      server.stop(true);
    },
  };
}
