import { browserProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { requireIdentity } from "../../auth/context";
import { markFresh } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { consumeCode } from "../../auth/totp";
import { authState } from "../../auth/views";
import { codeSchema } from "../../auth/schemas";
export const mfaReauthenticateProcedure = browserProcedure
  .input(codeSchema)
  .mutation(({ ctx, input }) => {
    const code = input.code;
    const user = requireIdentity(ctx);
    throttle(ctx, `reauth-mfa:${user.id}`);
    if (!consumeCode(ctx, user, code)) {
      throw new ServiceError("BAD_REQUEST", "Invalid authentication code.");
    }
    markFresh(ctx, user);
    return authState(ctx);
  });
