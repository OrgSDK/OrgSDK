import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Store } from "./db";
import { createContext, checkCsrf } from "./context";
import { handleAuth } from "./auth";
import { handleDomain, handleWebhookIngress } from "./domain";
import { handleExecution } from "./execution";
import { handleMcp } from "./mcp";
import { appRouter } from "./trpc";
import { staticResponse } from "./static";
import { HttpError, json } from "./http";
import { eq, sql } from "drizzle-orm";
import { accessTokens } from "./db/domain";
import { publicRequest } from "./origin";

export function createApp(store: Store) {
  return async function fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api/health/")
      return json({ status: "ok", database: "sqlite", runtime: "bun" });
    if (
      !["/api/", "/trpc", "/mcp/", "/internal/"].some((prefix) =>
        path.startsWith(prefix),
      )
    ) {
      return (
        (await staticResponse(request)) ?? json({ detail: "Not found." }, 404)
      );
    }
    if (!path.startsWith("/internal/")) {
      try {
        request = publicRequest(request);
      } catch (error) {
        if (error instanceof HttpError)
          return json({ detail: error.message }, error.status);
        throw error;
      }
    }
    const ctx = createContext(request, store);
    let response: Response;
    try {
      if (path.startsWith("/internal/execution/v1/")) {
        response =
          (await handleExecution(ctx)) ?? json({ detail: "Not found." }, 404);
      } else {
        // Webhook ingress authenticates its own secret rather than a browser session.
        if (!path.startsWith("/api/v1/webhook-ingress/")) checkCsrf(ctx);
        const ingress = path.startsWith("/api/v1/webhook-ingress/")
          ? await handleWebhookIngress(ctx)
          : null;
        if (ingress) response = ingress;
        else if (path.startsWith("/trpc") || path.startsWith("/api/trpc")) {
          const endpoint = path.startsWith("/api/trpc") ? "/api/trpc" : "/trpc";
          response = await fetchRequestHandler({
            endpoint,
            req: request,
            router: appRouter,
            createContext: () => ctx,
          });
        } else {
          response =
            (await handleAuth(ctx)) ??
            (await handleMcp(ctx)) ??
            (await handleDomain(ctx)) ??
            json({ detail: "Not found." }, 404);
        }
      }
    } catch (error) {
      if (error instanceof HttpError)
        response = json(
          error.fields ??
            (path.startsWith("/api/auth/")
              ? {
                  status: error.status,
                  errors: [{ message: error.message }],
                  meta: { is_authenticated: !!ctx.user },
                }
              : { detail: error.message }),
          error.status,
        );
      else {
        // Do not log raw requests or submitted values, which may contain credentials.
        console.error(
          "Request failed:",
          error instanceof Error ? error.name : "unknown error",
        );
        response = json({ detail: "Unable to complete this request." }, 500);
      }
    }
    if (ctx.token) {
      const isMcp = path === "/mcp/";
      let failed = response.status >= 400;
      if (isMcp && !failed) {
        try {
          const body = await response.clone().json();
          failed = !!body.error || body.result?.isError === true;
        } catch {
          /* Notifications have no body. */
        }
      }
      const time = new Date().toISOString();
      store.db
        .update(accessTokens)
        .set({
          firstUsedAt: ctx.token.firstUsedAt ?? time,
          lastUsedAt: time,
          requestCount: sql`${accessTokens.requestCount} + 1`,
          ...(failed
            ? { errorCount: sql`${accessTokens.errorCount} + 1` }
            : { successCount: sql`${accessTokens.successCount} + 1` }),
          ...(isMcp
            ? { mcpRequestCount: sql`${accessTokens.mcpRequestCount} + 1` }
            : { restRequestCount: sql`${accessTokens.restRequestCount} + 1` }),
          lastTransport: isMcp ? "mcp" : "rest",
          lastOutcome: failed ? "error" : "success",
          lastStatusCode: response.status,
        })
        .where(eq(accessTokens.id, ctx.token.id))
        .run();
    }
    const headers = new Headers(response.headers);
    ctx.responseHeaders.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      headers.set(key, value);
    });
    for (const cookie of ctx.responseHeaders.getSetCookie())
      headers.append("Set-Cookie", cookie);
    headers.set("X-Content-Type-Options", "nosniff");
    if (!headers.has("Referrer-Policy"))
      headers.set("Referrer-Policy", "same-origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
