import type { FetchLike } from "@modelcontextprotocol/client";
import { endpointSchema } from "./contract";

export function endpointFetch(
  endpoint: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  limit = 1_000_000,
): FetchLike {
  const origin = new URL(endpointSchema.parse(endpoint)).origin;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== origin)
      throw new Error(
        "MCP request changed origin; configure the destination explicitly",
      );
    const authenticated = new Headers(request.headers);
    for (const [name, value] of Object.entries(headers))
      authenticated.set(name, value);
    const response = await fetch(request, {
      headers: authenticated,
      redirect: "error",
      signal: AbortSignal.any([signal, request.signal]),
    });
    if (!response.body) return response;
    let bytes = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > limit)
            throw new Error("MCP response exceeds the supported size");
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function redactMcp(
  value: unknown,
  headers: Record<string, string>,
): unknown {
  const secrets = Object.values(headers)
    .flatMap((header) => [header, header.replace(/^Bearer /i, "")])
    .filter(Boolean);
  const text = (input: string) =>
    secrets.reduce(
      (result, secret) => result.split(secret).join("[REDACTED]"),
      input,
    );
  const visit = (input: unknown): unknown => {
    if (typeof input === "string") return text(input);
    if (typeof input === "number" && secrets.includes(String(input)))
      return "[REDACTED]";
    if (Array.isArray(input)) return input.map(visit);
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [text(key), visit(item)]),
      );
    return input;
  };
  return visit(value);
}
