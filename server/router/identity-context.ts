import type { IdentityContext } from "../auth/context";
import { type AppContext, setCookie } from "../http/context";
import { randomSecret } from "../shared/security";
export function identityContext(ctx: AppContext): IdentityContext {
  return {
    db: ctx.db,
    secrets: ctx.secrets,
    workspace: ctx.workspace,
    role: ctx.role,
    token: ctx.token,
    hostname: ctx.hostname,
    origin: ctx.origin,
    operationType: ctx.operationType,
    get user() {
      return ctx.user;
    },
    set user(user) {
      ctx.user = user;
      ctx.userId = user?.id ?? null;
    },
    get userId() {
      return ctx.userId;
    },
    set userId(userId) {
      ctx.userId = userId;
    },
    get sessionId() {
      return ctx.sessionId;
    },
    set sessionId(id) {
      ctx.sessionId = id;
    },
    sessionChanged(secret) {
      setCookie(ctx, "sessionid", secret ?? "", true, secret ? 86400 * 14 : 0);
      if (secret) {
        setCookie(ctx, "csrftoken", randomSecret());
      }
    },
  };
}
