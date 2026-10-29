import type { AppContext } from "../http/context";
import { finishOAuth } from "./callback";
import { oauthCallbackSchema } from "./schemas";
import type { Fetcher } from "./providers";
export async function handleOAuthCallback(
  ctx: AppContext,
  fetcher: Fetcher = fetch,
) {
  const input = oauthCallbackSchema.parse(
    Object.fromEntries(new URL(ctx.request.url).searchParams),
  );
  const result = await finishOAuth(ctx, input, fetcher);
  return new Response(null, {
    status: 302,
    headers: {
      Location: result.location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
