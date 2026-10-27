import { and, eq } from "drizzle-orm";
import type { Store } from "./db";
import { users, workspaces, memberships, sessions } from "./db/core";
import { accessTokens } from "./db/domain";
import { digest, randomSecret } from "./security";
import { HttpError } from "./http";

type User = typeof users.$inferSelect;
type Workspace = typeof workspaces.$inferSelect;
type Token = typeof accessTokens.$inferSelect;
export type AppContext = {
  request: Request;
  store: Store;
  user: User | null;
  workspace: Workspace | null;
  role: string | null;
  token: Token | null;
  responseHeaders: Headers;
  sessionId: string | null;
};
function cookies(request: Request): Map<string, string> {
  return new Map(
    (request.headers.get("cookie") ?? "").split(";").map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? ["", ""]
        : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
}
export function setCookie(
  ctx: AppContext,
  name: string,
  value: string,
  httpOnly = false,
  maxAge = 86400 * 14,
) {
  const secure =
    new URL(ctx.request.url).protocol === "https:" ? "; Secure" : "";
  ctx.responseHeaders.append(
    "Set-Cookie",
    `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? "; HttpOnly" : ""}${secure}`,
  );
}
export function createContext(request: Request, store: Store): AppContext {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const workspace =
    store.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.host, hostname))
      .get() ?? null;
  const values = cookies(request);
  const secret = values.get("sessionid");
  const session = secret
    ? store.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, digest(secret)))
        .get()
    : undefined;
  const validSession =
    session && session.expiresAt > Date.now() ? session : undefined;
  let user = validSession?.userId
    ? (store.db
        .select()
        .from(users)
        .where(eq(users.id, validSession.userId))
        .get() ?? null)
    : null;
  let token: Token | null = null;
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const found = store.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.digest, digest(authorization.slice(7))))
      .get();
    if (found && !found.revoked && workspace?.id === found.workspaceId) {
      token = found;
      user =
        store.db
          .select()
          .from(users)
          .where(eq(users.id, found.actorId))
          .get() ?? null;
    } else user = null;
  }
  const membership =
    user && workspace
      ? store.db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, user.id),
              eq(memberships.workspaceId, workspace.id),
            ),
          )
          .get()
      : undefined;
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  const ctx: AppContext = {
    request,
    store,
    user,
    workspace,
    role: membership?.role ?? null,
    token,
    responseHeaders,
    sessionId: validSession?.id ?? null,
  };
  if (!values.get("csrftoken")) setCookie(ctx, "csrftoken", randomSecret());
  return ctx;
}
export function requireUser(ctx: AppContext): User {
  if (!ctx.user) throw new HttpError(401, "Authentication required.");
  return ctx.user;
}
export function requireWorkspace(ctx: AppContext): Workspace {
  requireUser(ctx);
  if (!ctx.workspace)
    throw new HttpError(404, "Unregistered workspace domain.");
  if (!ctx.role)
    throw new HttpError(403, "You are not a member of this workspace.");
  return ctx.workspace;
}
export function requireManager(ctx: AppContext): Workspace {
  const workspace = requireWorkspace(ctx);
  if (!["owner", "admin"].includes(ctx.role!))
    throw new HttpError(
      403,
      "Only workspace owners and admins can manage this workspace.",
    );
  return workspace;
}
export function checkCsrf(ctx: AppContext): void {
  if (["GET", "HEAD", "OPTIONS"].includes(ctx.request.method) || ctx.token)
    return;
  const origin = ctx.request.headers.get("origin");
  if (origin && origin !== new URL(ctx.request.url).origin)
    throw new HttpError(403, "Invalid origin.");
  const cookie = cookies(ctx.request).get("csrftoken");
  const header = ctx.request.headers.get("x-csrftoken");
  if (!cookie || !header || cookie !== header)
    throw new HttpError(403, "CSRF verification failed.");
}
