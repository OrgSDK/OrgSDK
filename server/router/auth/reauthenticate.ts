import { browserProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { requireIdentity } from "../../auth/context";
import { markFresh } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { authState } from "../../auth/views";
import { reauthenticationSchema } from "../../auth/schemas";
export const reauthenticateProcedure = browserProcedure
  .input(reauthenticationSchema)
  .mutation(async ({ ctx, input }) => {
    const password = input.password;
    const user = requireIdentity(ctx);
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
