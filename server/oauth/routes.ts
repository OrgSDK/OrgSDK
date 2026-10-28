import type { AppContext } from "../http/context";
import { finish } from "./callback";
import { begin } from "./connect";
import { type Fetcher } from "./providers";
export async function handleOAuth(
  ctx: AppContext,
  fetcher: Fetcher = fetch,
): Promise<Response | null> {
  const path = new URL(ctx.request.url).pathname;
  if (
    path === "/api/v1/credentials/oauth-connect/" &&
    ctx.request.method === "POST"
  )
    return begin(ctx);
  if (
    path === "/api/v1/credentials/oauth-callback/" &&
    ctx.request.method === "GET"
  )
    return finish(ctx, fetcher);
  return null;
}
