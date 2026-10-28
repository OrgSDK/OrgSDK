import { eq } from "drizzle-orm";
import { users } from "../db/schema/core";
import { type AppContext } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { handleWorkspace } from "../workspaces/routes";
import { handleHeadless } from "./headless";
import { handleSetup } from "./setup";
import { publicUser } from "./views";
export async function handleAuth(ctx: AppContext): Promise<Response | null> {
  const path = new URL(ctx.request.url).pathname;
  const method = ctx.request.method;
  const db = ctx.store.db;
  if (
    ctx.token &&
    (path.startsWith("/api/auth/") ||
      path.startsWith("/api/v1/workspaces/") ||
      path === "/api/v1/me/" ||
      path === "/api/v1/session/")
  )
    throw new HttpError(
      403,
      "Account and membership management requires a browser session.",
    );
  const setup = await handleSetup(ctx, path, method);
  if (setup) return setup;
  if (path === "/api/v1/session/" && method === "GET") {
    if (!identityRepository(ctx.store).anyWorkspace())
      return json(
        {
          detail: "Set up your workspace to continue.",
          code: "setup_required",
        },
        503,
      );
    return json({
      is_authenticated: !!ctx.user,
      user: ctx.user ? publicUser(ctx.user) : null,
    });
  }
  if (path === "/api/v1/me/" && ctx.user) {
    if (method === "GET") return json(publicUser(ctx.user));
    if (method === "PATCH") {
      const body = await input(ctx.request);
      const u = db
        .update(users)
        .set({
          firstName: String(body.first_name ?? ctx.user.firstName),
          lastName: String(body.last_name ?? ctx.user.lastName),
        })
        .where(eq(users.id, ctx.user.id))
        .returning()
        .get();
      return json(publicUser(u));
    }
  }
  if (path.startsWith("/api/auth/browser/v1/"))
    return handleHeadless(
      ctx,
      path.slice("/api/auth/browser/v1".length),
      method,
    );
  if (path.startsWith("/api/v1/workspaces/"))
    return handleWorkspace(ctx, path, method);
  return null;
}
