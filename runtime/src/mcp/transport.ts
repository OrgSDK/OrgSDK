import {
  StreamableHTTPClientTransport,
  SSEClientTransport,
  type FetchLike,
  type Transport,
} from "@modelcontextprotocol/client";

export type McpTransportFactory = (
  endpoint: string,
  kind: "streamable-http" | "sse",
  fetcher: FetchLike,
) => Transport;

/** Transport construction stays independent of discovery and tool execution. */
export const httpTransport: McpTransportFactory = (endpoint, kind, fetcher) =>
  kind === "sse"
    ? new SSEClientTransport(new URL(endpoint), { fetch: fetcher })
    : new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: fetcher,
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1,
        },
        onInsufficientScope: "throw",
      });
