import { eq } from "drizzle-orm";
import { sessions } from "../db/schema/core";
import { type AppContext, setCookie } from "../http/context";
import { json } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { authBody } from "./views";
export async function handleAuthSession(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  if (path === "/auth/session") {
    if (method === "DELETE") {
      if (ctx.sessionId)
        db.delete(sessions).where(eq(sessions.id, ctx.sessionId)).run();
      setCookie(ctx, "sessionid", "", true, 0);
      ctx.user = null;
      return json(authBody(ctx), 401);
    }
    if (method === "GET") {
      const session = ctx.sessionId
        ? identityRepository(ctx.store).session(ctx.sessionId)
        : undefined;
      return json(
        authBody(
          ctx,
          session?.pendingUserId ? ["mfa_authenticate"] : ["login"],
        ),
        ctx.user ? 200 : 401,
      );
    }
  }
  return null;
}
