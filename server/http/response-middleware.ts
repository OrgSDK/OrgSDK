import { recordTokenActivity } from "../repositories/token-activity";
import { object } from "../shared/contracts";
import type { AppContext } from "./context";

async function requestFailed(
  response: Response,
  isMcp: boolean,
): Promise<boolean> {
  if (response.status >= 400) {
    return true;
  }
  if (!isMcp && response.status !== 207) {
    return false;
  }
  try {
    const body: unknown = await response.clone().json();
    if (Array.isArray(body)) {
      return body.some(
        (result: unknown) => object(result) && Object.hasOwn(result, "error"),
      );
    }
    return (
      object(body) &&
      (!!body.error || (object(body.result) && body.result.isError === true))
    );
  } catch {
    // MCP notifications have no response body.
    return false;
  }
}

export async function finishResponse(
  ctx: AppContext,
  response: Response,
): Promise<Response> {
  if (ctx.token) {
    const isMcp = new URL(ctx.request.url).pathname === "/mcp/";
    recordTokenActivity(
      ctx,
      ctx.token,
      response.status,
      isMcp,
      await requestFailed(response, isMcp),
    );
  }
  const headers = new Headers(response.headers);
  ctx.responseHeaders.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      headers.set(key, value);
    }
  });
  for (const cookie of ctx.responseHeaders.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "same-origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
