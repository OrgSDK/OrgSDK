import { browserProcedure } from "../procedures";
import { identityRepository } from "../../repositories/identity";
import { authState } from "../../auth/views";
export const browserSessionProcedure = browserProcedure.query(({ ctx }) => {
  const session = ctx.sessionId
    ? identityRepository(ctx.db).session(ctx.sessionId)
    : undefined;
  return authState(
    ctx,
    ctx.user ? [] : session?.pendingUserId ? ["mfa_authenticate"] : ["login"],
  );
});
