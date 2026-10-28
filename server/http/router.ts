import { Hono } from "hono";
import type { AppContext } from "./context";

type RouterEnvironment = { Bindings: { app: AppContext; matched: boolean } };

export function createRouter() {
  const router = new Hono<RouterEnvironment>({ strict: false });
  // Errors belong to the application's shared error boundary, including tRPC calls.
  router.onError((error) => {
    throw error;
  });
  router.notFound((context) => {
    context.env.matched = false;
    return new Response(null, { status: 404 });
  });
  return router;
}

export async function dispatch(
  router: ReturnType<typeof createRouter>,
  ctx: AppContext,
): Promise<Response | null> {
  const environment = { app: ctx, matched: true };
  const response = await router.fetch(ctx.request, environment);
  return environment.matched ? response : null;
}
