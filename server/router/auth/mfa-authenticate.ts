import { browserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { ServiceError } from "../../shared/errors";
import { identityRepository } from "../../repositories/identity";
import { assertCurrentUser, rotateSession } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { consumeCode } from "../../auth/totp";
import { authState } from "../../auth/views";
import { codeSchema } from "../../auth/schemas";
export const mfaAuthenticateProcedure = browserProcedure
  .input(codeSchema)
  .mutation(({ ctx: requestContext, input }) => {
    const ctx = identityContext(requestContext);
    const code = input.code;
    const session = ctx.sessionId
      ? identityRepository(ctx.db).session(ctx.sessionId)
      : undefined;
    const user = session?.pendingUserId
      ? identityRepository(ctx.db).user(session.pendingUserId)
      : undefined;
    throttle(ctx, `mfa:${session?.pendingUserId ?? "anonymous"}`);
    if (!user || !consumeCode(ctx, user, code) || !ctx.workspace) {
      throw new ServiceError("BAD_REQUEST", "Invalid authentication code.");
    }
    rotateSession(ctx, user.id, null, () => {
      const current = ctx.sessionId
        ? identityRepository(ctx.db).session(ctx.sessionId)
        : undefined;
      if (
        !current ||
        current.pendingUserId !== user.id ||
        current.expiresAt <= Date.now()
      ) {
        throw new ServiceError(
          "UNAUTHORIZED",
          "Your session has expired. Sign in again.",
        );
      }
      assertCurrentUser(ctx, user, false);
    });
    ctx.user = user;
    return authState(ctx);
  });
