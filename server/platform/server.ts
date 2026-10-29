import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";

interface ServerOptions {
  hostname: string;
  port: number;
  fetch(request: Request): Promise<Response>;
}

export interface HttpServer {
  port: number;
  stop(force: boolean): Promise<void>;
}

const bodyLimit = 2_000_000;

class BodyLimitError extends Error {}

async function requestBody(
  incoming: IncomingMessage,
): Promise<ArrayBuffer | undefined> {
  if (incoming.method === "GET" || incoming.method === "HEAD") {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
    if (!Buffer.isBuffer(chunk)) {
      throw new Error("Invalid request body");
    }
    length += chunk.length;
    if (length > bodyLimit) {
      throw new BodyLimitError("Request body exceeds 2000000 bytes");
    }
    chunks.push(chunk);
  }
  return Uint8Array.from(Buffer.concat(chunks)).buffer;
}

async function sendResponse(
  response: Response,
  outgoing: ServerResponse,
): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") {
      outgoing.setHeader(name, value);
    }
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    outgoing.setHeader("set-cookie", cookies);
  }
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  const closed = new AbortController();
  const cancel = () => {
    closed.abort();
    void reader.cancel().catch(() => {});
  };
  outgoing.once("close", cancel);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done || outgoing.destroyed) {
        break;
      }
      if (!outgoing.write(chunk.value)) {
        await once(outgoing, "drain", { signal: closed.signal });
      }
    }
    outgoing.end();
  } finally {
    outgoing.off("close", cancel);
    reader.releaseLock();
  }
}

async function nodeServer(options: ServerOptions): Promise<HttpServer> {
  const server = createServer((incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) {
        controller.abort();
      }
    });
    const handle = async () => {
      const body = await requestBody(incoming);
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        const value = incoming.rawHeaders[index + 1];
        if (name && value) {
          headers.append(name, value);
        }
      }
      const authority =
        headers.get("host") ?? `${options.hostname}:${options.port}`;
      const request = new Request(`http://${authority}${incoming.url ?? "/"}`, {
        method: incoming.method ?? "GET",
        headers,
        ...(body ? { body } : {}),
        signal: controller.signal,
      });
      await sendResponse(await options.fetch(request), outgoing);
    };
    void handle().catch((error: unknown) => {
      if (outgoing.headersSent || outgoing.destroyed) {
        outgoing.destroy();
        return;
      }
      outgoing.statusCode = error instanceof BodyLimitError ? 413 : 500;
      if (error instanceof BodyLimitError) {
        outgoing.setHeader("Connection", "close");
      }
      outgoing.end(
        error instanceof BodyLimitError
          ? "Request body too large"
          : "Request failed",
      );
    });
  });
  server.timeout = 75_000;
  server.listen(options.port, options.hostname);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }
  return {
    port: address.port,
    stop: (force) =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        if (force) {
          server.closeAllConnections();
        }
      }),
  };
}

export async function serve(options: ServerOptions): Promise<HttpServer> {
  if (typeof Bun !== "undefined") {
    const server = Bun.serve({
      ...options,
      maxRequestBodySize: bodyLimit,
      idleTimeout: 75,
    });
    if (!server.port) {
      throw new Error("Server did not bind to a TCP port");
    }
    return {
      port: server.port,
      stop: async (force) => {
        await server.stop(force);
      },
    };
  }
  return nodeServer(options);
}
