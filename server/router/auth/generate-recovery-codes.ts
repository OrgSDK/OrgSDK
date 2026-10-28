import { freshBrowserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { randomBytes } from "node:crypto";
import { digest } from "../../shared/security";
import { assertCurrentUser, requireFresh } from "../../auth/sessions";
import { updateAccount } from "../../auth/queries";
import { requireEnabledTotp } from "../../auth/totp";
export const generateRecoveryCodesProcedure = freshBrowserProcedure.mutation(
  ({ ctx }) => {
    const user = requireEnabledTotp(ctx.user);
    return inTransaction(ctx, (ctx) => {
      assertCurrentUser(ctx, user);
      requireFresh(ctx);
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(8).toString("hex"),
      );
      updateAccount(ctx.db, user.id, {
        recoveryCodes: JSON.stringify(codes.map(digest)),
      });
      return { unused_codes: codes };
    });
  },
);
