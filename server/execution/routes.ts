import { inTransaction } from "../db/transaction";
import type { AppContext } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { executor, live, runCapability } from "./authority";
import { bootstrap } from "./bootstrap";
import { claim } from "./claim";
import { configuration } from "./configuration";
import { serveCredential } from "./credentials";
import { handleProduct } from "./product";
import { register } from "./register";
import { handleRunUpdate } from "./run-update";
export async function handleExecution(
  ctx: AppContext,
): Promise<Response | null> {
  const path = new URL(ctx.request.url).pathname;
  if (!path.startsWith("/internal/execution/v1/")) {
    return null;
  }
  const route = path.slice("/internal/execution/v1/".length);
  const method = ctx.request.method;
  const body =
    method === "POST" && !["claim/", "bootstrap/"].includes(route)
      ? await input(ctx.request)
      : {};
  const credentialRoute = route.match(/^credentials\/([^/]+)\/$/);
  if (credentialRoute && method === "GET") {
    return serveCredential(ctx, credentialRoute[1]!);
  }
  return inTransaction(ctx, (ctx) => {
    if (route === "bootstrap/" && method === "POST") {
      return bootstrap(ctx);
    }
    if (["register/", "configuration/", "claim/"].includes(route)) {
      return handleWorker(ctx, route, method, body);
    }
    const runMatch = route.match(
      /^runs\/([^/]+)\/(heartbeat|events|complete)\/$/,
    );
    const run = runCapability(ctx, runMatch?.[1]);
    if (runMatch && method === "POST") {
      return handleRunUpdate(ctx, run, runMatch[2]!, body);
    }
    live(run);
    return handleProduct(ctx, run, route, method, body);
  });
}

export function handleWorker(
  ctx: AppContext,
  route: string,
  method: string,
  body: Record<string, unknown>,
): Response {
  const worker = executor(ctx);
  if (route === "register/" && method === "POST") {
    return register(ctx, worker, body);
  }
  if (route === "configuration/" && method === "GET") {
    return json(configuration(ctx, worker));
  }
  if (route !== "claim/" || method !== "POST") {
    throw new HttpError(405, "Method not allowed.");
  }
  return claim(ctx, worker);
}
