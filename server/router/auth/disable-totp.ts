import { freshBrowserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { assertCurrentUser, requireFresh } from "../../auth/sessions";
import { updateAccount } from "../../auth/queries";
export const disableTotpProcedure = freshBrowserProcedure.mutation(
  ({ ctx }) => {
    const user = ctx.user;
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
  },
);
