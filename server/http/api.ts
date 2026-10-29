import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { ZodError } from "zod";
import { handleMcp } from "../api/mcp";
import { handleWebhookIngress } from "../automations/ingress";
import type { AppDependencies } from "../application";
import { handleExecution } from "../execution/routes";
import { handleOAuthCallback } from "../oauth/transport";
import { appRouter } from "../router";
import { ServiceError, serviceErrorStatus } from "../shared/errors";
import { checkCsrf, createContext, type AppContext } from "./context";
import { publicRequest } from "./origin";
import { finishResponse } from "./response-middleware";
import { HttpError, json } from "./responses";

async function dispatch(context: AppContext, path: string): Promise<Response> {
  if (path === "/trpc" || path.startsWith("/trpc/")) {
    return fetchRequestHandler({
      endpoint: "/trpc",
      req: context.request,
      router: appRouter,
      createContext: () => context,
    });
  }
  if (path.startsWith("/internal/execution/v1/")) {
    return (
      (await handleExecution(context)) ?? json({ detail: "Not found." }, 404)
    );
  }
  if (path.startsWith("/webhooks/")) {
    return (
      (await handleWebhookIngress(context)) ??
      json({ detail: "Not found." }, 404)
    );
  }
  if (path === "/oauth/callback" && context.request.method === "GET") {
    return handleOAuthCallback(context);
  }
  if (path === "/mcp/") {
    checkCsrf(context);
    return (await handleMcp(context)) ?? json({ detail: "Not found." }, 404);
  }
  return json({ detail: "Not found." }, 404);
}

function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError) {
    return json({ detail: error.message }, serviceErrorStatus[error.code]);
  }
  if (error instanceof ZodError) {
    return json({ detail: "Invalid input." }, 400);
  }
  if (error instanceof HttpError) {
    return json(error.fields ?? { detail: error.message }, error.status);
  }
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "unknown error",
  );
  return json({ detail: "Unable to complete this request." }, 500);
}

export async function handleApi(
  request: Request,
  dependencies: AppDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  let context: AppContext | undefined;
  let response: Response;
  try {
    if (!path.startsWith("/internal/")) {
      request = publicRequest(request);
    }
    context = createContext(request, dependencies);
    response = await dispatch(context, path);
  } catch (error) {
    response = errorResponse(error);
  }
  return context ? finishResponse(context, response) : response;
}
