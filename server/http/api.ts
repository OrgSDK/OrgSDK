import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { handleMcp } from "../api/mcp";
import { appRouter } from "../api/trpc";
import { handleAuth } from "../auth/routes";
import { handleWebhookIngress } from "../automations/ingress";
import type { Store } from "../db";
import { handleDomain } from "../domain/routes";
import { handleExecution } from "../execution/routes";
import { checkCsrf, createContext, type AppContext } from "./context";
import { publicRequest } from "./origin";
import { finishResponse } from "./response-middleware";
import { HttpError, json } from "./responses";

function isEndpoint(path: string, endpoint: string): boolean {
  return path === endpoint || path.startsWith(`${endpoint}/`);
}

async function dispatch(ctx: AppContext, path: string): Promise<Response> {
  if (path.startsWith("/internal/execution/v1/")) {
    return (await handleExecution(ctx)) ?? json({ detail: "Not found." }, 404);
  }
  // Webhooks authenticate a secret; all other public mutations require CSRF.
  if (path.startsWith("/api/v1/webhook-ingress/")) {
    return (
      (await handleWebhookIngress(ctx)) ?? json({ detail: "Not found." }, 404)
    );
  }
  checkCsrf(ctx);
  for (const endpoint of ["/trpc", "/api/trpc"]) {
    if (isEndpoint(path, endpoint)) {
      return fetchRequestHandler({
        endpoint,
        req: ctx.request,
        router: appRouter,
        createContext: () => ctx,
      });
    }
  }
  return (
    (await handleAuth(ctx)) ??
    (await handleMcp(ctx)) ??
    (await handleDomain(ctx)) ??
    json({ detail: "Not found." }, 404)
  );
}

function errorResponse(
  error: unknown,
  path: string,
  ctx?: AppContext,
): Response {
  if (error instanceof HttpError) {
    return json(
      error.fields ??
        (path.startsWith("/api/auth/")
          ? {
              status: error.status,
              errors: [{ message: error.message }],
              meta: { is_authenticated: !!ctx?.user },
            }
          : { detail: error.message }),
      error.status,
    );
  }
  // Do not log submitted values or raw requests: they can contain credentials.
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "unknown error",
  );
  return json({ detail: "Unable to complete this request." }, 500);
}

export async function handleApi(
  request: Request,
  store: Store,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  let ctx: AppContext | undefined;
  let response: Response;
  try {
    if (!path.startsWith("/internal/")) request = publicRequest(request);
    ctx = createContext(request, store);
    response = await dispatch(ctx, path);
  } catch (error) {
    response = errorResponse(error, path, ctx);
  }
  return ctx ? finishResponse(ctx, response) : response;
}
