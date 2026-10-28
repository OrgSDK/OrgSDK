import { Hono } from "hono";
import type { Store } from "./db";
import { handleApi } from "./http/api";
import { json } from "./http/responses";
import { staticResponse } from "./http/static";

export function createApp(
  store: Store,
): (request: Request) => Promise<Response> {
  const app = new Hono();
  app.all("/api/health/", () =>
    json({ status: "ok", database: "sqlite", runtime: "bun" }),
  );
  for (const path of ["/api/*", "/trpc", "/trpc/*", "/mcp/*", "/internal/*"]) {
    app.all(path, (context) => handleApi(context.req.raw, store));
  }
  app.all(
    "*",
    async (context) =>
      (await staticResponse(context.req.raw)) ??
      json({ detail: "Not found." }, 404),
  );
  return async (request) => app.fetch(request);
}
