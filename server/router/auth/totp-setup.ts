import { freshBrowserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { randomBytes } from "node:crypto";
import { encrypt } from "../../shared/security";
import { assertCurrentUser, requireFresh } from "../../auth/sessions";
import { base32 } from "../../auth/totp";
import { updateAccount } from "../../auth/queries";
export const totpSetupProcedure = freshBrowserProcedure.mutation(({ ctx }) => {
  const user = ctx.user;
  return inTransaction(ctx, (ctx) => {
    assertCurrentUser(ctx, user);
    requireFresh(ctx);
    if (user.totpSecret) {
      return { enabled: true, secret: null };
    }
    const secret = base32(randomBytes(20));
    updateAccount(ctx.db, user.id, { pendingTotpSecret: encrypt(ctx, secret) });
    return { enabled: false, secret };
  });
});
