import { password as passwords } from "../../platform/password";
import { freshBrowserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { ServiceError } from "../../shared/errors";
import {
  assertCurrentUser,
  requireFresh,
  rotateSession,
} from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { authState } from "../../auth/views";
import { updateAccount } from "../../auth/queries";
import { eq, or } from "drizzle-orm";
import { sessions } from "../../db/schema/core";
import { passwordChangeSchema } from "../../auth/schemas";
export const changePasswordProcedure = freshBrowserProcedure
  .input(passwordChangeSchema)
  .mutation(async ({ ctx: requestContext, input }) => {
    const ctx = identityContext(requestContext);

    const user = requestContext.user;
    throttle(ctx, `password:${user.id}`);
    if (!(await passwords.verify(input.current_password, user.passwordHash))) {
      throw new ServiceError("BAD_REQUEST", "Invalid current password.");
    }
    const passwordHash = await passwords.hash(input.new_password);
    rotateSession(
      ctx,
      user.id,
      null,
      (ctx) => {
        assertCurrentUser(ctx, user);
        requireFresh(ctx);
      },
      (ctx) => {
        updateAccount(ctx.db, user.id, { passwordHash });
        ctx.db
          .delete(sessions)
          .where(
            or(
              eq(sessions.userId, user.id),
              eq(sessions.pendingUserId, user.id),
            ),
          )
          .run();
      },
    );
    return authState(ctx);
  });
