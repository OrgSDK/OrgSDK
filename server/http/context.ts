import type { AppDependencies, ServiceContext } from "../application";
import { identityRepository } from "../repositories/identity";
import { digest, randomSecret } from "../shared/security";
import { ServiceError } from "../shared/errors";

export type AppContext = ServiceContext & {
  request: Request;
  responseHeaders: Headers;
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
export function createContext(
  request: Request,
  store: AppDependencies,
): AppContext {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const workspace =
    identityRepository(store.db).workspaceForHost(hostname) ?? null;
  const values = cookies(request);
  const secret = values.get("sessionid");
  const session = secret
    ? identityRepository(store.db).session(digest(secret))
    : undefined;
  const validSession =
    session && session.expiresAt > Date.now() ? session : undefined;
  let user = validSession?.userId
    ? (identityRepository(store.db).user(validSession.userId) ?? null)
    : null;
  let token: ServiceContext["token"] = null;
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const found = identityRepository(store.db).tokenByDigest(
      digest(authorization.slice(7)),
    );
    if (found && !found.revoked && workspace?.id === found.workspaceId) {
      token = found;
      user = identityRepository(store.db).user(found.actorId) ?? null;
    } else {
      user = null;
    }
  }
  const membership =
    user && workspace
      ? identityRepository(store.db).membership(workspace.id, user.id)
      : undefined;
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  const ctx: AppContext = {
    request,
    userId: user?.id ?? null,
    operationType: ["GET", "HEAD", "OPTIONS"].includes(request.method)
      ? "query"
      : "mutation",
    origin: url.origin,
    hostname,
    db: store.db,
    secrets: store.secrets,
    user,
    workspace,
    role: membership?.role ?? null,
    token,
    responseHeaders,
    sessionId: validSession?.id ?? null,
  };
  if (!values.get("csrftoken")) {
    setCookie(ctx, "csrftoken", randomSecret());
  }
  return ctx;
}
export function checkCsrf(
  ctx: AppContext,
  operationType?: ServiceContext["operationType"],
): void {
  if (
    (operationType
      ? operationType !== "mutation"
      : ["GET", "HEAD", "OPTIONS"].includes(ctx.request.method)) ||
    ctx.token
  ) {
    return;
  }
  const origin = ctx.request.headers.get("origin");
  if (origin && origin !== new URL(ctx.request.url).origin) {
    throw new ServiceError("FORBIDDEN", "Invalid origin.");
  }
  const cookie = cookies(ctx.request).get("csrftoken");
  const header = ctx.request.headers.get("x-csrftoken");
  if (!cookie || !header || cookie !== header) {
    throw new ServiceError("FORBIDDEN", "CSRF verification failed.");
  }
}
