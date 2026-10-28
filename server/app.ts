import type { AppDependencies } from "./application";
import { handleApi } from "./http/api";
import { json } from "./http/responses";
import { staticResponse } from "./http/static";

export function createApp(
  dependencies: AppDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (
      path === "/trpc" ||
      path.startsWith("/trpc/") ||
      path === "/mcp/" ||
      path.startsWith("/internal/execution/v1/") ||
      /^\/webhooks\/[^/]+\/?$/.test(path) ||
      path === "/oauth/callback"
    ) {
      return handleApi(request, dependencies);
    }
    // Retired API paths must never resolve to a static application page.
    if (path === "/api" || path.startsWith("/api/")) {
      return json({ detail: "Not found." }, 404);
    }
    return (
      (await staticResponse(request)) ?? json({ detail: "Not found." }, 404)
    );
  };
}
