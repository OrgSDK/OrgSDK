import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { ServiceError } from "../../shared/errors";
import { identityRepository } from "../../repositories/identity";
import { decrypt } from "../../shared/security";
import { requireIdentity } from "../../auth/context";
import { assertCurrentUser, requireFresh } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { totpCounter } from "../../auth/totp";
import { updateAccount } from "../../auth/queries";
import { codeSchema } from "../../auth/schemas";
export const enableTotpProcedure = browserProcedure
  .input(codeSchema)
  .mutation(({ ctx, input }) => {
    const code = input.code;
    const user = requireIdentity(ctx);
    requireFresh(ctx);
    throttle(ctx, `totp-setup:${user.id}`);
    return inTransaction(ctx, (ctx) => {
      assertCurrentUser(ctx, user);
      requireFresh(ctx);
      const current = identityRepository(ctx.db).user(user.id);
      const step = current?.pendingTotpSecret
        ? totpCounter(decrypt(ctx, current.pendingTotpSecret), code)
        : null;
      if (!current?.pendingTotpSecret || step === null) {
        throw new ServiceError("BAD_REQUEST", "Invalid authentication code.");
      }
      updateAccount(ctx.db, user.id, {
        totpSecret: current.pendingTotpSecret,
        pendingTotpSecret: null,
        totpLastCounter: step,
      });
      return { type: "totp" };
    });
  });
