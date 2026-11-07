import { z } from "zod";
import type { FetchLike } from "@modelcontextprotocol/client";
import { checkOAuthDestination } from "./oauth-destination";
import { ServiceError } from "../shared/errors";

export function oauthFetch(
  endpoint: string,
  suppliedResource?: unknown,
): FetchLike {
  const origin = new URL(endpoint).origin;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      suppliedResource &&
      url.origin === origin &&
      url.pathname.includes("/.well-known/oauth-protected-resource")
    ) {
      return Response.json(suppliedResource);
    }
    await checkOAuthDestination(request.url, endpoint);
    const response = await fetch(request, {
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    const reader = response.body?.getReader();
    if (!reader) {
      return response;
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) {
          break;
        }
        length += item.value.byteLength;
        if (length > 200_000) {
          throw new ServiceError("BAD_REQUEST", "OAuth response is too large.");
        }
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
    }
    if (response.status >= 400) {
      let code = "server_error";
      try {
        const parsed = z
          .object({
            error: z.enum([
              "invalid_request",
              "invalid_client",
              "invalid_grant",
              "unauthorized_client",
              "unsupported_grant_type",
              "invalid_scope",
              "access_denied",
              "server_error",
              "temporarily_unavailable",
            ]),
          })
          .safeParse(JSON.parse(Buffer.concat(chunks).toString()));
        if (parsed.success) {
          code = parsed.data.error;
        }
      } catch {
        /* Provider diagnostics may echo secrets; expose only a standard error code. */
      }
      return Response.json(
        {
          error: code,
          error_description:
            "MCP authorization failed. Check connection settings or reconnect.",
        },
        { status: response.status },
      );
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    });
  };
}
