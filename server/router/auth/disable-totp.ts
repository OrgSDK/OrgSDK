import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { requireIdentity } from "../../auth/context";
import { assertCurrentUser, requireFresh } from "../../auth/sessions";
import { updateAccount } from "../../auth/queries";
export const disableTotpProcedure = browserProcedure.mutation(({ ctx }) => {
  const user = requireIdentity(ctx);
  requireFresh(ctx);
  inTransaction(ctx, (ctx) => {
    assertCurrentUser(ctx, user);
    requireFresh(ctx);
    updateAccount(ctx.db, user.id, {
      totpSecret: null,
      pendingTotpSecret: null,
      totpLastCounter: null,
      recoveryCodes: "[]",
    });
  });
  return { enabled: false };
});
