import { browserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { ServiceError } from "../../shared/errors";
import { requireIdentity } from "../../auth/context";
import {
  assertCurrentUser,
  requireFresh,
  rotateSession,
} from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { authState } from "../../auth/views";
import { updateAccount, revokeAccountSessions } from "../../auth/queries";
import { passwordChangeSchema } from "../../auth/schemas";
export const changePasswordProcedure = browserProcedure
  .input(passwordChangeSchema)
  .mutation(async ({ ctx: requestContext, input }) => {
    const ctx = identityContext(requestContext);

    const user = requireIdentity(ctx);
    requireFresh(ctx);
    throttle(ctx, `password:${user.id}`);
    if (
      !(await Bun.password.verify(input.current_password, user.passwordHash))
    ) {
      throw new ServiceError("BAD_REQUEST", "Invalid current password.");
    }
    const passwordHash = await Bun.password.hash(input.new_password);
    rotateSession(
      ctx,
      user.id,
      null,
      () => {
        assertCurrentUser(ctx, user);
        requireFresh(ctx);
      },
      () => {
        updateAccount(ctx.db, user.id, { passwordHash });
        revokeAccountSessions(ctx.db, user.id);
      },
    );
    return authState(ctx);
  });
