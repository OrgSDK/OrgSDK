import { authenticatedBrowserProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { markFresh } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { authState } from "../../auth/views";
import { reauthenticationSchema } from "../../auth/schemas";
export const reauthenticateProcedure = authenticatedBrowserProcedure
  .input(reauthenticationSchema)
  .mutation(async ({ ctx, input }) => {
    const password = input.password;
    const user = ctx.user;
    throttle(ctx, `reauth:${user.id}`);
    if (!(await Bun.password.verify(password, user.passwordHash))) {
      throw new ServiceError("BAD_REQUEST", "Invalid password.");
    }
    if (user.totpSecret) {
      throw new ServiceError(
        "UNAUTHORIZED",
        "Use your authenticator code to confirm your identity.",
      );
    }
    markFresh(ctx, user);
    return authState(ctx);
  });
