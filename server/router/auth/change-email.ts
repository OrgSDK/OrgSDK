import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { ServiceError } from "../../shared/errors";
import { requireIdentity } from "../../auth/context";
import { assertCurrentUser, requireFresh } from "../../auth/sessions";
import { updateAccount } from "../../auth/queries";
import { emailChangeSchema } from "../../auth/schemas";
export const changeEmailProcedure = browserProcedure
  .input(emailChangeSchema)
  .mutation(({ ctx, input }) => {
    const nextEmail = input.email;
    const user = requireIdentity(ctx);
    requireFresh(ctx);
    const email = nextEmail.trim().toLowerCase();
    try {
      inTransaction(ctx, (ctx) => {
        assertCurrentUser(ctx, user);
        requireFresh(ctx);
        updateAccount(ctx.db, user.id, { email });
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw new ServiceError("BAD_REQUEST", "This email is already in use.");
    }
    return [{ email, primary: true, verified: false }];
  });
