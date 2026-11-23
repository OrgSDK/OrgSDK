import { studioAudience, studioSession } from "../auth/studio";
import type { AppDependencies, ServiceContext } from "../application";
import { identityRepository } from "../repositories/identity";
import { digest, randomSecret } from "../shared/security";
import { ServiceError } from "../shared/errors";
import { mcpAccessTokenSchema, mcpTokenPrefix } from "../tokens/access-token";

export type AppContext = ServiceContext & {
  request: Request;
  responseHeaders: Headers;
  clientTokenError: string | null;
  studioOrigin?: string | undefined;
  studioExpiresAt?: number | undefined;
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
  if (ctx.studioOrigin) {
    return;
  }
  const secure =
    new URL(ctx.request.url).protocol === "https:" ? "; Secure" : "";
  ctx.responseHeaders.append(
    "Set-Cookie",
    `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? "; HttpOnly" : ""}${secure}`,
  );
}
function authenticateClientBearer(
  authorization: string | null,
  identities: ReturnType<typeof identityRepository>,
  workspaceId: number | undefined,
): Pick<AppContext, "token" | "clientTokenError"> {
  const bearer = authorization?.match(/^Bearer(?:[ \t]+(.*))?$/i);
  if (!bearer) {
    return { token: null, clientTokenError: null };
  }
  const supplied = mcpAccessTokenSchema.safeParse(bearer[1]);
  if (!supplied.success) {
    return {
      token: null,
      clientTokenError: `Expected an OrgSDK access token beginning with ${mcpTokenPrefix} followed by its 43-character secret.`,
    };
  }
  const token =
    workspaceId === undefined
      ? null
      : (identities.activeClientToken(workspaceId, supplied.data) ?? null);
  return {
    token,
    clientTokenError: token ? null : "Invalid OrgSDK access token.",
  };
}

export function createContext(
  request: Request,
  store: AppDependencies,
): AppContext {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const identities = identityRepository(store.db);
  const workspace = identities.workspaceForHost(hostname) ?? null;
  const origin = request.headers.get("origin");
  const studioOrigin =
    origin &&
    url.pathname.startsWith("/trpc/") &&
    origin === studioAudience(url.origin)
      ? origin
      : undefined;
  const grant = studioOrigin
    ? studioSession(
        store.db,
        url.origin,
        studioOrigin,
        request.headers.get("x-orgsdk-studio-session"),
      )
    : undefined;
  if (
    studioOrigin &&
    (request.headers.has("cookie") || request.headers.has("authorization"))
  ) {
    throw new ServiceError(
      "FORBIDDEN",
      "Dashboard requests must use a paired session.",
    );
  }
  const values = cookies(request);
  const secret = values.get("sessionid");
  const sessionId = grant?.sessionId ?? (secret ? digest(secret) : undefined);
  const session = sessionId ? identities.session(sessionId) : undefined;
  const validSession =
    session && session.expiresAt > Date.now() ? session : undefined;
  const authorization = request.headers.get("authorization");
  const { token, clientTokenError } = authenticateClientBearer(
    url.pathname.startsWith("/internal/") ? null : authorization,
    identities,
    workspace?.id,
  );
  const userId = authorization === null ? validSession?.userId : token?.actorId;
  const user = userId ? (identities.user(userId) ?? null) : null;
  const membership =
    user && workspace
      ? identities.membership(workspace.id, user.id)
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
    clientTokenError,
    responseHeaders,
    studioOrigin,
    studioExpiresAt: grant?.expiresAt,
    sessionId: validSession?.id ?? null,
  };
  if (!studioOrigin && !values.get("csrftoken")) {
    setCookie(ctx, "csrftoken", randomSecret());
  }
  return ctx;
}
export function checkClientRequest(
  ctx: AppContext,
  operationType = ctx.operationType,
): void {
  if (ctx.clientTokenError) {
    throw new ServiceError("UNAUTHORIZED", ctx.clientTokenError);
  }
  if (operationType !== "mutation" || ctx.token) {
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
